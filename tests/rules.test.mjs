import { describe, it, expect } from "vitest";
import { totalToStep, attackDN } from "../system/module/rules/ladder.mjs";
import { evaluateTest, allocateFocus, applyAdvantage, isAutoSuccess, classify } from "../system/module/rules/dice.mjs";
import { computeDerived, dicePool } from "../system/module/rules/derived.mjs";
import { resolveDamage, initialDeathTest, resolveDeathTest } from "../system/module/rules/damage.mjs";
import { castComplexity, castingTime, kSyndromeResistComplexity } from "../system/module/rules/magic.mjs";
import { attributeCost, skillCost, TALENT_COST } from "../system/module/rules/xp.mjs";
import { attackDifficulty, attackDamage, sortInitiative } from "../system/module/rules/combat.mjs";
import { resolveOpposed, progressExtended, pursuitStep } from "../system/module/rules/tests.mjs";
import { lookup, PHYSICAL_INJURIES, MAGICAL_MISHAPS, aggregateConditions, dnModifierFor } from "../system/module/rules/tables.mjs";

const skills = (o) => Object.fromEntries(Object.entries(o).map(([k, t]) => [k, { training: t, focus: 0 }]));

describe("Ladder (OH p.33, 109)", () => {
  it("maps totals to steps", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 15].map(totalToStep))
      .toEqual([0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6]);
  });
  it("attack DN from step difference", () => {
    expect(attackDN(3, 0)).toBe(2); // Great vs Poor
    expect(attackDN(2, 0)).toBe(2);
    expect(attackDN(2, 1)).toBe(3); // Good Accuracy vs Average
    expect(attackDN(2, 2)).toBe(4);
    expect(attackDN(2, 3)).toBe(5);
    expect(attackDN(2, 5)).toBe(6);
  });
});

describe("Tests (OH p.87-94)", () => {
  it("Simon's Focus example: 1,2,5,5 DN4 Focus2 → 3 successes", () => {
    const r = evaluateTest({ results: [1, 2, 5, 5], dn: 4, complexity: 1, focus: 2 });
    expect(r.successes).toBe(3);
    expect(r.values).toEqual([1, 4, 5, 5]);
  });
  it("Steph's hack: 4,5,6,6 at DN 4:2 → minor benefit (+2)", () => {
    const r = evaluateTest({ results: [4, 5, 6, 6], dn: 4, complexity: 2 });
    expect(r.outcome).toBe("minor");
    expect(r.extra).toBe(2);
  });
  it("Jensen double focus: 1,2,3,3,5,5,6 DN4 Focus 4 → 6 successes", () => {
    const r = evaluateTest({ results: [1, 2, 3, 3, 5, 5, 6], dn: 4, focus: 4 });
    expect(r.successes).toBe(6);
  });
  it("degrees of success", () => {
    expect(classify(0, 1).outcome).toBe("fail");
    expect(classify(2, 2).outcome).toBe("pass");
    expect(classify(4, 1).outcome).toBe("major");
  });
  it("advantage clamps DN within 2..6", () => {
    expect(applyAdvantage(5, 1)).toBe(4);
    expect(applyAdvantage(2, 2)).toBe(2);
    expect(applyAdvantage(6, -1)).toBe(6);
    expect(applyAdvantage(4, -5)).toBe(6);
  });
  it("auto-success: pool > DN × C", () => {
    expect(isAutoSuccess(5, 2, 2)).toBe(true);
    expect(isAutoSuccess(4, 2, 2)).toBe(false);
  });
  it("manual focus allocation is respected and validated", () => {
    const r = evaluateTest({ results: [3, 3], dn: 4, focus: 1, bonuses: [1, 0] });
    expect(r.successes).toBe(1);
    expect(() => evaluateTest({ results: [3], dn: 4, focus: 0, bonuses: [1] })).toThrow();
  });
});

describe("Magic focus allocation (OH p.139)", () => {
  it("prefers avoiding a mishap once the cast passes", () => {
    // DN 5 C 1, results 1,5,3 ; focus 1. Pass already (the 5). Spend focus 1→2 to avoid 1s>6s.
    const r = evaluateTest({ results: [1, 5, 3], dn: 5, complexity: 1, focus: 1, magic: "spell" });
    expect(r.passed).toBe(true);
    expect(r.mishap).toBe(false);
  });
  it("passing beats safety", () => {
    // DN 5 C 2, results 1,5,4; focus 1: raise 4→5 to pass (mishap remains) rather than 1→2 and fail.
    const r = evaluateTest({ results: [1, 5, 4], dn: 5, complexity: 2, focus: 1, magic: "spell" });
    expect(r.passed).toBe(true);
    expect(r.mishap).toBe(true);
  });
  it("failed cast always mishaps", () => {
    const r = evaluateTest({ results: [2, 2], dn: 5, complexity: 1, focus: 0, magic: "spell" });
    expect(r.mishap).toBe(true);
  });
  it("app: failure without 1s>6s is not a complication", () => {
    const r = evaluateTest({ results: [2, 3], dn: 4, complexity: 1, magic: "app" });
    expect(r.passed).toBe(false);
    expect(r.mishap).toBe(false);
  });
  it("5→6 counts as a six to balance ones", () => {
    const a = allocateFocus([1, 5, 6], 4, 1, { magic: "spell", complexity: 1 });
    expect(a.values.filter(v => v === 1).length <= a.values.filter(v => v >= 6).length).toBe(true);
  });
});

describe("Derived stats (OH p.32-34) — Bill the Plumber", () => {
  const d = computeDerived({
    attributes: { body: 3, mind: 2, spirit: 2 },
    skills: skills({ closeCombat: 2, reflexes: 1, awareness: 1, ranged: 0 })
  });
  it("Melee Good, Accuracy Average, Defence Good", () => {
    expect(d.melee).toBe(2);
    expect(d.accuracy).toBe(1);
    expect(d.defence).toBe(2);
  });
  it("Toughness 7, Injuries 4, Initiative 4, NA 2, Adrenaline 1", () => {
    expect(d.toughness).toBe(7);
    expect(d.injuries).toBe(4);
    expect(d.initiative).toBe(4);
    expect(d.naturalAwareness).toBe(2);
    expect(d.adrenaline).toBe(1);
  });
  it("dice pool with doubled Training (Jensen: Body 3 + 2×2 = 7)", () => {
    expect(dicePool({ attribute: 3, training: 2, doubleTraining: true })).toBe(7);
  });
});

describe("Damage (OH p.112-115)", () => {
  it("Darren shoots cult leader: 3 dmg vs Armour 2 → 1", () => {
    const r = resolveDamage({ toughness: 6, armour: 2 }, { damage: 3 });
    expect(r.damage).toBe(1);
    expect(r.toughnessAfter).toBe(5);
  });
  it("Darren hit for 5 with Armour 1 and 2 Toughness → Serious Injury", () => {
    const r = resolveDamage({ toughness: 2, armour: 1, injuriesMax: 4, injuriesFilled: 0 }, { damage: 5 });
    expect(r.toughnessAfter).toBe(0);
    expect(r.overflow).toBe(2);
    expect(r.severity).toBe("serious");
    expect(r.injuriesFilledAfter).toBe(2);
  });
  it("Ben: Serious with one space left → Critical, Death Test 4:2", () => {
    const r = resolveDamage({ toughness: 0, injuriesMax: 4, injuriesFilled: 3 }, { damage: 3 });
    expect(r.becameCritical).toBe(true);
    expect(initialDeathTest(r.severity)).toEqual({ dn: 4, complexity: 2 });
  });
  it("Death Test progression and death", () => {
    expect(resolveDeathTest({ dn: 4, complexity: 3, pool: 4, successes: 1 }).status).toBe("dying");
    expect(resolveDeathTest({ dn: 6, complexity: 3, pool: 4, successes: 0 }).status).toBe("dead");
    expect(resolveDeathTest({ dn: 6, complexity: 5, pool: 4, successes: 4 }).status).toBe("dead");
    expect(resolveDeathTest({ dn: 4, complexity: 2, pool: 4, successes: 2 }).status).toBe("stable");
  });
  it("damage while critical raises complexity", () => {
    expect(resolveDamage({ toughness: 0, critical: true, injuriesMax: 4, injuriesFilled: 4 }, { damage: 2 }).deathComplexityIncrease).toBe(1);
  });
  it("NPC without Injury Track is defeated at 0", () => {
    expect(resolveDamage({ toughness: 3 }, { damage: 4 }).defeated).toBe(true);
  });
  it("psychological damage ignores armour; brutal upgrades minor", () => {
    expect(resolveDamage({ toughness: 3, armour: 3 }, { damage: 2, type: "psychological" }).damage).toBe(2);
    expect(resolveDamage({ toughness: 0, injuriesMax: 4 }, { damage: 1, brutal: true }).severity).toBe("serious");
    expect(resolveDamage({ toughness: 0, armour: 1, injuriesMax: 4 }, { damage: 9, ineffective: true }).severity).toBe("minor");
  });
});

describe("Combat (OH p.106-111)", () => {
  it("Ron's pistol at long range: Average→Poor vs Average → DN 5", () => {
    const r = attackDifficulty({ kind: "ranged", attackStep: 1, defenceStep: 1, range: "long", weaponRange: "medium" });
    expect(r.dn).toBe(5);
  });
  it("partial cover and called shot to the head", () => {
    expect(attackDifficulty({ kind: "ranged", attackStep: 2, defenceStep: 2, range: "short", weaponRange: "medium", cover: "partial" }).dn).toBe(5);
    expect(attackDifficulty({ kind: "melee", attackStep: 2, defenceStep: 1, calledShot: "head" }).dn).toBe(5);
  });
  it("hidden attacker treats Defence as Poor; incapacitated DN 2", () => {
    expect(attackDifficulty({ kind: "melee", attackStep: 1, defenceStep: 4, hidden: true }).dn).toBe(3);
    expect(attackDifficulty({ kind: "melee", attackStep: 0, defenceStep: 6, targetIncapacitated: true }).dn).toBe(2);
  });
  it("Dana: 1 + S with 2 successes = 3", () => {
    expect(attackDamage({ successes: 2, values: [2, 4, 6], baseDamage: 1 }).damage).toBe(3);
  });
  it("stunning on a 6, cleave counts 6s", () => {
    const a = attackDamage({ successes: 2, values: [6, 6, 1], baseDamage: 0, traits: ["stunning", "cleave"] });
    expect(a.effects.stunned).toBe(true);
    expect(a.effects.cleave).toBe(2);
  });
  it("initiative ties: PCs first", () => {
    const o = sortInitiative([{ id: "npc", initiative: 4 }, { id: "pc", initiative: 4, isPC: true }, { id: "fast", initiative: 6 }]);
    expect(o.map(c => c.id)).toEqual(["fast", "pc", "npc"]);
  });
});

describe("Magic (OH p.139-143)", () => {
  it("Anti-Magic Ward L2 + extra target = 5:3; fast cast = 5:9", () => {
    expect(castComplexity({ level: 2, modifications: { extraTarget: 1 } })).toBe(3);
    expect(castComplexity({ level: 2, modifications: { extraTarget: 1 }, fastCast: true })).toBe(9);
  });
  it("mental magic +2", () => {
    expect(castComplexity({ level: 1, method: "mental" })).toBe(3);
  });
  it("casting time modifiers", () => {
    expect(castingTime({ minutes: 60, method: "traditional" })).toBe(120);
    expect(castingTime({ minutes: 60, method: "computational", tech: "laptop" })).toBe(45);
    expect(castingTime({ minutes: 1, method: "computational", tech: "supercomputer" })).toBe(1);
  });
  it("K-Syndrome resist complexity grows", () => {
    expect(kSyndromeResistComplexity(0)).toBe(1);
    expect(kSyndromeResistComplexity(2)).toBe(3);
  });
});

describe("XP (OH p.34) — Bill spends 15 XP", () => {
  it("Spirit 2→3 = 5, Close Combat 2→3 = 3, Focus 0→1 = 1, Talent 4", () => {
    expect(attributeCost(2, 3)).toBe(5);
    expect(skillCost(2, 3)).toBe(3);
    expect(skillCost(0, 1)).toBe(1);
    expect(5 + 3 + 1 + TALENT_COST).toBe(13);
    expect(attributeCost(1, 4)).toBe(18);
    expect(skillCost(0, 4)).toBe(10);
  });
});

describe("Test types", () => {
  it("opposed ties go to larger pool", () => {
    expect(resolveOpposed({ successes: 3, pool: 3 }, { successes: 1, pool: 5 })).toBe("a");
    expect(resolveOpposed({ successes: 2, pool: 3 }, { successes: 2, pool: 5 })).toBe("b");
    expect(resolveOpposed({ successes: 2, pool: 3 }, { successes: 2, pool: 3 })).toBe("reroll");
  });
  it("extended test accumulates", () => {
    let s = { required: 6, attemptsAllowed: 3 };
    s = progressExtended(s, 2); s = progressExtended(s, 2);
    expect(s.status).toBe("ongoing");
    s = progressExtended(s, 1);
    expect(s.status).toBe("failure");
  });
  it("pursuit", () => {
    expect(pursuitStep(4, 1, 3)).toEqual({ distance: 2, status: "ongoing" });
    expect(pursuitStep(2, 0, 3).status).toBe("caught");
  });
});

describe("Tables & conditions", () => {
  it("Darren rolls 7 on 2d6 → Head Wound", () => {
    expect(lookup(PHYSICAL_INJURIES, 7).key).toBe("headWound");
    expect(lookup(PHYSICAL_INJURIES, 18).key).toBe("instantDeath");
    expect(lookup(MAGICAL_MISHAPS, 10).key).toBe("dread");
  });
  it("condition aggregation", () => {
    const a = aggregateConditions(["terrified", "frightened", "weakened", "blinded"]);
    expect(a.pool).toBe(-3);
    expect(a.steps.defence).toBe(-1);
    const b = aggregateConditions(["unconscious"]);
    expect(b.steps.melee).toBe(-1);
  });
  it("dn modifiers match attribute+skill", () => {
    const mods = [{ attribute: "body", skill: "dexterity", value: 1 }, { attribute: "mind", value: 1 }];
    expect(dnModifierFor(mods, "body", "dexterity")).toBe(1);
    expect(dnModifierFor(mods, "mind", "occult")).toBe(1);
    expect(dnModifierFor(mods, "body", "might")).toBe(0);
  });
});
