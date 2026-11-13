// Stylized map data for Taichung's 7th Redevelopment Zone (pure data, no three.js).
// Note: road names and landmarks are real, but positions, sizes, and building counts are arranged for gameplay, not surveyed.
import { mulberry32, HALF } from './core.js';

// axis 'x' is an east-west road (at z=c); 'z' is a north-south road (at x=c). North is -z.
export const ROADS = [
  { name: 'Taiwan Blvd', axis: 'x', c: -125, w: 30 },
  { name: 'Shizheng N 2nd Rd', axis: 'x', c: -20, w: 14 },
  { name: 'Shizheng Rd', axis: 'x', c: 50, w: 16 },
  { name: 'Shizheng S 1st Rd', axis: 'x', c: 160, w: 12 },
  { name: 'Huilai Rd', axis: 'z', c: -160, w: 14 },
  { name: 'Henan Rd', axis: 'z', c: -70, w: 14 },
  { name: 'Huizhong Rd', axis: 'z', c: 70, w: 14 },
  { name: 'Wenxin Rd', axis: 'z', c: 160, w: 20 },
];

const XI = [[-200, -167], [-153, -77], [-63, 63], [77, 150], [170, 200]];
const ZI = [[-200, -140], [-110, -27], [-13, 42], [58, 154], [166, 200]];
const SPECIAL = { '2,0': 'maple', '2,1': 'cityhall', '2,2': 'park', '2,3': 'opera', '1,1': 'mall' };
const TALL = new Set(['1,2', '1,3', '3,1', '3,2', '3,3']);

export const PLAYER_START = { x: 0, z: 20 };
export const SUPPLY_POINT = { x: 0, z: 25 };

export const SPAWNS = {
  N: [[-120, -125], [-40, -128], [0, -122], [40, -128], [120, -125]],
  E: [[160, -60], [160, 10], [160, 100]],
  W: [[-160, -60], [-160, 10], [-160, 100]],
  S: [[-110, 160], [-20, 160], [20, 160], [110, 160]],
};

const CAR_COLORS = [0x8a8f96, 0xd9d9d6, 0x2b2e33, 0x7a1f1f, 0x1f3a5f, 0xb9a36b, 0x3d3d3d, 0xe8e4da];

export function buildMap(seed = 7) {
  const rng = mulberry32(seed);
  const R = (a, b) => a + rng() * (b - a);
  const buildings = [], props = [], trees = [], blocks = [], labels = [], decos = [];
  const B = (x, z, w, d, h, style) => buildings.push({ x, z, w, d, h, style });
  const P = (type, x, z, w, d, h, color) => props.push({ type, x, z, w, d, h, color });

  function fill(x0, x1, z0, z1, tall) {
    const m = 4, gap = 9;
    x0 += m; x1 -= m; z0 += m; z1 -= m;
    const W = x1 - x0, D = z1 - z0;
    const nx = Math.max(1, Math.round(W / 36)), nz = Math.max(1, Math.round(D / 36));
    const gw = (W - (nx - 1) * gap) / nx, gd = (D - (nz - 1) * gap) / nz;
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
      const cx = x0 + gw / 2 + i * (gw + gap), cz = z0 + gd / 2 + j * (gd + gap);
      const w = gw - R(0, 5), d = gd - R(0, 5);
      const h = tall ? R(55, 120) : R(18, 55);
      const style = tall ? (rng() < 0.6 ? 'res' : 'office') : (rng() < 0.5 ? 'office' : 'res');
      B(cx, cz, w, d, h, style);
    }
  }

  for (let ci = 0; ci < 5; ci++) for (let ri = 0; ri < 5; ri++) {
    const [x0, x1] = XI[ci], [z0, z1] = ZI[ri], key = ci + ',' + ri, kind = SPECIAL[key] || 'city';
    blocks.push({ x0, x1, z0, z1, green: kind === 'park' || kind === 'maple' });
    if (kind === 'cityhall') {
      B(-34, -74, 34, 30, 62, 'gov'); B(34, -74, 34, 30, 62, 'gov');
      decos.push({ type: 'beam', x: 0, y: 55, z: -74, w: 34, h: 12, d: 30 });
      labels.push({ text: 'TAICHUNG CITY HALL', x: 0, y: 55, z: -58.8, ry: 0, size: 3 });
      for (let i = 0; i < 6; i++) trees.push({ x: -50 + i * 20, z: -36, s: 1, red: false });
    } else if (kind === 'opera') {
      B(0, 114, 84, 46, 30, 'opera');
      labels.push({ text: 'NATIONAL TAICHUNG THEATER', x: 0, y: 23, z: 90.8, ry: Math.PI, size: 3 });
      for (let i = 0; i < 10; i++) trees.push({ x: R(-58, 58), z: R(62, 86), s: R(0.8, 1.2), red: false });
    } else if (kind === 'mall') {
      B(-115, -88, 64, 36, 48, 'mall'); B(-115, -46, 64, 30, 40, 'mall');
      labels.push({ text: 'DEPARTMENT STORE', x: -82.8, y: 36, z: -88, ry: Math.PI / 2, size: 2.4 });
    } else if (kind === 'park') {
      for (let i = 0; i < 46; i++) {
        const x = R(x0 + 3, x1 - 3), z = R(z0 + 3, z1 - 3);
        if (Math.abs(x) < 11 && z > 9 && z < 31) continue; // keep the command post clear
        trees.push({ x, z, s: R(0.8, 1.4), red: false });
      }
    } else if (kind === 'maple') {
      decos.push({ type: 'pond', x: 0, z: -172, r: 22 });
      labels.push({ text: 'MAPLE GARDEN', x: 0, y: 4, z: -146, ry: 0, size: 2.2 });
      for (let i = 0; i < 34; i++) {
        const a = R(0, Math.PI * 2), r = R(25, 36);
        const x = Math.cos(a) * r * 1.5, z = -172 + Math.sin(a) * r;
        if (z < z0 + 2 || z > z1 - 2 || x < x0 + 2 || x > x1 - 2) continue;
        trees.push({ x, z, s: R(0.9, 1.5), red: true });
      }
    } else {
      fill(x0, x1, z0, z1, TALL.has(key));
    }
  }
  // Trees along the Taiwan Blvd median
  for (let x = -190; x <= 190; x += 14) trees.push({ x, z: -125, s: 1.1, red: false });

  const spawnList = Object.values(SPAWNS).flat();
  const nearSpawn = (x, z, r) => spawnList.some(([sx, sz]) => Math.hypot(sx - x, sz - z) < r);

  // Abandoned vehicles on the roads (cover)
  for (const road of ROADS) {
    for (let t = -188; t < 188; t += R(12, 24)) {
      if (rng() > 0.55) continue;
      const lat = (rng() < 0.5 ? -1 : 1) * road.w * R(0.15, 0.38);
      const bus = rng() < 0.1;
      const L = bus ? 11 : 4.4, Wd = bus ? 2.6 : 1.9, H = bus ? 3.1 : 1.45;
      const x = road.axis === 'x' ? t : road.c + lat, z = road.axis === 'x' ? road.c + lat : t;
      if (nearSpawn(x, z, 9) || Math.hypot(x - PLAYER_START.x, z - PLAYER_START.z) < 12) continue;
      const w = road.axis === 'x' ? L : Wd, d = road.axis === 'x' ? Wd : L;
      P(bus ? 'bus' : 'car', x, z, w, d, H, bus ? 0x2f6b4f : CAR_COLORS[Math.floor(rng() * CAR_COLORS.length)]);
    }
  }

  // Hand-placed defensive works
  for (let x = -24; x <= 24; x += 3) { if (Math.abs(x) === 6 || Math.abs(x) === 18) continue; P('barrier', x, -15, 2.4, 0.6, 0.95, 0x9c9c96); }
  for (let x = -21; x <= 21; x += 3) { if (Math.abs(x) === 9) continue; P('barrier', x, 45, 2.4, 0.6, 0.95, 0x9c9c96); }
  const SB = 0x8d7c57;
  P('sandbag', -3.6, 14, 4, 0.9, 1.0, SB); P('sandbag', 3.6, 14, 4, 0.9, 1.0, SB);
  P('sandbag', -6, 19, 0.9, 6, 1.0, SB); P('sandbag', 6, 19, 0.9, 6, 1.0, SB);
  P('sandbag', -20, 0, 5, 0.9, 1.0, SB); P('sandbag', 20, 0, 5, 0.9, 1.0, SB);
  P('sandbag', -40, 15, 0.9, 5, 1.0, SB); P('sandbag', 40, 15, 0.9, 5, 1.0, SB);
  P('sandbag', -11, 37, 5, 0.9, 1.0, SB); P('sandbag', 11, 37, 5, 0.9, 1.0, SB);
  P('sandbag', -9, -44, 5, 0.9, 1.0, SB); P('sandbag', 9, -44, 5, 0.9, 1.0, SB);
  const CR = 0x5a6a3c;
  P('crate', -4.2, 27, 1.2, 1.2, 1.2, CR); P('crate', 4.4, 28, 1.2, 1.2, 1.2, CR); P('crate', 5.6, 28.2, 1.2, 1.2, 0.8, CR);
  P('crate', -30, 30, 1.2, 1.2, 1.2, CR); P('crate', 28, -6, 1.2, 1.2, 1.2, CR);

  // Extra cover in varied heights: low pieces to crouch behind, chest-high pieces, and tall pieces that hide a standing
  // player. The 1.1 m and 2.2 m crates form steps (the player can jump 1.1 m), so stacks double as vantage points.
  const COVER = [ // type, w, d, h, color
    ['block', 2.0, 0.8, 0.7, 0x8f908a], ['block', 2.2, 0.9, 1.2, 0x8f908a], ['block', 1.6, 1.6, 1.8, 0x85867f],
    ['hesco', 1.5, 1.5, 1.4, 0x9a8a63], ['hesco', 3.0, 1.5, 1.4, 0x9a8a63],
    ['crate', 1.1, 1.1, 1.1, CR], ['crate', 1.1, 1.1, 2.2, 0x4f5e36],
    ['container', 6.0, 2.4, 2.6, 0x7a3b2e], ['container', 2.4, 6.0, 2.6, 0x2f5a6b],
  ];
  const clearOf = (x, z, w, d, pad) =>
    !props.some((p) => Math.abs(p.x - x) < (p.w + w) / 2 + pad && Math.abs(p.z - z) < (p.d + d) / 2 + pad) &&
    !buildings.some((b) => Math.abs(b.x - x) < (b.w + w) / 2 + pad && Math.abs(b.z - z) < (b.d + d) / 2 + pad);
  function scatter(x0, x1, z0, z1, n, kinds) {
    for (let tries = 0; n > 0 && tries < 400; tries++) {
      const [type, w, d, h, color] = COVER[kinds[Math.floor(rng() * kinds.length)]], x = R(x0, x1), z = R(z0, z1);
      // 3.2 m between pieces keeps every gap walkable for the pathfinding grid
      if (Math.hypot(x - PLAYER_START.x, z - PLAYER_START.z) < 9 || nearSpawn(x, z, 10) || !clearOf(x, z, w, d, 3.2)) continue;
      P(type, x, z, w, d, h, color); n--;
    }
  }
  scatter(-58, 58, -9, 38, 16, [0, 1, 2, 3, 4, 5, 6]);      // the park around the command post
  scatter(-45, 45, -56, -30, 9, [0, 1, 2, 3, 4, 5]);         // City Hall plaza
  scatter(-12, 12, -86, -62, 3, [1, 3, 5]);                  // the gap between the City Hall towers
  scatter(-55, 55, 62, 86, 9, [0, 1, 2, 3, 4, 6]);           // theater plaza
  scatter(-150, 150, -136, -114, 8, [7, 8, 2, 4]);           // Taiwan Blvd
  scatter(-150, 150, -25, -22, 5, [7]);                      // Shizheng N 2nd Rd
  scatter(-150, 150, 46, 54, 5, [7, 4]);                     // Shizheng Rd
  scatter(-74, -66, -100, 150, 5, [8, 1]);                   // Henan Rd
  scatter(66, 74, -100, 150, 5, [8, 1]);                     // Huizhong Rd
  // Stepped stacks beside the command post: 1.1 m, then 2.2 m
  for (const [sx, sz] of [[-15, 27], [16, 7]]) { P('crate', sx, sz, 1.1, 1.1, 1.1, CR); P('crate', sx - 1.1, sz, 1.1, 1.1, 2.2, 0x4f5e36); P('crate', sx - 1.1, sz + 1.1, 1.1, 1.1, 2.2, 0x4f5e36); }

  const colliders = [];
  for (const b of buildings) colliders.push({ minX: b.x - b.w / 2, maxX: b.x + b.w / 2, minY: 0, maxY: b.h, minZ: b.z - b.d / 2, maxZ: b.z + b.d / 2, kind: 'bldg' });
  for (const p of props) colliders.push({ minX: p.x - p.w / 2, maxX: p.x + p.w / 2, minY: 0, maxY: p.h, minZ: p.z - p.d / 2, maxZ: p.z + p.d / 2, kind: p.type });
  const E = HALF - 1;
  colliders.push({ minX: -HALF, maxX: HALF, minY: 0, maxY: 60, minZ: -HALF - 2, maxZ: -E, kind: 'bound' });
  colliders.push({ minX: -HALF, maxX: HALF, minY: 0, maxY: 60, minZ: E, maxZ: HALF + 2, kind: 'bound' });
  colliders.push({ minX: -HALF - 2, maxX: -E, minY: 0, maxY: 60, minZ: -HALF, maxZ: HALF, kind: 'bound' });
  colliders.push({ minX: E, maxX: HALF + 2, minY: 0, maxY: 60, minZ: -HALF, maxZ: HALF, kind: 'bound' });

  return { buildings, props, trees, blocks, labels, decos, colliders, roads: ROADS, spawns: SPAWNS, playerStart: PLAYER_START, supply: SUPPLY_POINT };
}
