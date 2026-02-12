// ABOUTME: Tests for the export subcommand (pipeline crawling and project generation).
// ABOUTME: Uses fake metadata servers to simulate pipeline stages.

import { describe, it, expect, afterEach } from "vitest";
import { execFile, ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { parseExportArgs, crawlPipeline, fetchMetadata } from "../src/export.js";
import { generateProject } from "../src/codegen.js";
import type { StageMetadata } from "../src/export.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(__dirname, "fixtures");

// Start a fake metadata server from a JSON fixture file
function startFakeServer(
  metadataPath: string,
): Promise<{ url: string; proc: ChildProcess }> {
  return new Promise((resolve, reject) => {
    const proc = execFile(
      process.execPath,
      [
        "--import", "tsx",
        path.join(FIXTURES, "fake-metadata-server.js"),
        metadataPath,
      ],
      { timeout: 15000 },
    );

    let output = "";
    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error(`Server start timeout. Output: ${output}`));
    }, 10000);

    proc.stdout?.on("data", (data: string) => {
      output += data;
      const lines = output.split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith("http://")) {
          clearTimeout(timer);
          resolve({ url: trimmed, proc });
          return;
        }
      }
    });

    proc.stderr?.on("data", (data: string) => {
      output += data;
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`Server exited with code ${code}. Output: ${output}`));
      }
    });
  });
}

describe("parseExportArgs", () => {
  it("returns defaults with no args", () => {
    const result = parseExportArgs([]);
    expect(result.outputDir).toBe("./exported_mcp");
    expect(result.help).toBe(false);
  });

  it("parses --output-dir with space-separated value", () => {
    const result = parseExportArgs(["--output-dir", "/tmp/test"]);
    expect(result.outputDir).toBe("/tmp/test");
  });

  it("parses --output-dir= with equals sign", () => {
    const result = parseExportArgs(["--output-dir=/tmp/test"]);
    expect(result.outputDir).toBe("/tmp/test");
  });

  it("recognizes --help flag", () => {
    const result = parseExportArgs(["--help"]);
    expect(result.help).toBe(true);
  });

  it("recognizes -h flag", () => {
    const result = parseExportArgs(["-h"]);
    expect(result.help).toBe(true);
  });
});

describe("generateProject", () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it("generates a boot-only project", async () => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "export-test-"));
    const bootMetadata = JSON.parse(
      readFileSync(path.join(FIXTURES, "boot-metadata.json"), "utf-8"),
    );

    await generateProject([bootMetadata], tmpDir);

    // Verify file structure
    expect(existsSync(path.join(tmpDir, "package.json"))).toBe(true);
    expect(existsSync(path.join(tmpDir, "server.js"))).toBe(true);
    expect(existsSync(path.join(tmpDir, "README.md"))).toBe(true);
    expect(existsSync(path.join(tmpDir, "handlers", "greet.js"))).toBe(true);

    // Verify package.json content
    const pkg = JSON.parse(readFileSync(path.join(tmpDir, "package.json"), "utf-8"));
    expect(pkg.dependencies["@modelcontextprotocol/sdk"]).toBeDefined();
    expect(pkg.type).toBe("module");

    // Verify handler content
    const handler = readFileSync(path.join(tmpDir, "handlers", "greet.js"), "utf-8");
    expect(handler).toContain("Hello");

    // Verify server.js references the handler
    const serverJs = readFileSync(path.join(tmpDir, "server.js"), "utf-8");
    expect(serverJs).toContain("greet");
    expect(serverJs).toContain("ListToolsRequestSchema");
    expect(serverJs).toContain("CallToolRequestSchema");
  });

  it("generates a boot+mod project with synthetic tools", async () => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "export-test-"));
    const bootMetadata = JSON.parse(
      readFileSync(path.join(FIXTURES, "boot-metadata.json"), "utf-8"),
    );
    const modMetadata = JSON.parse(
      readFileSync(path.join(FIXTURES, "mod-metadata.json"), "utf-8"),
    );
    modMetadata.upstream_url = null; // No need for actual upstream in generation

    await generateProject([bootMetadata, modMetadata], tmpDir);

    // Verify structure
    expect(existsSync(path.join(tmpDir, "handlers", "greet.js"))).toBe(true);
    expect(existsSync(path.join(tmpDir, "orchestrations", "greet_loudly.js"))).toBe(true);

    // Verify orchestration content
    const orch = readFileSync(path.join(tmpDir, "orchestrations", "greet_loudly.js"), "utf-8");
    expect(orch).toContain("callTool");
    expect(orch).toContain("toUpperCase");

    // Server should expose greet_loudly but NOT greet (it's hidden)
    const serverJs = readFileSync(path.join(tmpDir, "server.js"), "utf-8");
    expect(serverJs).toContain("greet_loudly");
  });

  it("generates a project with UI resources", async () => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "export-test-"));
    const bootMetadata = JSON.parse(
      readFileSync(path.join(FIXTURES, "boot-metadata.json"), "utf-8"),
    );
    const uiMetadata: StageMetadata = {
      stage: "ui",
      version: "0.1.9",
      upstream_url: null,
      ui_resources: [
        {
          tool_name: "greet",
          resource_uri: "ui://greet",
          html: "<html><body>Greet UI</body></html>",
        },
      ],
    };

    await generateProject([bootMetadata, uiMetadata], tmpDir);

    expect(existsSync(path.join(tmpDir, "ui", "greet.html"))).toBe(true);
    const html = readFileSync(path.join(tmpDir, "ui", "greet.html"), "utf-8");
    expect(html).toContain("Greet UI");

    // Server should handle resources
    const serverJs = readFileSync(path.join(tmpDir, "server.js"), "utf-8");
    expect(serverJs).toContain("ListResourcesRequestSchema");
    expect(serverJs).toContain("ReadResourceRequestSchema");

    // Server should include _meta with UI resource URIs in ListTools
    expect(serverJs).toContain("toolResourceUris");
    expect(serverJs).toContain('_meta');
    expect(serverJs).toContain('ui://greet');
  });
});

describe("crawlPipeline (with fake servers)", () => {
  const servers: ChildProcess[] = [];

  afterEach(() => {
    for (const proc of servers) {
      proc.kill("SIGTERM");
    }
    servers.length = 0;
  });

  it("crawls a single-stage (boot) pipeline", async () => {
    const bootPath = path.join(FIXTURES, "boot-metadata.json");
    const { url, proc } = await startFakeServer(bootPath);
    servers.push(proc);

    const stages = await crawlPipeline(url);
    expect(stages).toHaveLength(1);
    expect(stages[0].stage).toBe("boot");
    expect(stages[0].upstream_url).toBeNull();
  }, 15000);

  it("crawls a two-stage (boot→mod) pipeline", async () => {
    // Start boot server
    const bootPath = path.join(FIXTURES, "boot-metadata.json");
    const bootServer = await startFakeServer(bootPath);
    servers.push(bootServer.proc);

    // Create mod metadata with boot's URL as upstream
    const modMetadata = JSON.parse(
      readFileSync(path.join(FIXTURES, "mod-metadata.json"), "utf-8"),
    );
    modMetadata.upstream_url = bootServer.url;

    // Write temporary mod metadata file
    const tmpModPath = path.join(os.tmpdir(), `mod-metadata-${Date.now()}.json`);
    const { writeFileSync: writeFs } = await import("node:fs");
    writeFs(tmpModPath, JSON.stringify(modMetadata));

    try {
      const modServer = await startFakeServer(tmpModPath);
      servers.push(modServer.proc);

      const stages = await crawlPipeline(modServer.url);
      expect(stages).toHaveLength(2);
      // Boot should be first (root)
      expect(stages[0].stage).toBe("boot");
      expect(stages[1].stage).toBe("mod");
    } finally {
      rmSync(tmpModPath, { force: true });
    }
  }, 20000);
});

describe("fetchMetadata", () => {
  const servers: ChildProcess[] = [];

  afterEach(() => {
    for (const proc of servers) {
      proc.kill("SIGTERM");
    }
    servers.length = 0;
  });

  it("fetches metadata from a fake server", async () => {
    const bootPath = path.join(FIXTURES, "boot-metadata.json");
    const { url, proc } = await startFakeServer(bootPath);
    servers.push(proc);

    const metadata = await fetchMetadata(url);
    expect(metadata.stage).toBe("boot");
    expect(metadata.version).toBe("0.1.2");
    expect(metadata.upstream_url).toBeNull();
  }, 15000);
});
