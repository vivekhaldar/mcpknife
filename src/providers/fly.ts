// ABOUTME: Fly.io deployment provider for mcpknife deploy.
// ABOUTME: Generates Dockerfile, runs fly CLI commands to launch/destroy apps.

import { execFile } from "node:child_process";
import { writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import type { Provider, DeployOptions, DeployResult } from "./types.js";

function exec(
  cmd: string,
  args: string[],
  opts: { cwd?: string } = {},
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd: opts.cwd, timeout: 300000 }, (err, stdout, stderr) => {
      if (err) {
        const msg = stderr?.trim() || stdout?.trim() || err.message;
        reject(new Error(`${cmd} ${args.join(" ")} failed: ${msg}`));
      } else {
        resolve({ stdout: stdout ?? "", stderr: stderr ?? "" });
      }
    });
  });
}

export function generateDockerfile(): string {
  return `FROM node:20-slim
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY . .
EXPOSE 8080
CMD ["node", "server.js"]
`;
}

export function buildFlyLaunchArgs(name: string, region?: string): string[] {
  const args = ["launch", "--no-deploy", "--name", name, "--yes"];
  if (region) {
    args.push("--region", region);
  }
  return args;
}

export function buildFlySecretsArgs(
  appName: string,
  apiKey: string,
  env: Record<string, string>,
): string[] {
  const pairs = [`MCP_API_KEY=${apiKey}`];
  for (const [k, v] of Object.entries(env)) {
    pairs.push(`${k}=${v}`);
  }
  return ["secrets", "set", ...pairs, "--app", appName];
}

export function buildFlyDeployArgs(appName: string): string[] {
  return ["deploy", "--app", appName];
}

export function buildFlyDestroyArgs(appName: string): string[] {
  return ["apps", "destroy", appName, "--yes"];
}

export class FlyProvider implements Provider {
  name = "fly";

  async preflight(_opts: DeployOptions): Promise<void> {
    // Check fly CLI is installed
    try {
      await exec("fly", ["version"]);
    } catch {
      throw new Error(
        "fly CLI not found. Install it: https://fly.io/docs/flyctl/install/",
      );
    }

    // Check authentication
    try {
      await exec("fly", ["auth", "whoami"]);
    } catch {
      throw new Error(
        "Not logged in to Fly.io. Run: fly auth login",
      );
    }
  }

  async deploy(opts: DeployOptions): Promise<DeployResult> {
    const { projectDir, name, region, env, apiKey } = opts;

    // Write Dockerfile
    writeFileSync(path.join(projectDir, "Dockerfile"), generateDockerfile());

    // Launch app (skip if fly.toml already exists — handles re-deploys)
    if (!existsSync(path.join(projectDir, "fly.toml"))) {
      const launchArgs = buildFlyLaunchArgs(name, region);
      console.error(`[deploy] fly ${launchArgs.join(" ")}`);
      await exec("fly", launchArgs, { cwd: projectDir });
    } else {
      console.error(`[deploy] fly.toml exists, skipping launch`);
    }

    // Set secrets
    const secretsArgs = buildFlySecretsArgs(name, apiKey, env);
    console.error(`[deploy] fly secrets set ...`);
    await exec("fly", secretsArgs, { cwd: projectDir });

    // Deploy
    const deployArgs = buildFlyDeployArgs(name);
    console.error(`[deploy] fly ${deployArgs.join(" ")}`);
    await exec("fly", deployArgs, { cwd: projectDir });

    return {
      url: `https://${name}.fly.dev/mcp`,
      name,
      target: this.name,
      apiKey,
      dashboardUrl: `https://fly.io/apps/${name}`,
    };
  }

  async destroy(name: string, _region?: string): Promise<void> {
    const args = buildFlyDestroyArgs(name);
    console.error(`[deploy] fly ${args.join(" ")}`);
    await exec("fly", args);
  }
}
