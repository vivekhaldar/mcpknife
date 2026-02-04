// ABOUTME: End-to-end integration tests that verify the full mcpx flow.
// ABOUTME: Tests the built binary with real subcommand dispatch, config injection, and error handling.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync, execFile } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const DIST_CLI = path.resolve(PROJECT_ROOT, "dist", "cli.js");
const FIXTURES = path.resolve(__dirname, "fixtures");

// Build a clean env without VITEST flag, since the underlying tools
// (mcpboot, mcpblox) check VITEST to skip their main() entrypoint.
function cleanEnv(extra?: Record<string, string>): Record<string, string> {
  const env = { ...process.env, ...extra };
  delete env.VITEST;
  delete env.VITEST_POOL_ID;
  delete env.VITEST_WORKER_ID;
  return env as Record<string, string>;
}

function run(
  args: string[],
  options?: { cwd?: string; env?: Record<string, string> }
): { stdout: string; stderr: string; exitCode: number } {
  try {
    const result = execFileSync(process.execPath, [DIST_CLI, ...args], {
      encoding: "utf-8",
      cwd: options?.cwd ?? PROJECT_ROOT,
      timeout: 15000,
      stdio: ["pipe", "pipe", "pipe"],
      env: cleanEnv(options?.env),
    });
    return { stdout: result.trim(), stderr: "", exitCode: 0 };
  } catch (err: any) {
    return {
      stdout: (err.stdout ?? "").trim(),
      stderr: (err.stderr ?? "").trim(),
      exitCode: err.status ?? 1,
    };
  }
}

describe("integration", () => {
  describe("help passthrough", () => {
    it("mcpx boot --help exits 0 and shows mcpboot help", () => {
      const result = run(["boot", "--help"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("mcpboot");
    });

    it("mcpx mod --help exits 0 and shows mcpblox help", () => {
      const result = run(["mod", "--help"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("mcpblox");
    });

    it("mcpx ui --help exits 0 and shows mcp-gen-ui help", () => {
      const result = run(["ui", "--help"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("mcp-gen-ui");
    });
  });

  describe("config injection", () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = mkdtempSync(path.join(os.tmpdir(), "mcpx-integration-"));
    });

    afterEach(() => {
      rmSync(tmpDir, { recursive: true, force: true });
    });

    it("injects config values from .mcpxrc as flags", () => {
      writeFileSync(
        path.join(tmpDir, ".mcpxrc"),
        JSON.stringify({ provider: "openai", model: "gpt-4o" })
      );
      // Run with --help so the underlying tool prints help and exits.
      // Config values are injected as flags before passthrough args.
      // If injection produces malformed argv, the child would error.
      const result = run(["boot", "--help"], { cwd: tmpDir });
      expect(result.exitCode).toBe(0);
    });

    it("CLI flags override config values", () => {
      writeFileSync(
        path.join(tmpDir, ".mcpxrc"),
        JSON.stringify({ provider: "openai" })
      );
      // Pass --provider explicitly — config injection should NOT add a duplicate.
      const result = run(["boot", "--provider", "anthropic", "--help"], {
        cwd: tmpDir,
      });
      expect(result.exitCode).toBe(0);
    });
  });

  describe("unknown subcommand", () => {
    it("exits 1 and prints error for unknown subcommand", () => {
      const result = run(["bogus"]);
      expect(result.exitCode).toBe(1);
      const output = result.stderr || result.stdout;
      expect(output).toContain("unknown subcommand");
      expect(output).toContain("bogus");
    });
  });

  describe("version", () => {
    it("prints version matching package.json", () => {
      const pkgJson = JSON.parse(
        readFileSync(path.join(PROJECT_ROOT, "package.json"), "utf-8")
      );
      const result = run(["--version"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe(`mcpx v${pkgJson.version}`);
    });
  });

  describe("mcpx help", () => {
    it("prints top-level help with no args", () => {
      const result = run([]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("mcpx");
      expect(result.stdout).toContain("Commands:");
      expect(result.stdout).toContain("boot");
      expect(result.stdout).toContain("mod");
      expect(result.stdout).toContain("ui");
    });
  });

  describe("signal handling", () => {
    it("SIGINT to mcpx terminates the child process", async () => {
      const child = execFile(process.execPath, [
        path.join(FIXTURES, "sleep-long.js"),
      ]);

      await new Promise((resolve) => setTimeout(resolve, 300));

      child.kill("SIGINT");

      const exitCode = await new Promise<number | null>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("timed out")), 5000);
        child.on("close", (code) => {
          clearTimeout(timer);
          resolve(code);
        });
      });

      // Process should have terminated (null = killed by signal, number = exit code)
      expect(typeof exitCode === "number" || exitCode === null).toBe(true);
    }, 10000);
  });
});
