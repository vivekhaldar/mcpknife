// ABOUTME: Pipeline crawler and orchestrator for the export subcommand.
// ABOUTME: Reads upstream URL from stdin, walks _mcp_metadata chain, delegates to codegen.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { generateProject } from "./codegen.js";

export interface StageMetadata {
  stage: string;
  version: string;
  upstream_url: string | null;
  [key: string]: unknown;
}

export function parseExportArgs(argv: string[]): { outputDir: string; help: boolean } {
  let outputDir = "./exported_mcp";
  let help = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      help = true;
    } else if (arg === "--output-dir" && i + 1 < argv.length) {
      outputDir = argv[++i];
    } else if (arg.startsWith("--output-dir=")) {
      outputDir = arg.slice("--output-dir=".length);
    }
  }

  return { outputDir, help };
}

function printExportHelp(): void {
  console.log(`mcpknife export — dump a self-contained MCP server project to disk

Usage:
  mcpknife export [--output-dir <dir>]

Options:
  --output-dir <dir>  Output directory (default: ./exported_mcp)
  --help              Show this help message

The export command reads an upstream MCP server URL from stdin (pipe protocol)
and recursively walks the _mcp_metadata chain to collect all implementation code,
then combines it into a standalone Node.js project.

Examples:
  mcpknife boot --prompt "Dictionary API" | mcpknife export
  mcpknife boot ... | mcpknife mod ... | mcpknife export --output-dir ./my-server
  mcpknife boot ... | mcpknife mod ... | mcpknife ui | mcpknife export`);
}

export function readUrlFromStdin(timeoutMs: number = 120000): Promise<string> {
  return new Promise((resolve, reject) => {
    if (process.stdin.isTTY) {
      reject(new Error(
        "export reads upstream URL from stdin pipe.\n" +
        "Usage: mcpknife boot ... | mcpknife export\n" +
        "   or: mcpknife boot ... | mcpknife mod ... | mcpknife export"
      ));
      return;
    }

    let data = "";
    const timer = setTimeout(() => {
      process.stdin.removeAllListeners();
      process.stdin.destroy();
      reject(new Error("Timed out waiting for upstream URL on stdin"));
    }, timeoutMs);

    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (chunk: string) => {
      data += chunk;
      // Look for a complete URL line
      const lines = data.split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
          clearTimeout(timer);
          process.stdin.removeAllListeners();
          process.stdin.destroy();
          resolve(trimmed);
          return;
        }
      }
    });

    process.stdin.on("end", () => {
      clearTimeout(timer);
      const trimmed = data.trim();
      if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
        resolve(trimmed);
      } else {
        reject(new Error(`Invalid upstream URL on stdin: "${trimmed.slice(0, 100)}"`));
      }
    });

    process.stdin.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    process.stdin.resume();
  });
}

export async function fetchMetadata(url: string): Promise<StageMetadata> {
  const client = new Client(
    { name: "mcpknife-export", version: "0.1.0" },
    { capabilities: {} },
  );

  const transport = new StreamableHTTPClientTransport(new URL(url));
  await client.connect(transport);

  try {
    const result = await client.callTool(
      { name: "_mcp_metadata", arguments: {} },
      undefined,
      { timeout: 300000 },
    );

    const content = result.content as Array<{ type: string; text: string }>;
    if (!content || content.length === 0 || !content[0].text) {
      throw new Error(`Empty _mcp_metadata response from ${url}`);
    }

    return JSON.parse(content[0].text) as StageMetadata;
  } finally {
    await client.close();
  }
}

export async function crawlPipeline(url: string): Promise<StageMetadata[]> {
  const stages: StageMetadata[] = [];
  let currentUrl: string | null = url;

  while (currentUrl) {
    const metadata = await fetchMetadata(currentUrl);
    stages.push(metadata);
    currentUrl = metadata.upstream_url ?? null;
  }

  // Reverse so boot is first (root of chain)
  stages.reverse();
  return stages;
}

export async function runExport(argv: string[]): Promise<void> {
  const { outputDir, help } = parseExportArgs(argv);

  if (help) {
    printExportHelp();
    return;
  }

  // Read upstream URL from stdin
  console.error("[export] Reading upstream URL from stdin...");
  const url = await readUrlFromStdin();
  console.error(`[export] Upstream URL: ${url}`);

  // Crawl the pipeline
  console.error("[export] Crawling pipeline metadata...");
  const stages = await crawlPipeline(url);
  console.error(`[export] Found ${stages.length} stage(s): ${stages.map(s => s.stage).join(" → ")}`);

  // Generate project
  console.error(`[export] Generating project in ${outputDir}...`);
  await generateProject(stages, outputDir);
  console.error(`[export] Done! Project written to ${outputDir}`);
  console.error(`[export] To run: cd ${outputDir} && npm install && node server.js`);
}
