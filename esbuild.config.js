// ABOUTME: Build script that bundles the CLI entry point into a single executable JS file.
// ABOUTME: Uses esbuild to produce an ESM bundle with a shebang banner for direct execution.

import esbuild from "esbuild";

await esbuild.build({
  entryPoints: ["src/cli.ts"],
  bundle: true,
  platform: "node",
  target: "node18",
  format: "esm",
  outfile: "dist/cli.js",
  banner: { js: "#!/usr/bin/env node" },
  packages: "external",
});
