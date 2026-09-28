/**
 * Talents with situational effects that don't fit the roll-modifier model (see talent-mods.mjs).
 * OH p.66-83 / SG Threat Assessment.
 */
import { SYSTEM_ID } from "../config.mjs";
import { actorToken, tokenZones, tokenMetres } from "../data/region-zone.mjs";

export const has = (actor, id) => !!actor?.items?.some(i => i.type === "talent" && i.system.identifier === id);
export const count = (actor, id) => actor?.items?.filter(i => i.type === "talent" && i.system.identifier === id).length ?? 0;

const RANGES = ["close", "short", "medium", "long", "extreme"];
/** Hurler: thrown items gain one step of Range. */
export function thrownRange(actor, range) {
  if (!has(actor, "hurler")) return range;
  const i = RANGES.indexOf(range || "short");
  return RANGES[Math.min(RANGES.length - 1, i + 1)];
}

/** Quick Reload: ignore the Reload Trait. */
export function stripTraits(actor, traits) {
  return has(actor, "quickReload") ? traits.filter(t => t !== "reload") : traits;
}

const hostile = (a, b) => (a?.disposition ?? 0) !== (b?.disposition ?? 0);

/**
 * Per-target attack adjustments.
 * @returns {{defence:number, attack:number, hidden:boolean|null, notes:string[]}}
 */
export function attackTalentMods(attacker, targetToken, { hidden = false } = {}) {
  const out = { defence: 0, attack: 0, hidden: null, notes: [] };
  const target = targetToken?.actor;
  const myToken = actorToken(attacker);
  if (!target) return out;
  const tname = n => game.i18n.localize(n);

  // Stay on Your Toes: Defence +1 step against enemies lower in the Initiative order.
  if (has(target, "stayOnYourToes") && (attacker.system.initiative ?? 0) < (target.system.initiative ?? 0)) {
    out.defence += 1; out.notes.push("Stay on Your Toes");
  }
  // Studied Defence: +1 step against the enemy the target studied. OH p.82
  if ((target.getFlag?.(SYSTEM_ID, "studied") ?? []).includes(attacker.uuid)) { out.defence += 1; out.notes.push("Studied Defence"); }
  // Eye in the Sky: an ally overwatching the target. OH p.71
  const eye = target.getFlag?.(SYSTEM_ID, "eyeInTheSky");
  if (eye) { out.defence += 1; out.notes.push(`Eye in the Sky (${eye.name})`); }
  // Combat Sense: no bonus for attacking it while hidden.
  if (hidden && has(target, "combatSense")) { out.hidden = false; out.notes.push("Combat Sense"); }

  const scene = targetToken.parent;
  if (scene?.tokens) {
    // Obvious Threat: enemies in an Obvious Threat's Close Range are easier for everyone else to hit.
    for (const t of scene.tokens) {
      if (!t.actor || t.actor === attacker || t.actor === target) continue;
      if (!has(t.actor, "obviousThreat") || !hostile(t, targetToken)) continue;
      if (tokenMetres(t, targetToken) <= 2) { out.defence -= 1; out.notes.push("Obvious Threat"); break; }
    }
    // Squad Tactics: 3+ with the trait in the same Zone → +1 Melee / Accuracy step.
    if (myToken && has(attacker, "squadTactics")) {
      const mine = new Set(tokenZones(myToken));
      const squad = scene.tokens.filter(t => has(t.actor, "squadTactics") && tokenZones(t).some(z => mine.has(z)));
      if (mine.size && squad.length >= 3) { out.attack += 1; out.notes.push("Squad Tactics"); }
    }
  }
  // Evasive Driving: a vehicle driven by someone with the talent is harder to hit.
  if (target.type === "vehicle" && target.system.driver) {
    const driver = fromUuidSync(target.system.driver);
    if (has(driver, "evasiveDriving")) { out.defence += 1; out.notes.push("Evasive Driving"); }
  }
  void tname;
  return out;
}

/**
 * Collected / Fearless: resist becoming Stunned / Frightened with DN 6:1 Mind (Resolve).
 * @returns {Promise<boolean>} true if the condition was resisted
 */
export async function resistCondition(actor, id) {
  const talent = id === "stunned" ? "collected" : (id === "frightened" ? "fearless" : null);
  if (!talent || !has(actor, talent) || !actor.isOwner) return false;
  const msg = await actor.rollTest({
    kind: "test", attribute: "mind", skill: "resolve", dn: 6, complexity: 1,
    label: game.i18n.format("LAUNDRY.Talent.ResistLabel", { talent: actor.items.find(i => i.system.identifier === talent).name })
  }, { skipDialog: true });
  return !!msg?.getFlag(SYSTEM_ID, "test")?.evaluation?.passed;
}

/** Medical Training / Counsellor: heal a creature in Close Range by successes, once per day per creature. */
export async function healingTalent(actor, item) {
  const id = item.system.identifier;
  const cfg = id === "medicalTraining" ? { attribute: "mind", skill: "medicine" } : { attribute: "spirit", skill: "presence" };
  const targetToken = [...game.user.targets][0]?.document ?? actorToken(actor);
  const target = targetToken?.actor ?? actor;
  const today = new Date().toISOString().slice(0, 10);
  const key = `healedBy.${id}.${actor.id}`;
  if (target.getFlag(SYSTEM_ID, key) === today) {
    return ui.notifications.warn(game.i18n.format("LAUNDRY.Talent.HealedToday", { name: target.name, talent: item.name }));
  }
  const msg = await actor.rollTest({ kind: "test", ...cfg, dn: 4, complexity: 1, label: `${item.name} → ${target.name}` });
  const ev = msg?.getFlag(SYSTEM_ID, "test")?.evaluation;
  if (!ev?.passed) return msg;
  const t = target.system.toughness;
  const healed = Math.min(ev.successes, t.max - t.value);
  const upd = async () => { await target.update({ "system.toughness.value": t.value + healed }); await target.setFlag(SYSTEM_ID, key, today); };
  if (target.isOwner) await upd();
  else {
    const { asGM } = await import("./socket.mjs");
    await asGM("healToughness", { actorUuid: target.uuid, amount: healed, key, today });
  }
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="laundry-note"><i class="fa-solid fa-kit-medical"></i> ${game.i18n.format("LAUNDRY.Talent.Healed", { name: target.name, n: healed })}</div>`
  });
  return msg;
}

/** Counterattack reminder after a melee hit. */
export async function reactionReminders(target, { melee }) {
  if (!melee || !has(target, "counterattack") || target.system.toughness?.value <= 0) return;
  const owners = game.users.filter(u => target.testUserPermission(u, "OWNER")).map(u => u.id);
  await ChatMessage.create({
    whisper: owners, speaker: ChatMessage.getSpeaker({ actor: target }),
    content: `<div class="laundry-note"><i class="fa-solid fa-hand-back-fist"></i> ${game.i18n.format("LAUNDRY.Talent.CounterattackReminder", { name: target.name })}</div>`
  });
}

/* ------------------------------------------------------------ */
/*  Movement reactions: Opportunist / Stand and Fire (OH p.77, 82) */
/* ------------------------------------------------------------ */

function remind(actor, key, data) {
  const owners = game.users.filter(u => actor.testUserPermission(u, "OWNER")).map(u => u.id);
  return ChatMessage.create({
    whisper: owners, speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="laundry-note reaction"><i class="fa-solid fa-person-rifle"></i> ${game.i18n.format(key, data)}</div>`
  });
}

export function registerMovementReactions() {
  // Remember where the token was and which Zones it stood in before it moves.
  Hooks.on("preUpdateToken", (token, changes, options) => {
    if (!("x" in changes) && !("y" in changes)) return;
    options.laundryFrom = { x: token._source.x, y: token._source.y, zones: tokenZones(token) };
  });
  Hooks.on("updateToken", async (token, changes, options) => {
    const from = options.laundryFrom;
    if (!from || !game.users.activeGM?.isSelf || !token.actor) return;
    const scene = token.parent;
    // Any running encounter on this scene (game.combat is only the one being viewed).
    if (!game.combats.some(c => c.started && (!c.scene || c.scene.id === scene.id))) return;
    const was = { parent: scene, _source: { x: from.x, y: from.y }, width: token.width, height: token.height };
    const nowZones = new Set(tokenZones(token));
    for (const other of scene.tokens) {
      const r = other.actor;
      if (!r || other === token || !hostile(other, token) || r.statuses?.has("dead") || r.statuses?.has("incapacitated")) continue;
      // Opportunist: an enemy leaves your Close Range.
      if (has(r, "opportunist") && tokenMetres(was, other) <= 2 && tokenMetres(token, other) > 2) {
        await remind(r, "LAUNDRY.Talent.OpportunistReminder", { name: r.name, enemy: token.name });
      }
      // Stand and Fire: an enemy enters your Zone.
      if (has(r, "standAndFire")) {
        const mine = tokenZones(other);
        const entered = mine.some(z => nowZones.has(z) && !from.zones.includes(z));
        if (entered) await remind(r, "LAUNDRY.Talent.StandAndFireReminder", { name: r.name, enemy: token.name });
      }
    }
  });
}
