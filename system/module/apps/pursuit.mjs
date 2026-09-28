/**
 * Pursuit Tracker (OH p.116). Shared state lives in a world setting written by the GM; players roll
 * their own participant's DN 4:1 Test from the tracker and the result is recorded via the GM socket.
 */
import { SYSTEM_ID, SYSTEM_PATH } from "../config.mjs";
import { resolvePursuitRound } from "../rules/tests.mjs";
import { asGM, registerGMHandler } from "../helpers/socket.mjs";

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;
const KEY = "pursuit";
const EMPTY = { active: false, name: "", distance: 4, round: 1, status: "ongoing", participants: [], log: [] };

/** Skill presets: on foot, driving, riding, sneaking away. */
const APPROACHES = {
  foot: { attribute: "body", skill: "athletics", icon: "fa-person-running" },
  drive: { attribute: "body", skill: "reflexes", icon: "fa-car-side" },
  stealth: { attribute: "body", skill: "stealth", icon: "fa-user-secret" },
  wits: { attribute: "mind", skill: "survival", icon: "fa-map" }
};

export function registerPursuit() {
  game.settings.register(SYSTEM_ID, KEY, {
    scope: "world", config: false, type: Object, default: EMPTY,
    onChange: () => PursuitTracker.instance?.render()
  });
  registerGMHandler("pursuit.record", async ({ pid, successes, messageId }) => {
    const s = foundry.utils.deepClone(getState());
    const p = s.participants.find(x => x.id === pid);
    if (!p) return;
    Object.assign(p, { successes, messageId });
    await setState(s);
  });
  // Luck rerolls / Focus edits change a recorded Test: keep the tracker in sync.
  Hooks.on("updateChatMessage", msg => {
    if (!game.user.isGM) return;
    const s = getState();
    const p = s.active && s.participants.find(x => x.messageId === msg.id);
    const ev = msg.getFlag(SYSTEM_ID, "test")?.evaluation;
    if (p && ev && ev.successes !== p.successes) asGM("pursuit.record", { pid: p.id, successes: ev.successes, messageId: msg.id });
  });
}

export const getState = () => foundry.utils.mergeObject(foundry.utils.deepClone(EMPTY), game.settings.get(SYSTEM_ID, KEY) ?? {});
const setState = s => game.settings.set(SYSTEM_ID, KEY, s);

export class PursuitTracker extends HandlebarsApplicationMixin(ApplicationV2) {
  static instance = null;

  static open() {
    this.instance ??= new this();
    return this.instance.render({ force: true });
  }

  static DEFAULT_OPTIONS = {
    id: "laundry-pursuit",
    classes: ["laundry", "laundry-dialog", "pursuit-tracker"],
    window: { title: "LAUNDRY.Pursuit.Title", icon: "fa-solid fa-person-running", resizable: true },
    position: { width: 640, height: "auto" },
    actions: {
      start: PursuitTracker.#start, end: PursuitTracker.#end, addSelected: PursuitTracker.#addSelected,
      remove: PursuitTracker.#remove, roll: PursuitTracker.#roll, resolve: PursuitTracker.#resolve,
      nudge: PursuitTracker.#nudge, swapSide: PursuitTracker.#swapSide, open: PursuitTracker.#openActor,
      callTests: PursuitTracker.#callTests
    }
  };

  static PARTS = { body: { template: `${SYSTEM_PATH}/templates/apps/pursuit.hbs` } };

  async _prepareContext() {
    const s = getState();
    const decorate = p => {
      const actor = fromUuidSync(p.uuid);
      return {
        ...p, img: actor?.img ?? "icons/svg/mystery-man.svg", canRoll: !!actor?.isOwner || game.user.isGM, rolled: p.successes !== null && p.successes !== undefined,
        approachIcon: APPROACHES[p.approach]?.icon ?? "fa-person-running",
        testLabel: `${game.i18n.localize(`LAUNDRY.Attribute.${p.attribute}`)} (${game.i18n.localize(`LAUNDRY.Skill.${p.skill}`)})`
      };
    };
    const parts = s.participants.map(decorate);
    const running = parts.filter(p => !p.caught);
    return {
      s, isGM: game.user.isGM,
      sides: [
        { side: "quarry", label: "LAUNDRY.Pursuit.Quarry", icon: "fa-person-running", list: parts.filter(p => p.side === "quarry") },
        { side: "pursuer", label: "LAUNDRY.Pursuit.Pursuers", icon: "fa-user-ninja", list: parts.filter(p => p.side === "pursuer") }
      ],
      track: Array.from({ length: 11 }, (_, n) => ({ n, current: n === s.distance, caughtZone: n === 0, escapeZone: n === 10 })),
      quarryLeft: (((s.distance + 0.5) / 11) * 100).toFixed(2),
      allRolled: running.length > 0 && running.every(p => p.rolled),
      approaches: Object.fromEntries(Object.keys(APPROACHES).map(k => [k, `LAUNDRY.Pursuit.Approach.${k}`])),
      log: [...s.log].reverse()
    };
  }

  _onRender(ctx, opts) {
    super._onRender(ctx, opts);
    if (!game.user.isGM) return;
    this.element.querySelectorAll("[data-field]").forEach(el => el.addEventListener("change", async () => {
      const s = foundry.utils.deepClone(getState());
      const { field, pid } = el.dataset;
      if (pid) {
        const p = s.participants.find(x => x.id === pid);
        if (field === "approach") Object.assign(p, { approach: el.value, ...APPROACHES[el.value] });
        else p[field] = el.type === "number" ? Number(el.value) : el.value;
      } else s[field] = el.type === "number" ? Math.max(0, Math.min(10, Number(el.value))) : el.value;
      await setState(s);
    }));
  }

  async close(o) { PursuitTracker.instance = null; return super.close(o); }

  /* ---------------- drops: actors / tokens onto a side ---------------- */
  async _onFirstRender(ctx, opts) {
    await super._onFirstRender?.(ctx, opts);
    this.element.addEventListener("drop", async ev => {
      if (!game.user.isGM) return;
      const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(ev);
      if (data?.type !== "Actor") return;
      const actor = await fromUuid(data.uuid);
      const side = ev.target.closest("[data-side]")?.dataset.side ?? "pursuer";
      if (actor) await PursuitTracker.#add([actor], side);
    });
  }

  static async #add(actors, side) {
    const s = foundry.utils.deepClone(getState());
    for (const a of actors) {
      if (s.participants.some(p => p.uuid === a.uuid)) continue;
      const approach = a.type === "vehicle" ? "drive" : "foot";
      s.participants.push({ id: foundry.utils.randomID(), uuid: a.uuid, name: a.name, side, approach, ...APPROACHES[approach], successes: null, messageId: null, caught: false });
    }
    await setState(s);
  }

  /* ---------------- actions ---------------- */
  static async #start() {
    const s = foundry.utils.deepClone(getState());
    Object.assign(s, { active: true, round: 1, status: "ongoing", log: [] });
    s.participants.forEach(p => Object.assign(p, { successes: null, messageId: null, caught: false }));
    await setState(s);
    await ChatMessage.create({ content: `<div class="laundry-card pursuit-note"><h3><i class="fa-solid fa-person-running"></i> ${game.i18n.localize("LAUNDRY.Pursuit.Started")}</h3><p>${foundry.utils.escapeHTML(s.name || "")} — ${game.i18n.format("LAUNDRY.Pursuit.DistanceN", { n: s.distance })}</p></div>` });
  }

  static async #end() {
    const ok = await DialogV2.confirm({ window: { title: "LAUNDRY.Pursuit.End" }, content: `<p>${game.i18n.localize("LAUNDRY.Pursuit.EndHint")}</p>` });
    if (ok) await setState(foundry.utils.deepClone(EMPTY));
  }

  static async #addSelected(e, t) {
    const actors = (canvas?.tokens?.controlled ?? []).map(tk => tk.actor).filter(Boolean);
    if (!actors.length) return ui.notifications.warn("LAUNDRY.Pursuit.SelectTokens", { localize: true });
    await PursuitTracker.#add(actors, t.dataset.side);
  }

  static async #remove(e, t) {
    const s = foundry.utils.deepClone(getState());
    s.participants = s.participants.filter(p => p.id !== t.closest("[data-pid]").dataset.pid);
    await setState(s);
  }

  static async #swapSide(e, t) {
    const s = foundry.utils.deepClone(getState());
    const p = s.participants.find(x => x.id === t.closest("[data-pid]").dataset.pid);
    p.side = p.side === "quarry" ? "pursuer" : "quarry";
    await setState(s);
  }

  static async #openActor(e, t) { (await fromUuid(t.closest("[data-pid]").dataset.uuid))?.sheet.render({ force: true }); }

  /** Roll this participant's DN 4:1 Test (vehicles roll with their driver). */
  static async #roll(e, t) {
    const pid = t.closest("[data-pid]").dataset.pid;
    const p = getState().participants.find(x => x.id === pid);
    let actor = await fromUuid(p.uuid);
    if (actor?.type === "vehicle") actor = actor.system.driver ? await fromUuid(actor.system.driver) : null;
    if (!actor) return ui.notifications.warn("LAUNDRY.Pursuit.NoDriver", { localize: true });
    const msg = await actor.rollTest({
      kind: "test", attribute: p.attribute, skill: p.skill, dn: 4, complexity: 1,
      label: game.i18n.format("LAUNDRY.Pursuit.TestLabel", { name: p.name })
    }, { event: e });
    const ev = msg?.getFlag(SYSTEM_ID, "test")?.evaluation;
    if (ev) await asGM("pursuit.record", { pid, successes: ev.successes, messageId: msg.id });
  }

  static async #callTests() {
    const s = getState();
    const names = s.participants.filter(p => !p.caught).map(p => `<li>${foundry.utils.escapeHTML(p.name)} — ${game.i18n.localize(`LAUNDRY.Attribute.${p.attribute}`)} (${game.i18n.localize(`LAUNDRY.Skill.${p.skill}`)})</li>`).join("");
    await ChatMessage.create({ content: `<div class="laundry-card pursuit-note"><h3><i class="fa-solid fa-person-running"></i> ${game.i18n.format("LAUNDRY.Pursuit.RoundN", { n: s.round })}</h3><p>${game.i18n.localize("LAUNDRY.Pursuit.CallHint")}</p><ul>${names}</ul></div>` });
  }

  static async #nudge(e, t) {
    const s = foundry.utils.deepClone(getState());
    s.distance = Math.max(0, Math.min(10, s.distance + Number(t.dataset.delta)));
    await setState(s);
  }

  static async #resolve() {
    const s = foundry.utils.deepClone(getState());
    const running = s.participants.filter(p => !p.caught);
    const q = running.filter(p => p.side === "quarry").map(p => ({ id: p.id, successes: p.successes ?? 0 }));
    const u = running.filter(p => p.side === "pursuer").map(p => ({ id: p.id, successes: p.successes ?? 0 }));
    if (!q.length || !u.length) return ui.notifications.warn("LAUNDRY.Pursuit.NeedBothSides", { localize: true });
    const before = s.distance;
    const r = resolvePursuitRound(s.distance, q, u);
    const nameOf = id => s.participants.find(p => p.id === id)?.name ?? "?";
    if (r.caught) s.participants.find(p => p.id === r.caught).caught = true;
    s.log.push({ round: s.round, before, after: r.distance, delta: r.delta, slowest: nameOf(r.slowest), fastest: nameOf(r.fastest), caught: r.caught ? nameOf(r.caught) : "" });
    Object.assign(s, { distance: r.distance, status: r.status, round: s.round + 1 });
    s.participants.forEach(p => Object.assign(p, { successes: null, messageId: null }));
    await setState(s);

    const L = (k, d) => game.i18n.format(k, d);
    let line = r.delta > 0 ? L("LAUNDRY.Pursuit.PullAway", { n: r.delta }) : r.delta < 0 ? L("LAUNDRY.Pursuit.CloseIn", { n: -r.delta }) : game.i18n.localize("LAUNDRY.Pursuit.NoChange");
    if (r.status === "escaped") line += ` <strong>${game.i18n.localize("LAUNDRY.Pursuit.Escaped")}</strong>`;
    else if (r.status === "caught") line += ` <strong>${L("LAUNDRY.Pursuit.Caught", { name: nameOf(r.caught) })}</strong>`;
    else if (r.caught) line += ` <strong>${L("LAUNDRY.Pursuit.Sacrificed", { name: nameOf(r.caught) })}</strong>`;
    const cells = Array.from({ length: 11 }, (_, n) => `<span class="${n === r.distance ? "current" : ""}">${n}</span>`).join("");
    await ChatMessage.create({ content: `<div class="laundry-card pursuit-note"><h3><i class="fa-solid fa-person-running"></i> ${L("LAUNDRY.Pursuit.RoundN", { n: s.round - 1 })}</h3><div class="pursuit-strip">${cells}</div><p>${foundry.utils.escapeHTML(nameOf(r.slowest))} vs ${foundry.utils.escapeHTML(nameOf(r.fastest))}: ${line}</p></div>` });
  }
}
