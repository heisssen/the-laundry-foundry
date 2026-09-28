/**
 * LaundryItem — `use()` dispatches to the right workflow.
 */
import { SYSTEM_PATH } from "../config.mjs";
import { parseDN } from "../data/fields.mjs";
import { skillCost } from "../rules/xp.mjs";

export class LaundryItem extends Item {

  async use({ event = null } = {}) {
    const actor = this.actor;
    switch (this.type) {
      case "weapon": {
        if (!actor) return this.toChat();
        const { rollAttack } = await import("../workflows/attack.mjs");
        return rollAttack(actor, this, { skipDialog: event?.shiftKey });
      }
      case "spell": {
        if (!actor) return this.toChat();
        const { castSpell } = await import("../workflows/magic.mjs");
        return castSpell(actor, this);
      }
      case "app": {
        if (!actor) return this.toChat();
        const { activateApp } = await import("../workflows/magic.mjs");
        return activateApp(actor, this);
      }
      case "talent": return this.#useTalent(event);
      case "assignment": {
        if (!actor) return this.toChat();
        const { CharacterCreator } = await import("../apps/character-creator.mjs");
        return new CharacterCreator(actor, { assignment: this }).render({ force: true });
      }
      default: return this.toChat();
    }
  }

  async #useTalent(event) {
    const a = this.system.activation;
    const actor = this.actor;
    if (actor && ["studiedDefence", "eyeInTheSky"].includes(this.system.identifier)) {
      const h = await import("../helpers/help.mjs");
      return this.system.identifier === "studiedDefence" ? h.studiedDefence(actor, this) : h.eyeInTheSky(actor, this);
    }
    if (actor && ["medicalTraining", "counsellor"].includes(this.system.identifier)) {
      const { healingTalent } = await import("../helpers/talent-effects.mjs");
      return healingTalent(actor, this);
    }
    if (actor && a.type !== "passive") {
      if (a.uses && this.system.used) {
        return ui.notifications.warn(game.i18n.format("LAUNDRY.Notify.TalentUsed", { name: this.name }));
      }
      if (a.adrenaline && !(await actor.spendAdrenaline(a.adrenaline))) return null;
      if (a.luck) {
        const { Luck } = await import("../helpers/luck.mjs");
        if (!(await Luck.spend(a.luck))) return null;
      }
      if (a.uses) await this.update({ "system.used": true });
      await this.toChat();
      // Optional attached Test, e.g. "4:1 spirit presence"
      const m = String(a.test ?? "").match(/(\d)\s*:\s*(\d+)\s+(\w+)\s*(\w+)?/);
      if (m) {
        return actor.rollTest({
          label: this.name, dn: Number(m[1]), complexity: Number(m[2]), attribute: m[3], skill: m[4] ?? ""
        }, { event });
      }
      return;
    }
    return this.toChat();
  }

  /** Post a description card to chat. */
  async toChat() {
    const content = await foundry.applications.handlebars.renderTemplate(`${SYSTEM_PATH}/templates/chat/item-card.hbs`, {
      item: this,
      system: this.system,
      description: await foundry.applications.ux.TextEditor.implementation.enrichHTML(this.system.description ?? "", { relativeTo: this }),
      requisition: this.system.requisition ? parseDN(this.system.requisition) : null,
      traits: (this.system.traits ?? []).map(t => game.i18n.localize(`LAUNDRY.Trait.${t}`)).join(", ")
    });
    return ChatMessage.create({ content, speaker: ChatMessage.getSpeaker({ actor: this.actor }) });
  }

  /** Requisition Test: Mind (Bureaucracy) or Mind/Spirit (Presence). OH p.122 */
  async requisition(actor, { skill = "bureaucracy" } = {}) {
    const { requisition } = await import("../workflows/requisition.mjs");
    return requisition(actor, this, { skill });
  }

  /* -------------------------------------------- */
  /*  Talent requirements (OH p.66)               */
  /* -------------------------------------------- */

  /** @returns {{met:boolean, missing:string[]}} */
  checkRequirements(actor) {
    if (this.type !== "talent") return { met: true, missing: [] };
    const r = this.system.requirements;
    const missing = [];
    for (const s of r.skills ?? []) {
      const ok = s.keys.some(k => {
        const sk = actor.system.getSkill(k);
        if (s.either) return sk.training >= Math.max(s.training, 1) || sk.focus >= Math.max(s.focus, 1);
        return sk.training >= s.training && sk.focus >= s.focus;
      });
      if (!ok) missing.push(`${s.keys.map(k => game.i18n.localize(`LAUNDRY.Skill.${k}`)).join("/")} T${s.training} F${s.focus}`);
    }
    for (const a of r.attributes ?? []) {
      if (actor.system.getAttribute(a.key) < a.value) missing.push(`${game.i18n.localize(`LAUNDRY.Attribute.${a.key}`)} ${a.value}`);
    }
    if (r.assignment && actor.system.details?.assignment && !r.assignment.split(/[,/]/).map(s => s.trim().toLowerCase()).includes(actor.system.details.assignment.toLowerCase())) {
      missing.push(r.assignment);
    }
    return { met: missing.length === 0, missing };
  }
}

export { skillCost };
