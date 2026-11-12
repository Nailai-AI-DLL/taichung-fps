import * as THREE from '../vendor/three.module.min.js';
import { raycastWorld, resolveCircle, groundAt, buildGrid, flowField, flowTarget, cellIx, GRID_N, lerpAngle } from './core.js';
import { buildMap } from './map.js';
import { PLAYER as PL, WEAPONS, GRENADE, ENEMY_TYPES, RULES, WAVES, STORY, expandWave } from './config.js';

const $ = (id) => document.getElementById(id);
const NOLOCK = new URLSearchParams(location.search).has('nolock'); // 自動化測試用:不因失去指標鎖定而暫停
const rand = Math.random;

// ============================================================ 渲染基礎
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
$('game').appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x7d6a68, 50, 430);
const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.05, 1600);
camera.rotation.order = 'YXZ';
scene.add(camera);
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
});

// 黃昏天空(地平線色與霧同色)
const sky = new THREE.Mesh(new THREE.SphereGeometry(1200, 24, 12), new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false,
  vertexShader: 'varying vec3 v;void main(){v=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
  fragmentShader: `varying vec3 v;void main(){float h=clamp(v.y,0.,1.);
    vec3 hor=vec3(.49,.416,.408),top=vec3(.09,.12,.21),glow=vec3(.95,.5,.25);
    float sun=pow(max(dot(normalize(v),normalize(vec3(-.8,.1,.35))),0.),5.);
    vec3 c=mix(hor,top,pow(h,.42))+glow*sun*.75*(1.-h);gl_FragColor=vec4(c,1.);}`,
}));
scene.add(sky);
scene.add(new THREE.HemisphereLight(0xa9b6d6, 0x4a3d34, 2.3));
const sun = new THREE.DirectionalLight(0xffb27a, 2.4);
sun.position.set(-80, 40, 35); scene.add(sun);

// ============================================================ 貼圖工具
const cv = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
function canvasTex(c, repeat) {
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; }
  return t;
}
function radialTex() {
  const c = cv(64, 64), x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.4, 'rgba(255,255,255,.55)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c);
}
const glowTex = radialTex();

// 外牆:一張貼圖 = 16m 寬 × 14m 高(4×4 扇窗);戰時燈火管制,只有零星亮燈
const FACADE = {
  res: { base: '#8a8073', win: '#1d2630', pad: [12, 14, 40, 30], sill: '#a59a8a', lit: 0.07 },
  office: { base: '#3f4d5b', win: '#172330', pad: [4, 4, 56, 56], sill: null, lit: 0.05 },
  gov: { base: '#929b9f', win: '#24323c', pad: [8, 6, 48, 46], sill: null, lit: 0.04 },
  mall: { base: '#7b736e', win: '#5f5852', pad: [2, 22, 60, 26], sill: null, lit: 0 },
  opera: { base: '#d2cdc3', win: '#26323a', pad: [0, 0, 0, 0], sill: null, lit: 0 },
};
function facadeMat(style) {
  const f = FACADE[style], a = cv(256, 256), b = cv(256, 256), x = a.getContext('2d'), e = b.getContext('2d');
  x.fillStyle = f.base; x.fillRect(0, 0, 256, 256); e.fillStyle = '#000'; e.fillRect(0, 0, 256, 256);
  if (style === 'opera') { // 歌劇院:白牆上的弧形玻璃開口
    x.fillStyle = f.win;
    x.beginPath(); x.ellipse(128, 250, 92, 170, 0, Math.PI, 0); x.fill();
    x.beginPath(); x.ellipse(0, 0, 44, 70, 0, 0, Math.PI * 2); x.ellipse(256, 0, 44, 70, 0, 0, Math.PI * 2); x.fill();
    x.fillStyle = f.base; x.fillRect(0, 0, 3, 3);
  } else {
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
      const [px, py, pw, ph] = f.pad, X = c * 64 + px, Y = r * 64 + py;
      const lit = rand() < f.lit;
      x.fillStyle = lit ? '#ffcf87' : f.win; x.fillRect(X, Y, pw, ph);
      if (lit) { e.fillStyle = '#c08c48'; e.fillRect(X, Y, pw, ph); }
      else { x.fillStyle = 'rgba(255,255,255,.06)'; x.fillRect(X, Y, pw, ph * 0.35); }
      if (f.sill) { x.fillStyle = f.sill; x.fillRect(c * 64 + 6, Y + ph + 4, 52, 5); }
    }
  }
  return new THREE.MeshLambertMaterial({ map: canvasTex(a, true), emissive: 0xffffff, emissiveMap: canvasTex(b, true) });
}
// 依牆面實際尺寸縮放 UV,讓所有同風格建物共用一個材質
function facadeBox(w, h, d) {
  const g = new THREE.BoxGeometry(w, h, d), uv = g.attributes.uv;
  for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) {
    const k = f * 4 + i;
    if (f === 2 || f === 3) uv.setXY(k, 0.004, 0.004); // 屋頂取底色
    else uv.setXY(k, uv.getX(k) * (f < 2 ? d : w) / 16, uv.getY(k) * h / 14);
  }
  return g;
}

// ============================================================ 建構世界
const MAP = buildMap();
const colliders = MAP.colliders;
const grid = buildGrid(colliders);
const flow = new Int16Array(GRID_N * GRID_N);
const G1 = new THREE.BoxGeometry(1, 1, 1);
const matCache = new Map();
const lam = (color) => { let m = matCache.get(color); if (!m) matCache.set(color, m = new THREE.MeshLambertMaterial({ color })); return m; };
function box(parent, mat, sx, sy, sz, x, y, z) {
  const m = new THREE.Mesh(G1, mat); m.scale.set(sx, sy, sz); m.position.set(x, y, z); parent.add(m); return m;
}

(function buildWorld() {
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(2600, 2600), lam(0x2b2c2f));
  ground.rotation.x = -Math.PI / 2; scene.add(ground);
  for (const b of MAP.blocks) box(scene, lam(b.green ? 0x3f5c36 : 0x6d6964), b.x1 - b.x0, 0.06, b.z1 - b.z0, (b.x0 + b.x1) / 2, 0.03, (b.z0 + b.z1) / 2);

  // 車道線
  const dashGeo = new THREE.PlaneGeometry(3, 0.22); dashGeo.rotateX(-Math.PI / 2);
  const dashes = new THREE.InstancedMesh(dashGeo, new THREE.MeshBasicMaterial({ color: 0xcfc8a8 }), MAP.roads.length * 52);
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), Qz = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2), V = new THREE.Vector3(), S1 = new THREE.Vector3(1, 1, 1);
  let n = 0;
  for (const r of MAP.roads) for (let t = -204; t < 204; t += 8) {
    const off = r.name === '台灣大道' ? 8 : 0; // 大道中央是分隔島,線畫在單側
    V.set(r.axis === 'x' ? t : r.c + off, 0.02, r.axis === 'x' ? r.c + off : t);
    M.compose(V, r.axis === 'x' ? Q : Qz, S1); dashes.setMatrixAt(n++, M);
  }
  dashes.count = n; scene.add(dashes);
  box(scene, lam(0x4d5a42), 400, 0.12, 3, 0, 0.06, -125); // 分隔島

  // 建物
  const fm = {}; for (const s of Object.keys(FACADE)) fm[s] = facadeMat(s);
  for (const b of MAP.buildings) {
    const m = new THREE.Mesh(facadeBox(b.w, b.h, b.d), fm[b.style]); m.position.set(b.x, b.h / 2, b.z); scene.add(m);
  }
  for (const d of MAP.decos) {
    if (d.type === 'beam') { const m = new THREE.Mesh(facadeBox(d.w, d.h, d.d), fm.gov); m.position.set(d.x, d.y, d.z); scene.add(m); }
    if (d.type === 'pond') { const m = new THREE.Mesh(new THREE.CircleGeometry(d.r, 40), lam(0x2d4c5e)); m.rotation.x = -Math.PI / 2; m.scale.x = 1.5; m.position.set(d.x, 0.08, d.z); scene.add(m); }
  }
  // 遠景天際線(只是剪影,無碰撞)
  const far = lam(0x3b414b);
  for (let i = 0; i < 90; i++) {
    const a = rand() * Math.PI * 2, r = 250 + rand() * 260, x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (Math.max(Math.abs(x), Math.abs(z)) < 232) continue;
    const h = 30 + rand() * 130, w = 22 + rand() * 30;
    box(scene, far, w, h, w * (0.7 + rand() * 0.6), x, h / 2, z);
  }

  // 地標招牌
  for (const l of MAP.labels) {
    const px = 96, c = cv(px * l.text.length + 40, px + 36), x = c.getContext('2d');
    x.font = `900 ${px}px "PingFang TC","Noto Sans TC","Microsoft JhengHei",sans-serif`; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillStyle = 'rgba(11,14,18,.55)'; x.fillRect(0, 0, c.width, c.height);
    x.fillStyle = '#f1ead8'; x.fillText(l.text, c.width / 2, c.height / 2 + 4);
    const h = l.size * 1.35, m = new THREE.Mesh(new THREE.PlaneGeometry(h * c.width / c.height, h), new THREE.MeshBasicMaterial({ map: canvasTex(c), transparent: true }));
    m.position.set(l.x, l.y, l.z); m.rotation.y = l.ry; scene.add(m);
  }

  // 掩體
  const glass = lam(0x161b22), tire = lam(0x1a1a1a);
  for (const p of MAP.props) {
    if (p.type === 'car') {
      const alongX = p.w > p.d;
      box(scene, lam(p.color), p.w, p.h * 0.5, p.d, p.x, 0.22 + p.h * 0.25, p.z);
      box(scene, glass, alongX ? p.w * 0.55 : p.w * 0.9, p.h * 0.36, alongX ? p.d * 0.9 : p.d * 0.55, p.x, p.h * 0.5 + 0.22 + p.h * 0.18, p.z);
      box(scene, tire, alongX ? p.w * 0.78 : p.w * 1.02, 0.5, alongX ? p.d * 1.02 : p.d * 0.78, p.x, 0.25, p.z);
    } else if (p.type === 'bus') {
      const alongX = p.w > p.d;
      box(scene, lam(p.color), p.w, p.h - 0.3, p.d, p.x, 0.3 + (p.h - 0.3) / 2, p.z);
      box(scene, glass, alongX ? p.w * 0.94 : p.w * 1.02, 0.9, alongX ? p.d * 1.02 : p.d * 0.94, p.x, p.h * 0.66, p.z);
    } else {
      box(scene, lam(p.color), p.w, p.h, p.d, p.x, p.h / 2, p.z);
      if (p.type === 'sandbag') box(scene, lam(0x7a6a48), p.w * 0.96, 0.06, p.d * 0.96, p.x, p.h * 0.5, p.z).scale.multiplyScalar(1.04);
    }
  }

  // 樹(Instanced)
  const T = MAP.trees, trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.16, 0.24, 2.6, 6), lam(0x4a3b2c), T.length);
  const crown = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1.9, 0), new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), T.length);
  const col = new THREE.Color(), Sv = new THREE.Vector3(), Qr = new THREE.Quaternion();
  T.forEach((t, i) => {
    M.compose(V.set(t.x, 1.3 * t.s, t.z), Q, Sv.setScalar(t.s)); trunk.setMatrixAt(i, M);
    Qr.setFromAxisAngle(V.set(0, 1, 0), rand() * 6);
    M.compose(V.set(t.x, 3.6 * t.s, t.z), Qr, Sv.set(t.s, t.s * (0.85 + rand() * 0.4), t.s)); crown.setMatrixAt(i, M);
    col.setHex(t.red ? 0xa63a26 : 0x3f6a36).offsetHSL((rand() - 0.5) * 0.03, 0, (rand() - 0.5) * 0.08); crown.setColorAt(i, col);
  });
  scene.add(trunk, crown);

  // 指揮所旗桿
  const fc = cv(180, 120), fx = fc.getContext('2d');
  fx.fillStyle = '#d0202a'; fx.fillRect(0, 0, 180, 120); fx.fillStyle = '#10237a'; fx.fillRect(0, 0, 90, 60);
  fx.fillStyle = '#fff'; fx.translate(45, 30);
  for (let i = 0; i < 12; i++) { fx.rotate(Math.PI / 6); fx.beginPath(); fx.moveTo(-4.2, -13); fx.lineTo(0, -24); fx.lineTo(4.2, -13); fx.fill(); }
  fx.beginPath(); fx.arc(0, 0, 11, 0, 7); fx.fill(); fx.strokeStyle = '#10237a'; fx.lineWidth = 2; fx.stroke();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 7, 6), lam(0xb8b8b8)); pole.position.set(7.5, 3.5, 26); scene.add(pole);
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.6), new THREE.MeshBasicMaterial({ map: canvasTex(fc), side: THREE.DoubleSide }));
  flag.position.set(8.75, 6.1, 26); scene.add(flag);
})();

// 遠方濃煙
const smokes = [];
for (const [x, z] of [[-240, -250], [270, -110], [130, 300], [-310, 150], [40, -330], [-150, 320]]) {
  const fire = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xff7a2a, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, opacity: 0.8 }));
  fire.position.set(x, 14, z); fire.scale.setScalar(60); scene.add(fire);
  for (let i = 0; i < 7; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0x0f0f10, transparent: true, depthWrite: false, fog: false }));
    scene.add(s); smokes.push({ s, x, z, o: i / 7, sp: 0.035 + rand() * 0.01 });
  }
}
function updateSmoke(t) {
  for (const k of smokes) {
    const u = (t * k.sp + k.o) % 1;
    k.s.position.set(k.x + u * 70, 18 + u * 190, k.z + u * 25);
    k.s.scale.setScalar(50 + u * 130); k.s.material.opacity = 0.5 * Math.sin(u * Math.PI);
  }
}

// ============================================================ 音效(全部用 WebAudio 合成)
let AC = null, master = null, noiseBuf = null;
function initAudio() {
  if (AC) { AC.resume(); return; }
  try {
    AC = new (window.AudioContext || window.webkitAudioContext)();
    master = AC.createGain(); master.gain.value = 0.45; master.connect(AC.destination);
    noiseBuf = AC.createBuffer(1, AC.sampleRate, AC.sampleRate);
    const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = rand() * 2 - 1;
  } catch { AC = null; }
}
function noise(vol, dur, freq, type = 'lowpass') {
  if (!AC || vol < 0.005) return;
  const s = AC.createBufferSource(), f = AC.createBiquadFilter(), g = AC.createGain(), t = AC.currentTime;
  s.buffer = noiseBuf; s.playbackRate.value = 0.7 + rand() * 0.6; f.type = type; f.frequency.value = freq;
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  s.connect(f).connect(g).connect(master); s.start(t, rand() * 0.5, dur + 0.02);
}
function tone(f0, f1, dur, vol, type = 'sine') {
  if (!AC) return;
  const o = AC.createOscillator(), g = AC.createGain(), t = AC.currentTime;
  o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(master); o.start(t); o.stop(t + dur + 0.02);
}
const sfx = {
  rifle() { noise(0.55, 0.13, 3200); tone(160, 50, 0.09, 0.4, 'square'); },
  pistol() { noise(0.45, 0.09, 4500); tone(240, 70, 0.06, 0.3, 'square'); },
  enemy(d) { const v = 0.35 / (1 + d / 18); noise(v, 0.12, 1700); },
  boom(d = 0) { const v = 1 / (1 + d / 30); noise(0.9 * v, 1.0, 600); tone(90, 28, 0.6, 0.8 * v); },
  hit() { tone(1700, 1500, 0.035, 0.18, 'square'); },
  head() { tone(2500, 1900, 0.07, 0.22, 'square'); },
  kill() { tone(700, 1050, 0.1, 0.16, 'triangle'); },
  empty() { tone(900, 800, 0.03, 0.12, 'square'); },
  reload() { noise(0.2, 0.04, 2500, 'highpass'); setTimeout(() => noise(0.25, 0.05, 1800, 'highpass'), 380); },
  hurt() { tone(130, 60, 0.16, 0.5); noise(0.2, 0.1, 500); },
  pick() { tone(620, 930, 0.12, 0.2, 'triangle'); },
  radio() { tone(1250, 1250, 0.06, 0.07, 'square'); setTimeout(() => tone(1650, 1650, 0.06, 0.07, 'square'), 90); },
  drone(d) { tone(210, 190, 0.12, 0.1 / (1 + d / 10), 'sawtooth'); },
};

// ============================================================ 特效池
const tracerMatP = new THREE.LineBasicMaterial({ color: 0xffe2a0 }), tracerMatE = new THREE.LineBasicMaterial({ color: 0xa8ffb0 });
const tracers = Array.from({ length: 48 }, () => {
  const l = new THREE.Line(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3)), tracerMatP);
  l.visible = false; l.frustumCulled = false; l.userData.life = 0; scene.add(l); return l;
});
let tracerI = 0;
function tracer(a, b, enemy) {
  const l = tracers[tracerI = (tracerI + 1) % tracers.length], p = l.geometry.attributes.position;
  p.setXYZ(0, a.x, a.y, a.z); p.setXYZ(1, b.x, b.y, b.z); p.needsUpdate = true;
  l.material = enemy ? tracerMatE : tracerMatP; l.visible = true; l.userData.life = 0.07;
}
const flashes = Array.from({ length: 56 }, () => {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  s.visible = false; s.userData = { life: 0, max: 1, s0: 1, s1: 1 }; scene.add(s); return s;
});
let flashI = 0;
function flash(pos, color, s0, s1, life) {
  const s = flashes[flashI = (flashI + 1) % flashes.length];
  s.position.copy(pos); s.material.color.setHex(color); s.material.opacity = 1; s.scale.setScalar(s0);
  s.userData.life = s.userData.max = life; s.userData.s0 = s0; s.userData.s1 = s1; s.visible = true;
}
function updateFx(dt) {
  for (const l of tracers) if (l.visible && (l.userData.life -= dt) <= 0) l.visible = false;
  for (const s of flashes) if (s.visible) {
    const u = s.userData; u.life -= dt;
    if (u.life <= 0) { s.visible = false; continue; }
    const k = 1 - u.life / u.max; s.scale.setScalar(u.s0 + (u.s1 - u.s0) * k); s.material.opacity = 1 - k * k;
  }
}

// ============================================================ 狀態
const S = { mode: 'menu', wave: -1, queue: [], spawnT: 0, interT: 0, time: 0, kills: 0, heads: 0, shots: 0, hits: 0, flowT: 0, alive: 0 };
const P = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), yaw: 0, pitch: 0, hp: PL.hp, eye: PL.eye, crouch: false, onGround: true, lastHurt: -99, wi: 0, grenades: PL.grenades, ads: false, bloom: 0, bob: 0, kick: 0 };
let W = [];
const enemies = [], hitMeshes = [], pickups = [], grenades = [];
const keys = new Set();
let firing = false, fireLatch = false, fireQueued = false, edgeTurn = 0; // edgeTurn:沒鎖定滑鼠時,游標靠左右邊緣持續轉向

// ============================================================ 槍枝模型(掛在攝影機上)
const gun = new THREE.Group(); camera.add(gun);
const gunMat = lam(0x2e3238), gunMat2 = lam(0x474c40);
const rifleModel = new THREE.Group(), pistolModel = new THREE.Group();
box(rifleModel, gunMat, 0.055, 0.075, 0.52, 0, 0, -0.1); box(rifleModel, gunMat, 0.028, 0.028, 0.3, 0, 0.008, -0.5);
box(rifleModel, gunMat2, 0.05, 0.16, 0.07, 0, -0.1, -0.02); box(rifleModel, gunMat, 0.02, 0.05, 0.14, 0, 0.065, -0.06);
box(rifleModel, gunMat2, 0.06, 0.06, 0.2, 0, -0.005, -0.3);
box(pistolModel, gunMat, 0.04, 0.055, 0.22, 0, 0, -0.1); box(pistolModel, gunMat2, 0.038, 0.13, 0.055, 0, -0.08, -0.02);
rifleModel.position.z = -0.22; pistolModel.position.z = -0.14; // 往前推,避免槍托貼臉佔滿畫面
gun.add(rifleModel, pistolModel);
const muzzle = new THREE.Object3D(); gun.add(muzzle);
const muzzleFlash = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xffc36a, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }));
muzzleFlash.scale.setScalar(0.32); muzzleFlash.visible = false; muzzle.add(muzzleFlash);
const muzzleLight = new THREE.PointLight(0xffb060, 0, 22); camera.add(muzzleLight);
let flashT = 0;

// ============================================================ HUD
const hud = { hpbar: $('hpbar'), hpfill: $('hpbar').firstElementChild, hpnum: $('hpnum'), ammo: $('ammo'), wname: $('wname'), gren: $('gren'), wave: $('wave'), left: $('left'), banner: $('banner'), radio: $('radio'), rtext: $('radiotext'), hit: $('hit'), vign: $('vign'), dmg: $('dmgdir'), cross: $('cross'), feed: $('feed'), tip: $('tip') };
const mapCtx = $('map').getContext('2d');
let bannerT = 0, radioT = 0, hitT = 0, vignT = 0, dmgT = 0, dmgAng = 0, tipT = 0;
function banner(big, small, dur = 3.2) { hud.banner.firstElementChild.textContent = big; hud.banner.lastElementChild.textContent = small; hud.banner.style.opacity = 1; bannerT = dur; }
function radio(text, dur = 7) { hud.rtext.textContent = text; hud.radio.style.opacity = 1; radioT = dur; sfx.radio(); }
function tip(text) { hud.tip.textContent = text; hud.tip.style.opacity = 1; tipT = 1.6; }
function feed(text, hs) { const d = document.createElement('div'); d.textContent = text; if (hs) d.className = 'hs'; hud.feed.prepend(d); setTimeout(() => d.remove(), 2700); while (hud.feed.children.length > 5) hud.feed.lastChild.remove(); }
function hitMarker(head) { hud.hit.className = head ? 'head' : ''; hitT = 0.16; head ? sfx.head() : sfx.hit(); }

function updateHud(dt) {
  const w = W[P.wi], hp = Math.max(0, Math.ceil(P.hp));
  hud.hpfill.style.width = hp + '%'; hud.hpnum.textContent = hp; hud.hpbar.classList.toggle('low', hp <= 30);
  hud.wname.textContent = w.reloadT > 0 ? w.def.name + ' — 裝填中' : w.def.name;
  hud.ammo.innerHTML = `<b>${w.mag}</b> / ${w.reserve === Infinity ? '∞' : w.reserve}`;
  hud.ammo.classList.toggle('low', w.mag <= w.def.mag * 0.2);
  hud.gren.textContent = '手榴彈 × ' + P.grenades;
  hud.wave.textContent = S.wave < 0 ? '備戰' : `第 ${S.wave + 1} / ${WAVES.length} 波`;
  hud.left.textContent = S.interT > 0 ? `下一波 ${Math.ceil(S.interT)} 秒` : `敵軍殘存 ${S.alive + S.queue.length}`;
  hud.cross.style.setProperty('--gap', (P.ads ? 0 : 4 + P.bloom * 9 + Math.hypot(P.vel.x, P.vel.z) * 0.9) + 'px');
  hud.cross.style.opacity = W[P.wi].reloadT > 0 ? 0.35 : 1;
  if (bannerT > 0 && (bannerT -= dt) <= 0) hud.banner.style.opacity = 0;
  if (radioT > 0 && (radioT -= dt) <= 0) hud.radio.style.opacity = 0;
  if (tipT > 0 && (tipT -= dt) <= 0) hud.tip.style.opacity = 0;
  hitT = Math.max(0, hitT - dt); hud.hit.style.opacity = hitT > 0 ? 1 : 0;
  vignT = Math.max(0, vignT - dt); hud.vign.style.opacity = Math.max(vignT, hp <= 30 ? 0.35 : 0);
  dmgT = Math.max(0, dmgT - dt); hud.dmg.style.opacity = Math.min(1, dmgT * 2); hud.dmg.style.transform = `rotate(${dmgAng}rad)`;
  drawMap();
}
function drawMap() {
  const c = mapCtx, Wd = 340, h = Wd / 2, s = h / 75, cy = Math.cos(P.yaw), sy = Math.sin(P.yaw);
  c.clearRect(0, 0, Wd, Wd); c.save(); c.beginPath(); c.arc(h, h, h - 2, 0, 7); c.clip();
  c.fillStyle = 'rgba(10,14,18,.7)'; c.fillRect(0, 0, Wd, Wd);
  c.translate(h, h); c.rotate(P.yaw); c.scale(s, s); c.translate(-P.pos.x, -P.pos.z);
  c.fillStyle = 'rgba(160,170,180,.5)';
  for (const b of MAP.buildings) { if (Math.abs(b.x - P.pos.x) > 150 || Math.abs(b.z - P.pos.z) > 150) continue; c.fillRect(b.x - b.w / 2, b.z - b.d / 2, b.w, b.d); }
  c.restore();
  const dot = (wx, wz, color, r) => {
    const dx = wx - P.pos.x, dz = wz - P.pos.z; let x = (dx * cy - dz * sy) * s, y = (dx * sy + dz * cy) * s;
    const l = Math.hypot(x, y), m = h - 9; if (l > m) { x *= m / l; y *= m / l; }
    c.fillStyle = color; c.beginPath(); c.arc(h + x, h + y, r, 0, 7); c.fill();
  };
  for (const p of pickups) dot(p.mesh.position.x, p.mesh.position.z, p.type === 'supply' ? '#ffb347' : p.type === 'med' ? '#fff' : '#9fd36a', p.type === 'supply' ? 7 : 4);
  for (const e of enemies) if (e.alive) dot(e.group.position.x, e.group.position.z, e.drone ? '#ff9a3c' : '#ff4a3a', e.drone ? 4 : 5);
  c.fillStyle = '#e9e4d8'; c.beginPath(); c.moveTo(h, h - 11); c.lineTo(h + 7, h + 8); c.lineTo(h, h + 4); c.lineTo(h - 7, h + 8); c.fill();
}

// ============================================================ 玩家
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _dir = new THREE.Vector3(), _right = new THREE.Vector3(), _up = new THREE.Vector3();
function updatePlayer(dt) {
  let f = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0), s = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
  const len = Math.hypot(f, s) || 1; f /= len; s /= len;
  if (edgeTurn && !document.pointerLockElement) P.yaw -= edgeTurn * 2.4 * dt;
  P.crouch = keys.has('KeyC');
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
  const fov = P.ads ? 48 : sprint ? 80 : 75;
  if (Math.abs(camera.fov - fov) > 0.1) { camera.fov += (fov - camera.fov) * Math.min(1, 14 * dt); camera.updateProjectionMatrix(); }
  camera.updateMatrixWorld();
}
function damagePlayer(dmg, sx, sz) {
  if (S.mode !== 'playing') return;
  P.hp -= dmg; P.lastHurt = S.time; vignT = Math.min(0.8, 0.3 + dmg / 40); sfx.hurt();
  if (sx !== undefined) {
    const vx = sx - P.pos.x, vz = sz - P.pos.z, sy = Math.sin(P.yaw), cy = Math.cos(P.yaw);
    dmgAng = Math.atan2(vx * cy - vz * sy, -vx * sy - vz * cy); dmgT = 1;
  }
  if (P.hp <= 0) endGame(false);
}

// ============================================================ 武器
function resetWeapons() { W = WEAPONS.map((def) => ({ def, mag: def.mag, reserve: def.reserve, cool: 0, reloadT: 0 })); P.wi = 0; }
function switchWeapon(i) { if (i === P.wi || !W[i]) return; W[P.wi].reloadT = 0; P.wi = i; W[i].cool = 0.25; P.kick = 0.5; }
function startReload() {
  const w = W[P.wi];
  if (w.reloadT > 0 || w.mag >= w.def.mag || w.reserve <= 0) return;
  w.reloadT = w.def.reload; sfx.reload();
}
function fire() {
  const w = W[P.wi], def = w.def;
  if (w.cool > 0 || w.reloadT > 0) return false;
  if (w.mag <= 0) { sfx.empty(); w.cool = 0.2; if (w.reserve > 0) startReload(); else tip('彈藥耗盡 — 按 2 換手槍'); return true; }
  w.mag--; w.cool = def.interval; S.shots++;
  camera.getWorldDirection(_dir);
  _right.setFromMatrixColumn(camera.matrixWorld, 0); _up.setFromMatrixColumn(camera.matrixWorld, 1);
  const moving = Math.hypot(P.vel.x, P.vel.z) > 1.5;
  const sp = def.spread * (P.ads ? 0.3 : 1) * (moving ? 1.7 : 1) * (P.crouch ? 0.7 : 1) * (1 + P.bloom * 2.2) * (P.onGround ? 1 : 2.5);
  const a = rand() * Math.PI * 2, r = Math.sqrt(rand()) * sp;
  _dir.addScaledVector(_right, Math.cos(a) * r).addScaledVector(_up, Math.sin(a) * r).normalize();
  const o = camera.position;
  let dist = raycastWorld(o.x, o.y, o.z, _dir.x * def.range, _dir.y * def.range, _dir.z * def.range, colliders) * def.range;
  if (_dir.y < -0.001) dist = Math.min(dist, -o.y / _dir.y); // 地面
  ray.set(o, _dir); ray.far = dist;
  const hit = ray.intersectObjects(hitMeshes, false)[0];
  if (hit) {
    dist = hit.distance; const e = hit.object.userData.enemy, head = hit.object.userData.head;
    S.hits++; hitMarker(head);
    damageEnemy(e, def.dmg * (head ? def.head : 1), head);
    flash(hit.point, 0xff5a3a, 0.25, 0.6, 0.12);
  } else if (dist < def.range) { _v.copy(o).addScaledVector(_dir, dist - 0.05); flash(_v, 0xffd9a0, 0.2, 0.55, 0.1); }
  muzzle.getWorldPosition(_v2); _v.copy(o).addScaledVector(_dir, dist); tracer(_v2, _v, false);
  P.pitch = Math.min(1.5, P.pitch + def.recoil * (0.7 + rand() * 0.6) * (P.ads ? 0.7 : 1)); P.yaw += (rand() - 0.5) * def.recoil * 0.7;
  P.bloom = Math.min(1, P.bloom + 0.22); P.kick = 1; flashT = 0.045;
  def.id === 't91' ? sfx.rifle() : sfx.pistol();
  return true;
}
const ray = new THREE.Raycaster();
function updateWeapons(dt) {
  const w = W[P.wi];
  w.cool -= dt; P.bloom = Math.max(0, P.bloom - dt * 2.4); P.kick = Math.max(0, P.kick - dt * 9);
  if (w.reloadT > 0 && (w.reloadT -= dt) <= 0) { const n = Math.min(w.def.mag - w.mag, w.reserve); w.mag += n; w.reserve -= n; w.reloadT = 0; }
  // fireQueued:按下與放開落在同一幀(極短的點擊)時,仍保證打出一發
  if (w.reloadT > 0) fireQueued = false;
  else if ((firing || fireQueued) && (w.def.auto || !fireLatch || fireQueued) && fire()) { fireLatch = true; fireQueued = false; }
  // 槍枝姿態
  rifleModel.visible = P.wi === 0; pistolModel.visible = P.wi === 1;
  const hs = Math.hypot(P.vel.x, P.vel.z), ads = P.ads && w.reloadT <= 0;
  const tx = ads ? 0 : 0.2, ty = ads ? (P.wi === 0 ? -0.105 : -0.06) : -0.19, tz = ads ? -0.3 : -0.42, k = Math.min(1, 16 * dt);
  gun.position.x += (tx - gun.position.x) * k; gun.position.y += (ty - gun.position.y) * k; gun.position.z += (tz - gun.position.z) * k;
  const bobK = ads ? 0.15 : 1, rl = w.reloadT > 0 ? Math.sin(Math.min(1, (w.def.reload - w.reloadT) / w.def.reload) * Math.PI) : 0;
  gun.position.x += Math.cos(P.bob) * 0.0012 * hs * bobK; gun.position.y += Math.abs(Math.sin(P.bob)) * 0.0012 * hs * bobK;
  gun.rotation.set(P.kick * 0.05 - rl * 0.7, rl * 0.35, rl * 0.25);
  gun.translateZ(P.kick * 0.035);
  muzzle.position.set(0, P.wi === 0 ? 0.008 : 0.005, P.wi === 0 ? -0.9 : -0.37);
  flashT -= dt; muzzleFlash.visible = flashT > 0; muzzleLight.intensity = flashT > 0 ? 40 : 0;
  if (muzzleFlash.visible) muzzleFlash.material.rotation = rand() * 6;
}

// 手榴彈
const grenGeo = new THREE.SphereGeometry(0.09, 8, 6);
function throwGrenade() {
  if (P.grenades <= 0) { tip('沒有手榴彈'); return; }
  P.grenades--;
  camera.getWorldDirection(_dir);
  const m = new THREE.Mesh(grenGeo, lam(0x39422e)); const o = camera.position, clear = raycastWorld(o.x, o.y, o.z, _dir.x * 0.7, _dir.y * 0.7, _dir.z * 0.7, colliders) >= 1;
  m.position.copy(o); if (clear) m.position.addScaledVector(_dir, 0.5); scene.add(m);
  grenades.push({ m, v: _dir.clone().multiplyScalar(GRENADE.throwSpeed).add(_v.set(P.vel.x, 4.5, P.vel.z)), t: GRENADE.fuse });
}
function updateGrenades(dt) {
  for (let i = grenades.length - 1; i >= 0; i--) {
    const g = grenades[i], p = g.m.position;
    g.v.y -= 20 * dt;
    const dx = g.v.x * dt, dy = g.v.y * dt, dz = g.v.z * dt;
    if (raycastWorld(p.x, p.y, p.z, dx, dy, dz, colliders) < 1) { g.v.x *= -0.35; g.v.z *= -0.35; g.v.y *= 0.5; }
    else { p.x += dx; p.y += dy; p.z += dz; }
    if (p.y < 0.1) { p.y = 0.1; g.v.y *= -0.35; g.v.x *= 0.6; g.v.z *= 0.6; }
    if ((g.t -= dt) <= 0) { explode(p, GRENADE.radius, GRENADE.dmg, true); scene.remove(g.m); grenades.splice(i, 1); }
  }
}
// 爆炸點(略抬高避免貼地誤判)到目標之間沒有障礙才算炸到
function blastClear(pos, x, y, z) { const oy = pos.y + 0.4; return raycastWorld(pos.x, oy, pos.z, x - pos.x, y - oy, z - pos.z, colliders) >= 1; }
function explode(pos, radius, dmg, byPlayer) {
  const d0 = pos.distanceTo(camera.position);
  sfx.boom(d0);
  flash(pos, 0xffb040, 1.5, radius * 1.6 + 3, 0.4); flash(_v.copy(pos).setY(pos.y + 0.6), 0xff5a20, 1, radius + 2, 0.55);
  for (let i = 0; i < 5; i++) flash(_v.set(pos.x + (rand() - 0.5) * 3, pos.y + rand() * 2, pos.z + (rand() - 0.5) * 3), 0x664433, 1.2, 4 + rand() * 3, 0.7 + rand() * 0.5);
  if (radius <= 0) return;
  if (byPlayer) for (const e of enemies) {
    if (!e.alive) continue;
    const d = Math.hypot(e.group.position.x - pos.x, e.group.position.z - pos.z, e.group.position.y + (e.drone ? 0 : 1) - pos.y);
    if (d < radius && blastClear(pos, e.group.position.x, e.group.position.y + (e.drone ? 0 : 1.1), e.group.position.z)) damageEnemy(e, dmg * (1 - d / radius) + 15, false);
  }
  if (d0 < radius && blastClear(pos, camera.position.x, camera.position.y - 0.3, camera.position.z)) damagePlayer(dmg * (byPlayer ? GRENADE.selfMul : 1) * (1 - d0 / radius), pos.x, pos.z);
}

// ============================================================ 敵人
const _ft = { x: 0, z: 0 };
const skinMat = lam(0xc49a78), darkMat = lam(0x1f2226), redMat = new THREE.MeshBasicMaterial({ color: 0xd8281e });
function hitPart(e, parent, mat, sx, sy, sz, x, y, z, head) {
  const m = box(parent, mat, sx, sy, sz, x, y, z); m.userData.enemy = e; m.userData.head = !!head; e.hit.push(m); return m;
}
function spawnEnemy({ type, dir }) {
  const def = ENEMY_TYPES[type], pts = MAP.spawns[dir];
  let pt = pts[Math.floor(rand() * pts.length)];
  for (let i = 0; i < 6 && Math.hypot(pt[0] - P.pos.x, pt[1] - P.pos.z) < 40; i++) pt = pts[Math.floor(rand() * pts.length)];
  const e = { type, def, drone: type === 'drone', group: new THREE.Group(), hit: [], hp: def.hp, alive: true, deadT: 0, gone: false, los: false, losT: rand() * 0.2, aimT: 0, burst: def.burst || 0, shotT: 0, pauseT: 0, strafe: 0, strafeT: 0, phase: rand() * 6 };
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
    hitPart(e, g, skinMat, 0.22, 0.24, 0.24, 0, 1.56, 0, true); hitPart(e, g, helm, 0.28, 0.14, 0.3, 0, 1.68, 0, true);
    box(g, redMat, 0.07, 0.07, 0.02, 0, 1.68, 0.155);
    const leg = (x) => { const pv = new THREE.Group(); pv.position.set(x, 0.82, 0); g.add(pv); hitPart(e, pv, u, 0.2, 0.82, 0.24, 0, -0.41, 0); return pv; };
    e.legL = leg(-0.14); e.legR = leg(0.14);
    hitPart(e, g, u, 0.15, 0.55, 0.18, -0.34, 1.12, 0.06); hitPart(e, g, u, 0.15, 0.55, 0.18, 0.34, 1.12, 0.06);
    box(g, darkMat, 0.07, 0.1, type === 'heavy' ? 1.0 : 0.75, 0.2, 1.2, 0.42);
    if (type === 'heavy') box(g, darkMat, 0.62, 0.5, 0.2, 0, 1.15, -0.22);
    g.scale.setScalar(def.scale);
    g.position.set(pt[0] + (rand() - 0.5) * 6, 0, pt[1] + (rand() - 0.5) * 6);
    resolveCircle(g.position, 0.4, 0, 1.7, colliders);
  }
  scene.add(g); g.updateMatrixWorld(true);
  enemies.push(e); hitMeshes.push(...e.hit);
  return e;
}
function damageEnemy(e, dmg, head) {
  if (!e.alive) return;
  e.hp -= dmg; e.aimT = Math.max(e.aimT, (e.def.react || 0) * 0.5);
  if (e.hp <= 0) killEnemy(e, head, false);
}
function killEnemy(e, head, silent) {
  e.alive = false; e.deadT = 0;
  for (const m of e.hit) { const i = hitMeshes.indexOf(m); if (i >= 0) hitMeshes.splice(i, 1); }
  if (e.drone) { if (!silent) explode(e.group.position, 0, 0, false); scene.remove(e.group); e.gone = true; }
  if (silent) return;
  S.kills++; if (head) S.heads++; sfx.kill();
  feed((head ? '爆頭 ' : '擊殺 ') + e.def.name, head);
  if (!e.drone) {
    const r = rand();
    if (r < RULES.dropAmmo) addPickup('ammo', e.group.position.x, e.group.position.z);
    else if (r < RULES.dropAmmo + RULES.dropMed) addPickup('med', e.group.position.x, e.group.position.z);
  }
}
function updateEnemy(e, dt) {
  const g = e.group, def = e.def, p = g.position;
  if (!e.alive) { e.deadT += dt; g.rotation.x = -Math.min(1, e.deadT / 0.4) * 1.5; if (e.deadT > 7) { scene.remove(g); e.gone = true; } return; }
  const px = P.pos.x, pz = P.pos.z, chestY = P.pos.y + P.eye - 0.25;
  let dx = px - p.x, dz = pz - p.z; const dist = Math.hypot(dx, dz) || 1e-3; dx /= dist; dz /= dist;
  if ((e.losT -= dt) <= 0) {
    e.losT = 0.14 + rand() * 0.1;
    const oy = p.y + (e.drone ? 0 : 1.5 * def.scale);
    e.los = raycastWorld(p.x, oy, p.z, px - p.x, chestY - oy, pz - p.z, colliders) >= 1;
  }
  // 沿流場走向玩家
  const followFlow = (speed) => {
    flowTarget(grid, flow, p.x, p.z, px, pz, _ft);
    const vx = _ft.x - p.x, vz = _ft.z - p.z, l = Math.hypot(vx, vz) || 1;
    p.x += vx / l * speed * dt; p.z += vz / l * speed * dt; return Math.atan2(vx, vz);
  };
  if (e.drone) {
    const d3 = Math.hypot(px - p.x, chestY - p.y, pz - p.z);
    if (d3 < 1.7) { explode(p, 0, 0, false); damagePlayer(def.dmg, p.x, p.z); killEnemy(e, false, true); scene.remove(g); e.gone = true; return; }
    if (e.los && dist < def.range) { const k = def.dive * dt / d3; p.x += (px - p.x) * k; p.y += (chestY - p.y) * k; p.z += (pz - p.z) * k; }
    else { followFlow(def.speed); p.y += (7 + Math.sin(e.phase) * 0.5 - p.y) * Math.min(1, 2 * dt); }
    e.phase += dt * 3; resolveCircle(p, 0.5, p.y - 0.3, 0.6, colliders);
    g.rotation.y = Math.atan2(dx, dz); for (const r of e.rotors) r.rotation.y += dt * 40;
    if ((e.shotT -= dt) <= 0) { e.shotT = 0.35; sfx.drone(dist); }
    return;
  }
  const engage = e.los && dist < def.range;
  let face = g.rotation.y, moved = false;
  if (engage) {
    if ((e.strafeT -= dt) <= 0) { e.strafe = Math.floor(rand() * 3) - 1; e.strafeT = 0.8 + rand() * 1.6; }
    let mx = -dz * e.strafe * 0.6, mz = dx * e.strafe * 0.6;
    if (dist > def.pref) { flowTarget(grid, flow, p.x, p.z, px, pz, _ft); const vx = _ft.x - p.x, vz = _ft.z - p.z, l = Math.hypot(vx, vz) || 1; mx += vx / l; mz += vz / l; } else if (dist < def.pref * 0.5) { mx -= dx * 0.6; mz -= dz * 0.6; }
    const ml = Math.hypot(mx, mz);
    if (ml > 0.01) { const sp = def.speed * 0.55; p.x += mx / ml * sp * dt; p.z += mz / ml * sp * dt; e.phase += sp * dt * 2.4; moved = true; }
    face = Math.atan2(dx, dz);
  } else { const sp = def.speed * (def.run || 1); face = followFlow(sp); e.phase += sp * dt * 2.4; moved = true; }
  resolveCircle(p, 0.4, 0, 1.7, colliders);
  g.rotation.y = lerpAngle(g.rotation.y, face, Math.min(1, 10 * dt));
  const sw = moved ? Math.sin(e.phase) * 0.6 : 0; e.legL.rotation.x = sw; e.legR.rotation.x = -sw;
  // 射擊:看見玩家 → 反應時間 → 點放 → 停頓
  if (engage) {
    e.aimT += dt;
    if (e.aimT > def.react) {
      if (e.burst > 0) { if ((e.shotT -= dt) <= 0) { enemyShoot(e, dx, dz, dist, chestY); e.shotT = def.rof; if (--e.burst === 0) e.pauseT = def.pause * (0.7 + rand() * 0.6); } }
      else if ((e.pauseT -= dt) <= 0) e.burst = def.burst;
    }
  } else e.aimT = Math.max(0, e.aimT - dt * 2);
}
function enemyShoot(e, dx, dz, dist, chestY) {
  const def = e.def, p = e.group.position;
  _v.set(p.x + dx * 0.6, 1.3 * def.scale, p.z + dz * 0.6);
  const acc = def.acc * Math.max(0.25, Math.min(1, 1.15 - dist / def.range)) * (P.crouch ? 0.65 : 1) * (Math.hypot(P.vel.x, P.vel.z) > 6 ? 0.7 : 1);
  flash(_v, 0xffd080, 0.3, 0.7, 0.06); sfx.enemy(dist);
  if (rand() < acc) { _v2.set(P.pos.x, chestY, P.pos.z); tracer(_v, _v2, true); damagePlayer(def.dmg, p.x, p.z); }
  else { _v2.set(P.pos.x + (rand() - 0.5) * 3 + dx * 8, chestY + (rand() - 0.3) * 1.6, P.pos.z + (rand() - 0.5) * 3 + dz * 8); tracer(_v, _v2, true); }
}

// ============================================================ 補給
function addPickup(type, x, z) {
  const g = new THREE.Group();
  if (type === 'ammo') box(g, lam(0x55702f), 0.5, 0.3, 0.3, 0, 0, 0);
  else if (type === 'med') { box(g, lam(0xeeeeee), 0.42, 0.3, 0.3, 0, 0, 0); box(g, redMat, 0.14, 0.31, 0.31, 0, 0, 0); }
  else { box(g, lam(0x5a6a3c), 1.1, 0.8, 0.8, 0, 0, 0); box(g, lam(0xffb347), 1.12, 0.1, 0.82, 0, 0.2, 0); }
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: type === 'med' ? 0xffffff : type === 'supply' ? 0xffb347 : 0x9fd36a, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.55 }));
  glow.scale.setScalar(type === 'supply' ? 4 : 1.8); g.add(glow);
  g.position.set(x, type === 'supply' ? 0.6 : 0.5, z); scene.add(g);
  pickups.push({ type, mesh: g, t: 0 });
}
function updatePickups(dt) {
  for (let i = pickups.length - 1; i >= 0; i--) {
    const k = pickups[i], m = k.mesh; k.t += dt; m.rotation.y += dt * 1.5; if (k.type !== 'supply') m.position.y = 0.5 + Math.sin(k.t * 3) * 0.08;
    if (Math.hypot(m.position.x - P.pos.x, m.position.z - P.pos.z) > (k.type === 'supply' ? 2 : 1.4)) { if (k.type !== 'supply' && k.t > 45) { scene.remove(m); pickups.splice(i, 1); } continue; }
    const r = W[0];
    if (k.type === 'ammo') { if (r.reserve >= r.def.maxReserve) continue; const n = Math.min(RULES.ammoPickup, r.def.maxReserve - r.reserve); r.reserve += n; tip('+' + n + ' 步槍彈'); }
    else if (k.type === 'med') { if (P.hp >= PL.hp) continue; P.hp = Math.min(PL.hp, P.hp + RULES.medPickup); tip('+' + RULES.medPickup + ' 體力'); }
    else if (r.reserve >= r.def.maxReserve && P.hp >= PL.hp && P.grenades >= PL.maxGrenades) continue;
    else { r.reserve = Math.min(r.def.maxReserve, r.reserve + RULES.supplyAmmo); P.hp = Math.min(PL.hp, P.hp + RULES.supplyHeal); P.grenades = Math.min(PL.maxGrenades, P.grenades + RULES.supplyGrenades); tip('補給完成'); }
    sfx.pick(); scene.remove(m); pickups.splice(i, 1);
  }
}

// ============================================================ 波次
function startWave(n) {
  S.wave = n; const w = WAVES[n];
  S.queue = expandWave(w); S.spawnT = 0.5;
  banner(w.name, `第 ${n + 1} 波`); radio(w.radio);
}
function updateWaves(dt) {
  if (S.interT > 0) { if ((S.interT -= dt) <= 0) startWave(S.wave + 1); return; }
  if (S.queue.length) { if ((S.spawnT -= dt) <= 0 && S.alive < RULES.maxAlive) { spawnEnemy(S.queue.pop()); S.spawnT = RULES.spawnGap; } }
  else if (S.alive === 0) {
    if (S.wave >= WAVES.length - 1) { endGame(true); return; }
    S.interT = RULES.intermission; banner('擊退', `第 ${S.wave + 1} 波`, 2.5); radio(STORY.supply, 6);
    if (!pickups.some((p) => p.type === 'supply')) addPickup('supply', MAP.supply.x, MAP.supply.z);
  }
}

// ============================================================ 流程
function setMode(m) {
  S.mode = m;
  $('menu').classList.toggle('hidden', m !== 'menu'); $('pause').classList.toggle('hidden', m !== 'paused');
  $('end').classList.toggle('hidden', m !== 'dead' && m !== 'won'); $('hud').classList.toggle('hidden', m === 'menu');
  gun.visible = m !== 'menu';
}
let lockFailed = false;
function lock() { if (NOLOCK) return; try { const r = renderer.domElement.requestPointerLock(); if (r && r.catch) r.catch(() => { lockFailed = true; }); } catch { lockFailed = true; /* 無法鎖定時仍可遊玩 */ } }
function startGame() {
  initAudio();
  for (const e of enemies) scene.remove(e.group); enemies.length = 0; hitMeshes.length = 0;
  for (const p of pickups) scene.remove(p.mesh); pickups.length = 0;
  for (const g of grenades) scene.remove(g.m); grenades.length = 0;
  Object.assign(S, { wave: -1, queue: [], spawnT: 0, interT: RULES.firstDelay, time: 0, kills: 0, heads: 0, shots: 0, hits: 0, flowT: 0, alive: 0 });
  P.pos.set(MAP.playerStart.x, 0, MAP.playerStart.z); P.vel.set(0, 0, 0);
  Object.assign(P, { yaw: 0, pitch: 0, hp: PL.hp, eye: PL.eye, lastHurt: -99, grenades: PL.grenades, ads: false, bloom: 0, kick: 0 });
  resetWeapons(); firing = false; keys.clear();
  camera.fov = 75; camera.updateProjectionMatrix();
  setMode('playing'); lock();
  banner('七期防線', '守住新市政中心', 4); radio(STORY.intro, 6.5);
}
function endGame(win) {
  setMode(win ? 'won' : 'dead'); firing = false;
  if (document.pointerLockElement) document.exitPointerLock();
  $('end').className = 'screen ' + (win ? 'win' : 'lose');
  $('endKicker').textContent = win ? '任務完成' : `倒在第 ${S.wave + 1} 波`;
  $('endTitle').textContent = win ? '七期守住了' : '防線失守';
  $('endText').textContent = win ? STORY.win : '你倒下了,但抵抗不會停止。重新整備,再把防線奪回來。';
  $('stKills').textContent = S.kills; $('stHead').textContent = S.heads;
  $('stAcc').textContent = (S.shots ? Math.round(S.hits / S.shots * 100) : 0) + '%';
  $('stTime').textContent = Math.floor(S.time / 60) + ':' + String(Math.floor(S.time % 60)).padStart(2, '0');
}

function update(dt) {
  S.time += dt;
  updatePlayer(dt);
  if ((S.flowT -= dt) <= 0) { S.flowT = 0.35; flowField(grid, cellIx(P.pos.x), cellIx(P.pos.z), flow); }
  updateWeapons(dt);
  updateGrenades(dt);
  let alive = 0;
  for (let i = enemies.length - 1; i >= 0; i--) { const e = enemies[i]; updateEnemy(e, dt); if (e.gone) enemies.splice(i, 1); else if (e.alive) alive++; }
  // 敵人彼此不重疊
  for (let i = 0; i < enemies.length; i++) { const a = enemies[i]; if (!a.alive || a.drone) continue;
    for (let j = i + 1; j < enemies.length; j++) { const b = enemies[j]; if (!b.alive || b.drone) continue;
      const dx = b.group.position.x - a.group.position.x, dz = b.group.position.z - a.group.position.z, d = Math.hypot(dx, dz);
      if (d < 0.9 && d > 1e-4) { const k = (0.9 - d) / d * 0.5; a.group.position.x -= dx * k; a.group.position.z -= dz * k; b.group.position.x += dx * k; b.group.position.z += dz * k; } } }
  S.alive = alive;
  if (S.mode !== 'playing') return;
  updatePickups(dt); updateWaves(dt); updateHud(dt);
}

let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (S.mode === 'playing') update(dt);
  else if (S.mode === 'menu') { const t = now / 1000 * 0.06; camera.position.set(Math.sin(t) * 95, 38, 20 + Math.cos(t) * 95); camera.lookAt(0, 14, -10); }
  if (S.mode !== 'paused') updateFx(dt);
  updateSmoke(now / 1000);
  sky.position.copy(camera.position);
  renderer.render(scene, camera);
}

// ============================================================ 輸入
addEventListener('keydown', (e) => {
  if (S.mode !== 'playing') return;
  if (['Space', 'Tab', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
  if (e.repeat) return;
  if (e.code === 'Escape' && !document.pointerLockElement) { setMode('paused'); firing = false; keys.clear(); return; }
  keys.add(e.code);
  if (e.code === 'KeyR') startReload();
  else if (e.code === 'Digit1') switchWeapon(0);
  else if (e.code === 'Digit2') switchWeapon(1);
  else if (e.code === 'KeyG') throwGrenade();
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => { keys.clear(); firing = false; });
addEventListener('mousemove', (e) => {
  if (S.mode !== 'playing') return; // 沒鎖定時也能轉視角(保底)
  const ex = e.clientX / innerWidth; edgeTurn = document.pointerLockElement ? 0 : ex < 0.12 ? -(1 - ex / 0.12) : ex > 0.88 ? (ex - 0.88) / 0.12 : 0;
  const s = 0.0022 * (P.ads ? 0.55 : 1);
  P.yaw -= e.movementX * s; P.pitch = Math.max(-1.5, Math.min(1.5, P.pitch - e.movementY * s));
});
addEventListener('mousedown', (e) => {
  if (S.mode !== 'playing') return;
  if (!NOLOCK && !lockFailed && document.pointerLockElement !== renderer.domElement) lock(); // 順手重試鎖定,但不吃掉這次點擊
  if (e.button === 0) { firing = true; fireLatch = false; fireQueued = true; } else if (e.button === 2) P.ads = true;
});
addEventListener('mouseup', (e) => { if (e.button === 0) firing = false; else if (e.button === 2) P.ads = false; });
addEventListener('contextmenu', (e) => e.preventDefault());
let wheelT = 0;
addEventListener('wheel', () => { const t = performance.now(); if (S.mode === 'playing' && t - wheelT > 300) { wheelT = t; switchWeapon(1 - P.wi); } }, { passive: true });
document.addEventListener('pointerlockerror', () => { if (!lockFailed) { lockFailed = true; tip('此環境無法鎖定滑鼠 — 建議改用 Chrome 開啟'); } });
document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement) lockFailed = false;
  const locked = document.pointerLockElement === renderer.domElement;
  if (!locked && S.mode === 'playing' && !NOLOCK) { setMode('paused'); firing = false; keys.clear(); }
  else if (locked && S.mode === 'paused') { setMode('playing'); last = performance.now(); }
});
document.addEventListener('visibilitychange', () => { if (document.hidden && S.mode === 'playing' && !NOLOCK) { if (document.pointerLockElement) document.exitPointerLock(); else setMode('paused'); } });
$('btnStart').addEventListener('click', startGame);
$('btnRestart').addEventListener('click', startGame);
$('btnResume').addEventListener('click', () => { if (NOLOCK || lockFailed) { setMode('playing'); last = performance.now(); } else lock(); });

setMode('menu');
requestAnimationFrame(frame);

// 測試/除錯掛勾:step 可在分頁於背景(rAF 被節流)時手動推進模擬
window.__game = { S, P, W: () => W, enemies, pickups, MAP, startGame, spawnEnemy, damageEnemy, fire, throwGrenade, keys,
  setFiring: (v) => { firing = v; fireLatch = false; },
  step(n = 1, dt = 1 / 60) { for (let i = 0; i < n && S.mode === 'playing'; i++) { update(dt); updateFx(dt); } sky.position.copy(camera.position); renderer.render(scene, camera); } };
