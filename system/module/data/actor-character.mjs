import { CreatureData } from "./actor-base.mjs";
import { int, str, bool, html, attributesField, skillsField, bonusesField, resourceField } from "./fields.mjs";
import { kSyndromeStage } from "../rules/magic.mjs";

const { fields } = foundry.data;

export class CharacterData extends CreatureData {
  static LOCALIZATION_PREFIXES = ["LAUNDRY.Character"];

  static defineSchema() {
    return {
      attributes: attributesField(2),
      skills: skillsField(),
      bonuses: bonusesField(),
      toughness: resourceField(6),
      adrenaline: resourceField(0),
      injuries: new fields.SchemaField({
        value: int(0, { min: 0 }),
        critical: bool(false),
        deathDN: int(4, { min: 2 }),
        deathComplexity: int(1, { min: 1 })
      }),
      lastStand: bool(false),
      speed: str("normal"),
      kSyndrome: new fields.SchemaField({
        contracted: bool(false),
        mishaps: int(0, { min: 0 }),      // mishaps since first contact (drives resist Complexity)
        fails: int(0, { min: 0, max: 6 }) // failed resistance tests (permanent stages)
      }),
      xp: new fields.SchemaField({
        total: int(0, { min: 0 }),
        spent: int(0),
        log: new fields.ArrayField(new fields.SchemaField({
          date: str(), label: str(), cost: int(0), kind: str(), key: str(), from: int(0), to: int(0)
        }))
      }),
      mission: new fields.SchemaField({
        complicationUsed: bool(false),
        backupPlanUsed: bool(false),
        modderUsed: bool(false)
      }),
      details: new fields.SchemaField({
        assignment: str(),
        department: str(),
        coreSkill: str(),
        codename: str(),
        nickname: str(),
        age: str(),
        eyes: str(),
        hair: str(),
        features: str(),
        goals: new fields.SchemaField({
          short: str(), shortDone: bool(), long: str(), longDone: bool()
        }),
        connections: str(),
        training: str(),
        questionnaire: new fields.ArrayField(new fields.SchemaField({ q: str(), a: str() })),
        biography: html(),
        notes: html()
      }),
      creation: new fields.SchemaField({
        complete: bool(false),
        mode: str("assignment"),
        xpBudget: int(0)
      })
    };
  }

  /** Mind is reduced by K-Syndrome stages 3+ (minimum 1). OH p.139 */
  getAttribute(key) {
    let v = super.getAttribute(key);
    if (key === "mind") {
      const stage = kSyndromeStage(this.kSyndrome.fails);
      if (stage?.mind) v = Math.max(1, v + stage.mind);
    }
    return v;
  }

  prepareDerivedData() {
    const d = this._prepareCreature();
    this.toughness.max = d.toughness;
    this.injuries.max = d.injuries;
    this.injuries.filled = this.injuries.critical ? this.injuries.max
      : Math.min(this.injuries.max, this.injuries.spaces + this.injuries.value);
    this.adrenaline.max = d.adrenaline;
    this.initiative = d.initiative;
    this.naturalAwareness = d.naturalAwareness;

    // K-Syndrome permanent effects
    const stage = this.kSyndrome.fails;
    if (stage >= 1) this.modifiers.magicDisadvantage = true;
    if (stage >= 2) this.modifiers.mindDisadvantage = true;
    if (stage >= 5 && !this.modifiers.statuses.includes("weakened")) this.modifiers.pool -= 1;
    this.kSyndrome.stage = kSyndromeStage(stage)?.key ?? null;

    this.xp.available = this.xp.total - this.xp.spent;
  }

  /** Data exposed to roll formulas (@body, @initiative …). */
  getRollData() {
    return {
      body: this.getAttribute("body"),
      mind: this.getAttribute("mind"),
      spirit: this.getAttribute("spirit"),
      initiative: this.initiative ?? 0,
      naturalAwareness: this.naturalAwareness ?? 0
    };
  }
}
