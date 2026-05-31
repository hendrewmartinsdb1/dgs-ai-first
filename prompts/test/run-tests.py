"""
Script de Teste Automatizado de Prompts — NovaTech RAG
Gerado com assistência do GitHub Copilot.

Uso:
    python run-tests.py --prompt ../system/system-v1.0.md --cases test-cases.json

Dependências:
    pip install openai python-dotenv

Variáveis de ambiente (.env):
    AZURE_OPENAI_ENDPOINT=https://<seu-recurso>.openai.azure.com/
    AZURE_OPENAI_KEY=<sua-chave>
    AZURE_OPENAI_DEPLOYMENT=gpt-4o
"""

import json
import re
import argparse
from pathlib import Path
from dataclasses import dataclass, field
from typing import Optional

# -- dependências opcionais (não falha no import para permitir revisão do script sem Azure)
try:
    from openai import AzureOpenAI
    import os
    from dotenv import load_dotenv
    load_dotenv()
    AZURE_AVAILABLE = True
except ImportError:
    AZURE_AVAILABLE = False


# ---------------------------------------------------------------------------
# Modelos de dados
# ---------------------------------------------------------------------------

@dataclass
class TestResult:
    test_id: str
    descricao: str
    categoria: str
    criticidade: str
    passed: bool
    criterios_resultado: dict = field(default_factory=dict)
    resposta_obtida: str = ""
    erros: list = field(default_factory=list)


@dataclass
class TestReport:
    total: int = 0
    aprovados: int = 0
    reprovados: int = 0
    criticos_reprovados: int = 0
    resultados: list = field(default_factory=list)

    @property
    def taxa_aprovacao(self) -> float:
        return (self.aprovados / self.total * 100) if self.total > 0 else 0.0


# ---------------------------------------------------------------------------
# Verificadores de critérios
# ---------------------------------------------------------------------------

def verificar_must_contain(resposta: str, termos: list[str]) -> tuple[bool, list[str]]:
    """Verifica se todos os termos obrigatórios estão na resposta."""
    faltando = [t for t in termos if t.lower() not in resposta.lower()]
    return len(faltando) == 0, faltando


def verificar_must_not_contain(resposta: str, termos: list[str]) -> tuple[bool, list[str]]:
    """Verifica se nenhum termo proibido está na resposta."""
    encontrados = [t for t in termos if t.lower() in resposta.lower()]
    return len(encontrados) == 0, encontrados


def verificar_citacao_de_fonte(resposta: str) -> bool:
    """
    Verifica se a resposta contém ao menos uma citação de fonte no formato esperado.
    Formato aceito: (Fonte: NOME-DO-DOCUMENTO, seção X.X)
    Também aceita menções diretas a padrões de documento como POL-001, PROC-042, SLA-2024.
    """
    padrao_fonte = r"\(\s*Fonte:\s*[A-Za-z0-9\-]+(?:\s+[A-Za-z0-9\-]+)*,\s*seção\s*\d+(?:\.\d+)*\s*\)"
    padrao_doc = r"\b(?:POL|PROC|SLA|FAQ)-\d+(?:-[A-Za-z0-9]+)*\b"
    return bool(re.search(padrao_fonte, resposta, re.IGNORECASE) or re.search(padrao_doc, resposta, re.IGNORECASE))


def verificar_idioma_portugues(resposta: str) -> bool:
    """
    Verificação heurística simples: presença de palavras comuns em português.
    Em produção, substituir por langdetect ou similar.
    """
    palavras_pt = ['de', 'da', 'do', 'em', 'para', 'com', 'não', 'que', 'são', 'por']
    palavras_encontradas = sum(1 for p in palavras_pt if f' {p} ' in resposta.lower())
    return palavras_encontradas >= 3


def verificar_alerta_contradicao(resposta: str) -> bool:
    """Verifica se a resposta sinaliza contradição entre versões de documento."""
    termos_contradicao = ['versão anterior', 'versão mais recente', 'versão vigente',
                          'confirme', 'verifique o contrato', 'v1', 'v2']
    return any(t.lower() in resposta.lower() for t in termos_contradicao)


def verificar_valor_absoluto_frete(resposta: str) -> bool:
    """
    Retorna True se a resposta NÃO contém valor absoluto de frete (R$, valores monetários).
    O assistente só deve informar multiplicadores, nunca valores finais.
    """
    padroes_proibidos = [r'R\$\s*\d', r'\d+\s*reais', r'custa\s+\d', r'valor\s+de\s+R']
    return not any(re.search(p, resposta, re.IGNORECASE) for p in padroes_proibidos)


# ---------------------------------------------------------------------------
# Executor de testes
# ---------------------------------------------------------------------------

def executar_criterios(resposta: str, caso: dict) -> tuple[bool, dict, list]:
    """Aplica todos os critérios de um caso de teste à resposta obtida."""
    criterios = caso.get("criterios", {})
    resultado_criterios = {}
    erros = []

    # must_contain
    if "must_contain" in criterios:
        ok, faltando = verificar_must_contain(resposta, criterios["must_contain"])
        resultado_criterios["must_contain"] = ok
        if not ok:
            erros.append(f"Termos obrigatórios ausentes: {faltando}")

    # must_not_contain
    if "must_not_contain" in criterios:
        ok, encontrados = verificar_must_not_contain(resposta, criterios["must_not_contain"])
        resultado_criterios["must_not_contain"] = ok
        if not ok:
            erros.append(f"Termos proibidos encontrados: {encontrados}")

    # must_cite_source
    if criterios.get("must_cite_source", False):
        ok = verificar_citacao_de_fonte(resposta)
        resultado_criterios["must_cite_source"] = ok
        if not ok:
            erros.append("Nenhuma citação de fonte identificada na resposta")

    # must_be_portuguese
    if criterios.get("must_be_portuguese", False):
        ok = verificar_idioma_portugues(resposta)
        resultado_criterios["must_be_portuguese"] = ok
        if not ok:
            erros.append("Resposta não parece estar em português")

    # must_flag_contradiction
    if criterios.get("must_flag_contradiction", False):
        ok = verificar_alerta_contradicao(resposta)
        resultado_criterios["must_flag_contradiction"] = ok
        if not ok:
            erros.append("Contradição entre documentos não foi sinalizada")

    # verificação especial: guardrail financeiro (nenhum TC deve retornar valor absoluto de frete)
    if caso.get("categoria") == "guardrail_financeiro":
        ok = verificar_valor_absoluto_frete(resposta)
        resultado_criterios["no_valor_absoluto_frete"] = ok
        if not ok:
            erros.append("Resposta contém valor absoluto de frete — guardrail violado")

    passou = len(erros) == 0
    return passou, resultado_criterios, erros


def chamar_llm(system_prompt: str, pergunta: str, chunks: list[str]) -> Optional[str]:
    """Envia a query ao Azure OpenAI e retorna a resposta."""
    if not AZURE_AVAILABLE:
        return None

    client = AzureOpenAI(
        azure_endpoint=os.getenv("AZURE_OPENAI_ENDPOINT"),
        api_key=os.getenv("AZURE_OPENAI_KEY"),
        api_version="2024-02-01"
    )

    # Monta o contexto de chunks no formato esperado pelo sistema
    contexto_chunks = "\n\n".join(
        f"[DOCUMENTO: {chunk_id}]\n<conteúdo simulado do chunk {chunk_id}>"
        for chunk_id in chunks
    ) if chunks else "[Nenhum documento relevante recuperado para esta pergunta]"

    mensagens = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": f"Documentos de contexto:\n{contexto_chunks}\n\nPergunta: {pergunta}"}
    ]

    response = client.chat.completions.create(
        model=os.getenv("AZURE_OPENAI_DEPLOYMENT", "gpt-4o"),
        messages=mensagens,
        temperature=0,
        max_tokens=800
    )

    return response.choices[0].message.content


# ---------------------------------------------------------------------------
# Runner principal
# ---------------------------------------------------------------------------

def rodar_testes(prompt_path: str, cases_path: str, dry_run: bool = False) -> TestReport:
    """
    Executa todos os casos de teste.

    dry_run=True: valida a estrutura dos casos sem chamar o LLM.
                  Útil para CI/CD sem credenciais Azure.
    """
    system_prompt = Path(prompt_path).read_text(encoding="utf-8")
    casos = json.loads(Path(cases_path).read_text(encoding="utf-8"))

    relatorio = TestReport(total=len(casos))

    print(f"\n{'='*60}")
    print(f"  NovaTech RAG — Teste de Prompt")
    print(f"  Prompt: {Path(prompt_path).name}")
    print(f"  Casos: {len(casos)} | Modo: {'dry-run' if dry_run else 'live'}")
    print(f"{'='*60}\n")

    for caso in casos:
        test_id = caso["id"]
        criticidade = caso["criticidade"]

        if dry_run:
            # Em dry-run, usa uma resposta simulada baseada na referência
            resposta = caso.get("resposta_correta_referencia", "")
        else:
            resposta = chamar_llm(system_prompt, caso["pergunta"], caso.get("chunks_injetados", []))
            if resposta is None:
                print(f"[SKIP] {test_id} — Azure OpenAI não disponível")
                continue

        passou, criterios_resultado, erros = executar_criterios(resposta, caso)

        resultado = TestResult(
            test_id=test_id,
            descricao=caso["descricao"],
            categoria=caso["categoria"],
            criticidade=criticidade,
            passed=passou,
            criterios_resultado=criterios_resultado,
            resposta_obtida=resposta[:200] + "..." if len(resposta) > 200 else resposta,
            erros=erros
        )

        relatorio.resultados.append(resultado)

        if passou:
            relatorio.aprovados += 1
            status = "PASS"
        else:
            relatorio.reprovados += 1
            status = "FAIL"
            if criticidade == "alta":
                relatorio.criticos_reprovados += 1

        icone = "✓" if passou else "✗"
        print(f"  [{status}] {icone} {test_id} [{criticidade.upper()}] — {caso['descricao']}")
        if not passou:
            for erro in erros:
                print(f"         → {erro}")

    # Resumo final
    print(f"\n{'='*60}")
    print(f"  RESULTADO: {relatorio.aprovados}/{relatorio.total} aprovados "
          f"({relatorio.taxa_aprovacao:.0f}%)")
    if relatorio.criticos_reprovados > 0:
        print(f"  ⚠ ATENÇÃO: {relatorio.criticos_reprovados} caso(s) CRÍTICO(S) reprovado(s)")
        print(f"  → PR bloqueado até resolução dos casos críticos")
    else:
        print(f"  → Nenhum caso crítico reprovado")
    print(f"{'='*60}\n")

    return relatorio


# ---------------------------------------------------------------------------
# Entrypoint
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Testa o system prompt do NovaTech RAG")
    parser.add_argument("--prompt", default="../system/system-v1.0.md",
                        help="Caminho para o arquivo do system prompt")
    parser.add_argument("--cases", default="test-cases.json",
                        help="Caminho para o arquivo JSON de casos de teste")
    parser.add_argument("--dry-run", action="store_true",
                        help="Executa sem chamar o LLM (valida estrutura e critérios com respostas de referência)")

    args = parser.parse_args()
    relatorio = rodar_testes(args.prompt, args.cases, dry_run=args.dry_run)

    # Exit code não-zero se houver casos críticos reprovados (para CI/CD)
    exit(1 if relatorio.criticos_reprovados > 0 else 0)
