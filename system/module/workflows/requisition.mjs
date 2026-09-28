/**
 * Requisitioning Gear (OH p.122).
 *
 *  Mind (Bureaucracy) — paperwork, or Mind (Presence) — sweet-talking Q Division in person,
 *  against the item's listed DN. Approved: the item is issued (and must be returned at the
 *  end of the mission). Denied: the same item can't be requested again this mission.
 *  Red Tape / Status grant Advantage (talent modifiers with when: "requisition").
 */
import { SYSTEM_ID } from "../config.mjs";
import { parseDN } from "../data/fields.mjs";
import { getTestState } from "../dice/card.mjs";
import { updateTestMessage } from "../dice/test.mjs";

const DENIED = "requisitionDenied";

export function deniedThisMission(actor, name) {
  return (actor.getFlag(SYSTEM_ID, DENIED) ?? []).includes(name);
}

/**
 * Ask how to requisition an item (dropped from a compendium / the sidebar).
 * @returns {Promise<"bureaucracy"|"presence"|"issue"|null>}
 */
export async function chooseRequisition(actor, item) {
  const dn = item.system.requisition;
  const buttons = [
    { action: "bureaucracy", icon: "fa-solid fa-file-signature", label: "LAUNDRY.Requisition.Paperwork", default: true },
    { action: "presence", icon: "fa-solid fa-handshake", label: "LAUNDRY.Requisition.InPerson" }
  ];
  if (game.user.isGM) buttons.push({ action: "issue", icon: "fa-solid fa-box-open", label: "LAUNDRY.Requisition.IssueDirectly" });
  buttons.push({ action: "cancel", icon: "fa-solid fa-xmark", label: "Cancel" });
  const res = await foundry.applications.api.DialogV2.wait({
    window: { title: game.i18n.format("LAUNDRY.Requisition.Title", { item: item.name }), icon: "fa-solid fa-stamp" },
    classes: ["laundry", "laundry-dialog"],
    content: `<div class="requisition-prompt">
      <img src="${item.img}" alt="">
      <div><strong>${item.name}</strong><br><span class="dn">DN ${dn}</span>
      <p class="hint">${game.i18n.localize("LAUNDRY.Requisition.Hint")}</p></div></div>`,
    buttons, rejectClose: false
  });
  return res === "cancel" ? null : res;
}

/** Roll the requisition Test; the card gets an "Issue" button (so Luck rerolls still count). */
export async function requisition(actor, item, { skill = "bureaucracy", skipDialog = false } = {}) {
  const dn = parseDN(item.system.requisition);
  if (!dn) return ui.notifications.warn("LAUNDRY.Notify.NoRequisition", { localize: true });
  if (deniedThisMission(actor, item.name)) {
    return ui.notifications.warn(game.i18n.format("LAUNDRY.Requisition.AlreadyDenied", { item: item.name }));
  }
  const data = item.toObject();
  delete data._id;
  const message = await actor.rollTest({
    kind: "requisition",
    label: game.i18n.format("LAUNDRY.Requisition.Test", { item: item.name }),
    attribute: "mind", skill, lockSkill: true,
    dn: dn.dn, complexity: dn.complexity === "L" ? 1 : dn.complexity,
    requisition: { name: item.name, img: item.img, data, issued: false }
  }, { skipDialog });
  if (!message) return null;
  const state = getTestState(message);
  if (!state?.evaluation?.passed) await markDenied(actor, item.name, true);
  return message;
}

async function markDenied(actor, name, denied) {
  const list = new Set(actor.getFlag(SYSTEM_ID, DENIED) ?? []);
  if (denied) list.add(name); else list.delete(name);
  await actor.setFlag(SYSTEM_ID, DENIED, [...list]);
}

/** Card button: issue the approved item. */
export async function issueRequisition(message) {
  const state = foundry.utils.deepClone(getTestState(message));
  const r = state?.requisition;
  if (!r || r.issued || !state.evaluation.passed) return;
  const actor = await fromUuid(state.actorUuid);
  if (!actor) return;
  const data = foundry.utils.mergeObject(r.data, { flags: { [SYSTEM_ID]: { requisitioned: true } } }, { inplace: false });
  await actor.createEmbeddedDocuments("Item", [data]);
  await markDenied(actor, r.name, false); // a Luck reroll may have turned a denial around
  r.issued = true;
  await updateTestMessage(message, state);
}

/** Issue without a Test (GM). */
export async function issueDirectly(actor, item) {
  const data = item.toObject();
  delete data._id;
  foundry.utils.setProperty(data, `flags.${SYSTEM_ID}.requisitioned`, true);
  return actor.createEmbeddedDocuments("Item", [data]);
}

/** New mission: clear denials and remind everyone what has to go back to Internal Logistics. */
export async function resetRequisitions() {
  const lines = [];
  for (const a of game.actors.filter(a => a.type === "character")) {
    if (a.getFlag(SYSTEM_ID, DENIED)?.length) await a.unsetFlag(SYSTEM_ID, DENIED);
    const issued = a.items.filter(i => i.getFlag(SYSTEM_ID, "requisitioned"));
    if (issued.length) lines.push(`<li><strong>${a.name}</strong>: ${issued.map(i => i.name).join(", ")}</li>`);
  }
  if (lines.length) {
    await ChatMessage.create({
      content: `<div class="laundry-card memo"><h3><i class="fa-solid fa-boxes-packing"></i> ${game.i18n.localize("LAUNDRY.Requisition.ReturnTitle")}</h3><ul>${lines.join("")}</ul><p class="hint">${game.i18n.localize("LAUNDRY.Requisition.ReturnHint")}</p></div>`,
      whisper: game.users.filter(u => u.isGM).map(u => u.id)
    });
  }
}
