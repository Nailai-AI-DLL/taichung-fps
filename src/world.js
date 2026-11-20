// three.js scene setup, procedural world geometry/textures, and pooled tracer/flash effects.
import * as THREE from '../vendor/three.module.min.js';

const rand = Math.random;

export const G1 = new THREE.BoxGeometry(1, 1, 1);
const matCache = new Map();
export const lam = (color) => {
  let m = matCache.get(color);
  if (!m) matCache.set(color, m = new THREE.MeshLambertMaterial({ color }));
  return m;
};
export function box(parent, mat, sx, sy, sz, x, y, z) {
  const m = new THREE.Mesh(G1, mat);
  m.scale.set(sx, sy, sz);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}
export const assetUrl = (p) => './' + p + (window.ASSET_V && window.ASSET_V[p] ? '?v=' + window.ASSET_V[p] : '');

export const cv = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
export function canvasTex(c, repeat) {
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; }
  return t;
}
function radialTex() {
  const c = cv(64, 64), x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.4, 'rgba(255,255,255,.55)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c);
}
export const glowTex = radialTex();

export function createScene(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x7d6a68, 50, 430);
  const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.05, 1600);
  camera.rotation.order = 'YXZ';
  scene.add(camera);
  addEventListener('resize', () => {
    renderer.setSize(innerWidth, innerHeight);
    camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  });

  // Dusk sky (horizon colour matches the fog)
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    vertexShader: 'varying vec3 v;void main(){v=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader: `varying vec3 v;void main(){float h=clamp(v.y,0.,1.);
      vec3 hor=vec3(.49,.416,.408),top=vec3(.09,.12,.21),glow=vec3(.95,.5,.25);
      float sun=pow(max(dot(normalize(v),normalize(vec3(-.8,.1,.35))),0.),5.);
      vec3 c=mix(hor,top,pow(h,.42))+glow*sun*.75*(1.-h);gl_FragColor=vec4(c,1.);}`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1200, 24, 12), skyMat);
  scene.add(sky);

  // Bake a procedural dusk environment map so metallic PBR weapon materials catch sunset reflections
  try {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    const envGeo = new THREE.SphereGeometry(10, 16, 8);
    envScene.add(new THREE.Mesh(envGeo, skyMat));
    scene.environment = pmrem.fromScene(envScene, 0.04).texture;
    envGeo.dispose(); pmrem.dispose();
  } catch {}

  scene.add(new THREE.HemisphereLight(0xa9b6d6, 0x4a3d34, 2.1));
  const sun = new THREE.DirectionalLight(0xffb27a, 2.4);
  sun.position.set(-80, 50, 35);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -55; sun.shadow.camera.right = 55;
  sun.shadow.camera.top = 55; sun.shadow.camera.bottom = -55;
  sun.shadow.camera.near = 10; sun.shadow.camera.far = 220;
  sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.04;
  scene.add(sun, sun.target);

  function updateSun(px, pz) {
    // Snap shadow frustum center to 0.5 m steps to minimize shadow shimmer while moving
    const sx = Math.round(px * 2) / 2, sz = Math.round(pz * 2) / 2;
    sun.target.position.set(sx, 0, sz);
    sun.position.set(sx - 80, 50, sz + 35);
  }
  return { renderer, scene, camera, sky, updateSun };
}

// Facades: one tile = 16 m wide x 14 m tall (4x4 windows); wartime blackout, so few are lit
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
  if (style === 'opera') { // Theater: curved glass openings in a white wall
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
// Scale UVs by the real wall size so every building of a style shares one material
function facadeBox(w, h, d) {
  const g = new THREE.BoxGeometry(w, h, d), uv = g.attributes.uv;
  for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) {
    const k = f * 4 + i;
    if (f === 2 || f === 3) uv.setXY(k, 0.004, 0.004); // roof samples the base colour
    else uv.setXY(k, uv.getX(k) * (f < 2 ? d : w) / 16, uv.getY(k) * h / 14);
  }
  return g;
}

export function buildWorld(scene, MAP) {
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(2600, 2600), lam(0x2b2c2f));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
  for (const b of MAP.blocks) {
    const m = box(scene, lam(b.green ? 0x3f5c36 : 0x6d6964), b.x1 - b.x0, 0.06, b.z1 - b.z0, (b.x0 + b.x1) / 2, 0.03, (b.z0 + b.z1) / 2);
    m.receiveShadow = true;
  }

  // Lane markings
  const dashGeo = new THREE.PlaneGeometry(3, 0.22); dashGeo.rotateX(-Math.PI / 2);
  const dashes = new THREE.InstancedMesh(dashGeo, new THREE.MeshBasicMaterial({ color: 0xcfc8a8 }), MAP.roads.length * 52);
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), Qz = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2), V = new THREE.Vector3(), S1 = new THREE.Vector3(1, 1, 1);
  let n = 0;
  for (const r of MAP.roads) for (let t = -204; t < 204; t += 8) {
    const off = r.name === 'Taiwan Blvd' ? 8 : 0; // the boulevard has a median, so the line sits to one side
    V.set(r.axis === 'x' ? t : r.c + off, 0.02, r.axis === 'x' ? r.c + off : t);
    M.compose(V, r.axis === 'x' ? Q : Qz, S1); dashes.setMatrixAt(n++, M);
  }
  dashes.count = n; scene.add(dashes);
  box(scene, lam(0x4d5a42), 400, 0.12, 3, 0, 0.06, -125); // median

  // Buildings
  const fm = {}; for (const s of Object.keys(FACADE)) fm[s] = facadeMat(s);
  for (const b of MAP.buildings) {
    const m = new THREE.Mesh(facadeBox(b.w, b.h, b.d), fm[b.style]); m.position.set(b.x, b.h / 2, b.z);
    m.castShadow = true; m.receiveShadow = true; scene.add(m);
  }
  for (const d of MAP.decos) {
    if (d.type === 'beam') { const m = new THREE.Mesh(facadeBox(d.w, d.h, d.d), fm.gov); m.position.set(d.x, d.y, d.z); scene.add(m); }
    if (d.type === 'pond') { const m = new THREE.Mesh(new THREE.CircleGeometry(d.r, 40), lam(0x2d4c5e)); m.rotation.x = -Math.PI / 2; m.scale.x = 1.5; m.position.set(d.x, 0.08, d.z); scene.add(m); }
  }
  // Distant skyline (silhouettes only, no collision)
  const far = lam(0x3b414b);
  for (let i = 0; i < 90; i++) {
    const a = rand() * Math.PI * 2, r = 250 + rand() * 260, x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (Math.max(Math.abs(x), Math.abs(z)) < 232) continue;
    const h = 30 + rand() * 130, w = 22 + rand() * 30;
    box(scene, far, w, h, w * (0.7 + rand() * 0.6), x, h / 2, z);
  }

  // Landmark signs
  for (const l of MAP.labels) {
    const px = 96, font = `900 ${px}px system-ui,"Helvetica Neue",Arial,sans-serif`, mc = cv(8, 8).getContext('2d'); mc.font = font;
    const c = cv(Math.ceil(mc.measureText(l.text).width) + 70, px + 36), x = c.getContext('2d');
    x.font = font; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillStyle = 'rgba(11,14,18,.55)'; x.fillRect(0, 0, c.width, c.height);
    x.fillStyle = '#f1ead8'; x.fillText(l.text, c.width / 2, c.height / 2 + 4);
    const h = l.size * 1.35, m = new THREE.Mesh(new THREE.PlaneGeometry(h * c.width / c.height, h), new THREE.MeshBasicMaterial({ map: canvasTex(c), transparent: true }));
    m.position.set(l.x, l.y, l.z); m.rotation.y = l.ry; scene.add(m);
  }

  // Cover
  const glass = lam(0x161b22), tire = lam(0x1a1a1a);
  const sbox = (mat, sx, sy, sz, x, y, z) => { const m = box(scene, mat, sx, sy, sz, x, y, z); m.castShadow = true; m.receiveShadow = true; return m; };
  for (const p of MAP.props) {
    if (p.type === 'car') {
      const alongX = p.w > p.d;
      sbox(lam(p.color), p.w, p.h * 0.5, p.d, p.x, 0.22 + p.h * 0.25, p.z);
      sbox(glass, alongX ? p.w * 0.55 : p.w * 0.9, p.h * 0.36, alongX ? p.d * 0.9 : p.d * 0.55, p.x, p.h * 0.5 + 0.22 + p.h * 0.18, p.z);
      box(scene, tire, alongX ? p.w * 0.78 : p.w * 1.02, 0.5, alongX ? p.d * 1.02 : p.d * 0.78, p.x, 0.25, p.z);
    } else if (p.type === 'bus') {
      const alongX = p.w > p.d;
      sbox(lam(p.color), p.w, p.h - 0.3, p.d, p.x, 0.3 + (p.h - 0.3) / 2, p.z);
      sbox(glass, alongX ? p.w * 0.94 : p.w * 1.02, 0.9, alongX ? p.d * 1.02 : p.d * 0.94, p.x, p.h * 0.66, p.z);
    } else {
      sbox(lam(p.color), p.w, p.h, p.d, p.x, p.h / 2, p.z);
      if (p.type === 'sandbag') box(scene, lam(0x7a6a48), p.w * 0.96, 0.06, p.d * 0.96, p.x, p.h * 0.5, p.z).scale.multiplyScalar(1.04);
    }
  }

  // Trees (instanced)
  const T = MAP.trees, trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.16, 0.24, 2.6, 6), lam(0x4a3b2c), T.length);
  const crown = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1.9, 0), new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), T.length);
  trunk.castShadow = true; crown.castShadow = true; crown.receiveShadow = true;
  const col = new THREE.Color(), Sv = new THREE.Vector3(), Qr = new THREE.Quaternion();
  T.forEach((t, i) => {
    M.compose(V.set(t.x, 1.3 * t.s, t.z), Q, Sv.setScalar(t.s)); trunk.setMatrixAt(i, M);
    Qr.setFromAxisAngle(V.set(0, 1, 0), rand() * 6);
    M.compose(V.set(t.x, 3.6 * t.s, t.z), Qr, Sv.set(t.s, t.s * (0.85 + rand() * 0.4), t.s)); crown.setMatrixAt(i, M);
    col.setHex(t.red ? 0xa63a26 : 0x3f6a36).offsetHSL((rand() - 0.5) * 0.03, 0, (rand() - 0.5) * 0.08); crown.setColorAt(i, col);
  });
  scene.add(trunk, crown);

  // Command post flagpole
  const fc = cv(180, 120), fx = fc.getContext('2d');
  fx.fillStyle = '#d0202a'; fx.fillRect(0, 0, 180, 120); fx.fillStyle = '#10237a'; fx.fillRect(0, 0, 90, 60);
  fx.fillStyle = '#fff'; fx.translate(45, 30);
  for (let i = 0; i < 12; i++) { fx.rotate(Math.PI / 6); fx.beginPath(); fx.moveTo(-4.2, -13); fx.lineTo(0, -24); fx.lineTo(4.2, -13); fx.fill(); }
  fx.beginPath(); fx.arc(0, 0, 11, 0, 7); fx.fill(); fx.strokeStyle = '#10237a'; fx.lineWidth = 2; fx.stroke();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 7, 6), lam(0xb8b8b8)); pole.position.set(7.5, 3.5, 26); scene.add(pole);
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.6), new THREE.MeshBasicMaterial({ map: canvasTex(fc), side: THREE.DoubleSide }));
  flag.position.set(8.75, 6.1, 26); scene.add(flag);

  // Distant smoke columns
  const smokes = [];
  for (const [x, z] of [[-240, -250], [270, -110], [130, 300], [-310, 150], [40, -330], [-150, 320]]) {
    const fire = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xff7a2a, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, opacity: 0.8 }));
    fire.position.set(x, 14, z); fire.scale.setScalar(60); scene.add(fire);
    for (let i = 0; i < 7; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0x0f0f10, transparent: true, depthWrite: false, fog: false }));
      scene.add(s); smokes.push({ s, x, z, o: i / 7, sp: 0.035 + rand() * 0.01 });
    }
  }
  return {
    updateSmoke(t) {
      for (const k of smokes) {
        const u = (t * k.sp + k.o) % 1;
        k.s.position.set(k.x + u * 70, 18 + u * 190, k.z + u * 25);
        k.s.scale.setScalar(50 + u * 130); k.s.material.opacity = 0.5 * Math.sin(u * Math.PI);
      }
    },
  };
}

export function createFxPool(scene) {
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
  function clearFx() {
    for (const l of tracers) l.visible = false;
    for (const s of flashes) s.visible = false;
  }
  return { tracer, flash, updateFx, clearFx };
}
