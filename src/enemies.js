// Enemy spawning, rigged soldier animation, AI movement/shooting, and resource disposal.
import * as THREE from '../vendor/three.module.min.js';
import { GLTFLoader } from '../vendor/loaders/GLTFLoader.js';
import { clone as skeletonClone } from '../vendor/utils/SkeletonUtils.js';
import { raycastWorld, resolveCircle, flowTarget, lerpAngle } from './core.js';
import { ENEMY_TYPES, RULES } from './config.js';
import { sfx } from './audio.js';
import { lam, box, assetUrl } from './world.js';

const rand = Math.random;

export const SOLDIER = {
  file: 'soldier', height: 1.78, clips: { die: 0, run: 1, walk: 2, aim: 3 },
  tint: { rifle: 0xffffff, assault: 0xb4ccff, heavy: 0xd8cfa6 },
  gun: { len: 0.95, grip: [0.19, -0.1, 0], pos: [0, 0.06, 0], rot: { run: [0.244, -0.728, 0.931], aim: [0.633, -0.743, 1.425] } },
};

const _ft = { x: 0, z: 0 };
const _hs = new THREE.Vector3(), _gq = new THREE.Quaternion(), _ge = new THREE.Euler();
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3();

export function createEnemies({ scene, colliders, grid, flow, MAP, S, P, enemies, hitMeshes, fx, hud, protoGuns, onSoldierLoaded, onDamagePlayer, onExplode, onDropPickup }) {
  let soldierProto = null;
  const soldierMats = {};
  const skinMat = lam(0xc49a78), darkMat = lam(0x1f2226), redMat = new THREE.MeshBasicMaterial({ color: 0xd8281e });

  async function loadSoldier() {
    try {
      const gltf = await new GLTFLoader().loadAsync(assetUrl(`assets/models/${SOLDIER.file}.glb`));
      let mesh = null; gltf.scene.traverse((o) => { if (o.isSkinnedMesh && !mesh) mesh = o; });
      mesh.geometry.computeBoundingBox();
      const scale = SOLDIER.height / (mesh.geometry.boundingBox.max.y - mesh.geometry.boundingBox.min.y);
      const clips = {}, speed = {};
      for (const [name, i] of Object.entries(SOLDIER.clips)) {
        const clip = gltf.animations[i]; if (!clip) throw new Error('missing clip ' + name);
        clip.tracks = clip.tracks.filter((t) => !/\.scale$/.test(t.name));
        for (const t of clip.tracks) if (/Hips\.position$/.test(t.name)) {
          const v = t.values, n = v.length;
          speed[name] = Math.hypot(v[n - 3] - v[0], v[n - 1] - v[2]) / clip.duration * scale;
          for (let k = 0; k < n; k += 3) { v[k] = v[0]; v[k + 2] = v[2]; }
        }
        clips[name] = clip;
      }
      soldierProto = { scene: gltf.scene, clips, speed, scale, material: mesh.material };
      if (onSoldierLoaded) {
        try { onSoldierLoaded(soldierProto); }
        catch (err) { console.warn('first-person arms not built, keeping the box arms:', err && err.message); }
      }
    } catch (err) { console.warn('soldier model not loaded, keeping the box figures:', err && err.message); }
  }

  function soldierMat(type) {
    if (!soldierMats[type]) {
      const m = soldierMats[type] = soldierProto.material.clone();
      m.metalness = 0; m.metalnessMap = null; m.roughness = 0.85;
      m.color.setHex(SOLDIER.tint[type] ?? 0xffffff);
      m.emissive.setHex(0x505050); m.emissiveMap = m.map;
    }
    return soldierMats[type];
  }

  function placeHandGun(e) {
    const h = e.handGun, c = SOLDIER.gun; if (!h) return;
    h.position.set(...c.pos); h.rotation.set(...(c.rot[e.cur] || c.rot.run));
    h.children[0].position.set(...c.grip);
    e.group.updateMatrixWorld(true); h.scale.setScalar(1); h.parent.getWorldScale(_hs);
    h.scale.setScalar(c.len * e.def.scale / _hs.x);
  }

  function attachHandGun(e) {
    if (!e.body || e.handGun || !protoGuns.m16) return;
    const hand = e.body.getObjectByName('mixamorigRightHand');
    if (!hand) return;
    const holder = new THREE.Group(); holder.add(protoGuns.m16.clone()); hand.add(holder); e.handGun = holder; placeHandGun(e);
  }

  function setAnim(e, name, fade = 0.25) {
    if (e.cur === name) return;
    const next = e.acts[name]; next.reset().play();
    if (e.cur) e.acts[e.cur].crossFadeTo(next, fade, false);
    e.cur = name;
    if (e.handGun && SOLDIER.gun.rot[name]) e.gunQ = _gq.clone().setFromEuler(_ge.set(...SOLDIER.gun.rot[name]));
  }

  function dressSoldier(e) {
    const g = e.group;
    g.traverse((o) => { if (o.isMesh) o.visible = false; });
    const body = skeletonClone(soldierProto.scene); body.scale.setScalar(soldierProto.scale);
    const mat = soldierMat(e.type);
    body.traverse((o) => { if (o.isMesh) { o.material = mat; o.frustumCulled = false; o.castShadow = true; } });
    g.add(body); e.body = body;
    attachHandGun(e);
    e.mixer = new THREE.AnimationMixer(body); e.acts = {};
    for (const k in soldierProto.clips) e.acts[k] = e.mixer.clipAction(soldierProto.clips[k]);
    e.acts.die.setLoop(THREE.LoopOnce); e.acts.die.clampWhenFinished = true;
    e.cur = null; setAnim(e, 'run');
  }

  function disposeEnemy(e) {
    if (e.mixer) { e.mixer.stopAllAction(); if (e.body) e.mixer.uncacheRoot(e.body); e.mixer = null; }
    scene.remove(e.group);
    e.gone = true;
  }

  function hitPart(e, parent, mat, sx, sy, sz, x, y, z, head) {
    const m = box(parent, mat, sx, sy, sz, x, y, z); m.userData.enemy = e; m.userData.head = !!head; e.hit.push(m); return m;
  }

  function spawnEnemy({ type, dir }) {
    const def = ENEMY_TYPES[type], pts = MAP.spawns[dir];
    let pt = pts[Math.floor(rand() * pts.length)];
    for (let i = 0; i < 6 && Math.hypot(pt[0] - P.pos.x, pt[1] - P.pos.z) < 40; i++) pt = pts[Math.floor(rand() * pts.length)];
    const e = { type, def, drone: type === 'drone', group: new THREE.Group(), hit: [], hp: def.hp, alive: true, deadT: 0, gone: false, los: false, losT: rand() * 0.2, aimT: 0, burst: def.burst || 0, shotT: 0, pauseT: 0, strafe: 0, strafeT: 0, phase: rand() * 6, cover: null, coverT: 0, hideT: 0, coverCd: 2 + rand() * 3 };
    const g = e.group; g.rotation.order = 'YXZ';
    if (e.drone) {
      box(g, darkMat, 0.42, 0.12, 0.42, 0, 0, 0); box(g, darkMat, 0.9, 0.03, 0.06, 0, 0.04, 0).rotation.y = Math.PI / 4; box(g, darkMat, 0.9, 0.03, 0.06, 0, 0.04, 0).rotation.y = -Math.PI / 4;
      e.rotors = [[0.32, 0.32], [-0.32, 0.32], [0.32, -0.32], [-0.32, -0.32]].map(([x, z]) => box(g, lam(0x55595f), 0.34, 0.012, 0.04, x, 0.08, z));
      box(g, redMat, 0.08, 0.05, 0.05, 0, -0.05, 0.2);
      hitPart(e, g, darkMat, 1.0, 0.5, 1.0, 0, 0, 0, false).visible = false;
      g.position.set(pt[0], 7, pt[1]);
    } else {
      const u = lam(def.color), helm = lam(new THREE.Color(def.color).multiplyScalar(0.7).getHex());
      hitPart(e, g, u, 0.52, 0.62, 0.3, 0, 1.12, 0); box(g, darkMat, 0.56, 0.38, 0.35, 0, 1.2, 0);
      const headMesh = hitPart(e, g, skinMat, 0.22, 0.24, 0.24, 0, 1.56, 0, true);
      const helmMesh = hitPart(e, g, helm, 0.28, 0.14, 0.3, 0, 1.68, 0, true);
      e.headParts = [headMesh, helmMesh];
      box(g, redMat, 0.07, 0.07, 0.02, 0, 1.68, 0.155);
      const leg = (x) => { const pv = new THREE.Group(); pv.position.set(x, 0.82, 0); g.add(pv); hitPart(e, pv, u, 0.2, 0.82, 0.24, 0, -0.41, 0); return pv; };
      e.legL = leg(-0.14); e.legR = leg(0.14);
      hitPart(e, g, u, 0.15, 0.55, 0.18, -0.34, 1.12, 0.06); hitPart(e, g, u, 0.15, 0.55, 0.18, 0.34, 1.12, 0.06);
      box(g, darkMat, 0.07, 0.1, type === 'heavy' ? 1.0 : 0.75, 0.2, 1.2, 0.42);
      if (type === 'heavy') box(g, darkMat, 0.62, 0.5, 0.2, 0, 1.15, -0.22);
      g.scale.setScalar(def.scale);
      if (soldierProto) dressSoldier(e);
      g.position.set(pt[0] + (rand() - 0.5) * 6, 0, pt[1] + (rand() - 0.5) * 6);
      resolveCircle(g.position, 0.4, 0, 1.7, colliders);
    }
    scene.add(g); g.updateMatrixWorld(true);
    enemies.push(e); hitMeshes.push(...e.hit);
    return e;
  }

  function findCoverSpot(e) {
    const ep = e.group.position, px = P.pos.x, pz = P.pos.z, py = P.pos.y + P.eye - 0.25;
    let best = null, bestD = 15;
    for (let i = 0; i < MAP.props.length; i++) {
      const pr = MAP.props[i];
      if (pr.h < 0.9) continue;
      const d = Math.hypot(pr.x - ep.x, pr.z - ep.z);
      if (d < 1.5 || d > bestD) continue;
      const ax = pr.x - px, az = pr.z - pz, al = Math.hypot(ax, az) || 1;
      const nx = ax / al, nz = az / al;
      const off = (Math.abs(nx) * pr.w + Math.abs(nz) * pr.d) * 0.5 + 0.85;
      const cx = pr.x + nx * off, cz = pr.z + nz * off;
      if (raycastWorld(cx, 1.3, cz, px - cx, py - 1.3, pz - cz, colliders) >= 1) continue; // spot must actually block LOS
      if (raycastWorld(ep.x, 1.0, ep.z, cx - ep.x, 0, cz - ep.z, colliders) < 1) continue; // path to cover must be direct
      bestD = d;
      best = { x: cx, z: cz };
    }
    return best;
  }

  function damageEnemy(e, dmg, head) {
    if (!e.alive) return;
    e.hp -= dmg; e.aimT = Math.max(e.aimT, (e.def.react || 0) * 0.5);
    if (e.hp <= 0) { killEnemy(e, head, false); return; }
    if (!e.drone && e.type !== 'heavy' && e.coverCd <= 0 && !e.cover) {
      const spot = findCoverSpot(e);
      if (spot) { e.cover = spot; e.coverT = 2.6; e.hideT = 1.2 + rand() * 0.8; e.coverCd = 9 + rand() * 4; }
    }
  }

  function killEnemy(e, head, silent) {
    e.alive = false; e.deadT = 0;
    if (e.mixer) { e.acts.die.timeScale = 1.4; setAnim(e, 'die', 0.12); }
    for (const m of e.hit) { const i = hitMeshes.indexOf(m); if (i >= 0) hitMeshes.splice(i, 1); }
    if (e.drone) { if (!silent) onExplode(e.group.position, 0, 0, false); disposeEnemy(e); }
    if (silent) return;
    S.kills++; if (head) S.heads++; sfx.kill();
    const pay = e.def.score + (head ? RULES.headBonus : 0); S.money += pay; S.earned += pay;
    hud.feed((head ? 'HEADSHOT — ' : 'KILLED — ') + e.def.name + '  +$' + pay, head);
    if (!e.drone) {
      const r = rand();
      if (r < RULES.dropAmmo) onDropPickup('ammo', e.group.position.x, e.group.position.z);
      else if (r < RULES.dropAmmo + RULES.dropMed) onDropPickup('med', e.group.position.x, e.group.position.z);
    }
  }

  function enemyShoot(e, dx, dz, dist, chestY) {
    const def = e.def, p = e.group.position, oy = p.y + 1.5 * def.scale;
    const tLos = raycastWorld(p.x, oy, p.z, P.pos.x - p.x, chestY - oy, P.pos.z - p.z, colliders);
    _v.set(p.x + dx * 0.6, 1.3 * def.scale, p.z + dz * 0.6);
    fx.flash(_v, 0xffd080, 0.3, 0.7, 0.06); sfx.enemy(dist);
    if (tLos < 1) {
      e.los = false;
      _v2.set(p.x + (P.pos.x - p.x) * tLos, oy + (chestY - oy) * tLos, p.z + (P.pos.z - p.z) * tLos);
      fx.tracer(_v, _v2, true); fx.flash(_v2, 0xffd9a0, 0.18, 0.45, 0.1);
      return;
    }
    const acc = RULES.enemyAccuracy * def.acc * Math.max(0.25, Math.min(1, 1.15 - dist / def.range)) * (P.crouch ? 0.65 : 1) * (Math.hypot(P.vel.x, P.vel.z) > 6 ? 0.7 : 1);
    if (rand() < acc) { _v2.set(P.pos.x, chestY, P.pos.z); fx.tracer(_v, _v2, true); onDamagePlayer(def.dmg, p.x, p.z); }
    else { _v2.set(P.pos.x + (rand() - 0.5) * 3 + dx * 8, chestY + (rand() - 0.3) * 1.6, P.pos.z + (rand() - 0.5) * 3 + dz * 8); fx.tracer(_v, _v2, true); }
  }

  function updateEnemy(e, dt) {
    const g = e.group, def = e.def, p = g.position;
    if (!e.alive) {
      e.deadT += dt;
      if (e.mixer) e.mixer.update(dt); else g.rotation.x = -Math.min(1, e.deadT / 0.4) * 1.5;
      if (e.deadT > 7) disposeEnemy(e);
      return;
    }
    const px = P.pos.x, pz = P.pos.z, chestY = P.pos.y + P.eye - 0.25;
    let dx = px - p.x, dz = pz - p.z; const dist = Math.hypot(dx, dz) || 1e-3; dx /= dist; dz /= dist;
    if ((e.losT -= dt) <= 0) {
      e.losT = 0.14 + rand() * 0.1;
      const oy = p.y + (e.drone ? 0 : 1.5 * def.scale);
      e.los = raycastWorld(p.x, oy, p.z, px - p.x, chestY - oy, pz - p.z, colliders) >= 1;
    }
    const followFlow = (speed) => {
      flowTarget(grid, flow, p.x, p.z, px, pz, _ft);
      const vx = _ft.x - p.x, vz = _ft.z - p.z, l = Math.hypot(vx, vz) || 1;
      p.x += vx / l * speed * dt; p.z += vz / l * speed * dt; return Math.atan2(vx, vz);
    };
    if (e.drone) {
      const d3 = Math.hypot(px - p.x, chestY - p.y, pz - p.z);
      if (d3 < 1.7) { onExplode(p, 0, 0, false); onDamagePlayer(def.dmg, p.x, p.z); killEnemy(e, false, true); return; }
      if (e.los && dist < def.range) { const k = def.dive * dt / d3; p.x += (px - p.x) * k; p.y += (chestY - p.y) * k; p.z += (pz - p.z) * k; }
      else { followFlow(def.speed); p.y += (7 + Math.sin(e.phase) * 0.5 - p.y) * Math.min(1, 2 * dt); }
      e.phase += dt * 3; resolveCircle(p, 0.5, p.y - 0.3, 0.6, colliders);
      g.rotation.y = Math.atan2(dx, dz); for (const r of e.rotors) r.rotation.y += dt * 40;
      if ((e.shotT -= dt) <= 0) { e.shotT = 0.35; sfx.drone(dist); }
      return;
    }
    if (e.coverCd > 0) e.coverCd -= dt;
    const engage = e.los && dist < def.range;
    let face = g.rotation.y, moved = false, animSpeed = 0, seekingCover = false;
    if (e.cover) {
      const cdx = e.cover.x - p.x, cdz = e.cover.z - p.z, cd = Math.hypot(cdx, cdz);
      if (cd > 0.75 && e.coverT > 0) {
        e.coverT -= dt;
        const sp = def.speed * 1.3;
        p.x += cdx / cd * sp * dt; p.z += cdz / cd * sp * dt;
        e.phase += sp * dt * 2.4; face = Math.atan2(cdx, cdz); moved = true; animSpeed = sp; seekingCover = true;
      } else if (e.hideT > 0 && !e.los) {
        e.hideT -= dt; face = Math.atan2(dx, dz); seekingCover = true;
      } else {
        e.cover = null;
      }
    }
    if (!seekingCover) {
      if (engage) {
        if ((e.strafeT -= dt) <= 0) { e.strafe = Math.floor(rand() * 3) - 1; e.strafeT = 0.8 + rand() * 1.6; }
        let mx = -dz * e.strafe * 0.6, mz = dx * e.strafe * 0.6;
        if (dist > def.pref) { flowTarget(grid, flow, p.x, p.z, px, pz, _ft); const vx = _ft.x - p.x, vz = _ft.z - p.z, l = Math.hypot(vx, vz) || 1; mx += vx / l; mz += vz / l; } else if (dist < def.pref * 0.5) { mx -= dx * 0.6; mz -= dz * 0.6; }
        const ml = Math.hypot(mx, mz);
        if (ml > 0.01) { const sp = def.speed * 0.55; p.x += mx / ml * sp * dt; p.z += mz / ml * sp * dt; e.phase += sp * dt * 2.4; moved = true; animSpeed = sp; }
        face = Math.atan2(dx, dz);
      } else { const sp = def.speed * (def.run || 1); face = followFlow(sp); e.phase += sp * dt * 2.4; moved = true; animSpeed = sp; }
    }
    resolveCircle(p, 0.4, 0, 1.7, colliders);
    g.rotation.y = lerpAngle(g.rotation.y, face, Math.min(1, 10 * dt));
    const sw = moved ? Math.sin(e.phase) * 0.6 : 0; e.legL.rotation.x = sw; e.legR.rotation.x = -sw;
    if (e.headParts) {
      // Shift head/helmet hitboxes slightly forward while the rigged soldier leans into the run clip
      const tz = (e.mixer && !engage && moved) ? 0.16 : 0;
      const k = Math.min(1, 10 * dt);
      for (const hm of e.headParts) hm.position.z += (tz - hm.position.z) * k;
    }
    if (e.mixer) {
      const name = engage ? 'aim' : 'run'; setAnim(e, name);
      const base = (soldierProto.speed[name] || 1) * def.scale;
      e.acts[name].timeScale = engage ? (moved ? Math.min(1.8, Math.max(0.6, animSpeed / base)) : 0.12) : Math.min(2.2, Math.max(0.7, animSpeed / base));
      e.mixer.update(dt);
      if (e.gunQ) e.handGun.quaternion.slerp(e.gunQ, Math.min(1, 10 * dt));
    }
    if (engage) {
      e.aimT += dt;
      if (e.aimT > def.react) {
        if (e.burst > 0) { if ((e.shotT -= dt) <= 0) { enemyShoot(e, dx, dz, dist, chestY); e.shotT = def.rof; if (--e.burst === 0) e.pauseT = def.pause * (0.7 + rand() * 0.6); } }
        else if ((e.pauseT -= dt) <= 0) e.burst = def.burst;
      }
    } else e.aimT = Math.max(0, e.aimT - dt * 2);
  }

  function updateEnemies(dt) {
    let alive = 0;
    for (let i = enemies.length - 1; i >= 0; i--) {
      const e = enemies[i]; updateEnemy(e, dt);
      if (e.gone) enemies.splice(i, 1); else if (e.alive) alive++;
    }
    for (let i = 0; i < enemies.length; i++) {
      const a = enemies[i]; if (!a.alive || a.drone) continue;
      for (let j = i + 1; j < enemies.length; j++) {
        const b = enemies[j]; if (!b.alive || b.drone) continue;
        const dx = b.group.position.x - a.group.position.x, dz = b.group.position.z - a.group.position.z, d = Math.hypot(dx, dz);
        if (d < 0.9 && d > 1e-4) {
          const k = (0.9 - d) / d * 0.5;
          a.group.position.x -= dx * k; a.group.position.z -= dz * k;
          b.group.position.x += dx * k; b.group.position.z += dz * k;
        }
      }
    }
    return alive;
  }

  function clearEnemies() {
    for (const e of enemies) disposeEnemy(e);
    enemies.length = 0;
    hitMeshes.length = 0;
  }

  return { loadSoldier, soldierReady: () => !!soldierProto, attachHandGun, placeHandGun, spawnEnemy, damageEnemy, killEnemy, updateEnemies, clearEnemies };
}
