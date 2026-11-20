// First-person weapons, GLB view models, cut-out soldier arms, shooting, and grenades.
import * as THREE from '../vendor/three.module.min.js';
import { GLTFLoader } from '../vendor/loaders/GLTFLoader.js';
import { clone as skeletonClone } from '../vendor/utils/SkeletonUtils.js';
import { raycastWorld } from './core.js';
import { WEAPONS, GRENADE } from './config.js';
import { sfx } from './audio.js';
import { lam, box, glowTex, assetUrl } from './world.js';

const rand = Math.random;

// GLB view models (assets/models). Every file is 1 unit long along its X axis.
//   len    real length in metres          muzzle  which way the barrel points along X (+1 or -1)
//   axis   height of the barrel axis as a fraction of the model's height (it is placed on the gun group's y = 0)
//   rear   z of the back end of the gun in the gun group (positive is toward the camera)
//   hip    optional gun position when not aiming (default 0.2, -0.19, -0.42); pistols sit higher and closer
//   adsZ   optional distance from the eye when aiming (default -0.3); pistols are held farther out so the hands do not fill the view
export const VIEW = {
  m16:    { file: 'M16',         len: 1.00, muzzle:  1, axis: 0.70, rear: 0.40 },
  m9:     { file: 'Beretta92',   len: 0.22, muzzle:  1, axis: 0.86, rear: 0.02, hip: [0.16, -0.115, -0.36], adsZ: -0.5 },
  m24:    { file: 'M24',         len: 1.10, muzzle: -1, axis: 0.42, rear: 0.42 },
  deagle: { file: 'DesertEagle', len: 0.27, muzzle: -1, axis: 0.84, rear: 0.03, hip: [0.16, -0.115, -0.36], adsZ: -0.5 },
};
const HIP_DEFAULT = [0.2, -0.19, -0.42];
const GUN_SFX = { m16: 'rifle', m9: 'pistol', m24: 'sniper', deagle: 'magnum' };

// Untextured models are coloured by region with vertex colours.
const PAINT = {
  m9:     (u, y) => (u < -0.1 && y < 0.36 ? 0x4a3322 : u > 0.4 ? 0x5c6066 : 0x2e3136),
  deagle: (u, y) => (u < -0.1 && y < 0.33 ? 0x1b1b1d : 0x9da0a4),
  m24:    (u, y) => (y > 0.148 ? 0x1c1d20 : u > 0.36 ? 0x202124 : (y < 0.105 || u < -0.18) ? 0x55603c : 0x2c2e32),
};

// First-person arms: per hand, in gun-group space (x right, y up, -z toward the muzzle)
export const ARMS = {
  m16: {
    r: { at: [0.016, -0.09, 0.085],   fingers: [0, -0.35, -1],   palm: [-1, 0, 0], elbow: [0.14, -0.3, 0.5],   shape: 'grip' },
    l: { at: [-0.016, -0.085, -0.235], fingers: [0, -0.3, -1],    palm: [1, 0, 0],  elbow: [-0.36, -0.3, 0.3],  shape: 'foregrip' },
  },
  m24: {
    r: { at: [0.016, -0.08, 0.07],    fingers: [0, -0.35, -1],   palm: [-1, 0, 0], elbow: [0.14, -0.3, 0.5],   shape: 'grip' },
    l: { at: [0, -0.05, -0.2],        fingers: [0.55, 0, -0.83], palm: [0, 1, 0],  elbow: [-0.4, -0.3, 0.35],  shape: 'hold' },
  },
  m9: {
    r: { at: [0.014, -0.075, -0.005], fingers: [0, -0.25, -1],   palm: [-1, 0, 0], elbow: [0.1, -0.2, 0.45], elbowAim: [0.2, -0.42, 0.3],   shape: 'grip' },
    l: { at: [-0.02, -0.09, -0.02],   fingers: [0.12, -0.45, -1], palm: [1, 0, 0.2], elbow: [-0.28, -0.26, 0.4], elbowAim: [-0.24, -0.44, 0.28], shape: 'support' },
  },
  deagle: {
    r: { at: [0.016, -0.08, -0.005],  fingers: [0, -0.25, -1],   palm: [-1, 0, 0], elbow: [0.1, -0.2, 0.45], elbowAim: [0.2, -0.42, 0.3],   shape: 'grip' },
    l: { at: [-0.022, -0.095, -0.02], fingers: [0.12, -0.45, -1], palm: [1, 0, 0.2], elbow: [-0.28, -0.26, 0.4], elbowAim: [-0.24, -0.44, 0.28], shape: 'support' },
  },
};

export const FP = {
  wristBack: 0.085,
  palmDepth: 0.022,
  grips: {
    grip:     { rest: [1.25, 1.2, 0.6], Index: [0.25, 0.35, 0.2], thumb: [0.9, 0.35] },
    support:  { rest: [1.2, 1.15, 0.6], thumb: [0.8, 0.3] },
    foregrip: { rest: [1.25, 1.2, 0.6], thumb: [0.9, 0.35] },
    hold:     { rest: [0.9, 1.05, 0.55], thumb: [0.4, 0.25] },
  },
  shoulder: { r: [0.05, -0.1, 0.6], l: [-0.42, -0.1, 0.6] },
};

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _dir = new THREE.Vector3(), _right = new THREE.Vector3(), _up = new THREE.Vector3();
const _fa = new THREE.Vector3(), _fb = new THREE.Vector3(), _fc = new THREE.Vector3(), _fd = new THREE.Vector3(), _fq = new THREE.Quaternion();
const _fm = new THREE.Matrix4(), _fx = new THREE.Vector3(), _fn = new THREE.Vector3(), _fq2 = new THREE.Quaternion(), _fw = new THREE.Vector3();

function basisQuat(y, z, out) {
  _fn.copy(z).addScaledVector(y, -z.dot(y));
  if (_fn.lengthSq() < 1e-6) _fn.set(1, 0, 0).addScaledVector(y, -y.x);
  _fn.normalize(); _fx.crossVectors(y, _fn);
  return out.setFromRotationMatrix(_fm.makeBasis(_fx, y, _fn));
}

function paintGeometry(geo, fn, muzzle) {
  const pos = geo.attributes.position, col = new Float32Array(pos.count * 3), c = new THREE.Color();
  geo.computeBoundingBox(); const y0 = geo.boundingBox.min.y;
  for (let i = 0; i < pos.count; i++) {
    c.setHex(fn(pos.getX(i) * muzzle, pos.getY(i) - y0));
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
}

export function createWeapons({ scene, camera, colliders, S, P, enemies, hitMeshes, fx, hud, onDamageEnemy, onDamagePlayer, onM16Loaded }) {
  let W = [];
  let fpArms = null, soldierScale = 1, flashT = 0;
  const protoGuns = {};
  const grenades = [];
  const ray = new THREE.Raycaster();

  // Placeholder view models
  const gun = new THREE.Group(); camera.add(gun);
  const gunMat = lam(0x2e3238), gunMat2 = lam(0x474c40);
  const rifleModel = new THREE.Group(), pistolModel = new THREE.Group(), sniperModel = new THREE.Group(), magnumModel = new THREE.Group();
  box(rifleModel, gunMat, 0.055, 0.075, 0.52, 0, 0, -0.1); box(rifleModel, gunMat, 0.028, 0.028, 0.3, 0, 0.008, -0.5);
  box(rifleModel, gunMat2, 0.05, 0.16, 0.07, 0, -0.1, -0.02); box(rifleModel, gunMat, 0.02, 0.05, 0.14, 0, 0.065, -0.06);
  box(rifleModel, gunMat2, 0.06, 0.06, 0.2, 0, -0.005, -0.3);
  box(pistolModel, gunMat, 0.04, 0.055, 0.22, 0, 0, -0.1); box(pistolModel, gunMat2, 0.038, 0.13, 0.055, 0, -0.08, -0.02);
  rifleModel.position.z = -0.22; pistolModel.position.z = -0.14;
  box(sniperModel, gunMat2, 0.05, 0.07, 0.7, 0, 0, -0.15); box(sniperModel, gunMat, 0.024, 0.024, 0.5, 0, 0.01, -0.72);
  box(sniperModel, gunMat, 0.046, 0.046, 0.26, 0, 0.078, -0.12); box(sniperModel, gunMat2, 0.045, 0.14, 0.06, 0, -0.09, 0.02);
  sniperModel.position.z = -0.22;
  box(magnumModel, gunMat, 0.04, 0.06, 0.25, 0, 0.005, -0.12); box(magnumModel, gunMat2, 0.038, 0.13, 0.055, 0, -0.085, 0.0); magnumModel.position.z = -0.14;

  const gunModels = { m16: rifleModel, m9: pistolModel, m24: sniperModel, deagle: magnumModel };
  const MUZZLE_Z = { m16: -0.9, m9: -0.37, m24: -1.2, deagle: -0.42 };
  const ADS_Y = { m16: -0.105 };
  gun.add(rifleModel, pistolModel, sniperModel, magnumModel);

  const gunSteel = new THREE.MeshStandardMaterial({ color: 0x4b5058, roughness: 0.42, metalness: 0.55 });
  const paintMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.48, metalness: 0.35 });

  async function loadViewModels() {
    const loader = new GLTFLoader(), box3 = new THREE.Box3(), c = new THREE.Vector3();
    await Promise.all(Object.entries(VIEW).map(async ([id, v]) => {
      try {
        const model = (await loader.loadAsync(assetUrl(`assets/models/${v.file}.glb`))).scene;
        model.traverse((o) => {
          if (!o.isMesh) return;
          o.frustumCulled = false;
          if (o.material && o.material.map) { o.material.metalness = Math.min(0.45, o.material.metalness || 0.35); o.material.metalnessMap = null; o.material.roughness = Math.max(0.42, o.material.roughness); }
          else if (PAINT[id]) { paintGeometry(o.geometry, PAINT[id], v.muzzle); o.material = paintMat; }
          else o.material = gunSteel;
        });
        protoGuns[id] = model.clone();
        if (id === 'm16' && onM16Loaded) onM16Loaded();
        const inner = new THREE.Group(); inner.add(model); inner.rotation.y = v.muzzle * Math.PI / 2; inner.scale.setScalar(v.len);
        inner.updateMatrixWorld(true); box3.setFromObject(inner); box3.getCenter(c);
        const h = box3.max.y - box3.min.y;
        inner.position.set(-c.x, -(box3.min.y + h * v.axis), v.rear - box3.max.z);
        const holder = gunModels[id]; holder.clear(); holder.position.set(0, 0, 0); holder.add(inner);
        MUZZLE_Z[id] = box3.min.z + inner.position.z;
        ADS_Y[id] = -(box3.max.y + inner.position.y) - 0.004;
      } catch (err) { console.warn('view model not loaded, keeping the placeholder:', v.file, err && err.message); }
    }));
  }

  // Fallback box arms
  const sleeveMat = new THREE.MeshLambertMaterial({ color: 0x5c6f47, emissive: 0x1c2415 });
  const gloveMat = new THREE.MeshLambertMaterial({ color: 0x3b3f37, emissive: 0x121310 });
  const armRigs = {};
  function buildArm(parent, hand, elbow) {
    const g = new THREE.Group(), e = new THREE.Vector3(...elbow);
    g.position.set(...hand); g.lookAt(e);
    const L = g.position.distanceTo(e);
    box(g, gloveMat, 0.07, 0.078, 0.11, 0, 0, 0.03);
    box(g, sleeveMat, 0.084, 0.084, L - 0.085, 0, 0, 0.085 + (L - 0.085) / 2);
    box(g, gloveMat, 0.09, 0.09, 0.025, 0, 0, 0.092);
    parent.add(g);
  }
  for (const id in ARMS) {
    const rig = armRigs[id] = new THREE.Group();
    buildArm(rig, ARMS[id].r.at, ARMS[id].r.elbow);
    buildArm(rig, ARMS[id].l.at, ARMS[id].l.elbow);
    rig.visible = false; gun.add(rig);
  }

  const muzzle = new THREE.Object3D(); gun.add(muzzle);
  const muzzleFlash = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xffc36a, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }));
  muzzleFlash.scale.setScalar(0.32); muzzleFlash.visible = false; muzzle.add(muzzleFlash);
  const muzzleLight = new THREE.PointLight(0xffb060, 0, 22); camera.add(muzzleLight);

  function buildFpArms(soldierProto) {
    soldierScale = soldierProto.scale;
    const src = skeletonClone(soldierProto.scene); let mesh = null; src.traverse((o) => { if (o.isSkinnedMesh) mesh = o; });
    const keep = mesh.skeleton.bones.map((b) => /(Left|Right)(Arm|ForeArm|Hand)/.test(b.name));
    const geo = mesh.geometry.clone(), si = geo.attributes.skinIndex, sw = geo.attributes.skinWeight, inside = new Uint8Array(si.count);
    if (!geo.index) throw new Error('soldier mesh is not indexed');
    for (let i = 0; i < si.count; i++) {
      const b = [si.getX(i), si.getY(i), si.getZ(i), si.getW(i)], w = [sw.getX(i), sw.getY(i), sw.getZ(i), sw.getW(i)];
      let k = 0; for (let j = 0; j < 4; j++) if (keep[b[j]]) k += w[j];
      if (k <= 0.5) continue;
      inside[i] = 1;
      sw.setXYZW(i, ...w.map((v, j) => (keep[b[j]] ? v / k : 0)));
    }
    const idx = geo.index.array, out = [];
    for (let t = 0; t < idx.length; t += 3) if (inside[idx[t]] && inside[idx[t + 1]] && inside[idx[t + 2]]) out.push(idx[t], idx[t + 1], idx[t + 2]);
    geo.setIndex(out);
    const mat = soldierProto.material.clone(); mat.metalness = 0; mat.metalnessMap = null; mat.roughness = 0.85; mat.emissive.setHex(0x3a3a3a); mat.emissiveMap = mat.map;
    mesh.geometry = geo; mesh.material = mat; mesh.frustumCulled = false;

    src.updateMatrixWorld(true);
    const down = new THREE.Vector3(0, -1, 0), wp = (o) => o.getWorldPosition(new THREE.Vector3());
    const toLocal = (bone, v) => v.clone().applyQuaternion(bone.getWorldQuaternion(new THREE.Quaternion()).invert()).normalize();
    const rig = new THREE.Group(), sides = {};
    for (const [key, name] of [['r', 'Right'], ['l', 'Left']]) {
      const get = (n) => src.getObjectByName(`mixamorig${name}${n}`);
      const arm = get('Arm'), fore = get('ForeArm'), hand = get('Hand');
      const fingersW = wp(get('HandMiddle1')).sub(wp(hand)).normalize();
      const side = sides[key] = {
        arm, fore, hand, vF: fore.position.clone(), vH: hand.position.clone(), fingers: [],
        handLocal: basisQuat(toLocal(hand, fingersW), toLocal(hand, down), new THREE.Quaternion()).invert(),
        foreLocal: basisQuat(fore.position.clone().set(0, 0, 0).copy(hand.position).normalize(), toLocal(fore, down), new THREE.Quaternion()).invert(),
      };
      hand.traverse((o) => {
        const m = /Hand(Index|Middle|Ring|Pinky|Thumb)([123])$/.exec(o.name); if (!m) return;
        const dir = wp(o.children[0] || o).sub(wp(o)).normalize(), f = { b: o, q0: o.quaternion.clone(), finger: m[1], joint: +m[2] - 1 };
        f.bend = toLocal(o, new THREE.Vector3().crossVectors(dir, down));
        if (m[1] === 'Thumb' && m[2] === '1') {
          const sign = Math.sign(new THREE.Vector3().crossVectors(fingersW, dir).dot(down)) || 1;
          f.swing = toLocal(o, fingersW.clone().multiplyScalar(sign));
        }
        side.fingers.push(f);
      });
      rig.add(arm); rig.add(fore);
    }
    rig.add(mesh); rig.visible = false; gun.add(rig);
    fpArms = { rig, sides, mesh };
  }

  function poseFpArms(id, aim = 0) {
    const cfg = ARMS[id]; if (!fpArms || !cfg) return;
    const sc = soldierScale;
    for (const key of ['r', 'l']) {
      const s = fpArms.sides[key], c = cfg[key], G = FP.grips[c.shape] || FP.grips.grip;
      _fa.set(...c.fingers).normalize();
      _fb.set(...c.palm); _fb.addScaledVector(_fa, -_fb.dot(_fa)).normalize();
      basisQuat(_fa, _fb, _fq2).multiply(s.handLocal);
      _fw.set(...c.at).addScaledVector(_fb, -FP.palmDepth).addScaledVector(_fa, -FP.wristBack);
      _fd.set(...c.elbow); if (c.elbowAim) _fd.lerp(_fx.set(...c.elbowAim), aim);
      _fc.copy(_fw).sub(_fd).normalize();
      _fd.copy(_fw).addScaledVector(_fc, -s.vH.length() * sc);
      basisQuat(_fc, _fb, s.fore.quaternion).multiply(s.foreLocal);
      s.fore.position.copy(_fd); s.fore.scale.setScalar(sc);
      s.hand.quaternion.copy(s.fore.quaternion).invert().multiply(_fq2);
      _fa.copy(_fd).sub(_fx.set(...FP.shoulder[key])).normalize();
      s.arm.quaternion.setFromUnitVectors(_fx.copy(s.vF).normalize(), _fa);
      s.arm.position.copy(_fd).sub(_fx.copy(s.vF).multiplyScalar(sc).applyQuaternion(s.arm.quaternion)); s.arm.scale.setScalar(sc);
      for (const f of s.fingers) {
        f.b.quaternion.copy(f.q0);
        if (f.finger === 'Thumb') {
          if (f.swing) f.b.quaternion.multiply(_fq.setFromAxisAngle(f.swing, G.thumb[0]));
          else f.b.quaternion.multiply(_fq.setFromAxisAngle(f.bend, G.thumb[1]));
        } else f.b.quaternion.multiply(_fq.setFromAxisAngle(f.bend, (G[f.finger] || G.rest)[f.joint]));
      }
    }
  }

  function resetWeapons() { W = WEAPONS.map((def) => ({ def, mag: def.mag, reserve: def.reserve, cool: 0, reloadT: 0, owned: !def.price })); P.wi = 0; }
  function switchWeapon(i) { if (i === P.wi || !W[i] || !W[i].owned) return; W[P.wi].reloadT = 0; P.wi = i; W[i].cool = 0.25; P.kick = 0.5; }
  function startReload() {
    const w = W[P.wi];
    if (w.reloadT > 0 || w.mag >= w.def.mag || w.reserve <= 0) return;
    w.reloadT = w.def.reload; sfx.reload();
  }

  function fire() {
    const w = W[P.wi], def = w.def;
    if (w.cool > 0 || w.reloadT > 0) return false;
    if (w.mag <= 0) { sfx.empty(); w.cool = 0.2; if (w.reserve > 0) startReload(); else hud.tip('OUT OF AMMO — PRESS 2 FOR PISTOL'); return true; }
    w.mag--; w.cool = def.interval; S.shots++;
    camera.getWorldDirection(_dir);
    _right.setFromMatrixColumn(camera.matrixWorld, 0); _up.setFromMatrixColumn(camera.matrixWorld, 1);
    const moving = Math.hypot(P.vel.x, P.vel.z) > 1.5;
    const sp = def.spread * (P.ads ? (def.adsSpread ?? 0.3) : 1) * (moving ? 1.7 : 1) * (P.crouch ? 0.7 : 1) * (1 + P.bloom * 2.2) * (P.onGround ? 1 : 2.5);
    const a = rand() * Math.PI * 2, r = Math.sqrt(rand()) * sp;
    _dir.addScaledVector(_right, Math.cos(a) * r).addScaledVector(_up, Math.sin(a) * r).normalize();
    const o = camera.position;
    let dist = raycastWorld(o.x, o.y, o.z, _dir.x * def.range, _dir.y * def.range, _dir.z * def.range, colliders) * def.range;
    if (_dir.y < -0.001) dist = Math.min(dist, -o.y / _dir.y);
    ray.set(o, _dir); ray.far = dist;
    const hit = ray.intersectObjects(hitMeshes, false)[0];
    if (hit) {
      dist = hit.distance; const e = hit.object.userData.enemy, head = hit.object.userData.head;
      S.hits++; hud.hitMarker(head);
      onDamageEnemy(e, def.dmg * (head ? def.head : 1), head);
      fx.flash(hit.point, 0xff5a3a, 0.25, 0.6, 0.12);
    } else if (dist < def.range) { _v.copy(o).addScaledVector(_dir, dist - 0.05); fx.flash(_v, 0xffd9a0, 0.2, 0.55, 0.1); }
    muzzle.getWorldPosition(_v2); _v.copy(o).addScaledVector(_dir, dist); fx.tracer(_v2, _v, false);
    P.pitch = Math.min(1.5, P.pitch + def.recoil * (0.7 + rand() * 0.6) * (P.ads ? 0.7 : 1)); P.yaw += (rand() - 0.5) * def.recoil * 0.7;
    P.bloom = Math.min(1, P.bloom + 0.22); P.kick = 1; flashT = 0.045;
    sfx[GUN_SFX[def.id] || 'pistol']();
    return true;
  }

  function updateWeapons(dt, input) {
    const w = W[P.wi];
    w.cool -= dt; P.bloom = Math.max(0, P.bloom - dt * 2.4); P.kick = Math.max(0, P.kick - dt * 9);
    if (w.reloadT > 0 && (w.reloadT -= dt) <= 0) { const n = Math.min(w.def.mag - w.mag, w.reserve); w.mag += n; w.reserve -= n; w.reloadT = 0; }
    if (w.reloadT > 0) input.fireQueued = false;
    else if ((input.firing || input.fireQueued) && (w.def.auto || !input.fireLatch || input.fireQueued) && fire()) { input.fireLatch = true; input.fireQueued = false; }

    const hip = (VIEW[w.def.id] && VIEW[w.def.id].hip) || HIP_DEFAULT;
    const scoped = !!w.def.scope && P.ads && w.reloadT <= 0 && camera.fov < 30;
    for (const id in gunModels) { const on = id === w.def.id && !scoped; gunModels[id].visible = on; if (armRigs[id]) armRigs[id].visible = on && !fpArms; }
    if (fpArms) { fpArms.rig.visible = !scoped; poseFpArms(w.def.id, Math.min(1, Math.max(0, 1 - gun.position.x / hip[0]))); }
    hud.setScope(scoped);
    const hs = Math.hypot(P.vel.x, P.vel.z), ads = P.ads && w.reloadT <= 0;
    const tx = ads ? 0 : hip[0], ty = ads ? (ADS_Y[w.def.id] ?? -0.06) : hip[1], tz = ads ? ((VIEW[w.def.id] && VIEW[w.def.id].adsZ) || -0.3) : hip[2], k = Math.min(1, 16 * dt);
    gun.position.x += (tx - gun.position.x) * k; gun.position.y += (ty - gun.position.y) * k; gun.position.z += (tz - gun.position.z) * k;
    const bobK = ads ? 0.15 : 1, rl = w.reloadT > 0 ? Math.sin(Math.min(1, (w.def.reload - w.reloadT) / w.def.reload) * Math.PI) : 0;
    gun.position.x += Math.cos(P.bob) * 0.0012 * hs * bobK; gun.position.y += Math.abs(Math.sin(P.bob)) * 0.0012 * hs * bobK;
    gun.rotation.set(P.kick * 0.05 - rl * 0.7, rl * 0.35, rl * 0.25);
    gun.translateZ(P.kick * 0.035);
    muzzle.position.set(0, 0.008, MUZZLE_Z[w.def.id] ?? -0.4);
    flashT -= dt; muzzleFlash.visible = flashT > 0; muzzleLight.intensity = flashT > 0 ? 40 : 0;
    if (muzzleFlash.visible) muzzleFlash.material.rotation = rand() * 6;
  }

  // Grenades
  const grenGeo = new THREE.SphereGeometry(0.09, 8, 6);
  const grenMat = lam(0x39422e);
  function throwGrenade() {
    if (P.grenades <= 0) { hud.tip('NO GRENADES'); return; }
    P.grenades--;
    camera.getWorldDirection(_dir);
    const m = new THREE.Mesh(grenGeo, grenMat);
    const o = camera.position, clear = raycastWorld(o.x, o.y, o.z, _dir.x * 0.7, _dir.y * 0.7, _dir.z * 0.7, colliders) >= 1;
    m.position.copy(o); if (clear) m.position.addScaledVector(_dir, 0.5); scene.add(m);
    grenades.push({ m, v: _dir.clone().multiplyScalar(GRENADE.throwSpeed).add(_v.set(P.vel.x, 4.5, P.vel.z)), t: GRENADE.fuse });
  }

  function updateGrenades(dt) {
    for (let i = grenades.length - 1; i >= 0; i--) {
      const g = grenades[i], p = g.m.position;
      g.v.y -= 20 * dt;
      // Axis-separated AABB bounce so grazing wall hits ricochet naturally instead of reversing all axes
      const dx = g.v.x * dt, dy = g.v.y * dt, dz = g.v.z * dt;
      if (raycastWorld(p.x, p.y, p.z, dx, 0, 0, colliders) < 1) g.v.x *= -0.45; else p.x += dx;
      if (raycastWorld(p.x, p.y, p.z, 0, 0, dz, colliders) < 1) g.v.z *= -0.45; else p.z += dz;
      if (raycastWorld(p.x, p.y, p.z, 0, dy, 0, colliders) < 1) { g.v.y *= -0.35; g.v.x *= 0.7; g.v.z *= 0.7; } else p.y += dy;
      if (p.y < 0.1) { p.y = 0.1; g.v.y *= -0.35; g.v.x *= 0.6; g.v.z *= 0.6; }
      if ((g.t -= dt) <= 0) { explode(p, GRENADE.radius, GRENADE.dmg, true); scene.remove(g.m); grenades.splice(i, 1); }
    }
  }

  function blastClear(pos, x, y, z) { const oy = pos.y + 0.4; return raycastWorld(pos.x, oy, pos.z, x - pos.x, y - oy, z - pos.z, colliders) >= 1; }
  function explode(pos, radius, dmg, byPlayer) {
    const d0 = pos.distanceTo(camera.position);
    sfx.boom(d0);
    fx.flash(pos, 0xffb040, 1.5, radius * 1.6 + 3, 0.4); fx.flash(_v.copy(pos).setY(pos.y + 0.6), 0xff5a20, 1, radius + 2, 0.55);
    for (let i = 0; i < 5; i++) fx.flash(_v.set(pos.x + (rand() - 0.5) * 3, pos.y + rand() * 2, pos.z + (rand() - 0.5) * 3), 0x664433, 1.2, 4 + rand() * 3, 0.7 + rand() * 0.5);
    if (radius <= 0) return;
    if (byPlayer) for (const e of enemies) {
      if (!e.alive) continue;
      const d = Math.hypot(e.group.position.x - pos.x, e.group.position.z - pos.z, e.group.position.y + (e.drone ? 0 : 1) - pos.y);
      if (d < radius && blastClear(pos, e.group.position.x, e.group.position.y + (e.drone ? 0 : 1.1), e.group.position.z)) onDamageEnemy(e, dmg * (1 - d / radius) + 15, false);
    }
    if (d0 < radius && blastClear(pos, camera.position.x, camera.position.y - 0.3, camera.position.z)) onDamagePlayer(dmg * (byPlayer ? GRENADE.selfMul : 1) * (1 - d0 / radius), pos.x, pos.z);
  }

  function clearGrenades() {
    for (const g of grenades) scene.remove(g.m);
    grenades.length = 0;
  }

  return {
    gun, protoGuns, loadViewModels, buildFpArms, poseFpArms,
    fpArms: () => fpArms, resetWeapons, getW: () => W, switchWeapon, startReload,
    fire, updateWeapons, throwGrenade, updateGrenades, explode, clearGrenades,
  };
}
