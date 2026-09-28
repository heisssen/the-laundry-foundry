import { describe, it, expect } from "vitest";
import { shapeToPolygon, polygonGap, buildAdjacency, zoneSteps, rangeBand } from "../system/module/rules/zones.mjs";

const rect = (x, y, w = 100, h = 100) => shapeToPolygon({ type: "rectangle", x, y, width: w, height: h });

describe("zones", () => {
  it("measures gaps between shapes", () => {
    expect(polygonGap(rect(0, 0), rect(100, 0))).toBe(0);        // shared edge
    expect(polygonGap(rect(0, 0), rect(150, 0))).toBe(50);
    expect(polygonGap(rect(0, 0), rect(50, 50))).toBe(0);        // overlap
    const circle = shapeToPolygon({ type: "circle", x: 300, y: 50, radius: 50 });
    expect(polygonGap(rect(0, 0, 250), circle)).toBeLessThan(1);
  });

  it("builds adjacency with tolerance and manual links", () => {
    const zones = [
      { id: "A", polygons: [rect(0, 0)] },
      { id: "B", polygons: [rect(110, 0)] },
      { id: "C", polygons: [rect(220, 0)] },
      { id: "D", polygons: [rect(330, 0)] },
      { id: "E", polygons: [rect(1000, 1000)], links: ["A"] }
    ];
    const adj = buildAdjacency(zones, 20);
    expect([...adj.get("A")].sort()).toEqual(["B", "E"]);
    expect(zoneSteps(adj, ["A"], ["A"])).toBe(0);
    expect(zoneSteps(adj, ["A"], ["B"])).toBe(1);
    expect(zoneSteps(adj, ["A"], ["C"])).toBe(2);
    expect(zoneSteps(adj, ["A"], ["D"])).toBe(3);
    expect(zoneSteps(adj, ["E"], ["C"])).toBe(3);
    expect(buildAdjacency(zones, 5).get("A").has("B")).toBe(false);
  });

  it("maps steps to range bands (OH p.103)", () => {
    expect(rangeBand(0, 1.5)).toBe("close");
    expect(rangeBand(0, 6)).toBe("short");
    expect(rangeBand(1, 12)).toBe("medium");
    expect(rangeBand(2, 25)).toBe("long");
    expect(rangeBand(5, 80)).toBe("extreme");
    expect(rangeBand(Infinity, 80)).toBe("extreme");
  });
});

import { resolvePursuitRound } from "../system/module/rules/tests.mjs";
describe("pursuit rounds (OH p.116)", () => {
  const q = (id, s) => ({ id, successes: s });
  it("slowest quarry vs fastest pursuer", () => {
    const r = resolvePursuitRound(4, [q("a", 3), q("b", 1)], [q("x", 0), q("y", 2)]);
    expect(r.delta).toBe(-1); expect(r.distance).toBe(3); expect(r.slowest).toBe("b"); expect(r.fastest).toBe("y");
  });
  it("escape at 10", () => expect(resolvePursuitRound(8, [q("a", 4)], [q("x", 1)]).status).toBe("escaped"));
  it("lone quarry caught at 0", () => {
    const r = resolvePursuitRound(2, [q("a", 0)], [q("x", 3)]);
    expect(r.status).toBe("caught"); expect(r.caught).toBe("a");
  });
  it("group sacrifices the slowest", () => {
    const r = resolvePursuitRound(1, [q("a", 2), q("b", 0)], [q("x", 2)]);
    expect(r.status).toBe("ongoing"); expect(r.caught).toBe("b"); expect(r.distance).toBe(1);
  });
});
