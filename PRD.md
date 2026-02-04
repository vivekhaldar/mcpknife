# mcpx — Product Requirements Document

## Overview

**mcpx** is a unified CLI for the MCP power-tool suite. It brings three standalone tools — `mcpboot`, `mcpblox`, and `mcp-gen-ui` — under a single command with subcommands `boot`, `mod`, and `ui`.

mcpx does not implement new functionality. It exists purely for CLI ergonomics: one install, one command, discoverable subcommands, and seamless pipe composition across the entire MCP lifecycle.

## Problem

The MCP ecosystem has three complementary tools that form a natural pipeline:

1. **mcpboot** — Generate an MCP server from a natural language prompt + API docs
2. **mcpblox** — Transform, reshape, rename, hide, or combine tools on an existing MCP server
3. **mcp-gen-ui** — Auto-generate interactive UIs for any MCP server's tools

Today these are three separate npm packages (`mcpboot`, `mcpblox`, `mcp-gen-ui`) with three separate binaries. Users must discover, install, and remember three tools. The pipe protocol between them works but requires knowing all three binary names and their respective flags.

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

## Non-Goals

- **No new functionality.** mcpx delegates entirely to the three underlying packages. If a feature doesn't exist in `mcpboot`, `mcpblox`, or `mcp-gen-ui`, it doesn't belong in mcpx.
- **No shared library extraction.** The three underlying packages share code (llm.ts, cache.ts, pipe.ts, sandbox.ts). Deduplication is a separate effort. mcpx treats them as opaque npm dependencies.
- **No replacing the standalone tools.** `mcpboot`, `mcpblox`, and `mcp-gen-ui` continue to work as independent binaries. mcpx is an alternative entry point, not a replacement.

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
│   ├── cli.ts           ← Top-level argument parser (Commander.js)
│   ├── boot.ts          ← Delegates to mcpboot
│   ├── mod.ts           ← Delegates to mcpblox
│   └── ui.ts            ← Delegates to mcp-gen-ui
├── package.json
│   └── dependencies:
│       ├── mcpboot
│       ├── mcpblox
│       └── mcp-gen-ui
└── tsconfig.json
```

### Delegation Strategy

Each subcommand module (`boot.ts`, `mod.ts`, `ui.ts`) imports the programmatic entry point from its respective package and invokes it with the parsed arguments. This is a **library-level delegation**, not a subprocess spawn. The underlying packages must export a programmatic API (function that accepts config and runs the server).

If a package does not yet expose a clean programmatic API, the fallback is to spawn the package's binary as a child process, forwarding all arguments and stdio streams. This is less elegant but ensures mcpx works immediately without requiring changes to the underlying packages.

### Pipe Protocol

The pipe protocol is already implemented in each underlying tool. mcpx simply needs to ensure:

1. Stdio streams are forwarded correctly to the underlying tool
2. When piped, port defaults to `0` (handled by each underlying tool)
3. Signal forwarding (SIGINT, SIGTERM) propagates to child processes (if using subprocess delegation)

## Package Details

- **Name:** `mcpx`
- **Binary:** `mcpx`
- **Runtime:** Node.js 18+
- **Language:** TypeScript
- **Build:** esbuild (single ESM bundle, consistent with underlying tools)
- **Dependencies:**
  - `mcpboot` — MCP server generation
  - `mcpblox` — MCP tool transformation
  - `mcp-gen-ui` — MCP UI generation
  - `commander` — CLI argument parsing
- **Install:**
  ```bash
  npm install -g mcpx
  # or
  npx mcpx boot --prompt "..."
  ```

## Testing Strategy

Since mcpx is a thin delegation layer, testing focuses on:

1. **CLI parsing** — Correct subcommand routing and option parsing
2. **Argument forwarding** — Options are passed through accurately to underlying tools
3. **Pipe integration** — End-to-end pipe chains work (`mcpx boot | mcpx mod | mcpx ui`)
4. **Error handling** — Missing subcommand, invalid options, and underlying tool errors surface clearly
5. **Help text** — `mcpx --help`, `mcpx boot --help`, etc. produce correct output

Unit tests use vitest (consistent with underlying tools). Integration tests run actual pipe chains against mock or real MCP servers.

## Success Criteria

1. `npx mcpx boot --prompt "..." https://some-api.com` produces a working MCP server (identical behavior to `npx mcpboot`)
2. `npx mcpx mod --upstream-url http://... --prompt "..."` transforms tools (identical to `npx mcpblox`)
3. `npx mcpx ui --upstream-url http://...` generates UIs (identical to `npx mcp-gen-ui`)
4. Pipe chains work: `mcpx boot ... | mcpx mod ... | mcpx ui`
5. `mcpx --help` and `mcpx <subcommand> --help` produce clear, useful output
6. Single `npm install -g mcpx` gets you all three tools

## Open Questions

1. **Programmatic API availability:** Do `mcpboot`, `mcpblox`, and `mcp-gen-ui` currently export programmatic entry points, or only CLI binaries? This determines whether mcpx uses library-level delegation or subprocess spawning.

2. **Version pinning:** Should mcpx pin exact versions of the three dependencies, or use semver ranges? Exact pinning ensures reproducibility; ranges pick up fixes automatically.

3. **Global options:** Should common options (`--provider`, `--model`, `--api-key`, `--verbose`) be hoistable to the top level? e.g., `mcpx --provider openai boot --prompt "..."`. This is a convenience but adds CLI complexity.

4. **Config file:** Should mcpx support a `.mcpxrc` or similar config file for default provider/model/api-key settings, reducing flag repetition in pipe chains?
