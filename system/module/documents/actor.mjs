/**
 * LaundryActor — rolls, damage, injuries, adrenaline, recovery.
 */
import { SYSTEM_ID } from "../config.mjs";
import { performTest } from "../dice/test.mjs";
import { TestDialog } from "../apps/test-dialog.mjs";
import { resolveDamage, initialDeathTest, SEVERITY, cheatDeath, RECOVERY } from "../rules/damage.mjs";
import { lookup, PHYSICAL_INJURIES, PSYCHOLOGICAL_INJURIES, CONDITIONS } from "../rules/tables.mjs";
import { SKILL_DEFAULT_ATTRIBUTE } from "../rules/derived.mjs";
import { Luck } from "../helpers/luck.mjs";
import { findItem } from "../helpers/compendium.mjs";

export class LaundryActor extends Actor {

  /* ---------------------------------------- */
  /*  Creation defaults                       */
  /* ---------------------------------------- */

  async _preCreate(data, options, user) {
    if ((await super._preCreate(data, options, user)) === false) return false;
    const proto = {};
    if (this.type === "character") {
      Object.assign(proto, { actorLink: true, disposition: CONST.TOKEN_DISPOSITIONS.FRIENDLY, sight: { enabled: true } });
    } else if (this.type === "npc") {
      Object.assign(proto, { disposition: CONST.TOKEN_DISPOSITIONS.HOSTILE });
    } else if (this.type === "team") {
      Object.assign(proto, { actorLink: true });
    }
    proto["bar1.attribute"] = "toughness";
    // Start at full Toughness: Body + Mind + Spirit. OH p.33
    if (this.isCreature && data.system?.toughness?.value === undefined) {
      const a = this.system.attributes;
      this.updateSource({ "system.toughness.value": a.body.value + a.mind.value + a.spirit.value });
    }
    if (this.type !== "team" && this.type !== "vehicle") proto["bar2.attribute"] = "adrenaline";
    // Everyone can throw a punch: new characters get the Unarmed attack.
    if (this.type === "character" && !data.items?.length) {
      const fist = await findItem("Unarmed", { type: "weapon" }).catch(() => null);
      if (fist) {
        const item = fist.toObject();
        delete item._id;
        item.system.equipped = true;
        this.updateSource({ items: [item] });
      }
    }
    this.updateSource({ prototypeToken: proto });
  }

  get isCreature() {
    return this.type === "character" || this.type === "npc";
  }

  /* ---------------------------------------- */
  /*  Tests                                   */
  /* ---------------------------------------- */

  /**
   * Open the Test dialog (unless `skipDialog`) and roll.
   * @param {object} cfg  partial TestConfig
   */
  async rollTest(cfg = {}, { skipDialog = false, event = null } = {}) {
    const fast = skipDialog || event?.shiftKey;
    let config = { kind: "test", dn: 4, complexity: 1, ...cfg, actorUuid: this.uuid };
    if (!fast) {
      config = await TestDialog.wait(this, config);
      if (!config) return null;
    }
    if (config.maximise && !(await Luck.spend(1, { reason: "LAUNDRY.LuckThreat.SpentMaximise" }))) return null;
    if (config.doubleTraining && !(await this.spendAdrenaline(1))) config.doubleTraining = false;
    return performTest(this, config, { rollMode: config.rollMode });
  }

  rollSkill(skill, cfg = {}, opts = {}) {
    const attribute = cfg.attribute ?? SKILL_DEFAULT_ATTRIBUTE[skill] ?? "mind";
    const label = `${game.i18n.localize(`LAUNDRY.Attribute.${attribute}`)} (${game.i18n.localize(`LAUNDRY.Skill.${skill}`)})`;
    return this.rollTest({ attribute, skill, label, ...cfg }, opts);
  }

  rollAttribute(attribute, cfg = {}, opts = {}) {
    return this.rollTest({ attribute, skill: "", label: game.i18n.localize(`LAUNDRY.Attribute.${attribute}`), ...cfg }, opts);
  }

  /* ---------------------------------------- */
  /*  Adrenaline                              */
  /* ---------------------------------------- */

  async spendAdrenaline(n = 1) {
    const a = this.system.adrenaline;
    if (!a || a.value < n) {
      ui.notifications.warn("LAUNDRY.Notify.NoAdrenaline", { localize: true });
      return false;
    }
    await this.update({ "system.adrenaline.value": a.value - n });
    return true;
  }

  async gainAdrenaline(n = 1) {
    const a = this.system.adrenaline;
    if (!a || !a.max) return;
    const value = Math.min(a.max, a.value + n);
    if (value !== a.value) await this.update({ "system.adrenaline.value": value });
  }

  async refillAdrenaline() {
    const a = this.system.adrenaline;
    if (a && a.max) await this.update({ "system.adrenaline.value": a.max });
  }

  async clearAdrenaline() {
    const a = this.system.adrenaline;
    if (a?.value) await this.update({ "system.adrenaline.value": 0 });
  }

  /* ---------------------------------------- */
  /*  Conditions                              */
  /* ---------------------------------------- */

  /**
   * Apply a status for a number of rounds (0 = until removed).
   * @param {string} id
   * @param {object} [o]
   * @param {number} [o.turns]  expire at the end of the actor's Nth next turn
   */
  async addCondition(id, { turns = 0, origin = null } = {}) {
    if (this.statuses.has(id)) return;
    const status = CONFIG.statusEffects.find(s => s.id === id);
    if (!status) return;
    const effect = await ActiveEffect.implementation.fromStatusEffect(id);
    const data = effect.toObject();
    if (turns > 0) {
      data.duration = { value: turns, units: "turns", expiry: "turnEnd" };
      if (game.combat?.started) data.start = { combat: game.combat.id, round: game.combat.round, turn: game.combat.turn };
    }
    if (origin) data.origin = origin;
    await this.createEmbeddedDocuments("ActiveEffect", [data]);
    // Unconscious implies Prone. OH p.99
    if (id === "unconscious") await this.addCondition("prone");
  }

  async removeCondition(id) {
    const ids = this.effects.filter(e => e.statuses.has(id)).map(e => e.id);
    if (ids.length) await this.deleteEmbeddedDocuments("ActiveEffect", ids);
  }

  /* ---------------------------------------- */
  /*  Damage & Injuries                       */
  /* ---------------------------------------- */

  /**
   * Apply Damage (OH p.112).
   * @param {object} hit  {damage, type, ignoreArmour, armourPenetration, brutal, ineffective, source, rend, cause}
   * @returns {Promise<object>} resolution summary
   */
  async applyDamage(hit, { chat = true } = {}) {
    if (!this.isCreature) {
      if (this.type === "vehicle") return this.#applyVehicleDamage(hit, { chat });
      return null;
    }
    const sys = this.system;
    const res = resolveDamage({
      toughness: sys.toughness.value,
      armour: sys.combat?.armour ?? 0,
      injuriesMax: sys.injuries.max,
      injuriesFilled: sys.injuries.filled,
      critical: sys.injuries.critical
    }, hit);

    // Last Stand: immune to all Damage. OH p.115
    if (this.statuses.has("lastStand")) {
      res.damage = 0; res.immune = true;
      if (chat) await this.#damageMessage(hit, res);
      return res;
    }

    const updates = { "system.toughness.value": res.toughnessAfter };
    const notes = [];

    if (res.deathComplexityIncrease) {
      updates["system.injuries.deathComplexity"] = sys.injuries.deathComplexity + res.deathComplexityIncrease;
      notes.push(game.i18n.format("LAUNDRY.Damage.DeathComplexityUp", { c: updates["system.injuries.deathComplexity"] }));
    }
    await this.update(updates);

    // Rend destroys armour points after the attack. OH p.124
    if (hit.rend) await this.#rendArmour(hit.rend);

    if (res.defeated) {
      await this.toggleStatusEffect("dead", { active: true, overlay: true });
      notes.push(game.i18n.localize("LAUNDRY.Damage.Defeated"));
    }

    if (res.severity) {
      if (res.becameCritical) {
        await this.becomeCritical(res.severity);
        notes.push(game.i18n.localize("LAUNDRY.Damage.Critical"));
      } else {
        const injury = await this.addInjury(res.type, res.severity, { cause: hit.cause ?? "" });
        if (injury) notes.push(injury.name);
      }
      // Suffering an Injury grants 1 Adrenaline. OH p.94
      await this.gainAdrenaline(1);
    }
    res.notes = notes;
    if (chat) await this.#damageMessage(hit, res);
    return res;
  }

  async #rendArmour(points) {
    const armours = this.items.filter(i => i.type === "armour" && i.system.equipped);
    let left = points;
    for (const a of armours) {
      if (left <= 0) break;
      const room = a.system.value - a.system.damage;
      const take = Math.min(room, left);
      if (take > 0) await a.update({ "system.damage": a.system.damage + take });
      left -= take;
    }
  }

  async #damageMessage(hit, res) {
    const content = await foundry.applications.handlebars.renderTemplate(
      `systems/${SYSTEM_ID}/templates/chat/damage-card.hbs`, { actor: this, hit, res });
    return ChatMessage.create({
      content, speaker: ChatMessage.getSpeaker({ actor: this }),
      whisper: this.type === "npc" ? ChatMessage.getWhisperRecipients("GM") : []
    });
  }

  /**
   * Roll on the Injury table and record the Injury. OH p.113-114
   * @param {"physical"|"psychological"} kind
   * @param {"minor"|"serious"|"deadly"} severity
   */
  async addInjury(kind, severity, { cause = "", extraDice = 0 } = {}) {
    const dice = SEVERITY[severity].dice + extraDice;
    const roll = await new Roll(`${dice}d6`).evaluate();
    const table = kind === "psychological" ? PSYCHOLOGICAL_INJURIES : PHYSICAL_INJURIES;
    const row = lookup(table, roll.total);
    const name = game.i18n.localize(`LAUNDRY.Injury.${row.key}.name`);
    const [item] = await this.createEmbeddedDocuments("Item", [{
      name, type: "injury",
      img: kind === "psychological" ? "icons/svg/daze.svg" : "icons/svg/blood.svg",
      system: {
        kind, severity, key: row.key, roll: roll.total, spaces: SEVERITY[severity].spaces, cause,
        description: `<p>${game.i18n.localize(`LAUNDRY.Injury.${row.key}.effect`)}</p>`
      }
    }]);
    await roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      flavor: `<b>${game.i18n.localize(`LAUNDRY.Severity.${severity}`)} ${game.i18n.localize(`LAUNDRY.InjuryKind.${kind}`)}</b>: ${name}<br>${game.i18n.localize(`LAUNDRY.Injury.${row.key}.effect`)}`
    });
    // Immediate effects last until the end of the victim's next turn.
    for (const s of row.immediate ?? []) await this.addCondition(s, { turns: row.persistentImmediate ? 0 : 1, origin: item.uuid });
    for (const s of row.persistent ?? []) await this.addCondition(s, { origin: item.uuid });
    if (row.death) await this.die({ reason: name });
    return item;
  }

  /** Become Critically Injured. OH p.114 */
  async becomeCritical(severity) {
    const dt = initialDeathTest(severity);
    await this.update({
      "system.injuries.critical": true,
      "system.injuries.deathDN": dt.dn,
      "system.injuries.deathComplexity": dt.complexity
    });
    await this.addCondition("critical");
    await this.addCondition("stunned");
  }

  /** Roll the Death Test at the start of the turn. OH p.114 */
  async rollDeathTest() {
    const { deathTest } = await import("../workflows/death.mjs");
    return deathTest(this);
  }

  async die({ reason = "" } = {}) {
    await this.toggleStatusEffect("dead", { active: true, overlay: true });
    if (this.type === "character") {
      await Luck.adjustThreat(1, "LAUNDRY.LuckThreat.ThreatDeath");
    }
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      content: `<div class="laundry-note death"><i class="fa-solid fa-skull"></i> ${game.i18n.format("LAUNDRY.Death.Died", { name: this.name })} ${reason ? `(${reason})` : ""}</div>`
    });
  }

  async stabilise() {
    await this.update({ "system.injuries.critical": false });
    await this.removeCondition("critical");
    await this.removeCondition("stunned");
  }

  /** Luck: Cheat Death. OH p.97 */
  async cheatDeath() {
    if (!this.system.injuries?.critical) return;
    if (!(await Luck.spend(1, { reason: "LAUNDRY.LuckThreat.SpentCheatDeath" }))) return;
    const r = cheatDeath(this.system.toughness.max);
    await this.update({ "system.toughness.value": r.toughness });
    await this.stabilise();
  }

  /** Luck: Recover Toughness. OH p.97 */
  async luckRecoverToughness() {
    if (!(await Luck.spend(1, { reason: "LAUNDRY.LuckThreat.SpentToughness" }))) return;
    await this.update({ "system.toughness.value": this.system.toughness.max });
  }

  /** Luck: Regain Adrenaline. OH p.97 */
  async luckRegainAdrenaline() {
    if (!(await Luck.spend(1, { reason: "LAUNDRY.LuckThreat.SpentAdrenaline" }))) return;
    await this.refillAdrenaline();
  }

  /** Last Stand. OH p.115 */
  async lastStand() {
    if (!this.system.injuries?.critical) return;
    const keep = new Set(["critical", "lastStand", "dead"]);
    const remove = this.effects.filter(e => [...e.statuses].some(s => !keep.has(s)) && e.statuses.size).map(e => e.id);
    if (remove.length) await this.deleteEmbeddedDocuments("ActiveEffect", remove);
    await this.refillAdrenaline();
    await this.update({ "system.lastStand": true });
    await this.addCondition("lastStand");
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      content: `<div class="laundry-note last-stand"><i class="fa-solid fa-fire"></i> ${game.i18n.format("LAUNDRY.Death.LastStandDeclared", { name: this.name })}</div>`
    });
  }

  /* ---------------------------------------- */
  /*  Recovery (OH p.116)                     */
  /* ---------------------------------------- */

  async takeBreather() {
    const t = this.system.toughness;
    if (this.system.injuries?.critical) return ui.notifications.warn("LAUNDRY.Notify.CriticalNoRecovery", { localize: true });
    await this.update({ "system.toughness.value": Math.min(t.max, t.value + RECOVERY.breather(t.max)) });
    await this.update({ "system.mission.backupPlanUsed": false });
    await this.#refreshTalents("rest");
  }

  async rest() {
    const t = this.system.toughness;
    if (this.system.injuries?.critical) return ui.notifications.warn("LAUNDRY.Notify.CriticalNoRecovery", { localize: true });
    await this.update({ "system.toughness.value": t.max, "system.mission.backupPlanUsed": false });
    await this.#refreshTalents("rest");
    // Naturally Lucky: 2d6 vs GM 1d6 -> +2 Luck, otherwise Threat +1. OH p.77
    if (this.items.some(i => i.system.identifier === "naturallyLucky")) {
      const mine = await new Roll("2d6").evaluate();
      const gm = await new Roll("1d6").evaluate();
      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: this }),
        content: `<div class="laundry-note"><i class="fa-solid fa-clover"></i> ${game.i18n.format("LAUNDRY.Talent.NaturallyLuckyNote", { mine: mine.total, gm: gm.total })}</div>`
      });
      if (mine.total > gm.total) await Luck.adjustLuck(2);
      else await Luck.adjustThreat(1);
    }
    // Prophetic Dreams: 2d6 after a Rest. OH p.79
    if (this.items.some(i => i.system.identifier === "propheticDreams")) {
      const r = await new Roll("2d6").evaluate();
      const key = r.total <= 2 ? "d2" : r.total === 3 ? "d3" : r.total <= 5 ? "d45" : r.total <= 9 ? "d69" : r.total <= 11 ? "d1011" : "d12";
      await r.toMessage({ speaker: ChatMessage.getSpeaker({ actor: this }), flavor: `<b>${game.i18n.localize("LAUNDRY.Talent.PropheticDreams")}</b>: ${game.i18n.localize(`LAUNDRY.Talent.Dream.${key}`)}` });
      if (key === "d2") await Luck.adjustThreat(1);
    }
  }

  async #refreshTalents(kind) {
    for (const tal of this.items.filter(i => i.type === "talent" && i.system.activation.uses === kind && i.system.used)) {
      await tal.update({ "system.used": false });
    }
  }

  /** Downtime: clear one space from one Injury. */
  async downtimeHeal(injuryId) {
    const inj = this.items.get(injuryId);
    if (!inj) return;
    const spaces = inj.system.spaces - 1;
    if (spaces <= 0) {
      await inj.delete();
      for (const e of this.effects.filter(e => e.origin === inj.uuid)) await e.delete();
    } else await inj.update({ "system.spaces": spaces });
  }

  /** Treat an Injury completely (Medic / Counsellor). */
  async treatInjury(injuryId) {
    const inj = this.items.get(injuryId);
    if (!inj) return;
    for (const e of this.effects.filter(e => e.origin === inj.uuid)) await e.delete();
    await inj.delete();
  }

  /* ---------------------------------------- */
  /*  Vehicles (OH p.117)                     */
  /* ---------------------------------------- */

  async #applyVehicleDamage(hit, { chat }) {
    const { vehicleDamage } = await import("../workflows/vehicle.mjs");
    return vehicleDamage(this, hit, { chat });
  }

  /* ---------------------------------------- */

  getRollData() {
    return { ...super.getRollData(), ...(this.system.getRollData?.() ?? {}) };
  }
}
