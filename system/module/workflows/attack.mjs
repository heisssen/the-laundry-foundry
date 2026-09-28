/**
 * Attack workflow (OH p.106-112).
 */
import { SYSTEM_PATH } from "../config.mjs";
import { performTest } from "../dice/test.mjs";
import { attackDifficulty, CHARGE } from "../rules/combat.mjs";
import { Luck } from "../helpers/luck.mjs";
import { collectMods, summarise, hasTalent } from "../helpers/talent-mods.mjs";
import { zoneRange, zoneAttackMods, actorToken } from "../data/region-zone.mjs";
import { vehicleOf } from "../data/actor-team.mjs";
import { attackTalentMods, thrownRange, stripTraits } from "../helpers/talent-effects.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Resolve target actors from the user's targeted tokens. */
export function currentTargets() {
  return [...game.user.targets].map(t => t.document).filter(t => t.actor);
}

/** Estimate range band between two tokens from grid distance (Zones ≈ 10 m). */
export function estimateRange(fromToken, toToken) {
  // Zones drawn on the scene take priority: same Zone Short, adjacent Medium, etc. OH p.103
  const zr = zoneRange(fromToken?.document ?? fromToken, toToken?.document ?? toToken);
  if (zr) return zr.band;
  if (!fromToken || !toToken || !canvas?.ready) return "short";
  const a = fromToken.object ?? fromToken, b = toToken.object ?? toToken;
  if (!a?.center || !b?.center) return "short";
  const d = canvas.grid.measurePath([a.center, b.center]).distance;
  const units = canvas.scene.grid.units;
  const metres = units === "ft" ? d * 0.3048 : d;
  if (metres <= 2) return "close";
  if (metres <= 10) return "short";
  if (metres <= 18) return "medium";
  if (metres <= 35) return "long";
  return "extreme";
}

export class AttackDialog extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(actor, weapon, options = {}) {
    super(options);
    this.actor = actor;
    this.weapon = weapon;
    const myToken = actorToken(actor);
    const targets = currentTargets();
    const kind = weapon.system.kind;
    // Environmental Traits of the (first) target's Zone pre-fill cover and Disadvantage.
    const zam = zoneAttackMods(targets[0], { ranged: kind === "ranged" });
    // Aboard a vehicle: its design gives Partial / Total Cover (not against fellow passengers). OH p.118
    const ride = vehicleOf(targets[0]?.actor);
    if (ride && kind === "ranged" && ride !== vehicleOf(actor) && ride.system.cover !== "none") {
      const rank = { partial: 1, total: 2 };
      if ((rank[ride.system.cover] ?? 0) > (rank[zam.cover] ?? 0)) zam.cover = ride.system.cover;
      zam.applied.push(game.i18n.format("LAUNDRY.Vehicle.AboardCover", { name: ride.name }));
    }
    this.zoneApplied = zam.applied;
    this.config = {
      kind,
      thrown: false,
      range: targets[0] ? estimateRange(myToken, targets[0]) : (kind === "melee" ? "close" : "short"),
      cover: zam.cover ?? "",
      calledShot: "",
      charge: false,
      hidden: actor.statuses.has("hidden"),
      advantage: zam.advantage,
      bonusDice: 0,
      doubleTraining: false,
      maximise: false,
      attackMod: 0,
      defenceMod: 0,
      manualDefence: 1,
      dualWield: false,
      talentModIds: [],
      rollMode: game.settings.get("core", "messageMode")
    };
    this.targets = targets;
    this.#resolve = null;
  }

  #resolve;

  static DEFAULT_OPTIONS = {
    tag: "form",
    classes: ["laundry", "laundry-dialog", "attack-dialog"],
    window: { title: "LAUNDRY.Attack.Title", icon: "fa-solid fa-crosshairs" },
    position: { width: 460 },
    form: { handler: AttackDialog.#onSubmit, closeOnSubmit: true },
    actions: { cancel: function () { this.close(); } }
  };

  static PARTS = { form: { template: `${SYSTEM_PATH}/templates/apps/attack-dialog.hbs` } };

  get title() { return `${game.i18n.localize("LAUNDRY.Attack.Title")}: ${this.weapon.name}`; }

  static wait(actor, weapon) {
    return new Promise(resolve => {
      const app = new this(actor, weapon);
      app.#resolve = resolve;
      app.render({ force: true });
    });
  }

  /** Compute the attack parameters for the current config. */
  compute() {
    const actor = this.actor, w = this.weapon.system, c = this.config;
    const ranged = c.kind === "ranged" || c.thrown;
    const skill = ranged ? "ranged" : "closeCombat";
    const unarmed = w.identifier === "unarmed";
    const talentMods = collectMods(actor, { kind: "attack", skill, attribute: "body", weaponKind: ranged ? "ranged" : "melee", charge: c.charge, dualWield: c.dualWield, unarmed })
      .map(m => ({ ...m, checked: m.auto || c.talentModIds.includes(m.id) }));
    const tm = summarise(talentMods, c.talentModIds);
    this.talentMods = talentMods;
    this.talentSummary = tm;
    const attackStepBase = (w.step ?? (ranged ? actor.system.combat.accuracy : actor.system.combat.melee)) + tm.attackStep;
    const lastStand = actor.statuses.has("lastStand") ? 0 : 0; // already in combat steps via condition
    const targets = (this.targets.length ? this.targets : [null]).map(t => {
      const tal = t ? attackTalentMods(actor, t, { hidden: c.hidden }) : { defence: 0, attack: 0, hidden: null, notes: [] };
      const defenceStep = (t ? (t.actor.system.combat?.defence ?? 1) : Number(c.manualDefence)) + tal.defence;
      const r = attackDifficulty({
        kind: ranged ? "ranged" : "melee",
        attackStep: attackStepBase + lastStand + tal.attack,
        defenceStep,
        range: c.range,
        weaponRange: c.thrown ? thrownRange(actor, w.thrownRange || "short") : w.range,
        thrownImprovised: c.thrown && !w.traits.includes("thrown"),
        cover: c.cover || null,
        calledShot: c.calledShot || null,
        hidden: tal.hidden ?? c.hidden,
        targetProne: t?.actor?.statuses?.has("prone"),
        targetIncapacitated: t?.actor?.statuses?.has("incapacitated") || t?.actor?.statuses?.has("unconscious"),
        pointBlank: actor.items.some(i => i.system.identifier === "pointBlankRange"),
        attackMod: Number(c.attackMod) || 0,
        traits: [...w.traits, ...tm.traits],
        defenceMod: Number(c.defenceMod) || 0
      });
      return {
        uuid: t?.actor?.uuid ?? null,
        tokenUuid: t?.uuid ?? null,
        name: t?.name ?? game.i18n.localize("LAUNDRY.Attack.NoTarget"),
        img: t?.texture?.src ?? "icons/svg/mystery-man.svg",
        defenceStep: r.defenceStep,
        attackStep: r.attackStep,
        dn: r.dn,
        notes: [...r.notes, ...tal.notes]
      };
    });
    return { skill, ranged, targets, attackStepBase, talentMods, tm, unarmed, zoneApplied: this.zoneApplied ?? [] };
  }

  async _prepareContext() {
    const comp = this.compute();
    const inCombat = !!game.combat?.started;
    const w = this.weapon.system;
    return {
      config: this.config,
      weapon: this.weapon,
      comp,
      ranges: CONFIG.LAUNDRY.ranges,
      ladder: CONFIG.LAUNDRY.ladder,
      manualDefenceKey: String(this.config.manualDefence),
      covers: { "": "LAUNDRY.Attack.NoCover", partial: "LAUNDRY.Attack.PartialCover", total: "LAUNDRY.Attack.TotalCover" },
      calledShots: { "": "LAUNDRY.Attack.NoCalledShot", head: "LAUNDRY.Attack.Head", arms: "LAUNDRY.Attack.Arms", legs: "LAUNDRY.Attack.Legs" },
      advantages: {
        "2": "LAUNDRY.Test.GreaterAdvantage", "1": "LAUNDRY.Test.Advantage", "0": "LAUNDRY.Test.Normal",
        "-1": "LAUNDRY.Test.Disadvantage", "-2": "LAUNDRY.Test.GreaterDisadvantage"
      },
      canThrow: w.kind === "melee",
      canCharge: w.kind === "melee",
      canDouble: inCombat && (this.actor.system.adrenaline?.value ?? 0) > 0,
      canMaximise: Luck.state.luck > 0,
      hasTargets: this.targets.length > 0,
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
    const fd = new foundry.applications.ux.FormDataExtended(this.element).object;
    for (const [k, v] of Object.entries(fd)) {
      if (k in this.config) this.config[k] = typeof this.config[k] === "number" ? Number(v) : v;
    }
    for (const k of ["thrown", "charge", "hidden", "doubleTraining", "maximise", "dualWield"]) this.config[k] = !!fd[k];
    this.config.talentModIds = Object.entries(fd).filter(([k, v]) => k.startsWith("tm:") && v).map(([k]) => k.slice(3));
  }

  static async #onSubmit() {
    this.#readForm();
    this.#resolve?.({ config: this.config, comp: this.compute() });
    this.#resolve = null;
  }

  async close(o) { this.#resolve?.(null); this.#resolve = null; return super.close(o); }
}

/**
 * Roll an attack with a weapon.
 */
export async function rollAttack(actor, weapon, { skipDialog = false } = {}) {
  let res;
  if (skipDialog) {
    const app = new AttackDialog(actor, weapon);
    res = { config: app.config, comp: app.compute() };
  } else {
    res = await AttackDialog.wait(actor, weapon);
  }
  if (!res) return null;
  const { config: c, comp } = res;
  const w = weapon.system;

  if (c.maximise && !(await Luck.spend(1, { reason: "LAUNDRY.LuckThreat.SpentMaximise" }))) return null;
  if (c.doubleTraining && !(await actor.spendAdrenaline(1))) c.doubleTraining = false;
  if (c.charge) await actor.addCondition("charging");
  if (c.hidden) await actor.removeCondition("hidden");

  const primary = comp.targets[0];
  const bonusDamage = (actor.system.bonuses?.damage ?? 0) + comp.tm.damage
    + (c.calledShot && hasTalent(actor, "crackShot") ? 1 : 0);
  // Heavy Hitter: unarmed strikes deal 1 + S, gain Crushing, lose Ineffective. OH p.73
  let traits = stripTraits(actor, [...w.traits, ...comp.tm.traits]);
  let baseDamage = w.blast || w.damage;
  if (comp.unarmed && hasTalent(actor, "heavyHitter")) {
    baseDamage = Math.max(1, baseDamage);
    traits = [...new Set([...traits.filter(t => t !== "ineffective"), "crushing"])];
  }
  // In the Right Hands: sturdy improvised weapons lose Ineffective. OH p.74
  if (w.identifier === "improvised" && hasTalent(actor, "inTheRightHands")) traits = traits.filter(t => t !== "ineffective");

  const cfg = {
    kind: "attack",
    label: weapon.name,
    attribute: "body",
    skill: comp.skill,
    dn: primary.dn,
    complexity: 1,
    advantage: Number(c.advantage) || 0,
    bonusDice: (Number(c.bonusDice) || 0) + (c.charge ? CHARGE.bonusDice : 0),
    doubleTraining: c.doubleTraining,
    maximise: c.maximise,
    weaponKind: comp.ranged ? "ranged" : "melee",
    charge: c.charge,
    dualWield: c.dualWield,
    unarmed: comp.unarmed,
    talentModIds: c.talentModIds,
    zonesApplied: comp.zoneApplied ?? [],
    pool: w.pool ?? undefined,
    focus: w.focus ?? undefined,
    attack: {
      weaponUuid: weapon.uuid,
      weaponName: weapon.name,
      weaponImg: weapon.img,
      baseDamage,
      addSuccesses: w.blast ? false : w.addSuccesses,
      traits,
      damageType: w.damageType ?? "physical",
      bonusDamage,
      blast: w.blast,
      calledShot: c.calledShot,
      range: c.range,
      targets: comp.targets
    }
  };
  if (cfg.pool === undefined) delete cfg.pool;
  if (cfg.focus === undefined) delete cfg.focus;
  // Advantage/disadvantage is folded into the DN on the per-target line too.
  return performTest(actor, cfg, { rollMode: c.rollMode });
}
