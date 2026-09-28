/**
 * Floating Luck / Threat tracker visible to everyone.
 */
import { SYSTEM_PATH } from "../config.mjs";
import { getLuckState, Luck } from "../helpers/luck.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class LuckThreatHUD extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "laundry-luck-hud",
    classes: ["laundry", "luck-hud"],
    window: { frame: false, positioned: true },
    position: { width: "auto", height: "auto" },
    actions: {
      luck: LuckThreatHUD.#luck,
      threat: LuckThreatHUD.#threat,
      luckTest: LuckThreatHUD.#luckTest,
      toolkit: LuckThreatHUD.#toolkit,
      collapse: LuckThreatHUD.#collapse
    }
  };

  static PARTS = { hud: { template: `${SYSTEM_PATH}/templates/apps/luck-hud.hbs` } };

  collapsed = false;

  async _prepareContext() {
    const s = getLuckState();
    return {
      ...s,
      isGM: game.user.isGM,
      collapsed: this.collapsed,
      luckPips: Array.from({ length: Math.max(s.luckMax, s.luck) }, (_, i) => ({ filled: i < s.luck })),
      threatPips: Array.from({ length: 10 }, (_, i) => ({ n: i + 1, filled: i < s.threat, level: i < 3 ? "low" : i < 7 ? "mid" : "high" })),
      threatLevel: s.threat <= 3 ? "low" : s.threat <= 7 ? "mid" : "high"
    };
  }

  _onFirstRender(ctx, opts) {
    super._onFirstRender(ctx, opts);
    Hooks.on("laundryLuckThreatChanged", () => this.render());
  }

  _onRender(ctx, opts) {
    super._onRender(ctx, opts);
  }

  static #luck(e, t) {
    const d = t.dataset.delta;
    if (d === "refill") return Luck.refill();
    return Luck.adjustLuck(Number(d));
  }
  static #threat(e, t) { return Luck.adjustThreat(Number(t.dataset.delta)); }
  static async #luckTest() { const { luckTest } = await import("../workflows/gm-tools.mjs"); return luckTest(); }
  static async #toolkit() {
    const { GMToolkit } = await import("../workflows/gm-tools.mjs");
    return new GMToolkit().render({ force: true });
  }
  static #collapse() { this.collapsed = !this.collapsed; this.render(); }
}
