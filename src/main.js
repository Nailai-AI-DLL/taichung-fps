// Main game entry point: wires world, audio, HUD, weapons, enemies, pickups, waves, shop, and input.
import * as THREE from '../vendor/three.module.min.js';
import { resolveCircle, groundAt, buildGrid, flowField, cellIx, GRID_N } from './core.js';
import { buildMap } from './map.js';
import { PLAYER as PL, RULES, WAVES, STORY, expandWave } from './config.js';
import { CFG, initAudio, bindSettingsUI, sfx } from './audio.js';
import { createScene, buildWorld, createFxPool, lam, box, glowTex } from './world.js';
import { createHud } from './hud.js';
import { createShop } from './shop.js';
import { VIEW, ARMS, FP, createWeapons } from './weapons.js';
import { SOLDIER, createEnemies } from './enemies.js';

const $ = (id) => document.getElementById(id);
const NOLOCK = new URLSearchParams(location.search).has('nolock');

// ============================================================ Scene & World
const { renderer, scene, camera, sky, updateSun } = createScene($('game'));
const MAP = buildMap();
const colliders = MAP.colliders;
const grid = buildGrid(colliders);
const flow = new Int16Array(GRID_N * GRID_N);
const { updateSmoke } = buildWorld(scene, MAP);
const fx = createFxPool(scene);
const hud = createHud();

// ============================================================ Shared State
const S = { mode: 'menu', wave: -1, queue: [], spawnT: 0, interT: 0, time: 0, kills: 0, heads: 0, shots: 0, hits: 0, flowT: 0, alive: 0, money: 0, earned: 0 };
const P = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), yaw: 0, pitch: 0, hp: PL.hp, eye: PL.eye, crouch: false, onGround: true, lastHurt: -99, wi: 0, grenades: PL.grenades, ads: false, bloom: 0, bob: 0, kick: 0 };
const enemies = [], hitMeshes = [], pickups = [];
const keys = new Set();
const input = { firing: false, fireLatch: false, fireQueued: false, edgeTurn: 0 };

// ============================================================ Subsystems
let enemiesSys;
const weapons = createWeapons({
  scene, camera, colliders, S, P, enemies, hitMeshes, fx, hud,
  onDamageEnemy: (e, dmg, head) => enemiesSys.damageEnemy(e, dmg, head),
  onDamagePlayer: (dmg, sx, sz) => damagePlayer(dmg, sx, sz),
  onM16Loaded: () => { for (const e of enemies) if (e.body && !e.handGun) enemiesSys.attachHandGun(e); },
});
enemiesSys = createEnemies({
  scene, colliders, grid, flow, MAP, S, P, enemies, hitMeshes, fx, hud,
  protoGuns: weapons.protoGuns,
  onSoldierLoaded: (proto) => weapons.buildFpArms(proto),
  onDamagePlayer: (dmg, sx, sz) => damagePlayer(dmg, sx, sz),
  onExplode: (pos, r, dmg, byPlayer) => weapons.explode(pos, r, dmg, byPlayer),
  onDropPickup: (type, x, z) => addPickup(type, x, z),
});

const assetsReady = Promise.allSettled([weapons.loadViewModels(), enemiesSys.loadSoldier()]).then(() => {
  const btn = $('btnStart');
  btn.disabled = false;
  btn.textContent = 'DEPLOY';
});

// ============================================================ Player
function updatePlayer(dt) {
  let f = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0), s = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
  const len = Math.hypot(f, s) || 1; f /= len; s /= len;
  if (input.edgeTurn && !document.pointerLockElement) P.yaw -= input.edgeTurn * 2.4 * dt;
  P.crouch = keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC');
  const sprint = keys.has('ShiftLeft') && f > 0 && !P.crouch && !P.ads;
  let sp = P.crouch ? PL.crouch : sprint ? PL.sprint : PL.walk; if (P.ads) sp *= PL.adsMul;
  const sy = Math.sin(P.yaw), cy = Math.cos(P.yaw);
  const tx = (-sy * f + cy * s) * sp, tz = (-cy * f - sy * s) * sp, a = Math.min(1, (P.onGround ? 12 : 2.5) * dt);
  P.vel.x += (tx - P.vel.x) * a; P.vel.z += (tz - P.vel.z) * a;
  if (P.onGround && keys.has('Space') && !P.crouch) { P.vel.y = PL.jump; P.onGround = false; }
  P.vel.y -= PL.gravity * dt;
  P.pos.addScaledVector(P.vel, dt);
  resolveCircle(P.pos, PL.radius, P.pos.y, 1.7, colliders);
  const g = groundAt(P.pos.x, P.pos.z, P.pos.y, colliders);
  if (P.pos.y <= g) { P.pos.y = g; P.vel.y = 0; P.onGround = true; } else P.onGround = false;
  P.eye += ((P.crouch ? PL.eyeCrouch : PL.eye) - P.eye) * Math.min(1, 12 * dt);
  const hs = Math.hypot(P.vel.x, P.vel.z);
  if (P.onGround) P.bob += hs * dt * 1.6;
  if (S.time - P.lastHurt > PL.regenDelay && P.hp < PL.regenCap) P.hp = Math.min(PL.regenCap, P.hp + PL.regenRate * dt);
  camera.position.set(P.pos.x, P.pos.y + P.eye + Math.sin(P.bob * 2) * 0.035 * Math.min(1, hs / 5), P.pos.z);
  camera.rotation.set(P.pitch, P.yaw, 0);
  const cw = weapons.getW()[P.wi], fov = P.ads && cw.reloadT <= 0 ? (cw.def.zoomFov || 48) : sprint ? 80 : 75;
  if (Math.abs(camera.fov - fov) > 0.1) { camera.fov += (fov - camera.fov) * Math.min(1, 14 * dt); camera.updateProjectionMatrix(); }
  camera.updateMatrixWorld();
}

function damagePlayer(dmg, sx, sz) {
  if (S.mode !== 'playing') return;
  P.hp -= dmg; P.lastHurt = S.time; sfx.hurt();
  let ang;
  if (sx !== undefined) {
    const vx = sx - P.pos.x, vz = sz - P.pos.z, sy = Math.sin(P.yaw), cy = Math.cos(P.yaw);
    ang = Math.atan2(vx * cy - vz * sy, -vx * sy - vz * cy);
  }
  hud.setHurt(Math.min(0.8, 0.3 + dmg / 40), ang);
  if (P.hp <= 0) endGame(false);
}

// ============================================================ Pickups (shared materials)
const pickupRedMat = new THREE.MeshBasicMaterial({ color: 0xd8281e });
const pickupGlowMats = {
  ammo:   new THREE.SpriteMaterial({ map: glowTex, color: 0x9fd36a, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.55 }),
  med:    new THREE.SpriteMaterial({ map: glowTex, color: 0xffffff, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.55 }),
  supply: new THREE.SpriteMaterial({ map: glowTex, color: 0xffb347, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.55 }),
};

function addPickup(type, x, z) {
  const g = new THREE.Group();
  if (type === 'ammo') box(g, lam(0x55702f), 0.5, 0.3, 0.3, 0, 0, 0);
  else if (type === 'med') { box(g, lam(0xeeeeee), 0.42, 0.3, 0.3, 0, 0, 0); box(g, pickupRedMat, 0.14, 0.31, 0.31, 0, 0, 0); }
  else { box(g, lam(0x5a6a3c), 1.1, 0.8, 0.8, 0, 0, 0); box(g, lam(0xffb347), 1.12, 0.1, 0.82, 0, 0.2, 0); }
  const glow = new THREE.Sprite(pickupGlowMats[type] || pickupGlowMats.ammo);
  glow.scale.setScalar(type === 'supply' ? 4 : 1.8); g.add(glow);
  g.position.set(x, type === 'supply' ? 0.6 : 0.5, z); scene.add(g);
  pickups.push({ type, mesh: g, t: 0 });
}

function updatePickups(dt) {
  const W = weapons.getW();
  for (let i = pickups.length - 1; i >= 0; i--) {
    const k = pickups[i], m = k.mesh; k.t += dt; m.rotation.y += dt * 1.5; if (k.type !== 'supply') m.position.y = 0.5 + Math.sin(k.t * 3) * 0.08;
    if (Math.hypot(m.position.x - P.pos.x, m.position.z - P.pos.z) > (k.type === 'supply' ? 2 : 1.4)) { if (k.type !== 'supply' && k.t > 45) { scene.remove(m); pickups.splice(i, 1); } continue; }
    const r = W[0];
    if (k.type === 'ammo') { if (r.reserve >= r.def.maxReserve) continue; const n = Math.min(RULES.ammoPickup, r.def.maxReserve - r.reserve); r.reserve += n; hud.tip('+' + n + ' RIFLE AMMO'); }
    else if (k.type === 'med') { if (P.hp >= PL.hp) continue; P.hp = Math.min(PL.hp, P.hp + RULES.medPickup); hud.tip('+' + RULES.medPickup + ' HEALTH'); }
    else if (r.reserve >= r.def.maxReserve && P.hp >= PL.hp && P.grenades >= PL.maxGrenades) continue;
    else { r.reserve = Math.min(r.def.maxReserve, r.reserve + RULES.supplyAmmo); P.hp = Math.min(PL.hp, P.hp + RULES.supplyHeal); P.grenades = Math.min(PL.maxGrenades, P.grenades + RULES.supplyGrenades); for (const x of W) if (x.def.supply && x.owned) x.reserve = Math.min(x.def.maxReserve, x.reserve + x.def.supply); hud.tip('RESUPPLIED'); }
    sfx.pick(); scene.remove(m); pickups.splice(i, 1);
  }
}

// ============================================================ Waves & Flow
function startWave(n) {
  S.wave = n; const w = WAVES[n];
  S.queue = expandWave(w); S.spawnT = 0.5;
  hud.banner(w.name, `WAVE ${n + 1}`); hud.radio(w.radio);
}
function updateWaves(dt) {
  if (S.interT > 0) { if ((S.interT -= dt) <= 0) startWave(S.wave + 1); return; }
  if (S.queue.length) { if ((S.spawnT -= dt) <= 0 && S.alive < RULES.maxAlive) { enemiesSys.spawnEnemy(S.queue.pop()); S.spawnT = RULES.spawnGap; } }
  else if (S.alive === 0) {
    if (S.wave >= WAVES.length - 1) { endGame(true); return; }
    S.interT = RULES.intermission; hud.banner('REPELLED', `WAVE ${S.wave + 1}`, 2.5); hud.radio(STORY.supply, 6); hud.tip('PRESS B — ARMORY');
    if (!pickups.some((p) => p.type === 'supply')) addPickup('supply', MAP.supply.x, MAP.supply.z);
  }
}

function setMode(m) {
  S.mode = m;
  $('menu').classList.toggle('hidden', m !== 'menu'); $('pause').classList.toggle('hidden', m !== 'paused');
  $('end').classList.toggle('hidden', m !== 'dead' && m !== 'won'); $('hud').classList.toggle('hidden', m === 'menu');
  $('shop').classList.toggle('hidden', m !== 'shop');
  if (m !== 'playing') hud.setScope(false);
  weapons.gun.visible = m !== 'menu';
}

let lockFailed = false;
function lock() { if (NOLOCK) return; try { const r = renderer.domElement.requestPointerLock(); if (r && r.catch) r.catch(() => { lockFailed = true; }); } catch { lockFailed = true; } }

function clearWorld() {
  enemiesSys.clearEnemies();
  for (const p of pickups) scene.remove(p.mesh); pickups.length = 0;
  weapons.clearGrenades();
  fx.clearFx();
}

function toMenu() {
  clearWorld(); input.firing = false; keys.clear(); P.ads = false;
  camera.fov = 75; camera.updateProjectionMatrix();
  if (document.pointerLockElement) document.exitPointerLock();
  setMode('menu');
}

const shop = createShop({
  S, P, getW: weapons.getW, setMode,
  onPauseInput: () => { input.firing = false; keys.clear(); P.ads = false; },
  onResume: () => { last = performance.now(); lock(); },
});

function startGame() {
  initAudio();
  clearWorld();
  Object.assign(S, { wave: -1, queue: [], spawnT: 0, interT: RULES.firstDelay, time: 0, kills: 0, heads: 0, shots: 0, hits: 0, flowT: 0, alive: 0, money: 0, earned: 0 });
  P.pos.set(MAP.playerStart.x, 0, MAP.playerStart.z); P.vel.set(0, 0, 0);
  Object.assign(P, { yaw: 0, pitch: 0, hp: PL.hp, eye: PL.eye, lastHurt: -99, grenades: PL.grenades, ads: false, bloom: 0, kick: 0 });
  weapons.resetWeapons(); input.firing = false; keys.clear();
  camera.fov = 75; camera.updateProjectionMatrix();
  hud.reset();
  setMode('playing'); lock();
  hud.banner('THE LAST BLOCK', 'HOLD THE CIVIC CENTER', 4); hud.radio(STORY.intro, 6.5);
}

function endGame(win) {
  setMode(win ? 'won' : 'dead'); input.firing = false;
  if (document.pointerLockElement) document.exitPointerLock();
  $('end').className = 'screen ' + (win ? 'win' : 'lose');
  $('endKicker').textContent = win ? 'MISSION COMPLETE' : `FELL ON WAVE ${S.wave + 1}`;
  $('endTitle').textContent = win ? 'THE BLOCK HOLDS' : 'LINE BROKEN';
  $('endText').textContent = win ? STORY.win : 'You went down, but the resistance does not stop. Regroup and take the line back.';
  $('stKills').textContent = S.kills; $('stHead').textContent = S.heads;
  $('stAcc').textContent = (S.shots ? Math.round(S.hits / S.shots * 100) : 0) + '%';
  $('stTime').textContent = Math.floor(S.time / 60) + ':' + String(Math.floor(S.time % 60)).padStart(2, '0');
}

function update(dt) {
  S.time += dt;
  updatePlayer(dt);
  if ((S.flowT -= dt) <= 0) { S.flowT = 0.35; flowField(grid, cellIx(P.pos.x), cellIx(P.pos.z), flow); }
  weapons.updateWeapons(dt, input);
  weapons.updateGrenades(dt);
  S.alive = enemiesSys.updateEnemies(dt);
  if (S.mode !== 'playing') return;
  updatePickups(dt); updateWaves(dt);
  hud.update(dt, { S, P, W: weapons.getW(), enemies, pickups, MAP });
}

let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (S.mode === 'playing') update(dt);
  else if (S.mode === 'menu') { const t = now / 1000 * 0.06; camera.position.set(Math.sin(t) * 95, 38, 20 + Math.cos(t) * 95); camera.lookAt(0, 14, -10); }
  if (S.mode !== 'paused') fx.updateFx(dt);
  updateSmoke(now / 1000);
  updateSun(S.mode === 'playing' ? P.pos.x : 0, S.mode === 'playing' ? P.pos.z : 20);
  sky.position.copy(camera.position);
  renderer.render(scene, camera);
}

// ============================================================ Input
addEventListener('keydown', (e) => {
  if (S.mode === 'shop') { if (!e.repeat && (e.code === 'KeyB' || e.code === 'Escape')) { e.preventDefault(); shop.closeShop(); } return; }
  if (S.mode !== 'playing') return;
  if (e.ctrlKey || ['Space', 'Tab', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
  if (e.repeat) return;
  if (e.code === 'Escape' && !document.pointerLockElement) { setMode('paused'); input.firing = false; keys.clear(); return; }
  keys.add(e.code);
  if (e.code === 'KeyR') weapons.startReload();
  else if (/^Digit[1-9]$/.test(e.code)) {
    const W = weapons.getW(), w = W[+e.code.slice(5) - 1];
    if (w) { if (w.owned) weapons.switchWeapon(W.indexOf(w)); else hud.tip('BUY THE ' + w.def.name.toUpperCase() + ' IN THE ARMORY — B'); }
  }
  else if (e.code === 'KeyB') shop.openShop();
  else if (e.code === 'KeyG') weapons.throwGrenade();
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => { keys.clear(); input.firing = false; });
addEventListener('mousemove', (e) => {
  if (S.mode !== 'playing') return;
  const ex = e.clientX / innerWidth; input.edgeTurn = document.pointerLockElement ? 0 : ex < 0.12 ? -(1 - ex / 0.12) : ex > 0.88 ? (ex - 0.88) / 0.12 : 0;
  const s = 0.0022 * CFG.sens * Math.min(1, camera.fov / 75) * (P.ads ? 0.85 : 1);
  P.yaw -= e.movementX * s; P.pitch = Math.max(-1.5, Math.min(1.5, P.pitch - e.movementY * s));
});
addEventListener('mousedown', (e) => {
  if (S.mode !== 'playing') return;
  if (!NOLOCK && document.pointerLockElement !== renderer.domElement) lock();
  if (e.button === 0) { input.firing = true; input.fireLatch = false; input.fireQueued = true; } else if (e.button === 2) P.ads = true;
});
addEventListener('mouseup', (e) => { if (e.button === 0) input.firing = false; else if (e.button === 2) P.ads = false; });
addEventListener('contextmenu', (e) => e.preventDefault());
let wheelT = 0;
addEventListener('wheel', () => {
  const t = performance.now(), W = weapons.getW();
  if (S.mode === 'playing' && t - wheelT > 300) { wheelT = t; let i = P.wi; do { i = (i + 1) % W.length; } while (!W[i].owned); weapons.switchWeapon(i); }
}, { passive: true });
document.addEventListener('pointerlockerror', () => { if (!lockFailed) { lockFailed = true; hud.tip('MOUSE LOCK UNAVAILABLE — TRY CHROME'); } });
document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement) lockFailed = false;
  const locked = document.pointerLockElement === renderer.domElement;
  if (!locked && S.mode === 'playing' && !NOLOCK) { setMode('paused'); input.firing = false; keys.clear(); }
  else if (locked && S.mode === 'paused') { setMode('playing'); last = performance.now(); }
});
document.addEventListener('visibilitychange', () => { if (document.hidden && S.mode === 'playing' && !NOLOCK) { if (document.pointerLockElement) document.exitPointerLock(); else setMode('paused'); } });
$('btnStart').addEventListener('click', startGame);
$('btnRestart').addEventListener('click', startGame);
$('btnMenu').addEventListener('click', toMenu);
$('btnEndMenu').addEventListener('click', toMenu);
$('btnResume').addEventListener('click', () => { if (NOLOCK || lockFailed) { setMode('playing'); last = performance.now(); } else lock(); });
bindSettingsUI();

setMode('menu');
requestAnimationFrame(frame);

// Test/debug hook: step() advances the simulation manually when the tab is in the background (rAF throttled)
window.__game = {
  CFG, assetsReady, FP, ARMS, poseFpArms: weapons.poseFpArms, fpArms: weapons.fpArms,
  SOLDIER, placeHandGun: enemiesSys.placeHandGun, soldierReady: enemiesSys.soldierReady,
  VIEW, loadViewModels: weapons.loadViewModels, gun: weapons.gun, S, P, W: weapons.getW,
  enemies, pickups, MAP, startGame, spawnEnemy: enemiesSys.spawnEnemy, damageEnemy: enemiesSys.damageEnemy,
  fire: weapons.fire, throwGrenade: weapons.throwGrenade, keys, openShop: shop.openShop,
  closeShop: shop.closeShop, buy: shop.buy, toMenu, switchWeapon: weapons.switchWeapon, setMode,
  setFiring: (v) => { input.firing = v; input.fireLatch = false; },
  step(n = 1, dt = 1 / 60) { for (let i = 0; i < n && S.mode === 'playing'; i++) { update(dt); fx.updateFx(dt); } sky.position.copy(camera.position); renderer.render(scene, camera); },
};
