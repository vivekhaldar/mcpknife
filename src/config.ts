// ABOUTME: Loads and merges config from ~/.mcpkniferc (user) and ./.mcpkniferc (project).
// ABOUTME: Project config fields override user config. Both files are optional.

import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export interface McpknifeConfig {
  provider?: string;
  model?: string;
  apiKey?: string;
  verbose?: boolean;
}

interface LoadConfigOptions {
  homeDir?: string;
  cwd?: string;
}

function readConfigFile(filePath: string): McpknifeConfig {
  let content: string;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch (err: any) {
    if (err.code === "ENOENT") {
      return {};
    }
    throw err;
  }

  if (content.trim() === "") {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (err: any) {
    throw new Error(`mcpknife: invalid JSON in ${filePath}: ${err.message}`);
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }

  return parsed as McpknifeConfig;
}

export function loadConfig(options?: LoadConfigOptions): McpknifeConfig {
  const homeDir = options?.homeDir ?? os.homedir();
  const cwd = options?.cwd ?? process.cwd();

  const userConfigPath = path.join(homeDir, ".mcpkniferc");
  const projectConfigPath = path.join(cwd, ".mcpkniferc");

  const userConfig = readConfigFile(userConfigPath);
  const projectConfig = readConfigFile(projectConfigPath);

  return { ...userConfig, ...projectConfig };
}
