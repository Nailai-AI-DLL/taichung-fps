import test from 'node:test';
import assert from 'node:assert/strict';
import { segAABB, raycastWorld, resolveCircle, groundAt, buildGrid, flowField, nextCell, cellIx, GRID_N, mulberry32 } from '../src/core.js';
import { buildMap } from '../src/map.js';
import { WAVES, ENEMY_TYPES, WEAPONS, SHOP, expandWave } from '../src/config.js';

const box = { minX: 0, maxX: 2, minY: 0, maxY: 2, minZ: 0, maxZ: 2 };

test('segAABB: hit, miss, and origin inside the box', () => {
  assert.ok(Math.abs(segAABB(-2, 1, 1, 4, 0, 0, box) - 0.5) < 1e-9);
  assert.equal(segAABB(-2, 3, 1, 4, 0, 0, box), -1);
  assert.equal(segAABB(-2, 1, 1, 1, 0, 0, box), -1); // segment too short
  assert.equal(segAABB(1, 1, 1, 5, 0, 0, box), 0);
});

test('raycastWorld: low cover blocks a crouching target but not a standing one', () => {
  const sandbag = [{ minX: -2, maxX: 2, minY: 0, maxY: 1, minZ: 6.5, maxZ: 7.5 }]; // player at z=6, sandbag in between
  // enemy muzzle at 1.4 m, about 20 m away; player 1 m behind the sandbag
  assert.ok(raycastWorld(0, 1.4, 25, 0, 0.75 - 1.4, -19, sandbag) < 1, 'crouching (chest 0.75) should be blocked');
  assert.equal(raycastWorld(0, 1.4, 25, 0, 1.4 - 1.4, -19, sandbag), 1, 'standing (chest 1.4) should not be blocked');
});

test('resolveCircle: pushes out of walls; steppable low objects do not block', () => {
  const p = resolveCircle({ x: -0.1, z: 1 }, 0.4, 0, 1.7, [box]);
  assert.ok(p.x <= -0.4 + 1e-9);
  const q = resolveCircle({ x: 1, z: 1 }, 0.4, 2, 1.7, [box]);
  assert.deepEqual(q, { x: 1, z: 1 });
  assert.equal(groundAt(1, 1, 2.1, [box]), 2);
  assert.equal(groundAt(1, 1, 0, [box]), 0);
});

test('map: start and spawn points are clear of obstacles, and the fixed seed is reproducible', () => {
  const m = buildMap(), m2 = buildMap();
  assert.equal(JSON.stringify(m.buildings), JSON.stringify(m2.buildings));
  const pts = [[m.playerStart.x, m.playerStart.z], [m.supply.x, m.supply.z], ...Object.values(m.spawns).flat()];
  for (const [x, z] of pts) {
    for (const c of m.colliders) {
      const inside = x > c.minX - 0.6 && x < c.maxX + 0.6 && z > c.minZ - 0.6 && z < c.maxZ + 0.6;
      assert.ok(!inside, `point (${x},${z}) is inside a ${c.kind}`);
    }
  }
});

test('pathfinding: every spawn point can reach the player start', () => {
  const m = buildMap(), grid = buildGrid(m.colliders), flow = new Int16Array(GRID_N * GRID_N);
  flowField(grid, cellIx(m.playerStart.x), cellIx(m.playerStart.z), flow);
  for (const [dir, list] of Object.entries(m.spawns)) for (const [x, z] of list) {
    let ix = cellIx(x), iz = cellIx(z);
    assert.ok(flow[ix + iz * GRID_N] >= 0, `${dir} (${x},${z}) is unreachable`);
    let steps = 0;
    while (flow[ix + iz * GRID_N] > 0 && steps++ < 500) {
      const n = nextCell(grid, flow, ix, iz);
      assert.ok(n >= 0, `${dir} (${x},${z}) got stuck on the way`);
      ix = n % GRID_N; iz = (n / GRID_N) | 0;
    }
    assert.equal(flow[ix + iz * GRID_N], 0);
  }
});

test('waves: expanded counts, unit types, and directions are all valid', () => {
  const rng = mulberry32(1), m = buildMap();
  for (const w of WAVES) {
    const list = expandWave(w, rng);
    assert.equal(list.length, Object.values(w.units).reduce((a, b) => a + b, 0));
    for (const u of list) { assert.ok(ENEMY_TYPES[u.type]); assert.ok(m.spawns[u.dir]); }
  }
});

// Regression guard: soldiers once got stuck because cars and barriers were missing from the grid (see docs/decisions/0001, "Fixed issues")
test('walking simulation: a soldier from any spawn point can physically reach the player (with collision)', async () => {
  const { flowTarget } = await import('../src/core.js');
  const m = buildMap(), grid = buildGrid(m.colliders), flow = new Int16Array(GRID_N * GRID_N), rng = mulberry32(42), ft = { x: 0, z: 0 };
  const free = (x, z) => !m.colliders.some((c) => x > c.minX - 0.8 && x < c.maxX + 0.8 && z > c.minZ - 0.8 && z < c.maxZ + 0.8);
  const players = [[m.playerStart.x, m.playerStart.z]];
  while (players.length < 60) { const x = (rng() - 0.5) * 380, z = (rng() - 0.5) * 380; if (free(x, z)) players.push([x, z]); }
  const fails = [];
  for (const [px, pz] of players) {
    flowField(grid, cellIx(px), cellIx(pz), flow);
    for (const [dir, list] of Object.entries(m.spawns)) for (const [sx, sz] of list) {
      const p = { x: sx, z: sz }, dt = 0.05, speed = 3.3; let ok = false;
      for (let i = 0; i < 4000; i++) { // 200 seconds
        if (Math.hypot(px - p.x, pz - p.z) < 6) { ok = true; break; } // close range counts as arrival
        flowTarget(grid, flow, p.x, p.z, px, pz, ft);
        const vx = ft.x - p.x, vz = ft.z - p.z, l = Math.hypot(vx, vz) || 1;
        p.x += vx / l * speed * dt; p.z += vz / l * speed * dt;
        resolveCircle(p, 0.4, 0, 1.7, m.colliders);
      }
      if (!ok) fails.push(`${dir}(${sx},${sz})-> player (${px.toFixed(0)},${pz.toFixed(0)}) stopped at (${p.x.toFixed(1)},${p.z.toFixed(1)})`);
    }
  }
  assert.equal(fails.length, 0, `${fails.length} routes got stuck, e.g.\n` + fails.slice(0, 8).join('\n'));
});

test('shop: every item points at a real weapon, and priced weapons are sold exactly once', () => {
  for (const it of SHOP) {
    assert.ok(it.price > 0 && Number.isFinite(it.price));
    assert.ok(['weapon', 'ammo', 'grenade', 'med'].includes(it.type), `${it.id} has an unknown type`);
    if (it.type === 'grenade' || it.type === 'med') { assert.ok(it.amount > 0); continue; }
    const w = WEAPONS.find((x) => x.id === it.weapon);
    assert.ok(w, `${it.id} refers to an unknown weapon`);
    if (it.type === 'weapon') assert.equal(it.price, w.price, `${it.id} price differs from WEAPONS`);
    else assert.ok(it.amount > 0 && w.maxReserve !== Infinity);
  }
  for (const w of WEAPONS.filter((x) => x.price)) assert.equal(SHOP.filter((it) => it.type === 'weapon' && it.weapon === w.id).length, 1);
  assert.ok(WEAPONS.some((w) => !w.price), 'the player must start with at least one weapon');
  assert.equal(new Set(SHOP.map((it) => it.id)).size, SHOP.length, 'shop ids must be unique');
  for (const w of WEAPONS.filter((x) => x.price)) assert.ok(w.supply > 0 && SHOP.some((it) => it.type === 'ammo' && it.weapon === w.id), `${w.id} needs a way to get ammo`);
  for (const e of Object.values(ENEMY_TYPES)) assert.ok(e.score > 0, 'every enemy pays a reward');
});
