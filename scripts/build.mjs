import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");

function run(cmd, args) {
  const r = spawnSync(cmd, args, {
    cwd: root,
    stdio: "inherit",
    shell: true,
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

run("npx", [
  "wrangler",
  "deploy",
  "--outdir=dist",
  "--outfile=dist/index.js",
  "--minify",
  "--dry-run",
]);

try {
  rmSync(join(dist, "index.js.map"), { force: true });
} catch {
  /* ignore */
}

// Remove wrangler-generated README in dist
try {
  rmSync(join(dist, "README.md"), { force: true });
} catch {
  /* ignore */
}

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

const kb = (readFileSync(join(dist, "index.js")).byteLength / 1024).toFixed(1);
console.log(`\n✓ Bettermail build → dist/ (${kb} KiB)`);
console.log("  index.js  wrangler.jsonc  openapi.yaml");
