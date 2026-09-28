/**
 * Combat integration (OH p.100-108; SG p.127):
 * fixed Initiative, surprise, Seize the Initiative, Adrenaline lifecycle,
 * Terrified/NPC Adrenaline per turn, Death Tests at turn start, Presence traits.
 */
import { SYSTEM_ID, SYSTEM_PATH } from "../config.mjs";
import { performTest, updateTestMessage } from "../dice/test.mjs";
import { getTestState } from "../dice/card.mjs";

export class LaundryCombat extends Combat {

  /** Initiative is a fixed value; ties: PCs before NPCs. OH p.100 */
  _sortCombatants(a, b) {
    const seizeA = a.getFlag(SYSTEM_ID, "seize") ?? 0;
    const seizeB = b.getFlag(SYSTEM_ID, "seize") ?? 0;
    if (seizeA !== seizeB) return seizeB - seizeA;
    const lastA = a.actor?.system?.modifiers?.actsLast ? 1 : 0;
    const lastB = b.actor?.system?.modifiers?.actsLast ? 1 : 0;
    if (lastA !== lastB) return lastA - lastB;
    const ia = Number.isNumeric(a.initiative) ? a.initiative : -Infinity;
    const ib = Number.isNumeric(b.initiative) ? b.initiative : -Infinity;
    if (ib !== ia) return ib - ia;
    const pa = a.actor?.type === "character" ? 1 : 0;
    const pb = b.actor?.type === "character" ? 1 : 0;
    if (pa !== pb) return pb - pa;
    return (a.getFlag(SYSTEM_ID, "tiebreak") ?? 0) - (b.getFlag(SYSTEM_ID, "tiebreak") ?? 0) || a.id.localeCompare(b.id);
  }

  /** No dice: initiative = derived value. */
  async rollInitiative(ids, { updateTurn = true } = {}) {
    ids = typeof ids === "string" ? [ids] : ids;
    const updates = [];
    // Expert Coordinator: all team members +1 Initiative. OH p.71
    const coordinator = this.combatants.some(c => c.actor?.type === "character" && c.actor.items.some(i => i.system.identifier === "expertCoordinator"));
    for (const id of ids) {
      const c = this.combatants.get(id);
      if (!c?.actor) continue;
      const bonus = coordinator && c.actor.type === "character" ? 1 : 0;
      updates.push({ _id: id, initiative: (c.actor.system.initiative ?? 0) + bonus });
    }
    if (updates.length) await this.updateEmbeddedDocuments("Combatant", updates);
    return this;
  }

  async startCombat() {
    // Everyone gets Initiative and Adrenaline up to maximum. OH p.94
    await this.rollAll();
    for (const c of this.combatants) {
      if (c.actor?.isOwner) await c.actor.refillAdrenaline?.();
    }
    const r = await super.startCombat();
    await this.#presenceCheck();
    return r;
  }


  /** Surprise round flag (OH p.100): only surprising combatants act. */
  get surprise() { return this.getFlag(SYSTEM_ID, "surprise") ?? false; }

  /** Presence: GM prompt when combat begins. SG p.127 */
  async #presenceCheck() {
    const scary = this.combatants.filter(c => c.actor?.type === "npc" && c.actor.system.presence !== "none");
    if (!scary.length) return;
    const groups = {};
    for (const c of scary) {
      const key = `${c.actor.name}|${c.actor.system.presence}`;
      groups[key] ??= { name: c.actor.name, presence: c.actor.system.presence, count: 0, uuid: c.actor.uuid };
      groups[key].count++;
    }
    for (const g of Object.values(groups)) await postPresenceCard(g);
  }
}

export class LaundryCombatant extends Combatant {
  _getInitiativeFormula() {
    return String(this.actor?.system?.initiative ?? 0);
  }
}

/** Post a Presence card: every PC may click to resist. */
export async function postPresenceCard({ name, presence, count, uuid }) {
  const content = await foundry.applications.handlebars.renderTemplate(`${SYSTEM_PATH}/templates/chat/presence-card.hbs`, {
    name, presence, count, uuid,
    presenceLabel: `LAUNDRY.Presence.${presence}`,
    effectLabel: `LAUNDRY.Presence.${presence}Effect`
  });
  return ChatMessage.create({ content, flags: { [SYSTEM_ID]: { table: { kind: "presence", presence, count, uuid } } } });
}

/**
 * A character resists a Presence trait: Spirit (Resolve) DN 4:X, X = number of such creatures.
 */
export async function resistPresence(message) {
  const data = message.getFlag(SYSTEM_ID, "table");
  const actor = game.user.character ?? canvas.tokens.controlled[0]?.actor;
  if (!actor) return ui.notifications.warn("LAUNDRY.Notify.NoCharacter", { localize: true });
  const { presence, count } = data;
  // Frightening: fail → Frightened. Terrifying: Frightened, fail → Terrified. Devastating: Terrified, fail → Psych damage = Mind.
  if (presence === "terrifying") await actor.addCondition("frightened", { turns: 0 });
  if (presence === "devastating") await actor.addCondition("terrified", { turns: 0 });
  const msg = await performTest(actor, {
    kind: "presence", label: game.i18n.localize(`LAUNDRY.Presence.${presence}`),
    attribute: "spirit", skill: "resolve", dn: 4, complexity: Math.max(1, count),
    presence: { presence, count, source: data.name }
  });
  const state = getTestState(msg);
  if (!state.evaluation.passed) {
    const turns = (await new Roll("1d6").evaluate()).total;
    if (presence === "frightening") await actor.addCondition("frightened", { turns });
    if (presence === "terrifying") { await actor.removeCondition("frightened"); await actor.addCondition("terrified", { turns }); }
    if (presence === "devastating") await actor.applyDamage({ damage: actor.system.getAttribute("mind"), type: "psychological", cause: data.name });
    state.presence.failed = true;
    state.presence.turns = turns;
    await updateTestMessage(msg, state);
  }
}

/* ---------------------------------------------------------------- */
/*  Hooks                                                            */
/* ---------------------------------------------------------------- */

export function registerCombatHooks() {
  // Turn start: Terrified +1 Adrenaline; NPCs +1 Adrenaline; Death Test if Critical.
  Hooks.on("combatTurnChange", async (combat, prior, current) => {
    if (!game.users.activeGM?.isSelf) return;
    const c = combat.combatants.get(current?.combatantId);
    const actor = c?.actor;
    if (!actor) return;
    if (actor.statuses.has("terrified")) await actor.gainAdrenaline(1);
    if (actor.type === "npc" && actor.system.adrenaline.max) await actor.gainAdrenaline(1);
    // Dig Deep: out of Adrenaline and Toughness → regain 1 Adrenaline. OH p.70
    if (actor.items.some(i => i.system.identifier === "digDeep") && !actor.system.adrenaline.value && !actor.system.toughness.value) {
      await actor.gainAdrenaline(1);
    }
    // End of own turn effects: Charging / Dodging expire at the start of the next turn.
    for (const id of ["charging", "dodging"]) if (actor.statuses.has(id)) await actor.removeCondition(id);
    if (actor.system.lastStand && actor.statuses.has("lastStand")) {
      // Last Stand: at the end of the declared turn, the character dies. Handled at prior turn end.
    }
    if (actor.system.injuries?.critical && !actor.statuses.has("dead") && !actor.statuses.has("lastStand")) {
      const owner = game.users.find(u => u.active && !u.isGM && actor.testUserPermission(u, "OWNER"));
      const prompt = await foundry.applications.handlebars.renderTemplate(`${SYSTEM_PATH}/templates/chat/death-prompt.hbs`, { actor });
      await ChatMessage.create({
        content: prompt, whisper: owner ? [owner.id, game.user.id] : [game.user.id], speaker: ChatMessage.getSpeaker({ actor }),
        flags: { [SYSTEM_ID]: { table: { kind: "death-prompt", actorUuid: actor.uuid } } }
      });
    }
    // Last Stand ends: the previous combatant dies if they declared it.
    const prev = combat.combatants.get(prior?.combatantId);
    if (prev?.actor?.statuses?.has("lastStand")) {
      const pa = prev.actor;
      await pa.removeCondition("lastStand");
      await pa.update({ "system.lastStand": false });
      await pa.toggleStatusEffect("dead", { active: true, overlay: true });
      const { Luck } = await import("../helpers/luck.mjs");
      await Luck.refill("LAUNDRY.LuckThreat.LastStandRefill");
      await ChatMessage.create({ content: `<div class="laundry-note death"><i class="fa-solid fa-skull"></i> ${game.i18n.format("LAUNDRY.Death.LastStandEnds", { name: pa.name })}</div>` });
    }
  });

  // End of combat: all Adrenaline is lost. OH p.94
  Hooks.on("deleteCombat", async (combat) => {
    if (!game.users.activeGM?.isSelf) return;
    for (const c of combat.combatants) {
      const a = c.actor;
      if (!a) continue;
      await a.clearAdrenaline?.();
      for (const id of ["charging", "dodging"]) await a.removeCondition?.(id);
    }
  });

  // Gaining Frightened/Terrified grants 1 Adrenaline. OH p.94
  Hooks.on("createActiveEffect", async (effect, options, userId) => {
    if (userId !== game.user.id) return;
    const actor = effect.parent;
    if (!(actor instanceof Actor)) return;
    if (effect.statuses.has("frightened") || effect.statuses.has("terrified")) {
      const levelHeaded = actor.items.some(i => i.system.identifier === "levelHeaded");
      if (!levelHeaded) await actor.gainAdrenaline?.(1);
    }
    if (effect.statuses.has("terrified")) actor._laundryWasTerrified = true;
  });

  // Recovering from Terrified leaves a Minor Psychological Injury. OH p.99
  Hooks.on("deleteActiveEffect", async (effect, options, userId) => {
    if (userId !== game.user.id) return;
    const actor = effect.parent;
    if (!(actor instanceof Actor) || actor.type !== "character") return;
    if (effect.statuses.has("terrified") && !actor.statuses.has("dead")) {
      await actor.addInjury("psychological", "minor", { cause: game.i18n.localize("LAUNDRY.Condition.terrified") });
    }
  });

  // Seize the Initiative: combatant tracker context option.
  Hooks.on("getCombatantContextOptions", (app, options) => {
    options.push({
      name: "LAUNDRY.Combat.Seize",
      icon: '<i class="fa-solid fa-forward-fast"></i>',
      condition: li => {
        const c = game.combat?.combatants.get(li.dataset.combatantId);
        return c?.isOwner;
      },
      callback: async li => {
        const combat = game.combat;
        const c = combat.combatants.get(li.dataset.combatantId);
        const top = Math.max(0, ...combat.combatants.map(x => x.getFlag(SYSTEM_ID, "seize") ?? 0));
        await c.setFlag(SYSTEM_ID, "seize", top + 1);
        await ChatMessage.create({ content: `<div class="laundry-note"><i class="fa-solid fa-forward-fast"></i> ${game.i18n.format("LAUNDRY.Combat.Seized", { name: c.name })}</div>` });
      }
    });
  });
}
