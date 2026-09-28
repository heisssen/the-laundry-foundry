/**
 * Team, Vehicle and Item sheets.
 */
import { SYSTEM_PATH } from "../config.mjs";
import { SKILLS } from "../rules/derived.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2, ItemSheetV2 } = foundry.applications.sheets;
const TextEditor = foundry.applications.ux.TextEditor.implementation;

export { TeamSheet } from "./team-sheet.mjs";

/* ============================================================== */
/*  Vehicle                                                        */
/* ============================================================== */

export class VehicleSheet extends HandlebarsApplicationMixin(ActorSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: ["laundry", "sheet", "actor", "vehicle"],
    position: { width: 560, height: 620 },
    window: { resizable: true },
    form: { submitOnChange: true },
    actions: {
      repair: VehicleSheet.#repair,
      ram: VehicleSheet.#ram,
      removeFault: VehicleSheet.#removeFault,
      itemUse: VehicleSheet.#itemUse,
      setDriver: VehicleSheet.#setDriver,
      removeCrew: VehicleSheet.#removeCrew,
      openCrew: VehicleSheet.#openCrew,
      toPursuit: VehicleSheet.#toPursuit
    }
  };

  static PARTS = { body: { template: `${SYSTEM_PATH}/templates/actor/vehicle-sheet.hbs`, scrollable: [""] } };

  async _prepareContext(options) {
    const ctx = await super._prepareContext(options);
    const sys = this.actor.system;
    Object.assign(ctx, {
      actor: this.actor, system: sys, editable: this.isEditable, config: CONFIG.LAUNDRY,
      ladderOptions: Object.fromEntries(CONFIG.LAUNDRY.ladderKeys.map((k, i) => [i, `LAUNDRY.Ladder.${k}`])),
      faultTrack: Array.from({ length: sys.faults.max }, (_, i) => ({ filled: i < sys.faults.value })),
      faults: sys.faultList.map((f, i) => ({ ...f, index: i, name: `LAUNDRY.Fault.${f.key}.name`, effect: `LAUNDRY.Fault.${f.key}.effect` })),
      weapons: this.actor.items.filter(i => i.type === "weapon"),
      crew: [...new Set([sys.driver, ...sys.crew].filter(Boolean))].map(u => fromUuidSync(u)).filter(Boolean)
        .map(a => ({ uuid: a.uuid, name: a.name, img: a.img, driver: a.uuid === sys.driver })),
      seats: sys.passengers + 1,
      coverOptions: { none: "LAUNDRY.Zone.Cover.none", partial: "LAUNDRY.Zone.Cover.partial", total: "LAUNDRY.Zone.Cover.total" },
      eff: sys.effective,
      description: await TextEditor.enrichHTML(sys.description, { relativeTo: this.actor })
    });
    return ctx;
  }

  static async #repair() {
    const mech = canvas.tokens.controlled.find(t => t.actor?.type === "character")?.actor ?? game.user.character;
    if (!mech) return ui.notifications.warn("LAUNDRY.Notify.NoCharacter", { localize: true });
    const { repairVehicle } = await import("../workflows/vehicle.mjs");
    return repairVehicle(this.actor, mech);
  }

  static async #ram() {
    const driver = (this.actor.system.driver ? await fromUuid(this.actor.system.driver) : null)
      ?? canvas.tokens?.controlled.find(t => t.actor?.type !== "vehicle")?.actor ?? game.user.character;
    const target = [...game.user.targets][0]?.document;
    if (!driver || !target) return ui.notifications.warn("LAUNDRY.Notify.RamNeeds", { localize: true });
    const zones = Number(await foundry.applications.api.DialogV2.prompt({
      window: { title: "LAUNDRY.Vehicle.RamTitle" },
      content: `<div class="form-group"><label>${game.i18n.localize("LAUNDRY.Vehicle.ZonesMoved")}</label><input type="number" name="z" value="1" min="0"></div>`,
      ok: { callback: (e, b) => b.form.elements.z.value }, rejectClose: false
    }) ?? 1);
    const { ram } = await import("../workflows/vehicle.mjs");
    return ram(this.actor, driver, target, { zones });
  }

  async _onDropActor(event, actor) {
    if (!this.isEditable || actor.type === "vehicle") return null;
    const sys = this.actor.system;
    const crew = [...new Set([...sys.crew, actor.uuid])];
    const update = { "system.crew": crew };
    if (!sys.driver) update["system.driver"] = actor.uuid;
    update["system.overloaded"] = crew.length > sys.passengers + 1;
    return this.actor.update(update);
  }

  static #setDriver(e, t) { return this.actor.update({ "system.driver": t.closest("[data-uuid]").dataset.uuid }); }
  static #removeCrew(e, t) {
    const uuid = t.closest("[data-uuid]").dataset.uuid, sys = this.actor.system;
    const crew = sys.crew.filter(u => u !== uuid);
    return this.actor.update({ "system.crew": crew, "system.driver": sys.driver === uuid ? (crew[0] ?? null) : sys.driver, "system.overloaded": crew.length > sys.passengers + 1 });
  }
  static async #openCrew(e, t) { (await fromUuid(t.closest("[data-uuid]").dataset.uuid))?.sheet.render({ force: true }); }
  static async #toPursuit() {
    const { PursuitTracker, getState } = await import("./pursuit.mjs");
    const st = foundry.utils.deepClone(getState());
    if (!st.participants.some(p => p.uuid === this.actor.uuid)) {
      st.participants.push({ id: foundry.utils.randomID(), uuid: this.actor.uuid, name: this.actor.name, side: "quarry", approach: "drive", attribute: "body", skill: "reflexes", successes: null, messageId: null, caught: false });
      await game.settings.set("the-laundry", "pursuit", st);
    }
    return PursuitTracker.open();
  }

  static #removeFault(e, t) {
    const idx = Number(t.dataset.index);
    const list = this.actor.system.faultList.filter((_, i) => i !== idx);
    return this.actor.update({ "system.faultList": list, "system.faults.value": Math.max(0, this.actor.system.faults.value - 1) });
  }

  static #itemUse(e, t) {
    return this.actor.items.get(t.closest("[data-item-id]").dataset.itemId)?.toChat();
  }
}

/* ============================================================== */
/*  Items                                                          */
/* ============================================================== */

export class LaundryItemSheet extends HandlebarsApplicationMixin(ItemSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: ["laundry", "sheet", "item"],
    position: { width: 560, height: 640 },
    window: { resizable: true },
    form: { submitOnChange: true },
    actions: {
      toggleTrait: LaundryItemSheet.#toggleTrait,
      addRow: LaundryItemSheet.#addRow,
      removeRow: LaundryItemSheet.#removeRow,
      addListEntry: LaundryItemSheet.#addListEntry,
      removeListEntry: LaundryItemSheet.#removeListEntry,
      effectCreate: LaundryItemSheet.#effectCreate,
      effectEdit: LaundryItemSheet.#effectEdit,
      effectDelete: LaundryItemSheet.#effectDelete,
      use: LaundryItemSheet.#use
    }
  };

  static PARTS = {
    header: { template: `${SYSTEM_PATH}/templates/item/item-header.hbs` },
    tabs: { template: "templates/generic/tab-navigation.hbs" },
    details: { template: `${SYSTEM_PATH}/templates/item/item-details.hbs`, scrollable: [""] },
    description: { template: `${SYSTEM_PATH}/templates/item/item-description.hbs`, scrollable: [""] },
    effects: { template: `${SYSTEM_PATH}/templates/item/item-effects.hbs`, scrollable: [""] }
  };

  static TABS = {
    primary: {
      tabs: [{ id: "details" }, { id: "description" }, { id: "effects" }],
      initial: "details",
      labelPrefix: "LAUNDRY.Tab"
    }
  };

  async _prepareContext(options) {
    const ctx = await super._prepareContext(options);
    const item = this.item, sys = item.system;
    Object.assign(ctx, {
      item, system: sys, source: item._source.system, config: CONFIG.LAUNDRY, editable: this.isEditable,
      isType: Object.fromEntries(["talent", "weapon", "armour", "gear", "spell", "app", "assignment", "injury"].map(t => [t, item.type === t])),
      traitOptions: Object.entries(item.type === "armour" ? CONFIG.LAUNDRY.armourTraits : CONFIG.LAUNDRY.weaponTraits)
        .map(([k, label]) => ({ key: k, label, active: (sys.traits ?? []).includes(k) })),
      skillOptions: Object.fromEntries([["", "—"], ...SKILLS.map(k => [k, `LAUNDRY.Skill.${k}`])]),
      ladderOptions: Object.fromEntries(CONFIG.LAUNDRY.ladderKeys.map((k, i) => [i, `LAUNDRY.Ladder.${k}`])),
      dnOptions: { 2: "2", 3: "3", 4: "4", 5: "5", 6: "6" },
      enriched: {
        description: await TextEditor.enrichHTML(sys.description ?? "", { relativeTo: item, secrets: item.isOwner }),
        effect: sys.effect != null ? await TextEditor.enrichHTML(sys.effect, { relativeTo: item }) : ""
      },
      effects: item.effects.map(e => ({ id: e.id, name: e.name, img: e.img, disabled: e.disabled, changes: e.system?.changes ?? [] })),
      tabs: this._prepareTabs("primary"),
      activationTypes: { passive: "LAUNDRY.Activation.passive", action: "LAUNDRY.Activation.action", free: "LAUNDRY.Activation.free", reaction: "LAUNDRY.Activation.reaction" },
      usesOptions: { "": "LAUNDRY.Uses.none", mission: "LAUNDRY.Uses.mission", day: "LAUNDRY.Uses.day", rest: "LAUNDRY.Uses.rest" },
      deviceStates: { "": "LAUNDRY.DeviceState.ok", bugged: "LAUNDRY.Complication.bugged.name", overheat: "LAUNDRY.Complication.overheat.name", bricked: "LAUNDRY.Complication.bricked.name", fault: "LAUNDRY.Complication.fault.name", reboot: "LAUNDRY.Complication.reboot.name", lowPower: "LAUNDRY.Complication.lowPower.name", hacked: "LAUNDRY.Complication.hack.name" },
      timeUnits: { rounds: "LAUNDRY.TimeUnit.rounds", minutes: "LAUNDRY.TimeUnit.minutes", hours: "LAUNDRY.TimeUnit.hours", days: "LAUNDRY.TimeUnit.days" },
      severityOptions: CONFIG.LAUNDRY.severities,
      injuryKinds: CONFIG.LAUNDRY.injuryKinds
    });
    return ctx;
  }

  async _preparePartContext(partId, ctx) {
    ctx = await super._preparePartContext(partId, ctx);
    if (ctx.tabs?.[partId]) ctx.tab = ctx.tabs[partId];
    return ctx;
  }

  /** Comma-separated skill keys → arrays. */
  _processFormData(event, form, formData) {
    const data = super._processFormData(event, form, formData);
    const skills = foundry.utils.getProperty(data, "system.requirements.skills");
    if (skills) {
      for (const row of Object.values(skills)) {
        if (typeof row.keys === "string") row.keys = row.keys.split(/[,\s/]+/).filter(Boolean);
      }
    }
    return data;
  }

  static #toggleTrait(e, t) {
    const key = t.dataset.trait;
    const traits = new Set(this.item.system.traits);
    traits.has(key) ? traits.delete(key) : traits.add(key);
    return this.item.update({ "system.traits": [...traits] });
  }

  static #addRow(e, t) {
    const field = t.dataset.field;
    const arr = foundry.utils.deepClone(foundry.utils.getProperty(this.item.system, field) ?? []);
    const templates = {
      levels: { min: arr.length + 1, max: arr.length + 1, effect: "" },
      modifications: { label: "", complexity: 1, repeatable: false },
      "requirements.skills": { keys: ["awareness"], training: 1, focus: 0, either: false },
      "requirements.attributes": { key: "body", value: 3 }
    };
    arr.push(templates[field] ?? {});
    return this.item.update({ [`system.${field}`]: arr });
  }

  static #removeRow(e, t) {
    const field = t.dataset.field, idx = Number(t.dataset.index);
    const arr = foundry.utils.deepClone(foundry.utils.getProperty(this.item.system, field) ?? []);
    arr.splice(idx, 1);
    return this.item.update({ [`system.${field}`]: arr });
  }

  static async #addListEntry(e, t) {
    const field = t.dataset.field;
    const input = t.closest(".list-editor")?.querySelector("input.new-entry");
    const value = input?.value?.trim();
    if (!value) return;
    const arr = [...(foundry.utils.getProperty(this.item.system, field) ?? []), value];
    return this.item.update({ [`system.${field}`]: arr });
  }

  static #removeListEntry(e, t) {
    const field = t.dataset.field, idx = Number(t.dataset.index);
    const arr = [...(foundry.utils.getProperty(this.item.system, field) ?? [])];
    arr.splice(idx, 1);
    return this.item.update({ [`system.${field}`]: arr });
  }

  static #effectCreate() {
    return this.item.createEmbeddedDocuments("ActiveEffect", [{
      name: this.item.name, img: this.item.img, transfer: true,
      system: { changes: [{ key: "system.bonuses.initiative", type: "add", value: "1", phase: "initial" }] }
    }]);
  }
  static #effectEdit(e, t) { return this.item.effects.get(t.closest("[data-effect-id]").dataset.effectId)?.sheet.render({ force: true }); }
  static #effectDelete(e, t) { return this.item.effects.get(t.closest("[data-effect-id]").dataset.effectId)?.delete(); }
  static #use(e) { return this.item.use({ event: e }); }
}
