# AGENTS.md — NovaTech Assistant

> Constitution do projeto. Todo agente de IA (Copilot, Claude Code) lê este arquivo antes de gerar qualquer artefato.
> As seções abaixo são preenchidas por papéis diferentes nos exercícios do Cenário 2.

---

## Project Overview

**Project:** NovaTech Assistant — RAG chatbot for logistics support agents to answer questions about SLA, freight, and returns.

**Domain:** The assistant indexes internal NovaTech documents (PROC-042, POL-001, SLA-2024), retrieves relevant chunks via Azure AI Search, and generates answers via Azure OpenAI GPT-4o. All responses MUST cite the source document (`source_document` field).

**Users:** Internal NovaTech support agents (via Microsoft Teams). NOT external customers. Responses MUST be in formal Brazilian Portuguese.

**Critical business rule:** The assistant MUST NEVER invent values, deadlines, or procedures not present in the retrieved chunks. If no chunk supports an answer, the assistant MUST decline and say so explicitly.

**Contradictory documents:** The corpus contains conflicting document versions (e.g., PROC-042 v1 vs v2). Per ADR-0003, only chunks with `status = vigente` are retrieved by default. The assistant MUST NOT synthesize values from two different document versions in the same response.

**Required response interface** — every successful endpoint response MUST conform to:

```typescript
interface NovaTechResponse {
  answer: string;
  source_document: string;   // REQUIRED — document ID from Azure AI Search (e.g. "PROC-042-v2")
  session_turn: number;      // current turn number within the session
  conflict_detected?: boolean; // true when ADR-0003 conflict detection triggered
}
// ❌ DON'T — omitting source_document is a contract violation
interface BadResponse { answer: string } // missing source_document — prohibited
```

---

## Tech Stack & Architecture

### Runtime & Language

- **Language:** TypeScript with `strict: true` (MUST NOT disable any strict flags)
- **Runtime:** Azure Functions v4 (Node.js 20 LTS)
- **API style:** HTTP triggers using `app.http()` — MUST use v4 API, NEVER the v3 function export pattern

### Services

- **LLM:** Azure OpenAI GPT-4o — `temperature: 0` (per ADR-0001). MUST implement exponential backoff retry for all Azure API calls (per ADR-0001).
- **Search:** Azure AI Search — hybrid search (semantic + keyword). MUST apply filter `status eq 'vigente'` on every retrieval call (per ADR-0003).
- **Memory:** Azure Cosmos DB for session state.
- **Logging:** pino (structured JSON). MUST NOT use `console.log`, `console.error`, or `console.warn` anywhere in `src/`.

### Context Budget (per ADR-0002)

> **Scope: applies to every function that calls `azureOpenAIClient.getChatCompletions()` or equivalent.**

Every LLM call MUST assemble the prompt in this exact order and respect these token budgets:

| Position | Part | Budget (tokens) |
|----------|------|-----------------|
| 1 | System prompt + guardrails | ~1,000 |
| 2 | Client metadata (tier, contract, SLA history) | ~200 |
| 3 | Retrieved chunks | ~2,500 (5 × 500 tokens) |
| 4 | Session history summary | ~400 |
| 5 | Current question | ~200 |
| **Total** | | **~4,300** |

MUST implement context assembly in this order in code:

```typescript
// ✅ DO — assemble context in the correct order (per ADR-0002)
function buildPromptMessages(ctx: QueryContext): ChatRequestMessage[] {
  return [
    { role: "system", content: ctx.systemPrompt },          // position 1: ~1,000 tokens
    { role: "user",   content: ctx.clientMetadata },         // position 2: ~200 tokens
    { role: "user",   content: ctx.chunks.join("\n---\n") }, // position 3: ~2,500 tokens
    { role: "user",   content: ctx.historySummary },         // position 4: ~400 tokens
    { role: "user",   content: ctx.question },               // position 5: ~200 tokens
  ];
}

// ❌ DON'T — question before chunks (violates lost-in-the-middle mitigation)
function buildWrong(ctx: QueryContext): ChatRequestMessage[] {
  return [
    { role: "system", content: ctx.systemPrompt },
    { role: "user",   content: ctx.question },   // wrong position — question must be last
    { role: "user",   content: ctx.chunks.join("\n") },
  ];
}
```

- **Session limit:** MUST NOT exceed 5 turns before triggering summarization. MUST read limit from `SESSION_MAX_TURNS` env var (default: 5, range: 3–8). MUST NOT hardcode the number `5`.
- **Multi-domain mode:** When the question spans 2+ domains (frete, sla, devolucao, carga_perigosa), MUST increase chunks to 7 (budget: ~3,500 tokens for chunks).
- **Overflow handling order:** (1) compress history → summary; (2) reduce chunks 7→5; (3) reduce chunks 5→3. MUST log any query that triggers steps 2 or 3.

### Validation

- **Input validation:** MUST use Zod schemas to validate all HTTP request bodies BEFORE any business logic runs. MUST NOT use `typeof`, `instanceof`, or manual `if` checks as the sole validation mechanism.

---

## Coding Standards (Tech Lead)

### TypeScript

- MUST enable `"strict": true` in `tsconfig.json`. MUST NOT disable individual strict flags.
- MUST NOT use `any` type. Use `unknown` and narrow with Zod or type guards.
- MUST NOT use non-null assertion (`!`) except where TypeScript cannot infer and a comment explains why.
- All exported functions MUST have explicit return type annotations.

### Azure Functions v4

MUST use v4 registration pattern:

```typescript
// ✅ DO — v4 pattern
import { app } from "@azure/functions";
app.http("functionName", {
  methods: ["POST"],
  authLevel: "function",
  route: "path",
  handler: myHandler,
});

// ❌ DON'T — v3 pattern (prohibited)
export default async function (context: Context, req: HttpRequest) { ... }
```

### Zod Validation

MUST validate input with Zod before any other logic:

```typescript
// ✅ DO — Zod first
import { z } from "zod";
const QuerySchema = z.object({
  question: z.string().min(1).max(500),
});

export async function handler(req: HttpRequest, ctx: InvocationContext) {
  const parsed = QuerySchema.safeParse(await req.json());
  if (!parsed.success) {
    return { status: 400, jsonBody: { error: parsed.error.flatten() } };
  }
  // only then: business logic with parsed.data
}

// ❌ DON'T — manual typeof check
if (typeof body.question !== "string") { ... } // insufficient — use Zod
```

### Logging

MUST use pino logger from `src/shared/logger.ts`. MUST NOT use `console.*`:

```typescript
// ✅ DO
import { logger } from "../shared/logger";
logger.info({ queryId, userId }, "query received");

// ❌ DON'T
console.log("query received"); // prohibited
console.error(error);          // prohibited
```

### Error Handling

- MUST catch errors at the handler boundary and return appropriate HTTP status codes.
- MUST NOT use empty catch blocks: `catch (e) {}` is prohibited.
- MUST log errors with pino before returning 500.
- MUST include `error.message` in the log (NEVER expose stack traces in the HTTP response body).

```typescript
// ✅ DO
} catch (error) {
  logger.error({ error, queryId }, "handler failed");
  return { status: 500, jsonBody: { error: "Internal server error" } };
}

// ❌ DON'T
} catch (e) {} // empty catch — prohibited
```

### API Response Shape

Every successful response MUST include `source_document`:

```typescript
// ✅ DO
return {
  status: 200,
  jsonBody: {
    answer: "...",
    source_document: "PROC-042-v2",  // REQUIRED — per ADR-0003
    session_turn: 3,
  },
};

// ❌ DON'T — missing source_document
return { status: 200, jsonBody: { answer: "..." } };
```

### Azure API Calls

MUST implement exponential backoff for all Azure OpenAI and Azure AI Search calls (per ADR-0001):

```typescript
// ✅ DO — retry with backoff
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

// ❌ DON'T — single call without retry
const result = await azureClient.complete(prompt); // no retry — prohibited
```

### Azure AI Search Filter

> **Scope: applies to every function that calls `searchClient.search()` or `searchClient.getDocuments()`.**

MUST apply `status eq 'vigente'` filter on every retrieval call (per ADR-0003):

```typescript
// ✅ DO — filter active on every search call
const results = await searchClient.search(query, {
  filter: "status eq 'vigente'",   // REQUIRED — per ADR-0003
  top: sessionContext.chunkCount,   // 5 (standard) or 7 (multi-domain)
  queryType: "semantic",
});

// ❌ DON'T — no filter (returns obsolete document versions)
const results = await searchClient.search(query, { top: 5 }); // missing filter — prohibited
```

### Commits

MUST follow Conventional Commits: `feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:`.
MUST NOT commit directly to `main`. MUST use feature branches: `feat/<ticket>-<slug>`.

---

## Product Rules & Guardrails (Product Specialist)
<!-- TODO (Product Specialist — Ex. 2.3) -->

---

## Testing Standards (QA)
<!-- TODO (QA — Ex. 2.1) -->

---

## Project Management Rules (Delivery Manager)
<!-- TODO (Delivery Manager — Ex. 2.3) -->

---

## Build & Deploy

### Local Development

```bash
npm install
npm run build     # tsc --noEmit (type-check only)
npm run lint      # eslint src/ --max-warnings 0
npm test          # vitest run
```

MUST NOT commit code that fails `npm run build`, `npm run lint`, or `npm test`.

### CI Pipeline (per GitHub Actions `.github/workflows/ci.yml`)

The CI pipeline MUST run in this order and fail fast:

1. `npm run lint` — zero warnings allowed (`--max-warnings 0`)
2. `npm run build` — TypeScript compilation MUST succeed
3. `npm test -- --coverage` — MUST achieve ≥ 80% line coverage
4. Security audit: `npm audit --audit-level=high` — MUST pass

MUST NOT merge a PR with a failing CI pipeline.

### Test Coverage

- MUST maintain ≥ 80% line coverage (`vitest --coverage`).
- Coverage MUST cover all Zod validation branches (valid input, invalid input, missing fields).
- Coverage MUST cover error handling paths (Azure call failure, context overflow trigger).

MUST configure coverage threshold in `vitest.config.ts`:

```typescript
// ✅ DO — enforce threshold in config (CI fails automatically below 80%)
export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      thresholds: { lines: 80, functions: 80, branches: 80 },
    },
  },
});

// ❌ DON'T — no threshold config (CI passes even at 10% coverage)
export default defineConfig({ test: { coverage: { provider: "v8" } } });
```

### Environment Variables (required in all environments)

| Variable | Description |
|----------|-------------|
| `AZURE_OPENAI_ENDPOINT` | Azure OpenAI deployment endpoint |
| `AZURE_OPENAI_KEY` | API key for Azure OpenAI |
| `AZURE_SEARCH_ENDPOINT` | Azure AI Search endpoint |
| `AZURE_SEARCH_KEY` | Azure AI Search admin key |
| `AZURE_SEARCH_INDEX` | Index name (dev: `novatech-dev`, prod: `novatech-prod`) |
| `SESSION_MAX_TURNS` | Max turns before summarization (default: 5) |

MUST NOT hardcode credentials. MUST read all secrets from environment variables or Azure Key Vault.

### Limitations Acknowledged

- Rules in this AGENTS.md may be partially ignored by AI agents in long context windows where these instructions are buried in the middle (lost-in-the-middle effect). Critical rules (Zod, pino, source_document) SHOULD be repeated in task-specific skill files.
- Context budget rules (ADR-0002) require runtime enforcement — AGENTS.md alone does not guarantee the agent will count tokens. Budget logic MUST be implemented in code.
