/**
 * Dice So Nice integration: The Laundry d6 ("dl") with custom faces and colour sets.
 */
import { SYSTEM_ID, SYSTEM_PATH } from "../config.mjs";

export function registerDiceSoNice(dice3d) {
  dice3d.addSystem({ id: SYSTEM_ID, name: "The Laundry" }, "preferred");

  dice3d.addColorset({
    name: "laundry-memo",
    description: "The Laundry — Memo Paper",
    category: "The Laundry",
    foreground: "#1d3b2a",
    background: "#efe6cc",
    outline: "#b8a97c",
    edge: "#d9cda8",
    texture: "paper",
    material: "plastic",
    font: "Arial"
  }, "preferred");

  dice3d.addColorset({
    name: "laundry-ledger",
    description: "The Laundry — Green Ledger",
    category: "The Laundry",
    foreground: "#efe6cc",
    background: "#1d3b2a",
    outline: "#0e1f16",
    edge: "#2b5a40",
    texture: "none",
    material: "metal",
    font: "Arial"
  });

  const labels = n => Array.from({ length: 6 }, (_, i) => `${SYSTEM_PATH}/assets/dice/dsn/${n}${i + 1}.png`);
  dice3d.addDicePreset({
    type: "dl",
    labels: labels("label-"),
    bumpMaps: labels("bump-"),
    system: SYSTEM_ID,
    colorset: "laundry-memo"
  }, "d6");

  // Same faces for plain d6 under the Laundry system.
  dice3d.addDicePreset({
    type: "d6",
    labels: labels("label-"),
    bumpMaps: labels("bump-"),
    system: SYSTEM_ID,
    colorset: "laundry-memo"
  });
}
