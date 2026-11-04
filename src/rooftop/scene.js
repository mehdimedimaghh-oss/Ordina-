// 3D model of the rooftop, built only from config.js (no hard-coded positions here).
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { FLOOR, BAR, ENTRANCE, WALKWAY, PLANTERS, TABLES, DIMS } from './config.js';

export function hasWebGL() {
  try { const c = document.createElement('canvas'); return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl'))); } catch { return false; }
}

const DEG = Math.PI / 180;
const COL = {
  bg: 0x0b1426, wall: 0xc4c8ce, cap: 0xd7dadf, iron: 0x2a2c31, cushion: 0x7b7f86, cloth: 0xf7f6f2,
  terracotta: 0xb8714f, leaf: 0x3f6b3a, leaf2: 0x55803f, door: 0x8b9199, counter: 0x8d939b, wood: 0x9b7550, gold: 0xd9b66c, lamp: 0xffc777,
};

// bounds + centre of the floor
const xs = FLOOR.map(p => p[0]), zs = FLOOR.map(p => p[1]);
export const BOUNDS = { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
const CX = (BOUNDS.minX + BOUNDS.maxX) / 2, CZ = (BOUNDS.minZ + BOUNDS.maxZ) / 2;
const span = Math.max(BOUNDS.maxX - BOUNDS.minX, BOUNDS.maxZ - BOUNDS.minZ);

// small deterministic random (same scene every time)
let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

function tileTexture(base, line, tiles, speckle) {
  const s = 512, c = document.createElement('canvas'); c.width = c.height = s; const g = c.getContext('2d');
  g.fillStyle = base; g.fillRect(0, 0, s, s);
  for (let i = 0; i < 6000 * speckle; i++) { const v = 150 + Math.floor(rnd() * 90); g.fillStyle = `rgba(${v},${v},${v - 6},${0.25 + rnd() * 0.3})`; g.fillRect(rnd() * s, rnd() * s, 1 + rnd() * 2, 1 + rnd() * 2); }
  const step = s / tiles;
  for (let i = 0; i < tiles; i++) for (let j = 0; j < tiles; j++) { const v = rnd() * 14 - 7; g.fillStyle = `rgba(${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${Math.abs(v) / 100})`; g.fillRect(i * step, j * step, step, step); }
  g.strokeStyle = line; g.lineWidth = 3;
  for (let i = 0; i <= tiles; i++) { g.beginPath(); g.moveTo(i * step, 0); g.lineTo(i * step, s); g.stroke(); g.beginPath(); g.moveTo(0, i * step); g.lineTo(s, i * step); g.stroke(); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

function labelSprite(text) {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  g.fillStyle = 'rgba(11,20,38,.88)'; g.beginPath(); g.arc(64, 64, 58, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#d9b66c'; g.lineWidth = 6; g.stroke();
  g.fillStyle = '#e7c77e'; g.font = '600 52px Marcellus, Georgia, serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 64, 68);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false }));
  sp.scale.set(0.55, 0.55, 0.55); return sp;
}

const mat = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, ...o });

function box(w, h, d, m) { const x = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); x.castShadow = x.receiveShadow = true; return x; }
function segment(a, b, h, t, m, y0 = 0) {   // a wall-like box from a to b (plan points [x,z])
  const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz);
  const w = box(len, h, t, m); w.position.set((a[0] + b[0]) / 2, y0 + h / 2, (a[1] + b[1]) / 2); w.rotation.y = -Math.atan2(dz, dx); return w;
}

// ---------- furniture ----------
function chair(M) {
  const g = new THREE.Group();
  const legG = new THREE.CylinderGeometry(0.012, 0.012, 0.45, 6);
  for (const [x, z] of [[-0.18, -0.18], [0.18, -0.18], [-0.18, 0.18], [0.18, 0.18]]) { const l = new THREE.Mesh(legG, M.iron); l.position.set(x, 0.225, z); l.castShadow = true; g.add(l); }
  const seat = box(0.42, 0.025, 0.42, M.iron); seat.position.y = 0.45; g.add(seat);
  const cushion = box(0.4, 0.06, 0.4, M.cushion); cushion.position.y = 0.49; g.add(cushion);
  for (const x of [-0.18, 0.18]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.42, 6), M.iron); p.position.set(x, 0.66, 0.2); p.castShadow = true; g.add(p); }
  const arc = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.012, 6, 20, Math.PI), M.iron); arc.position.set(0, 0.86, 0.2); arc.castShadow = true; g.add(arc);
  const scroll = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.008, 6, 16), M.iron); scroll.position.set(0, 0.74, 0.2); g.add(scroll);   // wrought-iron curl
  return g;
}

// upholstered bench for 2 (dark green velvet, as in the plan), seat facing −Z in its own frame
function bench(len, M) {
  const g = new THREE.Group();
  const base = box(len, 0.4, 0.48, M.velvetDark); base.position.y = 0.2; g.add(base);
  const seat = box(len - 0.04, 0.08, 0.46, M.velvet); seat.position.y = 0.44; g.add(seat);
  const back = box(len, 0.5, 0.12, M.velvet); back.position.set(0, 0.7, 0.2); g.add(back);
  for (const x of [-len / 4, len / 4]) { const pw = box(0.34, 0.3, 0.1, M.pillow); pw.position.set(x, 0.65, 0.1); pw.rotation.x = -0.25; g.add(pw); }
  return g;
}

function table(t, M) {
  const g = new THREE.Group(); g.name = t.id; g.userData.id = t.id;
  g.position.set(t.x, 0, t.z); g.rotation.y = -(t.rot || 0) * DEG;
  const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.72, 8), M.iron); stand.position.y = 0.36; g.add(stand);
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.24, 0.02, 16), M.iron); foot.position.y = 0.01; g.add(foot);
  let top;
  if (t.shape === 'round') {
    const r = DIMS.RD.diameter / 2;
    top = new THREE.Mesh(new THREE.CylinderGeometry(r + 0.03, r + 0.07, 0.3, 40, 1, true), M.cloth); top.position.y = DIMS.RD.height - 0.13;
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(r + 0.03, r + 0.03, 0.02, 40), M.cloth); disc.position.y = DIMS.RD.height + 0.02; disc.castShadow = disc.receiveShadow = true; g.add(disc);
  } else {
    const s = (t.size || DIMS.SQ.size) + 0.06;
    top = box(s, 0.28, s, M.cloth); top.position.y = DIMS.SQ.height - 0.12;
  }
  top.castShadow = top.receiveShadow = true; g.add(top);
  // small cordless table lamp (seen in the photos)
  const lb = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.04, 0.18, 12), M.brass); lb.position.y = 0.87; g.add(lb);
  const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.075, 0.07, 18), M.shade); shade.position.y = 0.99; g.add(shade);
  // chairs: exactly the four positions from the config
  t.chairs.forEach(c => { const ch = chair(M); ch.position.set(c.dx, 0, c.dz); ch.rotation.y = -c.a * DEG; g.add(ch); });
  if (t.bench) { const b = bench(t.bench.length, M); b.position.set(t.bench.dx, 0, t.bench.dz); b.rotation.y = -t.bench.a * DEG; g.add(b); }
  // selection ring (hidden) + table number + invisible "hit" area for taps
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.82, 0.9, 48), new THREE.MeshBasicMaterial({ color: COL.gold, transparent: true, opacity: 0.9, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.02; ring.visible = false; ring.name = 'ring'; g.add(ring);
  const lab = labelSprite(t.label); lab.position.y = 1.55; g.add(lab);
  const hit = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.85, 16), new THREE.MeshBasicMaterial({ visible: false })); hit.position.y = 0.42; hit.userData.id = t.id; g.add(hit);
  g.userData.hit = hit; g.userData.ring = ring; g.userData.lampPos = new THREE.Vector3(0, 0.96, 0);
  return g;
}

function planterWithPlants(M) {
  const g = new THREE.Group();
  const p = box(0.8, 0.38, 0.34, M.terracotta); p.position.y = 0.19; g.add(p);
  const rim = box(0.84, 0.04, 0.38, M.terracotta); rim.position.y = 0.39; g.add(rim);
  for (let i = 0; i < 4; i++) {
    const s = 0.16 + rnd() * 0.14, l = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 1), rnd() > 0.5 ? M.leaf : M.leaf2);
    l.position.set(-0.28 + i * 0.19 + (rnd() - 0.5) * 0.06, 0.42 + s * 0.8 + rnd() * 0.2, (rnd() - 0.5) * 0.08); l.castShadow = true; g.add(l);
  }
  return g;
}

// ---------- the whole rooftop ----------
export function createRooftop(container, { onPick } = {}) {
  const small = Math.min(innerWidth, innerHeight) < 700;
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, small ? 1.75 : 2));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(COL.bg); scene.fog = new THREE.Fog(COL.bg, 30, 70);
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 200);

  const M = {
    wall: mat(COL.wall), cap: mat(COL.cap), iron: mat(COL.iron, { metalness: 0.6, roughness: 0.45 }), cushion: mat(COL.cushion, { roughness: 1 }),
    cloth: mat(COL.cloth, { roughness: 0.95 }), terracotta: mat(COL.terracotta, { roughness: 0.9 }), leaf: mat(COL.leaf, { flatShading: true }), leaf2: mat(COL.leaf2, { flatShading: true }),
    door: mat(COL.door, { roughness: 0.6, metalness: 0.2 }), counter: mat(COL.counter, { roughness: 0.7 }), wood: mat(COL.wood, { roughness: 0.6 }),
    bulb: new THREE.MeshStandardMaterial({ color: COL.lamp, emissive: COL.lamp, emissiveIntensity: 2.2 }),
    brass: mat(0xc9a46a, { metalness: 0.8, roughness: 0.35 }),
    velvet: mat(0x2f4f3e, { roughness: 0.9 }), velvetDark: mat(0x22382d, { roughness: 0.9 }), pillow: mat(0xd8d2c6, { roughness: 1 }),
    shade: new THREE.MeshStandardMaterial({ color: 0xfff1d6, emissive: 0xffc777, emissiveIntensity: 1.4, roughness: 0.6 }),
  };

  // lights: dusk sky + warm low sun (shadows) + table lamps
  scene.add(new THREE.HemisphereLight(0x9fb3d9, 0x2b2218, 0.9));
  const sun = new THREE.DirectionalLight(0xffdcb0, 1.6);
  sun.position.set(CX - 8, 16, CZ - 9); sun.target.position.set(CX, 0, CZ); sun.castShadow = true;
  const sm = small ? 1024 : 2048; sun.shadow.mapSize.set(sm, sm);
  Object.assign(sun.shadow.camera, { left: -11, right: 11, top: 11, bottom: -11, near: 1, far: 50 }); sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);

  // floor with the light grey speckled tiles of the photos
  const shape = new THREE.Shape(FLOOR.map(([x, z]) => new THREE.Vector2(x, -z)));
  const tex = tileTexture('#c9c6c0', 'rgba(120,118,112,.55)', 4, 1); tex.repeat.set(1 / 1.2, 1 / 1.2);
  const floor = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.92 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);

  // central walkway: slightly larger, warmer tiles
  const wtex = tileTexture('#d4cdc2', 'rgba(130,120,108,.5)', 2, 0.6); wtex.repeat.set(1, 1);
  const wmat = new THREE.MeshStandardMaterial({ map: wtex, roughness: 0.85 });
  for (let i = 0; i < WALKWAY.path.length - 1; i++) {
    const a = WALKWAY.path[i], b = WALKWAY.path[i + 1], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(len + WALKWAY.width * 0.6, WALKWAY.width), wmat);
    strip.rotation.x = -Math.PI / 2; strip.rotation.z = -Math.atan2(b[1] - a[1], b[0] - a[0]);
    strip.position.set((a[0] + b[0]) / 2, 0.004 + i * 0.0005, (a[1] + b[1]) / 2); strip.receiveShadow = true; scene.add(strip);
  }

  // bar / service area: darker floor, counter (grey with wooden top), back shelf with bottles
  const barShape = new THREE.Shape(BAR.area.map(([x, z]) => new THREE.Vector2(x, -z)));
  const bfloor = new THREE.Mesh(new THREE.ShapeGeometry(barShape), new THREE.MeshStandardMaterial({ color: 0x5d564e, roughness: 0.8 }));
  bfloor.rotation.x = -Math.PI / 2; bfloor.position.y = 0.002; bfloor.receiveShadow = true; scene.add(bfloor);
  const [ca, cb] = BAR.counter;
  scene.add(segment(ca, cb, 1.02, 0.55, M.counter));
  const top = segment(ca, cb, 0.05, 0.62, M.wood, 1.02); scene.add(top);
  const shelfA = [BAR.area[0][0] + 0.22, BAR.area[0][1] + 0.35], shelfB = [BAR.area[3][0] + 0.22, BAR.area[3][1] - 0.35];
  scene.add(segment(shelfA, shelfB, 1.9, 0.4, mat(0x3a3530)));
  const bottleCols = [0x2f6b3c, 0x7a3b23, 0xd9c48a, 0x1f3f6b, 0x8a2a2a];
  for (let i = 0; i < 14; i++) {
    const f = (i + 0.5) / 14, bx = shelfA[0] + (shelfB[0] - shelfA[0]) * f + 0.25, bz = shelfA[1] + (shelfB[1] - shelfA[1]) * f;
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.28, 10), new THREE.MeshStandardMaterial({ color: bottleCols[i % 5], roughness: 0.2, metalness: 0.1 }));
    b.position.set(bx, 1.3 + (i % 2) * 0.42, bz); scene.add(b);
  }
  const barGlow = new THREE.PointLight(0xffb85c, 6, 4, 2); barGlow.position.set((ca[0] + cb[0]) / 2 + 0.3, 2.0, (ca[1] + cb[1]) / 2); scene.add(barGlow);

  // perimeter walls (parapet) with a light cap; the bar side of the floor is the counter, the entrance edge gets the door
  const H = DIMS.WALL_H, T = DIMS.WALL_T;
  const n = FLOOR.length;
  for (let i = 0; i < n; i++) {
    const a = FLOOR[i], b = FLOOR[(i + 1) % n];
    if (onSegment(BAR.opening[0], a, b) && onSegment(BAR.opening[1], a, b)) { addWallWithGap(scene, a, b, BAR.opening, H, T, M); continue; }
    if (onSegment(ENTRANCE.a, a, b) && onSegment(ENTRANCE.b, a, b)) { addDoorWall(scene, a, b, M); continue; }
    scene.add(segment(a, b, H, T, M.wall)); scene.add(segment(a, b, 0.05, T + 0.08, M.cap, H));
  }
  // walls around the bar room (the sides that are not part of the terrace outline)
  const ba = BAR.area;
  const corner = FLOOR.reduce((m, p) => (Math.hypot(p[0] - ba[0][0], p[1] - ba[0][1]) < Math.hypot(m[0] - ba[0][0], m[1] - ba[0][1]) ? p : m), FLOOR[0]);
  // back wall, bottom wall, and the short piece joining the terrace wall (the side towards the terrace keeps its opening)
  for (const [a, b] of [[ba[0], ba[3]], [ba[3], ba[2]], [ba[0], corner]]) scene.add(segment(a, b, 2.2, T, M.wall));

  // planters with greenery on top of the chosen walls
  for (const wi of PLANTERS.walls) {
    const a = FLOOR[wi], b = FLOOR[(wi + 1) % n], len = Math.hypot(b[0] - a[0], b[1] - a[1]), ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    for (let d = PLANTERS.every / 2; d < len - 0.4; d += PLANTERS.every) {
      const pl = planterWithPlants(M); const f = d / len;
      pl.scale.setScalar(0.62); pl.position.set(a[0] + (b[0] - a[0]) * f, H + 0.03, a[1] + (b[1] - a[1]) * f); pl.rotation.y = -ang; scene.add(pl);
    }
  }
  // warm string lights along the far and right walls
  const bulbG = new THREE.SphereGeometry(0.035, 8, 6);
  for (const wi of [0, 1]) {
    const a = FLOOR[wi], b = FLOOR[(wi + 1) % n], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    for (let d = 0.3; d < len; d += 0.45) { const f = d / len, s = new THREE.Mesh(bulbG, M.bulb); s.position.set(a[0] + (b[0] - a[0]) * f, H + 1.35 + Math.sin(f * Math.PI * 6) * 0.08, a[1] + (b[1] - a[1]) * f); scene.add(s); }
  }

  // the 10 tables
  const groups = new Map();
  for (const t of TABLES) {
    const g = table(t, M); scene.add(g); groups.set(t.id, g);
    const pl = new THREE.PointLight(COL.lamp, small ? 1.2 : 1.8, 2.6, 2); pl.position.set(t.x, 1.0, t.z); scene.add(pl);
  }

  // dark city below the rooftop
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(160, 160), new THREE.MeshStandardMaterial({ color: 0x141b2b, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.position.set(CX, -0.05, CZ); scene.add(ground);

  // ---------- camera + controls (no automatic rotation) ----------
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.09; controls.autoRotate = false;
  controls.screenSpacePanning = true; controls.minDistance = 2; controls.maxDistance = span * 3; controls.maxPolarAngle = 1.42;
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
  const VIEWS = { iso: [CX + span * 0.55, span * 0.95, BOUNDS.maxZ + span * 0.45], top: [CX, span * 1.65, CZ + 0.01] };
  function setView(v) {
    const p = (VIEWS[v] || VIEWS.iso).slice();
    if (camera.aspect < 1) { const k = Math.min(1.9, 1 / camera.aspect); p[0] = CX + (p[0] - CX) * k; p[1] *= k; p[2] = CZ + (p[2] - CZ) * k; }   // portrait phone: step back so all fits
    camera.position.set(...p); controls.target.set(CX, 0, CZ); controls.update(); dirty = true; }
  function zoom(f) { const off = camera.position.clone().sub(controls.target).multiplyScalar(f); const d = off.length(); if (d < controls.minDistance || d > controls.maxDistance) return; camera.position.copy(controls.target).add(off); dirty = true; }

  // ---------- tap / click on a table ----------
  const ray = new THREE.Raycaster(), ptr = new THREE.Vector2(); let down = null, selected = null;
  const hits = [...groups.values()].map(g => g.userData.hit);
  renderer.domElement.addEventListener('pointerdown', e => { down = [e.clientX, e.clientY]; });
  renderer.domElement.addEventListener('pointerup', e => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 6) return;   // it was a drag, not a tap
    const r = renderer.domElement.getBoundingClientRect();
    ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ptr, camera);
    const hit = ray.intersectObjects(hits, false)[0];
    select(hit ? hit.object.userData.id : null); onPick && onPick(selected);
  });
  function select(id) {
    for (const [k, g] of groups) g.userData.ring.visible = k === id;
    selected = id; dirty = true;
  }

  // ---------- render only when something moves (saves battery and CPU) ----------
  let dirty = true, raf = 0, alive = true;
  controls.addEventListener('change', () => { dirty = true; });
  function loop() { if (!alive) return; raf = requestAnimationFrame(loop); if (controls.update() || dirty) { renderer.render(scene, camera); dirty = false; } }
  function resize() { const w = container.clientWidth || 1, h = container.clientHeight || 1; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); dirty = true; }
  const ro = new ResizeObserver(resize); ro.observe(container);
  resize(); setView('iso'); loop();

  return {
    setView, zoom, select, reset: () => { select(null); setView('iso'); },
    get selected() { return selected; },
    dispose() {
      alive = false; cancelAnimationFrame(raf); ro.disconnect(); controls.dispose();
      scene.traverse(o => { o.geometry?.dispose?.(); const m = o.material; (Array.isArray(m) ? m : m ? [m] : []).forEach(x => { x.map?.dispose?.(); x.dispose?.(); }); });
      renderer.dispose(); renderer.domElement.remove();
    },
    _debug: { scene, camera, renderer },
  };
}

// helpers for walls
function near(p, q, eps = 0.06) { return Math.abs(p[0] - q[0]) < eps && Math.abs(p[1] - q[1]) < eps; }
function onSegment(p, a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1], len2 = dx * dx + dz * dz, t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / len2;
  if (t < -0.05 || t > 1.05) return false;
  return Math.hypot(a[0] + t * dx - p[0], a[1] + t * dz - p[1]) < 0.3;
}
function lerp(a, b, f) { return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]; }
function proj(p, a, b) { const dx = b[0] - a[0], dz = b[1] - a[1]; return ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (dx * dx + dz * dz); }
function addWallWithGap(scene, a, b, gap, H, T, M) {
  let f1 = proj(gap[0], a, b), f2 = proj(gap[1], a, b); if (f1 > f2) [f1, f2] = [f2, f1];
  for (const [s, e] of [[0, f1], [f2, 1]]) if (e - s > 0.01) { const p = lerp(a, b, s), q = lerp(a, b, e); scene.add(segment(p, q, H, T, M.wall)); scene.add(segment(p, q, 0.05, T + 0.08, M.cap, H)); }
}
function addDoorWall(scene, a, b, M) {
  // a taller wall piece around the big grey entrance door
  scene.add(segment(a, b, 2.6, 0.3, M.wall));
  const mid = lerp(ENTRANCE.a, ENTRANCE.b, 0.5), dir = [ENTRANCE.b[0] - ENTRANCE.a[0], ENTRANCE.b[1] - ENTRANCE.a[1]], len = Math.hypot(...dir);
  const u = [dir[0] / len, dir[1] / len], half = ENTRANCE.width / 2;
  const d = segment([mid[0] - u[0] * half + 0.17, mid[1] - u[1] * half], [mid[0] + u[0] * half + 0.17, mid[1] + u[1] * half], ENTRANCE.height, 0.06, M.door);
  scene.add(d);
  const frame = segment([mid[0] - u[0] * (half + 0.06) + 0.19, mid[1] - u[1] * (half + 0.06)], [mid[0] + u[0] * (half + 0.06) + 0.19, mid[1] + u[1] * (half + 0.06)], 0.08, 0.08, M.iron, ENTRANCE.height);
  scene.add(frame);
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.3, 0.04), M.iron); handle.position.set(mid[0] + 0.22, 1.05, mid[1] - u[1] * (half - 0.15)); scene.add(handle);
}
