/**
 * Core Test resolution (OH p.87-94).
 * Pure functions: no Foundry globals, fully unit tested.
 */

export const MIN_DN = 2;
export const MAX_DN = 6;

/** Clamp a Difficulty Number into the legal 2..6 range. */
export function clampDN(dn) {
  return Math.max(MIN_DN, Math.min(MAX_DN, Math.round(dn)));
}

/**
 * Apply Advantage (+) / Disadvantage (−) to a DN. Advantage lowers the DN.
 * Net advantage is capped to ±2 (Greater Advantage/Disadvantage). OH p.90
 */
export function applyAdvantage(dn, advantage = 0) {
  const net = Math.max(-2, Math.min(2, advantage));
  return clampDN(dn - net);
}

/** GM may grant automatic success if pool > DN × Complexity. OH p.89 */
export function isAutoSuccess(pool, dn, complexity) {
  return pool > dn * complexity;
}

/** Degree of success. OH p.91 */
export function classify(successes, complexity) {
  if (successes < complexity) return { outcome: "fail", extra: 0 };
  const extra = successes - complexity;
  if (extra >= 3) return { outcome: "major", extra };
  if (extra >= 1) return { outcome: "minor", extra };
  return { outcome: "pass", extra: 0 };
}

export function countSuccesses(values, dn) {
  return values.filter(v => v >= dn).length;
}

/** Tally of final die values relevant to magic mishaps (OH p.139). */
export function tally(values, dn) {
  let successes = 0, ones = 0, sixes = 0;
  for (const v of values) {
    if (v >= dn) successes++;
    if (v === 1) ones++;
    if (v >= 6) sixes++;
  }
  return { successes, ones, sixes };
}

/**
 * Useful Focus bonuses for a single die. Raising a die further than needed
 * is never useful, so we only consider thresholds.
 */
function candidateBonuses(r, dn, magic, maxBonus) {
  const set = new Set([0]);
  if (r < dn) set.add(dn - r);
  if (magic) {
    if (r === 1) set.add(1);
    if (r < 6) set.add(6 - r);
  }
  return [...set].filter(b => b <= maxBonus).sort((a, b) => a - b);
}

/**
 * Choose how to spend Focus points across dice.
 *
 * Normal mode: maximise successes, spending as little Focus as possible.
 * Magic mode "spell": first try to pass the Test, then avoid a mishap
 * (more 1s than 6s), then maximise successes. A failed cast always mishaps,
 * so if it cannot pass we simply maximise successes. (OH p.139)
 * Magic mode "app": pass first, then avoid 1s > 6s even on failure —
 * app activation only complicates on 1s > 6s. (OH p.135)
 *
 * @param {number[]} results  raw die results
 * @param {number} dn
 * @param {number} focus      available Focus points
 * @param {object} [opts]
 * @param {false|"spell"|"app"} [opts.magic=false]
 * @param {number}  [opts.complexity=1]
 * @returns {{bonuses:number[], values:number[], spent:number}}
 */
export function allocateFocus(results, dn, focus, { magic = false, complexity = 1 } = {}) {
  focus = Math.max(0, Math.floor(focus || 0));
  const n = results.length;
  if (!n || !focus) return { bonuses: results.map(() => 0), values: [...results], spent: 0 };

  // DP over dice. State: `${used}|${delta}` where delta = ones - sixes.
  // Value: best successes; keep back-pointer for reconstruction.
  let states = new Map([["0|0", { used: 0, delta: 0, succ: 0, path: [] }]]);
  for (let i = 0; i < n; i++) {
    const r = results[i];
    const next = new Map();
    for (const s of states.values()) {
      for (const b of candidateBonuses(r, dn, magic, focus - s.used)) {
        const v = r + b;
        const used = s.used + b;
        const delta = s.delta + (v === 1 ? 1 : 0) - (v >= 6 ? 1 : 0);
        const succ = s.succ + (v >= dn ? 1 : 0);
        const key = `${used}|${magic ? delta : 0}`;
        const prev = next.get(key);
        if (!prev || succ > prev.succ) {
          next.set(key, { used, delta: magic ? delta : 0, succ, path: [...s.path, b] });
        }
      }
    }
    states = next;
  }

  const all = [...states.values()];
  const better = (a, b) => {
    // returns true if a is preferable to b
    if (magic) {
      const aPass = a.succ >= complexity, bPass = b.succ >= complexity;
      if (aPass !== bPass) return aPass;
      if (aPass || magic === "app") {
        const aSafe = a.delta <= 0, bSafe = b.delta <= 0;
        if (aSafe !== bSafe) return aSafe;
      }
    }
    if (a.succ !== b.succ) return a.succ > b.succ;
    if (magic && a.delta !== b.delta) return a.delta < b.delta;
    return a.used < b.used;
  };
  let best = all[0];
  for (const s of all) if (better(s, best)) best = s;

  const bonuses = best.path;
  return { bonuses, values: results.map((r, i) => r + bonuses[i]), spent: best.used };
}

/**
 * Evaluate a Test.
 * @param {object} p
 * @param {number[]} p.results   raw d6 results
 * @param {number}   p.dn
 * @param {number}   [p.complexity=1]
 * @param {number}   [p.focus=0]
 * @param {number[]} [p.bonuses] manual Focus allocation (overrides auto)
 * @param {false|"spell"|"app"} [p.magic=false]
 */
export function evaluateTest({ results, dn, complexity = 1, focus = 0, bonuses = null, magic = false }) {
  dn = clampDN(dn);
  let alloc;
  if (Array.isArray(bonuses)) {
    const spent = bonuses.reduce((a, b) => a + b, 0);
    if (spent > focus) throw new Error(`Focus overspent: ${spent} > ${focus}`);
    alloc = { bonuses: [...bonuses], values: results.map((r, i) => r + (bonuses[i] || 0)), spent };
  } else {
    alloc = allocateFocus(results, dn, focus, { magic, complexity });
  }
  const t = tally(alloc.values, dn);
  const cls = classify(t.successes, complexity);
  const passed = cls.outcome !== "fail";
  let mishap = false;
  if (magic === "app") mishap = t.ones > t.sixes;
  else if (magic) mishap = !passed || t.ones > t.sixes;
  return {
    dn, complexity, focus,
    results: [...results],
    bonuses: alloc.bonuses,
    values: alloc.values,
    focusSpent: alloc.spent,
    focusRemaining: focus - alloc.spent,
    successes: t.successes,
    ones: t.ones,
    sixes: t.sixes,
    passed,
    ...cls,
    mishap
  };
}
