import { int, str, bool, html } from "./fields.mjs";

const { fields } = foundry.data;

export class TeamData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      members: new fields.ArrayField(new fields.DocumentUUIDField({ type: "Actor" })),
      lineManager: str(),
      kpi: new fields.SchemaField({
        short: str(), shortDone: bool(),
        long: str(), longDone: bool(),
        history: new fields.ArrayField(new fields.SchemaField({ kind: str(), text: str(), date: str() }))
      }),
      mission: new fields.SchemaField({
        name: str(), codename: str(), budget: int(0), spent: int(0), active: bool(false)
      }),
      requisitions: new fields.ArrayField(new fields.SchemaField({
        item: str(), dn: str(), by: str(), status: str("pending"), note: str()
      })),
      briefing: html(),
      objectives: new fields.ArrayField(new fields.SchemaField({
        text: str(), done: bool(), secret: bool()
      })),
      contacts: new fields.ArrayField(new fields.SchemaField({
        uuid: str(), name: str(), img: str(), attitude: str("neutral"), note: str()
      })),
      clues: new fields.ArrayField(new fields.SchemaField({
        text: str(), found: bool(), uuid: str()
      })),
      allies: html(),
      rumours: html(),
      notes: html()
    };
  }

  get memberActors() {
    return this.members.map(u => fromUuidSync(u)).filter(a => a);
  }
}

export class VehicleData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      size: str("large"),
      defence: int(1, { min: 0, max: 6 }),
      speed: str("fast"),
      armour: int(1, { min: 0 }),
      toughness: new fields.SchemaField({ value: int(8, { min: 0 }), max: int(8, { min: 0 }) }),
      faults: new fields.SchemaField({ value: int(0, { min: 0 }), max: int(4, { min: 0 }) }),
      faultList: new fields.ArrayField(new fields.SchemaField({ key: str(), note: str() })),
      driver: new fields.DocumentUUIDField({ type: "Actor", nullable: true }),
      passengers: int(4),                                   // seats besides the driver
      crew: new fields.ArrayField(new fields.DocumentUUIDField({ type: "Actor" })),
      cover: str("partial"),                                // cover for those aboard: none / partial / total
      overloaded: bool(false),
      description: html()
    };
  }

  prepareDerivedData() {
    const has = k => this.faultList.filter(f => f.key === k).length;
    const speeds = ["slow", "normal", "fast"];
    this.effective = {
      armour: Math.max(0, this.armour - has("bangedUp")),
      speed: speeds[Math.max(0, speeds.indexOf(this.speed) - has("damagedLocomotion"))] ?? this.speed,
      reflexesDN: (has("bustedSteering") ? 1 : 0) + (this.overloaded ? 1 : 0),
      wrecked: this.faults.value >= this.faults.max
    };
    this.combat = { defence: this.defence, armour: this.effective.armour };
  }
}

/** The vehicle a creature is aboard (crew or driver), if any. */
export function vehicleOf(actor) {
  if (!actor) return null;
  return game.actors.find(v => v.type === "vehicle" && (v.system.driver === actor.uuid || v.system.crew.includes(actor.uuid))) ?? null;
}
