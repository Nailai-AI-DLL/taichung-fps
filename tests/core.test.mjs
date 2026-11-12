import test from 'node:test';
import assert from 'node:assert/strict';
import { segAABB, raycastWorld, resolveCircle, groundAt, buildGrid, flowField, nextCell, cellIx, GRID_N, mulberry32 } from '../src/core.js';
import { buildMap } from '../src/map.js';
import { WAVES, ENEMY_TYPES, expandWave } from '../src/config.js';

const box = { minX: 0, maxX: 2, minY: 0, maxY: 2, minZ: 0, maxZ: 2 };

test('segAABB:命中、未命中、起點在盒內', () => {
  assert.ok(Math.abs(segAABB(-2, 1, 1, 4, 0, 0, box) - 0.5) < 1e-9);
  assert.equal(segAABB(-2, 3, 1, 4, 0, 0, box), -1);
  assert.equal(segAABB(-2, 1, 1, 1, 0, 0, box), -1); // 線段太短
  assert.equal(segAABB(1, 1, 1, 5, 0, 0, box), 0);
});

test('raycastWorld:矮掩體擋得住蹲下的目標、擋不住站著的', () => {
  const sandbag = [{ minX: -2, maxX: 2, minY: 0, maxY: 1, minZ: 6.5, maxZ: 7.5 }]; // 玩家在 z=6,沙包夾在中間
  // 敵人槍口高 1.4,距離 20m;玩家貼在沙包後 1m
  assert.ok(raycastWorld(0, 1.4, 25, 0, 0.75 - 1.4, -19, sandbag) < 1, '蹲下(胸口 0.75)應被擋');
  assert.equal(raycastWorld(0, 1.4, 25, 0, 1.4 - 1.4, -19, sandbag), 1, '站立(胸口 1.4)不應被擋');
});

test('resolveCircle:推出牆外;可踩上的矮物不擋', () => {
  const p = resolveCircle({ x: -0.1, z: 1 }, 0.4, 0, 1.7, [box]);
  assert.ok(p.x <= -0.4 + 1e-9);
  const q = resolveCircle({ x: 1, z: 1 }, 0.4, 2, 1.7, [box]);
  assert.deepEqual(q, { x: 1, z: 1 });
  assert.equal(groundAt(1, 1, 2.1, [box]), 2);
  assert.equal(groundAt(1, 1, 0, [box]), 0);
});

test('地圖:出生點與重生點不在障礙物內,且固定種子可重現', () => {
  const m = buildMap(), m2 = buildMap();
  assert.equal(JSON.stringify(m.buildings), JSON.stringify(m2.buildings));
  const pts = [[m.playerStart.x, m.playerStart.z], [m.supply.x, m.supply.z], ...Object.values(m.spawns).flat()];
  for (const [x, z] of pts) {
    for (const c of m.colliders) {
      const inside = x > c.minX - 0.6 && x < c.maxX + 0.6 && z > c.minZ - 0.6 && z < c.maxZ + 0.6;
      assert.ok(!inside, `點 (${x},${z}) 卡在 ${c.kind} 內`);
    }
  }
});

test('尋路:每個重生點都走得到玩家出生點', () => {
  const m = buildMap(), grid = buildGrid(m.colliders), flow = new Int16Array(GRID_N * GRID_N);
  flowField(grid, cellIx(m.playerStart.x), cellIx(m.playerStart.z), flow);
  for (const [dir, list] of Object.entries(m.spawns)) for (const [x, z] of list) {
    let ix = cellIx(x), iz = cellIx(z);
    assert.ok(flow[ix + iz * GRID_N] >= 0, `${dir} (${x},${z}) 不可達`);
    let steps = 0;
    while (flow[ix + iz * GRID_N] > 0 && steps++ < 500) {
      const n = nextCell(grid, flow, ix, iz);
      assert.ok(n >= 0, `${dir} (${x},${z}) 中途卡住`);
      ix = n % GRID_N; iz = (n / GRID_N) | 0;
    }
    assert.equal(flow[ix + iz * GRID_N], 0);
  }
});

test('波次:展開後數量、兵種、方向皆合法', () => {
  const rng = mulberry32(1), m = buildMap();
  for (const w of WAVES) {
    const list = expandWave(w, rng);
    assert.equal(list.length, Object.values(w.units).reduce((a, b) => a + b, 0));
    for (const u of list) { assert.ok(ENEMY_TYPES[u.type]); assert.ok(m.spawns[u.dir]); }
  }
});

// 防再犯:敵兵曾因汽車/護欄未進尋路格而卡住(見 docs/decisions/0001「已修正的問題」)
test('走位模擬:任一重生點的步兵都能實際走到玩家身邊(含碰撞)', async () => {
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
      for (let i = 0; i < 4000; i++) { // 200 秒
        if (Math.hypot(px - p.x, pz - p.z) < 6) { ok = true; break; } // 進到貼身距離即算到達
        flowTarget(grid, flow, p.x, p.z, px, pz, ft);
        const vx = ft.x - p.x, vz = ft.z - p.z, l = Math.hypot(vx, vz) || 1;
        p.x += vx / l * speed * dt; p.z += vz / l * speed * dt;
        resolveCircle(p, 0.4, 0, 1.7, m.colliders);
      }
      if (!ok) fails.push(`${dir}(${sx},${sz})→玩家(${px.toFixed(0)},${pz.toFixed(0)}) 停在 (${p.x.toFixed(1)},${p.z.toFixed(1)})`);
    }
  }
  assert.equal(fails.length, 0, `${fails.length} 條路線卡住,例:\n` + fails.slice(0, 8).join('\n'));
});
