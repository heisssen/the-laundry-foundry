/**
 * Spellcasting, occult apps, mishaps, complications and K-Syndrome (OH p.134-157).
 */
import { SYSTEM_ID, SYSTEM_PATH } from "../config.mjs";
import { performTest, updateTestMessage, reevaluate } from "../dice/test.mjs";
import { castComplexity, castingTime, SPELL_MODIFICATIONS, kSyndromeResistComplexity, mishapInjurySeverity } from "../rules/magic.mjs";
import { lookup, MAGICAL_MISHAPS, COMPUTATIONAL_COMPLICATIONS } from "../rules/tables.mjs";
import { Luck } from "../helpers/luck.mjs";
import { findItem } from "../helpers/compendium.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Snapshot the user's current targets for a spell / app card. */
/** "1 action" / "10 minutes" / "2 hours" for a casting time in minutes. */
export function formatCastingTime(min) {
  const L = k => game.i18n.localize(k);
  if (min < 1) return `${Math.max(1, Math.round(min * 10))} ${L("LAUNDRY.TimeUnit.rounds")}`;
  if (min < 60) return `${+min.toFixed(1)} ${L("LAUNDRY.TimeUnit.minutes")}`;
  if (min < 1440) return `${+(min / 60).toFixed(1)} ${L("LAUNDRY.TimeUnit.hours")}`;
  return `${+(min / 1440).toFixed(1)} ${L("LAUNDRY.TimeUnit.days")}`;
}

export function snapshotTargets() {
  return [...game.user.targets].filter(t => t.actor).map(t => ({ uuid: t.actor.uuid, tokenUuid: t.document.uuid, name: t.name, img: t.document.texture.src }));
}

const TIME_IN_MINUTES = { rounds: 0.1, minutes: 1, hours: 60, days: 1440 };

export function hasTalent(actor, identifier) {
  return actor.items.some(i => i.type === "talent" && i.system.identifier === identifier);
}

export function casterMethods(actor) {
  const comp = hasTalent(actor, "computationalSorcerer");
  const trad = hasTalent(actor, "traditionalMagician");
  const out = {};
  if (comp) out.computational = "LAUNDRY.CastMethod.computational";
  if (trad) out.traditional = "LAUNDRY.CastMethod.traditional";
  if (comp || trad) out.mental = "LAUNDRY.CastMethod.mental";
  // NPCs with a Spellcaster trait can use any method.
  if (actor.type === "npc" && actor.system.spellcaster) {
    Object.assign(out, CONFIG.LAUNDRY.castingMethods);
  }
  return out;
}

export class CastDialog extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(actor, spell, options = {}) {
    super(options);
    this.actor = actor;
    this.spell = spell;
    const methods = casterMethods(actor);
    const devices = actor.items.filter(i => i.type === "gear" && i.system.isDevice && i.system.deviceState !== "bricked");
    this.config = {
      method: Object.keys(methods)[0] ?? "mental",
      device: devices[0]?.id ?? "",
      level: 1,
      mods: Object.fromEntries(Object.keys(SPELL_MODIFICATIONS).map(k => [k, 0])),
      special: spell.system.modifications.map(() => 0),
      empowered: false,
      fastCast: false,
      advantage: 0,
      bonusDice: 0,
      maximise: false,
      doubleTraining: false,
      rollMode: game.settings.get("core", "messageMode")
    };
    this.methods = methods;
    this.devices = devices;
    this.#resolve = null;
  }

  #resolve;

  static DEFAULT_OPTIONS = {
    tag: "form",
    classes: ["laundry", "laundry-dialog", "cast-dialog"],
    window: { title: "LAUNDRY.Cast.Title", icon: "fa-solid fa-hat-wizard" },
    position: { width: 480 },
    form: { handler: CastDialog.#onSubmit, closeOnSubmit: true },
    actions: { cancel: function () { this.close(); } }
  };

  static PARTS = { form: { template: `${SYSTEM_PATH}/templates/apps/cast-dialog.hbs` } };

  get title() { return `${game.i18n.localize("LAUNDRY.Cast.Title")}: ${this.spell.name}`; }

  static wait(actor, spell) {
    return new Promise(resolve => {
      const app = new this(actor, spell);
      app.#resolve = resolve;
      app.render({ force: true });
    });
  }

  compute() {
    const s = this.spell.system, c = this.config;
    const device = this.actor.items.get(c.device);
    const extra = s.modifications.reduce((sum, m, i) => sum + (m.complexity * (Number(c.special[i]) || 0)), 0);
    const complexity = castComplexity({
      level: Number(c.level), baseComplexity: s.complexity, modifications: c.mods, extraComplexity: extra,
      method: c.method, fastCast: c.fastCast, bugged: c.method === "computational" && device?.system.deviceState === "bugged",
      mentalArithmetic: hasTalent(this.actor, "mentalArithmetic")
    });
    const baseMinutes = (s.castingTime.value ?? 1) * (TIME_IN_MINUTES[s.castingTime.unit] ?? 1);
    const minutes = castingTime({
      minutes: baseMinutes, method: c.method, tech: device?.system.tech ?? "smartphone",
      halvings: Number(c.mods.halveCastingTime) || 0
    });
    const occult = this.actor.system.getSkill("occult").training;
    const levelRow = s.levels.find(l => c.level >= l.min && c.level <= l.max);
    return {
      dn: s.dn, complexity, minutes, timeLabel: formatCastingTime(minutes), device,
      empoweredDice: c.empowered ? occult : 0,
      levelEffect: levelRow?.effect ?? "",
      damage: levelRow?.damage ?? 0,
      damageType: levelRow?.damageType || "physical",
      forcedMishap: c.method === "mental",
      overheat: device?.system.deviceState === "overheat"
    };
  }

  async _prepareContext() {
    return {
      config: this.config,
      spell: this.spell,
      comp: this.compute(),
      methods: this.methods,
      devices: Object.fromEntries(this.devices.map(d => [d.id, `${d.name} (${game.i18n.localize(`LAUNDRY.Tech.${d.system.tech}`)})`])),
      levels: { 1: "1", 2: "2", 3: "3", 4: "4", 5: "5" },
      genericMods: Object.entries(SPELL_MODIFICATIONS).map(([k, m]) => ({ key: k, complexity: m.complexity, value: this.config.mods[k], label: `LAUNDRY.Cast.Mod.${k}` })),
      specialMods: this.spell.system.modifications.map((m, i) => ({ ...m, index: i, value: this.config.special[i] })),
      advantages: {
        "2": "LAUNDRY.Test.GreaterAdvantage", "1": "LAUNDRY.Test.Advantage", "0": "LAUNDRY.Test.Normal",
        "-1": "LAUNDRY.Test.Disadvantage", "-2": "LAUNDRY.Test.GreaterDisadvantage"
      },
      canMaximise: Luck.state.luck > 0,
      canDouble: !!game.combat?.started && (this.actor.system.adrenaline?.value ?? 0) > 0,
      rollModes: Object.fromEntries(Object.entries(CONFIG.ChatMessage.modes).map(([k, v]) => [k, v.label ?? v]))
    };
  }

  _onRender(ctx, opts) {
    super._onRender(ctx, opts);
    this.element.querySelectorAll("input, select").forEach(el => el.addEventListener("change", () => {
      this.#readForm();
      this.render();
    }));
  }

  #readForm() {
    const fd = foundry.utils.expandObject(new foundry.applications.ux.FormDataExtended(this.element).object);
    const c = this.config;
    c.method = fd.method ?? c.method;
    c.device = fd.device ?? c.device;
    c.level = Number(fd.level ?? c.level);
    for (const k of Object.keys(c.mods)) c.mods[k] = Math.max(0, Number(fd.mods?.[k] ?? 0));
    c.special = c.special.map((_, i) => Math.max(0, Number(fd.special?.[i] ?? 0)));
    c.empowered = !!fd.empowered;
    c.fastCast = !!fd.fastCast;
    c.maximise = !!fd.maximise;
    c.doubleTraining = !!fd.doubleTraining;
    c.advantage = Number(fd.advantage ?? 0);
    c.bonusDice = Math.max(0, Number(fd.bonusDice ?? 0));
    c.rollMode = fd.rollMode ?? c.rollMode;
  }

  static async #onSubmit() {
    this.#readForm();
    this.#resolve?.({ config: this.config, comp: this.compute() });
    this.#resolve = null;
  }

  async close(o) { this.#resolve?.(null); this.#resolve = null; return super.close(o); }
}

/** Cast a spell (Mind (Magic), DN X:L). */
export async function castSpell(actor, spell) {
  const methods = casterMethods(actor);
  if (!Object.keys(methods).length) {
    ui.notifications.warn("LAUNDRY.Notify.NoCastingTalent", { localize: true });
    return null;
  }
  const res = await CastDialog.wait(actor, spell);
  if (!res) return null;
  const { config: c, comp } = res;
  if (c.maximise && !(await Luck.spend(1, { reason: "LAUNDRY.LuckThreat.SpentMaximise" }))) return null;
  if (c.doubleTraining && !(await actor.spendAdrenaline(1))) c.doubleTraining = false;

  const levelLabel = game.i18n.format("LAUNDRY.Cast.LevelN", { n: c.level });
  const cfg = {
    kind: "cast",
    magic: c.fastCast ? "app" : "spell", // fast cast: each attempt only mishaps on 1s > 6s
    label: `${spell.name} — ${levelLabel}`,
    attribute: "mind",
    skill: "magic",
    dn: comp.dn,
    complexity: c.fastCast ? 999 : comp.complexity,
    advantage: c.advantage,
    bonusDice: c.bonusDice + comp.empoweredDice,
    doubleTraining: c.doubleTraining,
    maximise: c.maximise,
    spell: {
      uuid: spell.uuid, name: spell.name, img: spell.img, level: c.level, method: c.method,
      deviceId: comp.device?.id ?? null, deviceName: comp.device?.name ?? null,
      minutes: comp.minutes, timeLabel: comp.timeLabel, effect: comp.levelEffect,
      forcedMishap: comp.forcedMishap || comp.overheat,
      fastCast: c.fastCast,
      required: comp.complexity,
      mishapResolved: false,
      target: spell.system.target, range: spell.system.range, duration: spell.system.duration,
      damage: comp.damage, damageType: comp.damageType, ignoreArmour: spell.system.ignoreArmour,
      targets: comp.damage ? snapshotTargets() : []
    }
  };
  if (c.fastCast) {
    // Extended Test: each attempt uses an Action; Complexity tripled. OH p.143
    cfg.extended = { required: comp.complexity, total: 0, attempts: [] };
  }
  const message = await performTest(actor, cfg, { rollMode: c.rollMode });
  await finaliseCast(message);
  // Prognostication: every cast by a Laundry operative raises Threat. OH p.149
  if (spell.system.castThreat && actor.type === "character") {
    await Luck.adjustThreat(spell.system.castThreat, "LAUNDRY.LuckThreat.ThreatSpell");
  }
  return message;
}

/** After a cast roll (or reroll): handle forced mishaps and fast-cast progress. */
export async function finaliseCast(message) {
  const state = foundry.utils.deepClone(message.getFlag(SYSTEM_ID, "test"));
  if (!state || state.kind !== "cast") return;
  let changed = false;
  if (state.extended) {
    const ev = state.evaluation;
    const attemptNo = state.extended.attempts.length;
    if (state.extended.lastCounted !== state.rollId) {
      state.extended.attempts.push({ successes: ev.successes, mishap: ev.ones > ev.sixes });
      state.extended.total = state.extended.attempts.reduce((s, a) => s + a.successes, 0);
      state.extended.lastCounted = state.rollId ?? attemptNo;
      changed = true;
    }
    const zero = ev.successes === 0;
    state.extended.status = state.extended.total >= state.extended.required ? "success" : (zero ? "failure" : "ongoing");
    state.evaluation.mishap = (ev.ones > ev.sixes) || state.extended.status === "failure";
    state.evaluation.passed = state.extended.status === "success";
  }
  if (state.spell.forcedMishap && !state.evaluation.mishap) {
    state.evaluation.mishap = true;
    changed = true;
  }
  if (changed) await updateTestMessage(message, state);
}

/** Continue a fast-cast Extended Test with another attempt (uses an Action). */
export async function continueFastCast(message) {
  const state = foundry.utils.deepClone(message.getFlag(SYSTEM_ID, "test"));
  if (!state?.extended || state.extended.status !== "ongoing") return;
  const roll = await new Roll(`${state.pool}dl`).evaluate();
  const results = roll.dice[0].results.map(r => r.result);
  state.history.push({ type: "attempt", results: state.evaluation.results, successes: state.evaluation.successes });
  state.evaluation = reevaluate(state, { results });
  state.rollId = foundry.utils.randomID();
  state.spell.mishapResolved = false;
  await updateTestMessage(message, state, { extraRoll: roll });
  await finaliseCast(game.messages.get(message.id));
}

/** Activate a pre-written occult app: DN 4:1 Mind (Technology). OH p.135 */
export async function activateApp(actor, app) {
  const device = actor.items.get(app.system.installedOn) ?? actor.items.find(i => i.type === "gear" && i.system.isDevice);
  if (device && ["bricked", "fault", "lowPower", "reboot", "hacked"].includes(device.system.deviceState)) {
    ui.notifications.warn(game.i18n.format("LAUNDRY.Notify.DeviceUnavailable", { device: device.name, state: game.i18n.localize(`LAUNDRY.Complication.${device.system.deviceState}.name`) }));
    return null;
  }
  const spell = app.system.spell ? await findItem(app.system.spell, { type: "spell" }) : null;
  const row = spell?.system.levels.find(l => app.system.level >= l.min && app.system.level <= l.max);
  const damage = row?.damage ?? 0;
  return actor.rollTest({
    kind: "app",
    magic: "app",
    label: app.name,
    attribute: "mind",
    skill: "technology",
    dn: app.system.dn,
    complexity: app.system.complexity + (device?.system.deviceState === "bugged" ? 1 : 0),
    lockSkill: true,
    app: {
      uuid: app.uuid, name: app.name, level: app.system.level, spell: app.system.spell,
      deviceId: device?.id ?? null, deviceName: device?.name ?? null,
      forcedComplication: device?.system.deviceState === "overheat",
      description: app.system.description,
      damage, damageType: row?.damageType || "physical", ignoreArmour: !!spell?.system.ignoreArmour,
      targets: damage ? snapshotTargets() : []
    }
  });
}

/* ---------------------------------------------------------------- */
/*  Mishaps & complications                                          */
/* ---------------------------------------------------------------- */

async function tableMessage(actor, { titleKey, row, roll, rerollAction = null, extraHtml = "", flags = {} }) {
  const name = game.i18n.localize(`${titleKey}.${row.key}.name`);
  const effect = game.i18n.localize(`${titleKey}.${row.key}.effect`);
  const content = await foundry.applications.handlebars.renderTemplate(`${SYSTEM_PATH}/templates/chat/table-result.hbs`, {
    name, effect, total: roll.total, extraHtml, rerollAction,
    heading: game.i18n.localize(`${titleKey}.Title`)
  });
  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }), content, rolls: [roll],
    flags: { [SYSTEM_ID]: { table: { key: row.key, ...flags } } }
  });
}

/**
 * Roll on the Magical Mishap table and apply automatic effects.
 * @param {number} level  spell Level
 */
export async function rollMagicalMishap(actor, { level = 1, forcedTotal = null } = {}) {
  const roll = await new Roll("2d6").evaluate();
  const total = forcedTotal ?? roll.total;
  const row = lookup(MAGICAL_MISHAPS, total);
  let extra = "";
  if (row.threat) await Luck.adjustThreat(row.threat, "LAUNDRY.LuckThreat.ThreatMishap");
  if (row.injury) await actor.addInjury("psychological", mishapInjurySeverity(level), { cause: game.i18n.localize("LAUNDRY.Mishap.Title") });
  if (row.key === "outbreak" || row.key === "groundZero") extra = game.i18n.format("LAUNDRY.Mishap.HazardNote", { level });
  if (row.key === "darkFuture" && actor.type === "npc") {
    await Luck.adjustThreat(1, "LAUNDRY.LuckThreat.ThreatMishap");
    extra = game.i18n.localize("LAUNDRY.Mishap.NpcDread");
  }
  await tableMessage(actor, {
    titleKey: "LAUNDRY.Mishap", row, roll, extraHtml: extra,
    rerollAction: hasTalent(actor, "carefulCasting") ? "reroll-mishap" : null,
    flags: { level, actorUuid: actor.uuid, kind: "mishap" }
  });
  return row;
}

/** Roll on the Computational Complications table (OH p.136) and update the device. */
export async function rollComplication(actor, { deviceId = null } = {}) {
  const roll = await new Roll("2d6").evaluate();
  const row = lookup(COMPUTATIONAL_COMPLICATIONS, roll.total);
  const device = deviceId ? actor.items.get(deviceId) : null;
  const stateMap = { surge: "bricked", bricked: "bricked", fault: "fault", reboot: "reboot", bugged: "bugged", lowPower: "lowPower", overheat: "overheat", hack: "hacked" };
  if (device && stateMap[row.key]) await device.update({ "system.deviceState": stateMap[row.key] });
  let extra = "";
  if (row.zoneDamage) extra = game.i18n.format("LAUNDRY.Complication.SurgeNote", { damage: row.zoneDamage });
  await tableMessage(actor, {
    titleKey: "LAUNDRY.Complication", row, roll, extraHtml: extra,
    rerollAction: hasTalent(actor, "carefulCasting") ? "reroll-complication" : null,
    flags: { deviceId, actorUuid: actor.uuid, kind: "complication" }
  });
  return row;
}

/**
 * K-Syndrome resistance after a mishap: Mind (Zeal) DN 4:X. OH p.139
 */
export async function resistKSyndrome(actor) {
  if (actor.type !== "character") return null;
  const ks = actor.system.kSyndrome;
  const complexity = kSyndromeResistComplexity(ks.contracted || ks.mishaps ? ks.mishaps : 0);
  const message = await performTest(actor, {
    kind: "kResist",
    label: game.i18n.localize("LAUNDRY.KSyndrome.Resist"),
    attribute: "mind",
    skill: "zeal",
    dn: 4,
    complexity,
    kResist: { complexity, resolved: false, before: { mishaps: ks.mishaps, fails: ks.fails, contracted: ks.contracted } }
  });
  const state = foundry.utils.deepClone(message.getFlag(SYSTEM_ID, "test"));
  await resolveKResist(actor, message, state);
  return message;
}

export async function resolveKResist(actor, message, state) {
  if (state.kResist.resolved) return;
  // Absolute values from the pre-test snapshot keep Luck rerolls idempotent.
  const before = state.kResist.before ?? { mishaps: actor.system.kSyndrome.mishaps, fails: actor.system.kSyndrome.fails, contracted: actor.system.kSyndrome.contracted };
  const failed = !state.evaluation.passed;
  const fails = failed ? Math.min(6, before.fails + 1) : before.fails;
  await actor.update({
    "system.kSyndrome.mishaps": before.mishaps + 1,
    "system.kSyndrome.contracted": before.contracted || failed,
    "system.kSyndrome.fails": fails
  });
  state.kResist = { ...state.kResist, before, resolved: true, failed, stage: fails };
  await updateTestMessage(message, state);
}

/** Handle the mishap button on a cast / app card. */
export async function handleMishap(message, { useComplication = false } = {}) {
  const state = foundry.utils.deepClone(message.getFlag(SYSTEM_ID, "test"));
  const actor = await fromUuid(state.actorUuid);
  if (!actor || !state) return;
  if (state.kind === "app") {
    // Modder: ignore the first Computational Complication each mission. OH p.77
    if (hasTalent(actor, "modder") && actor.type === "character" && !actor.system.mission?.modderUsed) {
      await actor.update({ "system.mission.modderUsed": true });
      state.app.complicationResolved = true;
      await updateTestMessage(message, state);
      return ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content: `<div class="laundry-note">${game.i18n.localize("LAUNDRY.Talent.ModderNote")}</div>` });
    }
    await rollComplication(actor, { deviceId: state.app.deviceId });
    state.app.complicationResolved = true;
    await updateTestMessage(message, state);
    return;
  }
  if (useComplication) {
    if (actor.system.mission?.complicationUsed) return ui.notifications.warn("LAUNDRY.Notify.ComplicationUsed", { localize: true });
    await actor.update({ "system.mission.complicationUsed": true });
    await rollComplication(actor, { deviceId: state.spell.deviceId });
  } else {
    await rollMagicalMishap(actor, { level: state.spell.level });
  }
  state.spell.mishapResolved = true;
  await updateTestMessage(message, state);
  await resistKSyndrome(actor);
}

/** Careful Casting: spend Luck to reroll a mishap / complication table result. */
export async function rerollTable(message) {
  const t = message.getFlag(SYSTEM_ID, "table");
  if (!t || t.rerolled) return;
  const actor = await fromUuid(t.actorUuid);
  if (!actor) return;
  if (!(await Luck.spend(1, { reason: "LAUNDRY.LuckThreat.SpentCarefulCasting" }))) return;
  await message.setFlag(SYSTEM_ID, "table.rerolled", true);
  if (t.kind === "mishap") await rollMagicalMishap(actor, { level: t.level });
  else await rollComplication(actor, { deviceId: t.deviceId });
}
