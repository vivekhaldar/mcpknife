# mcpx — Product Requirements Document

## Overview

**mcpx** is a unified CLI for the MCP power-tool suite. It brings three standalone tools — `mcpboot`, `mcpblox`, and `mcp-gen-ui` — under a single command with subcommands `boot`, `mod`, and `ui`.

mcpx does not implement new functionality. It exists purely for CLI ergonomics: one install, one command, discoverable subcommands, and seamless pipe composition across the entire MCP lifecycle.

## Problem

The MCP ecosystem has three complementary tools that form a natural pipeline:

1. **mcpboot** — Generate an MCP server from a natural language prompt + API docs
2. **mcpblox** — Transform, reshape, rename, hide, or combine tools on an existing MCP server
3. **mcp-gen-ui** — Auto-generate interactive UIs for any MCP server's tools

Today these are three separate npm packages (`mcpboot`, `mcpblox`, `mcp-gen-ui`) with three separate binaries. Users must discover, install, and remember three tools. The pipe protocol between them works but requires knowing all three binary names and their respective flags. Common settings like LLM provider and API key must be repeated on every invocation.

## Solution

A single CLI binary `mcpx` with three subcommands:

```
mcpx boot   →  mcpboot
mcpx mod    →  mcpblox
mcpx ui     →  mcp-gen-ui
```

### The Pipeline Story

```bash
# Full pipeline: generate → transform → add UI
mcpx boot --prompt "Yahoo Finance API" https://finance.yahoo.com/api \
  | mcpx mod --prompt "combine daily + weekly into get_period_returns" \
  | mcpx ui

# Just boot a server
mcpx boot --prompt "Hacker News API" https://github.com/HackerNews/API

# Transform an existing server
mcpx mod --upstream "npx some-mcp-server" --prompt "hide write tools, expose read-only"

# Add UI to any running server
mcpx ui --upstream-url http://localhost:3000/mcp

# Chain multiple transforms
mcpx mod --upstream "npx some-server" --prompt "rename tools" \
  | mcpx mod --prompt "add synthetic aggregation tool" \
  | mcpx ui --standard openai
```

With a config file (`~/.mcpxrc`), the pipe chain above requires zero repeated flags — provider, model, and API key are loaded automatically.

## Non-Goals

- **No new functionality.** mcpx delegates entirely to the three underlying packages. If a feature doesn't exist in `mcpboot`, `mcpblox`, or `mcp-gen-ui`, it doesn't belong in mcpx.
- **No shared library extraction.** The three underlying packages share code (llm.ts, cache.ts, pipe.ts, sandbox.ts). Deduplication is a separate effort. mcpx treats them as opaque npm dependencies.
- **No replacing the standalone tools.** `mcpboot`, `mcpblox`, and `mcp-gen-ui` continue to work as independent binaries. mcpx is an alternative entry point, not a replacement.
- **No global option hoisting.** Common flags like `--provider` are not hoisted to the top-level `mcpx` command. In pipe chains, each stage is a separate OS process — top-level flags can't propagate across the pipe. The config file solves this problem instead.

## Config File

mcpx reads a config file to provide defaults for common settings, eliminating flag repetition across pipe stages.

### Resolution Order

Settings are resolved with the following precedence (highest first):

1. **CLI flags** — Always win: `--provider openai` overrides everything
2. **Environment variables** — `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, etc.
3. **Project config** — `.mcpxrc` in the current directory (or nearest parent)
4. **User config** — `~/.mcpxrc`

### File Format

JSON:

```json
{
  "provider": "anthropic",
  "model": "claude-sonnet-4-20250514",
  "apiKey": "sk-ant-..."
}
```

All fields are optional. Only specified fields provide defaults; unspecified fields fall through to the underlying tool's own defaults.

### Supported Fields

| Field | Type | Maps to CLI flag | Description |
|-------|------|------------------|-------------|
| `provider` | string | `--provider` | LLM provider: `anthropic` \| `openai` |
| `model` | string | `--model` | LLM model ID |
| `apiKey` | string | `--api-key` | LLM API key |
| `verbose` | boolean | `--verbose` | Verbose logging |

The config file only covers settings that are common across all three subcommands. Subcommand-specific options (e.g., `--standard` for `ui`, `--upstream` for `mod`) are not included — they must be passed as CLI flags.

### How It Works

When mcpx spawns a subcommand, it:

1. Loads config from `~/.mcpxrc` and `./.mcpxrc` (project overrides user)
2. Merges config values with CLI flags (CLI wins)
3. Injects resolved values into the argument list passed to the underlying binary

This means the underlying tools don't need to know about `.mcpxrc` — mcpx translates config values into CLI flags before spawning.

## Subcommands

### `mcpx boot`

Generates and serves an MCP server from a natural language prompt.

Delegates to: `mcpboot` (npm: `mcpboot@0.1.0`)

**Usage:**
```
mcpx boot --prompt <text> [URLs...] [options]
mcpx boot --prompt-file <path> [URLs...] [options]
```

**Options:**

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--prompt <text>` | string | — | Generation prompt (inline) |
| `--prompt-file <path>` | string | — | Generation prompt from file |
| `--provider <name>` | string | `anthropic` | LLM provider: `anthropic` \| `openai` |
| `--model <id>` | string | — | LLM model ID |
| `--api-key <key>` | string | — | API key (or env: `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`) |
| `--port <number>` | number | `8000` | HTTP server port |
| `--cache-dir <path>` | string | `.mcpboot-cache` | Cache directory |
| `--no-cache` | boolean | `false` | Disable caching |
| `--verbose` | boolean | `false` | Verbose logging |
| `--dry-run` | boolean | `false` | Show plan without starting server |

**Pipe behavior:** When stdout is piped, outputs the server URL for downstream consumers.

---

### `mcpx mod`

Proxies an existing MCP server, transforming its tools via natural language.

Delegates to: `mcpblox` (npm: `mcpblox@0.1.1`)

**Usage:**
```
mcpx mod --upstream <command> --prompt <text> [options]
mcpx mod --upstream-url <url> --prompt <text> [options]
cat url | mcpx mod --prompt <text> [options]
```

**Options:**

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--upstream <command>` | string | — | Upstream MCP server as stdio command |
| `--upstream-url <url>` | string | — | Upstream MCP server as HTTP/SSE URL |
| `--upstream-token <token>` | string | — | Bearer token (or env: `MCP_UPSTREAM_TOKEN`) |
| `--prompt <text>` | string | — | Transform prompt (inline) |
| `--prompt-file <path>` | string | — | Transform prompt from file |
| `--provider <name>` | string | `anthropic` | LLM provider: `anthropic` \| `openai` |
| `--model <id>` | string | — | LLM model ID |
| `--api-key <key>` | string | — | API key (or env: `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`) |
| `--port <number>` | number | `8000` | HTTP server port |
| `--cache-dir <path>` | string | `.mcpblox-cache` | Cache directory |
| `--no-cache` | boolean | `false` | Disable caching |
| `--verbose` | boolean | `false` | Verbose logging |
| `--dry-run` | boolean | `false` | Show plan without starting server |

**Pipe behavior:**
- **stdin:** Reads upstream URL from pipe (alternative to `--upstream-url`)
- **stdout:** Outputs own server URL for downstream consumers
- **Port:** Defaults to `0` (OS-assigned) when stdout is piped

Without a `--prompt`, acts as a transparent pass-through proxy.

---

### `mcpx ui`

Wraps an existing MCP server, auto-generating interactive UIs for its tools.

Delegates to: `mcp-gen-ui` (npm: `mcp-gen-ui@0.1.2`)

**Usage:**
```
mcpx ui --upstream <command> [options]
mcpx ui --upstream-url <url> [options]
cat url | mcpx ui [options]
```

**Options:**

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--upstream <command>` | string | — | Upstream MCP server as stdio command |
| `--upstream-url <url>` | string | — | Upstream MCP server as HTTP/SSE URL |
| `--upstream-token <token>` | string | — | Bearer token (or env: `MCP_UPSTREAM_BEARER_TOKEN`) |
| `--provider <name>` | string | `anthropic` | LLM provider: `anthropic` \| `openai` |
| `--model <id>` | string | — | LLM model ID |
| `--api-key <key>` | string | — | API key (or env: `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`) |
| `--port <number>` | number | `8000` | HTTP server port |
| `--cache-dir <path>` | string | `.mcp-gen-ui-cache` | Cache directory |
| `--standard <name>` | string | `mcp-apps` | UI standard: `openai` \| `mcp-apps` |

**Pipe behavior:**
- **stdin:** Reads upstream URL from pipe
- **stdout:** Outputs own server URL for downstream consumers
- **Port:** Defaults to `0` (OS-assigned) when stdout is piped

---

## Top-Level CLI

```
mcpx <subcommand> [options]

Subcommands:
  boot    Generate an MCP server from a prompt
  mod     Transform tools on an existing MCP server
  ui      Add interactive UI to an MCP server

Options:
  --version   Show version
  --help      Show help
```

Each subcommand also supports `--help`:
```
mcpx boot --help
mcpx mod --help
mcpx ui --help
```

## Architecture

```
mcpx (this package)
├── bin/mcpx.js          ← CLI entry point
├── src/
│   ├── cli.ts           ← Subcommand routing and config file loading
│   ├── config.ts        ← Config file resolution (~/.mcpxrc, ./.mcpxrc)
│   ├── spawn.ts         ← Child process spawning with stdio forwarding
│   ├── boot.ts          ← Builds argv for mcpboot, spawns it
│   ├── mod.ts           ← Builds argv for mcpblox, spawns it
│   └── ui.ts            ← Builds argv for mcp-gen-ui, spawns it
├── package.json
│   └── dependencies:
│       ├── mcpboot
│       ├── mcpblox
│       └── mcp-gen-ui
└── tsconfig.json
```

### Delegation Strategy

mcpx delegates to the underlying tools by **spawning their CLI binaries** as child processes. Each subcommand module (`boot.ts`, `mod.ts`, `ui.ts`) resolves the path to the underlying package's binary (via `require.resolve` or the `node_modules/.bin` path), builds an argv array from the merged config + CLI flags, and spawns the process.

This approach was chosen deliberately over library-level delegation because:

1. **The underlying tools are CLI-first.** All three auto-execute on import with no guarded entry point. They parse `process.argv` and manage their own lifecycle. Importing them as libraries would require changes to each package.
2. **Pipe protocol works naturally.** The tools communicate via stdin/stdout URLs. Spawning preserves this — mcpx just forwards stdio streams to the child process.
3. **Signal handling is clean.** Each tool manages its own SIGINT/SIGTERM lifecycle. mcpx propagates signals to the child process.
4. **Zero coupling.** mcpx doesn't track internal API changes in the underlying packages. If mcpblox refactors its internals, mcpx doesn't care — only the CLI contract matters.
5. **Startup overhead is negligible.** These are long-running servers. A few hundred ms to spawn a Node process is irrelevant.

### Spawning Details

For each subcommand, mcpx:

1. Resolves the underlying binary path (e.g., `node_modules/.bin/mcpboot` or `node_modules/mcpboot/dist/index.js`)
2. Loads and merges config file defaults with CLI flags
3. Builds the full argv array for the underlying tool
4. Spawns via `child_process.spawn(process.execPath, [binaryPath, ...argv], { stdio: 'inherit' })`
5. Forwards SIGINT and SIGTERM to the child process
6. Exits with the child's exit code

Using `stdio: 'inherit'` ensures stdin/stdout/stderr pass through transparently, preserving pipe behavior.

### Pipe Protocol

The pipe protocol is already implemented in each underlying tool. Since mcpx uses `stdio: 'inherit'`, pipes work transparently:

```bash
mcpx boot --prompt "..." | mcpx mod --prompt "..." | mcpx ui
```

- `mcpx boot` spawns `mcpboot` with inherited stdio → mcpboot detects stdout is a pipe → uses port 0 → writes URL to stdout
- `mcpx mod` spawns `mcpblox` with inherited stdio → mcpblox reads URL from stdin → detects stdout is a pipe → writes URL to stdout
- `mcpx ui` spawns `mcp-gen-ui` with inherited stdio → mcp-gen-ui reads URL from stdin → serves on port 8000

mcpx adds no logic to the pipe protocol. It is fully transparent.

## Package Details

- **Name:** `mcpx`
- **Binary:** `mcpx`
- **Runtime:** Node.js 18+
- **Language:** TypeScript
- **Build:** esbuild (single ESM bundle, consistent with underlying tools)
- **Dependencies:**
  - `mcpboot` — MCP server generation (binary only)
  - `mcpblox` — MCP tool transformation (binary only)
  - `mcp-gen-ui` — MCP UI generation (binary only)
  - `commander` — CLI argument parsing
- **Install:**
  ```bash
  npm install -g mcpx
  # or
  npx mcpx boot --prompt "..."
  ```

## Testing Strategy

Since mcpx is a thin delegation layer, testing focuses on:

1. **Config file loading** — Correct resolution order (CLI > env > project > user), merging behavior, missing files handled gracefully
2. **CLI parsing** — Correct subcommand routing and option parsing
3. **Argument forwarding** — Config + CLI flags are correctly translated into argv for each underlying binary
4. **Binary resolution** — Underlying tool binaries are found in node_modules
5. **Pipe integration** — End-to-end pipe chains work (`mcpx boot | mcpx mod | mcpx ui`)
6. **Signal forwarding** — SIGINT/SIGTERM propagate to child processes
7. **Error handling** — Missing subcommand, invalid options, missing binary, and child process errors surface clearly
8. **Help text** — `mcpx --help`, `mcpx boot --help`, etc. produce correct output

Unit tests use vitest (consistent with underlying tools). Integration tests run actual pipe chains against mock or real MCP servers.

## Success Criteria

1. `npx mcpx boot --prompt "..." https://some-api.com` produces a working MCP server (identical behavior to `npx mcpboot`)
2. `npx mcpx mod --upstream-url http://... --prompt "..."` transforms tools (identical to `npx mcpblox`)
3. `npx mcpx ui --upstream-url http://...` generates UIs (identical to `npx mcp-gen-ui`)
4. Pipe chains work: `mcpx boot ... | mcpx mod ... | mcpx ui`
5. `mcpx --help` and `mcpx <subcommand> --help` produce clear, useful output
6. Single `npm install -g mcpx` gets you all three tools
7. Config file at `~/.mcpxrc` eliminates flag repetition across pipe stages
8. CLI flags override config file values
