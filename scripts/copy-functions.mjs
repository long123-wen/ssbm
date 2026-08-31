// scripts/copy-functions.mjs
// Copy Cloudflare Pages Functions from ./functions/ to ./dist/functions/ so
// `wrangler pages deploy dist` actually ships the backend. Vite's build only
// handles static assets; without this step /api/* routes are dropped on deploy.
import { cp, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const src = path.join(root, "functions");
const dest = path.join(root, "dist", "functions");

if (!existsSync(src)) {
  console.log("[copy-functions] no functions/ source, skip");
  process.exit(0);
}

await rm(dest, { recursive: true, force: true });
await mkdir(dest, { recursive: true });
await cp(src, dest, { recursive: true });
console.log(`[copy-functions] copied ${src} -> ${dest}`);
