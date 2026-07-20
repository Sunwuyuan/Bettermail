import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const require = createRequire(import.meta.url);

// Use JS API (not the native binary path via node) — works on Linux CI + Windows
const esbuild = require("esbuild");

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

await esbuild.build({
  entryPoints: [join(root, "src/index.ts")],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  outfile: join(dist, "index.js"),
  minify: true,
  legalComments: "none",
  conditions: ["workerd", "worker", "browser"],
  mainFields: ["browser", "module", "main"],
});

const js = readFileSync(join(dist, "index.js"), "utf8");
if (
  js.startsWith("------") ||
  js.includes("Content-Disposition:") ||
  !/\bexport\b/.test(js)
) {
  console.error("Build output is not a valid Worker module; aborting.");
  process.exit(1);
}

writeFileSync(
  join(dist, "index.js"),
  js.replace(/\n?\/\/# sourceMappingURL=.*$/m, "").trimEnd() + "\n",
);

writeFileSync(
  join(dist, "wrangler.jsonc"),
  JSON.stringify(
    {
      name: "bettermail",
      main: "index.js",
      compatibility_date: "2026-07-20",
      compatibility_flags: ["nodejs_compat"],
      observability: { enabled: true, logs: { head_sampling_rate: 1 } },
      kv_namespaces: [
        { binding: "BMAIL", id: "REPLACE_WITH_KV_NAMESPACE_ID" },
      ],
    },
    null,
    2,
  ) + "\n",
);

try {
  copyFileSync(join(root, "openapi.yaml"), join(dist, "openapi.yaml"));
} catch {
  /* ignore */
}

const out = readFileSync(join(dist, "index.js"), "utf8");
const kb = (Buffer.byteLength(out) / 1024).toFixed(1);
console.log(`\n✓ Bettermail → dist/index.js (${kb} KiB)`);
console.log("  可直接全选复制粘贴到 Cloudflare Dashboard");
