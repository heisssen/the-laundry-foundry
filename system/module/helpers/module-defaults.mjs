/**
 * One-time sensible defaults for popular modules (applied by the GM, only if the module is active
 * and only once per world, so later manual changes are respected).
 */
import { SYSTEM_ID } from "../config.mjs";

export function registerModuleDefaults() {
  game.settings.register(SYSTEM_ID, "moduleDefaults", { scope: "world", config: false, type: Object, default: {} });
  Hooks.once("ready", applyModuleDefaults);
}

async function applyModuleDefaults() {
  if (!game.user.isGM || game.users.activeGM?.id !== game.user.id) return;
  const done = foundry.utils.deepClone(game.settings.get(SYSTEM_ID, "moduleDefaults") ?? {});
  const tryDo = async (id, fn) => {
    if (done[id] || !game.modules.get(id)?.active) return;
    try { await fn(); done[id] = true; } catch (err) { console.warn(`the-laundry | ${id} defaults`, err); }
  };

  // Health Estimate: Toughness-based wording in the Laundry's register; vehicles get their own scale.
  await tryDo("healthEstimate", async () => {
    await game.settings.set("healthEstimate", "core.estimations", [
      { name: "Operatives & NPCs", ignoreColor: false, actorTypes: [], statusEffects: [], estimates: [
        { value: 0, label: "Down" }, { value: 25, label: "Bleeding badly" }, { value: 50, label: "Roughed up" },
        { value: 75, label: "Scratched" }, { value: 99, label: "A bit rattled" }, { value: 100, label: "Unharmed" }] },
      { name: "Vehicles", ignoreColor: false, actorTypes: ["vehicle"], statusEffects: [], estimates: [
        { value: 0, label: "Wrecked" }, { value: 25, label: "Smoking" }, { value: 50, label: "Dented" },
        { value: 99, label: "Scratched paintwork" }, { value: 100, label: "Showroom fresh" }] }
    ]);
    await game.settings.set("healthEstimate", "core.deathStateName", "Dead");
  });

  if (Object.keys(done).length) await game.settings.set(SYSTEM_ID, "moduleDefaults", done);
}
