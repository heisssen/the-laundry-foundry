/**
 * Compendium lookups by name/identifier across the system's packs.
 */
import { SYSTEM_ID } from "../config.mjs";

const norm = s => String(s ?? "").toLowerCase().replace(/[’'`]/g, "'").replace(/\s+/g, " ").trim();

export function systemPacks(type = "Item") {
  return game.packs.filter(p => p.metadata.packageName === SYSTEM_ID && p.documentName === type);
}

/** Find an Item document by name (or identifier) in system packs, then world items. */
export async function findItem(name, { type = null } = {}) {
  const n = norm(name);
  for (const pack of systemPacks("Item")) {
    const index = await pack.getIndex({ fields: ["system.identifier", "type"] });
    const hit = index.find(e => (norm(e.name) === n || norm(e.system?.identifier) === n) && (!type || e.type === type));
    if (hit) return pack.getDocument(hit._id);
  }
  return game.items.find(i => (norm(i.name) === n || norm(i.system.identifier) === n) && (!type || i.type === type)) ?? null;
}

/** All index entries of a given item type across system packs (+ world items). */
export async function listItems(type) {
  const out = [];
  for (const pack of systemPacks("Item")) {
    const index = await pack.getIndex({ fields: ["system.identifier", "system.requirements", "system.category", "type", "img"] });
    for (const e of index) if (e.type === type) out.push({ ...e, uuid: e.uuid ?? `Compendium.${pack.collection}.Item.${e._id}`, pack: pack.collection });
  }
  for (const i of game.items.filter(i => i.type === type)) out.push({ _id: i.id, name: i.name, img: i.img, uuid: i.uuid, type });
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
