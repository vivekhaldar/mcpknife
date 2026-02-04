// ABOUTME: Tests for config-to-argv injection logic.
// ABOUTME: Verifies config defaults are injected only when flags are absent from raw argv.

import { describe, it, expect } from "vitest";
import { buildArgv } from "../src/args.js";
import type { McpxConfig } from "../src/config.js";

describe("buildArgv", () => {
  it("injects provider from config when absent from argv", () => {
    const config: McpxConfig = { provider: "anthropic" };
    const result = buildArgv(config, ["--prompt", "test"]);
    expect(result).toEqual(["--provider", "anthropic", "--prompt", "test"]);
  });

  it("injects model from config when absent from argv", () => {
    const config: McpxConfig = { model: "claude-sonnet-4-20250514" };
    const result = buildArgv(config, ["--prompt", "test"]);
    expect(result).toEqual(["--model", "claude-sonnet-4-20250514", "--prompt", "test"]);
  });

  it("injects apiKey as --api-key when absent from argv", () => {
    const config: McpxConfig = { apiKey: "sk-test-123" };
    const result = buildArgv(config, ["--prompt", "test"]);
    expect(result).toEqual(["--api-key", "sk-test-123", "--prompt", "test"]);
  });

  it("injects verbose as boolean flag when true", () => {
    const config: McpxConfig = { verbose: true };
    const result = buildArgv(config, ["--prompt", "test"]);
    expect(result).toEqual(["--verbose", "--prompt", "test"]);
  });

  it("does not inject verbose when false", () => {
    const config: McpxConfig = { verbose: false };
    const result = buildArgv(config, ["--prompt", "test"]);
    expect(result).toEqual(["--prompt", "test"]);
  });

  it("does not inject provider when --provider is already in argv", () => {
    const config: McpxConfig = { provider: "anthropic" };
    const result = buildArgv(config, ["--provider", "openai", "--prompt", "test"]);
    expect(result).toEqual(["--provider", "openai", "--prompt", "test"]);
  });

  it("detects --flag=value form and skips injection", () => {
    const config: McpxConfig = { provider: "anthropic" };
    const result = buildArgv(config, ["--provider=openai", "--prompt", "test"]);
    expect(result).toEqual(["--provider=openai", "--prompt", "test"]);
  });

  it("returns raw argv unchanged when config is empty", () => {
    const config: McpxConfig = {};
    const rawArgv = ["--prompt", "test", "--port", "3000"];
    const result = buildArgv(config, rawArgv);
    expect(result).toEqual(rawArgv);
  });

  it("preserves original argv order with injected flags prepended", () => {
    const config: McpxConfig = { provider: "anthropic", model: "gpt-4" };
    const result = buildArgv(config, ["--prompt", "hello", "--port", "8080"]);
    expect(result).toEqual([
      "--provider", "anthropic",
      "--model", "gpt-4",
      "--prompt", "hello",
      "--port", "8080",
    ]);
  });

  it("injects multiple config values at once", () => {
    const config: McpxConfig = {
      provider: "anthropic",
      model: "claude-sonnet-4-20250514",
      apiKey: "sk-key",
      verbose: true,
    };
    const result = buildArgv(config, ["--prompt", "test"]);
    expect(result).toEqual([
      "--provider", "anthropic",
      "--model", "claude-sonnet-4-20250514",
      "--api-key", "sk-key",
      "--verbose",
      "--prompt", "test",
    ]);
  });

  it("skips injection for each flag individually when present", () => {
    const config: McpxConfig = {
      provider: "anthropic",
      model: "claude-sonnet-4-20250514",
      apiKey: "sk-key",
    };
    // model already provided on CLI
    const result = buildArgv(config, ["--model", "gpt-4", "--prompt", "test"]);
    expect(result).toEqual([
      "--provider", "anthropic",
      "--api-key", "sk-key",
      "--model", "gpt-4",
      "--prompt", "test",
    ]);
  });

  it("handles empty raw argv", () => {
    const config: McpxConfig = { provider: "anthropic" };
    const result = buildArgv(config, []);
    expect(result).toEqual(["--provider", "anthropic"]);
  });

  it("does not inject undefined config values", () => {
    const config: McpxConfig = { provider: undefined, model: undefined };
    const result = buildArgv(config, ["--prompt", "test"]);
    expect(result).toEqual(["--prompt", "test"]);
  });
});
