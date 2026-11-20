// Armory (shop) UI and purchase logic.
import { PLAYER as PL, SHOP } from './config.js';
import { sfx } from './audio.js';

const $ = (id) => document.getElementById(id);
const SHOP_LABEL = { buy: 'BUY', owned: 'OWNED', locked: 'NEED THE WEAPON', full: 'FULL', poor: 'NOT ENOUGH' };

export function createShop({ S, P, getW, setMode, onPauseInput, onResume }) {
  function shopItems() {
    const W = getW();
    return SHOP.map((it) => {
      const w = W.find((x) => x.def.id === it.weapon);
      let state = 'buy';
      if (it.type === 'weapon') { if (w.owned) state = 'owned'; }
      else if (it.type === 'ammo') { if (!w.owned) state = 'locked'; else if (w.reserve >= w.def.maxReserve) state = 'full'; }
      else if (it.type === 'grenade') { if (P.grenades >= PL.maxGrenades) state = 'full'; }
      else if (it.type === 'med') { if (P.hp >= PL.hp) state = 'full'; }
      if (state === 'buy' && S.money < it.price) state = 'poor';
      return { it, w, state };
    });
  }

  function renderShop() {
    $('shopMoney').textContent = '$' + S.money.toLocaleString('en-US');
    $('shopList').innerHTML = shopItems()
      .map(({ it, state }) => `<div class="item ${state}"><div><b>${it.name}</b><span>${it.desc}</span></div><div class="price mono">$${it.price.toLocaleString('en-US')}</div><button data-id="${it.id}" ${state === 'buy' ? '' : 'disabled'}>${SHOP_LABEL[state]}</button></div>`)
      .join('');
  }

  function buy(id) {
    const r = shopItems().find((x) => x.it.id === id);
    if (!r || r.state !== 'buy') return false;
    S.money -= r.it.price;
    if (r.it.type === 'weapon') { r.w.owned = true; r.w.mag = r.w.def.mag; r.w.reserve = r.w.def.reserve; }
    else if (r.it.type === 'ammo') r.w.reserve = Math.min(r.w.def.maxReserve, r.w.reserve + r.it.amount);
    else if (r.it.type === 'grenade') P.grenades = Math.min(PL.maxGrenades, P.grenades + r.it.amount);
    else if (r.it.type === 'med') P.hp = Math.min(PL.hp, P.hp + r.it.amount);
    sfx.pick(); renderShop();
    return true;
  }

  function openShop() {
    if (S.mode !== 'playing') return;
    onPauseInput();
    setMode('shop');
    renderShop();
    if (document.pointerLockElement) document.exitPointerLock();
  }

  function closeShop() {
    if (S.mode !== 'shop') return;
    setMode('playing');
    onResume();
  }

  $('btnShopClose').addEventListener('click', closeShop);
  $('shopList').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-id]');
    if (b) buy(b.dataset.id);
  });

  return { buy, openShop, closeShop, renderShop };
}
