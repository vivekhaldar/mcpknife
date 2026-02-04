// ABOUTME: Test harness that imports spawnTool and invokes it with CLI arguments.
// ABOUTME: Used by spawn.test.ts to test process spawning in an isolated process.

import { spawnTool } from "../../src/spawn.js";

const args = process.argv.slice(2);
if (args.length < 1) {
  console.error("Usage: run-spawn.ts <binaryPath> [...args]");
  process.exit(1);
}

const binaryPath = args[0];
const argv = args.slice(1);

spawnTool(binaryPath, argv);
