# Análise v2 — Comparação v1 → v2 (azure-functions-endpoint skill)

**Arquivo v1:** `evidence/ex2.3/gen-com-skill-v1.ts`  
**Arquivo v2:** `evidence/ex2.3/gen-com-skill-v2.ts`  
**Skill usada:** `skills/domain/azure-functions-endpoint.md v2`

---

## Regras anteriormente ausentes que v2 aplicou

| # | Regra adicionada no skill v2 | v1 | v2 | Evidência concreta |
|---|------------------------------|----|----|---------------------|
| 1 | `MUST NOT usar context.log` explícito | ⚠️ PARCIAL — `context` não usado mas sem sinalização de intenção | ✅ SEGUIU | v2 renomeia para `_context: InvocationContext` com comentário: `// context.log MUST NOT be used (per skill v2)` |
| 2 | `logger.warn` vs `logger.error` distinção | ⚠️ PARCIAL — v1 usava ambos mas sem instrução explícita | ✅ SEGUIU | v2 adiciona comentário na linha do `logger.warn`: `// logger.warn = client validation failure (not a system error)` |
| 3 | Definição de `source_document` (doc_id vs URL) | ❌ IGNOROU — v1 usava URL sem saber que deveria ser doc_id | ✅ SEGUIU | v2 adiciona comentário na interface: `// doc_id from Azure AI Search, or documentUrl for ingest` e no response |
| 4 | Comentário explicando por que `source_document` = URL no ingest | ❌ IGNOROU | ✅ SEGUIU | `// For ingest: documentUrl is the source identifier until AI Search assigns doc_id` |

---

## Regras que foram consistentes entre v1 e v2 (não houve regressão)

| Regra | v1 | v2 |
|-------|----|----|
| `app.http()` v4 pattern | ✅ | ✅ |
| Zod antes de qualquer lógica | ✅ | ✅ |
| `source_document` presente no response | ✅ | ✅ |
| pino (`logger`) sem `console.*` | ✅ | ✅ |
| `callWithRetry` com exponential backoff | ✅ | ✅ |
| `catch` não vazio — loga e retorna 500 | ✅ | ✅ |
| Nenhum stack trace no response | ✅ | ✅ |
| Tipo de retorno explícito `Promise<HttpResponseInit>` | ✅ | ✅ |
| Nenhum `any` | ✅ | ✅ |
| `jsonBody` (v4) vs `body: JSON.stringify` (v3) | ✅ | ✅ |

---

## Regras ainda não evidenciadas em v2 (escopo não aplicável)

| Regra | Motivo de não aparecer |
|-------|------------------------|
| Filtro `status eq 'vigente'` no Azure AI Search | Endpoint de ingestão não faz retrieval — não aplicável |
| Context budget (4.300 tokens, posição dos chunks) | Ingestão não chama Azure OpenAI — não aplicável |
| `SESSION_MAX_TURNS` | Endpoint stateless — não aplicável |

---

## Lição aprendida: que tipo de instrução na skill muda o comportamento do agente?

### Instruções que funcionam melhor

**1. Proibições absolutas com nome específico do símbolo**

A instrução `MUST NOT usar context.log` (com o nome exato `context.log`) produziu efeito imediato: o agente renomeou o parâmetro para `_context` e adicionou um comentário explicativo. A versão anterior que dizia "MUST NOT usar `console.*`" sem mencionar `context.log` deixou o gap aberto.

**Padrão:** nome exato do símbolo proibido + o porquê em parênteses.

**2. Distinções de nível (warn vs error)**

Adicionar a regra `logger.warn para validação / logger.error para exceções` produziu comentários explicativos no código — o agente não apenas seguiu a regra mas documentou por que cada nível foi escolhido.

**Padrão:** quando há duas opções similares, explicar a regra de decisão entre elas.

**3. Definição do valor esperado (não apenas o campo obrigatório)**

A instrução "source_document = doc_id do Azure AI Search" com o exemplo `"PROC-042-v2"` resolveu a ambiguidade que v1 tinha (URL vs doc_id). O agente v2 adicionou um comentário de interface documentando o contrato.

**Padrão:** para campos de domínio, explicar o VALOR esperado, não apenas que o campo é obrigatório.

### O que a skill NÃO consegue forçar

**1. Lógica de runtime:** o context budget de 4.300 tokens e o filtro `status eq 'vigente'` aparecem nas regras mas só são relevantes quando o endpoint chama Azure OpenAI ou Azure AI Search. O agente aplica corretamente quando o contexto é adequado — a skill não pode forçar lógica que não faz sentido para o tipo de endpoint.

**2. Configuração externa (tsconfig, vitest.config):** regras sobre `"strict": true` e coverage threshold não aparecem em handlers — precisam de templates ou scripts de scaffolding separados.

**3. Regras de processo (branches, commits):** o agente gera código, não commits. Essas regras pertencem a hooks de git ou templates de PR.

### Conclusão — skill v2 vs baseline

| Aspecto | Baseline (sem skill) | Com skill v1 | Com skill v2 |
|---------|----------------------|--------------|--------------|
| `app.http()` v4 | ✅ | ✅ | ✅ |
| Zod (não typeof) | ❌ typeof usado | ✅ | ✅ |
| pino (não console) | ❌ console.log | ✅ | ✅ |
| source_document | ❌ ausente | ✅ | ✅ com definição clara |
| context.log ausente | ❌ presente | ⚠️ ausente sem intenção | ✅ `_context` + comentário |
| logger.warn vs error | ❌ sem distinção | ⚠️ correto mas sem instrução | ✅ distinção documentada |
| Semântica de source_document | ❌ sem definição | ⚠️ URL usada sem justificativa | ✅ URL justificada + doc_id explicado |
| callWithRetry | ❌ sem retry | ✅ | ✅ |
| jsonBody (v4) | ❌ body+JSON.stringify | ✅ | ✅ |

A skill reduziu violações críticas de 6 para 0 entre o baseline e a geração com v2.
