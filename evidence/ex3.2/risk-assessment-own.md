# Avaliação de Riscos — Tech Lead (análise própria, sem Claude)
## Exercício 3.2 · Cenário 3 · Revisão crítica da arquitetura gerada com IA

> **Protocolo:** Esta análise foi feita antes de qualquer consulta ao Claude.
> Os riscos abaixo representam meu julgamento independente como Tech Lead.
> Data: 2026-06-28

---

## Artefato 1: AGENTS.md (15 páginas, 4 iterações de refinamento)

**Risco principal:** Documentos longos sofrem de lost-in-the-middle para agentes de IA.
Regras nas páginas 10–15 têm sistematicamente menos chance de serem seguidas do que
regras na página 1. Um AGENTS.md de 15 páginas provavelmente tem seções críticas
enterradas no meio — exatamente onde a atenção do agente é mais fraca.

**Risco secundário:** 4 iterações de refinamento sem controle de qualidade das versões
intermediárias. Não sabemos se v4 (15 páginas) é melhor que v2 (provavelmente menor)
em termos de conformidade do agente. Mais texto não é mais contexto efetivo.

**O que verificar antes do go-live:**
- Mapear onde estão as regras MAIS CRÍTICAS (Zod obrigatório, pino, sem console.log,
  sem require dinâmico, sem `as any`). Se estiverem nas páginas 8–15, mover para o topo.
- Executar pelo menos 1 geração de código com o AGENTS.md atual e verificar se as
  regras das páginas 10–15 foram seguidas. Se não: reestruturar, não aumentar o texto.
- Verificar se as seções de outros papéis (TODO) não foram sobrescritas nas iterações.

**Nível de risco:** Médio-Alto.
*Não é bloqueante para a demo (o assistente não usa o AGENTS.md em runtime),
mas é bloqueante para a segurança do desenvolvimento — se o Copilot gerar código
que viola o AGENTS.md, o próximo módulo terá os mesmos problemas do feedback-handler.*

---

## Artefato 2: Skills (Foundation testada; 2 skills sem refinamento)

**Risco principal:** Skills sem refinamento são hipóteses, não ferramentas validadas.
Uma skill que nunca foi testada em geração real não tem evidência de que o agente
a segue. No cenário 2, ficou demonstrado que mesmo com AGENTS.md, os agentes
ignoram regras. Uma skill sem teste pós-geração tem probabilidade alta de gerar
outputs inconsistentes — o desenvolvedor que usar a skill sem saber que ela não foi
testada terá falsa confiança.

**O que verificar antes do go-live:**
- Identificar as 2 skills sem refinamento (domain e/ou artifact nível).
- Para cada uma: gerar código usando a skill + AGENTS.md, fazer análise
  seguiu/ignorou/parcial, documentar no diretório de evidências.
- Se alguma regra crítica (Zod, pino, source_document) foi ignorada: corrigir a skill
  antes de qualquer uso em produção.

**Nível de risco:** Alto.
*Bloqueante — desenvolvedores podem usar as skills não testadas no período pós-go-live.
Um módulo gerado com skill incorreta pode introduzir bugs de segurança (dados pessoais
logados, como vimos no feedback-handler). Custo de testar: 1–2 horas por skill.*

---

## Artefato 3: Pipeline de ingestão + query endpoint (60-70% Copilot)

**Risco principal:** A fronteira entre código Copilot e código manual é invisível
no arquivo final. Sem anotação de quais trechos foram gerados, o code review
manual inevitavelmente dá mais atenção ao "código que parece escrito à mão" e menos
ao "código que parece correto". O Copilot gera código que parece correto mas pode
violar o AGENTS.md de formas sutis (ver feedback-handler: `console.log`, `as any`,
`require` dinâmico).

**Risco secundário:** 60-70% de código gerado × 847 documentos × pipeline crítico =
alto volume de código para auditar. Se o pipeline indexar documentos com metadados
incorretos (ex: `status` ausente), o filtro `status eq 'vigente'` da ADR-0003
falhará silenciosamente — chunks obsoletos entrarão no contexto e causarão respostas
incorretas com fonte "válida".

**O que verificar antes do go-live:**
1. Auditoria de conformidade AGENTS.md nas funções críticas: `query/handler.ts`,
   `query/validator.ts`, `feedback/handler.ts`. Verificar: sem `as any`, sem `console.log`,
   Zod presente, sem `require` dinâmico.
2. Verificar que o script de ingestão adiciona o metadado `status` em TODOS os chunks.
   Testar: indexar um documento de teste sem `status` e verificar se o filtro o exclui.
3. Verificar que o `confidence_score` gerado pelo modelo é realmente transmitido no output
   e não está sendo substituído por um valor padrão silenciosamente.

**Nível de risco:** Alto.
*Bloqueante para confiabilidade. A ADR-0003 (filtro de vigência) é a proteção contra
documentos contraditórios — se o pipeline não adicionar o metadado `status`, toda
a decisão da ADR-0003 é ineficaz.*

---

## Artefato 4: System prompt (6 iterações, sem changelog)

**Risco principal (governança):** Sem changelog, é impossível fazer rollback informado.
Se a v6 (atual) degradar o comportamento — ex: as guardrails de carga perigosa
passarem a funcionar incorretamente — não há registro de o que mudou entre v5 e v6
e por que. O rollback para v5 seria "esperança", não uma decisão informada.

**Risco secundário (auditabilidade):** Um novo membro do time que precisa entender
por que o prompt tem as regras que tem não tem como reconstruir a lógica de evolução.
Regras que parecem arbitrárias (ex: "sempre responda em PT-BR mesmo se perguntado em inglês")
têm histórico que justifica sua presença — sem changelog, esse histórico se perde.

**Risco terciário (regression):** 6 versões sem testes de regressão de prompt significa
que cada mudança pode ter introduzido efeitos colaterais não detectados. A v3 pode ter
melhorado o comportamento para carga perigosa e piorado o comportamento para SLA —
sem golden queries testadas em cada versão, não sabemos.

**O que verificar antes do go-live:**
1. Criar `prompts/prompt-changelog.md` retroativamente — mesmo que parcial. Documentar
   pelo menos: v6 vs v5 (o que mudou, por quê), e o comportamento esperado atual.
2. Criar `prompts/eval/golden-queries.json` com ao menos 10 pares pergunta/resposta
   esperada cobrindo os casos críticos (carga perigosa, SLA por tier, frete com PROC-042-v2).
3. Executar as golden queries na v6 e documentar os resultados. Isso cria baseline
   para futuras mudanças.

**Nível de risco:** Médio-Alto.
*Não bloqueante para a demo se o comportamento atual estiver correto. Bloqueante para
governança de produção — sem baseline e changelog, toda mudança futura no prompt é um
salto no escuro.*

---

## Riscos que julgo mais críticos (ordem de prioridade para as 2 semanas)

1. **Skills sem refinamento** — risco imediato de código incorreto em produção.
   Custo de mitigação baixo (2h por skill). Prioridade: verificar esta semana.

2. **Pipeline de ingestão — metadados de vigência** — se o filtro da ADR-0003
   não estiver funcionando, respostas com documentos obsoletos chegam ao atendente.
   Prioridade: teste de integração antes da demo.

3. **System prompt sem changelog** — bloqueante para governança pós-go-live.
   Criar changelog retroativo + golden queries. Prioridade: semana 2.

4. **AGENTS.md — regras enterradas no documento longo** — mapeamento de posição
   das regras críticas. Prioridade: semana 2 (não afeta o assistente em runtime).
