// ABOUTME: Resolves the absolute path to an underlying MCP tool's binary.
// ABOUTME: Uses Node module resolution to find the package, then reads its bin entry.

import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";

export const BINARY_MAP: Record<string, string> = {
  boot: "mcpboot",
  mod: "mcpblox",
  ui: "mcp-gen-ui",
};

const require = createRequire(import.meta.url);

export function resolveBinary(subcommand: string): string {
  const packageName = BINARY_MAP[subcommand];
  if (!packageName) {
    throw new Error(`mcpknife: unknown subcommand '${subcommand}'`);
  }

  let pkgJsonPath: string;
  try {
    pkgJsonPath = require.resolve(`${packageName}/package.json`);
  } catch {
    throw new Error(
      `mcpknife: package '${packageName}' not found. Try reinstalling: npm install -g mcpknife`
    );
  }

  const pkgRoot = path.dirname(pkgJsonPath);
  const pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));

  const binEntry =
    typeof pkgJson.bin === "string"
      ? pkgJson.bin
      : pkgJson.bin[packageName] || pkgJson.bin[Object.keys(pkgJson.bin)[0]];

  if (!binEntry) {
    throw new Error(
      `mcpknife: package '${packageName}' has no bin entry in its package.json`
    );
  }

  return path.resolve(pkgRoot, binEntry);
}
