# ADR-0004: Build vs Buy para o Pipeline de RAG

## Status: Proposto

---

## Contexto

O pipeline de RAG é o componente central do assistente: ingere documentos, cria embeddings, armazena num vector store, recupera chunks relevantes e monta o contexto para o LLM. A decisão de construir, comprar ou combinar as duas abordagens impacta diretamente prazo, custo operacional, flexibilidade e sustentabilidade pós-projeto.

**Características da base documental que influenciam a decisão:**
- ~800 documentos no SharePoint (PDF, DOCX), ~400 páginas no Confluence (HTML), ~50 planilhas XLSX
- Atualização mensal por 3 áreas distintas sem processo unificado
- Documentos contraditórios já identificados (PROC-042 v1 vs v2) — exigem metadados de conflito customizados (ADR-0003)
- Chunking semântico com overlap definido no ADR-0002 — não suportado nativamente por ferramentas point-and-click
- Tabela de fretes base (`frete-base-AAAAMM.xlsx`) atualizada mensalmente — exige pipeline de ingestão automatizado

**Restrições de projeto:**
- 3 meses de prazo total (discovery + desenvolvimento + go-live)
- NovaTech já tem Azure AI Services provisionado
- Time de TI da NovaTech assumirá manutenção pós-projeto — expertise Azure, não Python/DevOps avançado
- Integração obrigatória com Microsoft Teams e SharePoint

**Opções avaliadas:**

| Dimensão | Full Buy (Azure nativo) | Full Build (open-source) | Híbrido |
|---|---|---|---|
| Controle sobre chunking | Baixo | Alto | Alto |
| Controle sobre metadados | Baixo | Alto | Alto |
| Velocidade de setup | Alta | Baixa | Média |
| Custo operacional | Médio-alto | Baixo (infra própria) | Médio |
| Sustentabilidade pós-projeto | Alta (Azure) | Baixa (expertise DB1) | Alta (Azure + docs) |
| Conector SharePoint nativo | Sim | Não | Sim |
| Flexibilidade de re-ranking | Baixa | Alta | Média |

---

## Decisão

Adotar a abordagem **híbrida**: Azure AI Search como infraestrutura de indexação e retrieval (gerenciado), LangChain como camada de orquestração (open-source, vendor-neutral), e código customizado para chunking semântico e enriquecimento de metadados de conflito.

### Arquitetura do pipeline

```
[Fontes]                [Ingestão customizada]        [Indexação gerenciada]
SharePoint   ──────►  Extração de texto               Azure AI Search
Confluence   ──────►  Chunking semântico +  ────────► (índice com metadados
Rede (XLSX)  ──────►  Metadados de conflito            de versão e conflito)
                       (ADR-0003)

[Query]                [Orquestração]                 [Geração]
Pergunta     ──────►  LangChain:                       Azure OpenAI
do atendente          - Detecção multi-domínio ──────► (GPT-4o)
                       - Recuperação de chunks          (ADR-0001)
                       - Montagem de contexto
                       (ADR-0002)
```

### Componentes e responsabilidades

**Azure AI Search (gerenciado):**
- Armazenamento e indexação dos chunks com metadados
- Conector nativo para SharePoint — automatiza ingestão e re-ingestão mensal sem pipeline customizado adicional
- Busca vetorial + busca híbrida (semântica + keyword) para maior cobertura de retrieval
- Atualização automática via trigger quando documento é modificado no SharePoint

**LangChain (open-source, camada de orquestração):**
- Detecção de perguntas multi-domínio (ADR-0002)
- Montagem do contexto com anatomia definida (system prompt + metadados + chunks + histórico + pergunta)
- Detecção de chunks conflitantes antes da montagem do prompt (ADR-0003)
- Integração com Azure OpenAI para geração
- Buffer de portabilidade: troca de modelo ou vector store é configuração, não reescrita

**Código customizado (Python, versionado no repositório):**
- Script de chunking semântico com overlap de 10% — não substituível pelo conector nativo
- Enriquecimento de metadados de conflito (`conflict_flag`, `version`, `status`, `substituido_por`)
- Script de ingestão para fontes não cobertas pelo conector SharePoint (Confluence, planilhas XLSX)
- Trigger automatizado de re-ingestão mensal (Azure Function ou GitHub Actions)

**Azure Bot Framework + Teams:**
- Interface com o atendente via Microsoft Teams
- Gerenciamento de sessão (limite de turnos, ADR-0002)
- Logging de queries e respostas para auditoria

---

## Consequências

**Positivas:**
- O conector nativo do Azure AI Search para SharePoint elimina semanas de desenvolvimento de pipeline de ingestão — crítico no prazo de 3 meses.
- A infraestrutura gerenciada do Azure AI Search é mantida pelo time de TI da NovaTech com expertise já existente — sustentabilidade pós-projeto garantida.
- LangChain como camada de orquestração cria portabilidade de modelo: trocar GPT-4o por outra opção futura é alteração de configuração.
- A automatização da re-ingestão mensal resolve estruturalmente o risco R7 (ingestão manual que perpetua documentos desatualizados).
- O código customizado de chunking e metadados fica versionado no repositório — auditável, testável, evoluível.

**Negativas:**
- Azure AI Search cria vendor lock-in no componente de retrieval — migração futura para outro vector store (Pinecone, Weaviate, ChromaDB) exige reescrita do pipeline de ingestão.
- Custo do Azure AI Search é superior ao ChromaDB local — estimativa: $50–150/mês dependendo do nível de serviço e volume de queries.
- A camada híbrida tem mais componentes do que o full buy — maior superfície de falha e mais pontos de monitoramento necessários.
- O código customizado de chunking cria dependência de manutenção pela DB1 durante o contrato — risco se a NovaTech precisar evoluir o chunking sem suporte externo.

---

## Alternativas consideradas

### Full Buy — Azure AI Search + Azure OpenAI + Azure Bot Framework (point-and-click)
**Por que foi avaliado:** velocidade máxima de setup, sustentabilidade total pelo time Azure da NovaTech, sem necessidade de código Python customizado.

**Por que foi descartado:**
1. O chunking semântico com overlap (ADR-0002) e os metadados de conflito (ADR-0003) são requisitos não-negociáveis derivados das contradições identificadas na base documental. O Azure AI Search point-and-click não suporta chunking customizado nem schema de metadados arbitrários sem código.
2. Sem a camada de detecção de conflito, o pipeline entregaria um produto que gera erros financeiros silenciosos — inaceitável para o caso de uso de atendimento ao cliente com impacto em contratos.

### Full Build — LangChain + ChromaDB + código manual
**Por que foi avaliado:** controle total sobre todos os componentes, sem custo de serviço gerenciado, stack conhecida do protótipo open-source do Exercício Dev 1.3.

**Por que foi descartado:**
1. ChromaDB em produção para ~1.250 documentos com atualizações mensais de 3 áreas requer infraestrutura e operação que não estão no escopo do projeto de 3 meses.
2. O pipeline de ingestão do SharePoint e do Confluence precisaria ser construído do zero — semanas de desenvolvimento que o conector nativo do Azure AI Search elimina.
3. O time de TI da NovaTech não tem expertise para manter uma stack Python/ChromaDB em produção. Entregar um sistema que o cliente não consegue sustentar é um risco de projeto crítico.
4. O full build é adequado para o protótipo (Exercício Dev 1.3) mas não para produção no prazo e restrições deste projeto.

---

## Notas de implementação

- **Nível do Azure AI Search:** começar com Standard S1 (suporta até 50 índices, 25GB por índice). Revisar após discovery quando o tamanho real da base for conhecido.
- **Trigger de re-ingestão:** Azure Function com timer trigger mensal + webhook para ingestão imediata quando documento é publicado no SharePoint (reduz o delay de atualização de 30 dias para horas).
- **Versionamento do código customizado:** scripts de chunking e metadados no mesmo repositório que o system prompt — mesma disciplina de review e versionamento (ADR relacionado: Exercício 1.2).
- **Monitoramento:** logar score de similaridade dos chunks recuperados por query. Scores sistematicamente baixos (<0.7) indicam que a pergunta não tem boa cobertura na base — sinal para expansão documental.
- **Índice de desenvolvimento:** manter índice separado no Azure AI Search para testes — nunca testar em produção com documentos reais.
