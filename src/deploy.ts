// ABOUTME: Orchestrator for the deploy subcommand.
// ABOUTME: Parses args, validates project directory, dispatches to provider, formats output.

import { existsSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { Provider } from "./providers/types.js";
import { FlyProvider } from "./providers/fly.js";

export interface DeployArgs {
  target: string;
  name: string | null;
  region: string | undefined;
  env: Record<string, string>;
  apiKey: string | null;
  destroy: boolean;
  help: boolean;
  projectDir: string | null;
}

const PROVIDERS: Record<string, Provider> = {
  fly: new FlyProvider(),
};

export function parseDeployArgs(argv: string[]): DeployArgs {
  const result: DeployArgs = {
    target: "fly",
    name: null,
    region: undefined,
    env: {},
    apiKey: null,
    destroy: false,
    help: false,
    projectDir: null,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === "--help" || arg === "-h") {
      result.help = true;
    } else if (arg === "--destroy") {
      result.destroy = true;
    } else if (arg === "--target" && i + 1 < argv.length) {
      result.target = argv[++i];
    } else if (arg.startsWith("--target=")) {
      result.target = arg.slice("--target=".length);
    } else if (arg === "--name" && i + 1 < argv.length) {
      result.name = argv[++i];
    } else if (arg.startsWith("--name=")) {
      result.name = arg.slice("--name=".length);
    } else if (arg === "--region" && i + 1 < argv.length) {
      result.region = argv[++i];
    } else if (arg.startsWith("--region=")) {
      result.region = arg.slice("--region=".length);
    } else if (arg === "--env" && i + 1 < argv.length) {
      const pair = argv[++i];
      const eqIdx = pair.indexOf("=");
      if (eqIdx > 0) {
        result.env[pair.slice(0, eqIdx)] = pair.slice(eqIdx + 1);
      }
    } else if (arg.startsWith("--env=")) {
      const pair = arg.slice("--env=".length);
      const eqIdx = pair.indexOf("=");
      if (eqIdx > 0) {
        result.env[pair.slice(0, eqIdx)] = pair.slice(eqIdx + 1);
      }
    } else if (arg === "--api-key" && i + 1 < argv.length) {
      result.apiKey = argv[++i];
    } else if (arg.startsWith("--api-key=")) {
      result.apiKey = arg.slice("--api-key=".length);
    } else if (!arg.startsWith("-") && !result.projectDir) {
      result.projectDir = arg;
    }
  }

  return result;
}

export function validateProjectDir(dir: string): void {
  if (!existsSync(path.join(dir, "package.json"))) {
    throw new Error(`Not a valid project directory: missing package.json in ${dir}`);
  }
  if (!existsSync(path.join(dir, "server.js"))) {
    throw new Error(`Not a valid project directory: missing server.js in ${dir}`);
  }
}

function readPathFromStdin(timeoutMs: number = 10000): Promise<string> {
  return new Promise((resolve, reject) => {
    if (process.stdin.isTTY) {
      reject(new Error(
        "deploy requires a project directory.\n" +
        "Usage: mcpknife deploy <directory>\n" +
        "   or: mcpknife export | mcpknife deploy",
      ));
      return;
    }

    let data = "";
    const timer = setTimeout(() => {
      process.stdin.removeAllListeners();
      process.stdin.destroy();
      reject(new Error("Timed out waiting for project path on stdin"));
    }, timeoutMs);

    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (chunk: string) => {
      data += chunk;
    });

    process.stdin.on("end", () => {
      clearTimeout(timer);
      const trimmed = data.trim();
      if (trimmed) {
        resolve(trimmed);
      } else {
        reject(new Error("Empty input on stdin"));
      }
    });

    process.stdin.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    process.stdin.resume();
  });
}

function printDeployHelp(): void {
  console.log(`mcpknife deploy — deploy an exported MCP server to the cloud

Usage:
  mcpknife deploy [directory] [options]
  mcpknife export | mcpknife deploy [options]

Options:
  --target <name>    Deployment target (default: fly)
  --name <name>      App name (default: directory basename)
  --region <code>    Deployment region (default: provider default)
  --env KEY=VALUE    Extra env var (repeatable)
  --api-key <key>    Bearer token for auth (default: auto-generated)
  --destroy          Tear down a previous deployment (requires --name)
  --help             Show this help message

Examples:
  mcpknife deploy ./exported_mcp --name my-api
  mcpknife export | mcpknife deploy --name my-api
  mcpknife deploy --destroy --name my-api`);
}

export function formatDeployOutput(result: {
  url: string;
  name: string;
  target: string;
  apiKey: string;
  dashboardUrl?: string;
}): { stdout: string; stderr: string } {
  const stdout = result.url + "\n";

  const lines = [
    "",
    `[deploy] Deployed to ${result.target}`,
    `[deploy] Endpoint: ${result.url}`,
    `[deploy] API Key:  ${result.apiKey}`,
  ];
  if (result.dashboardUrl) {
    lines.push(`[deploy] Dashboard: ${result.dashboardUrl}`);
  }
  lines.push(
    "",
    `[deploy] Claude Desktop config:`,
    `[deploy]   {`,
    `[deploy]     "mcpServers": {`,
    `[deploy]       "${result.name}": {`,
    `[deploy]         "url": "${result.url}",`,
    `[deploy]         "headers": { "Authorization": "Bearer ${result.apiKey}" }`,
    `[deploy]       }`,
    `[deploy]     }`,
    `[deploy]   }`,
  );

  const stderr = lines.join("\n") + "\n";
  return { stdout, stderr };
}

export async function runDeploy(argv: string[]): Promise<void> {
  const args = parseDeployArgs(argv);

  if (args.help) {
    printDeployHelp();
    return;
  }

  // Select provider
  const provider = PROVIDERS[args.target];
  if (!provider) {
    throw new Error(
      `Unknown deployment target: ${args.target}. Available: ${Object.keys(PROVIDERS).join(", ")}`,
    );
  }

  // Handle --destroy
  if (args.destroy) {
    if (!args.name) {
      throw new Error("--destroy requires --name");
    }
    await provider.destroy(args.name, args.region);
    console.error(`[deploy] Destroyed ${args.name}`);
    return;
  }

  // Resolve project directory: positional arg or stdin
  let projectDir = args.projectDir;
  if (!projectDir) {
    console.error("[deploy] Reading project path from stdin...");
    projectDir = await readPathFromStdin();
  }
  projectDir = path.resolve(projectDir);

  // Validate
  validateProjectDir(projectDir);

  // Default app name from directory basename
  const name = args.name || path.basename(projectDir);

  // Generate API key if not provided
  const apiKey = args.apiKey || crypto.randomBytes(24).toString("base64url");

  const opts = {
    projectDir,
    name,
    region: args.region,
    env: args.env,
    apiKey,
  };

  // Preflight checks
  console.error(`[deploy] Running preflight checks for ${args.target}...`);
  await provider.preflight(opts);

  // Deploy
  console.error(`[deploy] Deploying ${name} to ${args.target}...`);
  const result = await provider.deploy(opts);

  // Output
  const output = formatDeployOutput(result);
  process.stdout.write(output.stdout);
  process.stderr.write(output.stderr);
}
