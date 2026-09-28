/**
 * GM tools: request Tests, Opposed Tests, Group / Extended Tests, Luck Tests, Pursuits.
 */
import { SYSTEM_ID, SYSTEM_PATH } from "../config.mjs";
import { performTest, updateTestMessage } from "../dice/test.mjs";
import { getTestState } from "../dice/card.mjs";
import { resolveOpposed, progressExtended, luckTestParams, pursuitStep } from "../rules/tests.mjs";
import { getLuckState } from "../helpers/luck.mjs";
import { SKILL_DEFAULT_ATTRIBUTE } from "../rules/derived.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

function pickActor() {
  return canvas.tokens?.controlled[0]?.actor ?? game.user.character ?? null;
}

/** Post a "Test requested" card that players click to roll. */
export async function requestTest({ attribute, skill, dn = 4, complexity = 1, label = "", group = false, required = 0 }) {
  const content = await foundry.applications.handlebars.renderTemplate(`${SYSTEM_PATH}/templates/chat/request-card.hbs`, {
    attribute, skill, dn, complexity, label, group, required,
    attributeLabel: `LAUNDRY.Attribute.${attribute}`,
    skillLabel: skill ? `LAUNDRY.Skill.${skill}` : null
  });
  const flags = { [SYSTEM_ID]: { table: { kind: group ? "group" : "request", attribute, skill, dn, complexity, label } } };
  if (group) flags[SYSTEM_ID].group = { required, attempts: [], total: 0, status: "ongoing" };
  return ChatMessage.create({ content, flags });
}

export async function answerRequest(message) {
  const req = message.getFlag(SYSTEM_ID, "table");
  const actor = pickActor();
  if (!actor) return ui.notifications.warn("LAUNDRY.Notify.NoCharacter", { localize: true });
  return actor.rollTest({
    attribute: req.attribute, skill: req.skill, dn: req.dn, complexity: req.complexity,
    label: req.label || `${game.i18n.localize(`LAUNDRY.Attribute.${req.attribute}`)}${req.skill ? ` (${game.i18n.localize(`LAUNDRY.Skill.${req.skill}`)})` : ""}`
  });
}

/** Group Test: each participant rolls; successes are pooled. OH p.93 */
export async function contributeGroup(message) {
  const req = message.getFlag(SYSTEM_ID, "table");
  const actor = pickActor();
  if (!actor) return ui.notifications.warn("LAUNDRY.Notify.NoCharacter", { localize: true });
  const m = await actor.rollTest({
    attribute: req.attribute, skill: req.skill, dn: req.dn, complexity: 1,
    label: `${game.i18n.localize("LAUNDRY.GM.GroupTest")}: ${req.label}`
  });
  if (!m) return;
  const st = getTestState(m);
  const group = message.getFlag(SYSTEM_ID, "group");
  const next = progressExtended({ required: group.required, attempts: group.attempts }, st.evaluation.successes, actor.name);
  const { asGM } = await import("../helpers/socket.mjs");
  const content = await foundry.applications.handlebars.renderTemplate(`${SYSTEM_PATH}/templates/chat/request-card.hbs`, {
    ...req, group: true, required: group.required, progress: next,
    attributeLabel: `LAUNDRY.Attribute.${req.attribute}`, skillLabel: req.skill ? `LAUNDRY.Skill.${req.skill}` : null
  });
  const update = { content, [`flags.${SYSTEM_ID}.group`]: { required: group.required, attempts: next.attempts, total: next.total, status: next.status } };
  if (message.isOwner) await message.update(update);
  else await asGM("updateMessage", { id: message.id, update });
}

/** Opposed Test: first roll creates the card, a second actor responds. OH p.92 */
export async function startOpposed(actor, cfg) {
  const m = await performTest(actor, { ...cfg, kind: "opposed", opposed: { status: "waiting", label: cfg.label } });
  return m;
}

export async function respondOpposed(message) {
  const state = getTestState(message);
  const actor = pickActor();
  if (!actor) return ui.notifications.warn("LAUNDRY.Notify.NoCharacter", { localize: true });
  const cfg = await (await import("../apps/test-dialog.mjs")).TestDialog.wait(actor, {
    kind: "test", attribute: "mind", skill: "awareness", dn: 4, complexity: 1,
    label: game.i18n.localize("LAUNDRY.GM.OpposedResponse")
  });
  if (!cfg) return;
  const resp = await performTest(actor, cfg, { chat: false });
  const winner = resolveOpposed(
    { successes: state.evaluation.successes, pool: state.pool },
    { successes: resp.evaluation.successes, pool: resp.pool }
  );
  state.opposed = {
    ...state.opposed,
    status: "resolved",
    responder: actor.name,
    responderSuccesses: resp.evaluation.successes,
    responderPool: resp.pool,
    responderValues: resp.evaluation.values,
    responderDN: resp.dn,
    winner
  };
  // Ruthless: the winner adds 1 success per Training in Resolve to the margin. OH p.80
  const initiator = state.actorUuid ? await fromUuid(state.actorUuid) : null;
  const winActor = winner === "a" ? initiator : (winner === "b" ? actor : null);
  if (winActor?.items.some(i => i.system.identifier === "ruthless")) {
    const bonus = winActor.system.getSkill("resolve")?.training ?? 0;
    const margin = Math.abs(state.evaluation.successes - resp.evaluation.successes) + bonus;
    state.opposed.ruthless = { name: winActor.name, bonus, margin };
  }
  await updateTestMessage(message, state);
}

/** Luck Test: DN 4:1 using remaining team Luck. OH p.94 */
export async function luckTest(actor = null) {
  const { luck } = getLuckState();
  const p = luckTestParams(luck);
  return performTest(actor ?? pickActor(), {
    kind: "luck", label: game.i18n.localize("LAUNDRY.GM.LuckTest"),
    pool: p.pool, dn: p.dn, complexity: p.complexity, focus: 0, applyConditions: false
  });
}

/* ---------------------------------------------------------------- */
/*  GM Toolkit window                                                */
/* ---------------------------------------------------------------- */

export class GMToolkit extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "laundry-gm-toolkit",
    tag: "form",
    classes: ["laundry", "laundry-dialog", "gm-toolkit"],
    window: { title: "LAUNDRY.GM.Toolkit", icon: "fa-solid fa-briefcase", resizable: true },
    position: { width: 480 },
    form: { handler: GMToolkit.#onSubmit, submitOnChange: false, closeOnSubmit: false },
    actions: {
      request: GMToolkit.#request,
      group: GMToolkit.#group,
      luckTest: () => luckTest(),
      newMission: GMToolkit.#newMission,
      endAdventure: GMToolkit.#endAdventure,
      pursuit: GMToolkit.#pursuit,
      presence: GMToolkit.#presence
    }
  };

  static PARTS = { form: { template: `${SYSTEM_PATH}/templates/apps/gm-toolkit.hbs` } };

  tk = { attribute: "mind", skill: "awareness", dn: 4, complexity: 1, label: "", required: 6, pursuit: 4 };

  async _prepareContext() {
    return {
      state: this.tk,
      attributes: CONFIG.LAUNDRY.attributes,
      skills: { "": "LAUNDRY.Test.NoSkill", ...CONFIG.LAUNDRY.skills },
      dns: { 2: "2", 3: "3", 4: "4", 5: "5", 6: "6" },
      presence: CONFIG.LAUNDRY.presence
    };
  }

  #read() {
    const fd = new foundry.applications.ux.FormDataExtended(this.element).object;
    Object.assign(this.tk, {
      attribute: fd.attribute, skill: fd.skill, dn: Number(fd.dn), complexity: Math.max(1, Number(fd.complexity)),
      label: fd.label, required: Math.max(1, Number(fd.required)), pursuit: Number(fd.pursuit),
      presence: fd.presence, presenceCount: Number(fd.presenceCount || 1), presenceName: fd.presenceName
    });
    if (fd.skill && !fd.attribute) this.tk.attribute = SKILL_DEFAULT_ATTRIBUTE[fd.skill];
  }

  static async #onSubmit() { this.#read(); }
  static async #request() { this.#read(); return requestTest(this.tk); }
  static async #group() { this.#read(); return requestTest({ ...this.tk, group: true }); }

  /** New mission: reset once-per-mission resources (computational complication, Bodge Job …). */
  static async #newMission() { return GMToolkit.newMission(); }

  static async newMission() {
    for (const a of game.actors.filter(a => a.type === "character")) {
      await a.update({ "system.mission.complicationUsed": false, "system.mission.modderUsed": false });
      for (const t of a.items.filter(i => i.type === "talent" && i.system.activation.uses === "mission" && i.system.used)) {
        await t.update({ "system.used": false });
      }
    }
    await (await import("./requisition.mjs")).resetRequisitions();
    ui.notifications.info("LAUNDRY.GM.MissionReset", { localize: true });
  }

  static async #endAdventure() {
    const { Luck } = await import("../helpers/luck.mjs");
    await Luck.resetThreat();
  }

  static async #pursuit() {
    this.#read();
    const { PursuitTracker, getState } = await import("../apps/pursuit.mjs");
    if (!getState().active) {
      const st = foundry.utils.deepClone(getState());
      st.distance = this.tk.pursuit;
      await game.settings.set("the-laundry", "pursuit", st);
    }
    return PursuitTracker.open();
  }

  static async #presence() {
    this.#read();
    const { postPresenceCard } = await import("./combat.mjs");
    return postPresenceCard({ name: this.tk.presenceName || "?", presence: this.tk.presence || "frightening", count: this.tk.presenceCount || 1, uuid: null });
  }
}

const pursuitCells = d => Array.from({ length: 11 }, (_, n) => ({ n, current: n === d }));

/** Pursuit update from the card (GM enters both sides' successes). OH p.116 */
export async function updatePursuit(message, quarry, pursuer) {
  const p = message.getFlag(SYSTEM_ID, "pursuit");
  const r = pursuitStep(p.distance, quarry, pursuer);
  const log = [...p.log, { quarry, pursuer, distance: r.distance }];
  const content = await foundry.applications.handlebars.renderTemplate(`${SYSTEM_PATH}/templates/chat/pursuit-card.hbs`, { distance: r.distance, status: r.status, log, cells: pursuitCells(r.distance) });
  await message.update({ content, [`flags.${SYSTEM_ID}.pursuit`]: { distance: r.distance, log, status: r.status } });
}
