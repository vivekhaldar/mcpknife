// ABOUTME: Tests for the deploy subcommand (arg parsing, validation, Dockerfile, Fly commands).
// ABOUTME: Does not perform actual deployments — tests the building blocks.

import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { parseDeployArgs, validateProjectDir, formatDeployOutput } from "../src/deploy.js";
import {
  generateDockerfile,
  buildFlyLaunchArgs,
  buildFlySecretsArgs,
  buildFlyDeployArgs,
  buildFlyDestroyArgs,
} from "../src/providers/fly.js";
import { generateProject } from "../src/codegen.js";
import type { StageMetadata } from "../src/export.js";

describe("parseDeployArgs", () => {
  it("returns defaults with no args", () => {
    const result = parseDeployArgs([]);
    expect(result.target).toBe("fly");
    expect(result.name).toBeNull();
    expect(result.region).toBeUndefined();
    expect(result.env).toEqual({});
    expect(result.apiKey).toBeNull();
    expect(result.destroy).toBe(false);
    expect(result.help).toBe(false);
    expect(result.projectDir).toBeNull();
  });

  it("parses --target with space-separated value", () => {
    const result = parseDeployArgs(["--target", "cloudrun"]);
    expect(result.target).toBe("cloudrun");
  });

  it("parses --target= with equals sign", () => {
    const result = parseDeployArgs(["--target=cloudrun"]);
    expect(result.target).toBe("cloudrun");
  });

  it("parses --name with space-separated value", () => {
    const result = parseDeployArgs(["--name", "my-app"]);
    expect(result.name).toBe("my-app");
  });

  it("parses --name= with equals sign", () => {
    const result = parseDeployArgs(["--name=my-app"]);
    expect(result.name).toBe("my-app");
  });

  it("parses --region with space-separated value", () => {
    const result = parseDeployArgs(["--region", "lax"]);
    expect(result.region).toBe("lax");
  });

  it("parses --region= with equals sign", () => {
    const result = parseDeployArgs(["--region=lax"]);
    expect(result.region).toBe("lax");
  });

  it("parses single --env pair", () => {
    const result = parseDeployArgs(["--env", "FOO=bar"]);
    expect(result.env).toEqual({ FOO: "bar" });
  });

  it("parses multiple --env pairs", () => {
    const result = parseDeployArgs(["--env", "FOO=bar", "--env", "BAZ=qux"]);
    expect(result.env).toEqual({ FOO: "bar", BAZ: "qux" });
  });

  it("parses --env= with equals sign", () => {
    const result = parseDeployArgs(["--env=FOO=bar"]);
    expect(result.env).toEqual({ FOO: "bar" });
  });

  it("parses --api-key with space-separated value", () => {
    const result = parseDeployArgs(["--api-key", "secret123"]);
    expect(result.apiKey).toBe("secret123");
  });

  it("parses --api-key= with equals sign", () => {
    const result = parseDeployArgs(["--api-key=secret123"]);
    expect(result.apiKey).toBe("secret123");
  });

  it("recognizes --destroy flag", () => {
    const result = parseDeployArgs(["--destroy"]);
    expect(result.destroy).toBe(true);
  });

  it("recognizes --help flag", () => {
    const result = parseDeployArgs(["--help"]);
    expect(result.help).toBe(true);
  });

  it("recognizes -h flag", () => {
    const result = parseDeployArgs(["-h"]);
    expect(result.help).toBe(true);
  });

  it("parses positional directory argument", () => {
    const result = parseDeployArgs(["./my-project"]);
    expect(result.projectDir).toBe("./my-project");
  });

  it("parses positional dir with other flags", () => {
    const result = parseDeployArgs(["--name", "my-app", "./my-project", "--region", "lax"]);
    expect(result.projectDir).toBe("./my-project");
    expect(result.name).toBe("my-app");
    expect(result.region).toBe("lax");
  });

  it("parses a full set of flags", () => {
    const result = parseDeployArgs([
      "--target", "fly",
      "--name", "my-api",
      "--region", "ord",
      "--env", "DB_URL=postgres://...",
      "--api-key", "sk-test",
      "./exported",
    ]);
    expect(result.target).toBe("fly");
    expect(result.name).toBe("my-api");
    expect(result.region).toBe("ord");
    expect(result.env).toEqual({ "DB_URL": "postgres://..." });
    expect(result.apiKey).toBe("sk-test");
    expect(result.projectDir).toBe("./exported");
  });
});

describe("validateProjectDir", () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it("rejects directory missing package.json", () => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "deploy-test-"));
    writeFileSync(path.join(tmpDir, "server.js"), "// server");

    expect(() => validateProjectDir(tmpDir)).toThrow("missing package.json");
  });

  it("rejects directory missing server.js", () => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "deploy-test-"));
    writeFileSync(path.join(tmpDir, "package.json"), "{}");

    expect(() => validateProjectDir(tmpDir)).toThrow("missing server.js");
  });

  it("accepts directory with both package.json and server.js", () => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "deploy-test-"));
    writeFileSync(path.join(tmpDir, "package.json"), "{}");
    writeFileSync(path.join(tmpDir, "server.js"), "// server");

    expect(() => validateProjectDir(tmpDir)).not.toThrow();
  });
});

describe("generateDockerfile", () => {
  it("generates a valid Dockerfile", () => {
    const dockerfile = generateDockerfile();
    expect(dockerfile).toContain("FROM node:20-slim");
    expect(dockerfile).toContain("WORKDIR /app");
    expect(dockerfile).toContain("COPY package.json");
    expect(dockerfile).toContain("RUN npm install --omit=dev");
    expect(dockerfile).toContain("COPY . .");
    expect(dockerfile).toContain("ENV PORT=8080");
    expect(dockerfile).toContain("EXPOSE 8080");
    expect(dockerfile).toContain('CMD ["node", "server.js"]');
  });
});

describe("Fly provider command construction", () => {
  it("builds fly launch args with name only", () => {
    const args = buildFlyLaunchArgs("my-app");
    expect(args).toEqual(["launch", "--no-deploy", "--name", "my-app", "--yes"]);
  });

  it("builds fly launch args with name and region", () => {
    const args = buildFlyLaunchArgs("my-app", "lax");
    expect(args).toEqual(["launch", "--no-deploy", "--name", "my-app", "--yes", "--region", "lax"]);
  });

  it("builds fly secrets args with API key only", () => {
    const args = buildFlySecretsArgs("my-app", "sk-test", {});
    expect(args).toEqual(["secrets", "set", "MCP_API_KEY=sk-test", "--app", "my-app"]);
  });

  it("builds fly secrets args with extra env vars", () => {
    const args = buildFlySecretsArgs("my-app", "sk-test", { DB_URL: "postgres://..." });
    expect(args).toEqual([
      "secrets", "set",
      "MCP_API_KEY=sk-test",
      "DB_URL=postgres://...",
      "--app", "my-app",
    ]);
  });

  it("builds fly deploy args", () => {
    const args = buildFlyDeployArgs("my-app");
    expect(args).toEqual(["deploy", "--app", "my-app"]);
  });

  it("builds fly destroy args", () => {
    const args = buildFlyDestroyArgs("my-app");
    expect(args).toEqual(["apps", "destroy", "my-app", "--yes"]);
  });
});

describe("formatDeployOutput", () => {
  it("writes URL to stdout", () => {
    const result = formatDeployOutput({
      url: "https://my-app.fly.dev/mcp",
      name: "my-app",
      target: "fly",
      apiKey: "sk-test",
      dashboardUrl: "https://fly.io/apps/my-app",
    });

    expect(result.stdout).toBe("https://my-app.fly.dev/mcp\n");
  });

  it("writes summary to stderr with endpoint, key, dashboard", () => {
    const result = formatDeployOutput({
      url: "https://my-app.fly.dev/mcp",
      name: "my-app",
      target: "fly",
      apiKey: "sk-test",
      dashboardUrl: "https://fly.io/apps/my-app",
    });

    expect(result.stderr).toContain("Endpoint: https://my-app.fly.dev/mcp");
    expect(result.stderr).toContain("API Key:  sk-test");
    expect(result.stderr).toContain("Dashboard: https://fly.io/apps/my-app");
  });

  it("includes Claude Desktop config snippet", () => {
    const result = formatDeployOutput({
      url: "https://my-app.fly.dev/mcp",
      name: "my-app",
      target: "fly",
      apiKey: "sk-test",
    });

    expect(result.stderr).toContain("Claude Desktop config");
    expect(result.stderr).toContain('"my-app"');
    expect(result.stderr).toContain("Bearer sk-test");
  });

  it("omits dashboard line when not provided", () => {
    const result = formatDeployOutput({
      url: "https://my-app.fly.dev/mcp",
      name: "my-app",
      target: "fly",
      apiKey: "sk-test",
    });

    expect(result.stderr).not.toContain("Dashboard:");
  });
});

describe("codegen auth", () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it("generated server.js contains MCP_API_KEY auth check", async () => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "deploy-auth-test-"));
    const bootMetadata: StageMetadata = {
      stage: "boot",
      version: "0.1.0",
      upstream_url: null,
      whitelist_domains: [],
      tools: [{
        name: "test_tool",
        description: "A test tool",
        input_schema: { type: "object", properties: {} },
        handler_code: 'return { content: [{ type: "text", text: "ok" }] };',
        needs_network: false,
      }],
    };

    await generateProject([bootMetadata], tmpDir);

    const serverJs = readFileSync(path.join(tmpDir, "server.js"), "utf-8");
    expect(serverJs).toContain("MCP_API_KEY");
    expect(serverJs).toContain('process.env.MCP_API_KEY');
    expect(serverJs).toContain('"Bearer "');
    expect(serverJs).toContain("401");
    expect(serverJs).toContain('req.url !== "/health"');
  });

  it("generated server.js binds to 0.0.0.0 by default", async () => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "deploy-host-test-"));
    const bootMetadata: StageMetadata = {
      stage: "boot",
      version: "0.1.0",
      upstream_url: null,
      whitelist_domains: [],
      tools: [{
        name: "test_tool",
        description: "A test tool",
        input_schema: { type: "object", properties: {} },
        handler_code: 'return { content: [{ type: "text", text: "ok" }] };',
        needs_network: false,
      }],
    };

    await generateProject([bootMetadata], tmpDir);

    const serverJs = readFileSync(path.join(tmpDir, "server.js"), "utf-8");
    expect(serverJs).toContain('process.env.HOST || "0.0.0.0"');
    expect(serverJs).toContain("httpServer.listen(PORT, HOST");
  });

  it("generated server.js includes Authorization in CORS headers", async () => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "deploy-cors-test-"));
    const bootMetadata: StageMetadata = {
      stage: "boot",
      version: "0.1.0",
      upstream_url: null,
      whitelist_domains: [],
      tools: [{
        name: "test_tool",
        description: "A test tool",
        input_schema: { type: "object", properties: {} },
        handler_code: 'return { content: [{ type: "text", text: "ok" }] };',
        needs_network: false,
      }],
    };

    await generateProject([bootMetadata], tmpDir);

    const serverJs = readFileSync(path.join(tmpDir, "server.js"), "utf-8");
    expect(serverJs).toContain("Authorization");
  });
});
