# The Laundry RPG — Foundry VTT system

Unofficial, fan-made system for **The Laundry Roleplaying Game** (Cubicle 7, 2nd edition, 2025) on **Foundry VTT v14**.
Not affiliated with or endorsed by Cubicle 7 or Charles Stross. You need the books to play.

## Install

In Foundry: *Game Systems → Install System → Manifest URL*:

```
https://github.com/heisssen/the-laundry-foundry/releases/latest/download/system.json
```

Create a world with **The Laundry RPG**.

**Content:** this public build ships the mechanics, sheets and automation, plus Vehicles and Macros compendia.
It contains no text or statblocks from the books — create your talents, assignments, gear, spells and NPCs
from your copy of the Operative's Handbook / Supervisor's Guide (item sheets have fields for every automated effect,
including talent modifiers). The Induction wizard's *custom operative* mode works without an Assignments compendium.

## What's automated

- **Custom d6** (`dl`) with Laundry faces and a Dice So Nice preset; DN X:Y Tests, Focus (drag +1 onto dice), Advantage /
  Disadvantage, Double Training / Focus with Adrenaline, team **Luck** rerolls and **Threat** (HUD bottom-left).
- **Characters**: 10-step **Induction** wizard (Assignment packages or custom XP build, book tables for looks,
  goals and the questionnaire), derived stats, XP spending with an undoable log.
- **Talents** that do things: Advantage, bonus dice, Double Training/Focus, attack steps, damage and traits are
  offered (or applied) in the right Tests.
- **Combat**: attack dialog with DN from the Ladder, range, cover, called shots, charge, dual wielding;
  damage, Armour, Injuries, Critical, Death Test, Last Stand, Adrenaline per round, Presence.
- **Magic**: casting dialog (method, device, level, modifications, fast cast), mishaps, computational complications,
  K-Syndrome, spell Damage from the card, Prognostication Threat, occult apps.
- **Laundry Zones**: every Region you draw is a Zone; ranges (Close/Short/Medium/Long/Extreme) come from Zone adjacency;
  Cover, Poorly Lit/Dark, Obscured, Difficult Terrain, Barrier and Hazards (auto Damage) feed Tests and attacks.
- **Team HQ sheet**: roster & skills matrix, mission briefing, objectives (incl. secret), KPIs with XP/Luck rewards,
  shared stash, requisitions, contacts, evidence board, log.
- **Requisitions** (drop gear on a sheet → Bureaucracy / Presence Test → collect), **Pursuit tracker**, **vehicles**
  (crew, cover aboard, Faults, ram), GM Toolkit (request / group / luck tests, new mission).
- Inline Tests in journals: `@Test[mind.awareness 4:1]{Spot the tail}`.
- Compendia (public build): Vehicles and Macros.

## Recommended modules

Dice So Nice, Monk's Little Details / Combat Details / Common Display / Sound Enhancements, Combat Tracker Dock,
Health Estimate (reads Toughness automatically), Quick Insert, Narrator Tools, SmallTime, PDF Pager, FXMaster.

## Development

```sh
npm install
npm test                       # rules unit tests (vitest)
node tools/content/build.mjs   # compendium sources → packs-src
npm run pack                   # packs-src → system/packs (world must be shut down)
node tools/smoke.mjs tools/scenarios/<name>.mjs   # headless in-Foundry scenario
npm run release -- 1.1.0 --repo owner/name        # dist/the-laundry-<ver>.zip + system.json
```

The Laundry Files © Charles Stross. The Laundry Roleplaying Game © Cubicle 7 Entertainment Ltd.
