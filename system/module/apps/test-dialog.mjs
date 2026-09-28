/**
 * Test configuration dialog with live dice-pool preview.
 */
import { SYSTEM_PATH } from "../config.mjs";
import { prepareTest } from "../dice/test.mjs";
import { getLuckState } from "../helpers/luck.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class TestDialog extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(actor, config, options = {}) {
    super(options);
    this.actor = actor;
    this.config = foundry.utils.mergeObject({
      kind: "test", attribute: "mind", skill: "", dn: 4, complexity: 1, advantage: 0,
      bonusDice: 0, penaltyDice: 0, doubleTraining: false, maximise: false, rollMode: game.settings.get("core", "messageMode")
    }, config);
    this.#resolve = null;
  }

  #resolve;

  static DEFAULT_OPTIONS = {
    tag: "form",
    classes: ["laundry", "laundry-dialog", "test-dialog"],
    window: { title: "LAUNDRY.Test.Title", icon: "fa-solid fa-dice-six", resizable: false },
    position: { width: 420 },
    form: { handler: TestDialog.#onSubmit, submitOnChange: false, closeOnSubmit: true },
    actions: { cancel: TestDialog.#onCancel }
  };

  static PARTS = {
    form: { template: `${SYSTEM_PATH}/templates/apps/test-dialog.hbs` }
  };

  get title() {
    return this.config.label ? `${game.i18n.localize("LAUNDRY.Test.Title")}: ${this.config.label}` : super.title;
  }

  /** Open the dialog and resolve with the final config (or null). */
  static wait(actor, config, options) {
    return new Promise(resolve => {
      const app = new this(actor, config, options);
      app.#resolve = resolve;
      app.render({ force: true });
    });
  }

  async _prepareContext() {
    const prepared = prepareTest(this.actor, this.config);
    const luck = getLuckState();
    const inCombat = !!game.combat?.started && !!game.combat.getCombatantsByActor?.(this.actor)?.length;
    const adrenaline = this.actor?.system?.adrenaline?.value ?? 0;
    return {
      config: this.config,
      prepared,
      attributes: CONFIG.LAUNDRY.attributes,
      skills: { "": "LAUNDRY.Test.NoSkill", ...CONFIG.LAUNDRY.skills },
      dns: { 2: "2", 3: "3", 4: "4", 5: "5", 6: "6" },
      advantages: {
        "2": "LAUNDRY.Test.GreaterAdvantage", "1": "LAUNDRY.Test.Advantage", "0": "LAUNDRY.Test.Normal",
        "-1": "LAUNDRY.Test.Disadvantage", "-2": "LAUNDRY.Test.GreaterDisadvantage"
      },
      rollModes: Object.fromEntries(Object.entries(CONFIG.ChatMessage.modes).map(([k, v]) => [k, v.label ?? v])),
      canDouble: inCombat && adrenaline > 0 && prepared.training > 0,
      adrenaline,
      canMaximise: luck.luck > 0,
      luck: luck.luck,
      lockAttribute: this.config.lockAttribute,
      lockSkill: this.config.lockSkill,
      showDN: this.config.kind !== "attack" || this.config.showDN,
      conditionsPool: prepared.breakdown.find(b => b.label === "LAUNDRY.Test.Conditions")?.value ?? 0,
      dnMod: prepared.dnMod
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    this.element.querySelectorAll("input, select").forEach(el => el.addEventListener("change", () => {
      this.#readForm();
      this.render();
    }));
  }

  #readForm() {
    const fd = new foundry.applications.ux.FormDataExtended(this.element).object;
    const num = (v, d = 0) => Number.isFinite(Number(v)) ? Number(v) : d;
    Object.assign(this.config, {
      attribute: fd.attribute ?? this.config.attribute,
      skill: fd.skill ?? this.config.skill,
      dn: num(fd.dn, this.config.dn),
      complexity: Math.max(1, num(fd.complexity, this.config.complexity)),
      advantage: num(fd.advantage, 0),
      bonusDice: Math.max(0, num(fd.bonusDice, 0)),
      penaltyDice: Math.max(0, num(fd.penaltyDice, 0)),
      doubleTraining: !!fd.doubleTraining,
      maximise: !!fd.maximise,
      applyConditions: fd.applyConditions !== undefined ? !!fd.applyConditions : this.config.applyConditions,
      rollMode: fd.rollMode ?? this.config.rollMode
    });
    this.config.talentModIds = Object.entries(fd).filter(([k, v]) => k.startsWith("tm:") && v).map(([k]) => k.slice(3));
    this.config.extra = { ...(this.config.extra ?? {}), ...Object.fromEntries(Object.entries(fd).filter(([k]) => k.startsWith("x_"))) };
  }

  static async #onSubmit() {
    this.#readForm();
    this.#resolve?.(this.config);
    this.#resolve = null;
  }

  static #onCancel() {
    this.close();
  }

  async close(options) {
    this.#resolve?.(null);
    this.#resolve = null;
    return super.close(options);
  }
}
