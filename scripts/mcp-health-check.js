/**
 * MCP Health Check — NovaTech Assistant
 * Verifica se os MCP servers configurados em .mcp/mcp.json estão operacionais.
 * Uso: node scripts/mcp-health-check.js
 */

import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";

// ─── Paths ──────────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");
const MCP_CONFIG_PATH = path.join(REPO_ROOT, ".mcp", "mcp.json");

// ─── Helpers ─────────────────────────────────────────────────────────────────

const OK = "✅ OK";
const WARN = "⚠️  AVISO";
const FAIL = "❌ FALHA";

function checkCommandAvailable(command) {
  const result = spawnSync(
    process.platform === "win32" ? "where" : "which",
    [command],
    { timeout: 5000, encoding: "utf8" }
  );
  return result.status === 0 && result.stdout && result.stdout.trim().length > 0;
}

function checkDirectoryExists(relPath) {
  const absPath = path.join(REPO_ROOT, relPath);
  return fs.existsSync(absPath) && fs.statSync(absPath).isDirectory();
}

function checkDirectoryHasMarkdown(relPath) {
  const absPath = path.join(REPO_ROOT, relPath);
  if (!fs.existsSync(absPath)) return false;
  const files = fs.readdirSync(absPath);
  return files.some((f) => f.endsWith(".md"));
}

function checkIsGitRepo(repoPath) {
  const gitDir = path.join(repoPath, ".git");
  return fs.existsSync(gitDir) && fs.statSync(gitDir).isDirectory();
}

function report(status, label, details) {
  const prefix = status === "ok" ? OK : status === "warn" ? WARN : FAIL;
  console.log(`  ${prefix}  ${label}`);
  if (details && details.length > 0) {
    details.forEach((d) => console.log(`         ${d}`));
  }
}

// ─── Server Checks ────────────────────────────────────────────────────────────

function checkFilesystemRW(serverConfig) {
  console.log("\n📁 [filesystem-rw] Read-Write Server");

  const command = serverConfig.command;
  const dirs = serverConfig.args.filter(
    (a) => !a.startsWith("-") && a !== "@modelcontextprotocol/server-filesystem"
  );

  if (!checkCommandAvailable(command)) {
    report("fail", `Comando '${command}' não encontrado no PATH`, [
      `Solução: instalar Node.js e garantir que ${command} está no PATH`,
    ]);
    return false;
  }
  report("ok", `Comando '${command}' disponível no PATH`);

  let allDirsOk = true;
  for (const dir of dirs) {
    if (checkDirectoryExists(dir)) {
      report("ok", `Diretório '${dir}' existe e é acessível`);
    } else {
      report("fail", `Diretório '${dir}' NÃO encontrado`, [
        `Path esperado: ${path.join(REPO_ROOT, dir)}`,
      ]);
      allDirsOk = false;
    }
  }

  return allDirsOk;
}

function checkFilesystemRO(serverConfig) {
  console.log("\n📄 [filesystem-ro] Read-Only Intent Server (docs/negócio)");

  const command = serverConfig.command;
  const dirs = serverConfig.args.filter(
    (a) => !a.startsWith("-") && a !== "@modelcontextprotocol/server-filesystem"
  );

  if (!checkCommandAvailable(command)) {
    report("fail", `Comando '${command}' não encontrado no PATH`);
    return false;
  }
  report("ok", `Comando '${command}' disponível no PATH`);

  let allOk = true;
  for (const dir of dirs) {
    if (!checkDirectoryExists(dir)) {
      report("fail", `Diretório '${dir}' NÃO encontrado`, [
        `Path esperado: ${path.join(REPO_ROOT, dir)}`,
      ]);
      allOk = false;
      continue;
    }

    if (checkDirectoryHasMarkdown(dir)) {
      const mdCount = fs
        .readdirSync(path.join(REPO_ROOT, dir))
        .filter((f) => f.endsWith(".md")).length;
      report("ok", `Diretório '${dir}' existe — ${mdCount} arquivo(s) .md encontrado(s)`);
    } else {
      report("warn", `Diretório '${dir}' existe mas NÃO contém arquivos .md`, [
        "Verifique se os documentos de negócio foram indexados corretamente",
      ]);
    }
  }

  return allOk;
}

function checkGit(serverConfig) {
  console.log("\n🌿 [git] Git Server");

  const command = serverConfig.command;

  if (!checkCommandAvailable(command)) {
    report("warn", `Comando '${command}' (uv/uvx) não encontrado no PATH`, [
      "Instalar uv: https://github.com/astral-sh/uv",
      `Defina $env:PATH incluindo o diretório do uv antes de executar`,
    ]);
  } else {
    report("ok", `Comando '${command}' disponível no PATH`);
  }

  if (checkIsGitRepo(REPO_ROOT)) {
    const headPath = path.join(REPO_ROOT, ".git", "HEAD");
    const head = fs.existsSync(headPath) ? fs.readFileSync(headPath, "utf8").trim() : null;
    report("ok", `Repositório git válido encontrado`, [
      `HEAD: ${head || "(não lido)"}`,
      `Raiz: ${REPO_ROOT}`,
    ]);
    return true;
  } else {
    report("fail", `Diretório .git/ não encontrado em ${REPO_ROOT}`, [
      "Execute: git init (se ainda não inicializado)",
    ]);
    return false;
  }
}

function checkMemory(serverConfig) {
  console.log("\n🧠 [memory] Memory Server");

  const command = serverConfig.command;

  if (!checkCommandAvailable(command)) {
    report("fail", `Comando '${command}' não encontrado no PATH`, [
      "Instalar Node.js 20 LTS e verificar npm/npx no PATH",
    ]);
    return false;
  }
  report("ok", `Comando '${command}' disponível no PATH`);
  report("ok", `@modelcontextprotocol/server-memory será instalado sob demanda via npx -y`);
  return true;
}

function checkEverything(serverConfig) {
  console.log("\n🔭 [everything] Everything Server (dev only)");

  const command = serverConfig.command;

  if (!checkCommandAvailable(command)) {
    report("warn", `Comando '${command}' não encontrado no PATH`, [
      "Servidor 'everything' é apenas para dev — impacto operacional zero se ausente",
    ]);
    return true;
  }
  report("ok", `Comando '${command}' disponível no PATH`);
  report("ok", `@modelcontextprotocol/server-everything será instalado sob demanda via npx -y`, [
    "Lembrete: remover do mcp.json quando não estiver desenvolvendo integrações MCP",
  ]);
  return true;
}

// ─── Main ────────────────────────────────────────────────────────────────────

function main() {
  const timestamp = new Date().toISOString();
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  NovaTech Assistant — MCP Health Check");
  console.log(`  Timestamp: ${timestamp}`);
  console.log(`  Config:    ${MCP_CONFIG_PATH}`);
  console.log(`  Repo:      ${REPO_ROOT}`);
  console.log("═══════════════════════════════════════════════════════════════");

  if (!fs.existsSync(MCP_CONFIG_PATH)) {
    console.error(`\n${FAIL}  Arquivo .mcp/mcp.json não encontrado em: ${MCP_CONFIG_PATH}`);
    process.exit(1);
  }

  let config;
  try {
    config = JSON.parse(fs.readFileSync(MCP_CONFIG_PATH, "utf8"));
  } catch (e) {
    console.error(`\n${FAIL}  Falha ao parsear .mcp/mcp.json: ${e.message}`);
    process.exit(1);
  }

  const servers = config.mcpServers || {};
  const serverNames = Object.keys(servers);

  if (serverNames.length === 0) {
    console.log(`\n${WARN}  Nenhum servidor configurado em .mcp/mcp.json`);
    process.exit(0);
  }

  console.log(`\n  Servidores configurados: ${serverNames.join(", ")}`);

  const results = {};

  for (const name of serverNames) {
    const serverConfig = servers[name];
    switch (name) {
      case "filesystem-rw":
        results[name] = checkFilesystemRW(serverConfig);
        break;
      case "filesystem-ro":
        results[name] = checkFilesystemRO(serverConfig);
        break;
      case "git":
        results[name] = checkGit(serverConfig);
        break;
      case "memory":
        results[name] = checkMemory(serverConfig);
        break;
      case "everything":
        results[name] = checkEverything(serverConfig);
        break;
      default:
        console.log(`\n❓ [${name}] Servidor desconhecido — verificação não implementada`);
        results[name] = null;
    }
  }

  // Summary
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("  RESUMO");
  console.log("═══════════════════════════════════════════════════════════════");

  let failCount = 0;
  let warnCount = 0;

  for (const [name, ok] of Object.entries(results)) {
    if (ok === true) {
      console.log(`  ${OK}  ${name}`);
    } else if (ok === false) {
      console.log(`  ${FAIL}  ${name}`);
      failCount++;
    } else {
      console.log(`  ${WARN}  ${name} (verificação parcial)`);
      warnCount++;
    }
  }

  console.log("───────────────────────────────────────────────────────────────");
  if (failCount === 0 && warnCount === 0) {
    console.log("  Todos os servidores operacionais. Sessão de desenvolvimento pronta.");
  } else if (failCount === 0) {
    console.log(`  ${warnCount} aviso(s). Verifique os itens acima antes de iniciar.`);
  } else {
    console.log(`  ${failCount} falha(s) crítica(s). Corrija antes de iniciar a sessão.`);
  }
  console.log("═══════════════════════════════════════════════════════════════");

  process.exit(failCount > 0 ? 1 : 0);
}

main();
