# Template: Alerta de Documentos Contraditórios
# Usado quando: conflict_flag=true nos chunks recuperados (mesmo domain, versões diferentes)
# Variáveis: {doc_id}, {version_vigente}, {version_anterior}, {campo_conflitante}, {valor_vigente}, {valor_anterior}

---

Atenção: foram encontradas **duas versões do mesmo documento** com informações diferentes.

- **Versão vigente:** {doc_id} {version_vigente} — use esta como referência operacional.
- **Versão anterior:** {doc_id} {version_anterior} — pode estar no contrato de alguns clientes.

O campo com divergência é: **{campo_conflitante}**
- Valor na versão vigente: {valor_vigente}
- Valor na versão anterior: {valor_anterior}

**Recomendação:** confirme qual versão está no contrato do cliente antes de informar
o valor. Em caso de dúvida, acione o responsável da área Comercial.
