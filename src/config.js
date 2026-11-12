// 所有可調數值集中於此。手感、節奏、難度屬於品味判斷,初版數值皆為暫定預設。

export const PLAYER = {
  hp: 100,
  walk: 5.2, sprint: 8.2, crouch: 2.6, adsMul: 0.65,
  jump: 7.2, gravity: 22,
  eye: 1.65, eyeCrouch: 1.0, radius: 0.4,
  regenDelay: 6, regenRate: 4, regenCap: 50, // 脫戰 6 秒後緩慢回復,最多回到 50
  grenades: 3, maxGrenades: 4,
};

export const WEAPONS = [
  { id: 't91', name: 'T91 步槍', mag: 30, reserve: 180, maxReserve: 300, auto: true,
    interval: 0.085, dmg: 27, head: 2.4, spread: 0.011, recoil: 0.012, reload: 2.0, range: 300 },
  { id: 't75', name: 'T75 手槍', mag: 15, reserve: Infinity, maxReserve: Infinity, auto: false,
    interval: 0.16, dmg: 36, head: 2.2, spread: 0.008, recoil: 0.02, reload: 1.3, range: 120 },
];

export const GRENADE = { fuse: 2.2, radius: 9, dmg: 170, selfMul: 0.4, throwSpeed: 17 };

export const ENEMY_TYPES = {
  rifle:   { name: '步兵',       hp: 100, speed: 3.3, run: 1.6, range: 55, pref: 26, dmg: 6, acc: 0.42, react: 0.7, burst: 3, rof: 0.14, pause: 1.3, scale: 1,    color: 0x7f9662, score: 100 },
  assault: { name: '突擊兵',     hp: 75,  speed: 5.6, run: 1.15, range: 30, pref: 9,  dmg: 5, acc: 0.50, react: 0.4, burst: 5, rof: 0.09, pause: 0.9, scale: 0.95, color: 0x6b8ba8, score: 120 },
  heavy:   { name: '重裝機槍手', hp: 340, speed: 2.1, run: 1.5, range: 60, pref: 30, dmg: 8, acc: 0.38, react: 1.0, burst: 9, rof: 0.10, pause: 1.8, scale: 1.25, color: 0x5d6452, score: 300 },
  drone:   { name: '自殺無人機', hp: 35,  speed: 7.5, dive: 14, range: 32, dmg: 38, scale: 1, color: 0x25272b, score: 150 },
};

export const RULES = {
  maxAlive: 14, spawnGap: 0.9, intermission: 14, firstDelay: 5,
  dropAmmo: 0.3, dropMed: 0.10,
  ammoPickup: 30, medPickup: 25,
  supplyAmmo: 180, supplyHeal: 60, supplyGrenades: 2,
};

// dirs:N=台灣大道、E=文心路、W=惠來路、S=市政南一路
export const WAVES = [
  { name: '空降先遣', dirs: ['N'], units: { rifle: 8 },
    radio: '敵空降先遣班已落在台灣大道,正穿過市政府朝你推進。守住夏綠地,不准後退!' },
  { name: '市政路接戰', dirs: ['E', 'W'], units: { rifle: 10, assault: 4 },
    radio: '東西兩側都有動靜——文心路、惠來路各一個班。突擊兵會貼臉衝過來,注意側翼。' },
  { name: '無人機群', dirs: ['S', 'N'], units: { drone: 7, rifle: 8 },
    radio: '偵測到自殺無人機從歌劇院方向接近!聽到嗡嗡聲就抬頭打,別讓它撞上你。' },
  { name: '重裝班', dirs: ['N', 'E'], units: { heavy: 3, rifle: 10, assault: 4 },
    radio: '敵軍重裝機槍手上來了,皮很厚。瞄頭,或者賞他一顆手榴彈。' },
  { name: '合圍', dirs: ['N', 'E', 'W', 'S'], units: { rifle: 14, assault: 6, drone: 6, heavy: 2 },
    radio: '四面都是敵人,他們想把七期整個包起來。援軍已從成功嶺出發,再撐一下!' },
  { name: '最後防線', dirs: ['N', 'E', 'W', 'S'], units: { rifle: 18, assault: 8, drone: 8, heavy: 4 },
    radio: '這是他們最後一波主力。援軍五分鐘內抵達——弟兄,台中就靠你了。' },
];

export const STORY = {
  intro: '這裡是七期指揮所。敵空降部隊正在台灣大道集結,目標是癱瘓市政中心。你是這條防線唯一的步槍手。',
  supply: '這波打退了。補給箱已放在指揮所沙包後面,快去拿,下一波馬上到。',
  win: '援軍抵達!敵空降部隊已潰散——七期守住了。',
};

export function expandWave(wave, rng = Math.random) {
  const list = [];
  for (const [type, n] of Object.entries(wave.units)) {
    for (let i = 0; i < n; i++) list.push({ type, dir: wave.dirs[Math.floor(rng() * wave.dirs.length)] });
  }
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}
