# Análise v2 — Comparação v1 → v2

**Arquivo v1:** `evidence/ex2.1/gen-com-agents-v1.ts`  
**Arquivo v2:** `evidence/ex2.1/gen-com-agents-v2.ts`  
**Skill usada:** `AGENTS.md v2`

---

## Regras anteriormente IGNOROU ou PARCIAL que agora foram aplicadas

| # | Regra | v1 | v2 | O que mudou |
|---|-------|----|----|-------------|
| 1 | `NovaTechResponse` interface com `source_document: string` | PARCIAL — campo presente mas sem interface tipada | ✅ SEGUIU | v2 declara `NovaTechResponse` com `source_document: string` e `session_turn: number` como campos obrigatórios. Interface explícita torna o contrato visível no código |
| 2 | `session_turn` no response | ❌ IGNOROU em v1 | ✅ SEGUIU | v2 inclui `session_turn: 0` com comentário explicando por que é zero em endpoint stateless |
| 3 | `logger.warn` para validation failure | ❌ IGNOROU em v1 | ✅ SEGUIU | v2 adiciona `logger.warn` no branch 400, não apenas no catch |
| 4 | `comment` com `max(1000)` no Zod schema | ❌ IGNOROU em v1 | ✅ SEGUIU | v2 adiciona `.max(1000)` — v1 tinha apenas `.optional()` sem constraint de tamanho |
| 5 | Destructuring explícito de `parsed.data` | ⚠️ PARCIAL em v1 | ✅ SEGUIU | v2 usa `const { queryId, rating, comment } = parsed.data` antes do try/catch — mais legível e explicit |

---

## Regras ainda IGNORADAS em v2

| # | Regra | Motivo |
|---|-------|--------|
| 1 | Context budget (4.300 tokens, posição dos chunks) | Endpoint `/api/feedback` não chama Azure OpenAI — regra não aplicável. A melhoria de escopo do AGENTS.md v2 (marcador `> Scope:`) tornaria isso óbvio para o agente |
| 2 | Filtro `status eq 'vigente'` no Azure AI Search | Idem — feedback endpoint não faz retrieval |
| 3 | `SESSION_MAX_TURNS` env var | Idem — endpoint stateless, sem gerenciamento de sessão |
| 4 | Coverage threshold no `vitest.config.ts` | Regra de configuração — não aparece no handler gerado, apenas no arquivo de config |

**Observação:** Os itens ignorados em v2 são todos de escopo não-aplicável a este endpoint específico. Nenhuma regra aplicável foi ignorada.

---

## Lição aprendida: que tipo de instrução na skill muda o comportamento do agente?

### O que funcionou bem (regras seguidas em v1 e v2)

1. **Exemplos de código concretos (DO/DON'T):** As regras com exemplos TypeScript completos (Zod, pino, app.http, callWithRetry) foram aplicadas consistentemente em ambas as versões. O agente reproduziu os padrões quase literalmente.

2. **Regras negativas explícitas (`MUST NOT`):** "MUST NOT use `console.log`", "MUST NOT use empty catch blocks" foram aplicadas sem exceção. Proibições explícitas com exemplo de código do erro têm alta taxa de conformidade.

3. **Interface TypeScript obrigatória:** Após adicionar `NovaTechResponse` como interface explícita no AGENTS.md v2, o agente a reproduziu fielmente — tipando a resposta em vez de usar `any` ou tipo inline.

### O que o AGENTS.md v2 melhorou na geração

1. **Marcadores de escopo (`> Scope:`):** Tornaram explícito que regras LLM/Search não se aplicam a todos os endpoints — o agente não tentou mais inserir código de context budget onde não faz sentido.

2. **Destructuring obrigatório:** Mencionado indiretamente pelo exemplo de código — o agente seguiu o padrão do exemplo sem instrução explícita.

3. **`logger.warn` no branch de validação:** O exemplo de código v2 mostrava warn para validações e error para exceções — o agente seguiu a distinção.

### Tipos de regra que agentes tendem a ignorar mesmo com AGENTS.md

1. **Regras de configuração:** threshold de coverage no `vitest.config.ts`, `"strict": true` no `tsconfig.json` — o agente gera handlers, não configs. Essas regras precisam estar em arquivos de scaffold ou templates separados.

2. **Regras com escopo implícito:** Antes do v2, o agente não sabia que as regras de context budget só se aplicam a endpoints LLM. Escopo explícito é essencial.

3. **Regras numéricas sem exemplo de código:** "MUST NOT exceed 5 turns" foi ignorada porque não havia código demonstrando como ler `SESSION_MAX_TURNS`. Após v2 (com exemplo de `buildPromptMessages`), a regra teria mais chance de ser seguida.

4. **Regras de processo (branches, commits):** São de responsabilidade do desenvolvedor, não do gerador de código. O agente as ignora corretamente — essas regras devem estar em templates de PR ou hooks de git, não no handler.

### Conclusão

O AGENTS.md é mais eficaz quando: (a) cada regra tem um exemplo DO/DON'T em TypeScript, (b) o escopo de aplicação é explícito, e (c) proibições são absolutas (`MUST NOT`) com descrição do erro que causam. Regras descritivas sem código, sem escopo e sem consequência têm baixa taxa de adoção pelo agente.

---

## Limitação do ciclo de teste — nota de transparência

**Contexto desta execução:** O ciclo de teste (baseline → v1 → análise → v2) foi conduzido inteiramente com **Claude Code como ferramenta única**, substituindo tanto o Claude Chat quanto o GitHub Copilot, conforme definido no plano de execução (`PLANO-EXECUCAO-TECH-LEAD.md`, seção "Ferramentas nesta execução").

**Implicação para validade dos testes:** O agente que escreveu o AGENTS.md e o agente que gerou os arquivos de evidência operam no **mesmo contexto de sessão**. Isso significa que o gerador de código (simulando o Copilot) tinha acesso implícito ao contexto de toda a conversa — incluindo decisões arquiteturais e ADRs discutidas antes da geração. Um GitHub Copilot real partiria de um "cold start", sem esse contexto acumulado.

**Consequência observada:** A taxa de conformidade na geração v1 (12/20 regras seguidas, todas as regras aplicáveis ao endpoint) é **potencialmente otimista**. Um Copilot real, sem o contexto da sessão, poderia ignorar mais regras — especialmente as que dependem de conhecimento do domínio NovaTech (ex: `source_document`, `SESSION_MAX_TURNS`).

**O que este ciclo valida mesmo assim:**

- O formato e a prescritividade das regras no AGENTS.md v2 são adequados para serem lidos e seguidos por um agente
- As melhorias v1→v2 (scope markers, NovaTechResponse interface, exemplos concretos) são genuínas e endereçam gaps reais de ambiguidade
- As lições aprendidas sobre tipos de regra que agentes seguem/ignoram são válidas — baseadas em comportamento real do modelo, não em hipóteses

**Recomendação para validação adicional:** Executar o mesmo teste de geração (AGENTS.md v2 → gerar POST /api/feedback) em uma **nova sessão Claude Code sem contexto acumulado**, ou com GitHub Copilot no VS Code, para medir a taxa de conformidade em condições de cold start.
