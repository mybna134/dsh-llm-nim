import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
process.chdir(fileURLToPath(new URL("../", import.meta.url)));
execFileSync(process.execPath, [require.resolve("typescript/bin/tsc")], { stdio: "inherit" });
await build({
  entryPoints: ["src/index.ts"], outfile: "dist/index.js",
  platform: "node", target: "node22", format: "esm", bundle: false,
});
await build({
  entryPoints: ["src/client.ts"], outfile: "dist/client.js",
  platform: "browser", target: "es2022", format: "cjs", bundle: true,
  packages: "external",
  banner: { js: 'window.__ModuleLoader__.load({ id: "dsh-llm-nim", factory: (require) => { var module = { exports: {} }; var exports = module.exports;' },
  footer: { js: "return module.exports; } });" },
});
