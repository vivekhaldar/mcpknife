// ABOUTME: Tests for binary resolution of underlying MCP tool packages.
// ABOUTME: Verifies resolveBinary returns valid paths for each subcommand.

import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { resolveBinary, BINARY_MAP } from "../src/resolve.js";

describe("resolveBinary", () => {
  it("resolves mcpboot to a valid file path", () => {
    const binaryPath = resolveBinary("boot");
    expect(binaryPath).toBeTruthy();
    expect(existsSync(binaryPath)).toBe(true);
  });

  it("resolves mcpblox to a valid file path", () => {
    const binaryPath = resolveBinary("mod");
    expect(binaryPath).toBeTruthy();
    expect(existsSync(binaryPath)).toBe(true);
  });

  it("resolves mcp-gen-ui to a valid file path", () => {
    const binaryPath = resolveBinary("ui");
    expect(binaryPath).toBeTruthy();
    expect(existsSync(binaryPath)).toBe(true);
  });

  it("returns an absolute path", () => {
    const binaryPath = resolveBinary("boot");
    expect(binaryPath).toMatch(/^\//);
  });

  it("throws a clear error for unknown subcommand", () => {
    expect(() => resolveBinary("bogus")).toThrow(
      /unknown subcommand.*bogus/i
    );
  });

  it("BINARY_MAP contains entries for boot, mod, and ui", () => {
    expect(BINARY_MAP).toEqual({
      boot: "mcpboot",
      mod: "mcpblox",
      ui: "mcp-gen-ui",
    });
  });
});
