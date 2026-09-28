/**
 * Damage, Injuries, Critical Injury and Death Tests (OH p.112-116).
 */

export const SEVERITY = Object.freeze({
  minor: { spaces: 1, dice: 1, deathComplexity: 1 },
  serious: { spaces: 2, dice: 2, deathComplexity: 2 },
  deadly: { spaces: 3, dice: 3, deathComplexity: 3 }
});

/** Injury severity from the Damage a single source deals past Toughness. */
export function severityFor(overflow) {
  if (overflow >= 5) return "deadly";
  if (overflow >= 2) return "serious";
  if (overflow >= 1) return "minor";
  return null;
}

/**
 * Resolve Damage against a creature.
 *
 * @param {object} target
 * @param {number} target.toughness          current Toughness
 * @param {number} [target.armour=0]
 * @param {number} [target.injuriesMax=0]    0 → creature has no Injury Track (most NPCs)
 * @param {number} [target.injuriesFilled=0]
 * @param {boolean} [target.critical=false]
 * @param {object} hit
 * @param {number} hit.damage                total Damage of the hit
 * @param {"physical"|"psychological"} [hit.type="physical"]
 * @param {boolean} [hit.ignoreArmour=false]
 * @param {number} [hit.armourPenetration=0]
 * @param {boolean} [hit.brutal=false]       Minor → Serious (OH p.123)
 * @param {boolean} [hit.ineffective=false]  Armour doubled, Minor Injuries only (OH p.123)
 */
export function resolveDamage(target, hit) {
  const type = hit.type ?? "physical";
  const baseArmour = (target.armour ?? 0) * (hit.ineffective ? 2 : 1);
  const armour = (type === "physical" && !hit.ignoreArmour)
    ? Math.max(0, baseArmour - (hit.armourPenetration ?? 0)) : 0;
  const damage = Math.max(0, Math.floor(hit.damage) - armour);
  const out = {
    type, armourApplied: Math.min(armour, Math.floor(hit.damage)), damage,
    toughnessBefore: target.toughness, toughnessAfter: target.toughness,
    overflow: 0, severity: null, spaces: 0,
    injuriesFilledAfter: target.injuriesFilled ?? 0,
    becameCritical: false, deathComplexityIncrease: 0,
    defeated: false
  };
  if (damage <= 0) return out;

  // Already Critical: every further hit raises the Death Test Complexity. OH p.115
  if (target.critical) {
    out.deathComplexityIncrease = 1;
    out.toughnessAfter = 0;
    return out;
  }

  const tough = Math.max(0, target.toughness);
  out.toughnessAfter = Math.max(0, tough - damage);
  out.overflow = Math.max(0, damage - tough);

  const max = target.injuriesMax ?? 0;
  if (out.overflow > 0) {
    if (!max) {
      // No Injury Track: reduced to 0 Toughness → dead / incapacitated. OH p.112
      out.defeated = true;
      return out;
    }
    out.severity = severityFor(out.overflow);
    if (hit.ineffective) out.severity = "minor";
    else if (hit.brutal && out.severity === "minor") out.severity = "serious";
    out.spaces = SEVERITY[out.severity].spaces;
    const filled = target.injuriesFilled ?? 0;
    if (filled + out.spaces > max) {
      out.becameCritical = true;
      out.injuriesFilledAfter = max;
    } else {
      out.injuriesFilledAfter = filled + out.spaces;
    }
  } else if (out.toughnessAfter === 0 && !max) {
    out.defeated = true;
  }
  return out;
}

/** Initial Death Test after becoming Critically Injured. OH p.114 */
export function initialDeathTest(severity) {
  return { dn: 4, complexity: SEVERITY[severity]?.deathComplexity ?? 1 };
}

/**
 * Outcome of a Death Test roll.
 * @returns {{status:"stable"|"dying"|"dead", dn:number, complexity:number}}
 */
export function resolveDeathTest({ dn, complexity, pool, successes }) {
  if (complexity > pool) return { status: "dead", dn, complexity };
  if (successes >= complexity) return { status: "stable", dn, complexity };
  const next = dn + 1;
  if (next > 6) return { status: "dead", dn: next, complexity };
  return { status: "dying", dn: next, complexity };
}

/** Death is certain if the Test is already impossible. */
export function deathTestImpossible({ dn, complexity, pool }) {
  return dn > 6 || complexity > pool;
}

/** Luck: Cheat Death — recover half total Toughness, no longer Critical. OH p.97 */
export function cheatDeath(toughnessMax) {
  return { toughness: Math.floor(toughnessMax / 2), critical: false };
}

/** Recovery options (OH p.116). */
export const RECOVERY = Object.freeze({
  breather: max => Math.floor(max / 2),   // 1 hour: half maximum Toughness
  rest: max => max                          // 6 hours: full Toughness
});

/** Falling Damage: 1 per 3 metres. OH p.105 */
export function fallingDamage(metres) {
  return Math.floor(metres / 3);
}

/** Hazards (OH p.103). */
export const HAZARD_DAMAGE = Object.freeze({ minor: 1, major: 3, deadly: 5 });
