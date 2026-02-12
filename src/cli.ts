// ABOUTME: CLI entry point that parses subcommands and dispatches to underlying MCP tools.
// ABOUTME: Handles --help, --version, and delegates subcommand argv to the resolved binary.

import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { loadConfig } from "./config.js";
import { resolveBinary, resolveVersion, BINARY_MAP } from "./resolve.js";
import { buildArgv } from "./args.js";
import { spawnTool } from "./spawn.js";
import { runExport } from "./export.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const require = createRequire(import.meta.url);
const pkgPath = path.resolve(__dirname, "..", "package.json");
let version = "0.1.0";
try {
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
  version = pkg.version;
} catch {
  // Fall back to hardcoded version
}

function printHelp(): void {
  console.log(`mcpknife — unified CLI for the MCP power-tool suite

Usage:
  mcpknife <command> [options]

Commands:
  boot    Generate an MCP server from a prompt and API docs
  mod     Transform tools on an existing MCP server
  ui      Add interactive UI to an MCP server
  export  Dump a self-contained MCP server project to disk

Options:
  --help      Show this help message
  --version   Show version number

Configuration:
  mcpknife reads defaults from ~/.mcpkniferc and ./.mcpkniferc (JSON).
  Supported fields: provider, model, apiKey, verbose.
  CLI flags override config file values.

Examples:
  mcpknife boot --prompt "Hacker News API" https://github.com/HackerNews/API
  mcpknife mod --upstream "npx some-server" --prompt "hide write tools"
  mcpknife ui --upstream-url http://localhost:3000/mcp

  # Full pipeline
  mcpknife boot --prompt "Yahoo Finance" | mcpknife mod --prompt "combine tools" | mcpknife ui

  # Export standalone server
  mcpknife boot --prompt "Dictionary API" | mcpknife mod --prompt "synonyms" | mcpknife export

Run 'mcpknife <command> --help' for command-specific options.`);
}

const args = process.argv.slice(2);

if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
  printHelp();
  process.exit(0);
}

if (args[0] === "--version" || args[0] === "-V") {
  console.log(`mcpknife v${version}`);
  for (const [cmd, pkg] of Object.entries(BINARY_MAP)) {
    console.log(`  ${cmd}: ${pkg} v${resolveVersion(pkg)}`);
  }
  process.exit(0);
}

const subcommand = args[0];
const rawArgv = args.slice(1);

if (subcommand === "export") {
  runExport(rawArgv).then(() => process.exit(0)).catch((err: Error) => {
    console.error(`mcpknife export: ${err.message}`);
    process.exit(1);
  });
} else if (!BINARY_MAP[subcommand]) {
  console.error(`mcpknife: unknown subcommand '${subcommand}'`);
  console.error(`Run 'mcpknife --help' for usage`);
  process.exit(1);
} else {
  const config = loadConfig();
  const binaryPath = resolveBinary(subcommand);
  const argv = buildArgv(config, rawArgv);
  spawnTool(binaryPath, argv);
}
