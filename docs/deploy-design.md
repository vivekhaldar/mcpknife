# Plan: `mcpknife deploy` Subcommand

## Context

mcpknife has a pipeline: `boot → mod → ui → export`. Export produces a standalone Node.js MCP server project on disk. The missing piece is getting that server running in the cloud. `deploy` closes the loop so a user can go from prompt to production in one pipeline.

## Design Decisions

### Provider Architecture: Internal modules, `--target` CLI arg

All provider implementations live inside mcpknife as modules under `src/providers/`. The user selects a target via `--target <name>` (e.g. `--target fly`, `--target cloudrun`). A shared `Provider` interface keeps them uniform. Adding a new provider = add a file + update the dispatch map.

### Cloud Providers

After researching the landscape (Fly.io, Cloud Run, Cloudflare Workers, Vercel, Smithery, mcp.run):

**Fly.io** (`--target fly`, default) — Best MCP-specific DX:
- Native MCP tooling and docs
- Persistent servers (MCP's session model needs this)
- No cold starts
- Simple CLI (`flyctl`) handles everything

**Google Cloud Run** (`--target cloudrun`) — Production-scale option:
- Container-based, auto-scaling, generous free tier
- Deploy via `gcloud run deploy --source .`
- Mature observability (logging, monitoring, tracing)

Not implementing: Cloudflare Workers (incompatible with `vm` sandbox in generated server.js), Vercel (serverless friction with MCP sessions), Smithery (too niche), Docker-only (that's packaging, not deploying).

### Pipeline Integration

Export currently writes all output to stderr. To enable piping (`mcpknife export | mcpknife deploy`), export needs to write the output directory path to stdout.

Deploy reads its input as:
1. Positional arg: `mcpknife deploy ./my-server`
2. Stdin pipe: `mcpknife export | mcpknife deploy`
3. Error if neither provided

### Authentication

The generated `server.js` currently has no auth. Deploy adds bearer token auth:
- Add `MCP_API_KEY` env var support to the generated server template in `codegen.ts`
- When set, requests must include `Authorization: Bearer <key>` header
- Deploy auto-generates a key if `--api-key` is not provided (deployed servers always get auth)
- `/health` endpoint remains unauthenticated (for load balancer probes)

## Implementation

### Step 1: Add bearer auth to generated server.js

**File: `src/codegen.ts`** — In `generateServerJs()`, add auth middleware at the top of the HTTP request handler (inside the `httpServer` creation, before route matching):

```js
const MCP_API_KEY = process.env.MCP_API_KEY;
// ... in request handler, after CORS/OPTIONS:
if (MCP_API_KEY && req.url !== "/health") {
  const auth = req.headers["authorization"];
  if (!auth || auth !== "Bearer " + MCP_API_KEY) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Unauthorized" }));
    return;
  }
}
```

Also add `Authorization` to the `Access-Control-Allow-Headers` CORS header so browsers can send it.

### Step 2: Make export write path to stdout

**File: `src/export.ts`** — At the end of `runExport()`, after generating the project, resolve the absolute path and write it to stdout:

```typescript
const absOutputDir = path.resolve(outputDir);
// ... existing generateProject call ...
if (!process.stdout.isTTY) {
  process.stdout.write(absOutputDir + "\n");
}
```

Only write to stdout when piped (not TTY), so terminal usage stays clean.

### Step 3: Provider interface

**New file: `src/providers/types.ts`**

```typescript
export interface DeployResult {
  url: string;            // Deployed MCP endpoint URL
  name: string;           // App name as deployed
  target: string;         // Provider name
  apiKey: string;         // The API key set on the server
  dashboardUrl?: string;  // Provider dashboard link
}

export interface DeployOptions {
  projectDir: string;     // Absolute path to exported project
  name: string;           // App name
  region?: string;        // Deployment region
  env?: Record<string, string>;  // Extra env vars
  apiKey: string;         // Bearer token for deployed server
}

export interface Provider {
  name: string;
  preflight(opts: DeployOptions): Promise<void>;
  deploy(opts: DeployOptions): Promise<DeployResult>;
  destroy(name: string): Promise<void>;
}
```

### Step 4: Fly.io provider

**New file: `src/providers/fly.ts`**

Uses `child_process.execFile` to shell out to `flyctl`. Does NOT reimplement the Fly API.

**`preflight()`**:
- Check `flyctl` is installed (exec `fly version`)
- Check user is logged in (exec `fly auth whoami`)
- Clear error messages with install/login URLs if not

**`deploy()`**:
1. Generate a minimal `Dockerfile` in the project dir (node:20-slim, npm install, EXPOSE 8080, CMD node server.js)
2. Run `fly launch --no-deploy --name <name> --region <region> --yes` to create the app + fly.toml (skip if fly.toml already exists for re-deploys)
3. Set secrets: `fly secrets set MCP_API_KEY=<key> [extra env vars] --app <name>`
4. Run `fly deploy --app <name>`
5. Return `{ url: "https://<name>.fly.dev/mcp", ... }`

**`destroy()`**:
- Run `fly apps destroy <name> --yes`

### Step 4b: Google Cloud Run provider

**New file: `src/providers/cloudrun.ts`**

Uses `child_process.execFile` to shell out to `gcloud`. Same pattern as Fly provider.

**`preflight()`**:
- Check `gcloud` CLI is installed (exec `gcloud version`)
- Check user is authenticated (exec `gcloud auth print-access-token`)
- Check a project is set (exec `gcloud config get-value project`)
- Clear error messages with install/auth instructions if not

**`deploy()`**:
1. Generate a minimal `Dockerfile` in the project dir (same as Fly — node:20-slim, npm install, EXPOSE 8080)
2. Run `gcloud run deploy <name> --source <dir> --region <region> --allow-unauthenticated --set-env-vars MCP_API_KEY=<key>[,extra=vars] --port 8080 --quiet`
3. Parse the service URL from gcloud output
4. Return `{ url: "<service-url>/mcp", dashboardUrl: "https://console.cloud.google.com/run/detail/..." }`

**`destroy()`**:
- Run `gcloud run services delete <name> --region <region> --quiet`

Note: Cloud Run uses `--set-env-vars` (not secrets) for simplicity in V1. Can add Secret Manager integration later if needed.

### Step 5: Deploy orchestrator

**New file: `src/deploy.ts`**

Arg parsing (same manual style as `parseExportArgs`):
```
mcpknife deploy [directory] [options]

Options:
  --target <name>      Deployment target: fly, cloudrun (default: fly)
  --name <name>        App name (default: from directory name)
  --region <code>      Deployment region (default: provider default)
  --env KEY=VALUE      Environment variable (repeatable)
  --api-key <key>      Bearer token for auth (default: auto-generated)
  --destroy            Tear down a previous deployment
  --help               Show help
```

Provider dispatch map in `deploy.ts`:
```typescript
import { FlyProvider } from "./providers/fly.js";
import { CloudRunProvider } from "./providers/cloudrun.js";
import type { Provider } from "./providers/types.js";

const TARGETS: Record<string, Provider> = {
  fly: new FlyProvider(),
  cloudrun: new CloudRunProvider(),
};
```

Main flow:
1. Parse args
2. Read project directory from positional arg or stdin
3. Validate directory (must contain `package.json` and `server.js`)
4. Select provider from `TARGETS` map via `--target` flag
5. Generate API key if not provided (`crypto.randomBytes(24).toString("base64url")`)
6. Call `provider.preflight()` then `provider.deploy()`
7. Print deployed URL to stdout (for pipeline composability)
8. Print summary to stderr: endpoint, API key, dashboard URL, Claude Desktop config snippet

For `--destroy`: parse `--name` (required), call `provider.destroy(name)`.

The Claude Desktop config snippet printed to stderr is especially useful:
```json
{
  "mcpServers": {
    "<name>": {
      "url": "https://<name>.fly.dev/mcp",
      "headers": {
        "Authorization": "Bearer <key>"
      }
    }
  }
}
```

### Step 6: Wire into CLI

**File: `src/cli.ts`** — Add deploy dispatch alongside export:

```typescript
} else if (subcommand === "deploy") {
  runDeploy(rawArgv).then(() => process.exit(0)).catch((err: Error) => {
    console.error(`mcpknife deploy: ${err.message}`);
    process.exit(1);
  });
}
```

Update `printHelp()` to include `deploy` in the commands list and examples.

### Step 7: Tests

**New file: `test/deploy.test.ts`**

Following existing test patterns (see `test/export.test.ts`):
- `parseDeployArgs`: Flag parsing unit tests (target, name, region, env, api-key, destroy, positional dir)
- `validateProjectDir`: Rejects dirs without server.js/package.json
- `readProjectDir`: Reads from positional arg or stdin
- Fly provider: Dockerfile generation content, fly.toml detection for re-deploys
- Cloud Run provider: gcloud command construction, env var formatting
- Output format: stdout has URL, stderr has summary

No mocked deployments — actual cloud deployment is a manual end-to-end test.

### Step 8: Update help text and README

- `src/cli.ts` printHelp: add `deploy` command, update pipeline example
- `README.md`: document deploy subcommand
- `CLAUDE.md`: mention deploy in architecture description

## Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `src/codegen.ts` | Modify | Add MCP_API_KEY bearer auth to generated server.js |
| `src/export.ts` | Modify | Write output dir path to stdout when piped |
| `src/providers/types.ts` | Create | Provider interface |
| `src/providers/fly.ts` | Create | Fly.io provider |
| `src/providers/cloudrun.ts` | Create | Google Cloud Run provider |
| `src/deploy.ts` | Create | Deploy orchestrator (arg parsing, validation, target dispatch, output) |
| `src/cli.ts` | Modify | Wire deploy subcommand, update help |
| `test/deploy.test.ts` | Create | Tests for deploy module |
| `README.md` | Modify | Document deploy |
| `CLAUDE.md` | Modify | Update architecture description |

## Verification

1. **Unit tests**: `npx vitest run test/deploy.test.ts` — arg parsing, directory validation, Dockerfile generation
2. **Build**: `npm run build` — verify no compilation errors
3. **Existing tests**: `npm test` — verify export and other tests still pass (especially after codegen auth change)
4. **Manual E2E**: `mcpknife boot --prompt "Dictionary API" https://dictionaryapi.dev | mcpknife export | mcpknife deploy --name test-dict` — full pipeline to deployed server
5. **Auth check**: `curl https://test-dict.fly.dev/mcp` returns 401; `curl -H "Authorization: Bearer <key>" https://test-dict.fly.dev/health` returns 200
6. **Teardown**: `mcpknife deploy --destroy --name test-dict`
