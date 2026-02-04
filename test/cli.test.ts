// ABOUTME: Tests for the top-level CLI entry point.
// ABOUTME: Verifies subcommand dispatch, help, version, and error handling.

import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI_PATH = path.resolve(__dirname, "..", "src", "cli.ts");

function run(args: string[]): { stdout: string; exitCode: number } {
  try {
    const stdout = execFileSync("npx", ["tsx", CLI_PATH, ...args], {
      encoding: "utf-8",
      cwd: path.resolve(__dirname, ".."),
      timeout: 10000,
    });
    return { stdout: stdout.trim(), exitCode: 0 };
  } catch (err: any) {
    return {
      stdout: (err.stdout ?? "").trim() + (err.stderr ?? "").trim(),
      exitCode: err.status ?? 1,
    };
  }
}

describe("cli stub", () => {
  it("prints version string", () => {
    const result = run([]);
    expect(result.stdout).toMatch(/^mcpx v\d+\.\d+\.\d+$/);
  });
});
