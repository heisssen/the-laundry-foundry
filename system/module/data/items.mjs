import { int, str, bool, html } from "./fields.mjs";
import { SKILLS } from "../rules/derived.mjs";

const { fields } = foundry.data;

const strArray = () => new fields.ArrayField(new fields.StringField({ required: true, blank: false }));
const nullableStep = () => new fields.NumberField({ required: true, nullable: true, integer: true, min: 0, max: 6, initial: null });
const nullableInt = () => new fields.NumberField({ required: true, nullable: true, integer: true, min: 0, initial: null });

class BaseItemData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      identifier: str(),
      source: str(),        // e.g. "OH p.66"
      description: html()
    };
  }
}

/** Requirements for Talents in structured form (OH p.66). */
const requirementField = () => new fields.SchemaField({
  text: str(),
  skills: new fields.ArrayField(new fields.SchemaField({
    // any of `keys` satisfies the requirement
    keys: strArray(),
    training: int(0),
    focus: int(0),
    either: bool(false) // Training OR Focus
  })),
  attributes: new fields.ArrayField(new fields.SchemaField({ key: str(), value: int(0) })),
  assignment: str(),
  other: str()
});

export class TalentData extends BaseItemData {
  static defineSchema() {
    return {
      ...super.defineSchema(),
      category: str("talent"), // talent | trait (NPC)
      requirements: requirementField(),
      repeatable: bool(false),
      rank: int(1, { min: 1 }),
      core: bool(false),
      activation: new fields.SchemaField({
        type: str("passive"), // passive | action | free | reaction
        adrenaline: int(0),
        luck: int(0),
        test: str(),          // "4:1 spirit presence"
        uses: str()           // "mission" | "day" | "rest" | ""
      }),
      used: bool(false),
      /**
       * Roll modifiers offered by this Talent (see module/helpers/talent-mods.mjs).
       * type: advantage | doubleTraining | doubleFocus | bonusDice | complexity | attackStep | damage | trait | ignoreArmourSixes
       * when: test | attack | melee | ranged | cast | app | charge | dualWield | firstRound | unarmed
       * auto: applied without asking; otherwise offered as a checkbox.
       */
      modifiers: new fields.ArrayField(new fields.SchemaField({
        label: str(),
        type: str("advantage"),
        value: str("1"),
        when: str("test"),
        skills: strArray(),
        attribute: str(),
        auto: bool(false)
      }))
    };
  }
}

export class WeaponData extends BaseItemData {
  static defineSchema() {
    return {
      ...super.defineSchema(),
      kind: str("melee"),         // melee | ranged
      skill: str("closeCombat"),  // closeCombat | ranged
      damage: int(0),             // X in X + S
      addSuccesses: bool(true),
      blast: int(0),
      range: str(""),             // short | medium | long (ranged)
      thrownRange: str(""),
      traits: strArray(),
      requisition: str(""),
      equipped: bool(true),
      quantity: int(1, { min: 0 }),
      // NPC statblock overrides
      step: nullableStep(),
      pool: nullableInt(),
      focus: nullableInt(),
      damageType: str("physical")
    };
  }

  get isRanged() { return this.kind === "ranged"; }
}

export class ArmourData extends BaseItemData {
  static defineSchema() {
    return {
      ...super.defineSchema(),
      value: int(1, { min: 0 }),
      damage: int(0, { min: 0 }), // points destroyed by Rend
      traits: strArray(),
      requisition: str(""),
      equipped: bool(true)
    };
  }
}

export class GearData extends BaseItemData {
  static defineSchema() {
    return {
      ...super.defineSchema(),
      category: str("conventional"),
      quantity: int(1, { min: 0 }),
      requisition: str(""),
      certification: str(""),
      uses: new fields.SchemaField({ value: int(0), max: int(0) }),
      isDevice: bool(false),          // can run apps / computational sorcery
      tech: str("smartphone"),        // calculator | smartphone | laptop | supercomputer
      deviceState: str(""),           // "" | bugged | overheat | bricked | reboot | fault | lowPower | hacked
      equipped: bool(true)
    };
  }
}

export class SpellData extends BaseItemData {
  static defineSchema() {
    return {
      ...super.defineSchema(),
      group: str("protection"),
      dn: int(4, { min: 2, max: 6 }),
      complexity: str("L"),
      castingTime: new fields.SchemaField({ value: int(1), unit: str("minutes") }),
      target: str(),
      range: str(),
      duration: str(),
      levels: new fields.ArrayField(new fields.SchemaField({
        min: int(1), max: int(1), effect: html(), damage: int(0), damageType: str("")
      })),
      modifications: new fields.ArrayField(new fields.SchemaField({
        label: str(), complexity: int(1), repeatable: bool(false)
      })),
      exonomeOnly: bool(false),
      ignoreArmour: bool(false), // spell Damage bypasses Armour (Banishment)
      castThreat: int(0),        // Threat raised whenever an operative casts it (Prognostication)
      known: bool(true),
      effect: html()
    };
  }
}

/** Pre-written occult app (Handheld Magic, OH p.135). */
export class AppData extends BaseItemData {
  static defineSchema() {
    return {
      ...super.defineSchema(),
      spell: str(),        // spell identifier
      level: int(1, { min: 1 }),
      dn: int(4, { min: 2, max: 6 }),
      complexity: int(1, { min: 1 }),
      installedOn: str(),  // gear item id
      requisition: str("")
    };
  }
}

/** Assignment package (OH p.37-59). */
export class AssignmentData extends BaseItemData {
  static defineSchema() {
    return {
      ...super.defineSchema(),
      department: str("other"),
      division: str(),
      attributes: new fields.SchemaField({ body: int(2), mind: int(2), spirit: int(2) }),
      coreSkill: new fields.StringField({ required: true, blank: true, initial: "", choices: ["", ...SKILLS] }),
      skillOptions: strArray(),
      xp: int(0),
      coreTalents: strArray(),
      talentChoices: int(0),
      optionalTalents: strArray(),
      spells: strArray(),
      equipment: strArray()
    };
  }
}

export class InjuryData extends BaseItemData {
  static defineSchema() {
    return {
      ...super.defineSchema(),
      kind: str("physical"),
      severity: str("minor"),
      key: str(),
      roll: int(0),
      spaces: int(1, { min: 0, max: 3 }),
      healed: bool(false),
      cause: str()
    };
  }
}
