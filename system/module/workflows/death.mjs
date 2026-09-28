/**
 * Death Tests (OH p.114-115).
 */
import { performTest } from "../dice/test.mjs";
import { resolveDeathTest, deathTestImpossible } from "../rules/damage.mjs";

export async function deathTest(actor) {
  const inj = actor.system.injuries;
  if (!inj?.critical) return null;
  const pool = Math.max(actor.system.getAttribute("body"), actor.system.getAttribute("mind"), actor.system.getAttribute("spirit"));
  if (deathTestImpossible({ dn: inj.deathDN, complexity: inj.deathComplexity, pool })) {
    await actor.die({ reason: game.i18n.localize("LAUNDRY.Death.Impossible") });
    return null;
  }
  const message = await performTest(actor, {
    kind: "death",
    label: game.i18n.localize("LAUNDRY.Death.Test"),
    attribute: "highest",
    skill: "",
    dn: inj.deathDN,
    complexity: inj.deathComplexity,
    applyConditions: false,
    death: { dnBefore: inj.deathDN, complexity: inj.deathComplexity }
  });
  const state = message.getFlag("the-laundry", "test");
  await resolveDeathMessage(actor, message, state);
  return message;
}

/** Apply the result of a (possibly rerolled) Death Test. */
export async function resolveDeathMessage(actor, message, state) {
  const ev = state.evaluation;
  const out = resolveDeathTest({ dn: state.death.dnBefore, complexity: state.death.complexity, pool: state.pool, successes: ev.successes });
  if (state.death.resolved) return out;
  // Hard to Kill: the first failed Death Test in a combat does not raise the DN. OH p.73
  const htk = actor.items.some(i => i.system.identifier === "hardToKill");
  const combatId = game.combat?.id ?? "none";
  const failedRoll = out.status === "dying" || (out.status === "dead" && state.death.complexity <= state.pool);
  if (failedRoll && htk && actor.getFlag("the-laundry", "hardToKillCombat") !== combatId) {
    out.status = "dying";
    out.dn = state.death.dnBefore;
    await actor.setFlag("the-laundry", "hardToKillCombat", combatId);
  }
  state.death = { ...state.death, status: out.status, dnAfter: out.dn, resolved: true };
  const { updateTestMessage } = await import("../dice/test.mjs");
  await updateTestMessage(message, state);
  if (out.status === "stable") await actor.stabilise();
  else if (out.status === "dying") await actor.update({ "system.injuries.deathDN": out.dn });
  else await actor.die({ reason: game.i18n.localize("LAUNDRY.Death.Failed") });
  return out;
}
