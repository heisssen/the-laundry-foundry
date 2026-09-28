/**
 * Talent roll modifiers: collect the modifiers an actor's Talents offer for a
 * given Test context, and apply the selected ones to a Test configuration.
 *
 * Modifier value may be a number or a reference: "@skill.training",
 * "@skill.focus" or "@attribute" (e.g. "@fastTalk.training", "@mind").
 */

const TEST_KINDS = new Set(["test", "opposed", "presence", "kResist", "requisition"]);

/**
 * @param {object} mod
 * @param {object} ctx { kind, skill, attribute, weaponKind, charge, dualWield, unarmed }
 */
function matches(mod, ctx) {
  const w = mod.when || "test";
  const firstRound = !!game.combat?.started && game.combat.round <= 1;
  switch (w) {
    case "test": if (!TEST_KINDS.has(ctx.kind)) return false; break;
    case "attack": if (ctx.kind !== "attack") return false; break;
    case "melee": if (ctx.kind !== "attack" || ctx.weaponKind !== "melee") return false; break;
    case "ranged": if (ctx.kind !== "attack" || ctx.weaponKind !== "ranged") return false; break;
    case "charge": if (ctx.kind !== "attack" || !ctx.charge) return false; break;
    case "dualWield": if (ctx.kind !== "attack" || !ctx.dualWield) return false; break;
    case "unarmed": if (ctx.kind !== "attack" || !ctx.unarmed) return false; break;
    case "cast": if (ctx.kind !== "cast") return false; break;
    case "app": if (ctx.kind !== "app") return false; break;
    case "requisition": if (ctx.kind !== "requisition") return false; break;
    case "firstRound": if (!firstRound || ["death", "luck"].includes(ctx.kind)) return false; break;
    case "any": if (["death", "luck"].includes(ctx.kind)) return false; break;
    default: return false;
  }
  if (mod.skills?.length && !mod.skills.includes(ctx.skill)) return false;
  if (mod.attribute && mod.attribute !== ctx.attribute) return false;
  return true;
}

export function resolveValue(actor, value) {
  const v = String(value ?? "0").trim();
  if (!v.startsWith("@")) return Number(v) || 0;
  const [key, prop] = v.slice(1).split(".");
  const sys = actor?.system;
  if (!sys) return 0;
  if (["body", "mind", "spirit"].includes(key)) return sys.getAttribute(key);
  return Number(sys.getSkill?.(key)?.[prop ?? "training"] ?? 0);
}

/**
 * All modifiers applicable to a context.
 * @returns {Array<{id, source, label, type, value, auto}>}
 */
export function collectMods(actor, ctx) {
  if (!actor) return [];
  const out = [];
  for (const item of actor.items) {
    if (item.type !== "talent") continue;
    (item.system.modifiers ?? []).forEach((m, i) => {
      if (!matches(m, ctx)) return;
      out.push({
        id: `${item.id}.${i}`,
        source: item.name,
        label: m.label || item.name,
        type: m.type,
        value: resolveValue(actor, m.value),
        raw: m.value,
        auto: m.auto
      });
    });
  }
  return out;
}

/**
 * Fold chosen modifiers into a summary.
 * @param {Array} mods   from collectMods
 * @param {Set<string>|string[]} selected ids of non-auto mods the user ticked
 */
export function summarise(mods, selected = []) {
  const sel = new Set(selected);
  const s = { advantage: 0, doubleTraining: false, doubleFocus: false, bonusDice: 0, complexity: 0, attackStep: 0, damage: 0, traits: [], applied: [] };
  for (const m of mods) {
    if (!m.auto && !sel.has(m.id)) continue;
    s.applied.push(m.label);
    switch (m.type) {
      case "advantage": s.advantage += m.value || 1; break;
      case "doubleTraining": s.doubleTraining = true; break;
      case "doubleFocus": s.doubleFocus = true; break;
      case "bonusDice": s.bonusDice += m.value; break;
      case "complexity": s.complexity += m.value; break;
      case "attackStep": s.attackStep += m.value; break;
      case "damage": s.damage += m.value; break;
      case "trait": s.traits.push(String(m.raw)); break;
    }
  }
  return s;
}

/** Talent identifiers the actor has. */
export function hasTalent(actor, identifier) {
  return !!actor?.items?.some(i => i.type === "talent" && i.system.identifier === identifier);
}

export function talentRank(actor, identifier) {
  return actor?.items?.filter(i => i.type === "talent" && i.system.identifier === identifier).length ?? 0;
}
