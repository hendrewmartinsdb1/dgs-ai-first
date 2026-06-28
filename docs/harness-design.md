# Harness Design — NovaTech Assistant
## Tech Lead · Cenário 3 · Fase de Governança

> **Contexto:** O assistente está em staging com 12% de respostas incorretas em testes internos.
> Este documento descreve o harness completo — o conjunto de camadas que transforma o protótipo
> em sistema de produção confiável.

---

## O que é o harness

O harness não é uma funcionalidade. É o sistema de contenção que envolve o modelo de linguagem e impede que seus comportamentos probabilísticos se tornem falhas de produção. Cada camada resolve uma classe diferente de problema:

| Camada | Problema que resolve |
|--------|---------------------|
| Tool Orchestration | Coordenação falha → respostas sem base documental |
| Verification Loops | Alucinações passam despercebidas → atendente transmite informação errada |
| Context & Memory | Context rot em sessões longas → respostas inconsistentes com o início da sessão |
| Guardrails | Comportamento perigoso não bloqueado → resposta incorreta sobre carga perigosa chega ao cliente |
| Observability | Problemas em produção não são detectados → degradação silenciosa |

---

## Camada 1: Tool Orchestration

**Definição:** Coordenação entre os componentes do pipeline — ingestão, retrieval, montagem de prompt e geração — de forma que falha em qualquer componente resulte em comportamento seguro, não em resposta inventada.

### O que já está implementado

- Pipeline de ingestão: 847 documentos indexados no Azure AI Search (ADR-0004).
- Filtro de vigência no retrieval: `status eq 'vigente'` ativo por padrão — documentos obsoletos (PROC-042 v1) excluídos automaticamente (ADR-0003).
- Query endpoint funcional: `POST /api/query` recebe pergunta, busca chunks, retorna resposta.
- Conector SharePoint via Azure AI Search: re-ingestão automática quando documento é atualizado.

### O que falta

- **Tratamento de falha do retrieval:** se o Azure AI Search retornar 0 chunks (índice vazio, erro de rede, timeout), o fluxo atual não tem comportamento definido. O risco é que o LLM gere resposta sem base documental — alucinação garantida.
- **Timeout e retry na orquestração LangChain:** retry está implementado para chamadas ao Azure OpenAI (ADR-0001), mas não para o Azure AI Search.
- **Modo degradado:** sem documentação de o que o sistema faz quando o retrieval falha parcialmente (score de similaridade baixo, 0 chunks de domínio específico).

### Como fechar o gap

```typescript
// Em src/services/search.ts — adicionar verificação pré-geração
if (chunks.length === 0) {
  logger.warn({ query }, 'retrieval_empty: nenhum chunk recuperado');
  return SAFE_DEFAULT_RESPONSE; // nunca chamar o LLM sem chunks
}

// Threshold de qualidade: score médio abaixo de 0.7 → logar para análise
const avgScore = chunks.reduce((s, c) => s + c.score, 0) / chunks.length;
if (avgScore < 0.7) {
  logger.warn({ query, avgScore }, 'retrieval_low_confidence');
}
```

---

## Camada 2: Verification Loops

**Definição:** Verificações determinísticas aplicadas ao output do modelo antes de entregá-lo ao atendente. Complementam o que o prompt faz probabilisticamente com garantias que o código faz deterministicamente.

### O que já está implementado

- Nenhuma verificação determinística de output existe atualmente. As respostas são retornadas como texto livre diretamente do LLM.

### O que falta

- **Verificação de fonte:** checar se `source_document` está na lista de documentos válidos da NovaTech. Um documento citado que não existe na base é sinal de alucinação ou erro no retrieval.
- **Validação de schema:** garantir que os campos obrigatórios (`answer`, `source_document`, `confidence_score`) estão presentes. Atualmente, quando o modelo "esquece" a fonte, nada impede a resposta de seguir.
- **Verificação de conteúdo proibido:** para temas de alto risco (carga perigosa + devolução), verificação determinística de que a resposta contém a negativa correta.

### Como fechar o gap

A função `verifySourceDocument()` implementada em `src/services/response-validator.ts` cobre o primeiro item. O schema Zod (camada 4) cobre o segundo.

```
Fluxo de verificação (order matters):
  1. Validar schema Zod → se falhar → rejeitar, retornar resposta padrão
  2. verifySourceDocument() → se isSuspect → marcar, não bloquear (mas logar)
  3. Verificação de guardrails de conteúdo → se falhar → bloquear, fila HITL
```

**Limite importante:** a verificação de fonte é necessária mas não suficiente. `FAQ-Atendimento` está na lista de documentos válidos (está indexado), mas usar esse documento informal para responder sobre carga perigosa é inadequado — isso é uma decisão de camada 4 (guardrails), não de camada 2. A camada 2 garante que a citação existe; a camada 4 garante que é adequada para o contexto.

### Documentos válidos da NovaTech

```typescript
const VALID_DOCUMENTS = ['POL-001', 'PROC-042', 'PROC-042-v2', 'SLA-2024', 'FAQ-Atendimento'] as const;
```

---

## Camada 3: Context & Memory

**Definição:** Manutenção de contexto entre turnos de uma sessão, garantindo consistência das respostas ao longo da conversa sem que a qualidade se degrade por saturação do contexto.

### O que já está implementado

- Bot do Teams com gerenciamento básico de sessão.
- Azure AI Search com metadados de versão (ADR-0003) — retrieval já filtra por vigência.

### O que falta (per ADR-0002)

O context budget definido na ADR-0002 precisa ser implementado e enforçado. Os números são:

```
Anatomia de contexto obrigatória (~4.300 tokens total):
  Posição 1 — System prompt + guardrails:  ~1.000 tokens  (início = maior atenção)
  Posição 2 — Metadados do cliente:         ~200 tokens
  Posição 3 — Chunks recuperados:          ~2.500 tokens  (5 × 500 tokens, logo após system prompt)
  Posição 4 — Sumário de histórico:          ~400 tokens  (comprimido, não histórico bruto)
  Posição 5 — Pergunta atual:               ~200 tokens  (fim = segunda zona de maior atenção)
```

- **Limite de sessão:** `SESSION_MAX_TURNS = 5` — após 5 turnos, o histórico bruto deve ser substituído por sumário estruturado. Não está implementado.
- **Sumarização estruturada:** o sumário do histórico deve preservar: restrições identificadas ("carga perigosa — não elegível para devolução"), informações do cliente confirmadas, ações já tomadas, perguntas não respondidas. Sumário genérico é insuficiente.
- **Modo multi-domínio:** quando a pergunta contém termos de 2+ domínios simultaneamente, expandir para 7 chunks (~3.500 tokens). Detecção por termos-chave dos domínios mapeados (frete, sla, devolucao, carga_perigosa).
- **Overflow handling:** se o budget for excedido, a sequência de compressão é: (1) comprimir histórico em sumário, (2) reduzir de 7 para 5 chunks, (3) reduzir de 5 para 3 chunks. Nunca comprimir system prompt ou pergunta atual.

### Como fechar o gap

```typescript
// Em src/services/prompt-builder.ts — enforçar a ordem de posicionamento
// CRÍTICO: chunks ANTES do histórico (anti-lost-in-the-middle)
const context = [
  systemPrompt,         // posição 1 — início
  clientMetadata,       // posição 2
  chunks,               // posição 3 — logo após system prompt
  sessionSummary,       // posição 4 — comprimido
  currentQuestion,      // posição 5 — fim
].join('\n\n');

// Variável de ambiente SESSION_MAX_TURNS = 5
// Logar toda query que acionar overflow (passos 2 ou 3 de compressão)
```

**Conexão com ADR-0002:** este harness não reinventa a estratégia de contexto. Implementa o que foi decidido. Qualquer alteração nos números (budget, número de turnos, modo multi-domínio) deve atualizar a ADR-0002 primeiro.

---

## Camada 4: Guardrails

**Definição:** Limites que o sistema não pode ultrapassar. Divididos em dois tipos por natureza:
- **Determinísticos (código):** garantem comportamento independente do que o modelo gerou. São verificações programáticas.
- **Probabilísticos (prompt):** instruções no system prompt que aumentam a probabilidade de comportamento correto, mas não garantem.

### O que já está implementado

- Guardrails probabilísticos no system prompt (instruções de tom, escopo, citação de fonte). Sem versão ou changelog.
- Nenhum guardrail determinístico implementado.

### O que falta

**Guardrails determinísticos a implementar:**

**1. Structured output (schema Zod):**
```typescript
// Em src/services/response-validator.ts
const AssistantResponseSchema = z.object({
  answer: z.string().min(1),
  source_document: z.string().min(1),   // campo obrigatório — nunca vazio
  confidence_score: z.number().min(0).max(1),
}).strict(); // .strict() rejeita campos extras não declarados
```
Qualquer resposta que não passe na validação Zod é rejeitada antes de qualquer outra verificação e substituída por mensagem padrão segura.

**2. Guardrail de carga perigosa + devolução:**
```typescript
// Verificação determinística de conteúdo
const isDangerous = /carga\s*perigosa|classe\s*[1-6]|ANTT/i.test(answer);
const claimsReturn = /pode\s*(ser\s*)?devolvid|é\s*possível\s*devolver|autorizado\s*devolver/i.test(answer);
if (isDangerous && claimsReturn) {
  // BLOQUEAR — nunca entregar ao atendente
  return BLOCKED_RESPONSE;
}
```

**Ponto de HITL (Human-in-the-Loop):**

```
Ponto de HITL: Resposta de baixa confiança sobre carga perigosa
  Trigger:      confidence_score < 0.5 AND answer contém keywords de carga perigosa
                (carga perigosa, ANTT, classe [1-6], perigosa)
  Ação:         Resposta NÃO é entregue ao atendente.
                Enfileirada em POST /api/review-queue com payload completo (pergunta + resposta + chunks usados)
  Responsável:  Supervisor de turno via painel web (src/web)
  SLA do HITL:  15 minutos durante horário comercial (08h–18h)
  Fallback:     Se 15min transcorrer sem revisão → resposta padrão:
                "Esta questão requer verificação do supervisor. Aguarde ou contate o ramal 4500."
  Log:          Toda ativação do HITL é logada com timestamp, motivo e revisor
```

**Distinção fundamental:**
- O prompt diz "sempre cite a fonte" → o modelo segue isso ~90% das vezes (probabilístico).
- O schema Zod exige `source_document` não vazio → 100% das respostas sem fonte são rejeitadas (determinístico).
- O prompt diz "não afirme que carga perigosa pode ser devolvida" → falha em alguns edge cases.
- O regex de carga perigosa + devolução → bloqueia 100% dos casos detectáveis (determinístico, com coverage conhecida).

### Como fechar o gap

1. Implementar `AssistantResponseSchema` com Zod `.strict()`.
2. Implementar verificação de carga perigosa + devolução em `src/services/response-validator.ts`.
3. Criar endpoint `/api/review-queue` para fila de HITL.
4. Criar `prompts/prompt-changelog.md` — registrar toda mudança no system prompt com data, autor, motivo e resultado esperado.

---

## Camada 5: Observability

**Definição:** Visibilidade do que acontece em produção. Sem observabilidade, degradação é silenciosa.

### O que já está implementado

- Logger pino configurado em `src/shared/logger.ts`.
- Nenhuma métrica de qualidade de resposta.
- Nenhum alerta configurado.
- Nenhum dashboard de monitoramento.

### O que falta

**Métricas a coletar:**

| Categoria | Métrica | Onde logar |
|-----------|---------|-----------|
| Uso | Queries por hora/dia | query handler |
| Uso | Tempo de resposta end-to-end (p50, p95, p99) | middleware de timing |
| Qualidade | % de respostas com confidence_score < 0.5 | response-validator |
| Qualidade | % de ativações do HITL | review-queue handler |
| Qualidade | % de respostas bloqueadas por guardrails determinísticos | response-validator |
| Técnica | Latência Azure AI Search (retrieval) | search.ts |
| Técnica | Latência Azure OpenAI (geração) | completion.ts |
| Técnica | Taxa de erro por componente | todos os services |
| Conteúdo | Score médio de similaridade dos chunks recuperados | search.ts |
| Conteúdo | Documentos mais citados nas respostas | response-validator |
| Conteúdo | Queries sem nenhum chunk recuperado (retrieval vazio) | search.ts |

**Alertas com thresholds concretos:**

```
ALERTA 1 — Qualidade degradando
  Condição:    % respostas com confidence_score < 0.5 > 20% em janela de 1h
  Severidade:  Alta
  Ação:        Notificar Tech Lead + Product Specialist via Teams
  Motivo:      Pode indicar mudança de comportamento do modelo ou degradação do índice

ALERTA 2 — Guardrail ativado com frequência anormal
  Condição:    > 5 ativações do guardrail de carga perigosa + devolução em 1h
  Severidade:  Crítica
  Ação:        Notificar Tech Lead + escalada imediata
  Motivo:      Pode indicar que o prompt foi alterado inadvertidamente ou que o modelo mudou

ALERTA 3 — Retrieval degradado
  Condição:    Score médio de similaridade < 0.65 em janela de 30min
  Severidade:  Média
  Ação:        Notificar Tech Lead
  Motivo:      Indica que perguntas não estão sendo bem cobertas pelo índice — possível desatualização

ALERTA 4 — Latência alta
  Condição:    p95 > 10s por mais de 5 minutos consecutivos
  Severidade:  Alta
  Ação:        Notificar time de infraestrutura
```

**Logs estruturados obrigatórios por evento:**

```typescript
// Todo request ao query endpoint
logger.info({
  queryId,
  question,        // sem PII — apenas o texto da pergunta
  chunksCount,
  avgSimilarityScore,
  sourceDocument,
  confidenceScore,
  durationMs,
  guardraiFired: boolean,
  hitlActivated: boolean,
}, 'query_completed');
```

### Como fechar o gap

- Adicionar middleware de timing em `src/functions/query/handler.ts`.
- Adicionar métricas estruturadas nos logs de cada service.
- Configurar Application Insights (Azure) ou equivalente para dashboards e alertas.
- Criar runbook em `docs/runbooks/degradation-response.md` — o que fazer quando cada alerta dispara.

---

## Resumo Executivo — Estado atual vs. go-live

| Camada | Estado atual | Bloqueante para go-live? | Prazo estimado |
|--------|-------------|--------------------------|---------------|
| Tool Orchestration | Funcional, sem tratamento de falha no retrieval | Sim — retrieval vazio pode causar alucinação | 2 dias |
| Verification Loops | Não existe | Sim — respostas passam sem verificação determinística | 3 dias |
| Context & Memory | Parcial — retrieval funcional, budget não enforçado | Não para demo, Sim para produção sustentada | 1 semana |
| Guardrails | Apenas probabilísticos (prompt) | Sim — sem structured output, campos críticos podem estar ausentes | 3 dias |
| Observability | Logger pino apenas | Não para demo, Sim para go-live real | 1 semana |

**Recomendação para demo em 2 semanas:** priorizar Verification Loops + Guardrails determinísticos (structured output + guardrail de carga perigosa). Context budget e Observability completos podem seguir para a primeira semana pós-go-live com monitoring manual.
