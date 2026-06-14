# ADR-0001: Escolha do Modelo de LLM

## Status: Proposto

---

## Contexto

O assistente da NovaTech precisa de um LLM para geração de respostas fundamentadas em documentação interna. A escolha do modelo impacta custo operacional, qualidade das respostas, compliance de dados e prazo de implementação.

**Volume estimado:**
- 320 chamados/dia × 60% com consulta documental = **192 queries/dia**
- Orçamento de contexto por query (conforme ADR-0002): ~4.300 tokens
- Tokens de entrada/dia: ~826K | Tokens de saída/dia: ~57K
- Tokens mensais: ~25M entrada + ~1,7M saída

**Requisitos funcionais que impactam a escolha:**
- Raciocínio sobre negação e exceções (ex: carga perigosa NÃO pode ser devolvida — inversão de regra deve ser preservada)
- Detecção de contradições entre chunks de versões diferentes de um mesmo documento
- Citação obrigatória de fonte em toda resposta
- Resposta em português formal sem erros gramaticais
- Nunca inventar prazos, valores ou procedimentos não presentes nos chunks

**Restrições de projeto:**
- NovaTech já possui Microsoft 365 E3 e Azure provisionado e aprovado pelo compliance
- Orçamento de 3 meses (discovery + desenvolvimento + go-live)
- Time de TI da NovaTech com expertise Azure assumirá manutenção pós-projeto
- Adição de novo fornecedor externo exige processo de procurement e DPA — semanas adicionais

---

## Decisão

Adotar **Azure OpenAI com GPT-4o** como modelo de geração para o go-live, com **avaliação de downgrade para GPT-4o mini após 30 dias** de operação em produção.

### Detalhamento

**Modelo selecionado:** GPT-4o via Azure OpenAI  
**Justificativa:** ecossistema já aprovado pelo compliance da NovaTech, dados permanecem no tenant Azure (conformidade com LGPD e políticas internas), integração nativa com Microsoft Teams e SharePoint, sem necessidade de processo de procurement adicional.

**Estimativa de custo mensal:**

| Item | Volume mensal | Custo estimado |
|---|---|---|
| Tokens de entrada (GPT-4o) | ~25M tokens | ~$62 |
| Tokens de saída (GPT-4o) | ~1,7M tokens | ~$17 |
| **Total** | | **~$80/mês** |

Custo representativo e facilmente absorvível no orçamento do projeto. Mesmo com picos de 2× o volume estimado, o custo mensal ficaria abaixo de $200.

**Avaliação de downgrade (30 dias pós go-live):**

Após 30 dias, amostrar 200 pares de pergunta/resposta e comparar GPT-4o vs GPT-4o mini nas dimensões:
- Precisão factual (especialmente inversão de regras e tratamento de contradições)
- Aderência aos guardrails (citação de fonte, recusa adequada)
- Qualidade do português formal

Se GPT-4o mini atingir ≥90% de paridade em precisão e guardrails, migrar. Economia estimada: ~70% no custo de tokens.

---

## Consequências

**Positivas:**
- Dados da NovaTech não saem do tenant Azure — compliance simplificado
- Integração nativa com Teams e SharePoint via Azure AI Services
- Time de TI da NovaTech já conhece Azure — sustentação pós-projeto facilitada
- Sem processo de procurement adicional — prazo preservado
- GPT-4o tem bom desempenho em raciocínio sobre exceções e negações — mitiga R2 (inversão de regra) do mapa de riscos

**Negativas:**
- Vendor lock-in no ecossistema Microsoft — migração futura para outro provider exige refatoração da camada de integração
- GPT-4o é mais caro que alternativas (GPT-4o mini, modelos open-source) — custo pode crescer se o volume de chamados aumentar significativamente
- A decisão é baseada em restrições de prazo e ecossistema, não em superioridade técnica absoluta — se o projeto evoluir, modelos alternativos devem ser reavaliados

---

## Alternativas consideradas

### Claude API (Anthropic)
**Por que foi avaliado:** janela de contexto de 200K tokens, desempenho documentalmente superior em raciocínio sobre documentos longos e contraditórios — diretamente relevante para o problema da NovaTech.

**Por que foi descartado:**
1. O orçamento de contexto definido no ADR-0002 é ~4.300 tokens por query. A vantagem de 200K tokens do Claude é irrelevante para o caso de uso atual — não existe cenário projetado onde chegaríamos perto desse limite.
2. Adicionar a Anthropic como fornecedor exige processo de procurement, DPA e aprovação de segurança — semanas em um projeto de 3 meses.
3. Dados saem do tenant Azure, exigindo análise adicional de compliance da NovaTech.

**Reavaliação recomendada:** se o projeto evoluir para fase 2 com documentos mais complexos (ex: planilhas com fórmulas interdependentes, documentos escaneados com OCR imperfeito) ou se a NovaTech expandir para casos de uso com contextos maiores, o Claude API deve ser reavaliado formalmente.

### Modelos open-source via Ollama (Llama 3, Mistral, etc.)
**Por que foi avaliado:** custo zero de API, controle total, sem dependência de fornecedor externo.

**Por que foi descartado:**
1. Requer infraestrutura de GPU própria — custo de hardware e operação não previsto no escopo.
2. Modelos open-source de qualidade comparável ao GPT-4o exigem GPUs de alto custo (A100/H100).
3. Qualidade de português formal e raciocínio sobre exceções documentais é inferior às opções gerenciadas nos modelos open-source disponíveis sem fine-tuning.
4. Manutenção de infraestrutura GPU não é competência do time de TI da NovaTech.

### GPT-4o mini (Azure OpenAI) como modelo principal desde o início
**Por que foi avaliado:** ~70% de economia em custo de tokens para o mesmo ecossistema.

**Por que foi descartado para go-live:** os casos críticos da NovaTech — inversão de regra em carga perigosa, tratamento de chunks contraditórios (PROC-042 v1 vs v2), recusa adequada quando pergunta não tem resposta na base — exigem raciocínio mais robusto que o GPT-4o mini demonstra em benchmarks de qualidade de instrução. A avaliação pós-30-dias permite o downgrade baseado em dados reais do domínio, não em benchmarks genéricos.

---

## Notas de implementação

- Utilizar Azure OpenAI via SDK oficial (openai Python package com endpoint Azure).
- Configurar temperature = 0 para maximizar determinismo nas respostas — respostas de atendimento ao cliente não precisam de criatividade.
- Logar model version em cada resposta para garantir rastreabilidade — Azure pode atualizar versões do modelo automaticamente.
- Implementar retry com exponential backoff para lidar com throttling (rate limits do Azure OpenAI por deployment).
- A avaliação de downgrade para GPT-4o mini deve ser agendada explicitamente no cronograma do projeto — não é atividade opcional.
