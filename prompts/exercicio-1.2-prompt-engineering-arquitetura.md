# Exercício 1.2 — Prompt Engineering como Artefato de Arquitetura

**Papel:** Tech Lead  
**Data:** 2026-05-30  
**Ferramentas utilizadas:** Claude (chat) + GitHub Copilot (script de teste)

---

## 1. Estratégia de Versionamento e Governança de Prompts

### Localização no repositório

```
/prompts/
  system/
    system-v1.0.md        ← prompt de produção atual
    system-v1.1.md        ← versão em revisão (branch separado)
    CHANGELOG.md          ← histórico de alterações com justificativa por versão
  templates/
    conflict-warning.md   ← mensagem padrão para conflict_flag=true
    no-answer.md          ← mensagem padrão para ausência de cobertura documental
  test/
    test-cases.json       ← casos de teste (pergunta, chunks, critérios)
    run-tests.py          ← script de teste automatizado
```

### Nomenclatura

`system-v{major}.{minor}.md`

| Incremento | Quando usar |
|---|---|
| `major` | Mudança estrutural: identidade, escopo, adição/remoção de guardrail central |
| `minor` | Refinamento: instrução adicional, correção de comportamento, ajuste de formato |

### Quem pode alterar

Apenas Tech Lead ou Dev Sênior via Pull Request com **review obrigatório de ao menos 1 aprovador**.

**Por quê:** uma única alteração no system prompt impacta 100% das queries simultaneamente. Não existe "alteração local" em prompt — toda mudança é um deploy global. O mesmo rigor aplicado a alterações em código de produção deve ser aplicado a alterações de prompt.

### Como são testados

O script `run-tests.py` executa automaticamente todos os casos do `test-cases.json` contra o prompt em revisão. PR sem aprovação em todos os casos **críticos** (criticidade: alta) é bloqueado. Casos de criticidade média podem ter reprovação documentada com justificativa.

### Como são promovidos para produção

O prompt ativo em produção é referenciado por variável de ambiente `SYSTEM_PROMPT_VERSION=1.0`. Trocar de versão é uma alteração de configuração — sem redeploy de código.

---

## 2. Anatomia de Contexto — Estático vs Dinâmico

### Estrutura completa de uma query

```
┌─────────────────────────────────────────────────────┐
│  [1] SYSTEM PROMPT — ESTÁTICO                       │
│  Identidade, guardrails, formato, hierarquia de     │
│  fontes, instruções de conflito                     │
│  Orçamento: ~1.000 tokens                           │
│  Frequência de mudança: raramente (versionado)      │
│  Posição no contexto: INÍCIO (máxima atenção)       │
├─────────────────────────────────────────────────────┤
│  [2] METADADOS DO CLIENTE — DINÂMICO por sessão     │
│  tier, contract_id, account_manager, sla_aplicavel  │
│  Orçamento: ~200 tokens                             │
│  Frequência de mudança: por sessão/atendimento      │
│  Exemplo:                                           │
│  "Cliente: Empresa ABC | Tier: Gold |               │
│   Contrato: 2024-001 | SLA: 2h resposta / 24h res." │
├─────────────────────────────────────────────────────┤
│  [3] CHUNKS RECUPERADOS — DINÂMICO por query        │
│  5 chunks × ~500 tokens (modo padrão)               │
│  7 chunks × ~500 tokens (modo multi-domínio)        │
│  Orçamento: ~2.500 – 3.500 tokens                   │
│  Frequência de mudança: por pergunta                │
│  Posição: logo após system prompt (zona de alta     │
│  atenção — anti lost-in-the-middle)                 │
├─────────────────────────────────────────────────────┤
│  [4] SUMÁRIO DE SESSÃO — DINÂMICO, comprimido       │
│  Histórico da sessão comprimido após turno 5        │
│  Prioriza: restrições identificadas, dados do       │
│  cliente confirmados, ações já tomadas              │
│  Orçamento: ~400 tokens                             │
│  Frequência de mudança: a cada 5 turnos             │
├─────────────────────────────────────────────────────┤
│  [5] PERGUNTA ATUAL — DINÂMICO                      │
│  Pergunta do atendente no turno atual               │
│  Orçamento: ~200 tokens                             │
│  Posição: FINAL (segunda zona de máxima atenção)    │
└─────────────────────────────────────────────────────┘

TOTAL PADRÃO:     ~4.300 tokens  (3,4% da janela de 128K)
TOTAL MULTI-DOM:  ~5.300 tokens  (4,1% da janela de 128K)
MARGEM:           >95% disponível para variações e crescimento
```

### Regra de prioridade de compressão (overflow)

Quando o contexto total excede o orçamento definido, comprimir nesta ordem:

1. Comprimir histórico bruto → sumário estruturado (parte [4])
2. Reduzir chunks: 7 → 5 (desativar modo multi-domínio)
3. Reduzir chunks: 5 → 3 (manter apenas os de maior score de similaridade)
4. **Nunca comprimir:** partes [1] (system prompt) e [5] (pergunta atual)

---

## 3. Script de Teste Automatizado (GitHub Copilot)

Arquivo gerado com assistência do GitHub Copilot: `prompts/test/run-tests.py`

### O que o script verifica

| Critério | Tipo | Verificação |
|---|---|---|
| `must_contain` | Lista de termos | Todos os termos devem aparecer na resposta |
| `must_not_contain` | Lista de termos proibidos | Nenhum deve aparecer |
| `must_cite_source` | Boolean | Resposta deve conter padrão `(POL\|PROC\|SLA\|FAQ)-\d+` |
| `must_be_portuguese` | Boolean | Heurística de palavras comuns em PT-BR |
| `must_flag_contradiction` | Boolean | Alerta de versões conflitantes deve estar presente |
| `no_valor_absoluto_frete` | Automático para categoria `guardrail_financeiro` | Nenhum valor em R$ na resposta |

### Casos de teste cobertos (test-cases.json)

| ID | Categoria | Criticidade | Armadilha testada |
|---|---|---|---|
| TC-001 | inversao_de_regra | Alta | Carga perigosa: FAQ suaviza proibição explícita do POL-001 |
| TC-002 | alucinacao | Alta | Tier "Platinum" inexistente → não inventar SLA |
| TC-003 | resposta_correta | Média | Prazo de devolução padrão — baseline de qualidade |
| TC-004 | guardrail_financeiro | Alta | Frete: nunca calcular valor absoluto sem valor base |
| TC-005 | contradicao_documental | Alta | PROC-042 v1 vs v2 — citar versão vigente e alertar |
| TC-006 | ausencia_de_cobertura | Média | Frete <500kg — sem cobertura, recusar responder |
| TC-007 | resposta_correta | Média | SLA Gold — não confundir chamados gerais com incidentes críticos |

### Como usar no CI/CD

```bash
# Validação estrutural sem Azure (para PRs sem credenciais)
python run-tests.py --dry-run

# Teste completo com LLM real (ambiente de staging)
python run-tests.py --prompt ../system/system-v1.0.md --cases test-cases.json

# Exit code 1 se houver casos críticos reprovados → bloqueia merge
```

---

## 4. Enforcement Probabilístico vs Determinístico

### O problema

O system prompt instrui o modelo com linguagem natural. O modelo *geralmente* segue as instruções — mas não *sempre*. Guardrails críticos não podem depender de probabilidade.

A pergunta de arquitetura é: **qual guardrail fica no prompt e qual fica fora do prompt?**

### Mapeamento de guardrails

| Guardrail | Enforcement | Mecanismo | Justificativa |
|---|---|---|---|
| Responder em português formal | **Probabilístico** (prompt) | Instrução no system prompt | Falha tolerável — atendente percebe e pode pedir nova resposta |
| Citar fonte no formato padronizado | **Duplo** (prompt + Harness) | Instrução no prompt + regex de validação pós-resposta | Crítico para rastreabilidade — validação determinística adicional |
| Nunca inventar prazos ou valores | **Probabilístico** (prompt) | Instrução explícita no system prompt | Difícil de verificar deterministicamente sem ground truth |
| Nunca calcular valor absoluto de frete | **Duplo** (prompt + Harness) | Instrução + regex para R$ e padrões monetários na resposta | Erro financeiro crítico — bloqueio determinístico necessário |
| Não atribuir SLA a tier Platinum | **Duplo** (prompt + Harness) | Instrução + filtro: se "Platinum" na pergunta + valor numérico de SLA na resposta → bloquear | Alucinação de alto risco identificada na base |
| Inverter regra de carga perigosa | **Probabilístico** (prompt) + TC-001 | Instrução explícita R7 + caso de teste de regressão | Verificação automatizada pelo script de teste |
| Hierarquia de fontes (POL > SLA > FAQ) | **Probabilístico** (prompt) | Seção "Prioridade de fontes" no system prompt | Impossível verificar deterministicamente sem análise semântica |
| Alerta de contradição documental | **Probabilístico** (prompt) + TC-005 | Instrução R5 + caso de teste de regressão | Verificação pelo script detecta ausência de sinalização |

### Harness — camada determinística fora do modelo

O Harness é o componente de pós-processamento que intercepta a resposta do LLM antes de entregá-la ao atendente. Implementado como função Python no pipeline LangChain.

```python
def harness_validar_resposta(pergunta: str, resposta: str) -> tuple[str, bool]:
    """
    Valida a resposta do LLM antes de entregar ao atendente.
    Retorna (resposta_final, passou_validacao).
    """

    # Guardrail 1: citação de fonte obrigatória
    if not re.search(r'(POL|PROC|SLA|FAQ)-\d+', resposta):
        return TEMPLATE_SEM_FONTE, False

    # Guardrail 2: nenhum valor absoluto de frete
    if re.search(r'R\$\s*\d|\d+\s*reais', resposta, re.IGNORECASE):
        return TEMPLATE_VALOR_ABSOLUTO_BLOQUEADO, False

    # Guardrail 3: tier Platinum com SLA inventado
    if 'platinum' in pergunta.lower() and re.search(r'\d+h|\d+ hora', resposta):
        return TEMPLATE_TIER_INVALIDO, False

    return resposta, True
```

### Princípio de design

> **Enforcement probabilístico** para o que é difícil de verificar automaticamente mas tolerável se falhar (tom, completude, clareza).  
> **Enforcement determinístico** para o que tem consequência financeira, regulatória ou de confiança se falhar (valores monetários, tiers inexistentes, ausência de citação).

A distinção não é "prompt vs Harness" — é **risco de falha × capacidade de detecção automática**. Guardrails com risco alto e detecção possível por regex/regra devem ser duplicados: instrução no prompt (primeira linha de defesa) + verificação determinística no Harness (segunda linha de defesa).
