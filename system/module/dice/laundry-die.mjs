/**
 * The Laundry d6 — a custom die term ("dl"), so chat and Dice So Nice can
 * render bespoke faces: 1 is a tentacled eye (mishap risk), 6 the Laundry seal.
 *
 *   new Roll("5dl")
 */
import { SYSTEM_PATH } from "../config.mjs";

export class LaundryDie extends foundry.dice.terms.Die {
  constructor(termData = {}) {
    termData.faces = 6;
    super(termData);
  }

  static DENOMINATION = "l";

  get denomination() {
    return "dl";
  }

  /** Face image path for a result. */
  static faceImage(value) {
    const v = Math.max(1, Math.min(6, Number(value) || 1));
    return `${SYSTEM_PATH}/assets/dice/face-${v}.svg`;
  }

  getResultLabel(result) {
    return `<img class="laundry-die-face" src="${LaundryDie.faceImage(result.result)}" alt="${result.result}">`;
  }

  getResultCSS(result) {
    const css = super.getResultCSS(result);
    css.push("laundry-die");
    return css;
  }
}
