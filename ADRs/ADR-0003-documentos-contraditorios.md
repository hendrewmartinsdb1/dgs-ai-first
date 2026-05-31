# ADR-0003: Tratamento de Documentos Contraditórios no Pipeline de RAG

## Status: Proposto

---

## Contexto

A base documental da NovaTech contém documentos que se contradizem diretamente, sem hierarquia formal estabelecida:

- **PROC-042 v1 (mar/2023)** e **PROC-042-v2 (nov/2023)** coexistem no SharePoint sem que nenhum dos dois esteja marcado como obsoleto.
- As contradições são materiais: multiplicadores regionais diferem em até 12.5% (Norte: 1.6 vs 1.8), fatores de peso diferem em até 6.7%, e o prazo adicional de entrega difere em 1 dia útil.
- A seção 5 da v2 define uma cláusula de transição (chamados abertos antes de 01/12/2023 usam v1), cuja data já expirou — mas a v1 nunca foi arquivada.
- A documentação é atualizada por 3 áreas distintas (Operações, Compliance, Comercial) sem processo unificado de revisão, o que torna o problema estrutural e recorrente.

**Forças em conflito:**
- Simplicidade do pipeline vs. robustez frente à desorganização documental do cliente.
- Curadoria prévia (ideal) vs. go-live em 3 meses (real).
- Confiança do atendente na resposta do assistente vs. risco de erro financeiro silencioso.

---

## Decisão

Indexar **ambas as versões** de documentos conflitantes com **metadados obrigatórios** por chunk, combinado com uma **camada de detecção de conflito** no pipeline, antes da montagem do prompt de cada query.

### Detalhamento

**1. Metadados obrigatórios em cada chunk na ingestão:**

```json
{
  "doc_id": "PROC-042-v2",
  "version": "2.0",
  "date_emissao": "2023-11-10",
  "status": "vigente",
  "substitui": "PROC-042-v1",
  "conflict_flag": true,
  "domain": "frete_especial"
}
```

Para a versão antiga:
```json
{
  "doc_id": "PROC-042-v1",
  "version": "1.0",
  "date_emissao": "2023-03-03",
  "status": "obsoleto_nao_arquivado",
  "substituido_por": "PROC-042-v2",
  "conflict_flag": true,
  "domain": "frete_especial"
}
```

**2. Exclusão do retrieval ativo para documentos obsoletos:**

Documentos com `status: obsoleto_nao_arquivado` são **excluídos do retrieval ativo por filtro de metadado** — o Azure AI Search aplica um filtro `status eq 'vigente'` antes de qualquer busca por similaridade. Isso garante que chunks de versões obsoletas nunca entrem no contexto do LLM em condições normais de operação.

**Exceção controlada:** quando o atendente pergunta explicitamente sobre regras contratuais de um cliente com contrato antigo (detectado por keyword "contrato anterior", "versão antiga", "tabela antiga"), o filtro é relaxado para `status in ('vigente', 'obsoleto_nao_arquivado')` e a camada de detecção de conflito é ativada.

**3. Camada de detecção de conflito (pré-montagem de prompt — ativada na exceção):**

Quando o filtro relaxado está ativo e chunks de versões diferentes são recuperados:
- Priorizar chunk com `status: vigente` na posição mais alta do contexto.
- Incluir chunk `status: obsoleto_nao_arquivado` com marcação explícita no prompt: `[ATENÇÃO: versão anterior — use apenas para consulta histórica]`.
- Adicionar variável de sistema `{conflict_detected: true}` que ativa instrução condicional no system prompt.

**4. Instrução condicional no system prompt (ativada quando `conflict_detected: true`):**

```
Foram encontradas duas versões do mesmo documento. 
Cite SEMPRE a versão vigente (PROC-042-v2, novembro/2023) como referência principal.
Alerte o atendente que existe uma versão anterior com valores diferentes e oriente a confirmar 
qual versão está no contrato do cliente antes de informar valores ao cliente.
Nunca calcule valores usando multiplicadores de versões diferentes na mesma resposta.
```

**4. Regra de prioridade de versão para o LLM:**

Quando dois chunks do mesmo domínio e versões diferentes estiverem no contexto, o LLM deve: (a) citar apenas a versão vigente para fins operacionais; (b) mencionar a existência da versão anterior; (c) nunca sintetizar ou interpolar valores das duas versões.

---

## Consequências

**Positivas:**
- O pipeline é robusto frente à desorganização documental — não depende de curadoria prévia como pré-condição de funcionamento.
- Atendentes são alertados ativamente sobre contradições, em vez de receberem uma resposta silenciosamente errada.
- A camada de detecção captura futuras inconsistências — qualquer novo documento conflitante ativa o mesmo mecanismo automaticamente.
- Auditabilidade: os metadados registram qual versão foi usada em cada resposta.

**Negativas:**
- Aumento de complexidade no pipeline de ingestão (enriquecimento de metadados é manual ou semi-automático inicialmente).
- Prompts com `conflict_detected: true` são maiores (incluem contexto de ambas as versões + instrução adicional) — consumo de tokens maior nesses casos.
- Risco de falso positivo: documentos que tratam do mesmo tema mas não se contradizem podem ser marcados com `conflict_flag: true` se o critério de detecção for baseado apenas em `doc_id` sem validação semântica.

---

## Alternativas consideradas

### Alternativa A — Indexar apenas a versão mais recente (excluir v1)
**Razão para descarte:** requer que a NovaTech arquive formalmente a v1 antes da ingestão. O histórico mostra que a v1 ficou ativa por mais de 2 anos sem arquivamento. Tornar o funcionamento do pipeline dependente de uma ação que o cliente historicamente não realiza é um risco de prazo inaceitável no contexto de 3 meses. Além disso, contratos plurianuais podem referenciar multiplicadores da v1 — excluí-la poderia gerar erros para esses casos específicos.

### Alternativa C — Indexar ambas e delegar a decisão ao LLM via instrução no prompt
**Razão para descarte:** delegar a resolução de contradições ao LLM é uma estratégia probabilística. O modelo pode resolver corretamente em 90% dos casos e incorretamente nos 10% restantes — sem sinalização ao atendente de que houve ambiguidade. Erros de 10% em cálculos financeiros são inaceitáveis. A detecção de conflito deve ser determinística (pipeline) e não probabilística (LLM).

---

## Notas de implementação

- O enriquecimento de metadados de conflito deve ser parte do script de ingestão, não do processo manual.
- Recomenda-se um processo paralelo de curadoria com a NovaTech para reduzir progressivamente o número de documentos com `conflict_flag: true` ao longo do projeto.
- A camada de detecção não substitui a curadoria — é uma rede de segurança permanente para um problema estrutural do cliente.
- Revisão deste ADR após o discovery, quando o número real de documentos conflitantes na base completa (800+ documentos) for mapeado.
