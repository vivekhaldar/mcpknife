# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

mcpknife is a CLI multiplexer for three MCP tools plus built-in export and deploy commands. It handles config loading, binary resolution, argument injection, and process spawning to delegate to:

- `mcpknife boot` → mcpboot (generate MCP server from prompt + API docs)
- `mcpknife mod` → mcpblox (transform/reshape tools on existing MCP server)
- `mcpknife ui` → mcp-gen-ui (auto-generate UIs for MCP servers)
- `mcpknife export` → built-in (dump pipeline as standalone Node.js project)
- `mcpknife deploy` → built-in (deploy exported project to cloud provider)

These can be piped: `mcpknife boot ... | mcpknife mod ... | mcpknife ui | mcpknife export | mcpknife deploy`

## Build & Test Commands

```bash
npm run build          # esbuild → dist/cli.js (ESM, shebang)
npm test               # vitest run (all tests)
npx vitest run test/config.test.ts   # single test file
npm run dev            # tsx src/cli.ts (dev mode, no build needed)
```

No lint or format commands are configured.

## Architecture

For `boot`, `mod`, `ui` — five modules, linear pipeline:

```
cli.ts → config.ts → resolve.ts → args.ts → spawn.ts → child process
```

- **cli.ts**: Entry point. Manual argv parsing (no CLI framework). Dispatches subcommand.
- **config.ts**: Loads `~/.mcpkniferc` and `./.mcpkniferc` (JSON). Project overrides user (shallow merge). Fields: `provider`, `model`, `apiKey`, `verbose`.
- **resolve.ts**: Finds underlying tool binaries via `require.resolve()` + package.json bin field. `BINARY_MAP` maps subcommand names to npm package names.
- **args.ts**: Injects config values as CLI flags only when absent from user argv. CLI flags always win.
- **spawn.ts**: `child_process.spawn` with `stdio: 'inherit'`, signal forwarding (SIGINT/SIGTERM), exit code propagation.

Key design choice: mcpknife never parses subcommand-level flags. Everything after the subcommand name is passed through verbatim to the child tool.

For `export` — built-in, two modules:

- **export.ts**: Reads upstream URL from stdin, crawls the pipeline by calling `_mcp_metadata` on each stage (following `upstream_url` recursively), then delegates to codegen.
- **codegen.ts**: Generates a standalone Node.js project from the collected metadata: `server.js` (with vm sandbox, tool dispatch, resource serving), `handlers/`, `orchestrations/`, `transforms/`, `ui/`, `package.json`, `README.md`.

Each sub-tool (mcpboot, mcpblox, mcp-gen-ui) exposes a hidden `_mcp_metadata` tool that returns its stage type, version, generated code, and upstream URL. Export walks this chain to reconstruct the full pipeline.

For `deploy` — built-in, three modules:

- **deploy.ts**: Orchestrator. Parses args, validates project directory, dispatches to provider, formats output (URL to stdout, summary to stderr).
- **providers/types.ts**: Provider interface (`preflight`, `deploy`, `destroy`) and shared types.
- **providers/fly.ts**: Fly.io provider. Generates Dockerfile, shells out to `fly` CLI for launch/secrets/deploy/destroy.

The generated `server.js` includes optional bearer auth via `MCP_API_KEY` env var. The `/health` endpoint is exempt from auth for monitoring.

## Code Conventions

- All source files start with two `// ABOUTME:` comment lines explaining the file's purpose.
- TypeScript strict mode, ES2022 target, ESM modules.
- No CLI framework dependency—manual argv parsing is intentional to avoid option duplication.

## Testing

Unit tests cover each module independently. Integration tests in `test/integration.test.ts` use fixture scripts in `test/fixtures/` to test the full pipeline (config injection, flag override, signal forwarding, etc.) without requiring the actual mcpboot/mcpblox/mcp-gen-ui packages.

Export tests in `test/export.test.ts` cover argument parsing, project generation (boot-only, boot+mod, boot+ui), and pipeline crawling using fake metadata servers in `test/fixtures/`.

Deploy tests in `test/deploy.test.ts` cover argument parsing, project directory validation, Dockerfile generation, Fly CLI command construction, output formatting, and bearer auth in generated server.js.

## Defaults & Credentials

- **Default model**: `claude-haiku-4-5` (haiku). Set via `~/.mcpkniferc` `"model"` field.
- **API key**: Retrieved from `pass dev/ANTHROPIC_API_KEY`. Set via `~/.mcpkniferc` `"apiKey"` field.

## MCP Inspectors & Testing Tools

Three tools for inspecting and testing MCP servers produced by mcpknife:

- **mcporter** (https://github.com/steipete/mcporter) — CLI tool to invoke MCP servers directly. Use it to list tools (`mcporter list-tools`) and make tool calls for quick verification.
- **chatgpt-app-sim** (`~/repos/gh/chatgpt-app-sim`) — Simulator for MCP apps with graphical UIs. Use this to test `mcpknife ui` output that includes MCP Apps views.
- **Anthropic MCP Inspector** — Web-based inspector for examining intermediate MCP servers (tool listings, raw tool calls). Useful for debugging the pipeline between `boot`, `mod`, and `ui` stages.
