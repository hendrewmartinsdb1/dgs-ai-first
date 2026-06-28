# Priorização — 2 semanas até o go-live
## Exercício 3.2 · Cenário 3

> **Premissa:** com demo para a diretoria em 2 semanas, não é possível verificar tudo.
> A priorização abaixo é baseada em: impacto no comportamento do assistente em produção
> (não apenas na qualidade do código) × esforço de verificação × risco de detectar
> o problema tarde demais.

---

## Semana 1 — Verificações bloqueantes (sem isso não vai ao ar)

| Artefato | Verificação específica | Responsável | Critério de aprovação |
|----------|----------------------|-------------|----------------------|
| **Skills não testadas** | Para cada uma das 2 skills sem refinamento: gerar código com a skill, fazer análise seguiu/ignorou/parcial, documentar resultado | Dev + Tech Lead | 100% das regras críticas (Zod, pino, sem `as any`) foram seguidas OR a skill foi corrigida e retestada |
| **Pipeline — metadados de vigência** | Teste de integração: indexar documento sem campo `status`, verificar que o filtro `status eq 'vigente'` o exclui do retrieval | Dev | Documento sem `status` não aparece em nenhuma query ao índice |
| **System prompt — golden queries** | Criar 10 pares pergunta/resposta esperada cobrindo: carga perigosa (não devolver), SLA por tier (Gold/Silver/Standard), frete com PROC-042-v2, pergunta fora do escopo, documento não encontrado | Tech Lead + Product Specialist | A v6 atual responde corretamente em ≥ 9 de 10 golden queries |
| **Pipeline — conformidade AGENTS.md em funções críticas** | Auditoria manual de `query/handler.ts`, `query/validator.ts`, `feedback/handler.ts`: sem `as any`, sem `console.log`, Zod presente, sem `require` dinâmico | Dev | 0 violações do AGENTS.md nas funções críticas |

---

## Semana 2 — Verificações de alta prioridade (vai ao ar com risco controlado)

| Artefato | Verificação específica | Responsável | Risco residual aceito |
|----------|----------------------|-------------|----------------------|
| **System prompt — changelog retroativo** | Documentar em `prompts/prompt-changelog.md`: diferenças entre v5 e v6 (pelo menos), e o comportamento esperado da v6 | Tech Lead | Se não concluído: qualquer mudança futura no prompt é um salto no escuro. Aceitável para a demo, não para sustentação. |
| **AGENTS.md — posicionamento das regras críticas** | Mapear em qual página estão as regras de Zod, pino, sem `console.log`, sem `as any`. Se > página 5: mover para o topo | Tech Lead | Regras críticas nas primeiras 3 páginas ou risco documentado |
| **Pipeline — configurações hardcoded** | Grep em `src/` por strings que parecem endpoints, nomes de índice, ou deployment names fora de `src/shared/config.ts` | Dev | 0 strings de configuração hardcoded em código de produção |
| **AGENTS.md — consistência interna** | Revisão das seções: verificar se alguma regra da v1/v2 contradiz regras da v4. Focar em tratamento de erro (try/catch) e validação de input | Tech Lead | 0 contradições identificadas nas seções de Coding Standards |

---

## O que aceito como risco residual (com justificativa)

**1. Funções não-críticas do pipeline (extractor.ts, chunker.ts, embedder.ts)**
Auditoria completa de todo o código Copilot tomaria mais de 2 semanas. As funções
do pipeline de ingestão têm menor risco de produzir comportamento incorreto em runtime
(elas executam offline, não em tempo real) e podem ser auditadas nas primeiras semanas
pós-go-live.

*Mitigação: logar metadados de cada ingestão. Se chunks chegarem sem `status`, o log
vai mostrar imediatamente.*

**2. Changelog retroativo das versões v1–v4 do system prompt**
Reconstruir o histórico das iterações v1 a v4 tem custo alto e valor decrescente.
O que importa é: (a) o baseline da v6 atual via golden queries (semana 1), e (b) o
registro da diferença v5→v6 para o próximo rollback (semana 2). As versões anteriores
são história, não critério de go-live.

**3. AGENTS.md — seções de papéis que ainda têm TODO**
Seções de outros papéis (ex: Delivery Manager, QA) que não foram preenchidas são
risco de desenvolvimento futuro, não de produção do assistente. Aceitável como risco
residual para a demo.

**4. Auditoria de segurança aprofundada do bot do Teams**
O bot está em staging com 5 atendentes-piloto. Uma auditoria completa de segurança
(injeção de prompt via Teams, autenticação, rate limiting) está além do escopo das
2 semanas. Risco residual aceito para a demo; programar para o mês 1 pós-go-live.

---

## Ordem de execução recomendada (dias)

```
Dia 1–2:  Skills sem refinamento → gerar + analisar + corrigir
Dia 3:    Pipeline: teste de metadados de vigência
Dia 4–5:  Golden queries do system prompt (10 pares) + execução na v6
Dia 6:    Auditoria AGENTS.md em funções críticas (3 arquivos)
Dia 7:    Buffer (correções das verificações anteriores)
---
Dia 8–9:  Changelog retroativo do system prompt (v5→v6)
Dia 10:   Posicionamento das regras no AGENTS.md
Dia 11:   Grep por configurações hardcoded
Dia 12:   Revisão de consistência interna do AGENTS.md
Dia 13–14: Buffer + preparação da demo
```

**Critério de go-live:** todas as verificações da Semana 1 aprovadas.
As da Semana 2 podem ser concluídas nas primeiras 2 semanas de produção
com monitoramento intensivo (alertas de qualidade ativados, revisão diária de logs).
