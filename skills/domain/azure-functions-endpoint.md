# Skill: azure-functions-endpoint

**Nível:** Domain
**Dependências:** skills/foundation/typescript-conventions.md, skills/foundation/error-handling.md

---

## Quando usar (frase-ativação)

Aplicar esta skill sempre que a tarefa envolver uma das frases ou contextos abaixo:

- "crie uma Azure Function", "gere um endpoint HTTP", "implemente um handler"
- "POST /api/...", "HTTP trigger em TypeScript"
- Qualquer geração de código em `src/functions/`

---

## Contexto

Um endpoint neste projeto é uma **Azure Function HTTP trigger v4** que:

1. Recebe uma requisição HTTP POST com corpo JSON
2. Valida o corpo com **Zod** antes de qualquer lógica
3. Executa lógica de negócio (chamadas a Azure OpenAI, Azure AI Search ou Cosmos DB)
4. Retorna JSON com os campos obrigatórios **incluindo `source_document`**
5. Loga com **pino** e NUNCA usa `console.*`

O projeto usa Azure Functions **v4** (não v3). A diferença principal é o padrão de registro: `app.http()` em vez de `export default function`.

---

## Regras Prescritivas

- **MUST** usar `app.http()` para registrar a função (padrão v4). **MUST NOT** usar `export default async function` (padrão v3 — proibido).
- **MUST** validar o corpo da requisição com Zod **antes** de qualquer lógica de negócio. **MUST NOT** usar `typeof`, `instanceof` ou `if (body.field)` como validação principal.
- **MUST** retornar `{ status: 400, jsonBody: { error: parsed.error.flatten() } }` quando validação falhar.
- **MUST** usar `pino` (`import { logger } from "../shared/logger"`) para todo logging. **MUST NOT** usar `console.log`, `console.error`, `console.warn`, `console.info` ou **`context.log`** em nenhum arquivo de `src/`. (`context.log` é o padrão v3 — proibido no v4.)
- **MUST** usar `logger.warn` para falhas de validação (entrada inválida do cliente) e `logger.error` para exceções de sistema (falhas de Azure, erros inesperados).
- **MUST** incluir o campo `source_document: string` em toda resposta de sucesso (200). **MUST NOT** retornar resposta sem `source_document`.
  > **Valor de `source_document`:** usar o `doc_id` do documento indexado no Azure AI Search (ex: `"PROC-042-v2"`, `"SLA-2024"`, `"POL-001"`). Em endpoints de ingestão, usar a URL do documento como identificador até o `doc_id` do índice ser confirmado.
- **MUST** implementar `callWithRetry` com exponential backoff para todas as chamadas a Azure OpenAI e Azure AI Search (per ADR-0001). **MUST NOT** chamar APIs Azure sem retry.
- **MUST** capturar erros no handler com `try/catch`, logar com pino e retornar HTTP 500 com mensagem genérica. **MUST NOT** usar catch vazio (`catch (e) {}`).
- **MUST NOT** expor stack traces ou `error.stack` no corpo da resposta HTTP.
- **MUST** declarar tipos de retorno explícitos em todas as funções exportadas (`Promise<HttpResponseInit>`).
- **MUST NOT** usar `any` como tipo. Usar `unknown` com narrowing via Zod ou type guards.

---

## Exemplos de Código

### ✅ DO — Endpoint correto

```typescript
import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { z } from "zod";
import { logger } from "../shared/logger";

const IngestSchema = z.object({
  documentUrl: z.string().url(),
  documentType: z.enum(["pdf", "docx"]),
});

// Required response shape — per AGENTS.md Project Overview
interface IngestResponse {
  success: boolean;
  jobId: string;
  source_document: string;  // REQUIRED
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callWithRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === maxRetries) throw error;
      await sleep(Math.pow(2, attempt) * 100);
    }
  }
  throw new Error("unreachable");
}

export async function ingestHandler(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  // 1. Validate FIRST — Zod before any logic (logger.warn = client error, not system failure)
  const parsed = IngestSchema.safeParse(await request.json());
  if (!parsed.success) {
    logger.warn({ errors: parsed.error.flatten() }, "ingest validation failed");
    return { status: 400, jsonBody: { error: parsed.error.flatten() } };
  }

  const { documentUrl, documentType } = parsed.data;

  try {
    // 2. Business logic — wrapped in retry for Azure calls
    const jobId = await callWithRetry(async () => {
      // TODO: call Azure AI Search indexing API
      return `job-${Date.now()}`;
    });

    logger.info({ jobId, documentUrl, documentType }, "document ingested");

    const response: IngestResponse = {
      success: true,
      jobId,
      source_document: documentUrl,  // REQUIRED
    };

    return { status: 200, jsonBody: response };
  } catch (error) {
    // 3. Error: log with pino, return generic 500
    logger.error({ error, documentUrl }, "ingest handler failed");
    return { status: 500, jsonBody: { error: "Internal server error" } };
  }
}

// 4. v4 registration pattern — MUST use app.http()
app.http("ingest", {
  methods: ["POST"],
  authLevel: "function",
  route: "ingest",
  handler: ingestHandler,
});
```

### ❌ DON'T — Padrões proibidos

```typescript
// ❌ v3 export pattern — proibido
export default async function (context: Context, req: HttpRequest) { ... }

// ❌ typeof para validação — insuficiente (não cobre null, número como string, etc.)
if (typeof body.documentUrl !== "string") { return error; }

// ❌ console.log — proibido em src/
console.log("Processing:", documentUrl);
console.error("Error:", error);

// ❌ catch vazio — silencia erros, impossível debugar em produção
try {
  await indexDocument(url);
} catch (e) {}

// ❌ resposta sem source_document — contrato violado
return { status: 200, jsonBody: { success: true, jobId: "abc" } };

// ❌ chamada Azure sem retry — falha em throttling (rate limit do Azure OpenAI)
const result = await searchClient.search(query);

// ❌ stack trace no response — expõe detalhes internos
return { status: 500, jsonBody: { error: error.stack } };

// ❌ body sem tipo (any implícito)
const body = await request.json(); // tipo: any — proibido
```

---

## Anti-padrões Comuns (gerados por LLMs sem guidance)

LLMs tendem a gerar os seguintes erros quando não têm esta skill como contexto:

1. **`context.log(...)` em vez de pino** — LLMs conhecem o padrão v3 de Azure Functions onde `context.log` era o método oficial. No v4, DEVE usar pino. O parâmetro `context: InvocationContext` ainda existe para compatibilidade mas **MUST NOT** ser usado para logging.

   ```typescript
   // ❌ DON'T — context.log é padrão v3, proibido no v4
   context.log("Processing document:", documentUrl);

   // ✅ DO — pino via shared/logger
   logger.info({ documentUrl }, "processing document");
   ```

2. **`body: JSON.stringify(...)` em vez de `jsonBody: ...`** — No v4, o campo correto do response é `jsonBody` (serialização automática). LLMs frequentemente usam `body: JSON.stringify(...)` que é o padrão v3/Express.

3. **`typeof` para validação** — LLMs geram `if (typeof body.question !== "string")` sem Zod, o que não valida min/max length, enum values, URL format, etc.

4. **Catch vazio ou `catch (e) { console.error(e) }`** — LLMs geram `try { ... } catch (e) {}` vazio ou com `console.error` sem estrutura. Ambos são proibidos: o primeiro silencia erros, o segundo usa console em vez de pino.

5. **`source_document` ausente** — LLMs geram a resposta sem o campo `source_document` porque não têm contexto do domínio RAG. Este campo é obrigatório para rastreabilidade (per ADR-0003).

6. **Sem exponential backoff** — LLMs geram `await azureClient.complete(prompt)` sem retry, que falha silenciosamente em throttling.

7. **`export default function` (v3 pattern)** — LLMs treinados com exemplos antigos usam o padrão v3. No v4, o registro é feito via `app.http()`.

---

## Critérios de Maturidade

Esta skill está pronta para uso pelo time quando:

1. **Testada em 3+ gerações independentes** — o agente gerou endpoints corretos (sem violações críticas) em pelo menos 3 tarefas distintas usando esta skill como contexto.
2. **Nenhuma regra crítica ignorada** — as regras marcadas com MUST (Zod, pino, `source_document`, `app.http()`, retry) foram aplicadas em 100% das gerações monitoradas.
3. **Revisada por pelo menos 1 dev além do autor** — um segundo desenvolvedor leu a skill, gerou um endpoint com ela, e confirmou que os exemplos de código compilam e seguem os padrões do projeto.
4. **Consistente com AGENTS.md v2** — todas as regras desta skill referem às mesmas convenções do `AGENTS.md v2` (sem contradições). Se o AGENTS.md for atualizado, esta skill DEVE ser revisada.
5. **Anti-padrões validados em produção** — pelo menos 2 dos anti-padrões listados foram observados em gerações reais (não hipotéticas) antes da skill ser escrita, confirmando que a guidance é necessária.
