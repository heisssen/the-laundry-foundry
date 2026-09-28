/**
 * Compile packs-src/<pack>/*.json → system/packs/<pack> (LevelDB) using the Foundry CLI.
 * Each JSON file is one document; `_key` is generated if missing.
 */
import { compilePack } from "@foundryvtt/foundryvtt-cli";
import fs from "node:fs";
import path from "node:path";

const SRC = path.resolve("packs-src");
const DEST = path.resolve("system/packs");
const system = JSON.parse(fs.readFileSync("system/system.json", "utf8"));

const COLLECTION = { Item: "items", Actor: "actors", RollTable: "tables", JournalEntry: "journal", Macro: "macros" };

/** Ensure every document (and embedded docs) has _id and _key for the CLI. */
function prepare(doc, type) {
  const coll = COLLECTION[type];
  doc._id ??= randomId(doc.name);
  doc._key = `!${coll}!${doc._id}`;
  const embedded = { items: "items", effects: "effects", results: "results", pages: "pages" };
  for (const [field, sub] of Object.entries(embedded)) {
    if (!Array.isArray(doc[field])) continue;
    for (const e of doc[field]) {
      e._id ??= randomId(`${doc.name}-${e.name ?? e.text ?? Math.random()}`);
      e._key = `!${coll}.${sub}!${doc._id}.${e._id}`;
      for (const eff of e.effects ?? []) {
        eff._id ??= randomId(`${e.name}-${eff.name}`);
        eff._key = `!${coll}.${sub}.effects!${doc._id}.${e._id}.${eff._id}`;
      }
    }
  }
  return doc;
}

/** Deterministic 16-char id from a string so rebuilds keep stable ids. */
function randomId(seed) {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (const c of String(seed)) {
    const k = c.codePointAt(0);
    h1 = Math.imul(h1 ^ k, 2654435761); h2 = Math.imul(h2 ^ k, 1597334677);
  }
  let out = "", x = (h1 >>> 0) * 4294967296 + (h2 >>> 0);
  for (let i = 0; i < 16; i++) {
    out += chars[Math.floor(x % 62)];
    x = Math.floor(x / 62) + (i * 7919 + h1 % 97);
  }
  return out;
}

const only = process.argv[2];
for (const pack of system.packs) {
  if (only && pack.name !== only) continue;
  const srcDir = path.join(SRC, pack.name);
  const tmpDir = path.join(SRC, ".build", pack.name);
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });
  let count = 0;
  if (fs.existsSync(srcDir)) {
    for (const f of fs.readdirSync(srcDir).filter(f => f.endsWith(".json"))) {
      const raw = JSON.parse(fs.readFileSync(path.join(srcDir, f), "utf8"));
      const docs = Array.isArray(raw) ? raw : [raw];
      for (const doc of docs) {
        prepare(doc, pack.type);
        fs.writeFileSync(path.join(tmpDir, `${doc._id}.json`), JSON.stringify(doc));
        count++;
      }
    }
  }
  const dest = path.join(DEST, pack.name);
  fs.rmSync(dest, { recursive: true, force: true });
  await compilePack(tmpDir, dest, { log: false });
  console.log(`packed ${pack.name}: ${count} documents`);
}
fs.rmSync(path.join(SRC, ".build"), { recursive: true, force: true });
