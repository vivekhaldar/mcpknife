// ABOUTME: Tests for config file loading and merging.
// ABOUTME: Verifies ~/.mcpkniferc and ./.mcpkniferc are read, merged, and edge cases handled.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { loadConfig } from "../src/config.js";

// We test loadConfig by providing explicit paths rather than relying on
// os.homedir() and process.cwd(). The loadConfig function accepts optional
// overrides for testability.

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), "mcpknife-config-test-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("loadConfig", () => {
  it("returns empty config when no files exist", () => {
    const config = loadConfig({
      homeDir: path.join(tmpDir, "nonexistent-home"),
      cwd: path.join(tmpDir, "nonexistent-cwd"),
    });
    expect(config).toEqual({});
  });

  it("loads user config from ~/.mcpkniferc", () => {
    const homeDir = path.join(tmpDir, "home");
    mkdirSync(homeDir);
    writeFileSync(
      path.join(homeDir, ".mcpkniferc"),
      JSON.stringify({ provider: "anthropic", model: "claude-sonnet-4-20250514" })
    );

    const config = loadConfig({ homeDir, cwd: path.join(tmpDir, "nocwd") });
    expect(config.provider).toBe("anthropic");
    expect(config.model).toBe("claude-sonnet-4-20250514");
  });

  it("loads project config from ./.mcpkniferc", () => {
    const cwd = path.join(tmpDir, "project");
    mkdirSync(cwd);
    writeFileSync(
      path.join(cwd, ".mcpkniferc"),
      JSON.stringify({ provider: "openai", apiKey: "sk-test" })
    );

    const config = loadConfig({ homeDir: path.join(tmpDir, "nohome"), cwd });
    expect(config.provider).toBe("openai");
    expect(config.apiKey).toBe("sk-test");
  });

  it("project config overrides user config field by field", () => {
    const homeDir = path.join(tmpDir, "home");
    const cwd = path.join(tmpDir, "project");
    mkdirSync(homeDir);
    mkdirSync(cwd);

    writeFileSync(
      path.join(homeDir, ".mcpkniferc"),
      JSON.stringify({ provider: "anthropic", model: "claude-sonnet-4-20250514", apiKey: "home-key" })
    );
    writeFileSync(
      path.join(cwd, ".mcpkniferc"),
      JSON.stringify({ provider: "openai" })
    );

    const config = loadConfig({ homeDir, cwd });
    expect(config.provider).toBe("openai"); // overridden by project
    expect(config.model).toBe("claude-sonnet-4-20250514"); // kept from home
    expect(config.apiKey).toBe("home-key"); // kept from home
  });

  it("silently ignores missing files", () => {
    // No files at all — should not throw
    const config = loadConfig({
      homeDir: path.join(tmpDir, "nope"),
      cwd: path.join(tmpDir, "nope2"),
    });
    expect(config).toEqual({});
  });

  it("throws on malformed JSON with file path in error", () => {
    const homeDir = path.join(tmpDir, "home");
    mkdirSync(homeDir);
    const filePath = path.join(homeDir, ".mcpkniferc");
    writeFileSync(filePath, "{ not valid json }");

    expect(() =>
      loadConfig({ homeDir, cwd: path.join(tmpDir, "nocwd") })
    ).toThrow(/invalid JSON.*\.mcpkniferc/);
  });

  it("ignores unknown fields", () => {
    const homeDir = path.join(tmpDir, "home");
    mkdirSync(homeDir);
    writeFileSync(
      path.join(homeDir, ".mcpkniferc"),
      JSON.stringify({ provider: "anthropic", unknownField: "whatever", anotherOne: 42 })
    );

    const config = loadConfig({ homeDir, cwd: path.join(tmpDir, "nocwd") });
    expect(config.provider).toBe("anthropic");
    // Unknown fields pass through (we don't validate, don't error)
    expect((config as any).unknownField).toBe("whatever");
  });

  it("treats empty file as missing (no error)", () => {
    const homeDir = path.join(tmpDir, "home");
    mkdirSync(homeDir);
    writeFileSync(path.join(homeDir, ".mcpkniferc"), "");

    const config = loadConfig({ homeDir, cwd: path.join(tmpDir, "nocwd") });
    expect(config).toEqual({});
  });

  it("treats null JSON value as empty config", () => {
    const homeDir = path.join(tmpDir, "home");
    mkdirSync(homeDir);
    writeFileSync(path.join(homeDir, ".mcpkniferc"), "null");

    const config = loadConfig({ homeDir, cwd: path.join(tmpDir, "nocwd") });
    expect(config).toEqual({});
  });

  it("treats non-object JSON value as empty config", () => {
    const homeDir = path.join(tmpDir, "home");
    mkdirSync(homeDir);
    writeFileSync(path.join(homeDir, ".mcpkniferc"), '"just a string"');

    const config = loadConfig({ homeDir, cwd: path.join(tmpDir, "nocwd") });
    expect(config).toEqual({});
  });

  it("all fields are optional", () => {
    const homeDir = path.join(tmpDir, "home");
    mkdirSync(homeDir);
    writeFileSync(path.join(homeDir, ".mcpkniferc"), "{}");

    const config = loadConfig({ homeDir, cwd: path.join(tmpDir, "nocwd") });
    expect(config).toEqual({});
    expect(config.provider).toBeUndefined();
    expect(config.model).toBeUndefined();
    expect(config.apiKey).toBeUndefined();
    expect(config.verbose).toBeUndefined();
  });

  it("handles verbose boolean field", () => {
    const cwd = path.join(tmpDir, "project");
    mkdirSync(cwd);
    writeFileSync(
      path.join(cwd, ".mcpkniferc"),
      JSON.stringify({ verbose: true })
    );

    const config = loadConfig({ homeDir: path.join(tmpDir, "nohome"), cwd });
    expect(config.verbose).toBe(true);
  });
});
