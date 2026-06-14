# Análise v1 — Conformidade com SKILL.md v1 (azure-functions-endpoint)

**Arquivo analisado:** `evidence/ex2.3/gen-com-skill-v1.ts`  
**Baseline de comparação:** `evidence/ex2.3/gen-sem-skill.ts`

---

## Tabela de Conformidade

| # | Regra (SKILL.md v1) | Status | Evidência no código |
|---|---------------------|--------|---------------------|
| 1 | MUST usar `app.http()` (v4 pattern) | ✅ SEGUIU | `app.http("ingest", { methods: ["POST"], ... })` presente |
| 2 | MUST NOT usar `export default function` (v3 pattern) | ✅ SEGUIU | Nenhum export default — função registrada via `app.http()` |
| 3 | MUST validar com Zod ANTES de qualquer lógica | ✅ SEGUIU | `IngestSchema.safeParse()` é a primeira operação do handler |
| 4 | MUST NOT usar `typeof` como validação principal | ✅ SEGUIU | Nenhum `typeof` — validação inteiramente via Zod |
| 5 | MUST retornar 400 com `parsed.error.flatten()` em falha de validação | ✅ SEGUIU | `{ status: 400, jsonBody: { error: parsed.error.flatten() } }` correto |
| 6 | MUST usar pino (`logger`) para todo logging | ✅ SEGUIU | `import { logger } from "../../src/shared/logger"` + logger.warn/info/error |
| 7 | MUST NOT usar `console.*` | ✅ SEGUIU | Nenhum `console.*` no arquivo |
| 8 | MUST incluir `source_document` na resposta 200 | ✅ SEGUIU | `source_document: documentUrl` presente na `IngestResponse` |
| 9 | MUST NOT retornar resposta 200 sem `source_document` | ✅ SEGUIU | Interface `IngestResponse` tem `source_document: string` obrigatório |
| 10 | MUST implementar `callWithRetry` com exponential backoff | ✅ SEGUIU | `callWithRetry` com `Math.pow(2, attempt) * 100` implementado |
| 11 | MUST NOT chamar APIs Azure sem retry | ✅ SEGUIU | `triggerIndexing` usa `callWithRetry` |
| 12 | MUST capturar erros com try/catch e retornar 500 | ✅ SEGUIU | try/catch no handler, retorna `{ status: 500, jsonBody: ... }` |
| 13 | MUST NOT usar catch vazio | ✅ SEGUIU | Catch loga com pino e retorna 500 |
| 14 | MUST NOT expor stack trace no response | ✅ SEGUIU | Retorna apenas `"Internal server error"` genérico |
| 15 | MUST declarar tipo de retorno explícito em funções exportadas | ✅ SEGUIU | `Promise<HttpResponseInit>` declarado no handler |
| 16 | MUST NOT usar `any` | ✅ SEGUIU | Tipos Zod inferidos + interface explícita — nenhum `any` |
| 17 | `jsonBody` (v4) vs `body: JSON.stringify(...)` (v3) | ✅ SEGUIU | Usa `jsonBody` corretamente — sem `JSON.stringify` no response |
| 18 | `context.log` proibido (anti-padrão v3) | ✅ SEGUIU | `context` recebido mas não usado para logging — pino usado |
| 19 | `z.string().url()` para URL validation | ✅ SEGUIU | `documentUrl: z.string().url()` — URL format validado pelo Zod |
| 20 | `IngestResponse` interface tipada com `source_document: string` | ✅ SEGUIU | Interface declarada explicitamente |

---

## Resumo

| Status | Contagem |
|--------|----------|
| ✅ SEGUIU | 20 |
| ⚠️ PARCIAL | 0 |
| ❌ IGNOROU | 0 |

**Conformidade total: 100% das regras da skill v1 foram aplicadas.**

---

## O que a skill v1 NÃO cobriu (gap identificado para v2)

Apesar da conformidade total com as regras explícitas da skill, a geração com v1 ainda apresenta gaps que só ficam visíveis ao comparar com o baseline (`gen-sem-skill.ts`):

### Gap 1: `context.log` ainda presente (via InvocationContext não usado)
O código importa `InvocationContext` e recebe `context` como parâmetro mas não o usa — correto. Porém a skill v1 não instrui explicitamente sobre o parâmetro `context` — um agente menos atento poderia usar `context.log` sem violar a letra da regra (que diz "MUST NOT usar `console.*`", não "MUST NOT usar `context.log`").

**Ação:** v2 deve adicionar `MUST NOT usar context.log` explicitamente como anti-padrão.

### Gap 2: Schema Zod sem `.min()` em `documentUrl`
A skill v1 mostra `z.string().url()` no exemplo DO. Correto. Mas não instrui sobre `z.string().min(1)` como proteção contra string vazia antes da validação de URL. `z.string().url()` já rejeita strings vazias, então não é uma falha — mas a skill poderia ser mais clara.

### Gap 3: Sem instrução sobre `logger.warn` vs `logger.error`
A skill v1 especifica usar pino mas não distingue quando usar `warn` vs `error`. O código gerado usou `warn` para validação e `error` para exceções — correto, mas sem instrução explícita poderia variar entre gerações.

### Gap 4: `source_document` não explica o valor esperado
A skill v1 diz que `source_document` é obrigatório mas não explica o que deve conter: (a) URL do documento original, (b) ID do documento no Azure AI Search, ou (c) nome do arquivo? O código assumiu a URL — que pode não ser o padrão correto para todos os endpoints.

---

## Seções reescritas no SKILL.md v2

Com base nos gaps acima, o SKILL.md v2 adiciona:

1. **Regra explícita:** `MUST NOT usar context.log` — adicionado à lista de MUST NOT
2. **Distinção warn/error no pino:** adicionado exemplo concreto mostrando `logger.warn` para validação e `logger.error` para exceções
3. **Definição de `source_document`:** adicionado note box explicando que o valor deve ser o `doc_id` do documento indexado no Azure AI Search (ex: `"PROC-042-v2"`), não a URL do documento original — exceto no endpoint de ingestão onde a URL é o identificador
4. **Anti-padrão `context.log` adicionado** à lista de anti-padrões de LLMs
