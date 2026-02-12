// ABOUTME: Generates a standalone MCP server project from collected pipeline metadata.
// ABOUTME: Writes package.json, server.js, handler files, and README to the output directory.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { StageMetadata } from "./export.js";

interface BootTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  handler_code: string;
  needs_network: boolean;
}

interface PassThroughTool {
  exposed_name: string;
  upstream_name: string;
  exposed_schema: Record<string, unknown>;
  description?: string;
  input_transform_code: string | null;
  output_transform_code: string | null;
}

interface SyntheticTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  orchestration_code: string;
  upstream_tools_used: string[];
}

interface UIResource {
  tool_name: string;
  resource_uri: string;
  html: string;
}

interface BootStage extends StageMetadata {
  stage: "boot";
  whitelist_domains: string[];
  tools: BootTool[];
}

interface ModStage extends StageMetadata {
  stage: "mod";
  hidden_tools: string[];
  pass_through_tools: PassThroughTool[];
  synthetic_tools: SyntheticTool[];
}

interface UIStage extends StageMetadata {
  stage: "ui";
  ui_resources: UIResource[];
}

function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

function writeJSON(filePath: string, data: unknown): void {
  writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n");
}

function writeText(filePath: string, content: string): void {
  writeFileSync(filePath, content);
}

function generatePackageJson(stages: StageMetadata[]): object {
  const stageNames = stages.map(s => s.stage).join("+");
  return {
    name: "exported-mcp-server",
    version: "1.0.0",
    description: `Standalone MCP server exported from mcpknife pipeline (${stageNames})`,
    type: "module",
    main: "server.js",
    scripts: {
      start: "node server.js",
    },
    dependencies: {
      "@modelcontextprotocol/sdk": "^1.12.1",
    },
  };
}

function generateReadme(stages: StageMetadata[]): string {
  const lines = [
    "# Exported MCP Server",
    "",
    `Standalone server exported from a mcpknife pipeline with ${stages.length} stage(s).`,
    "",
    "## Quick Start",
    "",
    "```bash",
    "npm install",
    "node server.js",
    "```",
    "",
    `The server listens on \`http://localhost:\${PORT}/mcp\` (default PORT=8000).`,
    "",
    "## Pipeline Stages",
    "",
  ];

  for (const stage of stages) {
    lines.push(`### ${stage.stage} (v${stage.version})`);
    lines.push("");

    if (stage.stage === "boot") {
      const boot = stage as BootStage;
      lines.push(`Tools: ${boot.tools.map(t => t.name).join(", ")}`);
      if (boot.whitelist_domains.length > 0) {
        lines.push(`Network domains: ${boot.whitelist_domains.join(", ")}`);
      }
    } else if (stage.stage === "mod") {
      const mod = stage as ModStage;
      if (mod.pass_through_tools.length > 0) {
        lines.push(`Pass-through: ${mod.pass_through_tools.map(t => t.exposed_name).join(", ")}`);
      }
      if (mod.synthetic_tools.length > 0) {
        lines.push(`Synthetic: ${mod.synthetic_tools.map(t => t.name).join(", ")}`);
      }
      if (mod.hidden_tools.length > 0) {
        lines.push(`Hidden: ${mod.hidden_tools.join(", ")}`);
      }
    } else if (stage.stage === "ui") {
      const ui = stage as UIStage;
      lines.push(`UI resources: ${ui.ui_resources.map(r => r.tool_name).join(", ")}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

// Build the set of tools that should be exposed (visible to clients)
function getExposedTools(stages: StageMetadata[]): Array<{
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}> {
  const boot = stages.find(s => s.stage === "boot") as BootStage | undefined;
  const mod = stages.find(s => s.stage === "mod") as ModStage | undefined;

  if (mod) {
    // Mod stage defines which tools are exposed
    const tools: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }> = [];
    for (const t of mod.pass_through_tools) {
      tools.push({
        name: t.exposed_name,
        description: t.description || "",
        inputSchema: t.exposed_schema,
      });
    }
    for (const t of mod.synthetic_tools) {
      tools.push({
        name: t.name,
        description: t.description,
        inputSchema: t.input_schema,
      });
    }
    return tools;
  }

  if (boot) {
    // Boot-only: all tools are exposed
    return boot.tools.map(t => ({
      name: t.name,
      description: t.description,
      inputSchema: t.input_schema,
    }));
  }

  return [];
}

function generateServerJs(stages: StageMetadata[]): string {
  const boot = stages.find(s => s.stage === "boot") as BootStage | undefined;
  const mod = stages.find(s => s.stage === "mod") as ModStage | undefined;
  const ui = stages.find(s => s.stage === "ui") as UIStage | undefined;

  const hasNetwork = boot?.tools.some(t => t.needs_network) ?? false;
  const whitelistDomains = boot?.whitelist_domains ?? [];

  const exposedTools = getExposedTools(stages);

  // Build imports section
  const importLines = [
    'import { Server } from "@modelcontextprotocol/sdk/server/index.js";',
    'import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";',
    'import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";',
    'import http from "node:http";',
    'import vm from "node:vm";',
    'import { readFileSync } from "node:fs";',
    'import { fileURLToPath } from "node:url";',
    'import path from "node:path";',
  ];

  if (ui) {
    importLines.push(
      'import { ListResourcesRequestSchema, ReadResourceRequestSchema } from "@modelcontextprotocol/sdk/types.js";',
    );
  }

  // Build sandbox and dispatch code
  const parts: string[] = [];

  parts.push(importLines.join("\n"));
  parts.push("");
  parts.push('const __filename = fileURLToPath(import.meta.url);');
  parts.push('const __dirname = path.dirname(__filename);');
  parts.push("");

  // Whitelisted fetch for network-enabled tools
  if (hasNetwork) {
    parts.push(`const WHITELIST_DOMAINS = ${JSON.stringify(whitelistDomains)};`);
    parts.push("");
    parts.push(`function isAllowed(url) {
  try {
    const hostname = new URL(url).hostname;
    return WHITELIST_DOMAINS.some(d => hostname === d || hostname.endsWith("." + d));
  } catch {
    return false;
  }
}

const whitelistedFetch = (url, opts) => {
  if (!isAllowed(url)) {
    throw new Error("Network access denied: " + url);
  }
  return fetch(url, opts);
};`);
    parts.push("");
  }

  // Sandbox runner
  parts.push(`const SANDBOX_TIMEOUT_MS = 30000;

function runHandler(code, args) {
  const sandbox = {
    args,
    JSON, Math, String, Number, Boolean, Array, Object, Map, Set,
    Date, RegExp, parseInt, parseFloat, isNaN, isFinite,
    structuredClone, console: { log: console.log },
    Promise,${hasNetwork ? "\n    fetch: whitelistedFetch," : ""}
  };

  const context = vm.createContext(sandbox);
  const wrappedCode = "(async function(args) { " + code + " })(args)";
  const script = new vm.Script(wrappedCode);
  return script.runInContext(context, { timeout: SANDBOX_TIMEOUT_MS });
}`);
  parts.push("");

  // Boot handler loader
  if (boot) {
    parts.push(`// Boot tool handlers
const bootHandlers = new Map();
${boot.tools.map(t =>
  `bootHandlers.set(${JSON.stringify(t.name)}, readFileSync(path.join(__dirname, "handlers", ${JSON.stringify(t.name + ".js")}), "utf-8"));`
).join("\n")}`);
    parts.push("");

    parts.push(`async function callBootTool(name, args) {
  const code = bootHandlers.get(name);
  if (!code) throw new Error("Unknown boot tool: " + name);
  return runHandler(code, args);
}`);
    parts.push("");
  }

  // Mod dispatch
  if (mod) {
    // Load transforms
    if (mod.pass_through_tools.some(t => t.input_transform_code || t.output_transform_code)) {
      parts.push(`// Mod transforms
const transforms = new Map();
${mod.pass_through_tools.filter(t => t.input_transform_code || t.output_transform_code).map(t =>
  `transforms.set(${JSON.stringify(t.exposed_name)}, JSON.parse(readFileSync(path.join(__dirname, "transforms", ${JSON.stringify(t.exposed_name + ".json")}), "utf-8")));`
).join("\n")}`);
      parts.push("");
    }

    // Load orchestrations
    if (mod.synthetic_tools.length > 0) {
      parts.push(`// Synthetic tool orchestrations
const orchestrations = new Map();
${mod.synthetic_tools.map(t =>
  `orchestrations.set(${JSON.stringify(t.name)}, readFileSync(path.join(__dirname, "orchestrations", ${JSON.stringify(t.name + ".js")}), "utf-8"));`
).join("\n")}`);
      parts.push("");
    }

    // Dispatch map: exposed_name → upstream_name
    parts.push(`const toolRouting = new Map();`);
    for (const t of mod.pass_through_tools) {
      parts.push(`toolRouting.set(${JSON.stringify(t.exposed_name)}, ${JSON.stringify(t.upstream_name)});`);
    }
    parts.push("");
  }

  // Main dispatch function
  parts.push(`async function dispatchTool(name, args) {`);

  if (mod) {
    // Check synthetic first
    parts.push(`  // Synthetic tools
  if (orchestrations && orchestrations.has(name)) {
    const code = orchestrations.get(name);
    const callTool = async (n, a) => callBootTool(n, a);
    const sandbox = {
      args, callTool,
      JSON, Math, String, Number, Boolean, Array, Object, Map, Set,
      Date, RegExp, parseInt, parseFloat, isNaN, isFinite,
      structuredClone, console: { log: console.log },
      Promise,${hasNetwork ? "\n      fetch: whitelistedFetch," : ""}
    };
    const context = vm.createContext(sandbox);
    const wrappedCode = "(async function(args, callTool) { " + code + " })(args, callTool)";
    const script = new vm.Script(wrappedCode);
    return script.runInContext(context, { timeout: SANDBOX_TIMEOUT_MS });
  }`);
    parts.push("");

    // Check routed tools (pass-through and modified)
    parts.push(`  // Pass-through and modified tools
  const upstreamName = toolRouting.get(name);
  if (upstreamName !== undefined) {
    let callArgs = args;

    // Apply input transform if present
    const transform = transforms ? transforms.get(name) : undefined;
    if (transform && transform.input_transform_code) {
      try {
        const fn = new Function("args", transform.input_transform_code);
        callArgs = fn(args);
      } catch (err) {
        console.error("Input transform error for " + name + ": " + err);
      }
    }

    // Call boot handler
    let result = await callBootTool(upstreamName, callArgs);

    // Apply output transform if present
    if (transform && transform.output_transform_code) {
      try {
        const fn = new Function("result", transform.output_transform_code);
        result = fn(result);
      } catch (err) {
        console.error("Output transform error for " + name + ": " + err);
      }
    }

    return result;
  }`);
    parts.push("");
  }

  if (boot && !mod) {
    // Boot-only: dispatch directly
    parts.push(`  return callBootTool(name, args);`);
  } else {
    parts.push(`  return { content: [{ type: "text", text: "Unknown tool: " + name }], isError: true };`);
  }

  parts.push(`}`);
  parts.push("");

  // Tool definitions for listing
  parts.push(`const TOOLS = ${JSON.stringify(exposedTools, null, 2)};`);
  parts.push("");

  // UI resources
  if (ui && ui.ui_resources.length > 0) {
    parts.push(`// UI resources
const uiResources = new Map();
${ui.ui_resources.map(r =>
  `uiResources.set(${JSON.stringify(r.resource_uri)}, {
  toolName: ${JSON.stringify(r.tool_name)},
  html: readFileSync(path.join(__dirname, "ui", ${JSON.stringify(r.tool_name + ".html")}), "utf-8"),
});`
).join("\n")}`);
    parts.push("");
  }

  // HTTP server
  parts.push(`const PORT = parseInt(process.env.PORT || "8000", 10);

const httpServer = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, mcp-session-id");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === "POST" && (req.url === "/mcp" || req.url === "/")) {
    const mcpServer = new Server(
      { name: "exported-mcp-server", version: "1.0.0" },
      { capabilities: { tools: {}${ui ? ", resources: {}" : ""} } },
    );

    mcpServer.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: TOOLS.map(t => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      })),
    }));

    mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      return dispatchTool(name, args || {});
    });`);

  if (ui && ui.ui_resources.length > 0) {
    parts.push(`
    mcpServer.setRequestHandler(ListResourcesRequestSchema, async () => ({
      resources: Array.from(uiResources.entries()).map(([uri, r]) => ({
        uri,
        name: r.toolName + " UI",
        description: "Generated interactive UI for " + r.toolName,
        mimeType: "text/html",
      })),
    }));

    mcpServer.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const uri = request.params.uri;
      const resource = uiResources.get(uri);
      if (!resource) throw new Error("Unknown resource: " + uri);
      return {
        contents: [{ uri, mimeType: "text/html", text: resource.html }],
      };
    });`);
  }

  parts.push(`
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString());
      await mcpServer.connect(transport);
      await transport.handleRequest(req, res, body);
      res.on("close", () => {
        transport.close();
        mcpServer.close();
      });
    } catch (error) {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          jsonrpc: "2.0",
          error: { code: -32603, message: String(error) },
          id: null,
        }));
      }
    }
  } else if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", tools: TOOLS.length }));
  } else {
    res.writeHead(404);
    res.end("Not found");
  }
});

httpServer.listen(PORT, () => {
  console.log("Exported MCP server listening on http://localhost:" + PORT + "/mcp");
  console.log("Serving " + TOOLS.length + " tool(s)");
});

process.on("SIGINT", () => { httpServer.close(); process.exit(0); });
process.on("SIGTERM", () => { httpServer.close(); process.exit(0); });`);

  return parts.join("\n");
}

export async function generateProject(stages: StageMetadata[], outputDir: string): Promise<void> {
  const absDir = path.resolve(outputDir);
  ensureDir(absDir);

  const boot = stages.find(s => s.stage === "boot") as BootStage | undefined;
  const mod = stages.find(s => s.stage === "mod") as ModStage | undefined;
  const ui = stages.find(s => s.stage === "ui") as UIStage | undefined;

  // Write package.json
  writeJSON(path.join(absDir, "package.json"), generatePackageJson(stages));

  // Write handler files (from boot stage)
  if (boot) {
    const handlersDir = path.join(absDir, "handlers");
    ensureDir(handlersDir);
    for (const tool of boot.tools) {
      writeText(path.join(handlersDir, `${tool.name}.js`), tool.handler_code);
    }
  }

  // Write transform files (from mod stage)
  if (mod) {
    const modifiedTools = mod.pass_through_tools.filter(
      t => t.input_transform_code || t.output_transform_code
    );
    if (modifiedTools.length > 0) {
      const transformsDir = path.join(absDir, "transforms");
      ensureDir(transformsDir);
      for (const tool of modifiedTools) {
        writeJSON(path.join(transformsDir, `${tool.exposed_name}.json`), {
          input_transform_code: tool.input_transform_code,
          output_transform_code: tool.output_transform_code,
        });
      }
    }

    // Write orchestration files (synthetic tools)
    if (mod.synthetic_tools.length > 0) {
      const orchDir = path.join(absDir, "orchestrations");
      ensureDir(orchDir);
      for (const tool of mod.synthetic_tools) {
        writeText(path.join(orchDir, `${tool.name}.js`), tool.orchestration_code);
      }
    }
  }

  // Write UI files
  if (ui && ui.ui_resources.length > 0) {
    const uiDir = path.join(absDir, "ui");
    ensureDir(uiDir);
    for (const resource of ui.ui_resources) {
      writeText(path.join(uiDir, `${resource.tool_name}.html`), resource.html);
    }
  }

  // Write server.js
  writeText(path.join(absDir, "server.js"), generateServerJs(stages));

  // Write README.md
  writeText(path.join(absDir, "README.md"), generateReadme(stages));
}
