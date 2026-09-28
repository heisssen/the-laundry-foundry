/**
 * Actor sheets (ApplicationV2): Character, NPC.
 */
import { SYSTEM_PATH, SYSTEM_ID } from "../config.mjs";
import { SKILLS, SKILL_DEFAULT_ATTRIBUTE } from "../rules/derived.mjs";
import { attributeCost, skillCost, TALENT_COST } from "../rules/xp.mjs";
import { kSyndromeResistComplexity } from "../rules/magic.mjs";
import { getLuckState, Luck } from "../helpers/luck.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;
const TextEditor = foundry.applications.ux.TextEditor.implementation;

export class LaundryActorSheet extends HandlebarsApplicationMixin(ActorSheetV2) {

  static DEFAULT_OPTIONS = {
    classes: ["laundry", "sheet", "actor"],
    position: { width: 760, height: 820 },
    window: { resizable: true },
    form: { submitOnChange: true },
    actions: {
      rollSkill: LaundryActorSheet.#onRollSkill,
      rollAttribute: LaundryActorSheet.#onRollAttribute,
      setPip: LaundryActorSheet.#onSetPip,
      itemUse: LaundryActorSheet.#onItemUse,
      itemEdit: LaundryActorSheet.#onItemEdit,
      itemDelete: LaundryActorSheet.#onItemDelete,
      itemCreate: LaundryActorSheet.#onItemCreate,
      itemChat: LaundryActorSheet.#onItemChat,
      itemToggle: LaundryActorSheet.#onItemToggle,
      itemExpand: LaundryActorSheet.#onItemExpand,
      toggleCondition: LaundryActorSheet.#onToggleCondition,
      resource: LaundryActorSheet.#onResource,
      recovery: LaundryActorSheet.#onRecovery,
      death: LaundryActorSheet.#onDeath,
      luck: LaundryActorSheet.#onLuck,
      healInjury: LaundryActorSheet.#onHealInjury,
      treatInjury: LaundryActorSheet.#onTreatInjury,
      toggleMode: LaundryActorSheet.#onToggleMode,
      buy: LaundryActorSheet.#onBuy,
      undoPurchase: LaundryActorSheet.#onUndoPurchase,
      openCreator: LaundryActorSheet.#onOpenCreator,
      kResist: LaundryActorSheet.#onKResist,
      requisition: LaundryActorSheet.#onRequisition,
      resetDevice: LaundryActorSheet.#onResetDevice,
      addInjury: LaundryActorSheet.#onAddInjury,
      applyDamage: LaundryActorSheet.#onApplyDamage
    }
  };

  /** Edit mode unlocks raw values (attributes, overrides). */
  editMode = false;

  get title() { return this.actor.name; }

  _canDragStart() { return this.isEditable; }

  /* ---------------------------------------- */

  async _prepareContext(options) {
    const ctx = await super._prepareContext(options);
    const actor = this.actor, sys = actor.system;
    const luck = getLuckState();
    const ladder = CONFIG.LAUNDRY.ladderKeys;
    Object.assign(ctx, {
      actor, system: sys, source: actor.system._source ?? actor._source.system,
      config: CONFIG.LAUNDRY,
      editable: this.isEditable,
      editMode: this.editMode && this.isEditable,
      isGM: game.user.isGM,
      luck,
      inCombat: !!game.combat?.started,
      attributes: ["body", "mind", "spirit"].map(k => ({
        key: k, label: `LAUNDRY.Attribute.${k}`, abbr: `LAUNDRY.AttributeAbbr.${k}`,
        value: sys.getAttribute(k), source: sys.attributes[k].value,
        modified: sys.getAttribute(k) !== sys.attributes[k].value
      })),
      skills: SKILLS.map(k => {
        const s = sys.skills[k];
        return {
          key: k, label: `LAUNDRY.Skill.${k}`, attribute: SKILL_DEFAULT_ATTRIBUTE[k],
          attrAbbr: `LAUNDRY.AttributeAbbr.${SKILL_DEFAULT_ATTRIBUTE[k]}`,
          training: s.training, focus: s.focus,
          pool: sys.getAttribute(SKILL_DEFAULT_ATTRIBUTE[k]) + s.training,
          trainingPips: [1, 2, 3, 4].slice(0, k === "magic" ? 4 : 3).map(n => ({ n, filled: s.training >= n })),
          focusPips: [1, 2, 3, 4].slice(0, k === "magic" ? 4 : 3).map(n => ({ n, filled: s.focus >= n })),
          core: sys.details?.coreSkill === k,
          trained: s.training > 0 || s.focus > 0
        };
      }),
      combat: sys.combat ? {
        melee: { step: sys.combat.melee, label: `LAUNDRY.Ladder.${ladder[sys.combat.melee]}`, base: sys.combat.meleeBase },
        accuracy: { step: sys.combat.accuracy, label: `LAUNDRY.Ladder.${ladder[sys.combat.accuracy]}`, base: sys.combat.accuracyBase },
        defence: { step: sys.combat.defence, label: `LAUNDRY.Ladder.${ladder[sys.combat.defence]}`, base: sys.combat.defenceBase },
        armour: sys.combat.armour
      } : null,
      injuryTrack: Array.from({ length: sys.injuries?.max ?? 0 }, (_, i) => ({ filled: i < (sys.injuries?.filled ?? 0) })),
      toughnessPct: sys.toughness?.max ? Math.round(100 * sys.toughness.value / sys.toughness.max) : 0,
      adrenalinePips: Array.from({ length: sys.adrenaline?.max ?? 0 }, (_, i) => ({ n: i + 1, filled: i < sys.adrenaline.value })),
      conditions: CONFIG.statusEffects.filter(s => s.id !== "dead").map(s => ({
        ...s, active: actor.statuses.has(s.id), label: s.name
      })),
      ...this.#prepareItems(),
      enriched: await this._enrich(),
      tabs: this._prepareTabs("primary")
    });
    return ctx;
  }

  async _enrich() {
    return {};
  }

  #prepareItems() {
    const items = this.actor.items.contents.sort((a, b) => (a.sort || 0) - (b.sort || 0));
    const by = t => items.filter(i => i.type === t);
    const decorate = i => ({
      id: i.id, name: i.name, img: i.img, type: i.type, system: i.system, item: i,
      traits: (i.system.traits ?? []).map(t => game.i18n.localize(`LAUNDRY.Trait.${t}`)).join(", "),
      expanded: this._expanded?.has(i.id)
    });
    const weapons = by("weapon").map(i => {
      const w = i.system, sys = this.actor.system;
      const skill = w.kind === "ranged" ? "ranged" : "closeCombat";
      const pool = w.pool ?? (sys.getAttribute("body") + sys.getSkill(skill).training);
      const focus = w.focus ?? sys.getSkill(skill).focus;
      const step = w.step ?? (w.kind === "ranged" ? sys.combat?.accuracy : sys.combat?.melee);
      return {
        ...decorate(i), pool, focus,
        stepLabel: `LAUNDRY.Ladder.${CONFIG.LAUNDRY.ladderKeys[step ?? 1]}`,
        damageLabel: w.blast ? `Blast (${w.blast})` : `${w.damage || ""}${w.addSuccesses ? (w.damage ? " + S" : "S") : ""}`,
        rangeLabel: w.range ? `LAUNDRY.Range.${w.range}` : (w.kind === "melee" ? "LAUNDRY.Range.close" : "")
      };
    });
    const blurb = html => {
      const t = (html ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      return t.length > 120 ? `${t.slice(0, 117)}…` : t;
    };
    const talents = by("talent").map(i => ({
      ...decorate(i), req: i.checkRequirements?.(this.actor),
      blurb: blurb(i.system.description), automated: !!i.system.modifiers?.length
    }));
    return {
      weapons,
      armour: by("armour").map(decorate),
      gear: by("gear").map(decorate),
      devices: by("gear").filter(i => i.system.isDevice).map(decorate),
      talents: talents.filter(t => t.system.category !== "trait"),
      traits: talents.filter(t => t.system.category === "trait"),
      spells: by("spell").map(decorate),
      apps: by("app").map(decorate),
      injuries: by("injury").map(i => ({ ...decorate(i), severityLabel: `LAUNDRY.Severity.${i.system.severity}`, kindLabel: `LAUNDRY.InjuryKind.${i.system.kind}`, effect: game.i18n.localize(`LAUNDRY.Injury.${i.system.key}.effect`) })),
      assignments: by("assignment").map(decorate)
    };
  }

  /* ---------------------------------------- */
  /*  Drop handling                            */
  /* ---------------------------------------- */

  async _onDropItem(event, item) {
    if (!this.actor.isOwner) return null;
    if (item.type === "assignment" && this.actor.type === "character" && item.parent?.uuid !== this.actor.uuid) {
      const { CharacterCreator } = await import("./character-creator.mjs");
      new CharacterCreator(this.actor, { assignment: item }).render({ force: true });
      return null;
    }
    // Gear from a compendium / the sidebar with a requisition DN: fill in the form (OH p.122).
    // Shift-drop skips the paperwork.
    if (this.actor.type === "character" && !item.parent && item.system?.requisition && !event.shiftKey) {
      const rq = await import("../workflows/requisition.mjs");
      const how = await rq.chooseRequisition(this.actor, item);
      if (how === "issue") return rq.issueDirectly(this.actor, item);
      if (how) return rq.requisition(this.actor, item, { skill: how });
      return null;
    }
    if (item.type === "talent" && item.parent?.uuid !== this.actor.uuid && this.actor.type === "character") {
      const req = item.checkRequirements(this.actor);
      if (!req.met) ui.notifications.warn(game.i18n.format("LAUNDRY.Notify.RequirementsNotMet", { name: item.name, missing: req.missing.join(", ") }));
    }
    return super._onDropItem(event, item);
  }

  /* ---------------------------------------- */
  /*  Actions                                  */
  /* ---------------------------------------- */

  static #onRollSkill(event, target) {
    const skill = target.dataset.skill;
    const attribute = target.dataset.attribute;
    return this.actor.rollSkill(skill, attribute ? { attribute } : {}, { event });
  }

  static #onRollAttribute(event, target) {
    return this.actor.rollAttribute(target.dataset.attribute, {}, { event });
  }

  /** Click a pip: set Training/Focus to that level (click the current top pip to lower). */
  static async #onSetPip(event, target) {
    if (!this.isEditable) return;
    const { skill, kind, n } = target.dataset;
    const current = this.actor.system.skills[skill][kind];
    const value = current === Number(n) ? Number(n) - 1 : Number(n);
    return this.actor.update({ [`system.skills.${skill}.${kind}`]: value });
  }

  static #getItem(target) {
    const id = target.closest("[data-item-id]")?.dataset.itemId;
    return this.actor.items.get(id);
  }

  static #onItemUse(event, target) {
    return LaundryActorSheet.#getItem.call(this, target)?.use({ event });
  }

  static #onItemEdit(event, target) {
    return LaundryActorSheet.#getItem.call(this, target)?.sheet.render({ force: true });
  }

  static async #onItemDelete(event, target) {
    const item = LaundryActorSheet.#getItem.call(this, target);
    if (!item) return;
    if (event.shiftKey) return item.delete();
    return item.deleteDialog();
  }

  static #onItemChat(event, target) {
    return LaundryActorSheet.#getItem.call(this, target)?.toChat();
  }

  static async #onItemCreate(event, target) {
    const type = target.dataset.type;
    const data = { name: game.i18n.format("DOCUMENT.New", { type: game.i18n.localize(`TYPES.Item.${type}`) }), type, system: {} };
    if (target.dataset.category) data.system.category = target.dataset.category;
    const [item] = await this.actor.createEmbeddedDocuments("Item", [data]);
    item?.sheet.render({ force: true });
  }

  static #onItemToggle(event, target) {
    const item = LaundryActorSheet.#getItem.call(this, target);
    const field = target.dataset.field ?? "equipped";
    return item?.update({ [`system.${field}`]: !foundry.utils.getProperty(item.system, field) });
  }

  static #onItemExpand(event, target) {
    const id = target.closest("[data-item-id]")?.dataset.itemId;
    this._expanded ??= new Set();
    this._expanded.has(id) ? this._expanded.delete(id) : this._expanded.add(id);
    this.render();
  }

  static #onToggleCondition(event, target) {
    return this.actor.toggleStatusEffect(target.dataset.condition);
  }

  static async #onResource(event, target) {
    const { path, delta } = target.dataset;
    const current = foundry.utils.getProperty(this.actor, path) ?? 0;
    const maxPath = path.replace(/\.value$/, ".max");
    const max = foundry.utils.getProperty(this.actor, maxPath);
    let value = current + Number(delta);
    value = Math.max(0, max != null ? Math.min(max, value) : value);
    return this.actor.update({ [path]: value });
  }

  static #onRecovery(event, target) {
    const kind = target.dataset.kind;
    if (kind === "breather") return this.actor.takeBreather();
    if (kind === "rest") return this.actor.rest();
  }

  static #onDeath(event, target) {
    const kind = target.dataset.kind;
    if (kind === "test") return this.actor.rollDeathTest();
    if (kind === "lastStand") return this.actor.lastStand();
    if (kind === "cheat") return this.actor.cheatDeath();
    if (kind === "stabilise") return this.actor.stabilise();
  }

  static #onLuck(event, target) {
    const kind = target.dataset.kind;
    if (kind === "toughness") return this.actor.luckRecoverToughness();
    if (kind === "adrenaline") return this.actor.luckRegainAdrenaline();
  }

  static #onHealInjury(event, target) {
    return this.actor.downtimeHeal(target.closest("[data-item-id]").dataset.itemId);
  }

  static #onTreatInjury(event, target) {
    return this.actor.treatInjury(target.closest("[data-item-id]").dataset.itemId);
  }

  static #onToggleMode() {
    this.editMode = !this.editMode;
    this.render();
  }

  /** XP purchase: attribute / training / focus / talent. OH p.34 */
  static async #onBuy(event, target) {
    const { kind, key } = target.dataset;
    const sys = this.actor.system;
    let cost, from, to, path, label;
    if (kind === "attribute") {
      from = sys.attributes[key].value; to = from + 1; cost = attributeCost(from, to);
      path = `system.attributes.${key}.value`; label = game.i18n.localize(`LAUNDRY.Attribute.${key}`);
    } else if (kind === "training" || kind === "focus") {
      from = sys.skills[key][kind]; to = from + 1; cost = skillCost(from, to);
      path = `system.skills.${key}.${kind}`;
      label = `${game.i18n.localize(`LAUNDRY.Skill.${key}`)} (${game.i18n.localize(`LAUNDRY.Skill.${kind}`)})`;
      if (to > (key === "magic" && kind === "training" ? 4 : 3)) return ui.notifications.warn("LAUNDRY.Notify.MaxLevel", { localize: true });
    } else return;
    if (!Number.isFinite(cost)) return ui.notifications.warn("LAUNDRY.Notify.MaxLevel", { localize: true });
    if (cost > sys.xp.available && !event.shiftKey) return ui.notifications.warn(game.i18n.format("LAUNDRY.Notify.NotEnoughXP", { cost, available: sys.xp.available }));
    const log = [...sys.xp.log, { date: new Date().toISOString().slice(0, 10), label, cost, kind, key, from, to }];
    return this.actor.update({ [path]: to, "system.xp.spent": sys.xp.spent + cost, "system.xp.log": log });
  }

  static async #onUndoPurchase(event, target) {
    const idx = Number(target.dataset.index);
    const sys = this.actor.system;
    const entry = sys.xp.log[idx];
    if (!entry) return;
    const log = sys.xp.log.filter((_, i) => i !== idx);
    const update = { "system.xp.spent": sys.xp.spent - entry.cost, "system.xp.log": log };
    if (entry.kind === "attribute") update[`system.attributes.${entry.key}.value`] = entry.from;
    else if (entry.kind === "training" || entry.kind === "focus") update[`system.skills.${entry.key}.${entry.kind}`] = entry.from;
    else if (entry.kind === "talent") {
      const t = this.actor.items.get(entry.key);
      if (t) await t.delete();
    }
    return this.actor.update(update);
  }

  static async #onOpenCreator() {
    const { CharacterCreator } = await import("./character-creator.mjs");
    return new CharacterCreator(this.actor).render({ force: true });
  }

  static async #onKResist() {
    const { resistKSyndrome } = await import("../workflows/magic.mjs");
    return resistKSyndrome(this.actor);
  }

  static #onRequisition(event, target) {
    const item = LaundryActorSheet.#getItem.call(this, target);
    return item?.requisition(this.actor, { skill: event.altKey ? "presence" : "bureaucracy" });
  }

  static #onResetDevice(event, target) {
    return LaundryActorSheet.#getItem.call(this, target)?.update({ "system.deviceState": "" });
  }

  static async #onAddInjury() {
    const content = `<div class="laundry-dialog"><div class="form-group"><label>${game.i18n.localize("LAUNDRY.InjuryKind.label")}</label>
      <select name="kind"><option value="physical">${game.i18n.localize("LAUNDRY.InjuryKind.physical")}</option><option value="psychological">${game.i18n.localize("LAUNDRY.InjuryKind.psychological")}</option></select></div>
      <div class="form-group"><label>${game.i18n.localize("LAUNDRY.Severity.label")}</label>
      <select name="severity"><option value="minor">${game.i18n.localize("LAUNDRY.Severity.minor")}</option><option value="serious">${game.i18n.localize("LAUNDRY.Severity.serious")}</option><option value="deadly">${game.i18n.localize("LAUNDRY.Severity.deadly")}</option></select></div></div>`;
    const res = await foundry.applications.api.DialogV2.prompt({
      window: { title: "LAUNDRY.Sheet.AddInjury" }, content,
      ok: { callback: (ev, btn) => ({ kind: btn.form.elements.kind.value, severity: btn.form.elements.severity.value }) },
      rejectClose: false
    });
    if (res) return this.actor.addInjury(res.kind, res.severity);
  }

  static async #onApplyDamage() {
    const content = `<div class="laundry-dialog"><div class="form-group"><label>${game.i18n.localize("LAUNDRY.Damage.Amount")}</label><input type="number" name="damage" value="1" min="0"></div>
      <div class="form-group"><label>${game.i18n.localize("LAUNDRY.DamageType.label")}</label><select name="type"><option value="physical">${game.i18n.localize("LAUNDRY.DamageType.physical")}</option><option value="psychological">${game.i18n.localize("LAUNDRY.DamageType.psychological")}</option></select></div>
      <div class="form-group"><label>${game.i18n.localize("LAUNDRY.Damage.IgnoreArmour")}</label><input type="checkbox" name="ignoreArmour"></div></div>`;
    const res = await foundry.applications.api.DialogV2.prompt({
      window: { title: "LAUNDRY.Sheet.ApplyDamage" }, content,
      ok: { callback: (ev, btn) => ({ damage: Number(btn.form.elements.damage.value), type: btn.form.elements.type.value, ignoreArmour: btn.form.elements.ignoreArmour.checked }) },
      rejectClose: false
    });
    if (res) return this.actor.applyDamage(res);
  }
}

/* ============================================================== */

export class CharacterSheet extends LaundryActorSheet {
  static DEFAULT_OPTIONS = { classes: ["character"] };

  static PARTS = {
    header: { template: `${SYSTEM_PATH}/templates/actor/character-header.hbs` },
    tabs: { template: "templates/generic/tab-navigation.hbs" },
    main: { template: `${SYSTEM_PATH}/templates/actor/character-main.hbs`, scrollable: [""] },
    combat: { template: `${SYSTEM_PATH}/templates/actor/character-combat.hbs`, scrollable: [""] },
    talents: { template: `${SYSTEM_PATH}/templates/actor/character-talents.hbs`, scrollable: [""] },
    equipment: { template: `${SYSTEM_PATH}/templates/actor/character-equipment.hbs`, scrollable: [""] },
    magic: { template: `${SYSTEM_PATH}/templates/actor/character-magic.hbs`, scrollable: [""] },
    bio: { template: `${SYSTEM_PATH}/templates/actor/character-bio.hbs`, scrollable: [""] },
    xp: { template: `${SYSTEM_PATH}/templates/actor/character-xp.hbs`, scrollable: [""] }
  };

  static TABS = {
    primary: {
      tabs: [
        { id: "main", icon: "fa-solid fa-id-card" },
        { id: "combat", icon: "fa-solid fa-hand-fist" },
        { id: "talents", icon: "fa-solid fa-star" },
        { id: "equipment", icon: "fa-solid fa-briefcase" },
        { id: "magic", icon: "fa-solid fa-hat-wizard" },
        { id: "bio", icon: "fa-solid fa-folder-open" },
        { id: "xp", icon: "fa-solid fa-chart-line" }
      ],
      initial: "main",
      labelPrefix: "LAUNDRY.Tab"
    }
  };

  async _enrich() {
    const d = this.actor.system.details;
    return {
      biography: await TextEditor.enrichHTML(d.biography, { relativeTo: this.actor, secrets: this.actor.isOwner }),
      notes: await TextEditor.enrichHTML(d.notes, { relativeTo: this.actor, secrets: this.actor.isOwner })
    };
  }

  async _preparePartContext(partId, ctx) {
    ctx = await super._preparePartContext(partId, ctx);
    if (ctx.tabs?.[partId]) ctx.tab = ctx.tabs[partId];
    if (partId === "magic") {
      const ks = this.actor.system.kSyndrome;
      ctx.kSyndrome = {
        ...ks,
        resistComplexity: kSyndromeResistComplexity(ks.mishaps),
        stageLabel: ks.stage ? `LAUNDRY.KSyndrome.Stage.${ks.stage}` : null,
        track: [1, 2, 3, 4, 5, 6].map(n => ({ n, filled: ks.fails >= n, label: `LAUNDRY.KSyndrome.StageN.${n}` }))
      };
      ctx.methods = (await import("../workflows/magic.mjs")).casterMethods(this.actor);
    }
    if (partId === "xp") {
      const sys = this.actor.system;
      const avail = sys.xp.available;
      const pips = (value, max) => Array.from({ length: max }, (_, i) => ({ filled: value > i }));
      ctx.xpAttributes = ["body", "mind", "spirit"].map(k => {
        const v = sys.attributes[k].value;
        const cost = attributeCost(v, v + 1);
        return { key: k, label: `LAUNDRY.Attribute.${k}`, value: v, pips: pips(v, 4), maxed: v >= 4, cost, afford: cost <= avail };
      });
      ctx.xpSkills = SKILLS.map(k => {
        const { training: t, focus: f } = sys.skills[k];
        const max = k === "magic" ? 4 : 3;
        const tCost = skillCost(t, t + 1), fCost = skillCost(f, f + 1);
        return {
          key: k, label: `LAUNDRY.Skill.${k}`, training: t, focus: f,
          tPips: pips(t, max), fPips: pips(f, max), tMaxed: t >= max, fMaxed: f >= max,
          tCost, fCost, tAfford: tCost <= avail, fAfford: fCost <= avail
        };
      });
      ctx.talentCost = TALENT_COST;
      ctx.xpLog = sys.xp.log.map((e, i) => ({ ...e, index: i })).reverse();
    }
    return ctx;
  }
}

/* ============================================================== */

export class NpcSheet extends LaundryActorSheet {
  static DEFAULT_OPTIONS = {
    classes: ["npc"],
    position: { width: 620, height: 760 }
  };

  static PARTS = {
    body: { template: `${SYSTEM_PATH}/templates/actor/npc-sheet.hbs`, scrollable: [""] }
  };

  async _enrich() {
    return {
      description: await TextEditor.enrichHTML(this.actor.system.description, { relativeTo: this.actor, secrets: this.actor.isOwner }),
      threatScaling: await TextEditor.enrichHTML(this.actor.system.threatScaling, { relativeTo: this.actor, secrets: this.actor.isOwner }),
      notes: await TextEditor.enrichHTML(this.actor.system.notes, { relativeTo: this.actor, secrets: this.actor.isOwner })
    };
  }

  async _prepareContext(options) {
    const ctx = await super._prepareContext(options);
    const sys = this.actor.system;
    ctx.statSkills = ctx.skills.filter(s => s.trained).map(s => ({
      ...s, text: `${game.i18n.localize(s.label)} (+${s.training}d6${s.focus ? `, +${s.focus}F` : ""})`
    }));
    ctx.ladderOptions = Object.fromEntries(CONFIG.LAUNDRY.ladderKeys.map((k, i) => [i, `LAUNDRY.Ladder.${k}`]));
    ctx.presenceLabel = `LAUNDRY.Presence.${sys.presence}`;
    ctx.threat = getLuckState().threat;
    return ctx;
  }
}
