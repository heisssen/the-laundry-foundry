/**
 * The Laundry RPG — Foundry VTT v14 system entry point.
 */
import { LAUNDRY, STATUS_EFFECTS, SYSTEM_ID, SYSTEM_PATH } from "./module/config.mjs";
import { CharacterData } from "./module/data/actor-character.mjs";
import { NpcData } from "./module/data/actor-npc.mjs";
import { TeamData, VehicleData } from "./module/data/actor-team.mjs";
import { TalentData, WeaponData, ArmourData, GearData, SpellData, AppData, AssignmentData, InjuryData } from "./module/data/items.mjs";
import { LaundryActor } from "./module/documents/actor.mjs";
import { LaundryItem } from "./module/documents/item.mjs";
import { LaundryCombat, LaundryCombatant, registerCombatHooks } from "./module/workflows/combat.mjs";
import { CharacterSheet, NpcSheet } from "./module/apps/actor-sheet.mjs";
import { TeamSheet, VehicleSheet, LaundryItemSheet } from "./module/apps/other-sheets.mjs";
import { LuckThreatHUD } from "./module/apps/luck-hud.mjs";
import { LaundryDie } from "./module/dice/laundry-die.mjs";
import { onRenderChatMessage } from "./module/dice/chat.mjs";
import { initSocket } from "./module/helpers/socket.mjs";
import { registerLuckSettings, Luck, getLuckState } from "./module/helpers/luck.mjs";
import { registerDiceSoNice } from "./module/dice/dice-so-nice.mjs";
import * as rules from "./module/rules/index.mjs";
import { registerZoneBehavior, zoneRange, zoneTraits } from "./module/data/region-zone.mjs";
import { registerZoneSettings, registerZoneHooks } from "./module/apps/zones-canvas.mjs";
import { registerEnrichers } from "./module/helpers/enrichers.mjs";
import { registerPursuit, PursuitTracker } from "./module/apps/pursuit.mjs";

Hooks.once("init", () => {
  console.log(`${SYSTEM_ID} | Initialising The Laundry RPG`);
  CONFIG.LAUNDRY = LAUNDRY;

  // Documents
  CONFIG.Actor.documentClass = LaundryActor;
  CONFIG.Item.documentClass = LaundryItem;
  CONFIG.Combat.documentClass = LaundryCombat;
  CONFIG.Combatant.documentClass = LaundryCombatant;

  // Data models
  Object.assign(CONFIG.Actor.dataModels, { character: CharacterData, npc: NpcData, team: TeamData, vehicle: VehicleData });
  Object.assign(CONFIG.Item.dataModels, {
    talent: TalentData, weapon: WeaponData, armour: ArmourData, gear: GearData,
    spell: SpellData, app: AppData, assignment: AssignmentData, injury: InjuryData
  });
  CONFIG.Actor.trackableAttributes = {
    character: { bar: ["toughness", "adrenaline"], value: ["injuries.filled"] },
    npc: { bar: ["toughness", "adrenaline"], value: [] },
    vehicle: { bar: ["toughness", "faults"], value: [] }
  };

  // Initiative is a fixed stat (no dice). OH p.100
  CONFIG.Combat.initiative = { formula: "@initiative", decimals: 0 };

  // Custom Laundry die: "Xdl"
  CONFIG.Dice.terms[LaundryDie.DENOMINATION] = LaundryDie;

  // Conditions
  CONFIG.statusEffects = STATUS_EFFECTS.map(s => ({ ...s }));
  CONFIG.specialStatusEffects.DEFEATED = "dead";
  CONFIG.specialStatusEffects.INVISIBLE = "hidden";
  CONFIG.specialStatusEffects.BLIND = "blinded";

  // Sheets
  const { Actors, Items } = foundry.documents.collections;
  const reg = (coll, cls, types, label) => coll.registerSheet(SYSTEM_ID, cls, { types, makeDefault: true, label });
  reg(Actors, CharacterSheet, ["character"], "LAUNDRY.SheetLabel.Character");
  reg(Actors, NpcSheet, ["npc"], "LAUNDRY.SheetLabel.NPC");
  reg(Actors, TeamSheet, ["team"], "LAUNDRY.SheetLabel.Team");
  reg(Actors, VehicleSheet, ["vehicle"], "LAUNDRY.SheetLabel.Vehicle");
  reg(Items, LaundryItemSheet, undefined, "LAUNDRY.SheetLabel.Item");

  registerLuckSettings();
  registerZoneSettings();
  registerZoneBehavior();
  registerZoneHooks();
  registerEnrichers();
  registerPursuit();
  game.settings.register(SYSTEM_ID, "showLuckHud", {
    name: "LAUNDRY.Setting.ShowHud.Name", hint: "LAUNDRY.Setting.ShowHud.Hint",
    scope: "client", config: true, type: Boolean, default: true,
    onChange: v => v ? game.laundry.hud.render({ force: true }) : game.laundry.hud.close()
  });
  game.settings.register(SYSTEM_ID, "autoDeathPrompt", {
    name: "LAUNDRY.Setting.AutoDeath.Name", hint: "LAUNDRY.Setting.AutoDeath.Hint",
    scope: "world", config: true, type: Boolean, default: true
  });

  registerHandlebars();
  registerCombatHooks();

  game.laundry = {
    rules, Luck, getLuckState, LaundryDie, zoneRange, zoneTraits,
    pursuit: () => PursuitTracker.open(),
    useItem: async (uuid) => (await fromUuid(uuid))?.use(),
    rollSkill: (skill, cfg) => (canvas.tokens.controlled[0]?.actor ?? game.user.character)?.rollSkill(skill, cfg),
    toolkit: async () => new (await import("./module/workflows/gm-tools.mjs")).GMToolkit().render({ force: true }),
    luckTest: async () => (await import("./module/workflows/gm-tools.mjs")).luckTest(),
    requestTest: async (cfg) => (await import("./module/workflows/gm-tools.mjs")).requestTest(cfg)
  };
});

function registerHandlebars() {
  const H = Handlebars;
  H.registerHelper("laundry-eq", (a, b) => a === b);
  H.registerHelper("laundry-gt", (a, b) => a > b);
  H.registerHelper("laundry-lt", (a, b) => a < b);
  H.registerHelper("laundry-add", (a, b) => Number(a) + Number(b));
  H.registerHelper("laundry-signed", v => (Number(v) > 0 ? `+${v}` : `${v}`));
  H.registerHelper("laundry-includes", (arr, v) => Array.isArray(arr) && arr.includes(v));
  H.registerHelper("laundry-times", (n, block) => {
    let out = "";
    for (let i = 0; i < n; i++) out += block.fn(i);
    return out;
  });
  H.registerHelper("laundry-ladder", step => game.i18n.localize(`LAUNDRY.Ladder.${LAUNDRY.ladderKeys[step] ?? "average"}`));
  H.registerHelper("laundry-json", v => JSON.stringify(v));
  foundry.applications.handlebars.loadTemplates({
    "laundry.item-row": `${SYSTEM_PATH}/templates/partials/item-row.hbs`,
    "laundry.dice": `${SYSTEM_PATH}/templates/partials/dice.hbs`
  });
}

Hooks.once("ready", () => {
  initSocket();
  game.laundry.hud = new LuckThreatHUD();
  if (game.settings.get(SYSTEM_ID, "showLuckHud")) game.laundry.hud.render({ force: true });
  // Keep Luck within the current maximum as players join/leave. OH p.96
  if (game.user.isGM) {
    const s = getLuckState();
    if (s.luck > s.luckMax) Luck.adjustLuck(s.luckMax - s.luck);
  }
});

Hooks.on("renderChatMessageHTML", (message, html) => onRenderChatMessage(message, html));

Hooks.once("diceSoNiceReady", dice3d => registerDiceSoNice(dice3d));

/** Hotbar: drop an owned Item to create a "use" macro. */
Hooks.on("hotbarDrop", (bar, data, slot) => {
  if (data.type !== "Item") return;
  (async () => {
    const item = await fromUuid(data.uuid);
    if (!item?.actor) return;
    const command = `game.laundry.useItem("${item.uuid}");`;
    let macro = game.macros.find(m => m.name === item.name && m.command === command);
    macro ??= await Macro.create({ name: item.name, type: "script", img: item.img, command, flags: { [SYSTEM_ID]: { itemMacro: true } } });
    await game.user.assignHotbarMacro(macro, slot);
  })();
  return false;
});

/** Keep team Luck max in sync when characters are created/deleted. */
for (const hook of ["createActor", "deleteActor"]) {
  Hooks.on(hook, (actor) => {
    if (actor.type === "character") Hooks.callAll("laundryLuckThreatChanged", getLuckState());
  });
}
