/**
 * Induction — interactive step-by-step character creation (OH p.16-36).
 *
 *  0 Briefing · 1 Assignment · 2 Attributes · 3 Skills · 4 Talents · 5 Spells
 *  6 Equipment · 7 Personal details · 8 Background · 9 Review & file
 *
 * A live dossier preview (derived stats, XP budget, choices) accompanies every step.
 */
import { SYSTEM_PATH } from "../config.mjs";
import { SKILLS, SKILL_DEFAULT_ATTRIBUTE, computeDerived } from "../rules/derived.mjs";
import { attributeCost, skillCost, TALENT_COST, CUSTOM_CREATION } from "../rules/xp.mjs";
import { FEATURES, GOAL_EXAMPLES, QUESTIONNAIRE, lookupRow, AGE_FORMULA } from "../rules/creation.mjs";
import { findItem, systemPacks } from "../helpers/compendium.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const STEPS = [
  { id: "briefing", icon: "fa-solid fa-envelope-open-text" },
  { id: "assignment", icon: "fa-solid fa-sitemap" },
  { id: "attributes", icon: "fa-solid fa-person" },
  { id: "skills", icon: "fa-solid fa-list-check" },
  { id: "talents", icon: "fa-solid fa-star" },
  { id: "spells", icon: "fa-solid fa-hat-wizard" },
  { id: "equipment", icon: "fa-solid fa-briefcase" },
  { id: "details", icon: "fa-solid fa-id-card" },
  { id: "background", icon: "fa-solid fa-clipboard-question" },
  { id: "review", icon: "fa-solid fa-stamp" }
];

const emptySkills = () => Object.fromEntries(SKILLS.map(k => [k, { training: 0, focus: 0 }]));
const caster = names => names.some(n => /computational sorcerer|traditional magician/i.test(n));

/** Load compendium indices once per session. */
let INDEX = null;
async function loadIndex() {
  if (INDEX) return INDEX;
  const fields = ["system", "type", "img"];
  const all = [];
  for (const pack of systemPacks("Item")) {
    const idx = await pack.getIndex({ fields });
    for (const e of idx) all.push({ ...e, uuid: `Compendium.${pack.collection}.Item.${e._id}` });
  }
  INDEX = {
    assignments: all.filter(e => e.type === "assignment").sort((a, b) => a.name.localeCompare(b.name)),
    talents: all.filter(e => e.type === "talent" && e.system?.category !== "trait").sort((a, b) => a.name.localeCompare(b.name)),
    spells: all.filter(e => e.type === "spell").sort((a, b) => a.name.localeCompare(b.name)),
    items: all
  };
  return INDEX;
}

/** Check a talent's structured requirements against in-progress stats. */
function requirementStatus(talent, attrs, skills) {
  const r = talent.system?.requirements ?? {};
  const missing = [];
  for (const s of r.skills ?? []) {
    const ok = (s.keys ?? []).some(k => {
      const sk = skills[k] ?? { training: 0, focus: 0 };
      if (s.either) return sk.training >= Math.max(1, s.training) || sk.focus >= Math.max(1, s.focus);
      return sk.training >= s.training && sk.focus >= s.focus;
    });
    if (!ok) missing.push(`${(s.keys ?? []).map(k => game.i18n.localize(`LAUNDRY.Skill.${k}`)).join("/")}${s.training ? ` T${s.training}` : ""}${s.focus ? ` F${s.focus}` : ""}`);
  }
  for (const a of r.attributes ?? []) {
    if ((attrs[a.key] ?? 0) < a.value) missing.push(`${game.i18n.localize(`LAUNDRY.Attribute.${a.key}`)} ${a.value}`);
  }
  if (r.other) missing.push(r.other);
  return { met: missing.length === 0, missing };
}

export class CharacterCreator extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(actor, { assignment = null } = {}, options = {}) {
    super(options);
    this.actor = actor;
    const d = actor.system.details;
    this.wiz = {
      step: assignment ? 2 : 0,
      maxStep: assignment ? 2 : 0,
      mode: "assignment",
      assignmentUuid: assignment?.uuid ?? "",
      deptFilter: "",
      swap: [],
      swapPairs: [],
      attributes: { ...CUSTOM_CREATION.attributes },
      skills: emptySkills(),
      talents: [],
      spells: [],
      talentFilter: "",
      showAllTalents: false,
      name: actor.name,
      codename: d.codename, nickname: d.nickname, age: d.age, img: actor.img,
      eyes: d.eyes, hair: d.hair, features: d.features,
      goalShort: d.goals.short, goalLong: d.goals.long,
      connections: d.connections,
      answers: Object.fromEntries(QUESTIONNAIRE.map(q => [q.key, ""]))
    };
    this._assignmentDoc = assignment;
  }

  static DEFAULT_OPTIONS = {
    id: "laundry-induction-{id}",
    tag: "form",
    classes: ["laundry", "laundry-dialog", "induction"],
    window: { title: "LAUNDRY.Creator.Title", icon: "fa-solid fa-id-badge", resizable: true },
    position: { width: 1080, height: 820 },
    form: { handler: CharacterCreator.#onSubmit, submitOnChange: false, closeOnSubmit: false },
    actions: {
      goto: CharacterCreator.#goto, next: CharacterCreator.#next, back: CharacterCreator.#back,
      mode: CharacterCreator.#setMode, pickAssignment: CharacterCreator.#pickAssignment, dept: CharacterCreator.#dept,
      swapAttr: CharacterCreator.#swapAttr, resetSwap: CharacterCreator.#resetSwap,
      attr: CharacterCreator.#attr, skill: CharacterCreator.#skill,
      toggleTalent: CharacterCreator.#toggleTalent, toggleSpell: CharacterCreator.#toggleSpell, allTalents: CharacterCreator.#allTalents,
      rollAge: CharacterCreator.#rollAge, rollFeature: CharacterCreator.#rollFeature, rollGoal: CharacterCreator.#rollGoal,
      rollQuestion: CharacterCreator.#rollQuestion, rollAll: CharacterCreator.#rollAll,
      pickImage: CharacterCreator.#pickImage, finish: CharacterCreator.#finish, reset: CharacterCreator.#reset
    }
  };

  static PARTS = { main: { template: `${SYSTEM_PATH}/templates/apps/character-creator.hbs`, scrollable: [".induction-body", ".dossier"] } };

  get title() { return `${game.i18n.localize("LAUNDRY.Creator.Title")}: ${this.wiz.name}`; }

  /* ---------------------------------------------------------------- */

  async #assignment() {
    const u = this.wiz.assignmentUuid;
    if (!u || this.wiz.mode !== "assignment") return null;
    if (this._assignmentDoc?.uuid !== u) this._assignmentDoc = await fromUuid(u);
    return this._assignmentDoc;
  }

  /** Everything derived from the current state. */
  async #compute() {
    const s = this.wiz;
    const a = await this.#assignment();
    let attrs, budget, spent = 0;
    const base = emptySkills();
    if (a) {
      attrs = { ...a.system.attributes };
      for (const [x, y] of s.swapPairs) [attrs[x], attrs[y]] = [attrs[y], attrs[x]];
      if (a.system.coreSkill) base[a.system.coreSkill] = { training: 1, focus: 1 };
      budget = a.system.xp;
    } else {
      attrs = { ...s.attributes };
      budget = CUSTOM_CREATION.xp;
      for (const k of ["body", "mind", "spirit"]) spent += attributeCost(1, attrs[k]);
    }
    const skills = {};
    let skillSpent = 0;
    for (const k of SKILLS) {
      const add = s.skills[k];
      skills[k] = { training: base[k].training + add.training, focus: base[k].focus + add.focus };
      skillSpent += skillCost(base[k].training, skills[k].training) + skillCost(base[k].focus, skills[k].focus);
    }
    spent += skillSpent;
    const talentSpent = a ? 0 : s.talents.length * TALENT_COST;
    spent += talentSpent;
    const derived = computeDerived({ attributes: attrs, skills });
    const coreNames = a?.system.coreTalents ?? [];
    const idx = await loadIndex();
    const chosenTalents = s.talents.map(u => idx.talents.find(t => t.uuid === u)).filter(Boolean);
    const isCaster = caster([...coreNames, ...chosenTalents.map(t => t.name)]);
    return { a, attrs, base, skills, budget, spent, skillSpent, talentSpent, remaining: budget - spent, derived, coreNames, chosenTalents, isCaster, idx };
  }

  async _prepareContext() {
    const s = this.wiz;
    const c = await this.#compute();
    const stepId = STEPS[s.step].id;
    const ladder = CONFIG.LAUNDRY.ladderKeys;
    const ctx = {
      s, c, stepId,
      steps: STEPS.map((st, i) => ({
        ...st, index: i, label: `LAUNDRY.Creator.Step.${st.id}`,
        active: i === s.step, done: i < s.step, reachable: i <= s.maxStep,
        skipped: st.id === "spells" && !c.isCaster
      })),
      isFirst: s.step === 0, isLast: s.step === STEPS.length - 1,
      overBudget: c.remaining < 0,
      xpPct: c.budget ? Math.max(0, Math.min(100, Math.round(100 * c.spent / c.budget))) : 0,
      dossier: {
        attrs: ["body", "mind", "spirit"].map(k => ({ key: k, label: `LAUNDRY.Attribute.${k}`, value: c.attrs[k] })),
        stats: [
          { label: "LAUNDRY.Stat.melee", value: game.i18n.localize(`LAUNDRY.Ladder.${ladder[c.derived.melee]}`) },
          { label: "LAUNDRY.Stat.accuracy", value: game.i18n.localize(`LAUNDRY.Ladder.${ladder[c.derived.accuracy]}`) },
          { label: "LAUNDRY.Stat.defence", value: game.i18n.localize(`LAUNDRY.Ladder.${ladder[c.derived.defence]}`) },
          { label: "LAUNDRY.Stat.toughness", value: c.derived.toughness },
          { label: "LAUNDRY.Stat.injuries", value: c.derived.injuries },
          { label: "LAUNDRY.Stat.adrenaline", value: c.derived.adrenaline },
          { label: "LAUNDRY.Stat.initiative", value: c.derived.initiative },
          { label: "LAUNDRY.Stat.naturalAwareness", value: c.derived.naturalAwareness }
        ],
        skills: SKILLS.filter(k => c.skills[k].training || c.skills[k].focus).map(k => ({
          label: `LAUNDRY.Skill.${k}`, training: c.skills[k].training, focus: c.skills[k].focus, core: c.a?.system.coreSkill === k
        })),
        talents: [...c.coreNames.map(n => ({ name: n, core: true })), ...c.chosenTalents.map(t => ({ name: t.name }))]
      }
    };

    if (stepId === "assignment") {
      const depts = {};
      for (const e of c.idx.assignments) {
        const d = e.system.department;
        if (s.deptFilter && d !== s.deptFilter) continue;
        (depts[d] ??= []).push({
          ...e, selected: e.uuid === s.assignmentUuid,
          coreLabel: e.system.coreSkill ? `LAUNDRY.Skill.${e.system.coreSkill}` : "",
          attrs: [e.system.attributes.body, e.system.attributes.mind, e.system.attributes.spirit]
        });
      }
      ctx.departments = Object.entries(depts).map(([key, list]) => ({ key, label: `LAUNDRY.Department.${key}`, list }));
      ctx.deptOptions = [...new Set(c.idx.assignments.map(e => e.system.department))].map(k => ({ key: k, label: `LAUNDRY.Department.${k}`, active: s.deptFilter === k }));
      ctx.selected = c.a;
      ctx.selectedDescription = c.a ? await foundry.applications.ux.TextEditor.implementation.enrichHTML(c.a.system.description) : "";
    }

    if (stepId === "attributes") {
      ctx.attrCards = ["body", "mind", "spirit"].map(k => ({
        key: k, label: `LAUNDRY.Attribute.${k}`, hint: `LAUNDRY.Creator.AttrHint.${k}`, value: c.attrs[k],
        swapping: s.swap.includes(k),
        pips: [1, 2, 3, 4].map(n => ({ n, filled: n <= c.attrs[k] })),
        nextCost: attributeCost(c.attrs[k], c.attrs[k] + 1)
      }));
      ctx.swapped = s.swapPairs.length > 0;
    }

    if (stepId === "skills") {
      const allowed = c.a ? new Set([c.a.system.coreSkill, ...c.a.system.skillOptions]) : null;
      ctx.skillRows = SKILLS.map(k => {
        const sk = c.skills[k];
        const isAllowed = !allowed || allowed.has(k);
        return {
          key: k, label: `LAUNDRY.Skill.${k}`, attr: `LAUNDRY.AttributeAbbr.${SKILL_DEFAULT_ATTRIBUTE[k]}`,
          training: sk.training, focus: sk.focus, core: c.a?.system.coreSkill === k, allowed: isAllowed,
          pool: c.attrs[SKILL_DEFAULT_ATTRIBUTE[k]] + sk.training,
          tPips: [1, 2, 3].map(n => ({ n, filled: n <= sk.training, base: n <= c.base[k].training })),
          fPips: [1, 2, 3].map(n => ({ n, filled: n <= sk.focus, base: n <= c.base[k].focus })),
          tCost: skillCost(sk.training, sk.training + 1), fCost: skillCost(sk.focus, sk.focus + 1),
          canUpT: isAllowed && sk.training < 3, canUpF: isAllowed && sk.focus < 3,
          canDownT: s.skills[k].training > 0, canDownF: s.skills[k].focus > 0
        };
      }).sort((x, y) => (y.core - x.core) || (y.allowed - x.allowed) || game.i18n.localize(x.label).localeCompare(game.i18n.localize(y.label)));
    }

    if (stepId === "talents") {
      const optional = (c.a?.system.optionalTalents ?? []).map(n => n.toLowerCase());
      const coreSet = new Set(c.coreNames.map(n => n.toLowerCase()));
      const pool = c.a && !s.showAllTalents
        ? c.idx.talents.filter(t => optional.includes(t.name.toLowerCase()))
        : c.idx.talents;
      const f = s.talentFilter.toLowerCase();
      ctx.talentCards = pool
        .filter(t => !coreSet.has(t.name.toLowerCase()))
        .filter(t => !f || t.name.toLowerCase().includes(f) || (t.system.description ?? "").toLowerCase().includes(f))
        .map(t => {
          const req = requirementStatus(t, c.attrs, c.skills);
          return {
            ...t, selected: s.talents.includes(t.uuid), req,
            recommended: optional.includes(t.name.toLowerCase()),
            reqText: t.system.requirements?.text || "None",
            description: t.system.description, hasMods: (t.system.modifiers ?? []).length > 0
          };
        });
      ctx.coreCards = c.coreNames.map(n => c.idx.talents.find(t => t.name.toLowerCase() === n.toLowerCase()) ?? { name: n, system: {} });
      ctx.choices = c.a?.system.talentChoices ?? 0;
      ctx.chosenCount = s.talents.length;
      ctx.tooMany = c.a && s.talents.length > ctx.choices;
    }

    if (stepId === "spells") {
      const groups = {};
      for (const sp of c.idx.spells) {
        (groups[sp.system.group] ??= []).push({ ...sp, selected: s.spells.includes(sp.uuid), dn: sp.system.dn, time: sp.system.castingTime, description: sp.system.description });
      }
      ctx.spellGroups = Object.entries(groups).map(([k, list]) => ({ key: k, label: `LAUNDRY.SpellGroup.${k}`, list }));
      ctx.spellLimit = 4 + Math.max(0, c.coreNames.concat(c.chosenTalents.map(t => t.name)).filter(n => /sorcerer|magician/i.test(n)).length - 1) * 2;
      ctx.spellCount = s.spells.length;
      ctx.spellNote = c.a?.system.description?.match(/<strong>Spells:<\/strong>([^<]+)/)?.[1] ?? "";
    }

    if (stepId === "equipment") {
      ctx.equipment = (c.a?.system.equipment ?? []).map(n => {
        const hit = c.idx.items.find(i => i.name.toLowerCase() === n.toLowerCase());
        return { name: n, img: hit?.img ?? "icons/svg/item-bag.svg", found: !!hit, description: hit?.system?.description ?? "" };
      });
    }

    if (stepId === "details") {
      ctx.featureCols = Object.entries(FEATURES).map(([k, list]) => ({ key: k, label: `LAUNDRY.Creator.Feature.${k}`, list }));
      ctx.goalExamples = GOAL_EXAMPLES;
    }

    if (stepId === "background") {
      ctx.questions = QUESTIONNAIRE.map((q, i) => ({ ...q, n: i + 1, answer: s.answers[q.key], dice: q.table.dice }));
    }

    if (stepId === "review") {
      ctx.warnings = [];
      if (c.remaining < 0) ctx.warnings.push("LAUNDRY.Creator.OverBudget");
      if (c.remaining > 0) ctx.warnings.push("LAUNDRY.Creator.XPLeft");
      if (c.a && s.talents.length < (c.a.system.talentChoices ?? 0)) ctx.warnings.push("LAUNDRY.Creator.FewTalents");
      if (c.isCaster && s.spells.length < 4) ctx.warnings.push("LAUNDRY.Creator.FewSpells");
      if (!c.a && s.mode === "assignment") ctx.warnings.push("LAUNDRY.Creator.NoAssignmentChosen");
      ctx.answers = QUESTIONNAIRE.filter(q => s.answers[q.key]).map(q => ({ q: q.q, a: s.answers[q.key] }));
      ctx.spellsChosen = s.spells.map(u => c.idx.spells.find(x => x.uuid === u)?.name).filter(Boolean);
    }
    return ctx;
  }

  _onRender(ctx, opts) {
    super._onRender(ctx, opts);
    // Text inputs update state without a full re-render (keeps focus).
    this.element.querySelectorAll("[data-field]").forEach(el => {
      el.addEventListener("change", ev => {
        const f = ev.currentTarget.dataset.field;
        foundry.utils.setProperty(this.wiz, f, ev.currentTarget.value);
        if (ev.currentTarget.dataset.rerender !== undefined) this.render();
      });
    });
    const search = this.element.querySelector("[data-search]");
    search?.addEventListener("input", foundry.utils.debounce(ev => {
      this.wiz.talentFilter = ev.target.value;
      this.render().then(() => {
        const el = this.element.querySelector("[data-search]");
        el?.focus(); el?.setSelectionRange(el.value.length, el.value.length);
      });
    }, 250));
  }

  static async #onSubmit() {}

  /* ---------------- navigation ---------------- */

  async #go(step) {
    const c = await this.#compute();
    // Skip the spells step for non-casters.
    if (STEPS[step]?.id === "spells" && !c.isCaster) step += (step > this.wiz.step ? 1 : -1);
    step = Math.max(0, Math.min(STEPS.length - 1, step));
    if (STEPS[this.wiz.step].id === "assignment" && step > this.wiz.step && this.wiz.mode === "assignment" && !this.wiz.assignmentUuid) {
      return ui.notifications.warn("LAUNDRY.Creator.NoAssignmentChosen", { localize: true });
    }
    this.wiz.step = step;
    this.wiz.maxStep = Math.max(this.wiz.maxStep, step);
    this.render();
  }

  static #goto(e, t) { const i = Number(t.dataset.index); if (i <= this.wiz.maxStep) this.#go(i); }
  static #next() { this.#go(this.wiz.step + 1); }
  static #back() { this.#go(this.wiz.step - 1); }

  static #setMode(e, t) {
    const mode = t.dataset.mode;
    if (mode === this.wiz.mode) return this.#go(1);
    Object.assign(this.wiz, { mode, skills: emptySkills(), talents: [], swap: [], swapPairs: [], attributes: { ...CUSTOM_CREATION.attributes } });
    this.#go(mode === "custom" ? 2 : 1);
  }

  static #pickAssignment(e, t) {
    if (this.wiz.assignmentUuid === t.dataset.uuid) return;
    Object.assign(this.wiz, { assignmentUuid: t.dataset.uuid, skills: emptySkills(), talents: [], swap: [], swapPairs: [] });
    this.render();
  }

  static #dept(e, t) {
    this.wiz.deptFilter = this.wiz.deptFilter === t.dataset.dept ? "" : t.dataset.dept;
    this.render();
  }

  /* ---------------- attributes ---------------- */

  /** Assignment mode: click two Attributes to swap them (only one swap allowed). */
  static #swapAttr(e, t) {
    if (this.wiz.mode !== "assignment") return;
    const k = t.dataset.key;
    if (this.wiz.swapPairs.length) return ui.notifications.info("LAUNDRY.Creator.OneSwap", { localize: true });
    const sw = this.wiz.swap;
    if (sw.includes(k)) sw.splice(sw.indexOf(k), 1); else sw.push(k);
    if (sw.length === 2) { this.wiz.swapPairs = [[sw[0], sw[1]]]; this.wiz.swap = []; }
    this.render();
  }

  static #resetSwap() { this.wiz.swap = []; this.wiz.swapPairs = []; this.render(); }

  static #attr(e, t) {
    const { key, delta } = t.dataset;
    const v = this.wiz.attributes[key] + Number(delta);
    if (v < 1 || v > 4) return;
    this.wiz.attributes[key] = v;
    this.render();
  }

  /* ---------------- skills / talents / spells ---------------- */

  static async #skill(e, t) {
    const { key, kind, delta } = t.dataset;
    const cur = this.wiz.skills[key][kind] + Number(delta);
    if (cur < 0) return;
    const c = await this.#compute();
    if (c.skills[key][kind] + Number(delta) > 3) return;
    this.wiz.skills[key][kind] = cur;
    this.render();
  }

  static #toggleTalent(e, t) {
    const u = t.closest("[data-uuid]").dataset.uuid;
    const set = new Set(this.wiz.talents);
    set.has(u) ? set.delete(u) : set.add(u);
    this.wiz.talents = [...set];
    this.render();
  }

  static #allTalents() { this.wiz.showAllTalents = !this.wiz.showAllTalents; this.render(); }

  static async #toggleSpell(e, t) {
    const u = t.closest("[data-uuid]").dataset.uuid;
    const set = new Set(this.wiz.spells);
    if (set.has(u)) set.delete(u);
    else {
      const ctx = await this._prepareContext();
      if (set.size >= (ctx.spellLimit ?? 4)) return ui.notifications.info("LAUNDRY.Creator.SpellLimit", { localize: true });
      set.add(u);
    }
    this.wiz.spells = [...set];
    this.render();
  }

  /* ---------------- details / background ---------------- */

  static async #rollAge() {
    const r = await new Roll(AGE_FORMULA).evaluate();
    this.wiz.age = String(r.total);
    this.render();
  }

  static #rollFeature(e, t) {
    const key = t.dataset.key;
    const pick = list => list[Math.floor(Math.random() * 6)];
    const v = pick(FEATURES[key]);
    if (key === "eyes") this.wiz.eyes = v === "Heterochromia" ? `${pick(FEATURES.eyes.slice(0, 5))} / ${pick(FEATURES.eyes.slice(0, 5))}` : v;
    else if (key === "hair") this.wiz.hair = v;
    else this.wiz.features = [this.wiz.features, v].filter(Boolean).join("; ");
    this.render();
  }

  static #rollGoal(e, t) {
    const kind = t.dataset.kind;
    const list = GOAL_EXAMPLES[kind];
    this.wiz[kind === "short" ? "goalShort" : "goalLong"] = list[Math.floor(Math.random() * list.length)];
    this.render();
  }

  static async #rollQuestion(e, t) {
    const q = QUESTIONNAIRE.find(x => x.key === t.dataset.key);
    const r = await new Roll(q.table.dice).evaluate();
    this.wiz.answers[q.key] = lookupRow(q.table.rows, r.total);
    this.render();
  }

  static async #rollAll() {
    for (const q of QUESTIONNAIRE) {
      if (this.wiz.answers[q.key]) continue;
      const r = await new Roll(q.table.dice).evaluate();
      this.wiz.answers[q.key] = lookupRow(q.table.rows, r.total);
    }
    this.render();
  }

  static #pickImage() {
    new foundry.applications.apps.FilePicker.implementation({
      type: "image", current: this.wiz.img,
      callback: path => { this.wiz.img = path; this.render(); }
    }).browse();
  }

  static #reset() {
    Object.assign(this.wiz, { skills: emptySkills(), talents: [], spells: [], swap: [], swapPairs: [], attributes: { ...CUSTOM_CREATION.attributes } });
    this.render();
  }

  /* ---------------- finish ---------------- */

  static async #finish() {
    const c = await this.#compute();
    const s = this.wiz;
    if (c.remaining < 0) return ui.notifications.error("LAUNDRY.Creator.OverBudget", { localize: true });
    if (s.mode === "assignment" && !c.a) return ui.notifications.error("LAUNDRY.Creator.NoAssignmentChosen", { localize: true });
    const actor = this.actor;
    const update = {
      name: s.name || actor.name,
      img: s.img || actor.img,
      "prototypeToken.name": s.name || actor.name,
      "system.attributes.body.value": c.attrs.body,
      "system.attributes.mind.value": c.attrs.mind,
      "system.attributes.spirit.value": c.attrs.spirit,
      "system.details.codename": s.codename, "system.details.nickname": s.nickname,
      "system.details.age": s.age, "system.details.eyes": s.eyes, "system.details.hair": s.hair,
      "system.details.features": s.features,
      "system.details.goals.short": s.goalShort, "system.details.goals.long": s.goalLong,
      "system.details.connections": s.connections,
      "system.details.questionnaire": QUESTIONNAIRE.filter(q => s.answers[q.key]).map(q => ({ q: q.q, a: s.answers[q.key] })),
      "system.creation.complete": true, "system.creation.mode": s.mode, "system.creation.xpBudget": c.budget
    };
    for (const k of SKILLS) {
      update[`system.skills.${k}.training`] = c.skills[k].training;
      update[`system.skills.${k}.focus`] = c.skills[k].focus;
    }
    if (c.a) {
      update["system.details.assignment"] = c.a.name;
      update["system.details.department"] = c.a.system.department;
      update["system.details.coreSkill"] = c.a.system.coreSkill;
    }
    if (c.remaining > 0) update["system.xp.total"] = actor.system.xp.total + c.remaining;
    await actor.update(update);

    const old = actor.items.filter(i => i.getFlag("the-laundry", "fromCreator")).map(i => i.id);
    if (old.length) await actor.deleteEmbeddedDocuments("Item", old);
    const toCreate = [];
    const add = (doc, extra = {}) => {
      if (!doc) return;
      const data = foundry.utils.mergeObject(doc.toObject(), extra);
      delete data._id;
      foundry.utils.setProperty(data, "flags.the-laundry.fromCreator", true);
      toCreate.push(data);
    };
    if (c.a) {
      add(c.a);
      for (const n of c.a.system.coreTalents) {
        const doc = await findItem(n, { type: "talent" });
        if (doc) add(doc, { system: { core: true } });
        else toCreate.push({ name: n, type: "talent", system: { core: true }, flags: { "the-laundry": { fromCreator: true } } });
      }
      for (const n of c.a.system.equipment) {
        const doc = await findItem(n);
        if (doc) add(doc);
        else toCreate.push({ name: n, type: "gear", img: "icons/svg/item-bag.svg", flags: { "the-laundry": { fromCreator: true } } });
      }
    }
    for (const u of s.talents) add(await fromUuid(u));
    for (const u of s.spells) add(await fromUuid(u));
    if (toCreate.length) await actor.createEmbeddedDocuments("Item", toCreate);
    await actor.update({ "system.toughness.value": actor.system.toughness.max, "system.adrenaline.value": 0 });

    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<div class="laundry-card induction-card"><img class="seal" src="${SYSTEM_PATH}/assets/ui/seal.svg"><h3>${game.i18n.localize("LAUNDRY.Creator.Inducted")}</h3><p><strong>${actor.name}</strong>${c.a ? ` — ${c.a.name}` : ""}</p></div>`
    });
    ui.notifications.info(game.i18n.format("LAUNDRY.Creator.Done", { name: actor.name }));
    this.close();
    actor.sheet.render({ force: true });
  }
}
