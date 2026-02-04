// ABOUTME: Injects config defaults into raw argv when corresponding flags are absent.
// ABOUTME: Prepends injected flags before the original argv, preserving user-provided order.

import type { McpxConfig } from "./config.js";

const CONFIG_FLAG_MAP: Array<{
  configKey: keyof McpxConfig;
  flag: string;
  isBoolean: boolean;
}> = [
  { configKey: "provider", flag: "--provider", isBoolean: false },
  { configKey: "model", flag: "--model", isBoolean: false },
  { configKey: "apiKey", flag: "--api-key", isBoolean: false },
  { configKey: "verbose", flag: "--verbose", isBoolean: true },
];

function hasFlag(argv: string[], flag: string): boolean {
  return argv.some((arg) => arg === flag || arg.startsWith(`${flag}=`));
}

export function buildArgv(config: McpxConfig, rawArgv: string[]): string[] {
  const injected: string[] = [];

  for (const { configKey, flag, isBoolean } of CONFIG_FLAG_MAP) {
    const value = config[configKey];
    if (value === undefined || value === false) continue;
    if (hasFlag(rawArgv, flag)) continue;

    if (isBoolean) {
      injected.push(flag);
    } else {
      injected.push(flag, String(value));
    }
  }

  return [...injected, ...rawArgv];
}
