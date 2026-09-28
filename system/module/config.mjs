/**
 * System configuration: CONFIG.LAUNDRY
 */
import { ATTRIBUTES, SKILLS, SKILL_DEFAULT_ATTRIBUTE } from "./rules/derived.mjs";
import { LADDER, } from "./rules/ladder.mjs";
import { WEAPON_TRAITS, RANGES } from "./rules/combat.mjs";
import { CONDITIONS } from "./rules/tables.mjs";

export const SYSTEM_ID = "the-laundry";
export const SYSTEM_PATH = `systems/${SYSTEM_ID}`;

const labels = (prefix, keys) => Object.fromEntries(keys.map(k => [k, `${prefix}.${k}`]));

export const LAUNDRY = {
  attributes: labels("LAUNDRY.Attribute", ATTRIBUTES),
  attributeAbbr: labels("LAUNDRY.AttributeAbbr", ATTRIBUTES),
  skills: labels("LAUNDRY.Skill", SKILLS),
  skillDefaults: SKILL_DEFAULT_ATTRIBUTE,
  ladder: labels("LAUNDRY.Ladder", LADDER),
  ladderKeys: LADDER,
  weaponTraits: labels("LAUNDRY.Trait", WEAPON_TRAITS),
  armourTraits: { subtle: "LAUNDRY.Trait.subtle", bulky: "LAUNDRY.Trait.bulky" },
  ranges: labels("LAUNDRY.Range", RANGES),
  weaponRanges: labels("LAUNDRY.Range", ["short", "medium", "long"]),
  speeds: labels("LAUNDRY.Speed", ["slow", "normal", "fast"]),
  sizes: labels("LAUNDRY.Size", ["tiny", "small", "medium", "large", "enormous", "monstrous"]),
  npcCategories: labels("LAUNDRY.NPCCategory", ["human", "exonome", "autonome", "hybrid"]),
  presence: labels("LAUNDRY.Presence", ["none", "frightening", "terrifying", "devastating"]),
  damageTypes: labels("LAUNDRY.DamageType", ["physical", "psychological"]),
  severities: labels("LAUNDRY.Severity", ["minor", "serious", "deadly"]),
  injuryKinds: labels("LAUNDRY.InjuryKind", ["physical", "psychological"]),
  castingMethods: labels("LAUNDRY.CastMethod", ["computational", "traditional", "mental"]),
  tech: labels("LAUNDRY.Tech", ["calculator", "smartphone", "laptop", "supercomputer"]),
  spellGroups: labels("LAUNDRY.SpellGroup", ["protection", "divination", "manipulation", "entity"]),
  gearCategories: labels("LAUNDRY.GearCategory", ["conventional", "advanced", "occult", "personal"]),
  talentCategories: labels("LAUNDRY.TalentCategory", ["talent", "trait"]),
  departments: labels("LAUNDRY.Department", [
    "auditing", "arcana", "fieldSupport", "humanResources", "internalLogistics",
    "internalSecurity", "legalAffairs", "records", "researchDevelopment", "other"
  ]),
  durationUnits: labels("LAUNDRY.TimeUnit", ["instant", "rounds", "minutes", "hours", "days", "permanent", "special"]),
  conditions: CONDITIONS
};

/** Status effects shown in the Token HUD (core Foundry icons). */
const STATUS_ICONS = {
  blinded: "icons/svg/blind.svg",
  charmed: "icons/svg/aura.svg",
  deafened: "icons/svg/deaf.svg",
  frightened: "icons/svg/terror.svg",
  terrified: "icons/svg/biohazard.svg",
  incapacitated: "icons/svg/paralysis.svg",
  prone: "icons/svg/falling.svg",
  restrained: "icons/svg/net.svg",
  stunned: "icons/svg/daze.svg",
  unconscious: "icons/svg/unconscious.svg",
  weakened: "icons/svg/degen.svg",
  critical: "icons/svg/blood.svg",
  hidden: "icons/svg/invisible.svg",
  dodging: "icons/svg/wingfoot.svg",
  charging: "icons/svg/thrust.svg",
  lastStand: "icons/svg/fire-shield.svg",
  dead: "icons/svg/skull.svg"
};

export const STATUS_EFFECTS = Object.entries(STATUS_ICONS).map(([id, img]) => ({
  id,
  name: `LAUNDRY.Condition.${id}`,
  img
}));
