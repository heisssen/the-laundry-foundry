/**
 * The Test pipeline: configure → roll → chat card → post-roll interactions.
 *
 * State lives in the chat message flag `the-laundry.test`, so any client can
 * re-render and continue the workflow (Focus reallocation, Luck rerolls, damage).
 */
import { SYSTEM_ID, SYSTEM_PATH } from "../config.mjs";
import { evaluateTest, applyAdvantage, clampDN, isAutoSuccess } from "../rules/dice.mjs";
import { dnModifierFor } from "../rules/tables.mjs";
import { collectMods, summarise } from "../helpers/talent-mods.mjs";
import { zoneTestMods } from "../data/region-zone.mjs";

export const TEMPLATE = `${SYSTEM_PATH}/templates/chat/test-card.hbs`;

/**
 * Normalised Test configuration.
 * @typedef {object} TestConfig
 * @property {string} actorUuid
 * @property {string} [tokenUuid]
 * @property {string} kind            test | attack | cast | app | death | luck | kResist | presence | opposed
 * @property {string} [label]
 * @property {string} [attribute]     body | mind | spirit | "highest"
 * @property {string} [skill]
 * @property {number} dn              base DN before modifiers
 * @property {number} complexity
 * @property {number} [advantage=0]   +1 advantage, −1 disadvantage, ±2 greater
 * @property {number} [bonusDice=0]
 * @property {number} [penaltyDice=0]
 * @property {boolean} [doubleTraining=false]  Adrenaline (combat only)
 * @property {boolean} [maximise=false]        Luck: every die counts as a 6
 * @property {boolean} [applyConditions=true]  apply condition dice penalties
 * @property {number} [pool]                  fixed pool (Luck/NPC overrides)
 * @property {number} [focus]                 fixed focus
 * @property {false|"spell"|"app"} [magic]
 * @property {object} [attack] [spell] [death] [extra]
 */

/** Compute pool / DN / focus for an actor + config. Pure w.r.t. actor data. */
export function prepareTest(actor, cfg) {
  const sys = actor?.system;
  const attrKey = cfg.attribute === "highest"
    ? ["body", "mind", "spirit"].reduce((a, k) => sys.getAttribute(k) > sys.getAttribute(a) ? k : a, "body")
    : cfg.attribute;
  const attribute = attrKey ? (sys?.getAttribute?.(attrKey) ?? 0) : 0;
  const skill = cfg.skill ? (sys?.getSkill?.(cfg.skill) ?? { training: 0, focus: 0 }) : { training: 0, focus: 0 };
  const training = skill.training ?? 0;
  const mods = sys?.modifiers ?? { pool: 0, dnMods: [] };

  // Talent modifiers (auto + ticked in the dialog)
  const talentMods = collectMods(actor, {
    kind: cfg.kind ?? "test", skill: cfg.skill, attribute: attrKey,
    weaponKind: cfg.weaponKind, charge: cfg.charge, dualWield: cfg.dualWield, unarmed: cfg.unarmed
  }).map(m => ({ ...m, checked: m.auto || (cfg.talentModIds ?? []).includes(m.id) }));
  const tm = summarise(talentMods, cfg.talentMods ?? []);
  const doubled = cfg.doubleTraining || tm.doubleTraining;

  let pool;
  const breakdown = [];
  if (cfg.pool != null) {
    pool = cfg.pool;
    breakdown.push({ label: "LAUNDRY.Test.FixedPool", value: cfg.pool });
  } else {
    pool = attribute + (doubled ? training * 2 : training);
    breakdown.push({ label: `LAUNDRY.Attribute.${attrKey}`, value: attribute });
    if (training) breakdown.push({ label: `LAUNDRY.Skill.${cfg.skill}`, value: doubled ? training * 2 : training, doubled });
  }
  if (tm.bonusDice) { pool += tm.bonusDice; breakdown.push({ label: "LAUNDRY.Test.TalentDice", value: tm.bonusDice }); }
  if (cfg.bonusDice) { pool += cfg.bonusDice; breakdown.push({ label: "LAUNDRY.Test.BonusDice", value: cfg.bonusDice }); }
  if (cfg.penaltyDice) { pool -= cfg.penaltyDice; breakdown.push({ label: "LAUNDRY.Test.PenaltyDice", value: -cfg.penaltyDice }); }
  if (cfg.applyConditions !== false && mods.pool && cfg.kind !== "luck" && cfg.kind !== "death") {
    pool += mods.pool;
    breakdown.push({ label: "LAUNDRY.Test.Conditions", value: mods.pool });
  }
  pool = Math.max(0, pool);

  // Environmental Traits of the Zone the tester stands in
  const zm = cfg.applyZones === false ? { advantage: 0, dn: 0, applied: [] } : zoneTestMods(actor, { attribute: attrKey, skill: cfg.skill, kind: cfg.kind });
  let advantage = (cfg.advantage ?? 0) + tm.advantage + zm.advantage;
  if (sys?.modifiers?.magicDisadvantage && cfg.skill === "magic") advantage -= 1;
  if (sys?.modifiers?.mindDisadvantage && attrKey === "mind") advantage -= 1;
  const dnMod = cfg.kind === "luck" || cfg.kind === "death" ? 0 : dnModifierFor(mods.dnMods, attrKey, cfg.skill);
  const dn = applyAdvantage(clampDN(cfg.dn + dnMod + zm.dn), advantage);

  let focus = cfg.focus != null ? cfg.focus : (skill.focus ?? 0);
  if (cfg.focusMultiplier) focus *= cfg.focusMultiplier;
  if (tm.doubleFocus) focus *= 2;
  const complexity = Math.max(1, (cfg.complexity ?? 1) + tm.complexity);

  return {
    ...cfg,
    attribute: attrKey,
    attributeValue: attribute,
    training,
    pool,
    dn,
    dnBase: cfg.dn,
    dnMod,
    advantage,
    focus,
    complexity,
    breakdown,
    talentMods,
    talentsApplied: tm.applied,
    zonesApplied: [...(cfg.zonesApplied ?? []), ...zm.applied],
    talentSummary: tm,
    auto: isAutoSuccess(pool, dn, complexity)
  };
}

/** Roll the dice (or maximise) and evaluate. */
export async function rollTest(prepared) {
  let roll = null;
  let results;
  if (prepared.maximise) {
    results = Array.from({ length: prepared.pool }, () => 6);
  } else if (prepared.pool > 0) {
    roll = await new Roll(`${prepared.pool}dl`).evaluate();
    results = roll.dice[0].results.map(r => r.result);
  } else {
    results = [];
  }
  const ev = evaluateTest({
    results, dn: prepared.dn, complexity: prepared.complexity ?? 1,
    focus: prepared.focus, magic: prepared.magic ?? false
  });
  return { roll, evaluation: ev };
}

/** Re-evaluate a stored state (after focus change / reroll). */
export function reevaluate(state, { results = state.evaluation.results, bonuses = null, focus = state.focus } = {}) {
  return evaluateTest({
    results, dn: state.dn, complexity: state.complexity ?? 1, focus,
    magic: state.magic ?? false, bonuses
  });
}

/** Full workflow: prepare → roll → message. Returns the ChatMessage. */
export async function performTest(actor, cfg, { rollMode, chat = true } = {}) {
  const prepared = prepareTest(actor, cfg);
  const { roll, evaluation } = await rollTest(prepared);
  const state = {
    v: 1,
    ...prepared,
    actorUuid: actor?.uuid ?? cfg.actorUuid ?? null,
    evaluation,
    history: [],
    applied: {}
  };
  // Allow the specific workflow (attack/cast/death…) to post-process the result.
  await Hooks.callAll("laundryTestRolled", state, actor);
  if (!chat) return state;
  return createTestMessage(state, { roll, actor, rollMode });
}

export async function renderTestCard(state) {
  const { renderCard } = await import("./card.mjs");
  return renderCard(state);
}

export async function createTestMessage(state, { roll, actor, rollMode } = {}) {
  const content = await renderTestCard(state);
  const speaker = ChatMessage.getSpeaker({ actor, token: actor?.token });
  const data = {
    speaker,
    content,
    rolls: roll ? [roll] : [],
    sound: roll ? CONFIG.sounds.dice : null,
    flags: { [SYSTEM_ID]: { test: state } }
  };
  ChatMessage.applyMode(data, rollMode ?? game.settings.get("core", "messageMode"));
  return ChatMessage.create(data);
}

/** Persist a modified state on an existing message. */
export async function updateTestMessage(message, state, { extraRoll = null } = {}) {
  const content = await renderTestCard(state);
  const update = { content, [`flags.${SYSTEM_ID}.test`]: state };
  if (extraRoll) {
    update.rolls = [...message.rolls.map(r => r.toJSON()), extraRoll.toJSON()];
    if (game.dice3d) game.dice3d.showForRoll(extraRoll, game.user, true);
  }
  if (message.isOwner) return message.update(update);
  const { asGM } = await import("../helpers/socket.mjs");
  return asGM("updateMessage", { id: message.id, update });
}
