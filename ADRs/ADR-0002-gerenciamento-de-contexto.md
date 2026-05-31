# ADR-0002: Estratégia de Gerenciamento de Contexto

## Status: Proposto

---

## Contexto

O assistente será integrado ao Microsoft Teams. Atendentes farão múltiplas perguntas na mesma sessão para resolver um único chamado — o que significa que o contexto que o LLM recebe cresce a cada turno.

O problema não é o limite absoluto de tokens (GPT-4o tem 128K — bem acima do consumo por query). O problema é a **qualidade de atenção ao longo do contexto**:

- **Lost in the middle:** informação fornecida no meio de contextos longos recebe sistematicamente menos peso do modelo do que informação no início (system prompt) ou no fim (pergunta atual).
- **Context rot:** em sessões longas, o modelo começa a dar respostas inconsistentes com respostas corretas dadas anteriormente na mesma sessão, porque as instruções e restrições relevantes estão "enterradas" no meio do histórico.
- **Perguntas multi-domínio:** atendentes frequentemente cruzam temas na mesma sessão — SLA + frete + devolução — o que exige chunks de múltiplos documentos simultaneamente.
- **Orçamento de atenção:** com múltiplos chunks + histórico + system prompt, o modelo precisa distribuir atenção entre muitos fragmentos de informação. Mais contexto nem sempre é melhor.

**Forças em conflito:**
- Experiência do atendente (sessões longas, sem interrupção) vs. qualidade das respostas (sessões curtas e focadas).
- Cobertura de perguntas multi-domínio (mais chunks) vs. risco de lost in the middle (contexto menor e mais preciso).
- Flexibilidade de configuração vs. complexidade de manutenção.

---

## Decisão

Adotar uma **estratégia de contexto estruturado com orçamento fixo por parte**, **limite de sessão configurável** e **detecção de perguntas multi-domínio** para ajuste dinâmico do número de chunks.

### 1. Anatomia de contexto e orçamento por parte

Toda query ao LLM seguirá esta estrutura fixa, nesta ordem:

| Posição | Parte | Tipo | Orçamento (tokens) | Justificativa |
|---|---|---|---|---|
| 1 (início) | System prompt + guardrails | Estático | ~1.000 | Início do contexto = maior peso de atenção |
| 2 | Metadados do cliente (tier, contrato, histórico de violações de SLA) | Dinâmico | ~200 | Contexto operacional por query |
| 3 | Chunks recuperados | Dinâmico | ~2.500 (5 × 500) | Logo após o system prompt — ainda na zona de alta atenção |
| 4 | Sumário de histórico da sessão | Dinâmico, comprimido | ~400 | Posição intermediária — sumário, não histórico bruto |
| 5 (fim) | Pergunta atual do atendente | Dinâmico | ~200 | Final do contexto = segunda zona de maior atenção |
| **Total** | | | **~4.300** | Muito abaixo do limite de 128K |

**Margem de segurança:** o orçamento de ~4.300 tokens representa 3.4% da janela disponível, deixando ampla margem para variações e para o aumento de chunks em queries multi-domínio.

### 2. Chunks recuperados: padrão e modo multi-domínio

**Modo padrão:** 5 chunks por query (os 5 com maior score de similaridade semântica).

**Modo multi-domínio:** ativado automaticamente quando a pergunta contém termos de 2 ou mais domínios simultaneamente. Critério de detecção: presença de termos-chave de domínios distintos na mesma query.

Domínios mapeados:
- `frete`: frete, multiplicador, peso, região, carga pesada, PROC-042
- `sla`: prazo, resposta, resolução, Gold, Silver, Standard, SLA, SLA-2024
- `devolucao`: devolver, devolução, retorno, POL-001, reembolso
- `carga_perigosa`: perigosa, ANTT, classe, explosivo, inflamável, tóxico

Quando multi-domínio detectado: aumentar para **7 chunks**, garantindo ao menos 1 chunk por domínio identificado. O orçamento de chunks sobe de ~2.500 para ~3.500 tokens — ainda dentro da margem segura.

### 3. Gerenciamento de sessão e context rot

**Limite de sessão:** 5 turnos por sessão no Teams antes de acionar a summarização.

Escolha de 5 turnos justificada por:
- Acima de 5 turnos, o histórico bruto começa a ocupar posição intermediária no contexto, aumentando o risco de lost in the middle para informações do turno 1–2.
- A maioria dos chamados de atendimento ao cliente é resolvida em 3–5 interações (dado validar no discovery).
- Limite configurável por variável de ambiente (`SESSION_MAX_TURNS`), permitindo ajuste sem redeploy.

**Processo de summarização (após turno 5):**

O sumário não é uma compressão genérica do histórico. É um sumário estruturado que prioriza:
1. Restrições identificadas na sessão (ex: "carga perigosa — não elegível para devolução padrão")
2. Informações do cliente confirmadas (ex: "cliente tier Gold")
3. Ações já tomadas (ex: "chamado de coleta reversa já aberto")
4. Perguntas não respondidas ou escaladas

O sumário é gerado pelo próprio LLM com um prompt auxiliar dedicado, e substituído no slot 4 (posição intermediária) da anatomia de contexto.

### 4. Posicionamento dos chunks (anti-lost in the middle)

Os chunks são sempre posicionados **logo após o system prompt** (posição 3 na anatomia), não após o histórico. Isso coloca a informação de maior relevância factual na zona de alta atenção do modelo.

O histórico (comprimido) é posicionado **antes da pergunta atual** mas **após os chunks**, minimizando o impacto do lost in the middle no material de suporte documental.

### 5. Tratamento de context overflow

Se uma query exceder o orçamento definido (ex: system prompt muito longo + muitos chunks + histórico longo + pergunta extensa):

1. Primeiro a comprimir: histórico bruto → substituir por sumário comprimido.
2. Segundo a comprimir: reduzir chunks de 7 para 5 (modo multi-domínio → modo padrão).
3. Terceiro a comprimir: reduzir chunks de 5 para 3, priorizando os de maior score.
4. Nunca comprimir: system prompt e pergunta atual — esses são invioláveis.

O pipeline deve logar qualquer query que acione os passos 2 ou 3 para análise de qualidade.

---

## Consequências

**Positivas:**
- Respostas consistentes ao longo da sessão — o sumário estruturado garante que restrições identificadas no turno 1 permaneçam ativas no turno 10.
- Perguntas multi-domínio recebem cobertura documental adequada sem comprometer o orçamento de atenção.
- O orçamento documentado por parte permite mensurar o custo real por query e projetar custos mensais com precisão.
- Configuração por variável de ambiente facilita ajustes sem redeploy.

**Negativas:**
- A summarização adiciona uma chamada extra ao LLM a cada 5 turnos — custo e latência adicionais.
- A detecção de multi-domínio por termos-chave é frágil para perguntas ambíguas ou incomuns — pode falhar em ativar o modo correto.
- O limite de 5 turnos pode frustrar atendentes em chamados complexos, mesmo que a qualidade das respostas seja superior com histórico comprimido.
- A lógica de overflow (4 passos) adiciona complexidade ao pipeline de montagem de contexto.

---

## Alternativas consideradas

### Alternativa — Janela deslizante sem limite de sessão (usar sempre os N turnos mais recentes)
**Razão para descarte:** a janela deslizante elimina o context rot de saturação, mas não resolve o lost in the middle. Em uma janela de 10 turnos, informação do turno mais antigo da janela (posição intermediária no contexto) ainda recebe menos atenção. Além disso, a janela deslizante descarta informação potencialmente crítica fornecida no início da sessão — ex: o atendente confirmou que a carga é perigosa no turno 1, e essa informação sai da janela no turno 12. O sumário estruturado é superior porque preserva restrições identificadas explicitamente, independente de quando foram identificadas na sessão.

### Alternativa — Contexto máximo irrestrito (enviar todo o histórico sempre)
**Razão para descarte:** mesmo com 128K tokens disponíveis, o efeito lost in the middle é documentado e independe do tamanho absoluto da janela. Mais histórico não é melhor histórico. O custo por query também cresce linearmente com o histórico — sessões longas podem custar 5–10× mais do que o orçamento planejado.

### Alternativa — Sem detecção de multi-domínio (5 chunks fixos sempre)
**Razão para descarte:** perguntas como "qual o SLA do cliente Gold para entrega de carga perigosa com frete especial?" cruzam SLA-2024, PROC-042 e potencialmente POL-001. Com 5 chunks genéricos, o retriever pode trazer 3 chunks de frete e 2 de SLA, sem nenhum chunk de devolução/carga perigosa — deixando parte da pergunta sem fundamentação documental. O modo multi-domínio resolve esse caso com custo adicional controlado.

---

## Notas de implementação

- `SESSION_MAX_TURNS`: variável de ambiente, padrão = 5, range recomendado 3–8.
- O prompt de summarização deve ser versionado junto com o system prompt principal (mesmo repositório, mesmo processo de review).
- O log de overflow (passos 2 e 3) deve ser monitorado nas primeiras semanas de produção — frequência alta indica que o orçamento precisa ser revisado.
- Os domínios mapeados para detecção multi-domínio devem ser revisados após o discovery com base nas perguntas reais dos atendentes.
