// Every tunable number lives here. Feel, pacing, and difficulty are matters of taste; these are provisional defaults.

export const PLAYER = {
  hp: 100,
  walk: 5.2, sprint: 8.2, crouch: 2.6, adsMul: 0.65,
  jump: 7.2, gravity: 22,
  eye: 1.65, eyeCrouch: 1.0, radius: 0.4,
  regenDelay: 6, regenRate: 4, regenCap: 50, // regenerates slowly after 6 s out of combat, up to 50
  grenades: 3, maxGrenades: 4,
};

export const WEAPONS = [
  { id: 't91', name: 'T91 Rifle', mag: 30, reserve: 180, maxReserve: 300, auto: true,
    interval: 0.085, dmg: 27, head: 2.4, spread: 0.011, recoil: 0.012, reload: 2.0, range: 300 },
  { id: 't75', name: 'T75 Pistol', mag: 15, reserve: Infinity, maxReserve: Infinity, auto: false,
    interval: 0.16, dmg: 36, head: 2.2, spread: 0.008, recoil: 0.02, reload: 1.3, range: 120 },
  // price: bought in the shop instead of owned from the start. scope: full-screen scope overlay when aiming.
  { id: 't93', name: 'T93 Sniper', price: 2000, mag: 5, reserve: 20, maxReserve: 30, auto: false,
    interval: 1.25, dmg: 230, head: 2.5, spread: 0.035, adsSpread: 0, recoil: 0.045, reload: 2.8, range: 400, scope: true, zoomFov: 16 },
];

// Shop stock. Kill rewards are ENEMY_TYPES[].score plus RULES.headBonus for a headshot.
export const SHOP = [
  { id: 't93', type: 'weapon', weapon: 't93', name: 'T93 Sniper Rifle', desc: 'Bolt action, 5 rounds. One shot drops most infantry. Key 3.', price: 2000 },
  { id: 't93ammo', type: 'ammo', weapon: 't93', amount: 10, name: 'Sniper Ammo', desc: '+10 rounds for the T93.', price: 400 },
];

export const GRENADE = { fuse: 2.2, radius: 9, dmg: 170, selfMul: 0.4, throwSpeed: 17 };

export const ENEMY_TYPES = {
  rifle:   { name: 'Rifleman',       hp: 100, speed: 3.3, run: 1.6, range: 55, pref: 26, dmg: 6, acc: 0.42, react: 0.7, burst: 3, rof: 0.14, pause: 1.3, scale: 1,    color: 0x7f9662, score: 100 },
  assault: { name: 'Assault trooper',hp: 75,  speed: 5.6, run: 1.15, range: 30, pref: 9,  dmg: 5, acc: 0.50, react: 0.4, burst: 5, rof: 0.09, pause: 0.9, scale: 0.95, color: 0x6b8ba8, score: 120 },
  heavy:   { name: 'Heavy gunner',   hp: 340, speed: 2.1, run: 1.5, range: 60, pref: 30, dmg: 8, acc: 0.38, react: 1.0, burst: 9, rof: 0.10, pause: 1.8, scale: 1.25, color: 0x5d6452, score: 300 },
  drone:   { name: 'Kamikaze drone', hp: 35,  speed: 7.5, dive: 14, range: 32, dmg: 38, scale: 1, color: 0x25272b, score: 150 },
};

export const RULES = {
  maxAlive: 14, spawnGap: 0.9, intermission: 14, firstDelay: 5,
  dropAmmo: 0.3, dropMed: 0.10,
  ammoPickup: 30, medPickup: 25,
  supplyAmmo: 180, supplyHeal: 60, supplyGrenades: 2, supplySniper: 10,
  headBonus: 50,
};

// dirs: N = Taiwan Blvd, E = Wenxin Rd, W = Huilai Rd, S = Shizheng S 1st Rd
export const WAVES = [
  { name: 'Airborne Vanguard', dirs: ['N'], units: { rifle: 8 },
    radio: 'An enemy airborne vanguard has landed on Taiwan Boulevard and is pushing through City Hall toward you. Hold the park. No falling back!' },
  { name: 'Flank Contact', dirs: ['E', 'W'], units: { rifle: 10, assault: 4 },
    radio: 'Movement on both sides: one squad each on Wenxin Road and Huilai Road. Their assault troopers will rush you, so watch your flanks.' },
  { name: 'Drone Swarm', dirs: ['S', 'N'], units: { drone: 7, rifle: 8 },
    radio: 'Kamikaze drones inbound from the theater! When you hear the buzz, look up and shoot. Do not let one reach you.' },
  { name: 'Heavy Squad', dirs: ['N', 'E'], units: { heavy: 3, rifle: 10, assault: 4 },
    radio: 'Enemy heavy gunners are moving up, and they can take a lot of hits. Aim for the head, or give them a grenade.' },
  { name: 'Encirclement', dirs: ['N', 'E', 'W', 'S'], units: { rifle: 14, assault: 6, drone: 6, heavy: 2 },
    radio: 'Hostiles on all four sides. They are trying to seal off the whole district. Reinforcements have left Chenggong Ling. Hold on a little longer!' },
  { name: 'Last Line', dirs: ['N', 'E', 'W', 'S'], units: { rifle: 18, assault: 8, drone: 8, heavy: 4 },
    radio: 'This is their last main push. Reinforcements arrive in five minutes. Taichung is counting on you, brother.' },
];

export const STORY = {
  intro: 'This is the command post. Enemy airborne troops are massing on Taiwan Boulevard, and their target is the civic center. You are the only rifleman on this line.',
  supply: 'Wave repelled. A supply crate is behind the sandbags at the command post. Grab it fast; the next wave is close.',
  win: 'Reinforcements have arrived! The enemy airborne force has broken. The block holds.',
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
