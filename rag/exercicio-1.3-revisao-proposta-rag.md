# Exercício 1.3 — Revisão Crítica de Proposta de RAG

**Papel:** Tech Lead  
**Data:** 2026-05-30  
**Ferramenta utilizada:** Claude (chat)

---

## Proposta original do desenvolvedor júnior

> "Vamos usar Azure AI Search com embeddings do ada-002. Todos os documentos serão indexados
> num único índice. Chunking fixo de 512 tokens sem overlap. O LLM recebe os 3 chunks mais
> similares. Usaremos GPT-4o para geração. O pipeline de ingestão roda manualmente quando
> alguém lembra de atualizar."

---

## Parte 1 — Revisão independente (Tech Lead, sem Claude)

### P1 — Chunking fixo de 512 tokens sem overlap: estrutura tabular destruída

**Problema:** A base da NovaTech contém tabelas críticas — multiplicadores regionais (PROC-042),
tabela de SLAs por tier (SLA-2024), fatores de peso. Com chunking fixo de 512 tokens, o corte
pode ocorrer no meio de uma tabela: o chunk que contém "Norte" não contém o cabeçalho
"Multiplicador", tornando o dado ilegível para o LLM. Sem overlap, chunks adjacentes não
compartilham contexto — a frase que termina num chunk e continua no próximo é perdida.

**Exemplo concreto:** a tabela de multiplicadores do PROC-042-v2 tem ~15 linhas incluindo
cabeçalho. Um chunk de 512 tokens pode conter o cabeçalho + as 3 primeiras regiões, e o
próximo chunk conter as 2 últimas regiões sem cabeçalho — inutilizando o segundo chunk.

**Alternativa:** chunking por seção semântica usando headers markdown/PDF como delimitadores
naturais, com overlap de 10% entre chunks adjacentes para preservar continuidade.

---

### P2 — Apenas 3 chunks: insuficiente para perguntas multi-domínio

**Problema:** perguntas reais de atendimento cruzam múltiplos domínios simultaneamente.
Exemplo: "qual o SLA do cliente Gold para devolver carga perigosa com frete especial?" requer
chunks de SLA-2024 (SLA), POL-001 (devolução de carga perigosa) e PROC-042 (frete).
Com 3 chunks, o retriever provavelmente retorna 2-3 do domínio mais semanticamente próximo
da pergunta, deixando os demais sem cobertura. A resposta parece completa ao atendente mas
está truncada — a omissão é silenciosa e indistinguível de uma resposta completa.

**Alternativa:** mínimo de 5 chunks por query, com detecção de perguntas multi-domínio
para subir automaticamente para 7, garantindo ao menos 1 chunk por domínio identificado.

---

### P3 — Índice único sem metadados: versões conflitantes competem sem distinção

**Problema:** PROC-042-v1 (mar/2023) e PROC-042-v2 (nov/2023) coexistem no SharePoint sem
marcação de obsolescência. Os embeddings dos dois documentos são semanticamente quase
idênticos — mesma estrutura, mesmo vocabulário, valores levemente diferentes. O retriever
retorna chunks de ambas as versões com scores similares. Sem metadado de versão, o LLM
mistura multiplicadores de versões diferentes (Norte=1.6 da v1 e Norte=1.8 da v2) na mesma
resposta sem alertar o atendente. Erro financeiro silencioso de até 12.5%.

**Alternativa:** schema de metadados obrigatórios por chunk: `doc_id`, `version`,
`date_emissao`, `status` (vigente/obsoleto), `conflict_flag`, `domain`. Camada de detecção
de conflito pré-montagem de prompt que identifica chunks com `conflict_flag=true` e ativa
instrução condicional no system prompt.

---

### P4 — Ingestão manual "quando alguém lembra": risco operacional estrutural

**Problema:** a documentação da NovaTech é atualizada mensalmente por 3 áreas sem processo
unificado. O histórico mostra que a PROC-042-v2 (nov/2023) coexiste com a v1 (mar/2023) mais
de 2 anos após publicação sem arquivamento. Ingestão manual perpetua esse padrão. Com 3 áreas
atualizando mensalmente, o assistente pode estar respondendo com documentos desatualizados
por semanas — sem que ninguém no sistema perceba.

**Alternativa:** trigger automático de re-ingestão via Azure Function com dois modos:
(1) webhook no SharePoint disparado imediatamente quando documento é publicado/modificado;
(2) varredura completa mensal para capturar mudanças que não dispararam o webhook.

---

### P5 — Nenhuma estratégia para documentos contraditórios

**Problema:** a proposta ignora completamente o problema mais crítico identificado na análise
documental. Sem detecção de conflito, o pipeline sempre devolve versões concorrentes ao LLM,
que resolve silenciosamente — gerando confiança indevida em resposta potencialmente errada.
Isso é mais perigoso do que não ter o assistente: o atendente acredita ter recebido uma
resposta fundamentada quando na verdade recebeu uma síntese não sinalizada de documentos
conflitantes.

**Alternativa:** camada de detecção de conflito no pipeline (não no LLM) que identifica
chunks com mesmo `domain` e versões diferentes, prioriza o chunk `status: vigente` e adiciona
instrução condicional no system prompt para citar ambas as versões e alertar o atendente.

---

### P6 — ada-002 como modelo de embedding: desempenho inferior em português e modelo legado

**Problema:** o text-embedding-ada-002 tem dois problemas específicos para este projeto:

(1) **Desempenho em PT-BR:** ada-002 foi treinado com predominância de inglês. Em textos técnicos
em português — "multiplicador regional", "coleta reversa", "frete especial", "prazo de entrega" —
o modelo gera embeddings menos precisos que os modelos de terceira geração, resultando em menor
recall de retrieval para perguntas em português dos atendentes. Um atendente que pergunta "qual o
prazo pra entrega de carga acima de uma tonelada?" pode não recuperar o chunk correto de PROC-042
porque a similaridade semântica entre a pergunta em português coloquial e o documento técnico é
subestimada pelo ada-002.

(2) **Modelo legado:** lançado em 2022, o ada-002 é considerado obsoleto pelo próprio Azure OpenAI.
O Azure oferece text-embedding-3-small e text-embedding-3-large com recall superior e custo menor
por token. Iniciar em 2026 com ada-002 é débito técnico desde o dia 1.

**Alternativa:** text-embedding-3-large para chunks de documentos (maior precisão semântica em
PT-BR), text-embedding-3-small para embedding das perguntas dos atendentes (menor custo, latência
menor — volume alto de queries em português coloquial).

---

## Parte 2 — Segunda revisão com Claude (revisão independente)

O Claude foi apresentado à proposta original e ao cenário da NovaTech. Identificou os seguintes
problemas adicionais, além dos 6 da revisão própria:

### P7 — Sem pré-processamento para documentos não-textuais

**Claude:** Os PDFs do SharePoint incluem tabelas como imagens embutidas, fluxogramas e ~15%
de documentos escaneados que exigem OCR. Um chunker de texto puro vai corromper tabelas
extraídas sem estrutura, ignorar imagens completamente e produzir texto ininteligível de
documentos escaneados sem OCR prévio. A proposta não menciona nenhuma etapa de extração
e normalização de texto antes do chunking.

**Alternativa:** pipeline de extração com Azure Document Intelligence (OCR + estrutura de
tabelas) para PDFs, antes de qualquer chunking. Documentos escaneados identificados por
heurística (razão texto/página abaixo de threshold) são roteados para OCR obrigatório.

---

### P8 — Sem ambiente de desenvolvimento separado do índice de produção

**Claude:** qualquer iteração na estratégia de chunking ou no schema de metadados exige
reconstruir o índice. Sem índice de staging separado, o desenvolvedor testa em produção —
afetando o assistente em uso pelos atendentes — ou faz full rebuild que torna o sistema
indisponível durante a operação.

**Alternativa:** dois índices no Azure AI Search: `novatech-prod` (produção) e
`novatech-dev` (desenvolvimento/testes). Promoção de dev para prod é processo explícito
com validação pelo script de testes.

---

### P9 — Sem re-ranking após retrieval

**Claude:** busca por similaridade semântica retorna chunks semanticamente próximos da
pergunta — não necessariamente os mais úteis para respondê-la. Re-ranking com cross-encoder
avalia relevância contextual (pergunta × chunk em conjunto) após o retrieval inicial e melhora
precisão, especialmente para perguntas com múltiplas intenções ou vocabulário diferente do
documento.

**Alternativa:** etapa de re-ranking com Azure AI Search Semantic Ranker (gerenciado) ou
cross-encoder open-source (ms-marco-MiniLM) após o retrieval inicial de N chunks, antes de
selecionar os K finais para o contexto do LLM.

---

### P10 — Sem monitoramento de qualidade de retrieval e feedback loop

**Claude:** a proposta não define como detectar degradação de qualidade em produção. Sem
logging de scores de similaridade e sem mecanismo de feedback dos atendentes ("essa resposta
estava errada/incompleta"), problemas de retrieval só são detectados quando os atendentes
reclamarem — geralmente após dano já causado ao atendimento.

**Alternativa:** logging obrigatório de `query`, `chunks_recuperados`, `scores`, `resposta`
por query. Mecanismo de feedback simples no Teams (thumbs up/down por resposta). Dashboard
semanal de qualidade com alertas automáticos quando score médio de similaridade cair abaixo
de threshold.

---

## Parte 3 — Comparação: revisão própria vs revisão do Claude

| Problema | Fonte | Categoria |
|---|---|---|
| P1 — Chunking fixo destrói tabelas | Tech Lead | Domínio específico NovaTech |
| P2 — 3 chunks insuficiente para multi-domínio | Tech Lead | Arquitetural (derivado dos ADRs) |
| P3 — Índice único sem metadados | Tech Lead | Domínio específico NovaTech |
| P4 — Ingestão manual | Tech Lead | Domínio específico NovaTech |
| P5 — Sem estratégia de contradições | Tech Lead | Domínio específico NovaTech |
| P6 — ada-002 obsoleto | Tech Lead | Técnico/stack |
| P7 — Sem pré-processamento OCR/imagens | Claude | Arquitetural genérico de RAG |
| P8 — Sem índice de staging | Claude | Operacional/DevOps |
| P9 — Sem re-ranking | Claude | Arquitetural genérico de RAG |
| P10 — Sem monitoramento e feedback | Claude | Operacional/qualidade |

**Análise da revisão dupla:**

A revisão própria foi mais forte nos problemas derivados da análise documental específica
da NovaTech (P1–P5): contradições entre PROC-042 v1/v2, ausência de metadados, ingestão
manual perpetuando documentos obsoletos. Esses problemas exigem conhecimento do domínio
e da base de dados — o Claude não tinha esse contexto internalizado na mesma profundidade.

O Claude foi mais forte nos problemas arquiteturais genéricos de RAG (P7–P10): pré-
processamento de documentos não-textuais, ambiente de staging, re-ranking e monitoramento.
Esses são padrões conhecidos da literatura de RAG independentemente do domínio.

**O que eu perdi:** P7 (OCR/imagens) estava no cenário original ("PDFs com tabelas
complexas, fluxogramas embutidos como imagens, documentos escaneados") e eu não o formalizei
como problema da proposta. P10 (monitoramento) eu mencionei implicitamente ao criticar a
ingestão manual, mas não formalizei como problema independente.

**O que o Claude não capturou com a mesma profundidade:** as implicações financeiras
específicas de P3 (12.5% de erro em multiplicadores) e o histórico de P4 (2 anos de v1
coexistindo com v2 sem arquivamento) — que transformam problemas genéricos em riscos
concretos e quantificados.

---

## Parte 4 — Proposta reescrita

### Proposta revisada: Pipeline RAG NovaTech

**Embeddings:** text-embedding-3-large para documentos, text-embedding-3-small para queries.
Substituição do ada-002 — melhor recall semântico e menor custo por token.

**Pré-processamento de documentos:**
- PDFs padrão: extração de texto com Azure Document Intelligence, preservando estrutura de
  tabelas como markdown
- PDFs escaneados (identificados por ratio texto/página < 0.3): OCR via Azure Document
  Intelligence antes do chunking
- Confluence (HTML): conversão para markdown antes do chunking
- Planilhas XLSX: conversão para tabelas markdown com cabeçalhos preservados

**Chunking:** por seção semântica usando headers do documento como delimitadores naturais
(H1, H2, H3 em markdown; seções numeradas em PDFs). Overlap de 10% entre chunks adjacentes.
Chunks resultantes entre 200 e 800 tokens — adaptativo ao conteúdo, não fixo.
Justificativa: tabelas e procedimentos numerados têm fronteiras naturais que o chunking
semântico preserva; o chunking fixo de 512 tokens as ignora.

**Metadados obrigatórios por chunk:**
```json
{
  "doc_id": "PROC-042-v2",
  "version": "2.0",
  "date_emissao": "2023-11-10",
  "status": "vigente",
  "conflict_flag": true,
  "domain": "frete_especial",
  "source_type": "normativo"
}
```

**Índices no Azure AI Search:**
- `novatech-prod`: índice de produção — acesso somente pelo pipeline de ingestão aprovado
- `novatech-dev`: índice de desenvolvimento — para iteração de chunking e metadados
- Promoção dev → prod requer aprovação do Tech Lead e execução do script de testes

**Pipeline de ingestão — automatizado:**
- Webhook no SharePoint: disparado imediatamente quando documento é publicado ou modificado
- Varredura mensal completa: Azure Function com timer trigger — captura mudanças sem webhook
- Nenhum passo manual no caminho crítico de atualização de documentos

**Retrieval:**
- Busca híbrida: similaridade semântica (vetorial) + keyword search (BM25) — maior cobertura
- Recuperação inicial: top 10 chunks por score combinado
- Re-ranking: Azure AI Search Semantic Ranker para selecionar os 5 chunks mais relevantes
  (ou 7 em modo multi-domínio, quando a query cruza ≥2 domínios detectados)
- Detecção de conflito: se chunks recuperados contêm `conflict_flag=true` com mesmo `domain`,
  ativar instrução condicional de conflito no system prompt

**Geração:** GPT-4o via Azure OpenAI, temperature=0.

**Camada de validação (Harness):** pós-processamento determinístico antes de entregar a
resposta ao atendente — verifica citação de fonte, ausência de valores absolutos de frete,
ausência de SLAs para tiers inexistentes.

**Monitoramento:**
- Logging obrigatório por query: pergunta, chunks recuperados, scores, resposta, turno da sessão
- Feedback no Teams: thumbs up/down por resposta do atendente
- Alerta automático: score médio de similaridade abaixo de 0.65 por janela de 100 queries
- Dashboard semanal de qualidade: taxa de feedback positivo, distribuição de scores, queries
  sem cobertura documental (score < 0.5)
