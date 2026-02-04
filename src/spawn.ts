// ABOUTME: Spawns an underlying MCP tool binary with stdio inheritance and signal forwarding.
// ABOUTME: Propagates the child's exit code and handles spawn errors.

import { spawn } from "node:child_process";

export function spawnTool(binaryPath: string, argv: string[]): void {
  const child = spawn(process.execPath, [binaryPath, ...argv], {
    stdio: "inherit",
    env: process.env,
  });

  function forwardSignal(signal: NodeJS.Signals) {
    process.on(signal, () => {
      if (!child.killed) {
        child.kill(signal);
      }
    });
  }

  forwardSignal("SIGINT");
  forwardSignal("SIGTERM");

  child.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "ENOENT") {
      console.error(`mcpx: binary not found: ${binaryPath}`);
      console.error(`Try reinstalling: npm install -g mcpx`);
    } else {
      console.error(`mcpx: failed to start: ${err.message}`);
    }
    process.exit(1);
  });

  child.on("close", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
    } else {
      process.exit(code ?? 1);
    }
  });
}
