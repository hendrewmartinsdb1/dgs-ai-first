# Comparação — Análise própria vs. Claude
## Exercício 3.2 · Cenário 3

---

## Onde concordamos

| Ponto | Minha análise | Claude |
|-------|--------------|--------|
| AGENTS.md longo → lost-in-the-middle | ✅ regras nas páginas 10–15 têm menos atenção | ✅ mesma conclusão |
| Skills sem refinamento = hipóteses não validadas | ✅ falsa confiança do desenvolvedor | ✅ mesma conclusão, adicionou "cargo cult" |
| System prompt sem changelog → rollback impossível | ✅ identificado como bloqueante de governança | ✅ mesma conclusão, mais ênfase |
| Pipeline Copilot → risco de violação do AGENTS.md | ✅ foco em `as any`, `console.log`, `require` dinâmico | ✅ concordância, adicionou type safety e catch genérico |
| Prioridade de skills: verificar antes do go-live | ✅ bloqueante Alto | ✅ Crítico |

---

## Onde divergimos

| Artefato | Minha classificação | Claude | Diferença |
|----------|---------------------|--------|-----------|
| AGENTS.md | Médio-Alto | Alto | Classificação de risco ligeiramente diferente |
| Pipeline | Alto | Alto | Concordância; ênfases diferentes |
| System prompt | Médio-Alto | Alto | Claude foi mais enfático na necessidade de golden queries como bloqueante |

---

## O que o Claude identificou que eu NÃO havia identificado

**1. Contradição interna no AGENTS.md (4 iterações sem revisão de consistência)**
Eu havia considerado o risco de "texto enterrado no meio". Claude adicionou o risco
de *contradições entre as próprias regras* — uma versão diz X, outra diz não-X, ambas
permanecem no documento. Agentes tendem a seguir a regra mais recente no documento
quando há contradição. Eu não havia pensado nessa dimensão de inconsistência interna.

**2. Obsolescência parcial no AGENTS.md**
Seções escritas nas primeiras iterações podem referenciar convenções superadas nas
iterações posteriores, sem que as referências antigas tenham sido removidas. Não havia
considerado isso.

**3. Skills não testadas: o risco é a conformidade parcial, não a ignorância total**
Claude enfatizou que o agente pode seguir as partes "fáceis" da skill (que coincidem
com seu comportamento padrão) e ignorar exatamente as partes específicas e críticas.
Compilar sem erro não é evidência de conformidade. Eu havia identificado o risco geral,
mas Claude foi mais preciso sobre o mecanismo.

**4. Configurações hardcoded no código Copilot**
Não havia levantado o risco de que o Copilot substitua variáveis de ambiente por
strings literais quando não tem visibilidade da configuração. Isso é um risco de
segurança e de deployment — o código pode funcionar em dev com as credenciais do
desenvolvedor hardcoded e falhar em produção.

**5. "Prompt rot" no system prompt**
A degradação de qualidade do prompt por acumulação de regras redundantes e conflitantes
ao longo das 6 iterações. Eu havia focado no risco de rollback (sem changelog), mas
não havia considerado que o prompt atual pode ser internamente incoerente por crescimento
descontrolado.

**6. Baseline subjetivo para o system prompt**
A v6 pode estar sendo avaliada como "melhor" apenas porque o time a percebe como tal,
sem dados. Golden queries não são apenas uma boa prática — são a única forma de saber
se v6 é melhor que v4, e não apenas diferente.

---

## O que EU identifiquei que o Claude NÃO mencionou

**1. Risco de metadados de vigência no pipeline (ADR-0003)**
Meu ponto mais específico: se o pipeline de ingestão não adicionar o metadado `status`
em todos os chunks, o filtro `status eq 'vigente'` da ADR-0003 falha silenciosamente —
chunks do PROC-042 v1 (obsoleto) entram no contexto sem aviso. Claude não mencionou
esse risco específico, focando mais em conformidade com AGENTS.md do que em
comportamento funcional do pipeline.

**2. AGENTS.md não afeta o assistente em runtime**
Claude não fez a distinção que eu fiz: o AGENTS.md é risco de desenvolvimento (qual
código os devs vão gerar), não de runtime (o assistente não o lê durante operação).
Isso muda a prioridade — é alto risco para futuras modificações, mas não para a demo.

---

## Lição aprendida sobre uso de IA como co-reviewer

O Claude foi especialmente eficaz em identificar riscos de padrões gerais de qualidade
(prompt rot, contradição interna, conformidade parcial de skills). Eu fui mais eficaz
em rastrear riscos específicos ao projeto — os que requerem conhecimento das ADRs
(ADR-0003 e o filtro de vigência) e da distinção entre runtime e desenvolvimento.

A análise humana prévia não foi redundante: o ponto mais crítico para a confiabilidade
do assistente em produção (metadados de vigência do pipeline) foi identificado por mim
e não pelo Claude. O Claude compensou com ângulos sobre qualidade interna dos artefatos
que eu havia subestimado.

**Conclusão:** a combinação sequencial (humano primeiro, IA depois) produziu uma lista
mais completa do que qualquer uma das duas análises isoladas. O risco de fazer IA
primeiro é que o humano tende a confirmar o que a IA disse, em vez de buscar o que ela
não disse.
