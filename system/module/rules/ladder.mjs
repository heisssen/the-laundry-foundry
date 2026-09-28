/**
 * The Ladder (OH p.33, p.109).
 * Combat ratings (Melee, Accuracy, Defence) are expressed as "steps" 0..6.
 */

export const LADDER = Object.freeze([
  "poor", "average", "good", "great", "superb", "extraordinary", "unprecedented"
]);

export const MIN_STEP = 0;
export const MAX_STEP = LADDER.length - 1;

/** Convert an Attribute + Training total into a Ladder step. */
export function totalToStep(total) {
  if (total >= 12) return 6;
  if (total >= 10) return 5;
  if (total >= 8) return 4;
  if (total >= 6) return 3;
  if (total >= 4) return 2;
  if (total >= 2) return 1;
  return 0;
}

export function clampStep(step) {
  return Math.max(MIN_STEP, Math.min(MAX_STEP, Math.round(step)));
}

export function stepKey(step) {
  return LADDER[clampStep(step)];
}

export function keyToStep(key) {
  const i = LADDER.indexOf(String(key).toLowerCase());
  return i < 0 ? 1 : i;
}

/**
 * DN of an attack from the difference between attacker (Melee/Accuracy)
 * and defender (Defence) steps. OH p.109.
 */
export function attackDN(attackStep, defenceStep) {
  const diff = clampStep(attackStep) - clampStep(defenceStep);
  if (diff >= 2) return 2;
  if (diff === 1) return 3;
  if (diff === 0) return 4;
  if (diff === -1) return 5;
  return 6;
}
