/**
 * "Laundry Zone" Region behavior: Environmental Traits of a Zone (OH p.102-103).
 *
 *  - Hazard (Minor 1 / Major 3 / Deadly 5 Damage) when a token first enters the Zone
 *    in an encounter or starts its turn there — applied automatically.
 *  - Cover, Dark, Obscured and Difficult Terrain are read by the attack and test
 *    workflows through {@link zoneTraits}.
 */
import { SYSTEM_ID } from "../config.mjs";
import { asGM } from "../helpers/socket.mjs";
import { shapeToPolygon, buildAdjacency, zoneSteps, rangeBand } from "../rules/zones.mjs";

const { StringField, BooleanField, SetField } = foundry.data.fields;

/** Other regions of the scene being edited, for the manual-link picker. */
function regionChoices() {
  const scene = canvas?.scene ?? game.scenes.viewed;
  return Object.fromEntries((scene?.regions ?? []).map(r => [r.id, r.name]));
}

/**
 * Manually linked Zones. No `choices` in the schema (that would reject links on scenes
 * other than the viewed one); the picker gets the scene's regions at render time.
 */
function linksField() {
  const field = new SetField(new StringField({ required: true, blank: false }));
  field._toInput = function (config) {
    config.choices = regionChoices();
    StringField._prepareChoiceConfig(config);
    return foundry.applications.fields.createMultiSelectInput(config);
  };
  return field;
}

export const HAZARD_DAMAGE = { none: 0, minor: 1, major: 3, deadly: 5 };

const choice = (initial, keys, prefix) => new StringField({
  required: true, initial, choices: Object.fromEntries(keys.map(k => [k, `${prefix}.${k}`]))
});

export class ZoneBehaviorData extends foundry.data.regionBehaviors.RegionBehaviorType {
  static LOCALIZATION_PREFIXES = ["LAUNDRY.Zone"];

  static defineSchema() {
    return {
      hazard: choice("none", Object.keys(HAZARD_DAMAGE), "LAUNDRY.Zone.Hazard"),
      damageType: choice("physical", ["physical", "psychological"], "LAUNDRY.DamageType"),
      ignoreArmour: new BooleanField(),
      cover: choice("none", ["none", "partial", "total"], "LAUNDRY.Zone.Cover"),
      lighting: choice("normal", ["normal", "poorlyLit", "dark"], "LAUNDRY.Zone.Lighting"),
      obscured: choice("none", ["none", "light", "heavy"], "LAUNDRY.Zone.Obscured"),
      difficult: new BooleanField(),
      barrier: new BooleanField(),
      autoAdjacent: new BooleanField({ initial: true }),
      links: linksField(),
      note: new StringField({ required: true, blank: true, initial: "" })
    };
  }

  static events = {
    [CONST.REGION_EVENTS.TOKEN_MOVE_IN]: async function (event) {
      if (!this.hazardDamage || !event.user.isSelf) return;
      const token = event.data.token;
      // "When you enter the Hazard for the first time" — once per encounter.
      const key = game.combat?.started ? game.combat.id : "none";
      const flagPath = `hazards.${this.parent.id}`;
      if (token.getFlag(SYSTEM_ID, flagPath) === key && key !== "none") return;
      if (token.isOwner) await token.setFlag(SYSTEM_ID, flagPath, key);
      await this.hurt(token);
    },
    [CONST.REGION_EVENTS.TOKEN_TURN_START]: async function (event) {
      if (!this.hazardDamage || !event.user.isSelf) return;
      await this.hurt(event.data.token);
    }
  };

  get hazardDamage() { return HAZARD_DAMAGE[this.hazard] ?? 0; }

  async hurt(token) {
    const actor = token.actor;
    if (!actor) return;
    const hit = {
      damage: this.hazardDamage, type: this.damageType, ignoreArmour: this.ignoreArmour, armourPenetration: 0,
      cause: `${game.i18n.localize(`LAUNDRY.Zone.Hazard.${this.hazard}`)} (${this.parent.region?.name ?? ""})`
    };
    if (actor.isOwner) return actor.applyDamage(hit);
    return asGM("applyDamage", { actorUuid: actor.uuid, hit });
  }
}

/**
 * Merge the Environmental Traits of every Laundry Zone a token stands in.
 * @param {TokenDocument|null} token
 */
export function zoneTraits(token) {
  const out = { cover: null, lighting: null, obscured: null, difficult: false, barrier: false, hazard: null, names: [], notes: [] };
  if (!token?.regions) return out;
  const rank = { none: 0, normal: 0, partial: 1, total: 2, light: 1, heavy: 2, poorlyLit: 1, dark: 2 };
  const worse = (cur, v) => (v && rank[v] > rank[cur ?? "none"]) ? v : cur;
  for (const region of token.regions) {
    for (const b of region.behaviors) {
      if (b.disabled || b.type !== ZONE_TYPE) continue;
      const s = b.system;
      out.cover = worse(out.cover, s.cover);
      out.obscured = worse(out.obscured, s.obscured);
      out.lighting = worse(out.lighting, s.lighting);
      out.difficult ||= s.difficult;
      out.barrier ||= s.barrier;
      if (s.hazard !== "none" && HAZARD_DAMAGE[s.hazard] > HAZARD_DAMAGE[out.hazard ?? "none"]) out.hazard = s.hazard;
      out.names.push(region.name);
      if (s.note) out.notes.push(s.note);
    }
  }
  return out;
}

/** The token an actor is standing on (synthetic token first, then an active linked token). */
export function actorToken(actor) {
  if (!actor) return null;
  if (actor.token) return actor.token;
  const active = actor.getActiveTokens?.(false, true)?.[0];
  if (active) return active;
  // No canvas (or not drawn yet): look the token up on the viewed / active scene.
  const scene = game.scenes.viewed ?? game.scenes.active;
  return scene?.tokens.find(t => t.actorId === actor.id) ?? null;
}

/**
 * Environmental Trait modifiers for a Test made by someone standing in a Zone (OH p.102-104).
 * Approximation: the observer's own Zone stands in for the observed Zone.
 */
export function zoneTestMods(actor, { attribute, skill, kind } = {}) {
  const out = { advantage: 0, dn: 0, applied: [] };
  if (["luck", "death", "kResist"].includes(kind)) return out;
  const z = zoneTraits(actorToken(actor));
  if (!z.names.length) return out;
  const L = k => game.i18n.localize(k);
  if (skill === "stealth" && z.lighting === "dark") { out.advantage += 1; out.applied.push(`${L("LAUNDRY.Zone.Lighting.dark")} +A`); }
  if (skill === "awareness") {
    if (z.lighting === "dark" || z.lighting === "poorlyLit") { out.advantage -= 1; out.applied.push(`${L(`LAUNDRY.Zone.Lighting.${z.lighting}`)} −A`); }
    if (z.obscured === "light") { out.dn += 1; out.applied.push(`${L("LAUNDRY.Zone.Obscured.light")} DN+1`); }
    if (z.obscured === "heavy") { out.advantage -= 1; out.dn += 1; out.applied.push(`${L("LAUNDRY.Zone.Obscured.heavy")} −A, DN+1`); }
  }
  if (skill === "reflexes" && attribute === "body" && z.difficult) { out.dn += 1; out.applied.push(`${L("LAUNDRY.Zone.FIELDS.difficult.label")} DN+1`); }
  return out;
}

/** Attack modifiers from the target's Zone: Cover (ranged Defence), lighting/obscurement (ranged Disadvantage). */
export function zoneAttackMods(targetToken, { ranged }) {
  const z = zoneTraits(targetToken);
  const out = { cover: null, advantage: 0, applied: [] };
  if (!ranged || !z.names.length) return out;
  const L = k => game.i18n.localize(k);
  if (z.cover) { out.cover = z.cover; out.applied.push(L(`LAUNDRY.Zone.Cover.${z.cover}`)); }
  if (z.lighting === "dark" || z.lighting === "poorlyLit" || z.obscured === "heavy") {
    out.advantage = -1;
    out.applied.push(`${L(z.obscured === "heavy" ? "LAUNDRY.Zone.Obscured.heavy" : `LAUNDRY.Zone.Lighting.${z.lighting}`)} −A`);
  }
  return out;
}

/** Registered sub-type name (systems register without a namespace). */
export let ZONE_TYPE = "zone";
export function registerZoneBehavior() {
  const key = Object.keys(CONFIG.RegionBehavior.dataModels).find(k => k === "zone" || k === `${SYSTEM_ID}.zone`) ?? "zone";
  ZONE_TYPE = key;
  CONFIG.RegionBehavior.dataModels[key] = ZoneBehaviorData;
  CONFIG.RegionBehavior.typeIcons[key] = "fa-solid fa-radiation";
}

/* ---------------------------------------------------------------- */
/*  Zone graph & range                                               */
/* ---------------------------------------------------------------- */

const graphCache = new WeakMap();

export function isZone(region) {
  return region.behaviors.some(b => !b.disabled && b.type === ZONE_TYPE);
}

function zoneBehavior(region) {
  return region.behaviors.find(b => !b.disabled && b.type === ZONE_TYPE);
}

/** Adjacency graph of the scene's Laundry Zones (cached until regions change). */
export function sceneZoneGraph(scene) {
  if (!scene) return new Map();
  const hit = graphCache.get(scene);
  if (hit) return hit;
  const zones = scene.regions.filter(isZone).map(r => {
    const b = zoneBehavior(r);
    return {
      id: r.id, auto: b.system.autoAdjacent, links: [...b.system.links],
      polygons: r.shapes.filter(s => !s.hole).map(s => shapeToPolygon(s))
    };
  });
  // Zones "touch" if the gap between them is under half a grid square.
  const graph = buildAdjacency(zones, (scene.grid.size ?? 100) / 2);
  graphCache.set(scene, graph);
  return graph;
}

export function invalidateZoneGraph(scene) { if (scene) graphCache.delete(scene); }

export function tokenZones(token) {
  return [...(token?.regions ?? [])].filter(isZone).map(r => r.id);
}

/** Straight-line distance between two token documents in scene units → metres. */
export function tokenMetres(a, b) {
  const scene = a.parent;
  const size = scene.grid.size, dist = scene.grid.distance;
  const ca = { x: a._source.x + (a.width * size) / 2, y: a._source.y + (a.height * size) / 2 };
  const cb = { x: b._source.x + (b.width * size) / 2, y: b._source.y + (b.height * size) / 2 };
  // Edge-to-edge: subtract half the token footprints.
  const px = Math.max(0, Math.hypot(ca.x - cb.x, ca.y - cb.y) - ((a.width + b.width) * size) / 2);
  const d = (px / size) * dist;
  return scene.grid.units === "ft" ? d * 0.3048 : d;
}

/**
 * Zone-based range band between two tokens, or null if either isn't in a Laundry Zone.
 * @returns {{band:string, steps:number}|null}
 */
export function zoneRange(a, b) {
  if (!a || !b || a.parent !== b.parent) return null;
  const za = tokenZones(a), zb = tokenZones(b);
  if (!za.length || !zb.length) return null;
  const steps = zoneSteps(sceneZoneGraph(a.parent), za, zb);
  return { band: rangeBand(steps, tokenMetres(a, b)), steps };
}
