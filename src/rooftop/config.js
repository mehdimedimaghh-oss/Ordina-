// =====================================================================
//  Hotel Concordia rooftop — EDITABLE LAYOUT (the "digital twin" plan)
//  Units: metres.  X = from the left (bar side) to the right wall.
//                  Z = from the far end (top of the plan) towards the entrance (bottom).
//  Source: "Pianta Terrazza" plan from the owner (latest reference), measured with
//  1 plan pixel ≈ SCALE metres (estimate: give the real length and width to make it exact).
//  To move a table: change its x / z (metres) or rot (degrees). Nothing else needs to change.
// =====================================================================

export const SCALE = 0.008;                      // metres per plan pixel (estimate)
const P = (x, y) => [+(x * SCALE).toFixed(2), +(y * SCALE).toFixed(2)];

// Outline of the guest floor (clockwise), from the plan
export const FLOOR = [P(78, 110), P(740, 15), P(765, 1265), P(290, 1265), P(275, 1150), P(330, 540), P(78, 525)];

// Service / bar room on the left ("Servizio / Bar"), opening at the top (the light in the plan)
export const BAR = {
  area: [P(30, 535), P(330, 540), P(300, 815), P(30, 815)],
  counter: [P(60, 600), P(60, 780)],              // service counter inside the room, along the back wall
  opening: [P(172, 528), P(212, 528)],            // passage between the terrace and the bar
};

// Main entrance ("Entrata"): door at the bottom left
export const ENTRANCE = { a: P(278, 1180), b: P(288, 1262), width: 0.65, height: 2.2 };

// Central tiled walkway, from the entrance up between the left tables and the round tables
export const WALKWAY = { width: 0.8, path: [P(320, 1225), P(520, 1170), P(525, 760), P(505, 470), P(430, 200), P(430, 110)] };

// Greenery on the walls (index = edge of FLOOR starting at that point): top wall, right wall, upper left wall
export const PLANTERS = { walls: [0, 1, 6], every: 1.1 };

const SQ = { size: 0.8, height: 0.75 };          // square table top (m)
const RD = { diameter: 0.7, height: 0.75 };      // round table top (m)

// Chairs are NOT fixed: how many chairs are at each table comes from the database (rooftop_chairs),
// because waiters move them. chairSlots() places n chairs nicely around a table.
// a = direction the chair faces (degrees, 0 = towards −Z).
export const benchRight = () => ({ dx: 0.66, dz: 0, a: 270, length: 1.2, seats: 2 });   // fixed bench for 2 against the right wall

export function chairSlots(t, n) {
  const out = [];
  if (n <= 0) return out;
  if (t.shape === 'round') {
    const r = Math.max(0.55, 0.32 + n * 0.08);
    for (let i = 0; i < n; i++) {
      const ang = Math.PI + (i * 2 * Math.PI) / n;              // first chair on the left, second on the right…
      const dx = Math.cos(ang) * r, dz = Math.sin(ang) * r;
      out.push({ dx, dz, a: Math.atan2(-dx, dz) * 180 / Math.PI });
    }
    return out;
  }
  const s = (t.size || SQ.size) / 2 + 0.24;
  const sides = ['L', 'R', 'T', 'B'].filter(x => !(t.bench && x === 'R'));   // never in front of the bench
  const per = Object.fromEntries(sides.map(x => [x, 0]));
  for (let i = 0; i < n; i++) per[sides[i % sides.length]]++;
  for (const side of sides) {
    const k = per[side];
    for (let j = 0; j < k; j++) {
      const off = (j - (k - 1) / 2) * 0.48;
      if (side === 'L') out.push({ dx: -s, dz: off, a: 90 });
      if (side === 'R') out.push({ dx: s, dz: off, a: 270 });
      if (side === 'T') out.push({ dx: off, dz: -s, a: 180 });
      if (side === 'B') out.push({ dx: off, dz: s, a: 0 });
    }
  }
  return out;
}

// The 10 physical tables (labels from the plan).  defaultChairs = only used until the live count is loaded.
export const TABLES = [
  { id: 'T1', label: '1', shape: 'round', x: P(630, 0)[0], z: P(0, 1050)[1], rot: 0, defaultChairs: 2 },
  { id: 'T2', label: '2', shape: 'round', x: P(640, 0)[0], z: P(0, 925)[1], rot: 0, defaultChairs: 2 },
  { id: 'T3', label: '3', shape: 'round', x: P(640, 0)[0], z: P(0, 795)[1], rot: 0, defaultChairs: 2 },
  { id: 'T4', label: '4', shape: 'round', x: P(635, 0)[0], z: P(0, 660)[1], rot: 0, defaultChairs: 2 },
  { id: 'T5', label: '5', shape: 'round', x: P(628, 0)[0], z: P(0, 525)[1], rot: 0, defaultChairs: 2 },
  { id: 'T6', label: '6', shape: 'square', x: P(410, 0)[0], z: P(0, 890)[1], rot: 0, defaultChairs: 4 },
  { id: 'T7', label: '7', shape: 'square', x: P(430, 0)[0], z: P(0, 620)[1], rot: 0, defaultChairs: 4 },
  { id: 'T8', label: '8', shape: 'square', x: P(583, 0)[0], z: P(0, 370)[1], rot: 0, defaultChairs: 2, bench: benchRight() },
  { id: 'T9', label: '9', shape: 'square', x: P(583, 0)[0], z: P(0, 213)[1], rot: 0, defaultChairs: 2, bench: benchRight() },
  { id: 'T10', label: '10', shape: 'square', x: P(270, 0)[0], z: P(0, 345)[1], rot: 0, size: 0.95, defaultChairs: 4 },
];

export const DIMS = { SQ, RD, WALL_H: 1.1, WALL_T: 0.2 };
