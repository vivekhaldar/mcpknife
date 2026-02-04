// ABOUTME: Loads and merges config from ~/.mcpxrc (user) and ./.mcpxrc (project).
// ABOUTME: Project config fields override user config. Both files are optional.

import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export interface McpxConfig {
  provider?: string;
  model?: string;
  apiKey?: string;
  verbose?: boolean;
}

interface LoadConfigOptions {
  homeDir?: string;
  cwd?: string;
}

function readConfigFile(filePath: string): McpxConfig {
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
    throw new Error(`mcpx: invalid JSON in ${filePath}: ${err.message}`);
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }

  return parsed as McpxConfig;
}

export function loadConfig(options?: LoadConfigOptions): McpxConfig {
  const homeDir = options?.homeDir ?? os.homedir();
  const cwd = options?.cwd ?? process.cwd();

  const userConfigPath = path.join(homeDir, ".mcpxrc");
  const projectConfigPath = path.join(cwd, ".mcpxrc");

  const userConfig = readConfigFile(userConfigPath);
  const projectConfig = readConfigFile(projectConfigPath);

  return { ...userConfig, ...projectConfig };
}
