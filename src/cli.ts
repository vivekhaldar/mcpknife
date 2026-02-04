// ABOUTME: CLI entry point that parses subcommands and dispatches to underlying MCP tools.
// ABOUTME: Handles --help, --version, and delegates subcommand argv to the resolved binary.

import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { loadConfig } from "./config.js";
import { resolveBinary, BINARY_MAP } from "./resolve.js";
import { buildArgv } from "./args.js";
import { spawnTool } from "./spawn.js";

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
  console.log(`mcpx — unified CLI for the MCP power-tool suite

Usage:
  mcpx <command> [options]

Commands:
  boot    Generate an MCP server from a prompt and API docs
  mod     Transform tools on an existing MCP server
  ui      Add interactive UI to an MCP server

Options:
  --help      Show this help message
  --version   Show version number

Configuration:
  mcpx reads defaults from ~/.mcpxrc and ./.mcpxrc (JSON).
  Supported fields: provider, model, apiKey, verbose.
  CLI flags override config file values.

Examples:
  mcpx boot --prompt "Hacker News API" https://github.com/HackerNews/API
  mcpx mod --upstream "npx some-server" --prompt "hide write tools"
  mcpx ui --upstream-url http://localhost:3000/mcp

  # Full pipeline
  mcpx boot --prompt "Yahoo Finance" | mcpx mod --prompt "combine tools" | mcpx ui

Run 'mcpx <command> --help' for command-specific options.`);
}

const args = process.argv.slice(2);

if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
  printHelp();
  process.exit(0);
}

if (args[0] === "--version" || args[0] === "-V") {
  console.log(`mcpx v${version}`);
  process.exit(0);
}

const subcommand = args[0];
const rawArgv = args.slice(1);

if (!BINARY_MAP[subcommand]) {
  console.error(`mcpx: unknown subcommand '${subcommand}'`);
  console.error(`Run 'mcpx --help' for usage`);
  process.exit(1);
}

const config = loadConfig();
const binaryPath = resolveBinary(subcommand);
const argv = buildArgv(config, rawArgv);
spawnTool(binaryPath, argv);
