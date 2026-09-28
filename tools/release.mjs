/**
 * Build an installable release of the system.
 *
 *   node tools/release.mjs [version] [--repo owner/name] [--no-pack]
 *
 * 1. sets the version (default: keep system.json's) and the manifest/download URLs
 *    (GitHub Releases layout: releases/latest/download/system.json, releases/download/v<ver>/the-laundry-<ver>.zip)
 * 2. rebuilds compendium sources and packs them (unless --no-pack; the world must be shut down)
 * 3. writes dist/the-laundry-<ver>.zip (folder "the-laundry/…") and dist/system.json
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
const flag = n => { const i = args.indexOf(n); return i >= 0 ? args.splice(i, 2)[1] : null; };
const repo = flag("--repo") ?? process.env.LAUNDRY_REPO ?? null;
const noPack = args.includes("--no-pack");
// --public: mechanics-only build without compendia that reproduce book text / statblocks.
const isPublic = args.includes("--public");
const BOOK_PACKS = ["assignments", "talents", "weapons", "gear", "spells", "bestiary", "tables", "rules"];
const version = args.find(a => /^\d+\.\d+\.\d+/.test(a));

const SYS = path.resolve("system");
const manifestPath = path.join(SYS, "system.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8").replace(/^﻿/, ""));
if (version) manifest.version = version;
const v = manifest.version;
const zipName = `${manifest.id}-${v}.zip`;
if (repo) {
  manifest.url = `https://github.com/${repo}`;
  manifest.manifest = `https://github.com/${repo}/releases/latest/download/system.json`;
  manifest.download = `https://github.com/${repo}/releases/download/v${v}/${zipName}`;
  manifest.bugs = `https://github.com/${repo}/issues`;
  manifest.changelog = `https://github.com/${repo}/blob/main/CHANGELOG.md`;
  manifest.readme = `https://github.com/${repo}/blob/main/README.md`;
}
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
// The published manifest (dist/system.json and the one inside the zip) may differ from the working one.
const published = structuredClone(manifest);
if (isPublic) {
  published.packs = published.packs.filter(p => !BOOK_PACKS.includes(p.name));
  for (const f of published.packFolders ?? []) f.packs = (f.packs ?? []).filter(n => !BOOK_PACKS.includes(n));
  published.description = "Unofficial fan-made system for The Laundry Roleplaying Game (Cubicle 7). Mechanics, sheets and automation only — bring your own content from the books.";
}
console.log(`version ${v}${repo ? ` → ${repo}` : " (no --repo: manifest/download URLs unchanged)"}`);

if (!noPack) {
  execFileSync("node", ["tools/content/build.mjs"], { stdio: "inherit" });
  execFileSync("node", ["tools/pack.mjs"], { stdio: "inherit" });
}

// Sanity: every file referenced by system.json exists.
const missing = [...(published.esmodules ?? []), ...(published.styles ?? []), ...(published.languages ?? []).map(l => l.path), ...(published.packs ?? []).map(p => p.path)]
  .filter(p => !fs.existsSync(path.join(SYS, p)));
if (missing.length) throw new Error(`missing files referenced by system.json: ${missing.join(", ")}`);

fs.mkdirSync("dist", { recursive: true });
const zipPath = path.resolve("dist", zipName);
const manifestTmp = path.resolve("dist", ".system.json");
fs.writeFileSync(manifestTmp, JSON.stringify(published, null, 2) + "\n");
fs.rmSync(zipPath, { force: true });
execFileSync("python", ["-c", `
import os, sys, zipfile
src, out, top, manifest, skip = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5].split(",")
skip_dirs = {"node_modules", ".git", "__pycache__"}
skip_prefixes = [os.path.join(src, "packs", n) for n in skip if n]
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for root, dirs, files in os.walk(src):
        dirs[:] = [d for d in dirs if d not in skip_dirs]
        if any(root == p or root.startswith(p + os.sep) for p in skip_prefixes):
            continue
        for f in files:
            if f in ("LOCK",) or f.endswith(".log"):
                continue
            full = os.path.join(root, f)
            rel = os.path.relpath(full, src)
            if rel == "system.json":
                z.write(manifest, os.path.join(top, rel))
            else:
                z.write(full, os.path.join(top, rel))
`, SYS, zipPath, manifest.id, manifestTmp, isPublic ? BOOK_PACKS.join(",") : ""]);
fs.renameSync(manifestTmp, path.resolve("dist", "system.json"));
const kb = Math.round(fs.statSync(zipPath).size / 1024);
console.log(`dist/${zipName} (${kb} KB) + dist/system.json`);
