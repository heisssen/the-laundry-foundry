/**
 * Shared behaviour for creatures (characters and NPCs).
 */
import { computeDerived, SKILLS } from "../rules/derived.mjs";
import { clampStep } from "../rules/ladder.mjs";
import { aggregateConditions } from "../rules/tables.mjs";
import { PHYSICAL_INJURIES, PSYCHOLOGICAL_INJURIES } from "../rules/tables.mjs";

export class CreatureData extends foundry.abstract.TypeDataModel {

  get actor() { return this.parent; }

  /** Attribute values after K-Syndrome and other permanent modifiers. */
  getAttribute(key) {
    return Math.max(0, this.attributes[key]?.value ?? 0);
  }

  getSkill(key) {
    return this.skills?.[key] ?? { training: 0, focus: 0 };
  }

  /** Items that affect combat stats. */
  _equippedArmour() {
    return this.parent.items.filter(i => i.type === "armour" && i.system.equipped);
  }

  _hasDefensiveWeapon() {
    return this.parent.items.some(i => i.type === "weapon" && i.system.equipped && i.system.traits.includes("defensive"));
  }

  /** Collect injury-based modifiers from embedded injury items. */
  _injuryModifiers() {
    const out = { steps: { melee: 0, accuracy: 0, defence: 0 }, dnMods: [], speed: 0, actsLast: false };
    for (const item of this.parent.items) {
      if (item.type !== "injury" || item.system.healed) continue;
      const table = item.system.kind === "psychological" ? PSYCHOLOGICAL_INJURIES : PHYSICAL_INJURIES;
      const row = table.find(r => r.key === item.system.key);
      if (!row) continue;
      for (const [k, v] of Object.entries(row.steps ?? {})) out.steps[k] += v;
      out.dnMods.push(...(row.dnMods ?? []));
      out.speed += row.speed ?? 0;
      if (row.actsLast) out.actsLast = true;
    }
    return out;
  }

  /** Shared derived-data pipeline. Subclasses may override stat sources. */
  _prepareCreature({ overrides = {} } = {}) {
    const attributes = {
      body: this.getAttribute("body"),
      mind: this.getAttribute("mind"),
      spirit: this.getAttribute("spirit")
    };
    const skills = Object.fromEntries(SKILLS.map(k => [k, this.getSkill(k)]));
    const initiativeUsesBody = this.parent.items.some(i => i.type === "talent" && i.system.identifier === "conditionedToFight");
    const talent = id => this.parent.items.some(i => i.type === "talent" && i.system.identifier === id);
    const d = computeDerived({ attributes, skills, bonuses: this.bonuses, initiativeUsesBody });
    // Guts: +1 Toughness per Training in Resolve. OH p.73
    if (talent("guts")) d.toughness += skills.resolve?.training ?? 0;

    const statuses = [...(this.parent.statuses ?? [])];
    const cond = aggregateConditions(statuses);
    const inj = this._injuryModifiers();
    const defensive = this._hasDefensiveWeapon() ? 1 : 0;
    // Evasive: Dodge grants +2 Defence steps instead of +1. OH p.71
    if (statuses.includes("dodging") && talent("evasive")) cond.steps.defence += 1;

    const base = {
      melee: overrides.melee ?? d.melee,
      accuracy: overrides.accuracy ?? d.accuracy,
      defence: overrides.defence ?? d.defence
    };
    this.combat = {
      meleeBase: base.melee,
      accuracyBase: base.accuracy,
      defenceBase: base.defence,
      melee: clampStep(base.melee + cond.steps.melee + inj.steps.melee + (overrides.melee != null ? this.bonuses.meleeStep : 0)),
      accuracy: clampStep(base.accuracy + cond.steps.accuracy + inj.steps.accuracy + (overrides.accuracy != null ? this.bonuses.accuracyStep : 0)),
      defence: clampStep(base.defence + cond.steps.defence + inj.steps.defence + defensive + (overrides.defence != null ? this.bonuses.defenceStep : 0)),
      armour: this._equippedArmour().reduce((s, i) => s + (i.system.value - i.system.damage), 0) + d.armour
    };
    this.derived = d;
    // Injury Track: spaces of unhealed injuries + manual extra; Critical fills the track.
    const spaces = this.parent.items
      .filter(i => i.type === "injury" && !i.system.healed)
      .reduce((s, i) => s + i.system.spaces, 0);
    this.injuries.spaces = spaces;
    this.modifiers = {
      pool: cond.pool + (this.bonuses.pool ?? 0),
      dnMods: [...cond.dnMods, ...inj.dnMods],
      speedSteps: inj.speed,
      actsLast: inj.actsLast,
      statuses
    };
    return d;
  }
}
