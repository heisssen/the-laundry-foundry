/**
 * Zone geometry and Zone-based range bands (OH p.103).
 *
 *   Close   — within arm's reach (same Zone, ~2 m)
 *   Short   — anywhere in the same Zone
 *   Medium  — an adjacent Zone
 *   Long    — two Zones away
 *   Extreme — three or more Zones away
 *
 * Pure functions: shapes are plain Region shape data.
 */

export const RANGE_BY_STEPS = ["short", "medium", "long", "extreme"];

/** Convert a Region shape (rectangle / polygon / ellipse / circle) to a flat polygon [[x,y],…]. */
export function shapeToPolygon(s) {
  switch (s.type) {
    case "rectangle": {
      const { x, y, width: w, height: h, rotation = 0 } = s;
      const pts = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
      if (!rotation) return pts;
      const cx = x + w / 2, cy = y + h / 2, r = rotation * Math.PI / 180;
      return pts.map(([px, py]) => [
        cx + (px - cx) * Math.cos(r) - (py - cy) * Math.sin(r),
        cy + (px - cx) * Math.sin(r) + (py - cy) * Math.cos(r)
      ]);
    }
    case "polygon": {
      const out = [];
      for (let i = 0; i + 1 < s.points.length; i += 2) out.push([s.points[i], s.points[i + 1]]);
      return out;
    }
    case "ellipse":
    case "circle": {
      const rx = s.radiusX ?? s.radius, ry = s.radiusY ?? s.radius, r = (s.rotation ?? 0) * Math.PI / 180;
      return Array.from({ length: 24 }, (_, i) => {
        const a = (i / 24) * Math.PI * 2;
        const ex = rx * Math.cos(a), ey = ry * Math.sin(a);
        return [s.x + ex * Math.cos(r) - ey * Math.sin(r), s.y + ex * Math.sin(r) + ey * Math.cos(r)];
      });
    }
    default: return [];
  }
}

export function pointInPolygon([px, py], poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function segDist(p, a, b) {
  const [px, py] = p, [ax, ay] = a, [bx, by] = b;
  const dx = bx - ax, dy = by - ay;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Smallest gap between two polygons (0 if they overlap). */
export function polygonGap(p, q) {
  if (!p.length || !q.length) return Infinity;
  if (p.some(v => pointInPolygon(v, q)) || q.some(v => pointInPolygon(v, p))) return 0;
  let best = Infinity;
  for (const [A, B] of [[p, q], [q, p]]) {
    for (const v of A) for (let i = 0; i < B.length; i++) {
      best = Math.min(best, segDist(v, B[i], B[(i + 1) % B.length]));
    }
  }
  return best;
}

/**
 * Build the adjacency graph.
 * @param {{id:string, polygons:number[][][], links?:string[], auto?:boolean}[]} zones
 * @param {number} tolerance  max gap (px) still counted as touching
 * @returns {Map<string, Set<string>>}
 */
export function buildAdjacency(zones, tolerance = 0) {
  const adj = new Map(zones.map(z => [z.id, new Set()]));
  const link = (a, b) => { if (a !== b && adj.has(a) && adj.has(b)) { adj.get(a).add(b); adj.get(b).add(a); } };
  for (let i = 0; i < zones.length; i++) {
    for (const l of zones[i].links ?? []) link(zones[i].id, l);
    for (let j = i + 1; j < zones.length; j++) {
      const a = zones[i], b = zones[j];
      if (a.auto === false || b.auto === false) continue;
      const touching = a.polygons.some(p => b.polygons.some(q => polygonGap(p, q) <= tolerance));
      if (touching) link(a.id, b.id);
    }
  }
  return adj;
}

/** Fewest Zone steps between any zone in `from` and any in `to` (BFS); Infinity if unconnected. */
export function zoneSteps(adj, from, to) {
  const target = new Set(to);
  if (from.some(z => target.has(z))) return 0;
  const seen = new Set(from);
  let frontier = [...from], steps = 0;
  while (frontier.length) {
    steps++;
    const next = [];
    for (const z of frontier) for (const n of adj.get(z) ?? []) {
      if (seen.has(n)) continue;
      if (target.has(n)) return steps;
      seen.add(n); next.push(n);
    }
    frontier = next;
  }
  return Infinity;
}

/**
 * Range band between two combatants.
 * @param {number} steps       Zone steps (0 = same zone)
 * @param {number} metres      straight-line distance
 */
export function rangeBand(steps, metres) {
  if (steps === 0 && metres <= 2) return "close";
  return RANGE_BY_STEPS[Math.min(steps, 3)] ?? "extreme";
}
