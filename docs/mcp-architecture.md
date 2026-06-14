# Arquitetura MCP — NovaTech Assistant

> Model Context Protocol (MCP) servers fornecem ferramentas e recursos para agentes de IA (Claude Code, GitHub Copilot) operarem sobre o repositório com escopo controlado (least privilege).

---

## 1. Diagrama de Servidores e Conexões

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Agentes de IA                               │
│              (Claude Code / GitHub Copilot / Claude Chat)           │
└──────────────┬──────────────┬──────────────┬────────────────────────┘
               │              │              │
       ┌───────▼──────┐ ┌─────▼──────┐ ┌───▼─────────────────────┐
       │ filesystem-rw│ │filesystem-ro│ │         git             │
       │  (read-write)│ │(read-only*) │ │  (read — history/diff)  │
       └───────┬──────┘ └─────┬───────┘ └───┬─────────────────────┘
               │              │              │
    ┌──────────▼──┐    ┌──────▼──────┐  ┌───▼───────┐
    │  ./src      │    │./docs/      │  │ .git/     │
    │  ./specs    │    │  novatech/  │  │ (repo)    │
    │  ./skills   │    │./data/      │  └───────────┘
    └─────────────┘    │  retrieval- │
                       │  corpus/    │
                       └─────────────┘

       ┌──────────────────────┐      ┌────────────────────────────┐
       │        memory        │      │         everything         │
       │  (read-write graph)  │      │  (dev-only, primitives)    │
       └──────────────────────┘      └────────────────────────────┘
```

### Permissões por servidor

| Servidor | Comando | Diretórios | Permissão | Quem consome |
|----------|---------|------------|-----------|--------------|
| `filesystem-rw` | npx | `./src`, `./specs`, `./skills` | read-write | Claude Code (geração de código e specs) |
| `filesystem-ro` | npx | `./docs/novatech`, `./data/retrieval-corpus` | read-only* | Claude Code (leitura de docs de negócio) |
| `git` | uvx | `.` (repo raiz) | read (log, diff, branch) | Claude Code (contexto de histórico) |
| `memory` | npx | (grafo em memória persistida) | read-write | Claude Code, Claude Chat (memória entre sessões) |
| `everything` | npx | (primitivas MCP) | read-write (dev only) | Claude Code (exploração de primitivas MCP) |

*Enforcement via permissão de SO — ver seção 6.

---

## 2. Política de Aprovação de Novos Servidores

### Quem pode propor
Qualquer desenvolvedor do time pode propor adição ou alteração de servidor MCP via Pull Request que modifique `.mcp/mcp.json`.

### Quem aprova
**Tech Lead** revisa e aprova toda mudança no `.mcp/mcp.json` antes de merge. Critérios de revisão:

1. **Escopo mínimo suficiente:** o servidor expõe apenas os diretórios ou capacidades estritamente necessários para o caso de uso justificado.
2. **Justificativa documentada:** o PR deve descrever (a) qual agente consome o servidor, (b) quais operações precisa realizar, (c) por que o escopo não pode ser reduzido.
3. **Least privilege:** se um servidor existente já cobre a necessidade, não adicionar um novo.

### Mudança de escopo
Ampliação de escopo (adicionar diretórios, trocar read-only por read-write) é tratada como mudança de arquitetura:

- Deve ser registrada em um novo ADR em `docs/adr/` ou como entry no commit de mudança com justificativa explícita.
- Mudança NUNCA é feita diretamente em `main` — branch + PR + review do Tech Lead.
- `.mcp/mcp.json` é versionado em git — o histórico de mudanças é auditável via `git log -- .mcp/mcp.json`.

### Remoção de servidor
Servidores não utilizados ativamente devem ser removidos. O servidor `everything` em particular DEVE ser removido quando não há desenvolvimento ativo de integrações MCP.

---

## 3. Monitoramento Local

### Script de health check
Verificação dos servidores antes de cada sessão de desenvolvimento:

```bash
node scripts/mcp-health-check.js
```

O script verifica:
- Se o comando (`npx`, `uvx`) está disponível no PATH
- Se os diretórios-alvo do filesystem existem e são acessíveis
- Se `docs/novatech/` contém pelo menos 1 arquivo `.md`
- Se o repositório git é válido (`.git/` existe)

### Frequência recomendada
- **Antes de toda sessão de desenvolvimento** que envolva agentes de IA
- **Após mudanças no `.mcp/mcp.json`** para validar a configuração
- **Em onboarding de novos devs** para confirmar ambiente configurado

### O que fazer em caso de falha
Ver seção 5 — Plano de Contingência.

---

## 4. Versionamento

- `.mcp/mcp.json` é versionado em git (commitado no repositório).
- **Mudança de escopo nunca é feita diretamente em `main`** — branch + PR + review (mesma política de ADRs).
- Toda mudança no arquivo deve ter mensagem de commit descritiva: `chore(mcp): add filesystem-rw scope for ./scripts`.
- Para auditoria: `git log --follow .mcp/mcp.json` mostra histórico completo de mudanças de configuração.

---

## 5. Plano de Contingência por Servidor

### `filesystem-rw` indisponível
**Impacto:** agente não consegue ler ou escrever em `./src`, `./specs`, `./skills`.

**Ação:**
- O agente exibe aviso explícito: `"MCP filesystem-rw unavailable — cannot read/write source code. Switching to manual mode."`
- O agente responde apenas com base em conhecimento de código que já está no contexto da conversa.
- O agente **NUNCA inventa** conteúdo de arquivos não lidos — declina e instrui o desenvolvedor a copiar o conteúdo manualmente.
- Diagnóstico: verificar se `npx` está no PATH; verificar se `@modelcontextprotocol/server-filesystem` consegue instalar.

### `filesystem-ro` indisponível
**Impacto:** agente não consegue ler documentos de negócio em `./docs/novatech` ou o corpus RAG em `./data/retrieval-corpus`.

**Ação:**
- O agente exibe aviso: `"Business documentation unavailable — answers based on code context only."`
- O agente **NUNCA inventa** conteúdo dos documentos de negócio (SLA, POL-001, PROC-042).
- Sem impacto em operações de escrita de código.

### `git` indisponível
**Impacto:** operações de histórico (git log, git diff, branch listing) desabilitadas.

**Ação:**
- O agente exibe aviso: `"Git history unavailable — cannot inspect commit history or diffs."`
- Sem impacto em leitura de arquivos ou geração de código.
- Diagnóstico: verificar se `uvx` está no PATH; verificar se o diretório `.git/` existe no repositório raiz.

### `memory` indisponível
**Impacto:** sessão stateless — decisões e contexto de sessões anteriores não estão disponíveis.

**Ação:**
- O agente exibe aviso: `"Persistent memory unavailable — session is stateless. Please re-provide project context."`
- O desenvolvedor deve repassar contexto relevante (ADRs, decisões anteriores) manualmente no início da sessão.
- Sem impacto em operações de código ou leitura de documentos.

### `everything` indisponível
**Impacto:** exploração de primitivas MCP não disponível.

**Ação:**
- Sem impacto operacional — servidor é exclusivamente para desenvolvimento de integrações MCP.
- Ignorar durante sessões normais de desenvolvimento.

---

## 6. Nota sobre Read-Only: `filesystem-ro`

### Por que `./docs/novatech` e `./data/retrieval-corpus` devem ser read-only

`./docs/novatech/` contém os documentos de negócio oficiais da NovaTech (POL-001, PROC-042, SLA-2024). Esses documentos são a fonte de verdade do sistema RAG. Se um agente os modificar inadvertidamente, as respostas do assistente passarão a ser baseadas em documentos adulterados — com risco direto de erros financeiros em cálculos de frete e SLA.

`./data/retrieval-corpus/` contém os chunks pré-processados usados no retrieval. Modificação por agente corromperia o corpus e exigiria reindexação completa no Azure AI Search.

### Limitação do MCP filesystem server

O servidor `@modelcontextprotocol/server-filesystem` **não possui flag nativa de read-only** — ele expõe tanto operações de leitura quanto de escrita para todos os diretórios configurados. A distinção `filesystem-ro` no `mcp.json` é semântica (documentação de intenção), não técnica.

### Como enforçar read-only via permissão de SO (Windows — icacls)

Para enforçar de forma real que nenhum processo (incluindo o MCP server) possa escrever nos diretórios sensíveis:

```powershell
# Remover permissão de escrita para o usuário atual nos diretórios de negócio
# Execute como administrador

# Verificar permissões atuais
icacls ".\docs\novatech"
icacls ".\data\retrieval-corpus"

# Remover Write para o usuário atual (substitua DOMAIN\username pelo usuário real)
icacls ".\docs\novatech" /deny "$env:USERNAME:(W)" /T
icacls ".\data\retrieval-corpus" /deny "$env:USERNAME:(W)" /T

# Verificar resultado — deve mostrar (DENY)(W) para o usuário
icacls ".\docs\novatech"
```

> **Atenção:** Este comando bloqueia escrita para o usuário atual em todas as subpastas (`/T`). Para restaurar permissões:
> ```powershell
> icacls ".\docs\novatech" /remove:d "$env:USERNAME" /T
> icacls ".\data\retrieval-corpus" /remove:d "$env:USERNAME" /T
> ```

Alternativa para ambientes de equipe: configurar as permissões no repositório via políticas de grupo ou ACLs no Azure DevOps/GitHub — qualquer push que modifique `docs/novatech/**` requer aprovação explícita do Tech Lead.
