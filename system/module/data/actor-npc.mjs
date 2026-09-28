import { CreatureData } from "./actor-base.mjs";
import { int, str, bool, html, attributesField, skillsField, bonusesField } from "./fields.mjs";

const { fields } = foundry.data;

/** A nullable Ladder-step override (statblocks print ratings directly). */
const stepOverride = () => new fields.NumberField({ required: true, nullable: true, integer: true, min: 0, max: 6, initial: null });
const numOverride = () => new fields.NumberField({ required: true, nullable: true, integer: true, min: 0, initial: null });

export class NpcData extends CreatureData {
  static LOCALIZATION_PREFIXES = ["LAUNDRY.NPC"];

  static defineSchema() {
    return {
      attributes: attributesField(2),
      skills: skillsField(),
      bonuses: bonusesField(),
      size: str("medium"),
      category: str("human"),
      species: str("Human"),
      affiliation: str(""),
      overrides: new fields.SchemaField({
        melee: stepOverride(),
        accuracy: stepOverride(),
        defence: stepOverride(),
        toughness: numOverride(),
        injuries: numOverride(),
        adrenaline: numOverride(),
        initiative: numOverride(),
        naturalAwareness: numOverride(),
        armour: numOverride()
      }),
      toughness: new fields.SchemaField({ value: int(6, { min: 0 }) }),
      adrenaline: new fields.SchemaField({ value: int(0, { min: 0 }) }),
      injuries: new fields.SchemaField({
        value: int(0, { min: 0 }),
        critical: bool(false),
        deathDN: int(4),
        deathComplexity: int(1)
      }),
      useInjuries: bool(false),
      speed: str("normal"),
      presence: str("none"),
      spellcaster: str(""),
      threatScaling: html(),
      description: html(),
      notes: html()
    };
  }

  prepareDerivedData() {
    const o = this.overrides;
    const d = this._prepareCreature({
      overrides: { melee: o.melee, accuracy: o.accuracy, defence: o.defence }
    });
    if (o.armour != null) this.combat.armour = o.armour
      + this._equippedArmour().reduce((s, i) => s + (i.system.value - i.system.damage), 0);
    this.toughness.max = (o.toughness ?? d.toughness);
    this.injuries.max = this.useInjuries ? (o.injuries ?? d.injuries) : 0;
    this.injuries.filled = this.injuries.critical ? this.injuries.max
      : Math.min(this.injuries.max, this.injuries.spaces + this.injuries.value);
    this.adrenaline.max = o.adrenaline ?? 0;
    this.initiative = (o.initiative ?? d.initiative);
    this.naturalAwareness = (o.naturalAwareness ?? d.naturalAwareness);
  }

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
