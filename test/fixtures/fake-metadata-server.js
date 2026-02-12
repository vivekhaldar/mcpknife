// ABOUTME: Fake MCP server that returns canned _mcp_metadata responses.
// ABOUTME: Used by export tests to simulate pipeline stages without real sub-tools.

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import http from "node:http";
import { readFileSync } from "node:fs";

const metadataPath = process.argv[2];
if (!metadataPath) {
  console.error("Usage: fake-metadata-server.js <metadata-json-path>");
  process.exit(1);
}

const metadata = JSON.parse(readFileSync(metadataPath, "utf-8"));

// Extract tool names from metadata for tools/list
const toolNames = [];
if (metadata.stage === "boot" && metadata.tools) {
  for (const t of metadata.tools) {
    toolNames.push({
      name: t.name,
      description: t.description || "",
      inputSchema: t.input_schema || { type: "object", properties: {} },
    });
  }
} else if (metadata.stage === "mod") {
  for (const t of metadata.pass_through_tools || []) {
    toolNames.push({
      name: t.exposed_name,
      description: t.description || "",
      inputSchema: t.exposed_schema || { type: "object", properties: {} },
    });
  }
  for (const t of metadata.synthetic_tools || []) {
    toolNames.push({
      name: t.name,
      description: t.description || "",
      inputSchema: t.input_schema || { type: "object", properties: {} },
    });
  }
} else if (metadata.stage === "ui") {
  // UI stage just proxies through, no extra tools
}

const httpServer = http.createServer(async (req, res) => {
  if (req.method === "POST" && (req.url === "/mcp" || req.url === "/")) {
    const mcpServer = new Server(
      { name: "fake-metadata-server", version: "0.1.0" },
      { capabilities: { tools: {} } },
    );

    mcpServer.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: toolNames.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      })),
    }));

    mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name } = request.params;
      if (name === "_mcp_metadata") {
        return {
          content: [{ type: "text", text: JSON.stringify(metadata) }],
        };
      }
      return {
        content: [{ type: "text", text: `stub response for ${name}` }],
      };
    });

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

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
  } else {
    res.writeHead(404);
    res.end("Not found");
  }
});

httpServer.listen(0, "localhost", () => {
  const addr = httpServer.address();
  const url = `http://localhost:${addr.port}/mcp`;
  // Write URL to stdout (pipe protocol)
  process.stdout.write(url + "\n");
});

// Shutdown on signal
process.on("SIGTERM", () => {
  httpServer.close();
  process.exit(0);
});
process.on("SIGINT", () => {
  httpServer.close();
  process.exit(0);
});
