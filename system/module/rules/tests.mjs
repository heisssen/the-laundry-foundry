/**
 * Test types (OH p.91-94): Opposed, Extended, Group, Luck.
 */

/**
 * Opposed Test result: most successes wins; tie → larger pool; still tied → reroll.
 * @returns {"a"|"b"|"reroll"}
 */
export function resolveOpposed(a, b) {
  if (a.successes !== b.successes) return a.successes > b.successes ? "a" : "b";
  if (a.pool !== b.pool) return a.pool > b.pool ? "a" : "b";
  return "reroll";
}

/** Natural Awareness vs sneaking: NA becomes the Complexity. OH p.92 */
export function naturalAwarenessFromPool(pool) {
  return Math.ceil(pool / 2);
}

/**
 * Extended / Group Test accumulator.
 * @param {object} state { required, attemptsAllowed, attempts:[{successes, by}] }
 */
export function progressExtended(state, successes, by = null) {
  const attempts = [...(state.attempts ?? []), { successes, by }];
  const total = attempts.reduce((s, a) => s + a.successes, 0);
  const done = total >= state.required;
  const outOfAttempts = state.attemptsAllowed ? attempts.length >= state.attemptsAllowed : false;
  return {
    ...state,
    attempts,
    total,
    status: done ? "success" : (outOfAttempts ? "failure" : "ongoing")
  };
}

/** Luck Test: DN 4:1, pool = remaining Luck. OH p.94 */
export function luckTestParams(luck) {
  return { dn: 4, complexity: 1, pool: Math.max(0, luck) };
}

/** Pursuit (OH p.116): update Distance (0 caught … 10 escaped). */
export function pursuitStep(distance, quarrySuccesses, pursuerSuccesses) {
  const next = distance + (quarrySuccesses - pursuerSuccesses);
  return {
    distance: Math.max(0, Math.min(10, next)),
    status: next <= 0 ? "caught" : (next >= 10 ? "escaped" : "ongoing")
  };
}

/**
 * Resolve one Pursuit round (OH p.116): the Quarry who rolled the fewest successes against the
 * Pursuer who rolled the most. At Distance 0 with several Quarry, the slowest is caught and the
 * rest carry on (Distance resets to 1 — "almost within reach"); a lone Quarry ends the chase.
 * @param {number} distance
 * @param {{id:string, successes:number}[]} quarry     participants still running
 * @param {{id:string, successes:number}[]} pursuers
 */
export function resolvePursuitRound(distance, quarry, pursuers) {
  if (!quarry.length || !pursuers.length) return { distance, status: "ongoing", delta: 0, caught: null, slowest: null, fastest: null };
  const slowest = quarry.reduce((a, b) => (b.successes < a.successes ? b : a));
  const fastest = pursuers.reduce((a, b) => (b.successes > a.successes ? b : a));
  const delta = slowest.successes - fastest.successes;
  const next = distance + delta;
  if (next >= 10) return { distance: 10, status: "escaped", delta, caught: null, slowest: slowest.id, fastest: fastest.id };
  if (next <= 0) {
    if (quarry.length > 1) return { distance: 1, status: "ongoing", delta, caught: slowest.id, slowest: slowest.id, fastest: fastest.id };
    return { distance: 0, status: "caught", delta, caught: slowest.id, slowest: slowest.id, fastest: fastest.id };
  }
  return { distance: next, status: "ongoing", delta, caught: null, slowest: slowest.id, fastest: fastest.id };
}
