# mcpx — Engineering Design

## 1. System Context

mcpx is a CLI multiplexer. It parses a subcommand name, loads shared configuration, and spawns the corresponding upstream binary with the correct arguments. It owns no business logic — all MCP functionality lives in the three underlying packages.

```
                         ┌──────────────────┐
                         │       mcpx       │
                         │                  │
  CLI args ──────────────▶  parse subcommand │
  ~/.mcpxrc ─────────────▶  load config      │
  ./.mcpxrc ─────────────▶  merge & build    │
                         │  argv             │
                         │                  │
                         │  spawn child     │◀── stdio: 'inherit'
                         └───────┬──────────┘
                                 │
              ┌──────────────────┼──────────────────┐
              ▼                  ▼                  ▼
        ┌──────────┐      ┌──────────┐      ┌──────────┐
        │ mcpboot  │      │ mcpblox  │      │mcp-gen-ui│
        │ (boot)   │      │  (mod)   │      │  (ui)    │
        └──────────┘      └──────────┘      └──────────┘
```

The design prioritizes transparency: mcpx should be invisible at runtime. The spawned tool sees the same environment it would see if invoked directly — same stdio streams, same signals, same exit behavior.

## 2. Binary Resolution

### Problem

mcpx needs to find the executable for each underlying tool. This must work across multiple installation scenarios:

| Scenario | Binary location |
|----------|----------------|
| Global install (`npm i -g mcpx`) | Sibling in global `node_modules/.bin/` |
| npx (`npx mcpx boot ...`) | Temp directory managed by npm |
| Local install (`node_modules/.bin/mcpx`) | Project `node_modules/.bin/` |
| Development (`tsx src/cli.ts`) | Local or linked `node_modules/` |

### Approach: Module Resolution

Use Node's module resolution to find the package, then construct the binary path from the known entry point.

```ts
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

function resolveBinary(packageName: string): string {
  // Resolve the package's package.json to find its root
  const pkgJsonPath = require.resolve(`${packageName}/package.json`);
  const pkgRoot = path.dirname(pkgJsonPath);
  const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8"));

  // Extract the bin entry point
  const binEntry =
    typeof pkgJson.bin === "string"
      ? pkgJson.bin
      : pkgJson.bin[packageName] || pkgJson.bin[Object.keys(pkgJson.bin)[0]];

  return path.resolve(pkgRoot, binEntry);
}
```

### Why Not Alternatives

**`which` / PATH lookup:** Unreliable. When run via `npx`, the underlying binaries may not be on PATH unless they're also listed in mcpx's `package.json` bin field. And we don't want to add three extra bin entries — that defeats the purpose of a unified CLI.

**Hardcoded paths (`dist/index.js`):** Fragile. If an underlying package changes its build output path, mcpx breaks silently. Reading from `package.json` bin is the contract.

**`node_modules/.bin/` direct access:** Doesn't work reliably across global/local/npx installs. The `.bin` directory might not exist or might be in a different location. Module resolution handles all these cases.

### Binary Map

```ts
const BINARY_MAP: Record<string, string> = {
  boot: "mcpboot",
  mod: "mcpblox",
  ui: "mcp-gen-ui",
};
```

Resolution is performed once at subcommand dispatch, not at startup. If the user runs `mcpx boot`, we only resolve `mcpboot` — we don't validate that all three binaries exist.

## 3. Config File

### File Locations

Two config files, in precedence order:

1. **Project config:** `.mcpxrc` in the current working directory
2. **User config:** `~/.mcpxrc` in the user's home directory

Project config fields override user config fields. CLI flags override both.

### Why Not Walk Up Directories

Tools like `.npmrc` and `.eslintrc` walk up the directory tree to find the nearest config file. We don't do this because:

1. **Pipe chains share a cwd.** All stages in `mcpx boot ... | mcpx mod ... | mcpx ui` run in the same working directory. Walking up adds no value when cwd is the same for all invocations.
2. **Simplicity.** Walking up adds complexity (symlink handling, filesystem root detection, mount boundaries) for no practical benefit.
3. **Predictability.** Users can reason about exactly two locations. No surprises from a `.mcpxrc` in an ancestor directory they forgot about.

### File Format: JSON

```json
{
  "provider": "anthropic",
  "model": "claude-sonnet-4-20250514",
  "apiKey": "sk-ant-..."
}
```

**Why JSON over TOML/YAML/dotenv:**
- Zero dependencies. `JSON.parse` is built into Node.
- The config is flat key-value pairs — JSON's verbosity doesn't matter at this scale.
- Consistent with `package.json` and `tsconfig.json` that already live in the same directories.

### Schema

```ts
interface McpxConfig {
  provider?: "anthropic" | "openai";
  model?: string;
  apiKey?: string;
  verbose?: boolean;
}
```

All fields optional. Unknown fields are silently ignored (forward compatibility — if a future version adds fields, older mcpx versions won't break).

### Loading Algorithm

```
function loadConfig(): McpxConfig
  1. merged = {}
  2. Try read ~/.mcpxrc → parse JSON → shallow merge into merged
  3. Try read ./.mcpxrc → parse JSON → shallow merge into merged
     (project overrides user)
  4. Return merged
```

File-not-found is not an error — both files are optional. Parse errors (malformed JSON) are fatal with a clear error message pointing to the offending file.

### Security: API Keys in Config Files

The config file may contain API keys. This is a deliberate trade-off:

**Risk:** Keys stored in plaintext on disk.

**Mitigation:** This is the same pattern used by `~/.npmrc` (auth tokens), `~/.docker/config.json` (registry credentials), and `~/.aws/credentials`. Users who store API keys in environment variables can continue doing so — the config file is optional. We do not create the file for the user; they must create it intentionally.

**We do NOT:**
- Log config values (especially `apiKey`) in verbose mode
- Include config values in error messages
- Write the config file — only read it

## 4. Argument Building

### The Problem

mcpx must translate config file defaults + CLI flags into the argv that the underlying binary expects. The challenge: we must not duplicate Commander option definitions from the three underlying tools.

### Approach: Passthrough With Injection

mcpx does **not** parse subcommand-level flags. It treats everything after the subcommand name as an opaque argv array. Config defaults are injected only for known common flags that are absent from the raw argv.

```
User types:   mcpx boot --prompt "HN API" --port 3000
              ^^^^       ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
              mcpx       passed through verbatim to mcpboot

Config file:  { "provider": "anthropic", "apiKey": "sk-..." }

Injected:     --provider anthropic --api-key sk-...
              (because --provider and --api-key are absent from user's args)

Final argv:   --provider anthropic --api-key sk-... --prompt "HN API" --port 3000
              ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
              spawned as: node /path/to/mcpboot/dist/index.js [this argv]
```

### Flag Detection

To determine whether a flag is already present in the raw argv:

```ts
function hasFlag(argv: string[], flag: string): boolean {
  return argv.some(
    (arg) => arg === flag || arg.startsWith(`${flag}=`)
  );
}
```

This handles both `--provider openai` (two separate argv entries) and `--provider=openai` (single entry with `=`). Both forms are accepted by Commander.

### Config-to-Flag Mapping

```ts
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
```

For each entry:
- If the config value is set AND the flag is not in the raw argv → inject
- Boolean flags inject just the flag name (`--verbose`), not `--verbose true`
- String flags inject flag + value as two argv entries (`--provider`, `anthropic`)

### Why Not Parse With Commander

The alternative is to define all options in mcpx's Commander setup (mirroring each tool), parse them, merge with config, and reconstruct argv. This was rejected because:

1. **Duplication.** Every option from all three tools would be defined twice — once in the underlying tool and once in mcpx. When a tool adds an option, mcpx must be updated.
2. **Help text divergence.** mcpx's Commander-generated help could drift from the underlying tool's help.
3. **More code.** Three full Commander program definitions vs. four lines of flag-injection logic.

The passthrough approach means mcpx only knows about the four common config fields. Everything else flows through untouched.

### Forwarding `--help`

When the user runs `mcpx boot --help`, the `--help` flag passes through to mcpboot. Commander in mcpboot handles it and prints help. The program name in the output will say `mcpboot`, not `mcpx boot`.

This is a known cosmetic limitation. The output is still correct and useful. Fixing it would require either:
- Parsing `--help` in mcpx and printing custom help (duplicating option definitions)
- Patching `process.argv[1]` before spawning (fragile)

Neither is worth the complexity for v1.

## 5. Process Spawning

### spawn() Call

```ts
const child = spawn(process.execPath, [binaryPath, ...argv], {
  stdio: "inherit",
  env: process.env,
});
```

**`process.execPath`** — Uses the same Node binary that's running mcpx. Ensures version consistency and works correctly under nvm/fnm/volta.

**`stdio: "inherit"`** — The child process shares mcpx's stdin, stdout, and stderr file descriptors directly. The OS kernel handles the plumbing — mcpx is not in the data path. This is critical for:
- **Pipe protocol.** When `mcpx boot ... | mcpx mod ...`, mcpboot's stdout IS the pipe to mcpblox's stdin. mcpx doesn't buffer or relay data.
- **TTY detection.** The child can call `process.stdout.isTTY` and get the correct answer (true if terminal, false if piped). This is how the underlying tools decide whether to use port 0 and write URLs.
- **Performance.** Zero-copy. No serialization overhead.

**`process.env`** — Full environment pass-through. API keys in environment variables work without mcpx knowing about them.

### Signal Forwarding

```ts
function forwardSignal(signal: NodeJS.Signals) {
  process.on(signal, () => {
    if (!child.killed) {
      child.kill(signal);
    }
  });
}

forwardSignal("SIGINT");
forwardSignal("SIGTERM");
```

When the user hits Ctrl+C:
1. The OS sends SIGINT to the foreground process group
2. Both mcpx and the child may receive it (depending on how the shell manages process groups)
3. mcpx's handler forwards SIGINT to the child (idempotent if child already received it)
4. The child shuts down gracefully (each tool has its own SIGINT handler)

**SIGPIPE** is not forwarded — it's handled by the child process itself when the downstream pipe closes.

### Exit Code Propagation

```ts
child.on("close", (code, signal) => {
  if (signal) {
    // Child was killed by a signal — reproduce the same exit behavior
    process.kill(process.pid, signal);
  } else {
    process.exit(code ?? 1);
  }
});
```

mcpx exits with the child's exit code. If the child was killed by a signal (e.g., SIGTERM), mcpx re-raises the same signal on itself so the parent shell sees the correct exit status.

### Error Handling

If the child process fails to spawn (e.g., binary not found):

```ts
child.on("error", (err) => {
  if (err.code === "ENOENT") {
    console.error(`mcpx: binary not found for '${subcommand}': ${binaryPath}`);
    console.error(`Try reinstalling: npm install -g mcpx`);
  } else {
    console.error(`mcpx: failed to start '${subcommand}': ${err.message}`);
  }
  process.exit(1);
});
```

## 6. CLI Entry Point

### Top-Level Parsing

mcpx uses Commander only for the top-level command — subcommand name, `--version`, and `--help`. It does NOT register subcommands with Commander (which would try to parse their flags).

```ts
// Manually extract the subcommand from process.argv
const args = process.argv.slice(2);

// Handle top-level flags
if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
  printHelp();
  process.exit(0);
}
if (args[0] === "--version" || args[0] === "-V") {
  printVersion();
  process.exit(0);
}

const subcommand = args[0];
const subcommandArgv = args.slice(1);

if (!BINARY_MAP[subcommand]) {
  console.error(`mcpx: unknown subcommand '${subcommand}'`);
  console.error(`Run 'mcpx --help' for usage`);
  process.exit(1);
}
```

### Why Not Commander Subcommands

Commander's `.command()` API registers subcommands and parses their options. We avoid this because:

1. **Option duplication.** We'd need to redeclare every option from all three tools.
2. **Passthrough complexity.** Commander's `.passThroughOptions()` exists but interacts poorly with unknown options — it still tries to parse recognized flags.
3. **We don't need it.** Our parsing is trivial: one positional argument (subcommand name) and two top-level flags (`--help`, `--version`). Manual argv slicing is three lines and has zero edge cases.

### Help Text

```
mcpx — unified CLI for the MCP power-tool suite

Usage:
  mcpx <command> [options]

Commands:
  boot    Generate an MCP server from a prompt and API docs
  mod     Transform tools on an existing MCP server
  ui      Add interactive UI to an MCP server

Options:
  --help      Show this help message
  --version   Show version number

Configuration:
  mcpx reads defaults from ~/.mcpxrc and ./.mcpxrc (JSON).
  Supported fields: provider, model, apiKey, verbose.
  CLI flags override config file values.

Examples:
  mcpx boot --prompt "Hacker News API" https://github.com/HackerNews/API
  mcpx mod --upstream "npx some-server" --prompt "hide write tools"
  mcpx ui --upstream-url http://localhost:3000/mcp

  # Full pipeline
  mcpx boot --prompt "Yahoo Finance" | mcpx mod --prompt "combine tools" | mcpx ui

Run 'mcpx <command> --help' for command-specific options.
```

## 7. Project Structure

```
mcpx/
├── bin/
│   └── mcpx.js             ← Shebang wrapper: #!/usr/bin/env node
├── src/
│   ├── cli.ts              ← Entry point: argv parsing, dispatch
│   ├── config.ts           ← Config file loading and merging
│   ├── resolve.ts          ← Binary resolution via module system
│   ├── spawn.ts            ← Child process spawning, signal forwarding, exit code
│   └── args.ts             ← Config-to-argv injection logic
├── test/
│   ├── config.test.ts      ← Config loading tests
│   ├── resolve.test.ts     ← Binary resolution tests
│   ├── args.test.ts        ← Argument building tests
│   ├── cli.test.ts         ← Top-level CLI parsing tests
│   └── integration.test.ts ← End-to-end pipe chain tests
├── package.json
├── tsconfig.json
├── esbuild.config.ts
├── PRD.md
└── DESIGN.md
```

### Build

esbuild bundles `src/cli.ts` into `dist/cli.js` (ESM, Node 18 target). The `bin/mcpx.js` file is a thin shebang wrapper:

```js
#!/usr/bin/env node
import "./dist/cli.js";
```

Alternatively, esbuild can inject the shebang banner directly into `dist/cli.js` (as the underlying tools do), making `bin/mcpx.js` unnecessary. We use the banner approach for consistency:

```ts
// esbuild.config.ts
esbuild.build({
  entryPoints: ["src/cli.ts"],
  bundle: true,
  platform: "node",
  target: "node18",
  format: "esm",
  outfile: "dist/cli.js",
  banner: { js: "#!/usr/bin/env node" },
});
```

`package.json` bin field points directly to `dist/cli.js`.

## 8. Dependencies

```json
{
  "dependencies": {
    "mcpboot": "^0.1.0",
    "mcpblox": "^0.1.1",
    "mcp-gen-ui": "^0.1.2"
  },
  "devDependencies": {
    "esbuild": "^0.25.0",
    "typescript": "^5.4.0",
    "vitest": "^3.0.0",
    "tsx": "^4.0.0"
  }
}
```

**No Commander dependency.** We parse argv manually (three lines). Adding Commander for `--help` and `--version` is overkill.

**Semver ranges (`^`) for underlying tools.** Patch and minor updates are picked up automatically. This is appropriate because mcpx's contract with the underlying tools is their CLI interface, which is stable across minor versions. If a tool makes a breaking CLI change, it bumps its major version, and the `^` range won't pick it up.

## 9. Testing Strategy

### Unit Tests

**`config.test.ts`** — Config file loading:
- Loads `~/.mcpxrc` when it exists
- Loads `./.mcpxrc` when it exists
- Project config overrides user config (field by field)
- Missing files are silently ignored (no error)
- Malformed JSON produces a clear error with file path
- Unknown fields are ignored
- Empty file produces empty config
- All fields are optional

**`resolve.test.ts`** — Binary resolution:
- Resolves each package (`mcpboot`, `mcpblox`, `mcp-gen-ui`) to a valid file path
- Resolved path points to an existing file
- Throws clear error if package is not installed

**`args.test.ts`** — Argument injection:
- Config `provider` injected as `--provider <value>` when absent from argv
- Config `model` injected as `--model <value>` when absent from argv
- Config `apiKey` injected as `--api-key <value>` when absent from argv
- Config `verbose: true` injected as `--verbose` when absent from argv
- Config `verbose: false` does NOT inject `--verbose`
- CLI flag takes precedence: `--provider` in argv prevents config injection
- Flag detection handles `--flag=value` form
- Empty config injects nothing
- Original argv order is preserved (injected flags prepended)

**`cli.test.ts`** — Top-level dispatch:
- `mcpx boot ...` dispatches to mcpboot
- `mcpx mod ...` dispatches to mcpblox
- `mcpx ui ...` dispatches to mcp-gen-ui
- Unknown subcommand prints error and exits 1
- No subcommand prints help and exits 0
- `mcpx --help` prints help and exits 0
- `mcpx --version` prints version and exits 0

### Integration Tests

**`integration.test.ts`** — End-to-end:
- `mcpx boot --help` produces mcpboot's help text (exit 0)
- `mcpx mod --help` produces mcpblox's help text (exit 0)
- `mcpx ui --help` produces mcp-gen-ui's help text (exit 0)
- Config file values appear in spawned process's argv (use `--dry-run` to verify plan output without starting servers)
- SIGINT to mcpx terminates the child process

Pipe chain integration tests (these require API keys and are tagged as slow/optional):
- `mcpx boot --prompt "..." | mcpx mod --prompt "..." | mcpx ui` starts three servers in a chain
- Each server is reachable at its respective URL

## 10. Task Breakdown

Each task is self-contained and testable. Tasks are ordered so that each builds on the previous. A junior engineer should be able to implement each task by following the specification in this document.

---

### Task 1: Initialize Project Scaffolding [DONE]

**Goal:** Working TypeScript project with build and test infrastructure.

**Steps:**
1. Create `package.json` with:
   - `name`: `"mcpx"`
   - `version`: `"0.1.0"`
   - `type`: `"module"`
   - `bin`: `{ "mcpx": "dist/cli.js" }`
   - `scripts`: `{ "build": "node esbuild.config.js", "test": "vitest run", "dev": "tsx src/cli.ts" }`
   - `dependencies`: `{ "mcpboot": "^0.1.0", "mcpblox": "^0.1.1", "mcp-gen-ui": "^0.1.2" }`
   - `devDependencies`: `{ "esbuild": "^0.25.0", "typescript": "^5.4.0", "vitest": "^3.0.0", "tsx": "^4.0.0" }`
2. Create `tsconfig.json`: target `ES2022`, module `NodeNext`, moduleResolution `NodeNext`, outDir `dist`, strict `true`
3. Create `esbuild.config.js`: bundle `src/cli.ts` → `dist/cli.js`, ESM, node18 platform, shebang banner
4. Create stub `src/cli.ts` that prints `"mcpx v0.1.0"` and exits
5. Run `npm install`
6. Verify: `npm run build` succeeds, `node dist/cli.js` prints version, `npm test` runs (no tests yet is ok)

**Acceptance:** `npm run build && node dist/cli.js` prints version string.

---

### Task 2: Implement Config File Loading [DONE]

**Goal:** `loadConfig()` function that reads and merges `~/.mcpxrc` and `./.mcpxrc`.

**File:** `src/config.ts`

**Interface:**
```ts
export interface McpxConfig {
  provider?: string;
  model?: string;
  apiKey?: string;
  verbose?: boolean;
}

export function loadConfig(): McpxConfig;
```

**Behavior:**
1. Initialize `merged` as empty object
2. Attempt to read `~/.mcpxrc` (use `os.homedir()`). If exists, `JSON.parse` and shallow-merge into `merged`. If doesn't exist, skip silently. If malformed JSON, throw: `"mcpx: invalid JSON in ~/.mcpxrc: <parse error message>"`
3. Attempt to read `./.mcpxrc` (relative to `process.cwd()`). Same logic. Fields from project config overwrite user config.
4. Return `merged`

**Edge cases:**
- File exists but is empty → `JSON.parse("")` throws → treat empty file same as missing (skip silently, not an error)
- File contains `null` or non-object → ignore (return empty config)
- File has extra fields → ignore them (don't validate, don't error)

**Tests:** `test/config.test.ts` — see Section 9 for full test list. Use `vi.spyOn(fs, 'readFileSync')` or write to temp directories to test file loading.

**Acceptance:** All unit tests pass. `loadConfig()` returns correct merged values from fixture files.

---

### Task 3: Implement Binary Resolution

**Goal:** `resolveBinary(subcommand)` function that returns the absolute path to the underlying tool's binary.

**File:** `src/resolve.ts`

**Interface:**
```ts
export function resolveBinary(subcommand: string): string;
```

**Behavior:**
1. Look up package name from `BINARY_MAP`: `{ boot: "mcpboot", mod: "mcpblox", ui: "mcp-gen-ui" }`
2. Use `createRequire(import.meta.url)` to create a require function
3. Call `require.resolve(`${packageName}/package.json`)` to find the package root
4. Read and parse the package.json
5. Extract the `bin` field (handle both string and object forms)
6. Return `path.resolve(packageRoot, binEntry)`
7. If `require.resolve` throws (package not installed), throw: `"mcpx: package '${packageName}' not found. Try reinstalling: npm install -g mcpx"`

**Tests:** `test/resolve.test.ts` — see Section 9. Since the packages are devDependencies (installed via `npm install`), the tests can resolve real paths.

**Acceptance:** `resolveBinary("boot")` returns a path that exists on disk. Same for `"mod"` and `"ui"`.

---

### Task 4: Implement Argument Injection

**Goal:** `buildArgv(config, rawArgv)` function that injects config defaults into the raw argv.

**File:** `src/args.ts`

**Interface:**
```ts
export function buildArgv(config: McpxConfig, rawArgv: string[]): string[];
```

**Behavior:**
1. Start with an empty `injected` array
2. For each entry in `CONFIG_FLAG_MAP`:
   - If `config[configKey]` is defined AND `hasFlag(rawArgv, flag)` is false:
     - Boolean: push `flag` to `injected`
     - String: push `flag` and `String(config[configKey])` to `injected`
3. Return `[...injected, ...rawArgv]`

The `hasFlag` helper:
```ts
function hasFlag(argv: string[], flag: string): boolean {
  return argv.some(arg => arg === flag || arg.startsWith(`${flag}=`));
}
```

**CONFIG_FLAG_MAP:**
```ts
[
  { configKey: "provider", flag: "--provider", isBoolean: false },
  { configKey: "model",    flag: "--model",    isBoolean: false },
  { configKey: "apiKey",   flag: "--api-key",  isBoolean: false },
  { configKey: "verbose",  flag: "--verbose",  isBoolean: true  },
]
```

**Tests:** `test/args.test.ts` — see Section 9 for full list. Pure function, easy to unit test with no mocking.

**Acceptance:** All argument injection tests pass.

---

### Task 5: Implement Process Spawning

**Goal:** `spawnTool(binaryPath, argv)` function that spawns the underlying binary with stdio inheritance and signal forwarding.

**File:** `src/spawn.ts`

**Interface:**
```ts
export function spawnTool(binaryPath: string, argv: string[]): void;
```

**Behavior:**
1. Spawn: `child_process.spawn(process.execPath, [binaryPath, ...argv], { stdio: "inherit", env: process.env })`
2. Register signal handlers for SIGINT and SIGTERM that forward to the child (guard with `!child.killed`)
3. On child `"error"` event:
   - If `err.code === "ENOENT"`: print binary-not-found message to stderr, exit 1
   - Otherwise: print generic error, exit 1
4. On child `"close"` event:
   - If killed by signal: `process.kill(process.pid, signal)`
   - Otherwise: `process.exit(code ?? 1)`

**Important:** This function does not return. It takes over the process lifecycle — the caller should not do anything after calling `spawnTool`.

**Tests:** `test/spawn.test.ts` (optional — hard to unit test process spawning without actually spawning). The integration tests in Task 8 cover this end-to-end.

**Acceptance:** Running `spawnTool("/usr/bin/env", ["echo", "hello"])` prints "hello" and exits 0.

---

### Task 6: Implement CLI Entry Point

**Goal:** Wire everything together. Parse subcommand, load config, resolve binary, build argv, spawn.

**File:** `src/cli.ts`

**Behavior:**
1. Read `process.argv.slice(2)` into `args`
2. If `args` is empty or `args[0]` is `--help` / `-h`: print help text (see Section 6), exit 0
3. If `args[0]` is `--version` / `-V`: print `mcpx v${version}` (read from package.json), exit 0
4. Extract `subcommand = args[0]`, `rawArgv = args.slice(1)`
5. Validate subcommand is in `BINARY_MAP`. If not: print error + suggestion, exit 1
6. `const config = loadConfig()`
7. `const binaryPath = resolveBinary(subcommand)`
8. `const argv = buildArgv(config, rawArgv)`
9. `spawnTool(binaryPath, argv)`

**Tests:** `test/cli.test.ts` — see Section 9. Mock `spawnTool` to verify it's called with correct arguments. Test help/version/unknown subcommand by running the CLI as a child process and checking stdout/stderr/exit code.

**Acceptance:** `npx tsx src/cli.ts boot --help` prints mcpboot's help. `npx tsx src/cli.ts --help` prints mcpx help. `npx tsx src/cli.ts bogus` prints error and exits 1.

---

### Task 7: Build and Package

**Goal:** `npm run build` produces a working binary. `npm pack` produces a publishable tarball.

**Steps:**
1. Verify `esbuild.config.js` bundles correctly (from Task 1)
2. Run `npm run build`
3. Test the built binary: `node dist/cli.js --help`, `node dist/cli.js --version`
4. Test with each subcommand: `node dist/cli.js boot --help`, `node dist/cli.js mod --help`, `node dist/cli.js ui --help`
5. Test `npm pack` produces a tarball
6. Test install from tarball: `npm install -g ./mcpx-0.1.0.tgz && mcpx --help`
7. Add `"files"` field to package.json: `["dist/"]`

**Acceptance:** `npm pack && npm install -g ./mcpx-*.tgz && mcpx boot --help` shows mcpboot help.

---

### Task 8: Integration Tests

**Goal:** End-to-end tests that verify the full flow.

**File:** `test/integration.test.ts`

**Tests to implement:**

1. **Help passthrough**: Spawn `mcpx boot --help` as a child process, verify exit code 0 and stdout contains "mcpboot"
2. **Help passthrough (mod)**: Same for `mcpx mod --help`, verify "mcpblox" in output
3. **Help passthrough (ui)**: Same for `mcpx ui --help`, verify "mcp-gen-ui" in output
4. **Config injection**: Create a temp `.mcpxrc` with `{ "provider": "openai" }`, run `mcpx boot --dry-run --prompt "test"` from that directory, verify the spawned process received `--provider openai` (check output for "openai" provider indication)
5. **CLI flag overrides config**: Same setup but pass `--provider anthropic` on CLI, verify "anthropic" wins
6. **Unknown subcommand**: Run `mcpx bogus`, verify exit code 1 and stderr contains "unknown subcommand"
7. **Version**: Run `mcpx --version`, verify output matches package.json version

**Pipe chain tests (tagged `@slow`, require API keys):**

8. **Boot dry-run via pipe**: `echo "" | mcpx boot --prompt "test" --dry-run` (verifies boot handles stdin)

**Acceptance:** `npm test` passes all tests. Slow tests can be skipped via environment variable.

---

### Task 9: README and Cleanup

**Goal:** User-facing documentation and final polish.

**Steps:**
1. Write `README.md` with:
   - One-line description
   - Install instructions (`npm install -g mcpx`)
   - Usage examples for each subcommand
   - Pipeline example
   - Config file documentation
2. Add `.gitignore`: `node_modules/`, `dist/`, `.mcpxrc` (don't commit config with API keys)
3. Add ABOUTME comments to all source files
4. Verify all tests pass
5. Verify `npm run build` succeeds
6. Final commit

**Acceptance:** A new user can read the README, install mcpx, create a `.mcpxrc`, and run a pipe chain.

---

## 11. Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Underlying tool changes CLI flags | mcpx passes unrecognized flags through, but config injection assumes stable flag names (`--provider`, `--model`, `--api-key`) | Pin to known semver ranges; the four injected flags are fundamental and unlikely to change |
| `npx mcpx` is slow (downloads three packages) | Poor first-run experience | Document `npm install -g mcpx` as the preferred install. npx is a convenience, not the primary path |
| Config file with API keys committed to git | Security exposure | `.gitignore` includes `.mcpxrc` by default. README warns about this |
| Child process doesn't receive signals correctly | Zombie processes on Ctrl+C | Explicit signal forwarding + `stdio: 'inherit'` puts child in same process group |
| Module resolution differs across Node versions | Binary not found errors | `createRequire` is stable since Node 12. Test on Node 18 and 20 |
