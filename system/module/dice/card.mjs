/**
 * Chat card rendering for Tests.
 */
import { SYSTEM_ID } from "../config.mjs";
import { TEMPLATE } from "./test.mjs";
import { LaundryDie } from "./laundry-die.mjs";
import { attackDamage } from "../rules/combat.mjs";
import { clampDN } from "../rules/dice.mjs";

const OUTCOME_ICONS = {
  fail: "fa-solid fa-xmark",
  pass: "fa-solid fa-check",
  minor: "fa-solid fa-check-double",
  major: "fa-solid fa-star"
};

export function buildCardContext(state) {
  const ev = state.evaluation;
  const dice = ev.results.map((raw, i) => {
    const bonus = ev.bonuses?.[i] ?? 0;
    const value = ev.values[i];
    const success = value >= ev.dn;
    return {
      index: i, raw, bonus, value, success,
      img: LaundryDie.faceImage(Math.min(6, value)),
      rawImg: LaundryDie.faceImage(raw),
      css: [
        success ? "success" : "failure",
        value === 1 ? "one" : "",
        value >= 6 ? "six" : "",
        bonus ? "focused" : "",
        state.maximise ? "maximised" : ""
      ].filterJoin(" ")
    };
  });

  const ctx = {
    state,
    dice,
    dnLabel: `${ev.dn}:${ev.complexity}`,
    outcomeLabel: `LAUNDRY.Outcome.${ev.outcome}`,
    outcomeIcon: OUTCOME_ICONS[ev.outcome],
    outcome: ev.outcome,
    successes: ev.successes,
    focusRemaining: ev.focusRemaining,
    focusTotal: ev.focus,
    hasFocus: ev.focus > 0,
    skillLabel: state.skill ? `LAUNDRY.Skill.${state.skill}` : null,
    attributeLabel: state.attribute ? `LAUNDRY.Attribute.${state.attribute}` : null,
    advantageLabel: state.advantage > 0 ? (state.advantage > 1 ? "LAUNDRY.Test.GreaterAdvantage" : "LAUNDRY.Test.Advantage")
      : state.advantage < 0 ? (state.advantage < -1 ? "LAUNDRY.Test.GreaterDisadvantage" : "LAUNDRY.Test.Disadvantage") : null,
    history: state.history ?? [],
    mishap: ev.mishap,
    magic: state.magic
  };
  // Plain skill rolls are labelled "Mind (Academics)": don't repeat it as the subtitle.
  const L = k => game.i18n.localize(k);
  const testName = ctx.attributeLabel ? `${L(ctx.attributeLabel)}${ctx.skillLabel ? ` (${L(ctx.skillLabel)})` : ""}` : "";
  ctx.title = state.label || testName;
  ctx.showTestName = !!testName && ctx.title.trim() !== testName;
  // Degrees of success (OH p.91): extra successes above the Complexity.
  const extra = Math.max(0, ev.successes - ev.complexity);
  ctx.extraLabel = ev.outcome === "fail" ? "" : `+${extra}`;
  ctx.outcomeHint = game.i18n.localize("LAUNDRY.Test.DegreesHint");

  if (state.kind === "attack" && state.attack) {
    const a = state.attack;
    const shift = state.dn - state.dnBase;
    const ladder = CONFIG.LAUNDRY.ladderKeys;
    const targets = (a.targets ?? []).map((t, i) => {
      const tdn = i === 0 ? state.dn : clampDN(t.dn + shift);
      const successes = ev.values.filter(v => v >= tdn).length;
      const dmg = attackDamage({
        successes, values: ev.values, baseDamage: a.baseDamage,
        addSuccesses: a.addSuccesses, traits: a.traits, bonusDamage: a.bonusDamage ?? 0, multiplier: a.multiplier ?? 1
      });
      return {
        ...t, index: i, dnFinal: tdn, successes, damage: dmg, hit: dmg.hit,
        applied: state.applied?.[t.uuid ?? `idx${i}`] ?? null,
        stepsLabel: `${game.i18n.localize(`LAUNDRY.Ladder.${ladder[t.attackStep] ?? "average"}`)} → ${game.i18n.localize(`LAUNDRY.Ladder.${ladder[t.defenceStep] ?? "average"}`)}`
      };
    });
    ctx.attack = {
      ...a,
      targets,
      primary: targets[0],
      traitsLabel: (a.traits ?? []).map(t => game.i18n.localize(`LAUNDRY.Trait.${t}`)).join(", ")
    };
  }
  if (state.kind === "cast" && state.spell) ctx.spell = state.spell;
  if (state.kind === "app" && state.app) ctx.app = state.app;
  if (state.kind === "requisition" && state.requisition) ctx.requisition = state.requisition;
  if (state.kind === "death" && state.death) ctx.death = state.death;
  if (state.kind === "kResist" && state.kResist) ctx.kResist = state.kResist;
  if (state.kind === "presence" && state.presence) ctx.presence = state.presence;
  if (state.kind === "opposed" && state.opposed) ctx.opposed = state.opposed;
  if (state.extended) ctx.extended = state.extended;
  // Backup Plan: failed Test with a 1 -> reroll with Complexity +1 (once per rest). OH p.67
  const actor = state.actorUuid ? fromUuidSync(state.actorUuid) : null;
  ctx.canBackupPlan = ev.outcome === "fail" && ev.results.includes(1) && !state.backupPlanUsed
    && !!actor?.items?.some(i => i.system.identifier === "backupPlan") && !actor.system?.mission?.backupPlanUsed;
  return ctx;
}

export async function renderCard(state) {
  const ctx = buildCardContext(state);
  return foundry.applications.handlebars.renderTemplate(TEMPLATE, ctx);
}

export function getTestState(message) {
  return foundry.utils.deepClone(message?.getFlag(SYSTEM_ID, "test") ?? null);
}
