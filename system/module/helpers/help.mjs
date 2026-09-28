/**
 * Help Action (OH p.105) and short-lived buffs placed on other actors:
 *   - Help: the ally adds 1d6 + helper's Training (in the Test's Skill) to their next Test, or to an attack
 *     against a chosen enemy before the helper's next turn. Helpful / Staff Synergy: +1 die.
 *     Stirring Voice: may use Presence Training instead.
 *   - Studied Defence: Defence +1 step against the studied enemy until your next Rest.
 *   - Eye in the Sky: an ally's Defence +1 step until the start of your next turn.
 * State lives in actor flags; writes to actors you don't own go through the GM.
 */
import { SYSTEM_ID } from "../config.mjs";
import { asGM, registerGMHandler } from "./socket.mjs";

const has = (a, id) => !!a?.items?.some(i => i.type === "talent" && i.system.identifier === id);

export function registerHelp() {
  registerGMHandler("actorFlag", async ({ actorUuid, key, value }) => {
    const a = await fromUuid(actorUuid);
    if (!a) return null;
    return value === null ? a.unsetFlag(SYSTEM_ID, key) : a.setFlag(SYSTEM_ID, key, value);
  });
  // Buffs tied to "until the start of your next turn" expire when their source acts again.
  Hooks.on("combatTurnChange", async (combat, prior, current) => {
    if (!game.users.activeGM?.isSelf) return;
    const src = combat.combatants.get(current?.combatantId)?.actor;
    if (!src) return;
    for (const a of game.actors) await expireFrom(a, src.uuid);
    for (const t of canvas?.scene?.tokens ?? []) if (!t.actorLink && t.actor) await expireFrom(t.actor, src.uuid);
  });
}

async function expireFrom(actor, sourceUuid) {
  const helps = actor.getFlag(SYSTEM_ID, "helps") ?? [];
  const keep = helps.filter(h => !(h.kind === "attack" && h.helperUuid === sourceUuid));
  if (keep.length !== helps.length) await setFlag(actor, "helps", keep);
  const eye = actor.getFlag(SYSTEM_ID, "eyeInTheSky");
  if (eye?.by === sourceUuid) await setFlag(actor, "eyeInTheSky", null);
}

export async function setFlag(actor, key, value) {
  if (actor.isOwner) return value === null ? actor.unsetFlag(SYSTEM_ID, key) : actor.setFlag(SYSTEM_ID, key, value);
  return asGM("actorFlag", { actorUuid: actor.uuid, key, value });
}

/* ------------------------------------------------------------ */
/*  Help                                                          */
/* ------------------------------------------------------------ */

/** Pick an ally (targeted token, else a dialog of scene / team characters) and record the Help. */
export async function takeHelpAction(helper) {
  const L = k => game.i18n.localize(k);
  const candidates = new Map();
  for (const t of canvas?.scene?.tokens ?? []) if (t.actor && t.actor !== helper && t.actor.type !== "vehicle") candidates.set(t.actor.uuid, t.actor);
  for (const a of game.actors) if (a.type === "character" && a !== helper) candidates.set(a.uuid, a);
  const targeted = [...game.user.targets].map(t => t.actor).filter(Boolean);
  const ally = targeted.find(a => a !== helper && (a.type === "character" || a.token?.disposition === helper.token?.disposition));
  const enemy = targeted.find(a => a !== ally);
  const options = [...candidates.values()].map(a => `<option value="${a.uuid}" ${a === ally ? "selected" : ""}>${foundry.utils.escapeHTML(a.name)}</option>`).join("");
  const res = await foundry.applications.api.DialogV2.prompt({
    window: { title: "LAUNDRY.Help.Title", icon: "fa-solid fa-handshake-angle" },
    classes: ["laundry", "laundry-dialog"],
    content: `<div class="form-group"><label>${L("LAUNDRY.Help.Ally")}</label><select name="ally">${options}</select></div>
      <div class="form-group"><label>${L("LAUNDRY.Help.Kind")}</label><select name="kind">
        <option value="test">${L("LAUNDRY.Help.KindTest")}</option>
        <option value="attack" ${enemy ? "selected" : ""}>${L("LAUNDRY.Help.KindAttack")}${enemy ? ` — ${foundry.utils.escapeHTML(enemy.name)}` : ""}</option></select></div>
      <p class="hint">${L("LAUNDRY.Help.Hint")}</p>`,
    ok: { label: "LAUNDRY.Help.Give", callback: (e, b) => ({ ally: b.form.elements.ally.value, kind: b.form.elements.kind.value }) },
    rejectClose: false
  });
  if (!res) return null;
  const recipient = await fromUuid(res.ally);
  if (!recipient) return null;
  const help = {
    id: foundry.utils.randomID(), helperUuid: helper.uuid, helperName: helper.name, kind: res.kind,
    targetUuid: res.kind === "attack" ? (enemy?.uuid ?? null) : null
  };
  await setFlag(recipient, "helps", [...(recipient.getFlag(SYSTEM_ID, "helps") ?? []), help]);
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: helper }),
    content: `<div class="laundry-note"><i class="fa-solid fa-handshake-angle"></i> ${game.i18n.format(res.kind === "attack" ? "LAUNDRY.Help.ChatAttack" : "LAUNDRY.Help.ChatTest", { helper: helper.name, ally: recipient.name, enemy: enemy?.name ?? "?" })}</div>`
  });
  return help;
}

/**
 * Dice the actor's pending Helps add to this Test.
 * @returns {{dice:number, lines:{label:string, value:number}[], ids:string[]}}
 */
export function helpDice(actor, { kind, skill, targetUuid } = {}) {
  const out = { dice: 0, lines: [], ids: [] };
  const helps = actor?.getFlag?.(SYSTEM_ID, "helps") ?? [];
  if (!helps.length || ["luck", "death", "kResist"].includes(kind)) return out;
  for (const h of helps) {
    const isAttack = kind === "attack";
    if (h.kind === "attack" && (!isAttack || (h.targetUuid && targetUuid && h.targetUuid !== targetUuid))) continue;
    const helper = fromUuidSync(h.helperUuid);
    const helpSkill = h.kind === "attack" ? (skill === "ranged" ? "ranged" : "closeCombat") : skill;
    let training = helper?.system?.getSkill?.(helpSkill)?.training ?? 0;
    if (has(helper, "stirringVoice")) training = Math.max(training, helper.system.getSkill("presence")?.training ?? 0);
    const extra = (has(helper, "helpful") || has(helper, "staffSynergy")) ? 1 : 0;
    const dice = 1 + training + extra;
    out.dice += dice;
    out.lines.push({ label: game.i18n.format("LAUNDRY.Help.Line", { name: h.helperName }), value: dice });
    out.ids.push(h.id);
  }
  return out;
}

/** Remove Helps that were used by a Test. */
export async function consumeHelps(actor, ids) {
  if (!ids?.length || !actor) return;
  const left = (actor.getFlag(SYSTEM_ID, "helps") ?? []).filter(h => !ids.includes(h.id));
  await setFlag(actor, "helps", left.length ? left : null);
}

/* ------------------------------------------------------------ */
/*  Studied Defence / Eye in the Sky                              */
/* ------------------------------------------------------------ */

export async function studiedDefence(actor, item) {
  const enemy = [...game.user.targets][0]?.actor;
  if (!enemy) return ui.notifications.warn("LAUNDRY.Help.TargetEnemy", { localize: true });
  const list = new Set(actor.getFlag(SYSTEM_ID, "studied") ?? []);
  list.add(enemy.uuid);
  await setFlag(actor, "studied", [...list]);
  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="laundry-note"><i class="fa-solid fa-eye"></i> ${game.i18n.format("LAUNDRY.Help.Studied", { name: actor.name, enemy: enemy.name, talent: item.name })}</div>`
  });
}

export async function eyeInTheSky(actor, item) {
  const ally = [...game.user.targets][0]?.actor;
  if (!ally) return ui.notifications.warn("LAUNDRY.Help.TargetAlly", { localize: true });
  await setFlag(ally, "eyeInTheSky", { by: actor.uuid, name: actor.name });
  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="laundry-note"><i class="fa-solid fa-satellite-dish"></i> ${game.i18n.format("LAUNDRY.Help.Eye", { name: actor.name, ally: ally.name, talent: item.name })}</div>`
  });
}
