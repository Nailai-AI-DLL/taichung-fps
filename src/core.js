// 純邏輯(不依賴 three.js / DOM),可用 node --test 驗證。

export const HALF = 200;      // 地圖半邊長(公尺)
export const CELL = 2;        // 尋路格大小(4m 會把沙包陣地整個封死,見決策紀錄)
export const GRID_N = (HALF * 2) / CELL;
const N = GRID_N;

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 線段 o + d*t (t∈[0,1]) 對 AABB;回傳進入點 t,未命中回傳 -1
export function segAABB(ox, oy, oz, dx, dy, dz, b) {
  let t0 = 0, t1 = 1, ta, tb, inv;
  if (Math.abs(dx) < 1e-9) { if (ox < b.minX || ox > b.maxX) return -1; }
  else { inv = 1 / dx; ta = (b.minX - ox) * inv; tb = (b.maxX - ox) * inv; if (ta > tb) { const s = ta; ta = tb; tb = s; } if (ta > t0) t0 = ta; if (tb < t1) t1 = tb; if (t0 > t1) return -1; }
  if (Math.abs(dy) < 1e-9) { if (oy < b.minY || oy > b.maxY) return -1; }
  else { inv = 1 / dy; ta = (b.minY - oy) * inv; tb = (b.maxY - oy) * inv; if (ta > tb) { const s = ta; ta = tb; tb = s; } if (ta > t0) t0 = ta; if (tb < t1) t1 = tb; if (t0 > t1) return -1; }
  if (Math.abs(dz) < 1e-9) { if (oz < b.minZ || oz > b.maxZ) return -1; }
  else { inv = 1 / dz; ta = (b.minZ - oz) * inv; tb = (b.maxZ - oz) * inv; if (ta > tb) { const s = ta; ta = tb; tb = s; } if (ta > t0) t0 = ta; if (tb < t1) t1 = tb; if (t0 > t1) return -1; }
  return t0;
}

// 回傳線段最先撞到場景的 t;沒撞到回傳 1
export function raycastWorld(ox, oy, oz, dx, dy, dz, colliders) {
  let best = 1;
  for (let i = 0; i < colliders.length; i++) {
    const t = segAABB(ox, oy, oz, dx, dy, dz, colliders[i]);
    if (t >= 0 && t < best) best = t;
  }
  return best;
}

// 圓柱(XZ 平面的圓)推出 AABB;p 需有 x、z。可踩上的矮物(頂面 ≤ 腳底+0.35)不擋。
export function resolveCircle(p, r, feetY, bodyH, colliders) {
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < colliders.length; i++) {
      const c = colliders[i];
      if (c.maxY <= feetY + 0.35 || c.minY >= feetY + bodyH) continue;
      const cx = p.x < c.minX ? c.minX : p.x > c.maxX ? c.maxX : p.x;
      const cz = p.z < c.minZ ? c.minZ : p.z > c.maxZ ? c.maxZ : p.z;
      const dx = p.x - cx, dz = p.z - cz, d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2), k = (r - d) / d;
        p.x += dx * k; p.z += dz * k;
      } else {
        // 圓心在盒內:沿穿透最淺的軸推出
        const l = p.x - c.minX, rr = c.maxX - p.x, n = p.z - c.minZ, f = c.maxZ - p.z;
        const m = Math.min(l, rr, n, f);
        if (m === l) p.x = c.minX - r; else if (m === rr) p.x = c.maxX + r;
        else if (m === n) p.z = c.minZ - r; else p.z = c.maxZ + r;
      }
    }
  }
  return p;
}

// 腳下可站立的高度(地面 0 或矮物頂面)
export function groundAt(x, z, feetY, colliders, r = 0.25) {
  let g = 0;
  for (let i = 0; i < colliders.length; i++) {
    const c = colliders[i];
    if (c.maxY > feetY + 0.35 || c.maxY <= g) continue;
    if (x > c.minX - r && x < c.maxX + r && z > c.minZ - r && z < c.maxZ + r) g = c.maxY;
  }
  return g;
}

export const cellIx = (v) => Math.max(0, Math.min(N - 1, Math.floor((v + HALF) / CELL)));
export const cellCenter = (i) => -HALF + (i + 0.5) * CELL;

// 所有擋路的障礙(含車、護欄、沙包)都進尋路格
export function buildGrid(colliders) {
  const g = new Uint8Array(N * N);
  for (let i = 0; i < N; i++) { g[i] = g[i + (N - 1) * N] = g[i * N] = g[N - 1 + i * N] = 1; }
  for (const c of colliders) {
    if (c.maxY < 0.5) continue;
    // 只要障礙(外擴單位半徑)碰到格子方塊就整格封閉:保證沿格心走的路徑不會擦到任何東西
    const m = 0.45 + CELL / 2;
    const x0 = cellIx(c.minX - m - CELL / 2), x1 = cellIx(c.maxX + m + CELL / 2);
    const z0 = cellIx(c.minZ - m - CELL / 2), z1 = cellIx(c.maxZ + m + CELL / 2);
    for (let iz = z0; iz <= z1; iz++) for (let ix = x0; ix <= x1; ix++) {
      const cx = cellCenter(ix), cz = cellCenter(iz);
      if (cx > c.minX - m && cx < c.maxX + m && cz > c.minZ - m && cz < c.maxZ + m) g[ix + iz * N] = 1;
    }
  }
  return g;
}

const DX = [1, -1, 0, 0, 1, 1, -1, -1], DZ = [0, 0, 1, -1, 1, -1, 1, -1];
const _q = new Int32Array(N * N);

export function nearestFree(grid, ix, iz) {
  for (let r = 1; r < N; r++) {
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
      const x = ix + dx, z = iz + dz;
      if (x < 0 || z < 0 || x >= N || z >= N) continue;
      if (!grid[x + z * N]) return x + z * N;
    }
  }
  return -1;
}

// 從目標格做 BFS,out[i] = 到目標的步數(不可達為 -1)
export function flowField(grid, ix, iz, out) {
  out.fill(-1);
  let s = ix + iz * N;
  if (grid[s]) { s = nearestFree(grid, ix, iz); if (s < 0) return out; }
  let h = 0, t = 0;
  out[s] = 0; _q[t++] = s;
  while (h < t) {
    const c = _q[h++], cx = c % N, cz = (c / N) | 0, d = out[c] + 1;
    for (let k = 0; k < 8; k++) {
      const nx = cx + DX[k], nz = cz + DZ[k];
      if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
      const n = nx + nz * N;
      if (grid[n] || out[n] >= 0) continue;
      if (k >= 4 && (grid[nx + cz * N] || grid[cx + nz * N])) continue; // 不切牆角
      out[n] = d; _q[t++] = n;
    }
  }
  return out;
}

// 回傳應前往的鄰格索引;-1 表示沒有更好的格子
export function nextCell(grid, flow, ix, iz) {
  const cur = ix + iz * N;
  const stuck = grid[cur] || flow[cur] < 0; // 被擠進牆邊格:挑任一可達鄰格脫困
  let best = -1, bd = stuck ? Infinity : flow[cur];
  for (let k = 0; k < 8; k++) {
    const nx = ix + DX[k], nz = iz + DZ[k];
    if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
    const n = nx + nz * N;
    if (flow[n] < 0) continue;
    if (!stuck && k >= 4 && (grid[nx + iz * N] || grid[ix + nz * N])) continue;
    if (flow[n] < bd) { bd = flow[n]; best = n; }
  }
  return best;
}

// 位於 (x,z) 的單位下一步該朝哪個點走;沒有更近的格子時直接走向目標 (px,pz)
export function flowTarget(grid, flow, x, z, px, pz, out) {
  const n = nextCell(grid, flow, cellIx(x), cellIx(z));
  if (n >= 0 && flow[n] > 0) { out.x = cellCenter(n % N); out.z = cellCenter((n / N) | 0); }
  else { out.x = px; out.z = pz; }
  return out;
}

export function lerpAngle(a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2; else if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
