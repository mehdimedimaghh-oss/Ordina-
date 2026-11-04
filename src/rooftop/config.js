// =====================================================================
//  Hotel Concordia rooftop — EDITABLE LAYOUT (the "digital twin" plan)
//  Units: metres.  X = from the left (bar side) to the right wall.
//                  Z = from the far end (top of the drawing) towards the entrance (bottom).
//  Source: the owner's corrected drawing, measured with 1 drawing pixel ≈ 1 cm
//  (the drawing is a sketch: give the real total length and width to make it exact → change SCALE).
//  To move a table: change its x / z (metres) or rot (degrees). Nothing else needs to change.
// =====================================================================

export const SCALE = 0.01;                       // metres per drawing pixel
const P = (x, y) => [+(x * SCALE).toFixed(2), +(y * SCALE).toFixed(2)];

// Outline of the guest floor (clockwise), from the drawing
export const FLOOR = [P(30, 190), P(785, 50), P(860, 1730), P(310, 1750), P(300, 1610), P(330, 1380), P(380, 1150), P(440, 820), P(40, 850)];

// Service / bar area on the left, next to the middle of the rooftop
export const BAR = {
  area: [P(10, 815), P(440, 820), P(380, 1150), P(10, 1150)],
  counter: [P(425, 845), P(370, 1135)],          // service counter along the side facing the tables
  opening: [P(85, 840), P(205, 834)],             // the two short lines above "BAR" in the drawing: read as an opening (please confirm)
};

// Main entrance: the large grey door, lower left (the "E" in the drawing)
export const ENTRANCE = { a: P(302, 1630), b: P(309, 1735), width: 1.1, height: 2.3 };

// Central tiled walkway, from the entrance up through the middle (approximate, follows the free space in the drawing)
export const WALKWAY = { width: 1.0, path: [P(330, 1680), P(600, 1600), P(610, 1380), P(610, 1150), P(560, 850), P(450, 620), P(440, 300)] };

// Planters + greenery on the parapet walls (wall index = edge of FLOOR starting at that point)
export const PLANTERS = { walls: [0, 1], every: 1.6 };

const SQ = { size: 0.8, height: 0.75 };          // square table top (m)
const RD = { diameter: 0.75, height: 0.75 };     // round table top (m)

// Four individual chairs, as offsets from the table centre in the table's own frame.
// a = direction the chair faces (degrees, 0 = towards −Z).
export const chairsSquare = () => [{ dx: 0, dz: -0.62, a: 180 }, { dx: 0.62, dz: 0, a: 270 }, { dx: 0, dz: 0.62, a: 0 }, { dx: -0.62, dz: 0, a: 90 }];
export const chairsRound = () => [{ dx: 0, dz: -0.6, a: 180 }, { dx: 0.6, dz: 0, a: 270 }, { dx: 0, dz: 0.6, a: 0 }, { dx: -0.6, dz: 0, a: 90 }];

// The 10 physical tables.  app = number used in the app (1–30): NOT linked yet, waiting for the owner's confirmation.
export const TABLES = [
  { id: 'T1', label: '1', shape: 'round', x: P(597, 0)[0], z: P(0, 155)[1], rot: 0, app: null, chairs: chairsRound() },
  { id: 'T2', label: '2', shape: 'round', x: P(715, 0)[0], z: P(0, 935)[1], rot: 0, app: null, chairs: chairsRound() },
  { id: 'T3', label: '3', shape: 'round', x: P(705, 0)[0], z: P(0, 1095)[1], rot: 0, app: null, chairs: chairsRound() },
  { id: 'T4', label: '4', shape: 'round', x: P(720, 0)[0], z: P(0, 1285)[1], rot: 0, app: null, chairs: chairsRound() },
  { id: 'T5', label: '5', shape: 'round', x: P(735, 0)[0], z: P(0, 1485)[1], rot: 0, app: null, chairs: chairsRound() },
  { id: 'T6', label: '6', shape: 'square', x: P(605, 0)[0], z: P(0, 375)[1], rot: 0, app: null, chairs: chairsSquare() },
  { id: 'T7', label: '7', shape: 'square', x: P(270, 0)[0], z: P(0, 520)[1], rot: 0, app: null, chairs: chairsSquare() },
  { id: 'T8', label: '8', shape: 'square', x: P(680, 0)[0], z: P(0, 680)[1], rot: 0, app: null, chairs: chairsSquare() },
  { id: 'T9', label: '9', shape: 'square', x: P(510, 0)[0], z: P(0, 990)[1], rot: 0, app: null, chairs: chairsSquare() },
  { id: 'T10', label: '10', shape: 'square', x: P(460, 0)[0], z: P(0, 1280)[1], rot: 0, app: null, chairs: chairsSquare() },
];

export const DIMS = { SQ, RD, WALL_H: 1.1, WALL_T: 0.25, SEATS_PER_TABLE: 4 };
