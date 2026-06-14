# Análise v1 — Conformidade com AGENTS.md v1

**Arquivo analisado:** `evidence/ex2.1/gen-com-agents-v1.ts`  
**Baseline de comparação:** `evidence/ex2.1/gen-sem-agents.ts`

---

## Tabela de Conformidade

| # | Regra (AGENTS.md v1) | Status | Evidência no código |
|---|----------------------|--------|---------------------|
| 1 | MUST use `app.http()` v4 pattern | ✅ SEGUIU | `app.http("feedback", { methods: ["POST"], ... })` presente |
| 2 | MUST use Zod to validate input BEFORE any logic | ✅ SEGUIU | `FeedbackSchema.safeParse()` na primeira linha do handler |
| 3 | MUST NOT use `typeof` or manual checks as sole validation | ✅ SEGUIU | Nenhum `typeof` — validação inteiramente via Zod |
| 4 | MUST use pino logger (`src/shared/logger`) | ✅ SEGUIU | `import { logger } from "../../src/shared/logger"` presente |
| 5 | MUST NOT use `console.log`, `console.error` | ✅ SEGUIU | Nenhum `console.*` no arquivo |
| 6 | MUST have explicit return type on exported functions | ✅ SEGUIU | `Promise<HttpResponseInit>` declarado |
| 7 | MUST NOT use `any` type | ✅ SEGUIU | Nenhum `any` — tipos Zod e interfaces usados |
| 8 | Response MUST include `source_document` field | ✅ SEGUIU | `source_document: "internal-feedback-api"` presente |
| 9 | MUST implement exponential backoff for Azure calls | ✅ SEGUIU | `callWithRetry` com `Math.pow(2, attempt) * 100` implementado |
| 10 | MUST NOT use empty catch blocks | ✅ SEGUIU | Catch loga com pino e retorna 500 |
| 11 | MUST log error with pino before returning 500 | ✅ SEGUIU | `logger.error({ error, queryId }, "feedback handler failed")` |
| 12 | MUST NOT expose stack trace in HTTP response body | ✅ SEGUIU | Retorna apenas `"Internal server error"` genérico |
| 13 | MUST use `"strict": true` in tsconfig | ⚠️ PARCIAL | Arquivo `.ts` compilaria com strict, mas sem verificação ativa de `tsconfig.json` |
| 14 | MUST NOT use non-null assertion (`!`) | ✅ SEGUIU | Nenhum `!` no código |
| 15 | Context budget (4.300 tokens, 5 chunks × 500) | ❌ IGNOROU | Endpoint de feedback não monta prompt LLM — regra não aplicável diretamente. Porém o código não referencia `SESSION_MAX_TURNS` nem valida orçamento |
| 16 | `SESSION_MAX_TURNS` env var | ❌ IGNOROU | Não lido nem validado — feedback endpoint não precisa, mas a regra é geral |
| 17 | Filter `status eq 'vigente'` on every Azure AI Search call | ❌ IGNOROU | Endpoint de feedback não faz busca — regra não aplicável. Mas nenhuma referência ao filtro |
| 18 | Conventional Commits format | ⚠️ PARCIAL | Regra é de commit, não de código — não verificável no arquivo gerado |
| 19 | Feature branch MUST NOT commit to `main` | ⚠️ PARCIAL | Idem — não verificável no arquivo gerado |
| 20 | `temperature: 0` for Azure OpenAI | ❌ IGNOROU | Endpoint de feedback não chama LLM — não aplicável diretamente |

---

## Resumo

| Status | Contagem |
|--------|----------|
| ✅ SEGUIU | 12 |
| ⚠️ PARCIAL | 3 |
| ❌ IGNOROU | 5 |

**Ignorados aplicáveis ao contexto (feedback endpoint):**
- Regras de contexto LLM (budget, SESSION_MAX_TURNS, filtro `vigente`) são de fato específicas ao endpoint `/api/query`, não ao `/api/feedback`. O agente não violou essas regras — o endpoint gerado não as requer.
- O AGENTS.md v1 não torna claro que regras se aplicam a qual tipo de endpoint.

**Problema identificado:** O AGENTS.md v1 mistura regras **globais** (Zod, pino, v4 pattern) com regras **específicas de endpoint LLM** (context budget, filtro vigente) sem diferenciar o escopo. Isso faz com que o agente não aplique as regras LLM nem em endpoints que as requerem, e as "ignore" em endpoints onde não são aplicáveis — dificultando a análise de conformidade real.

---

## O que mudou no v2

### Mudanças aplicadas ao AGENTS.md v2:

1. **Seção Tech Stack — Context Budget:** Adicionado marcador explícito `[Aplica-se a: endpoints que chamam Azure OpenAI]` para deixar claro o escopo. Adicionado exemplo de código concreto mostrando a montagem obrigatória do contexto em ordem.

2. **Seção Coding Standards — Azure Search Filter:** Adicionado exemplo de código DO/DON'T específico para o filtro `status eq 'vigente'`, com nota de que se aplica a qualquer função que chame `searchClient.search()`.

3. **Seção Coding Standards — Error Handling:** Adicionado exemplo explícito de anti-padrão `catch (e) {}` vazio com mensagem de erro descrevendo por que é proibido (silencia erros, impossível debugar em produção).

4. **Seção Build & Deploy — Test Coverage:** Adicionado exemplo concreto do comando de cobertura mínima com threshold explícito no `vitest.config.ts`.

5. **Seção Project Overview — source_document:** Tornada mais prescritiva — adicionado o tipo TypeScript da interface de resposta obrigatória com `source_document: string` (não apenas texto descritivo).
