# Changelog

## 1.0.1

- **Talents automated:** Combat Ready (+2 Initiative each), Combat Sense (no Blinded penalties, no bonus for hidden
  attackers), Stay on Your Toes, Obvious Threat, Squad Tactics, Evasive Driving, Quick Reload, Hurler, Collected /
  Fearless (DN 6:1 resist before Stunned / Frightened), Dig Deep, Ruthless (opposed margin), Medical Training and
  Counsellor (heal by successes, once per day per creature), Counterattack reminder after melee hits.
- Test cards: no repeated test name; degree of success shown as "+N" with a rules tooltip.
- Attack dialog: target cards; manual Defence select now matches the calculation.
- Casting time reads "1 action" instead of "0.1 minutes"; weapon sheets show a damage / range / traits strip.
- Rules Reference: new pages for Zones, Pursuits & Vehicles, Requisitions & the Team.
- Macros: Pursuit Tracker, Threat ±1, New Mission, group Stealth request.
- Health Estimate (if installed) gets Laundry wording and a vehicle scale once per world;
  Toughness / Adrenaline are the default token bars.
- **Help Action** (OH p.105): "Help an ally" on the sheet (or `game.laundry.help()`): the ally's next Test gets
  1d6 + your Training in its Skill (attacks: your Close Combat / Ranged against a nearby enemy, until your next turn).
  Helpful / Staff Synergy +1 die, Stirring Voice may use Presence. Shown in the dialog breakdown, used up on the roll.
- **Studied Defence** (+1 Defence vs the studied enemy until Rest) and **Eye in the Sky** (+1 Defence to an ally
  until your next turn) are used from the talent and applied to attacks automatically.
- **Movement reactions:** Opportunist (enemy leaves your Close Range) and Stand and Fire (enemy enters your Zone)
  whisper a reminder to the owner during combat.
- **Personal goals:** "Achieved" gives +1 / +10 XP (OH p.34) and moves the goal to an achieved list;
  team objectives sink to the bottom when done.
- **Scrolling everywhere:** every Laundry window is capped to the screen; tabbed sheets scroll the active tab.
- Fix: timed conditions (e.g. Stunned for 1 turn) failed v14 validation and were never applied.
- Dev: `npm run smoke` runs every in-Foundry scenario (13 incl. talents, reactions and scrolling);
  `tools/scenarios/cleanup.mjs` removes test leftovers.

## 1.0.0

First release — a rewrite from scratch for Foundry VTT v14.

- Rules core with unit tests: Ladder & attack DN, Focus, degrees of success, Opposed / Extended / Group / Luck Tests,
  damage & Injuries, Death Test, magic complexity & mishaps, XP costs, Zone ranges, Pursuit rounds.
- Custom Laundry d6 and Dice So Nice preset; test dialog and interactive chat cards (Focus, Luck rerolls, Backup Plan).
- Character sheet ("Classified Personnel File" theme), NPC statblocks, Team HQ sheet, vehicle sheet, item sheets.
- Induction wizard for character creation.
- Talent automation, combat workflow, magic workflow, K-Syndrome, Presence, recovery.
- Laundry Zones (Region behaviour) with Environmental Traits and zone-based ranges; canvas labels.
- Requisitions, Pursuit tracker, vehicles, GM Toolkit, inline `@Test` enricher.
- Compendia: Assignments, Talents, Weapons, Gear, Spells & apps, Bestiary, Vehicles, Tables, Rules, Macros.
