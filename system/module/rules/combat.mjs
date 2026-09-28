/**
 * Attack resolution helpers (OH p.100-112, p.123-124).
 */
import { attackDN, clampStep } from "./ladder.mjs";

export const RANGES = Object.freeze(["close", "short", "medium", "long", "extreme"]);
const rangeIndex = r => Math.max(0, RANGES.indexOf(r));

export const WEAPON_TRAITS = Object.freeze([
  "blast", "brutal", "cleave", "close", "crushing", "defensive", "ineffective", "loud",
  "penetrating", "piercing", "range", "reach", "reload", "rend", "restraining", "slashing",
  "spread", "stunning", "subtle", "thrown", "twoHanded"
]);

/**
 * Compute the attack DN with all step modifiers applied.
 *
 * @param {object} p
 * @param {"melee"|"ranged"} p.kind
 * @param {number} p.attackStep          Melee or Accuracy step (already includes conditions)
 * @param {number} p.defenceStep         target Defence step (already includes conditions)
 * @param {string} [p.range]             distance to target: close/short/medium/long/extreme
 * @param {string} [p.weaponRange]       weapon's range: short/medium/long
 * @param {string[]} [p.traits]
 * @param {boolean} [p.thrownImprovised] throwing a weapon without Thrown trait
 * @param {"partial"|"total"|null} [p.cover]
 * @param {"head"|"arms"|"legs"|null} [p.calledShot]
 * @param {boolean} [p.hidden]           attacker unseen → target Defence Poor
 * @param {boolean} [p.targetProne]
 * @param {boolean} [p.targetIncapacitated]
 * @param {boolean} [p.pointBlank]       Point Blank Range talent
 * @param {number} [p.attackMod=0]       extra step shifts (talents, situational)
 * @param {number} [p.defenceMod=0]
 */
export function attackDifficulty(p) {
  const traits = new Set(p.traits ?? []);
  const notes = [];
  let att = p.attackStep;
  let def = p.defenceStep;

  if (p.targetIncapacitated) return { dn: 2, attackStep: att, defenceStep: def, notes: ["incapacitated"] };

  if (p.hidden) { def = 0; notes.push("hidden"); }

  if (p.kind === "ranged") {
    const dist = rangeIndex(p.range ?? "short");
    if (p.thrownImprovised) {
      // Accuracy −1 short, −2 medium, −3 long. OH p.110
      const pen = Math.max(1, dist);
      att -= pen; notes.push(`thrownImprovised:-${pen}`);
    } else if (p.weaponRange) {
      const beyond = dist - rangeIndex(p.weaponRange);
      if (beyond > 0) { att -= Math.min(2, beyond); notes.push(`range:-${Math.min(2, beyond)}`); }
    }
    if (dist === 0 && !traits.has("close") && !p.pointBlank) { att -= 1; notes.push("closeQuarters:-1"); }
    if (p.cover === "partial") { def += 1; notes.push("cover:+1"); }
    if (p.cover === "total") { def += 2; notes.push("cover:+2"); }
  }

  if (p.targetProne) {
    const dist = p.kind === "melee" ? 0 : rangeIndex(p.range ?? "short");
    if (dist === 0) { att += 1; notes.push("prone:+1"); }
    else { att -= dist; notes.push(`prone:-${dist}`); }
  }

  if (p.calledShot === "head") { def += 2; notes.push("calledHead:+2"); }
  else if (p.calledShot === "arms" || p.calledShot === "legs") { def += 1; notes.push(`called:+1`); }

  att += p.attackMod ?? 0;
  def += p.defenceMod ?? 0;
  att = clampStep(att); def = clampStep(def);
  return { dn: attackDN(att, def), attackStep: att, defenceStep: def, notes };
}

/**
 * Damage dealt by a successful attack and trait side effects.
 * @param {object} p
 * @param {number} p.successes
 * @param {number[]} p.values        final die values
 * @param {number} p.baseDamage      the "X" in X + S
 * @param {boolean} [p.addSuccesses=true]
 * @param {string[]} [p.traits]
 * @param {number} [p.bonusDamage=0]
 */
export function attackDamage({ successes, values = [], baseDamage = 0, addSuccesses = true, traits = [], bonusDamage = 0, multiplier = 1 }) {
  const t = new Set(traits);
  const sixes = values.filter(v => v >= 6).length;
  if (successes <= 0) return { hit: false, damage: 0, sixes, effects: {} };
  const damage = (baseDamage + (addSuccesses ? successes : 0) + bonusDamage) * multiplier;
  return {
    hit: true,
    damage,
    sixes,
    effects: {
      armourPenetration: t.has("penetrating") ? 1 : 0,
      brutal: t.has("brutal"),
      ineffective: t.has("ineffective"),
      cleave: t.has("cleave") ? sixes : 0,        // 1 Damage per 6 to all enemies in Close Range
      rend: t.has("rend") ? sixes : 0,            // armour points destroyed after the attack
      stunned: t.has("stunning") && sixes > 0,
      restrained: t.has("restraining"),
      spreadDamage: t.has("spread") ? Math.floor(damage / 2) : 0
    }
  };
}

/** Charge: +1d6 attack, Defence −1 step until next turn. OH p.106 */
export const CHARGE = Object.freeze({ bonusDice: 1, defenceStep: -1 });
/** Dodge: Defence +1 step, +1d6 to Reflexes tests. */
export const DODGE = Object.freeze({ defenceStep: 1, reflexesDice: 1 });
/** Help: +1d6 +1d6 per Training level of the helper. OH p.107 */
export function helpDice(helperTraining) { return 1 + Math.max(0, helperTraining); }

/**
 * Initiative order (OH p.100). Ties: PCs before NPCs; otherwise the given tiebreak order.
 */
export function sortInitiative(combatants) {
  return [...combatants].sort((a, b) => {
    if (b.initiative !== a.initiative) return b.initiative - a.initiative;
    if (!!a.isPC !== !!b.isPC) return a.isPC ? -1 : 1;
    return (a.tiebreak ?? 0) - (b.tiebreak ?? 0);
  });
}
