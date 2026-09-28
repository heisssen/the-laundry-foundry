/**
 * Team HQ sheet: roster & skills matrix, mission (briefing, objectives, KPIs, budget),
 * shared stash, intel (contacts, evidence board, allies, rumours) and the log.
 */
import { SYSTEM_ID, SYSTEM_PATH } from "../config.mjs";
import { getLuckState, Luck } from "../helpers/luck.mjs";
import { KPI_REWARDS } from "../rules/xp.mjs";
import { SKILLS, SKILL_DEFAULT_ATTRIBUTE } from "../rules/derived.mjs";

const { HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;
const TextEditor = foundry.applications.ux.TextEditor.implementation;

const ATTITUDES = ["hostile", "unfriendly", "neutral", "friendly", "ally"];
const ROW_DEFAULTS = {
  objectives: { text: "", done: false, secret: false },
  clues: { text: "", found: false, uuid: "" },
  contacts: { uuid: "", name: "", img: "icons/svg/mystery-man.svg", attitude: "neutral", note: "" },
  requisitions: { item: "", dn: "4:1", by: "", status: "pending", note: "" }
};

export class TeamSheet extends HandlebarsApplicationMixin(ActorSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: ["laundry", "sheet", "actor", "team"],
    position: { width: 780, height: 840 },
    window: { resizable: true },
    form: { submitOnChange: true },
    actions: {
      openMember: TeamSheet.#openMember,
      removeMember: TeamSheet.#removeMember,
      luck: TeamSheet.#luck,
      threat: TeamSheet.#threat,
      kpi: TeamSheet.#kpi,
      addRow: TeamSheet.#addRow,
      removeRow: TeamSheet.#removeRow,
      toggleRow: TeamSheet.#toggleRow,
      openLink: TeamSheet.#openLink,
      rollRequisition: TeamSheet.#rollRequisition,
      giveItem: TeamSheet.#giveItem,
      editItem: TeamSheet.#editItem,
      deleteItem: TeamSheet.#deleteItem,
      chatItem: TeamSheet.#chatItem,
      newMission: TeamSheet.#newMission
    }
  };

  static PARTS = {
    header: { template: `${SYSTEM_PATH}/templates/actor/team-header.hbs` },
    tabs: { template: "templates/generic/tab-navigation.hbs" },
    roster: { template: `${SYSTEM_PATH}/templates/actor/team-roster.hbs`, scrollable: [""] },
    mission: { template: `${SYSTEM_PATH}/templates/actor/team-mission.hbs`, scrollable: [""] },
    stash: { template: `${SYSTEM_PATH}/templates/actor/team-stash.hbs`, scrollable: [""] },
    intel: { template: `${SYSTEM_PATH}/templates/actor/team-intel.hbs`, scrollable: [""] },
    log: { template: `${SYSTEM_PATH}/templates/actor/team-log.hbs`, scrollable: [""] }
  };

  static TABS = {
    primary: {
      tabs: [
        { id: "roster", icon: "fa-solid fa-users" },
        { id: "mission", icon: "fa-solid fa-bullseye" },
        { id: "stash", icon: "fa-solid fa-box-archive" },
        { id: "intel", icon: "fa-solid fa-magnifying-glass" },
        { id: "log", icon: "fa-solid fa-book" }
      ],
      initial: "roster",
      labelPrefix: "LAUNDRY.Team.Tab"
    }
  };

  async _prepareContext(options) {
    const ctx = await super._prepareContext(options);
    const sys = this.actor.system;
    const luck = getLuckState();
    const isGM = game.user.isGM;
    const members = sys.memberActors;
    const enrich = h => TextEditor.enrichHTML(h ?? "", { relativeTo: this.actor, secrets: this.actor.isOwner });

    // Who's best at what: dice pool (default Attribute + Training), then Focus.
    const skillMatrix = SKILLS.map(k => {
      const rows = members.map(a => {
        const sk = a.system.getSkill?.(k) ?? { training: 0, focus: 0 };
        const attr = a.system.getAttribute?.(SKILL_DEFAULT_ATTRIBUTE[k] ?? "mind") ?? 0;
        return { name: a.name, pool: attr + sk.training, training: sk.training, focus: sk.focus };
      }).sort((x, y) => (y.pool - x.pool) || (y.focus - x.focus));
      return { key: k, label: `LAUNDRY.Skill.${k}`, best: rows[0] ?? null, trained: rows.filter(r => r.training > 0).length };
    });

    const stash = this.actor.items.contents
      .sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name))
      .map(i => ({ id: i.id, name: i.name, img: i.img, type: game.i18n.localize(`TYPES.Item.${i.type}`), qty: i.system.quantity ?? null }));
    const issued = members.flatMap(a => a.items.filter(i => i.getFlag(SYSTEM_ID, "requisitioned"))
      .map(i => ({ member: a.name, name: i.name, img: i.img })));
    const visible = o => isGM || !o.secret;

    Object.assign(ctx, {
      actor: this.actor, system: sys, isGM, editable: this.isEditable,
      luck,
      luckPips: Array.from({ length: luck.luckMax }, (_, i) => ({ filled: i < luck.luck })),
      threatPips: Array.from({ length: 10 }, (_, i) => ({ n: i + 1, filled: i < luck.threat })),
      members: members.map(a => {
        const s = a.system;
        const t = s.toughness ?? { value: 0, max: 0 };
        return {
          uuid: a.uuid, name: a.name, img: a.img,
          assignment: s.details?.assignment ?? "",
          toughness: t, toughnessPct: t.max ? Math.round((t.value / t.max) * 100) : 0,
          adrenaline: s.adrenaline ?? { value: 0, max: 0 },
          injuryPips: Array.from({ length: s.injuries?.max ?? 0 }, (_, i) => ({ filled: i < (s.injuries?.filled ?? 0) })),
          kStage: s.kSyndrome?.fails ?? 0,
          critical: s.injuries?.critical, dead: a.statuses.has("dead"),
          conditions: [...a.statuses].filter(st => st !== "dead")
            .map(st => CONFIG.statusEffects.find(e => e.id === st)).filter(Boolean)
            .map(e => ({ img: e.img, name: game.i18n.localize(e.name) })),
          xp: s.xp?.available ?? 0
        };
      }),
      skillMatrix,
      objectives: sys.objectives.map((o, i) => ({ ...o, index: i })).filter(visible),
      objectivesDone: sys.objectives.filter(o => o.done && visible(o)).length,
      objectivesTotal: sys.objectives.filter(visible).length,
      contacts: sys.contacts.map((c, i) => ({ ...c, index: i })),
      attitudes: Object.fromEntries(ATTITUDES.map(k => [k, `LAUNDRY.Team.Attitude.${k}`])),
      clues: sys.clues.map((c, i) => ({ ...c, index: i })),
      cluesFound: sys.clues.filter(c => c.found).length,
      requisitions: sys.requisitions.map((r, i) => ({ ...r, index: i, statusLabel: `LAUNDRY.Team.ReqStatus.${r.status}` })),
      stash, issued,
      budgetLeft: (sys.mission.budget ?? 0) - (sys.mission.spent ?? 0),
      enriched: {
        briefing: await enrich(sys.briefing), allies: await enrich(sys.allies),
        rumours: await enrich(sys.rumours), notes: await enrich(sys.notes)
      },
      tabs: this._prepareTabs("primary")
    });
    return ctx;
  }

  async _preparePartContext(partId, ctx) {
    ctx = await super._preparePartContext(partId, ctx);
    if (ctx.tabs?.[partId]) ctx.tab = ctx.tabs[partId];
    return ctx;
  }

  _onRender(ctx, opts) {
    super._onRender(ctx, opts);
    this._luckHook ??= Hooks.on("laundryLuckThreatChanged", () => this.render());
    // Array rows edited in place (objectives, contacts, clues, requisitions) — not part of the form.
    this.element.querySelectorAll("[data-array][data-key]:not(a)").forEach(el => el.addEventListener("change", ev => {
      ev.stopPropagation();
      const { array, index, key } = el.dataset;
      const rows = foundry.utils.deepClone(this.actor.system[array]);
      if (!rows[Number(index)]) return;
      rows[Number(index)][key] = el.type === "checkbox" ? el.checked : el.value;
      this.actor.update({ [`system.${array}`]: rows });
    }));
  }

  async close(o) {
    if (this._luckHook) Hooks.off("laundryLuckThreatChanged", this._luckHook);
    this._luckHook = null;
    return super.close(o);
  }

  /* ---------------- drops ---------------- */

  async _onDropActor(event, actor) {
    if (!this.isEditable) return null;
    if (actor.type === "character") {
      const members = new Set(this.actor.system.members);
      members.add(actor.uuid);
      return this.actor.update({ "system.members": [...members] });
    }
    if (actor.type === "npc") {
      if (this.actor.system.contacts.some(c => c.uuid === actor.uuid)) return null;
      const row = { ...ROW_DEFAULTS.contacts, uuid: actor.uuid, name: actor.name, img: actor.img };
      return this.actor.update({ "system.contacts": [...this.actor.system.contacts, row] });
    }
    return null;
  }

  /** Items dropped from a member's sheet move into the stash (not copied). */
  async _onDropItem(event, item) {
    if (!this.isEditable || item.parent?.uuid === this.actor.uuid) return null;
    const data = item.toObject();
    delete data._id;
    const [created] = await this.actor.createEmbeddedDocuments("Item", [data]);
    if (item.parent?.documentName === "Actor" && item.parent.isOwner) await item.delete();
    return created;
  }

  /** Journal entries / pages dropped anywhere become clues on the evidence board. */
  async _onDrop(event) {
    const data = TextEditor.getDragEventData(event);
    if (["JournalEntry", "JournalEntryPage"].includes(data?.type) && this.isEditable) {
      const doc = await fromUuid(data.uuid);
      if (!doc) return;
      const row = { ...ROW_DEFAULTS.clues, text: doc.name, uuid: doc.uuid };
      return this.actor.update({ "system.clues": [...this.actor.system.clues, row] });
    }
    return super._onDrop(event);
  }

  /* ---------------- actions ---------------- */

  static async #openMember(e, t) { (await fromUuid(t.dataset.uuid))?.sheet.render({ force: true }); }
  static #removeMember(e, t) {
    return this.actor.update({ "system.members": this.actor.system.members.filter(u => u !== t.dataset.uuid) });
  }
  static #luck(e, t) {
    const d = t.dataset.delta;
    if (d === "refill") return Luck.refill();
    if (d === "max") return Luck.increaseMax();
    return Luck.adjustLuck(Number(d));
  }
  static #threat(e, t) {
    if (t.dataset.delta === "reset") return Luck.resetThreat();
    return Luck.adjustThreat(Number(t.dataset.delta));
  }

  /** Complete a KPI: XP to each member, Luck recovery. OH p.29 */
  static async #kpi(e, t) {
    const kind = t.dataset.kind;
    const reward = KPI_REWARDS[kind];
    const sys = this.actor.system;
    if (!sys.kpi[kind]) return;
    for (const a of sys.memberActors) await a.update({ "system.xp.total": a.system.xp.total + reward.xp });
    if (reward.luck === "all") await Luck.refill("LAUNDRY.LuckThreat.KPILong");
    else await Luck.adjustLuck(reward.luck, "LAUNDRY.LuckThreat.KPIShort");
    const history = [...sys.kpi.history, { kind, text: sys.kpi[kind], date: new Date().toISOString().slice(0, 10) }];
    await this.actor.update({ [`system.kpi.${kind}`]: "", [`system.kpi.${kind}Done`]: false, "system.kpi.history": history });
    await ChatMessage.create({
      content: `<div class="laundry-note kpi"><i class="fa-solid fa-trophy"></i> ${game.i18n.format(`LAUNDRY.Team.KPIComplete.${kind}`, { text: history.at(-1).text, xp: reward.xp })}</div>`
    });
  }

  static #addRow(e, t) {
    const a = t.dataset.array;
    const row = { ...ROW_DEFAULTS[a] };
    if (a === "objectives" && e.shiftKey) row.secret = true;
    return this.actor.update({ [`system.${a}`]: [...this.actor.system[a], row] });
  }
  static #removeRow(e, t) {
    const a = t.dataset.array, idx = Number(t.dataset.index);
    return this.actor.update({ [`system.${a}`]: this.actor.system[a].filter((_, i) => i !== idx) });
  }
  static #toggleRow(e, t) {
    const { array, index, key } = t.dataset;
    const rows = foundry.utils.deepClone(this.actor.system[array]);
    rows[Number(index)][key] = !rows[Number(index)][key];
    return this.actor.update({ [`system.${array}`]: rows });
  }
  static async #openLink(e, t) {
    const doc = await fromUuid(t.dataset.uuid);
    if (!doc) return;
    if (doc.documentName === "JournalEntryPage") return doc.parent.sheet.render({ force: true, pageId: doc.id });
    return doc.sheet.render({ force: true });
  }

  static async #rollRequisition(e, t) {
    const idx = Number(t.dataset.index);
    const r = this.actor.system.requisitions[idx];
    const actor = canvas.tokens?.controlled[0]?.actor ?? game.user.character;
    if (!actor) return ui.notifications.warn("LAUNDRY.Notify.NoCharacter", { localize: true });
    const m = String(r.dn).match(/(\d)\s*:\s*(\d+)/);
    const msg = await actor.rollTest({
      kind: "requisition", label: game.i18n.format("LAUNDRY.Requisition.Test", { item: r.item }), attribute: "mind",
      skill: e.altKey ? "presence" : "bureaucracy", dn: m ? Number(m[1]) : 4, complexity: m ? Number(m[2]) : 1
    });
    if (!msg) return;
    const passed = msg.getFlag(SYSTEM_ID, "test").evaluation.passed;
    const reqs = foundry.utils.deepClone(this.actor.system.requisitions);
    reqs[idx].status = passed ? "approved" : "denied";
    reqs[idx].by = actor.name;
    return this.actor.update({ "system.requisitions": reqs });
  }

  /** Hand a stash item to a member (moves it). */
  static async #giveItem(e, t) {
    const item = this.actor.items.get(t.closest("[data-item-id]").dataset.itemId);
    const members = this.actor.system.memberActors;
    if (!item) return;
    if (!members.length) return ui.notifications.warn("LAUNDRY.Team.NoMembers", { localize: true });
    const options = members.map(a => `<option value="${a.uuid}">${foundry.utils.escapeHTML(a.name)}</option>`).join("");
    const uuid = await DialogV2.prompt({
      window: { title: game.i18n.format("LAUNDRY.Team.GiveTitle", { item: item.name }), icon: "fa-solid fa-hand-holding" },
      classes: ["laundry", "laundry-dialog"],
      content: `<div class="form-group"><label>${game.i18n.localize("LAUNDRY.Team.GiveTo")}</label><select name="to">${options}</select></div>`,
      ok: { label: "LAUNDRY.Team.Give", callback: (ev, b) => b.form.elements.to.value }, rejectClose: false
    });
    const target = uuid ? await fromUuid(uuid) : null;
    if (!target) return;
    const data = item.toObject();
    delete data._id;
    await target.createEmbeddedDocuments("Item", [data]);
    await item.delete();
    ui.notifications.info(game.i18n.format("LAUNDRY.Team.Given", { item: item.name, name: target.name }));
  }
  static #itemOf(t) { return this.actor.items.get(t.closest("[data-item-id]").dataset.itemId); }
  static #editItem(e, t) { TeamSheet.#itemOf.call(this, t)?.sheet.render({ force: true }); }
  static #deleteItem(e, t) { return TeamSheet.#itemOf.call(this, t)?.deleteDialog(); }
  static #chatItem(e, t) { return TeamSheet.#itemOf.call(this, t)?.toChat?.(); }

  /** New mission: reset once-per-mission resources, objectives, clues and spending. */
  static async #newMission() {
    const ok = await DialogV2.confirm({
      window: { title: "LAUNDRY.Team.NewMission" }, content: `<p>${game.i18n.localize("LAUNDRY.Team.NewMissionHint")}</p>`
    });
    if (!ok) return;
    const { GMToolkit } = await import("../workflows/gm-tools.mjs");
    await GMToolkit.newMission();
    return this.actor.update({ "system.objectives": [], "system.clues": [], "system.mission.spent": 0 });
  }
}
