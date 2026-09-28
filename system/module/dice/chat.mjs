/**
 * Chat card interactions: Focus allocation, Double Focus, Luck rerolls,
 * damage application, magic follow-ups.
 */
import { SYSTEM_ID } from "../config.mjs";
import { reevaluate, updateTestMessage } from "./test.mjs";
import { getTestState } from "./card.mjs";
import { Luck } from "../helpers/luck.mjs";
import { asGM, registerGMHandler } from "../helpers/socket.mjs";
import { attackDamage } from "../rules/combat.mjs";
import { clampDN } from "../rules/dice.mjs";
import { hasTalent } from "../helpers/talent-mods.mjs";

registerGMHandler("updateMessage", async ({ id, update }) => {
  const m = game.messages.get(id);
  return m ? !!(await m.update(update)) : false;
});

registerGMHandler("applyDamage", async ({ actorUuid, hit }) => {
  const actor = await fromUuid(actorUuid);
  return actor ? actor.applyDamage(hit) : null;
});

registerGMHandler("addCondition", async ({ actorUuid, id, turns }) => {
  const actor = await fromUuid(actorUuid);
  return actor ? actor.addCondition(id, { turns }) : null;
});

/** Can the current user drive the workflow of this card? */
function canControl(message, state) {
  if (game.user.isGM) return true;
  if (message.isAuthor) return true;
  const actor = state?.actorUuid ? fromUuidSync(state.actorUuid) : null;
  return !!actor?.isOwner;
}

export function onRenderChatMessage(message, html) {
  const state = message.getFlag(SYSTEM_ID, "test");
  const table = message.getFlag(SYSTEM_ID, "table") ?? message.getFlag(SYSTEM_ID, "pursuit");
  if (!state && !table) return;
  const card = html.querySelector(".laundry-card") ?? html;
  const control = canControl(message, state);
  if (!control) card.querySelectorAll("[data-owner-only]").forEach(el => el.remove());
  if (!game.user.isGM) card.querySelectorAll("[data-gm-only]").forEach(el => el.remove());

  card.addEventListener("click", ev => onCardClick(ev, message));
  card.addEventListener("contextmenu", ev => {
    const die = ev.target.closest(".die[data-index]");
    if (!die || !control) return;
    ev.preventDefault();
    adjustFocus(message, Number(die.dataset.index), -1);
  });
}

async function onCardClick(ev, message) {
  const el = ev.target.closest("[data-action], .die[data-index]");
  if (!el) return;
  const state = getTestState(message);
  const card = el.closest(".laundry-card");

  // Dice clicks: selection mode (luck reroll) or Focus allocation.
  if (el.matches(".die[data-index]")) {
    if (!canControl(message, state)) return;
    const idx = Number(el.dataset.index);
    if (card?.classList.contains("selecting")) {
      el.classList.toggle("selected");
      return;
    }
    return adjustFocus(message, idx, +1);
  }

  ev.preventDefault();
  const action = el.dataset.action;
  switch (action) {
    case "focus-auto": return resetFocus(message);
    case "focus-clear": return clearFocus(message);
    case "double-focus": return doubleFocus(message);
    case "backup-plan": return backupPlan(message);
    case "luck-select": return card.classList.toggle("selecting");
    case "luck-reroll": return luckReroll(message, [...card.querySelectorAll(".die.selected")].map(d => Number(d.dataset.index)));
    case "luck-reroll-failures": return luckReroll(message, state.evaluation.values.map((v, i) => v < state.evaluation.dn ? i : -1).filter(i => i >= 0));
    case "apply-damage": return applyDamage(message, Number(el.dataset.index), el.dataset.mode ?? "full");
    case "apply-spell-damage": return applySpellDamage(message, Number(el.dataset.index));
    case "requisition-issue": return (await import("../workflows/requisition.mjs")).issueRequisition(message);
    case "apply-condition": return applyTargetCondition(message, Number(el.dataset.index), el.dataset.condition);
    case "select-target": {
      const t = state[el.dataset.source ?? "attack"]?.targets?.[Number(el.dataset.index)];
      const token = t?.tokenUuid ? fromUuidSync(t.tokenUuid)?.object : null;
      token?.control({ releaseOthers: true });
      return token && canvas.animatePan(token.center);
    }
    case "mishap": {
      const { handleMishap } = await import("../workflows/magic.mjs");
      return handleMishap(message, { useComplication: false });
    }
    case "complication": {
      const { handleMishap } = await import("../workflows/magic.mjs");
      return handleMishap(message, { useComplication: true });
    }
    case "fast-cast-continue": {
      const { continueFastCast } = await import("../workflows/magic.mjs");
      return continueFastCast(message);
    }
    case "reroll-mishap":
    case "reroll-complication": {
      const { rerollTable } = await import("../workflows/magic.mjs");
      return rerollTable(message);
    }
    case "opposed-respond": {
      const { respondOpposed } = await import("../workflows/gm-tools.mjs");
      return respondOpposed(message);
    }
    case "request-roll": {
      const { answerRequest } = await import("../workflows/gm-tools.mjs");
      return answerRequest(message, el.dataset);
    }
    case "group-contribute": {
      const { contributeGroup } = await import("../workflows/gm-tools.mjs");
      return contributeGroup(message);
    }
    case "death-test":
    case "last-stand":
    case "cheat-death": {
      const t = message.getFlag(SYSTEM_ID, "table");
      const actor = t?.actorUuid ? await fromUuid(t.actorUuid) : null;
      if (!actor?.isOwner) return;
      if (action === "death-test") return actor.rollDeathTest();
      if (action === "last-stand") return actor.lastStand();
      return actor.cheatDeath();
    }
    case "pursuit-update": {
      const { updatePursuit } = await import("../workflows/gm-tools.mjs");
      const q = Number(card.querySelector("[name=quarry]")?.value || 0);
      const p = Number(card.querySelector("[name=pursuer]")?.value || 0);
      return updatePursuit(message, q, p);
    }
    case "presence-resist": {
      const { resistPresence } = await import("../workflows/combat.mjs");
      return resistPresence(message, el.dataset);
    }
  }
}

/* ---------------------------------------------------------------- */

async function adjustFocus(message, idx, delta) {
  const state = getTestState(message);
  if (!state || state.maximise) return;
  const ev = state.evaluation;
  const bonuses = [...(ev.bonuses ?? ev.results.map(() => 0))];
  const spent = bonuses.reduce((a, b) => a + b, 0);
  if (delta > 0 && spent >= ev.focus) return ui.notifications.info("LAUNDRY.Notify.NoFocusLeft", { localize: true });
  if (delta > 0 && ev.results[idx] + bonuses[idx] >= 6) return;
  if (delta < 0 && bonuses[idx] <= 0) return;
  bonuses[idx] += delta;
  state.evaluation = reevaluate(state, { bonuses, focus: ev.focus });
  state.manualFocus = true;
  await afterChange(message, state);
}

async function resetFocus(message) {
  const state = getTestState(message);
  state.evaluation = reevaluate(state, { focus: state.evaluation.focus });
  state.manualFocus = false;
  await afterChange(message, state);
}

async function clearFocus(message) {
  const state = getTestState(message);
  state.evaluation = reevaluate(state, { bonuses: state.evaluation.results.map(() => 0), focus: state.evaluation.focus });
  state.manualFocus = true;
  await afterChange(message, state);
}

/** Adrenaline: double Focus after the roll (combat only). OH p.96 */
async function doubleFocus(message) {
  const state = getTestState(message);
  const actor = await fromUuid(state.actorUuid);
  if (!actor || state.doubleFocusUsed || !state.evaluation.focus) return;
  if (!(await actor.spendAdrenaline(1))) return;
  state.doubleFocusUsed = true;
  state.focus = state.evaluation.focus * 2;
  state.evaluation = reevaluate(state, { focus: state.focus });
  state.history.push({ type: "doubleFocus" });
  await afterChange(message, state);
}

/** Luck: reroll any dice after the Test. OH p.96 */
async function luckReroll(message, indices) {
  const state = getTestState(message);
  if (!indices.length) return ui.notifications.info("LAUNDRY.Notify.SelectDice", { localize: true });
  if (state.kind === "luck") return ui.notifications.warn("LAUNDRY.Notify.NoLuckOnLuckTest", { localize: true });
  if (!(await Luck.spend(1, { reason: "LAUNDRY.LuckThreat.SpentReroll" }))) return;
  const roll = await new Roll(`${indices.length}dl`).evaluate();
  const fresh = roll.dice[0].results.map(r => r.result);
  const results = [...state.evaluation.results];
  indices.forEach((idx, i) => { results[idx] = fresh[i]; });
  state.history.push({ type: "reroll", indices, before: indices.map(i => state.evaluation.results[i]), after: fresh });
  state.evaluation = reevaluate(state, { results, focus: state.evaluation.focus });
  state.manualFocus = false;
  state.rollId = foundry.utils.randomID();
  await afterChange(message, state, roll);
}

/** Backup Plan talent: reroll the whole Test with Complexity +1. OH p.67 */
async function backupPlan(message) {
  const state = getTestState(message);
  const actor = await fromUuid(state.actorUuid);
  if (!actor || state.backupPlanUsed) return;
  const roll = await new Roll(`${state.evaluation.results.length}dl`).evaluate();
  const results = roll.dice[0].results.map(r => r.result);
  state.history.push({ type: "reroll", indices: results.map((_, i) => i), before: state.evaluation.results, after: results });
  state.complexity = (state.complexity ?? 1) + 1;
  state.backupPlanUsed = true;
  state.evaluation = reevaluate(state, { results, focus: state.evaluation.focus });
  state.talentsApplied = [...(state.talentsApplied ?? []), "Backup Plan"];
  if (actor.type === "character") await actor.update({ "system.mission.backupPlanUsed": true });
  await afterChange(message, state, roll);
}

/** Workflow-specific follow-ups after the dice change. */
async function afterChange(message, state, extraRoll = null) {
  // Keep Death / K-Syndrome resolutions in sync: resolved results are recalculated on reroll.
  if (state.kind === "death" && state.death) state.death.resolved = false;
  if (state.kind === "kResist" && state.kResist) state.kResist.resolved = false;
  await updateTestMessage(message, state, { extraRoll });
  const fresh = game.messages.get(message.id);
  const actor = state.actorUuid ? await fromUuid(state.actorUuid) : null;
  if (!actor) return;
  if (state.kind === "cast") {
    const { finaliseCast } = await import("../workflows/magic.mjs");
    await finaliseCast(fresh);
  }
  if (state.kind === "death" && extraRoll) {
    const { resolveDeathMessage } = await import("../workflows/death.mjs");
    await resolveDeathMessage(actor, fresh, getTestState(fresh));
  }
  if (state.kind === "kResist" && extraRoll) {
    const { resolveKResist } = await import("../workflows/magic.mjs");
    await resolveKResist(actor, fresh, getTestState(fresh));
  }
}

/* ---------------------------------------------------------------- */

/** Damage from a successful spell or app (e.g. Banishment) to a snapshotted target. */
async function applySpellDamage(message, index) {
  const state = getTestState(message);
  const key = state.spell ? "spell" : "app";
  const src = state[key];
  const t = src?.targets?.[index];
  if (!t?.uuid || t.applied || !state.evaluation.passed) return;
  const target = await fromUuid(t.uuid);
  if (!target) return ui.notifications.warn("LAUNDRY.Notify.NoTarget", { localize: true });
  const hit = { damage: src.damage, type: src.damageType ?? "physical", ignoreArmour: !!src.ignoreArmour, armourPenetration: 0, cause: src.name };
  const res = target.isOwner ? await target.applyDamage(hit) : await asGM("applyDamage", { actorUuid: t.uuid, hit });
  const next = foundry.utils.deepClone(state);
  next[key].targets[index].applied = { damage: res?.damage ?? src.damage };
  await updateTestMessage(message, next);
}

async function applyDamage(message, index, mode) {
  const state = getTestState(message);
  const a = state.attack;
  const t = a?.targets?.[index];
  if (!t?.uuid) return ui.notifications.warn("LAUNDRY.Notify.NoTarget", { localize: true });
  const ev = state.evaluation;
  const tdn = index === 0 ? state.dn : clampDN(t.dn + (state.dn - state.dnBase));
  const successes = ev.values.filter(v => v >= tdn).length;
  const dmg = attackDamage({ successes, values: ev.values, baseDamage: a.baseDamage, addSuccesses: a.addSuccesses, traits: a.traits, bonusDamage: a.bonusDamage ?? 0, multiplier: a.multiplier ?? 1 });
  if (!dmg.hit && mode !== "spread") return;
  let damage = mode === "half" || mode === "spread" ? dmg.effects.spreadDamage || Math.floor(dmg.damage / 2) : dmg.damage;
  if (mode === "cleave") damage = dmg.effects.cleave;
  const attacker = await fromUuid(state.actorUuid);
  // Backstab: double Damage and ignore Armour vs unaware target with a Subtle weapon. OH p.66
  const backstab = mode === "backstab";
  if (backstab) damage *= 2;
  // Applied Anatomy: +1 per 6 up to Medicine Training/Focus. OH p.66
  if (attacker?.items.some(i => i.system.identifier === "appliedAnatomy") && mode === "full") {
    const med = attacker.system.getSkill("medicine");
    damage += Math.min(dmg.sixes, Math.max(med.training, med.focus));
  }
  // Pierce Defences: each 6 with a Piercing weapon ignores 1 Armour. OH p.78
  const pierce = hasTalent(attacker, "pierceDefences") && a.traits.includes("piercing") ? dmg.sixes : 0;
  const hit = {
    damage,
    type: a.damageType ?? "physical",
    armourPenetration: dmg.effects.armourPenetration + pierce,
    brutal: dmg.effects.brutal,
    ineffective: dmg.effects.ineffective,
    ignoreArmour: backstab || !!attacker?.statuses?.has("lastStand"),
    rend: mode === "full" ? dmg.effects.rend : 0,
    cause: a.weaponName
  };
  const target = await fromUuid(t.uuid);
  if (!target) return;
  if (target.isOwner) await target.applyDamage(hit);
  else await asGM("applyDamage", { actorUuid: t.uuid, hit });

  // Trait side effects
  if (mode === "full") {
    const conds = [];
    if (dmg.effects.stunned) conds.push(["stunned", 1]);
    if (dmg.effects.restrained && damage > 0) conds.push(["restrained", 0]);
    if (a.calledShot === "head") conds.push(["stunned", 1]);
    if (a.calledShot === "legs") conds.push(["prone", 0]);
    const small = !["enormous", "monstrous"].includes(target.system?.size);
    // Crushing Blow: a 6 with a Crushing weapon stuns a Large or smaller target. OH p.69
    if (dmg.sixes && a.traits.includes("crushing") && small && hasTalent(attacker, "crushingBlow")) conds.push(["stunned", 1]);
    // Sever: a 6 with a Slashing weapon knocks the target Prone. OH p.81
    if (dmg.sixes && a.traits.includes("slashing") && hasTalent(attacker, "sever")) {
      conds.push(["prone", 0]);
      await ChatMessage.create({ content: `<div class="laundry-note">${game.i18n.format("LAUNDRY.Talent.SeverNote", { name: target.name })}</div>` });
    }
    // Pressing Attack: a 6 on a melee attack allows a free Shove. OH p.78
    if (dmg.sixes && hasTalent(attacker, "pressingAttack") && !a.traits.includes("range")) {
      await ChatMessage.create({ content: `<div class="laundry-note">${game.i18n.format("LAUNDRY.Talent.PressingAttackNote", { name: attacker.name })}</div>` });
    }
    for (const [id, turns] of conds) {
      if (target.isOwner) await target.addCondition(id, { turns });
      else await asGM("addCondition", { actorUuid: t.uuid, id, turns });
    }
  }
  const key = t.uuid ?? `idx${index}`;
  state.applied = { ...(state.applied ?? {}), [key]: { mode, damage } };
  await updateTestMessage(message, state);
}

async function applyTargetCondition(message, index, id) {
  const state = getTestState(message);
  const t = state.attack?.targets?.[index];
  const target = t?.uuid ? await fromUuid(t.uuid) : null;
  if (!target) return;
  if (target.isOwner) await target.addCondition(id, { turns: 1 });
  else await asGM("addCondition", { actorUuid: t.uuid, id, turns: 1 });
}
