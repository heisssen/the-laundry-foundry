/**
 * Rules tables (OH p.99, 113-114, 136, 140). Names/effects are localised
 * via `LAUNDRY.Injury.<key>` etc.; mechanics are encoded here.
 *
 * dnMods: [{ attribute?: string, skill?: string, value }] — increases the DN of matching Tests.
 * immediate: statuses applied until the end of the victim's next turn.
 * persistent: statuses applied until the injury heals.
 */

const range = (min, max, data) => ({ min, max, ...data });

export const PHYSICAL_INJURIES = Object.freeze([
  range(1, 2, { key: "armWound", drop: true, dnMods: [{ attribute: "body", skill: "dexterity", value: 1 }] }),
  range(3, 4, { key: "legWound", immediate: ["prone"], persistentImmediate: true, dnMods: [{ attribute: "body", skill: "athletics", value: 1 }] }),
  range(5, 8, { key: "headWound", immediate: ["stunned"], dnMods: [{ attribute: "body", skill: "reflexes", value: 1 }] }),
  range(9, 10, { key: "internalInjury", immediate: ["incapacitated"], dnMods: [{ attribute: "body", skill: "fortitude", value: 1 }, { attribute: "body", skill: "might", value: 1 }] }),
  range(11, 12, { key: "brokenArm", drop: true, steps: { melee: -1, accuracy: -1 }, dnMods: [] }),
  range(13, 14, { key: "brokenLeg", immediate: ["prone"], persistentImmediate: true, speed: -1, dnMods: [{ attribute: "body", skill: "athletics", value: 1 }, { attribute: "body", skill: "stealth", value: 1 }] }),
  range(15, 17, { key: "brainInjury", immediate: ["unconscious"], actsLast: true, dnMods: [{ attribute: "body", value: 1 }] }),
  range(18, 99, { key: "instantDeath", death: true, dnMods: [] })
]);

export const PSYCHOLOGICAL_INJURIES = Object.freeze([
  range(1, 2, { key: "shocked", dnMods: [{ attribute: "mind", skill: "intuition", value: 1 }] }),
  range(3, 4, { key: "phobia", persistent: ["frightened"], dnMods: [] }),
  range(5, 8, { key: "confused", immediate: ["stunned"], dnMods: [{ attribute: "mind", skill: "awareness", value: 1 }] }),
  range(9, 10, { key: "existentialDread", immediate: ["incapacitated"], dnMods: [{ attribute: "spirit", skill: "resolve", value: 1 }] }),
  range(11, 12, { key: "realityDenial", immediate: ["blinded", "deafened"], dnMods: [{ attribute: "spirit", skill: "zeal", value: 1 }, { attribute: "mind", skill: "magic", value: 1 }] }),
  range(13, 14, { key: "traumatised", persistent: ["terrified"], dnMods: [] }),
  range(15, 17, { key: "hallucinations", immediate: ["unconscious"], noExtendedTests: true, dnMods: [{ attribute: "mind", value: 1 }, { attribute: "spirit", value: 1 }] }),
  range(18, 99, { key: "brokenMind", death: true, dnMods: [] })
]);

export const MAGICAL_MISHAPS = Object.freeze([
  range(2, 3, { key: "incursion" }),
  range(4, 4, { key: "outbreak" }),
  range(5, 5, { key: "summons" }),
  range(6, 6, { key: "groundZero" }),
  range(7, 7, { key: "psychologicalInjury", injury: true }),
  range(8, 8, { key: "warping" }),
  range(9, 9, { key: "miscast" }),
  range(10, 10, { key: "dread", threat: 1 }),
  range(11, 12, { key: "darkFuture" })
]);

export const COMPUTATIONAL_COMPLICATIONS = Object.freeze([
  range(2, 3, { key: "surge", zoneDamage: 3 }),
  range(4, 4, { key: "bricked" }),
  range(5, 5, { key: "fault" }),
  range(6, 6, { key: "reboot" }),
  range(7, 7, { key: "bugged", deviceFlag: "bugged" }),
  range(8, 8, { key: "popUp" }),
  range(9, 9, { key: "lowPower" }),
  range(10, 10, { key: "overheat", deviceFlag: "overheat" }),
  range(11, 12, { key: "hack" })
]);

export function lookup(table, total) {
  return table.find(r => total >= r.min && total <= r.max) ?? table[table.length - 1];
}

/**
 * Conditions (OH p.98-99). Mechanics consumed by derived data & rolls.
 * steps: Ladder step shifts; pool: dice pool modifier; dnMods like injuries.
 */
export const CONDITIONS = Object.freeze({
  blinded: { steps: { melee: -1, accuracy: -1, defence: -1 }, dnMods: [{ attribute: "mind", skill: "awareness", value: 2, tag: "sight" }] },
  charmed: {},
  deafened: { dnMods: [{ attribute: "mind", skill: "awareness", value: 2, tag: "hearing" }] },
  frightened: { pool: -1, adrenalineOnGain: 1 },
  incapacitated: { hitDN: 2, noActions: true },
  prone: { steps: { melee: -1, accuracy: -1 } },
  restrained: { steps: { melee: -1, accuracy: -1, defence: -1 }, noMove: true },
  stunned: { steps: { defence: -1 }, noExtraActions: true, slow: true },
  terrified: { pool: -2, adrenalineOnGain: 1, adrenalinePerTurn: 1, alsoFrightened: true },
  unconscious: { alsoProne: true, alsoIncapacitated: true },
  weakened: { pool: -1 },
  // System-specific markers
  critical: {},
  hidden: {},
  dodging: { steps: { defence: 1 } },
  charging: { steps: { defence: -1 } },
  lastStand: { steps: { melee: 1, accuracy: 1 } }
});

export const CONDITION_KEYS = Object.freeze(Object.keys(CONDITIONS));

/**
 * Aggregate condition mechanics for a set of active statuses.
 */
export function aggregateConditions(statuses) {
  const set = new Set(statuses);
  if (set.has("unconscious")) { set.add("prone"); set.add("incapacitated"); }
  const out = { steps: { melee: 0, accuracy: 0, defence: 0 }, pool: 0, dnMods: [] };
  // Terrified supersedes Frightened for dice penalty.
  if (set.has("terrified")) set.delete("frightened");
  for (const s of set) {
    const c = CONDITIONS[s];
    if (!c) continue;
    for (const [k, v] of Object.entries(c.steps ?? {})) out.steps[k] += v;
    out.pool += c.pool ?? 0;
    out.dnMods.push(...(c.dnMods ?? []));
  }
  return out;
}

/** Sum DN modifiers applicable to an attribute/skill pair. */
export function dnModifierFor(dnMods, attribute, skill) {
  let total = 0;
  for (const m of dnMods ?? []) {
    if (m.tag) continue; // situational (sight/hearing) — applied manually
    if (m.attribute && m.attribute !== attribute) continue;
    if (m.skill && m.skill !== skill) continue;
    total += m.value;
  }
  return total;
}
