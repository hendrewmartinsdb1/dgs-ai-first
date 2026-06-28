# Code Review — verifySourceDocument() e AssistantResponseSchema
## Exercício 3.1 — Tech Lead · Cenário 3

---

## PARTE 1: Minha análise (independente, antes do Claude)

### Problema 1 — `console.log` em vez de pino [VIOLAÇÃO DO AGENTS.md]

**Onde:** linhas com `console.log('source_document ausente...')` e `console.log(\`source_document não reconhecido: ${sourceDocument}\`)`

**Por quê é problema:** O AGENTS.md define explicitamente "pino para logging (nunca console.log)". Em Azure Functions, `console.log` vai para stdout sem estrutura, sem nível de log, sem campos extras. Em produção, logs estruturados (JSON com timestamp, correlationId, queryId) são essenciais para rastreabilidade. `console.log` é literalmente o anti-padrão documentado.

**Correção:** importar o logger de `src/shared/logger.ts` e usar `logger.warn({...})` com contexto estruturado.

---

### Problema 2 — Schema aceita campos extras (sem `.strict()`) [BUG DE DESIGN]

**Onde:** `AssistantResponseSchema = z.object({ answer, source_document, confidence_score })`

**Por quê é problema:** sem `.strict()`, um objeto com campos extras como `{ answer: "...", source_document: "POL-001", confidence_score: 0.9, __proto__: {...} }` passaria na validação. Campos extras não declarados podem indicar que o modelo está respondendo com formato inesperado, o que é sinal de problema. Com `.strict()`, isso é detectado e rejeitado.

**Correção:** `z.object({...}).strict()`

---

### Problema 3 — Comparação case-sensitive pode causar falsos negativos [BUG DE ROBUSTEZ]

**Onde:** `VALID_DOCUMENTS.includes(sourceDocument)`

**Por quê é problema:** se o modelo retornar `"pol-001"`, `"Pol-001"`, ou `"POL-001 "` (com espaço), a verificação retornaria `isSuspect: true` mesmo sendo o documento correto. O modelo pode variar a capitalização entre respostas, especialmente em diferentes runs.

**Impacto:** falsos positivos na fila HITL (respostas corretas marcadas como suspeitas), gerando ruído que cansa os revisores humanos.

**Correção:** normalizar antes de comparar: `sourceDocument.trim().toUpperCase()` contra lista uppercase.

---

### Problema 4 — Log vaza o valor recebido sem sanitização [RISCO DE SEGURANÇA LEVE]

**Onde:** `` console.log(`source_document não reconhecido: ${sourceDocument}`) ``

**Por quê é problema:** `sourceDocument` vem do output do LLM, que pode — em casos de prompt injection ou comportamento inesperado — conter conteúdo arbitrário. Logar esse valor diretamente injeta conteúdo não sanitizado nos logs de produção. Em nível de risco: baixo para esta aplicação, mas é anti-padrão.

**Correção:** logar de forma estruturada: `logger.warn({ sourceDocument: sourceDocument.substring(0, 100) }, 'source_document_not_recognized')` — truncar para evitar log bombing.

---

### Problema 5 — `source_document` em `SAFE_DEFAULT_RESPONSE` é string vazia [BUG SILENCIOSO]

**Onde:** `SAFE_DEFAULT_RESPONSE = { ..., source_document: '', ... }`

**Por quê é problema:** `source_document` vazio (`''`) não passa na verificação de `AssistantResponseSchema` (se `.min(1)` for aplicado). Mas o `SAFE_DEFAULT_RESPONSE` é retornado exatamente quando a validação falha — ele seria subsequentemente validado e também falharia. Isso cria um loop de validação que nunca resolve.

**Correção:** o `SAFE_DEFAULT_RESPONSE` deve usar um identificador especial como `"SYSTEM"` ou omitir a validação para respostas de fallback. Alternativamente, o schema deve ter `source_document: z.string()` (sem `.min(1)`) para o output, mas a verificação de vazio é feita pelo `verifySourceDocument()`.

---

### Problema 6 — `answer: z.string()` aceita string vazia [INCOMPLETO]

**Onde:** `answer: z.string()` no schema

**Por quê é problema:** uma resposta com `answer: ""` passaria na validação do schema. Uma resposta vazia não tem valor para o atendente.

**Correção:** `answer: z.string().min(1)`, mas com cuidado para não impactar o `SAFE_DEFAULT_RESPONSE`.

---

## PARTE 2: Análise do Claude (co-reviewer)

> Abaixo a análise gerada pelo Claude quando apresentado o código e o AGENTS.md.

**Problemas identificados pelo Claude:**

1. **`console.log` em vez de pino** — concordância total. Claude mencionou adicionalmente que em Azure Functions com Application Insights, `console.log` não gera correlation com o request trace, perdendo a rastreabilidade de qual query gerou o log.

2. **Schema sem `.strict()`** — concordância total. Claude adicionou que sem `.strict()`, se o modelo começar a gerar um campo `hallucinated_source`, isso seria silenciosamente ignorado pelo schema.

3. **Comparação case-sensitive** — concordância total. Claude sugeriu normalizar com `.toLowerCase()` (em vez de `.toUpperCase()`) e manter a lista de documentos válidos em lowercase. Preferência de implementação diferente, mas solução equivalente.

4. **Problema que Claude identificou que eu NÃO havia identificado: `source_document` pode ser array** — se o modelo citar múltiplas fontes (`["POL-001", "SLA-2024"]`), o tipo `string` no schema rejeita silenciosamente ou não, dependendo da versão do Zod. A verificação atual só está preparada para string scalar. Claude sugeriu aceitar `z.union([z.string(), z.array(z.string())])` e normalizar para array interno.

5. **Problema que EU identifiquei que Claude NÃO mencionou: o `SAFE_DEFAULT_RESPONSE` com `source_document: ''`** causaria falha na validação se o schema tiver `.min(1)`. Claude não identificou esse loop lógico.

6. **`confidence_score` sem range** — Claude identificou que `z.number()` aceita valores negativos e acima de 1. Deve ser `z.number().min(0).max(1)`.

---

## PARTE 3: Comparação

| Problema | Minha análise | Claude | Quem encontrou |
|----------|--------------|--------|----------------|
| `console.log` → pino | ✅ | ✅ | Ambos |
| Schema sem `.strict()` | ✅ | ✅ | Ambos |
| Case-sensitive | ✅ | ✅ | Ambos |
| Log vaza valor (injection) | ✅ | Parcial | Eu (mais detalhado) |
| `SAFE_DEFAULT_RESPONSE` com `''` cria loop | ✅ | ❌ | Só eu |
| `source_document` pode ser array | ❌ | ✅ | Só Claude |
| `confidence_score` sem range `.min(0).max(1)` | ❌ | ✅ | Só Claude |
| `answer: z.string()` aceita vazio | ✅ | Parcial | Eu (Claude mencionou como secundário) |

**Conclusão da comparação:** as análises foram complementares. A análise própria identificou o problema do loop de validação no `SAFE_DEFAULT_RESPONSE` que o Claude perdeu — provavelmente por ser um erro de interação entre duas partes do código que o Claude analisou separadamente. O Claude identificou o caso do `source_document` como array e o range do `confidence_score`, que eu não considerei.

**Lição sobre uso de IA como co-reviewer:** o Claude é eficaz para problemas locais (um bloco de código isolado) mas pode perder interações entre componentes (o `SAFE_DEFAULT_RESPONSE` sendo retornado e depois validado). A análise humana prévia é especialmente valiosa para rastrear fluxos de dados entre funções.

---

## PARTE 4: Correções aplicadas

Ver `src/services/response-validator.ts` versão corrigida com:
- `z.object({...}).strict()`
- `confidence_score: z.number().min(0).max(1)`
- `source_document: z.string()` com verificação via `verifySourceDocument()` (não `.min(1)` no schema)
- Normalização de case + trim antes da comparação
- `logger.warn({...})` em vez de `console.log`
- `source_document: 'SYSTEM'` no `SAFE_DEFAULT_RESPONSE` para evitar loop
- Suporte a `source_document` como string ou array de strings
