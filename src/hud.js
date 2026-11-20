// HUD updates (dirty-checked DOM writes) and throttled 20 FPS minimap rendering.
import { WAVES } from './config.js';
import { sfx } from './audio.js';

const $ = (id) => document.getElementById(id);

export function createHud() {
  const el = {
    hpbar: $('hpbar'), hpfill: $('hpbar').firstElementChild, hpnum: $('hpnum'),
    ammo: $('ammo'), wname: $('wname'), gren: $('gren'), money: $('money'),
    scope: $('scope'), wave: $('wave'), left: $('left'), banner: $('banner'),
    radio: $('radio'), rtext: $('radiotext'), hit: $('hit'), vign: $('vign'),
    dmg: $('dmgdir'), cross: $('cross'), feed: $('feed'), tip: $('tip'),
  };
  const mapCtx = $('map').getContext('2d');
  let bannerT = 0, radioT = 0, hitT = 0, vignT = 0, dmgT = 0, dmgAng = 0, tipT = 0, mapT = 0;

  // Cached values to avoid redundant DOM writes every frame
  const prev = { hp: -1, wname: '', ammoKey: '', gren: -1, money: -1, wave: '', left: '', crossOp: -1, scope: false };

  function banner(big, small, dur = 3.2) {
    el.banner.firstElementChild.textContent = big;
    el.banner.lastElementChild.textContent = small;
    el.banner.style.opacity = 1;
    bannerT = dur;
  }
  function radio(text, dur = 7) { el.rtext.textContent = text; el.radio.style.opacity = 1; radioT = dur; sfx.radio(); }
  function tip(text) { el.tip.textContent = text; el.tip.style.opacity = 1; tipT = 1.6; }
  function feed(text, hs) {
    const d = document.createElement('div'); d.textContent = text; if (hs) d.className = 'hs';
    el.feed.prepend(d); setTimeout(() => d.remove(), 2700);
    while (el.feed.children.length > 5) el.feed.lastChild.remove();
  }
  function hitMarker(head) { el.hit.className = head ? 'head' : ''; hitT = 0.16; head ? sfx.head() : sfx.hit(); }
  function setHurt(vign, ang) {
    vignT = Math.max(vignT, vign);
    if (ang !== undefined) { dmgAng = ang; dmgT = 1; }
  }
  function setScope(on) {
    if (prev.scope === on) return;
    prev.scope = on;
    el.scope.style.display = on ? 'block' : 'none';
    el.cross.style.visibility = on ? 'hidden' : 'visible';
  }
  function reset() {
    prev.hp = -1; prev.wname = ''; prev.ammoKey = ''; prev.gren = -1; prev.money = -1;
    prev.wave = ''; prev.left = ''; prev.crossOp = -1; mapT = 1;
    setScope(false);
  }

  function drawMap(P, MAP, enemies, pickups) {
    const c = mapCtx, Wd = 340, h = Wd / 2, s = h / 75, cy = Math.cos(P.yaw), sy = Math.sin(P.yaw);
    c.clearRect(0, 0, Wd, Wd); c.save(); c.beginPath(); c.arc(h, h, h - 2, 0, 7); c.clip();
    c.fillStyle = 'rgba(10,14,18,.7)'; c.fillRect(0, 0, Wd, Wd);
    c.translate(h, h); c.rotate(P.yaw); c.scale(s, s); c.translate(-P.pos.x, -P.pos.z);
    c.fillStyle = 'rgba(160,170,180,.5)';
    for (const b of MAP.buildings) {
      if (Math.abs(b.x - P.pos.x) > 150 || Math.abs(b.z - P.pos.z) > 150) continue;
      c.fillRect(b.x - b.w / 2, b.z - b.d / 2, b.w, b.d);
    }
    c.restore();
    const dot = (wx, wz, color, r) => {
      const dx = wx - P.pos.x, dz = wz - P.pos.z;
      let x = (dx * cy - dz * sy) * s, y = (dx * sy + dz * cy) * s;
      const l = Math.hypot(x, y), m = h - 9;
      if (l > m) { x *= m / l; y *= m / l; }
      c.fillStyle = color; c.beginPath(); c.arc(h + x, h + y, r, 0, 7); c.fill();
    };
    for (const p of pickups) dot(p.mesh.position.x, p.mesh.position.z, p.type === 'supply' ? '#ffb347' : p.type === 'med' ? '#fff' : '#9fd36a', p.type === 'supply' ? 7 : 4);
    for (const e of enemies) if (e.alive) dot(e.group.position.x, e.group.position.z, e.drone ? '#ff9a3c' : '#ff4a3a', e.drone ? 4 : 5);
    c.fillStyle = '#e9e4d8'; c.beginPath(); c.moveTo(h, h - 11); c.lineTo(h + 7, h + 8); c.lineTo(h, h + 4); c.lineTo(h - 7, h + 8); c.fill();
  }

  function update(dt, { S, P, W, enemies, pickups, MAP }) {
    const w = W[P.wi], hp = Math.max(0, Math.ceil(P.hp));
    if (hp !== prev.hp) {
      prev.hp = hp;
      el.hpfill.style.width = hp + '%';
      el.hpnum.textContent = hp;
      el.hpbar.classList.toggle('low', hp <= 30);
    }
    const wname = w.reloadT > 0 ? w.def.name + ' — RELOADING' : w.def.name;
    if (wname !== prev.wname) { prev.wname = wname; el.wname.textContent = wname; }

    const ammoKey = w.mag + '/' + w.reserve;
    if (ammoKey !== prev.ammoKey) {
      prev.ammoKey = ammoKey;
      el.ammo.innerHTML = `<b>${w.mag}</b> / ${w.reserve === Infinity ? '∞' : w.reserve}`;
      el.ammo.classList.toggle('low', w.mag <= w.def.mag * 0.2);
    }
    if (P.grenades !== prev.gren) { prev.gren = P.grenades; el.gren.textContent = 'GRENADES × ' + P.grenades; }
    if (S.money !== prev.money) { prev.money = S.money; el.money.textContent = '$' + S.money.toLocaleString('en-US'); }

    const waveText = S.wave < 0 ? 'STAND BY' : `WAVE ${S.wave + 1} / ${WAVES.length}`;
    if (waveText !== prev.wave) { prev.wave = waveText; el.wave.textContent = waveText; }
    const leftText = S.interT > 0 ? `NEXT WAVE IN ${Math.ceil(S.interT)}s` : `HOSTILES ${S.alive + S.queue.length}`;
    if (leftText !== prev.left) { prev.left = leftText; el.left.textContent = leftText; }

    el.cross.style.setProperty('--gap', (P.ads ? 0 : 4 + P.bloom * 9 + Math.hypot(P.vel.x, P.vel.z) * 0.9) + 'px');
    const crossOp = w.reloadT > 0 ? 0.35 : 1;
    if (crossOp !== prev.crossOp) { prev.crossOp = crossOp; el.cross.style.opacity = crossOp; }

    if (bannerT > 0 && (bannerT -= dt) <= 0) el.banner.style.opacity = 0;
    if (radioT > 0 && (radioT -= dt) <= 0) el.radio.style.opacity = 0;
    if (tipT > 0 && (tipT -= dt) <= 0) el.tip.style.opacity = 0;
    hitT = Math.max(0, hitT - dt); el.hit.style.opacity = hitT > 0 ? 1 : 0;
    vignT = Math.max(0, vignT - dt); el.vign.style.opacity = Math.max(vignT, hp <= 30 ? 0.35 : 0);
    dmgT = Math.max(0, dmgT - dt); el.dmg.style.opacity = Math.min(1, dmgT * 2); el.dmg.style.transform = `rotate(${dmgAng}rad)`;

    // Throttle minimap canvas redraw to ~20 FPS
    if ((mapT += dt) >= 0.05) { mapT = 0; drawMap(P, MAP, enemies, pickups); }
  }

  return { el, banner, radio, tip, feed, hitMarker, setHurt, setScope, reset, update };
}
