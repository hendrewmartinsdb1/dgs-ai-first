# Avaliação de Riscos — Claude como co-reviewer
## Exercício 3.2 · Cenário 3

> **Prompt usado:** apresentado o cenário completo, os 4 artefatos com seus contextos,
> e solicitado análise de riscos por artefato com classificação de criticidade.
> Claude não teve acesso à minha análise prévia ao responder.

---

## Artefato 1: AGENTS.md (15 páginas, 4 iterações)

**Risco identificado pelo Claude:**

O principal risco identificado foi o tamanho do documento. Claude explicou que agentes
de IA (incluindo o GitHub Copilot) não processam documentos longos linearmente com
atenção uniforme — há degradação de atenção para conteúdo posicionado no meio do
documento (o mesmo fenômeno de "lost in the middle" que os próprios sistemas RAG
precisam mitigar). Um AGENTS.md de 15 páginas com regras críticas no meio do documento
provavelmente será parcialmente ignorado.

Claude adicionou um ângulo que eu não havia considerado explicitamente: **o risco de
contradição interna**. Quatro iterações de refinamento sem revisão de consistência
podem ter introduzido regras que se contradizem (ex: uma seção diz "sempre use try/catch"
e outra define que catch vazio é proibido, mas a primeira seção não especifica o que
fazer no catch). Agentes tendem a seguir a regra que aparece mais recentemente no
documento quando há contradição.

Claude também mencionou o **risco de obsolescência parcial**: seções escritas nas
iterações v1 e v2 podem referenciar convenções que foram superadas nas v3 e v4,
mas a referência antiga permanece no documento sem ser removida.

**Classificação Claude:** Alto risco — recomenda auditoria de posicionamento e
revisão de consistência interna antes do go-live.

---

## Artefato 2: Skills (Foundation testada; 2 sem refinamento)

**Risco identificado pelo Claude:**

Claude identificou diretamente o mesmo risco central que eu: skills sem refinamento
são hipóteses não validadas. Adicionou a terminologia de "cargo cult" — desenvolvedores
que usam a skill assumem que ela funciona porque existe, sem questionar.

**Ângulo adicional do Claude que eu não havia considerado explicitamente:**
O risco não é apenas que o agente ignore a skill, mas que o agente siga a skill
*parcialmente* — seguindo as partes que coincidem com seu comportamento padrão e
ignorando exatamente as partes que diferenciam a skill de código genérico. Um teste
superficial (o código compila) não detecta esse tipo de falha. A análise seguiu/ignorou/parcial
do cenário 2 é o único método confiável.

Claude também levantou: se as 2 skills não testadas são de nível Domain ou Artifact
(mais específicas que Foundation), elas têm maior probabilidade de conter anti-padrões
não cobertos pela Foundation — exatamente os casos que mais precisam de validação.

**Classificação Claude:** Crítico — bloqueante para go-live se qualquer skill não testada
for usada em qualquer módulo que ainda será desenvolvido antes da demo.

---

## Artefato 3: Pipeline de ingestão + query endpoint (60-70% Copilot)

**Risco identificado pelo Claude:**

Claude identificou o risco de conformidade com o AGENTS.md de forma similar à minha
análise. Adicionou especificamente:

- **Risco de type safety:** `as any` em código Copilot é comum porque o Copilot
  frequentemente não tem acesso ao schema completo dos tipos no momento da sugestão.
  Em funções críticas como o query handler, `as any` significa que dados malformados
  do Azure AI Search podem passar silenciosamente para o LLM sem validação.

- **Risco de tratamento de erro inconsistente:** Copilot tende a gerar `try/catch`
  genéricos que engolam o erro sem logar informação útil. Em 60-70% do código, há
  probabilidade alta de pelo menos um catch que loga apenas `error.message` sem
  o stack trace, queryId, ou contexto suficiente para debug.

- **Ângulo que eu não havia levantado:** Claude mencionou o risco de **configuração
  hardcoded**. Copilot frequentemente substitui variáveis de ambiente por strings
  literais quando não tem visibilidade da configuração do projeto. Verificar se
  nomes de índice, endpoints, e deployment names estão em variáveis de ambiente
  (`src/shared/config.ts`) ou hardcoded nas funções.

**Classificação Claude:** Alto — recomenda auditoria focada em validator.ts de cada
endpoint e verificação de configurações via environment variables.

---

## Artefato 4: System prompt (6 iterações, sem changelog)

**Risco identificado pelo Claude:**

Identificação equivalente à minha para o risco de rollback e auditabilidade.

**Ângulos adicionais do Claude:**

- **Risco de regression não detectada entre versões:** Claude enfatizou que prompt
  engineering tem efeitos colaterais não intuitivos. Uma mudança feita para melhorar
  o comportamento em SLA pode ter degradado o comportamento em carga perigosa — e
  sem golden queries testadas em cada versão, esse efeito colateral passa despercebido
  até aparecer em produção.

- **Risco de "prompt rot":** após 6 iterações, o system prompt provavelmente contém
  instruções redundantes, contraditórias, ou que se anulam. Regras adicionadas na v3
  para corrigir um comportamento podem conflitar com regras adicionadas na v5. Sem
  limpeza periódica, o prompt cresce em complexidade sem crescer em eficácia — e
  pode ter regressões em comportamentos que "sempre funcionaram" porque uma instrução
  antiga que os suportava foi inadvertidamente removida ou sobrescrita.

- **Risco de go-live sem baseline:** Claude foi enfático que a v6 atual pode estar
  sendo avaliada apenas subjetivamente ("parece melhor"). Sem golden queries com
  respostas esperadas, não há como saber se a v6 é realmente melhor que a v4 — ou
  apenas diferente.

**Classificação Claude:** Alto — recomenda como pré-go-live obrigatório: golden queries
e changelog retroativo das últimas 2 versões pelo menos.
