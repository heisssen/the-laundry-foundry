/**
 * Shared schema helpers.
 */
import { SKILLS } from "../rules/derived.mjs";

const { fields } = foundry.data;

export const int = (initial = 0, opts = {}) =>
  new fields.NumberField({ required: true, nullable: false, integer: true, initial, ...opts });

export const str = (initial = "", opts = {}) =>
  new fields.StringField({ required: true, blank: true, initial, ...opts });

export const bool = (initial = false) => new fields.BooleanField({ initial });

export const html = () => new fields.HTMLField({ required: true, blank: true });

export const attributesField = (initial = 1) => new fields.SchemaField({
  body: new fields.SchemaField({ value: int(initial, { min: 0 }) }),
  mind: new fields.SchemaField({ value: int(initial, { min: 0 }) }),
  spirit: new fields.SchemaField({ value: int(initial, { min: 0 }) })
});

export const skillsField = () => new fields.SchemaField(Object.fromEntries(SKILLS.map(k => [k,
  new fields.SchemaField({
    training: int(0, { min: 0, max: 4 }),
    focus: int(0, { min: 0, max: 4 })
  })
])));

/** Flat modifiers that Active Effects can target: system.bonuses.<key> */
export const BONUS_KEYS = [
  "meleeStep", "accuracyStep", "defenceStep", "toughness", "injuries", "adrenaline",
  "initiative", "naturalAwareness", "armour", "damage", "pool"
];
export const bonusesField = () => new fields.SchemaField(Object.fromEntries(BONUS_KEYS.map(k => [k, int(0)])));

export const resourceField = (value = 0) => new fields.SchemaField({ value: int(value, { min: 0 }) });

/** "4:1" style requisition / DN strings. */
export const dnField = (initial = "") => str(initial);

export function parseDN(text) {
  const m = String(text ?? "").match(/(\d)\s*:\s*(\d+|L)/i);
  if (!m) return null;
  return { dn: Number(m[1]), complexity: m[2].toUpperCase() === "L" ? "L" : Number(m[2]) };
}
