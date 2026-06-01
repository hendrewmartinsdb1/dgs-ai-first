# Changelog — System Prompt NovaTech

## v1.1 — 2026-05-31

**Autor:** Hendrew Martins
**Revisores:** Tech Lead (revisão via análise de gaps — sessão Claude Prompts_13 a 18)
**Status:** Aprovado para go-live — substitui v1.0

### Corrigido — 4 gaps de severidade alta identificados na revisão de v1.0

#### A1 — "Afirmação factual" não definida (Ambiguidade, Alta)

- Problema: R1 exigia citação para "toda afirmação factual" sem definir o que conta como factual.
  O modelo podia omitir citação em declarações sobre restrições (por não as classificar como factuais)
  ou citar frases de encaminhamento puro que não têm fonte documental.
- Correção: adicionada definição explícita em R1 do que é e do que não é afirmação factual,
  com exemplo de como citar quando o encaminhamento é motivado por regra documental.

#### A2 — Sem fallback para multiplicador ausente em R3 (Ambiguidade, Alta)

- Problema: R3 instruía a informar multiplicadores mas não definia o que fazer quando a combinação
  peso/região não está coberta na documentação. O modelo podia inventar o multiplicador (violando R2)
  já que a tensão entre R3 e R2 não era explicitada.
- Correção: adicionado fallback explícito em R3 — quando o multiplicador não consta nos documentos,
  aplicar R4 e orientar consulta à área de Operações.

#### B1 — Sem instrução para perguntas ambíguas (Omissão, Alta)

- Problema: sem instrução, o modelo escolhia uma interpretação silenciosamente para perguntas
  ambíguas (ex: "quanto custa o frete?" sem peso ou região), gerando risco de resposta incorreta.
- Correção: adicionada Regra R8 — perguntas ambíguas exigem clarificação antes de responder,
  com exemplos de ambiguidades comuns no domínio NovaTech. Referência a R8 adicionada
  na seção "USO DOS DOCUMENTOS DE CONTEXTO".

#### C1 — Gap de informação parcial entre R2 e R4 (Tensão, Alta)

- Problema: R2 ("não infira") e R4 ("diga que não encontrou") não cobriam o caso intermediário
  em que os documentos respondem parte da pergunta mas não toda. O modelo podia aplicar R4
  integralmente e perder informação parcial útil, ou responder a parte coberta e inferir o restante.
- Correção: adicionado subitem "Informação parcial" em R4 com instrução explícita: responder
  a parte coberta com citação, declarar a parte sem cobertura, não inferir o restante.
  Inclui exemplo concreto com multiplicador + prazo de entrega.

### Adicionado em v1.1

- R7: instrução de reafirmação com fonte para caso de insistência do atendente sobre
  carga perigosa — não apenas encaminhar, mas citar a restrição novamente.

---

## v1.0 — 2026-05-30

**Autor:** Hendrew Martins
**Revisores:** —
**Status:** Depreciado — substituído por v1.1

### Adicionado em v1.0

- Identidade e escopo do assistente
- R1: obrigatoriedade de citação de fonte com formato padronizado
- R2: proibição de inventar valores, prazos e procedimentos
- R3: proibição de calcular valor absoluto de frete (valor base externo à base)
- R4: comportamento padrão quando pergunta não tem cobertura documental
- R5: tratamento de documentos contraditórios (PROC-042 v1 vs v2)
- R6: tratamento de tiers inexistentes (Platinum, Diamond, etc.)
- R7: regra explícita de inversão para cargas perigosas (NÃO elegíveis para devolução)
- Hierarquia de fontes: POL/PROC > SLA > FAQ
- Formato de resposta padronizado
