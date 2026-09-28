/**
 * Canvas side of Laundry Zones:
 *  - any Region drawn with the Regions tool becomes a Laundry Zone (setting),
 *  - each Zone gets a label with its name, Environmental Traits and the range band
 *    from the currently controlled token (Close / Short / Medium / Long / Extreme),
 *  - a toggle in the Token controls shows / hides the labels.
 */
import { SYSTEM_ID } from "../config.mjs";
import { ZONE_TYPE, isZone, zoneTraits, zoneRange, invalidateZoneGraph, tokenZones, sceneZoneGraph } from "../data/region-zone.mjs";
import { shapeToPolygon, zoneSteps, RANGE_BY_STEPS } from "../rules/zones.mjs";

const RANGE_COLOURS = { close: 0xb8e0c0, short: 0x9fd4a8, medium: 0xf1d27a, long: 0xf0a060, extreme: 0xe07060 };
let layer = null;

export function registerZoneSettings() {
  game.settings.register(SYSTEM_ID, "autoZones", {
    name: "LAUNDRY.Setting.AutoZones.Name", hint: "LAUNDRY.Setting.AutoZones.Hint",
    scope: "world", config: true, type: Boolean, default: true
  });
  game.settings.register(SYSTEM_ID, "zoneLabels", {
    name: "LAUNDRY.Setting.ZoneLabels.Name", hint: "LAUNDRY.Setting.ZoneLabels.Hint",
    scope: "client", config: true, type: Boolean, default: true, onChange: () => refreshZoneLabels()
  });
}

export function registerZoneHooks() {
  // Draw a Region → get a Laundry Zone.
  Hooks.on("preCreateRegion", (region, data) => {
    if (!game.settings.get(SYSTEM_ID, "autoZones") || data.behaviors?.length) return;
    const n = nextZoneNumber(region.parent);
    const changes = {
      behaviors: [{ type: ZONE_TYPE, name: game.i18n.localize("LAUNDRY.Zone.Name") }],
      // Keep the map clean: the region tint shows on the Regions layer; labels show everywhere.
      visibility: CONST.REGION_VISIBILITY.LAYER
    };
    if (!data.name || /^Region( \d+)?$/i.test(data.name)) changes.name = game.i18n.format("LAUNDRY.Zone.DefaultName", { n });
    region.updateSource(changes);
  });

  const dirty = doc => { invalidateZoneGraph(doc.parent?.documentName === "Scene" ? doc.parent : doc.parent?.parent); refreshZoneLabels(); };
  for (const h of ["createRegion", "updateRegion", "deleteRegion"]) Hooks.on(h, dirty);
  for (const h of ["createRegionBehavior", "updateRegionBehavior", "deleteRegionBehavior"]) Hooks.on(h, dirty);
  Hooks.on("controlToken", () => refreshZoneLabels());
  Hooks.on("updateToken", (t, changes) => { if ("x" in changes || "y" in changes || "_regions" in changes) refreshZoneLabels(); });
  Hooks.on("canvasReady", () => { layer = null; refreshZoneLabels(); });
  Hooks.on("canvasTearDown", () => { layer = null; });

  Hooks.on("getSceneControlButtons", controls => {
    const tokens = controls.tokens ?? controls.token;
    if (!tokens?.tools) return;
    tokens.tools.laundryZones = {
      name: "laundryZones", title: "LAUNDRY.Zone.ToggleLabels", icon: "fa-solid fa-map-location-dot",
      order: 50, toggle: true, active: game.settings.get(SYSTEM_ID, "zoneLabels"),
      onChange: (event, active) => game.settings.set(SYSTEM_ID, "zoneLabels", active)
    };
  });
}

/** "Zone N" numbering that also works when several regions are created in one batch. */
const zoneCounters = new Map();
function nextZoneNumber(scene) {
  if (!scene) return 1;
  const used = scene.regions.map(r => Number(/^Zone (\d+)$/.exec(r.name)?.[1] ?? 0));
  const n = Math.max(zoneCounters.get(scene.id) ?? 0, ...used, 0) + 1;
  zoneCounters.set(scene.id, n);
  return n;
}

/* ---------------------------------------------------------------- */

const debounced = foundry.utils.debounce(drawLabels, 60);
export function refreshZoneLabels() { debounced(); }

function traitLine(z) {
  const L = k => game.i18n.localize(k);
  const parts = [];
  if (z.cover) parts.push(L(`LAUNDRY.Zone.Cover.${z.cover}`));
  if (z.lighting && z.lighting !== "normal") parts.push(L(`LAUNDRY.Zone.Lighting.${z.lighting}`));
  if (z.obscured) parts.push(L(`LAUNDRY.Zone.Obscured.${z.obscured}`));
  if (z.difficult) parts.push(L("LAUNDRY.Zone.FIELDS.difficult.label"));
  if (z.barrier) parts.push(L("LAUNDRY.Zone.FIELDS.barrier.label"));
  if (z.hazard) parts.push(`⚠ ${L(`LAUNDRY.Zone.Hazard.${z.hazard}`)}`);
  return parts.join(" · ");
}

function regionCentre(region) {
  const pts = region.shapes.filter(s => !s.hole).flatMap(s => shapeToPolygon(s));
  if (!pts.length) return null;
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  // Top-centre, so tokens standing in the middle of the Zone don't hide the label.
  const top = Math.min(...ys), bottom = Math.max(...ys);
  return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: top + Math.min((bottom - top) / 2, region.parent.grid.size * 0.75) };
}

function drawLabels() {
  if (!canvas?.ready || !canvas.scene) return;
  if (layer && layer.destroyed) layer = null;
  if (!layer) {
    layer = new PIXI.Container();
    layer.name = "laundryZoneLabels";
    layer.eventMode = "none";
    canvas.interface.addChild(layer);
  }
  layer.removeChildren().forEach(c => c.destroy({ children: true }));
  if (!game.settings.get(SYSTEM_ID, "zoneLabels")) return;

  const scene = canvas.scene;
  const from = canvas.tokens.controlled[0]?.document ?? null;
  const fromZones = from ? tokenZones(from) : [];
  const graph = fromZones.length ? sceneZoneGraph(scene) : null;
  const size = scene.grid.size;

  for (const region of scene.regions) {
    if (!isZone(region)) continue;
    if (!game.user.isGM && region.visibility === CONST.REGION_VISIBILITY.GAMEMASTER) continue;
    const c = regionCentre(region);
    if (!c) continue;
    const box = new PIXI.Container();
    box.position.set(c.x, c.y);

    const title = new foundry.canvas.containers.PreciseText(region.name.toUpperCase(), zoneStyle(size * 0.36, 0xf4ecd8));
    title.anchor.set(0.5, 1);
    box.addChild(title);

    // Traits come from a pseudo-token standing in just this region.
    const traits = traitLine(zoneTraits({ regions: new Set([region]) }));
    let y = 2;
    if (traits) {
      const t = new foundry.canvas.containers.PreciseText(traits, zoneStyle(size * 0.22, 0xe9d9a6));
      t.anchor.set(0.5, 0); t.y = y; y += t.height + 2;
      box.addChild(t);
    }
    if (graph) {
      const steps = zoneSteps(graph, fromZones, [region.id]);
      const band = steps === 0 ? "short" : (RANGE_BY_STEPS[Math.min(steps, 3)] ?? "extreme");
      const label = `${steps === 0 ? "● " : "▶ "}${game.i18n.localize(`LAUNDRY.Range.${band}`)}`;
      const r = new foundry.canvas.containers.PreciseText(label.toUpperCase(), zoneStyle(size * 0.3, RANGE_COLOURS[band]));
      r.anchor.set(0.5, 0); r.y = y;
      box.addChild(r);
    }
    layer.addChild(box);
  }
}

function zoneStyle(fontSize, fill) {
  return new PIXI.TextStyle({
    fontFamily: "Special Elite, Courier Prime, monospace",
    fontSize: Math.max(12, Math.round(fontSize)), fill, align: "center",
    stroke: 0x111111, strokeThickness: Math.max(3, Math.round(fontSize / 6)),
    dropShadow: true, dropShadowColor: 0x000000, dropShadowBlur: 4, dropShadowDistance: 0, letterSpacing: 1
  });
}

export { zoneRange };
