/**
 * Inline Test links for journals and chat:
 *
 *   @Test[mind.awareness 4:1]            → "DN 4:1 Mind (Awareness)"
 *   @Test[body 5:2]{Force the door}      → custom label, no skill
 *
 * Click: roll it for your selected token (or assigned character).
 * GM Shift-click: post a request card so the players roll.
 */
import { SYSTEM_ID } from "../config.mjs";

const PATTERN = /@Test\[(body|mind|spirit)(?:\.([a-zA-Z]+))?\s+(\d)\s*:\s*(\d+)\](?:\{([^}]+)\})?/g;

export function registerEnrichers() {
  CONFIG.TextEditor.enrichers.push({ pattern: PATTERN, enricher: enrichTest });
  document.body.addEventListener("click", onClick);
}

function enrichTest(match) {
  const [, attribute, skill, dn, complexity, label] = match;
  const L = k => game.i18n.localize(k);
  const test = `${L(`LAUNDRY.Attribute.${attribute}`)}${skill ? ` (${L(`LAUNDRY.Skill.${skill}`)})` : ""}`;
  const a = document.createElement("a");
  a.classList.add("laundry-inline-test");
  Object.assign(a.dataset, { attribute, skill: skill ?? "", dn, complexity, label: label ?? "" });
  a.dataset.tooltip = game.i18n.localize("LAUNDRY.Test.InlineHint");
  a.innerHTML = `<i class="fa-solid fa-dice-d6"></i> ${label ? `${foundry.utils.escapeHTML(label)} · ` : ""}<strong>DN ${dn}:${complexity}</strong> ${test}`;
  return a;
}

async function onClick(event) {
  const a = event.target.closest?.("a.laundry-inline-test");
  if (!a) return;
  event.preventDefault();
  event.stopPropagation();
  const { attribute, skill, label } = a.dataset;
  const dn = Number(a.dataset.dn), complexity = Number(a.dataset.complexity);
  if (game.user.isGM && event.shiftKey) {
    const { requestTest } = await import("../workflows/gm-tools.mjs");
    return requestTest({ attribute, skill: skill || null, dn, complexity, label });
  }
  const actor = canvas?.tokens?.controlled[0]?.actor ?? game.user.character;
  if (!actor) return ui.notifications.warn("LAUNDRY.Notify.NoCharacter", { localize: true });
  return actor.rollTest({ attribute, skill: skill || undefined, dn, complexity, ...(label ? { label } : {}) });
}

export { SYSTEM_ID };
