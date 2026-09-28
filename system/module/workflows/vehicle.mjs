/**
 * Vehicles (OH p.117-119): Toughness, Fault Track, Vehicle Faults table, Ram, repair.
 */
import { resolveDamage, SEVERITY } from "../rules/damage.mjs";
import { performTest } from "../dice/test.mjs";

export const VEHICLE_FAULTS = Object.freeze([
  { min: 1, max: 2, key: "closeCall" },
  { min: 3, max: 4, key: "bangedUp", armour: -1 },
  { min: 5, max: 8, key: "shriekingEngine" },
  { min: 9, max: 10, key: "bustedSteering" },
  { min: 11, max: 12, key: "damagedLocomotion", speed: -1 },
  { min: 13, max: 14, key: "smoke" },
  { min: 15, max: 17, key: "fire", extraDie: true, passengersInjured: true },
  { min: 18, max: 99, key: "catastrophe", wrecked: true }
]);

function lookupFault(total) {
  return VEHICLE_FAULTS.find(r => total >= r.min && total <= r.max) ?? VEHICLE_FAULTS.at(-1);
}

/** Vehicles are immune to Psychological Damage; overflow becomes Faults. */
export async function vehicleDamage(vehicle, hit, { chat = true } = {}) {
  if (hit.type === "psychological") return { immune: true, damage: 0 };
  const sys = vehicle.system;
  const armour = Math.max(0, sys.armour + sys.faultList.filter(f => f.key === "bangedUp").length * -1);
  const res = resolveDamage({
    toughness: sys.toughness.value, armour,
    injuriesMax: sys.faults.max, injuriesFilled: sys.faults.value
  }, hit);
  await vehicle.update({ "system.toughness.value": res.toughnessAfter });
  if (res.severity) await addFault(vehicle, res.severity, { wreck: res.becameCritical });
  if (chat) {
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: vehicle }),
      content: `<div class="laundry-note"><i class="fa-solid fa-car-burst"></i> ${game.i18n.format("LAUNDRY.Vehicle.Damaged", { name: vehicle.name, damage: res.damage, toughness: res.toughnessAfter })}</div>`
    });
  }
  return res;
}

export async function addFault(vehicle, severity, { wreck = false } = {}) {
  const sys = vehicle.system;
  const extra = sys.faultList.some(f => f.key === "fire") ? 1 : 0;
  const roll = await new Roll(`${SEVERITY[severity].dice + extra}d6`).evaluate();
  const row = lookupFault(roll.total);
  const spaces = SEVERITY[severity].spaces;
  const filled = Math.min(sys.faults.max, sys.faults.value + spaces);
  const faultList = [...sys.faultList, { key: row.key, note: game.i18n.localize(`LAUNDRY.Severity.${severity}`) }];
  const wrecked = wreck || row.wrecked || filled >= sys.faults.max;
  await vehicle.update({ "system.faults.value": wrecked ? sys.faults.max : filled, "system.faultList": faultList });
  await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor: vehicle }),
    flavor: `<b>${game.i18n.localize(`LAUNDRY.Fault.${row.key}.name`)}</b><br>${game.i18n.localize(`LAUNDRY.Fault.${row.key}.effect`)}${wrecked ? `<br><b>${game.i18n.localize("LAUNDRY.Vehicle.Wrecked")}</b>` : ""}`
  });
  if (wrecked) await vehicle.toggleStatusEffect("dead", { active: true, overlay: true });
  return row;
}

/** Repair: DN 5:1 Mind (Engineering), +1 Toughness per success. */
export async function repairVehicle(vehicle, mechanic) {
  const msg = await mechanic.rollTest({
    attribute: "mind", skill: "engineering", dn: 5, complexity: 1,
    label: game.i18n.format("LAUNDRY.Vehicle.Repair", { name: vehicle.name })
  });
  if (!msg) return;
  const st = msg.getFlag("the-laundry", "test");
  const t = vehicle.system.toughness;
  await vehicle.update({ "system.toughness.value": Math.min(t.max, t.value + st.evaluation.successes) });
}

/** Ram (OH p.118): driver Body (Reflexes) vs target Defence at Average Melee. */
export async function ram(vehicle, driver, targetToken, { zones = 1 } = {}) {
  const { attackDN } = await import("../rules/ladder.mjs");
  const target = targetToken?.actor;
  const dn = attackDN(1, target?.system?.combat?.defence ?? 1);
  const message = await performTest(driver, {
    kind: "attack", label: game.i18n.format("LAUNDRY.Vehicle.Ram", { name: vehicle.name }),
    attribute: "body", skill: "reflexes", dn: Math.min(6, dn + (vehicle.system.effective?.reflexesDN ?? 0)), complexity: 1,
    attack: {
      weaponName: vehicle.name, weaponImg: vehicle.img,
      baseDamage: vehicle.system.armour, addSuccesses: true, traits: [], damageType: "physical",
      bonusDamage: 0, multiplier: zones >= 2 ? 2 : 1,
      targets: target ? [{ uuid: target.uuid, tokenUuid: targetToken.uuid, name: targetToken.name, img: targetToken.texture.src, attackStep: 1, defenceStep: target.system.combat?.defence ?? 1, dn, notes: [] }] : []
    }
  });
  // Recoil: vehicle suffers 2× target Armour.
  const recoil = 2 * (target?.system?.combat?.armour ?? 0);
  if (recoil) await vehicleDamage(vehicle, { damage: recoil, ignoreArmour: false, type: "physical" });
  return message;
}
