/**
 * Team Luck and Threat (OH p.95-98). Stored as world settings, changed through the GM.
 */
import { SYSTEM_ID } from "../config.mjs";
import { asGM, registerGMHandler } from "./socket.mjs";

export const THREAT_MIN = 1;
export const THREAT_MAX = 10;

export function registerLuckSettings() {
  const onChange = () => Hooks.callAll("laundryLuckThreatChanged", getLuckState());
  game.settings.register(SYSTEM_ID, "luck", { scope: "world", config: false, type: Number, default: 0, onChange });
  game.settings.register(SYSTEM_ID, "luckMaxBonus", { scope: "world", config: false, type: Number, default: 0, onChange });
  game.settings.register(SYSTEM_ID, "luckMaxOverride", {
    name: "LAUNDRY.Setting.LuckMaxOverride.Name", hint: "LAUNDRY.Setting.LuckMaxOverride.Hint",
    scope: "world", config: true, type: Number, default: 0, onChange
  });
  game.settings.register(SYSTEM_ID, "threat", { scope: "world", config: false, type: Number, default: 1, onChange });
}

/** Maximum Luck = number of player characters (actors of type character owned by a player). */
export function computeLuckMax() {
  const override = game.settings.get(SYSTEM_ID, "luckMaxOverride");
  if (override > 0) return override;
  const pcs = game.actors.filter(a => a.type === "character" && a.hasPlayerOwner).length;
  return pcs + game.settings.get(SYSTEM_ID, "luckMaxBonus");
}

export function getLuckState() {
  return {
    luck: game.settings.get(SYSTEM_ID, "luck"),
    luckMax: computeLuckMax(),
    threat: game.settings.get(SYSTEM_ID, "threat")
  };
}

async function postNote(key, data = {}) {
  const content = `<div class="laundry-note"><i class="fa-solid fa-clover"></i> ${game.i18n.format(key, data)}</div>`;
  return ChatMessage.create({ content, speaker: { alias: game.i18n.localize("LAUNDRY.LuckThreat.Title") } });
}

registerGMHandler("luck.set", async ({ luck, threat, reason }) => {
  const s = getLuckState();
  if (luck != null) await game.settings.set(SYSTEM_ID, "luck", Math.max(0, Math.min(s.luckMax, luck)));
  if (threat != null) await game.settings.set(SYSTEM_ID, "threat", Math.max(THREAT_MIN, Math.min(THREAT_MAX, threat)));
  if (reason) await postNote(reason, { luck: getLuckState().luck, threat: getLuckState().threat });
  return getLuckState();
});

registerGMHandler("luck.increaseMax", async () => {
  await game.settings.set(SYSTEM_ID, "luckMaxBonus", game.settings.get(SYSTEM_ID, "luckMaxBonus") + 1);
  const s = getLuckState();
  await game.settings.set(SYSTEM_ID, "luck", s.luckMax);
  await game.settings.set(SYSTEM_ID, "threat", Math.max(THREAT_MIN, s.threat - 1));
  await postNote("LAUNDRY.LuckThreat.MaxIncreased", getLuckState());
  return getLuckState();
});

export const Luck = {
  get state() { return getLuckState(); },

  /**
   * Spend Luck. Asks whether the team consented; without consent Threat rises by 1. OH p.96
   * @returns {Promise<boolean>} true if Luck was spent
   */
  async spend(amount = 1, { askConsent = true, reason = "LAUNDRY.LuckThreat.Spent" } = {}) {
    const s = getLuckState();
    if (s.luck < amount) {
      ui.notifications.warn("LAUNDRY.Notify.NoLuck", { localize: true });
      return false;
    }
    let consent = true;
    if (askConsent && game.users.filter(u => u.active && !u.isGM).length > 1) {
      consent = await foundry.applications.api.DialogV2.confirm({
        window: { title: "LAUNDRY.LuckThreat.ConsentTitle" },
        content: `<p>${game.i18n.localize("LAUNDRY.LuckThreat.ConsentQuestion")}</p>`,
        yes: { label: "LAUNDRY.LuckThreat.ConsentYes" },
        no: { label: "LAUNDRY.LuckThreat.ConsentNo" },
        rejectClose: false
      });
      if (consent === null) return false;
    }
    await asGM("luck.set", {
      luck: s.luck - amount,
      threat: consent ? null : s.threat + 1,
      reason: consent ? reason : "LAUNDRY.LuckThreat.SpentWithoutConsent"
    });
    return true;
  },

  async adjustLuck(delta, reason = "LAUNDRY.LuckThreat.LuckChanged") {
    return asGM("luck.set", { luck: getLuckState().luck + delta, reason });
  },

  async adjustThreat(delta, reason = "LAUNDRY.LuckThreat.ThreatChanged") {
    return asGM("luck.set", { threat: getLuckState().threat + delta, reason });
  },

  async refill(reason = "LAUNDRY.LuckThreat.Refilled") {
    return asGM("luck.set", { luck: computeLuckMax(), reason });
  },

  async increaseMax() {
    return asGM("luck.increaseMax", {});
  },

  /** End of adventure: Threat resets to 1. OH p.98 */
  async resetThreat() {
    return asGM("luck.set", { threat: 1, reason: "LAUNDRY.LuckThreat.ThreatReset" });
  }
};
