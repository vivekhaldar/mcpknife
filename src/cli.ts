// ABOUTME: CLI entry point that parses subcommands and dispatches to underlying MCP tools.
// ABOUTME: Handles --help, --version, and delegates subcommand argv to the resolved binary.

import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

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

console.log(`mcpx v${version}`);
