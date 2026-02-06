// ABOUTME: Tests for the top-level CLI entry point.
// ABOUTME: Verifies subcommand dispatch, help, version, and error handling.

import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI_PATH = path.resolve(__dirname, "..", "src", "cli.ts");

function run(
  args: string[],
  options?: { cwd?: string }
): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execFileSync("npx", ["tsx", CLI_PATH, ...args], {
      encoding: "utf-8",
      cwd: options?.cwd ?? path.resolve(__dirname, ".."),
      timeout: 10000,
      stderr: "pipe",
    });
    return { stdout: stdout.trim(), stderr: "", exitCode: 0 };
  } catch (err: any) {
    return {
      stdout: (err.stdout ?? "").trim(),
      stderr: (err.stderr ?? "").trim(),
      exitCode: err.status ?? 1,
    };
  }
}

describe("cli", () => {
  describe("help", () => {
    it("prints help when no arguments provided", () => {
      const result = run([]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("mcpknife");
      expect(result.stdout).toContain("boot");
      expect(result.stdout).toContain("mod");
      expect(result.stdout).toContain("ui");
    });

    it("prints help with --help flag", () => {
      const result = run(["--help"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("mcpknife");
      expect(result.stdout).toContain("Commands:");
    });

    it("prints help with -h flag", () => {
      const result = run(["-h"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("mcpknife");
    });
  });

  describe("version", () => {
    it("prints version with --version flag", () => {
      const result = run(["--version"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toMatch(/^mcpknife v\d+\.\d+\.\d+$/);
    });

    it("prints version with -V flag", () => {
      const result = run(["-V"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toMatch(/^mcpknife v\d+\.\d+\.\d+$/);
    });
  });

  describe("unknown subcommand", () => {
    it("prints error and exits 1 for unknown subcommand", () => {
      const result = run(["bogus"]);
      expect(result.exitCode).toBe(1);
      const output = result.stderr || result.stdout;
      expect(output).toContain("unknown subcommand");
      expect(output).toContain("bogus");
    });
  });

  describe("subcommand dispatch", () => {
    it("dispatches boot to mcpboot", () => {
      const result = run(["boot", "--help"]);
      // mcpboot's help text should appear
      expect(result.exitCode).toBe(0);
    });

    it("dispatches mod to mcpblox", () => {
      const result = run(["mod", "--help"]);
      expect(result.exitCode).toBe(0);
    });

    it("dispatches ui to mcp-gen-ui", () => {
      const result = run(["ui", "--help"]);
      expect(result.exitCode).toBe(0);
    });
  });
});
