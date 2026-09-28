/**
 * Spellcasting (OH p.134-157).
 */

export const CASTING_METHODS = Object.freeze(["computational", "traditional", "mental", "app"]);

/** Computational equipment casting-time multipliers. OH p.141 */
export const TECH_MULTIPLIER = Object.freeze({
  calculator: 2,
  smartphone: 1,
  laptop: 0.75,
  supercomputer: 0.5
});

/** Generic spell modifications. OH p.142 */
export const SPELL_MODIFICATIONS = Object.freeze({
  doubleDuration: { complexity: 1, repeatable: true },
  extraTarget: { complexity: 1, repeatable: true },
  increaseRange: { complexity: 1, repeatable: true },
  halveCastingTime: { complexity: 2, repeatable: true },
  affectZone: { complexity: 3, repeatable: true }
});

/**
 * Complexity of a cast.
 * @param {object} p
 * @param {number} p.level                 Spell Level (base Complexity = L)
 * @param {number|string} [p.baseComplexity="L"]
 * @param {object} [p.modifications]       { key: count } generic modifications
 * @param {number} [p.extraComplexity=0]   spell-specific modifications
 * @param {string} [p.method="computational"]
 * @param {boolean} [p.fastCast=false]     "Just a minute": Extended Test with ×3 Complexity
 * @param {boolean} [p.bugged=false]       Computational complication "Bugged"
 */
export function castComplexity({ level, baseComplexity = "L", modifications = {}, extraComplexity = 0,
  method = "computational", fastCast = false, bugged = false, mentalArithmetic = false }) {
  let c = baseComplexity === "L" || baseComplexity == null ? level : Number(baseComplexity);
  for (const [key, count] of Object.entries(modifications)) {
    const mod = SPELL_MODIFICATIONS[key];
    if (mod && count > 0) c += mod.complexity * count;
  }
  c += extraComplexity;
  if (method === "mental" && !mentalArithmetic) c += 2;
  if (bugged) c += 1;
  if (fastCast) c *= 3;
  return Math.max(1, c);
}

/**
 * Casting time in minutes.
 * @param {number} minutes      base Casting Time in minutes
 */
export function castingTime({ minutes, method = "computational", tech = "smartphone", halvings = 0 }) {
  let t = minutes;
  if (method === "traditional") t *= 2;
  if (method === "computational") t *= TECH_MULTIPLIER[tech] ?? 1;
  t /= 2 ** halvings;
  if (method === "computational" && tech === "supercomputer") t = Math.max(1, t);
  return t;
}

/** Mental magic always mishaps. OH p.141 */
export function forcedMishap(method) {
  return method === "mental";
}

/** Complexity of the Mind (Zeal) test to resist K-Syndrome. OH p.139 */
export function kSyndromeResistComplexity(mishapsSinceFirst) {
  return 1 + Math.max(0, mishapsSinceFirst);
}

/** Permanent effects by number of failed K-Syndrome tests. OH p.139 */
export const K_SYNDROME_STAGES = Object.freeze([
  null,
  { key: "magicDisadvantage" },            // 1: Disadvantage on Magic Tests
  { key: "mindDisadvantage" },             // 2: Disadvantage on all Mind Tests
  { key: "mindLoss", mind: -1 },           // 3: Mind −1 (min 1)
  { key: "mindLoss2", mind: -2 },          // 4: Mind −1 again (min 1)
  { key: "weakened", mind: -2 },           // 5: permanent Weakened
  { key: "hospitalised", mind: -2 }        // 6: hospitalised permanently
]);

export function kSyndromeStage(fails) {
  return K_SYNDROME_STAGES[Math.max(0, Math.min(6, fails))];
}

/** Psychological Injury severity from a mishap, by spell Level. OH p.140 */
export function mishapInjurySeverity(level) {
  if (level >= 4) return "deadly";
  if (level >= 2) return "serious";
  return "minor";
}

/** Source of Power adds Occult Training dice. OH p.142 */
export function empoweredDice(occultTraining) {
  return Math.max(0, occultTraining);
}
