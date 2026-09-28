/**
 * Advancement costs (OH p.34, p.40).
 */

/** Cost to raise an Attribute from `from` to `from+1`. */
export function attributeStepCost(from) {
  return { 1: 3, 2: 5, 3: 10 }[from] ?? Infinity;
}

/** Incremental cost for Training/Focus level `to` (1..4). */
export function skillStepCost(to) {
  return to >= 1 && to <= 4 ? to : Infinity;
}

export const TALENT_COST = 4;

/** Total cost between two values of an attribute. */
export function attributeCost(from, to) {
  let cost = 0;
  for (let v = from; v < to; v++) cost += attributeStepCost(v);
  for (let v = from; v > to; v--) cost -= attributeStepCost(v - 1);
  return cost;
}

/** Total cost between two levels of Training or Focus. */
export function skillCost(from, to) {
  let cost = 0;
  for (let v = from + 1; v <= to; v++) cost += skillStepCost(v);
  for (let v = from; v > to; v--) cost -= skillStepCost(v);
  return cost;
}

/** Custom character creation budget. OH p.17 */
export const CUSTOM_CREATION = Object.freeze({ attributes: { body: 1, mind: 1, spirit: 1 }, xp: 40 });

/** KPI rewards. OH p.29 */
export const KPI_REWARDS = Object.freeze({
  short: { xp: 1, luck: 1 },
  long: { xp: 10, luck: "all" }
});
