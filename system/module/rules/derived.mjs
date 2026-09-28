/**
 * Derived character statistics (OH p.32-34).
 */
import { totalToStep, clampStep } from "./ladder.mjs";

export const ATTRIBUTES = Object.freeze(["body", "mind", "spirit"]);

/** Full skill list (OH p.62-65). */
export const SKILLS = Object.freeze([
  "academics", "athletics", "awareness", "bureaucracy", "closeCombat", "computers",
  "dexterity", "engineering", "fastTalk", "fortitude", "intuition", "magic",
  "medicine", "might", "occult", "presence", "ranged", "reflexes", "resolve",
  "science", "stealth", "survival", "technology", "zeal"
]);

/** Attribute usually paired with a skill — only a default, skills are free to mix. OH p.92 */
export const SKILL_DEFAULT_ATTRIBUTE = Object.freeze({
  academics: "mind", athletics: "body", awareness: "mind", bureaucracy: "mind",
  closeCombat: "body", computers: "mind", dexterity: "body", engineering: "mind",
  fastTalk: "mind", fortitude: "body", intuition: "mind", magic: "mind",
  medicine: "mind", might: "body", occult: "mind", presence: "spirit",
  ranged: "body", reflexes: "body", resolve: "spirit", science: "mind",
  stealth: "body", survival: "mind", technology: "mind", zeal: "spirit"
});

const tr = (skills, key) => Number(skills?.[key]?.training ?? 0);

/**
 * @param {object} a
 * @param {{body:number, mind:number, spirit:number}} a.attributes
 * @param {object} a.skills   { key: {training, focus} }
 * @param {object} [a.bonuses] flat modifiers from talents/effects
 * @param {boolean} [a.initiativeUsesBody] Conditioned to Fight talent
 */
export function computeDerived({ attributes, skills, bonuses = {}, initiativeUsesBody = false }) {
  const { body = 1, mind = 1, spirit = 1 } = attributes;
  const b = (k) => Number(bonuses?.[k] ?? 0);

  const meleeTotal = body + tr(skills, "closeCombat");
  const accuracyTotal = mind + tr(skills, "ranged");
  const defenceTotal = body + tr(skills, "reflexes");

  return {
    meleeTotal, accuracyTotal, defenceTotal,
    melee: clampStep(totalToStep(meleeTotal) + b("meleeStep")),
    accuracy: clampStep(totalToStep(accuracyTotal) + b("accuracyStep")),
    defence: clampStep(totalToStep(defenceTotal) + b("defenceStep")),
    toughness: body + mind + spirit + b("toughness"),
    injuries: Math.ceil((body + mind + spirit) / 2) + b("injuries"),
    adrenaline: Math.ceil(spirit / 2) + b("adrenaline"),
    initiative: (initiativeUsesBody ? Math.max(body, mind) : mind)
      + tr(skills, "awareness") + tr(skills, "reflexes") + b("initiative"),
    naturalAwareness: Math.ceil((mind + tr(skills, "awareness")) / 2) + b("naturalAwareness"),
    armour: b("armour")
  };
}

/** Dice pool for a Test: Attribute + Training (optionally doubled by Adrenaline). */
export function dicePool({ attribute = 0, training = 0, doubleTraining = false, bonusDice = 0, penalty = 0 }) {
  return Math.max(0, attribute + (doubleTraining ? training * 2 : training) + bonusDice - penalty);
}
