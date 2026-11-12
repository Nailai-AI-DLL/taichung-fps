# The Last Block

A single-player first-person shooter that runs in the browser. Fictional setting: PLA airborne troops have landed in Taichung, Taiwan. You are a reserve infantryman holding a sandbag command post in the city's 7th Redevelopment Zone, and you have to survive six waves until reinforcements arrive.

> This is a work of military fiction. All characters and events are fictional. The map is a stylized layout, not a survey of the real district.

## Run

```bash
python3 -m http.server 5273
```

Run the command from the project root, then open <http://localhost:5273> in desktop Chrome or Safari. The page has to be served over HTTP; opening `index.html` directly is blocked by the browser's ES module rules.

There is no build step and no install. three.js r160 is vendored in `vendor/`.

Embedded browsers that do not support Pointer Lock fall back to a reduced control scheme: moving the cursor turns the view, and holding it near the left or right edge keeps turning.

## Controls

| Key | Action | Key | Action |
|---|---|---|---|
| W A S D | Move | Left mouse | Fire |
| Shift | Sprint | Right mouse | Aim down sights |
| Ctrl or C (hold) | Crouch (enemies cannot hit you behind sandbags) | R | Reload |
| Space | Jump (you can get onto car roofs and sandbags) | 1 / 2 / wheel | Rifle / pistol |
| G | Grenade | Esc | Pause |

On Windows and Linux, Ctrl+W closes the browser tab and a page cannot block it, so use C to crouch while moving forward there.

## What is in the game

- **Map**: Taichung City Hall, the National Taichung Theater, Maple Garden, the central park, and the surrounding boulevards, with abandoned cars, barriers, and sandbags as cover.
- **Weapons**: T91 rifle, T75 pistol (unlimited reserve ammo as a fallback), and grenades.
- **Enemies**: riflemen, assault troops, heavy machine gunners, and kamikaze drones. There are 120 across the six waves.
- **Between waves**: a supply crate appears at the command post with ammo, health, and grenades.
- **Art and audio**: low-poly models, canvas-generated textures, and sound synthesized with Web Audio. The game uses no external assets.

## Files

| File | Contents |
|---|---|
| `src/config.js` | **Every tunable number**: player, weapons, enemies, waves, drops, radio lines |
| `src/map.js` | Map data: roads, blocks, landmarks, cover, spawn points (fixed random seed) |
| `src/core.js` | Pure logic: ray casting, collision, flow-field pathfinding |
| `src/main.js` | three.js scene, player, weapons, enemy AI, HUD, audio |
| `index.html` | Menus, HUD, styles |
| `tests/core.test.mjs` | Unit tests, run with `npm test` |
| `docs/decisions/` | Design decisions and tunable items |

## Tests

```bash
npm test
```

The seven tests have no dependencies; they were run on Node.js 22. They cover ray casting, cover occlusion, collision, spawn-point validity, reachability, wave data, and a walking simulation that sends a soldier from every spawn point to 60 player positions with collision enabled.

## Tuning checklist

1. Change values only in `src/config.js`, then reload the page.
2. After editing the map (`map.js`), always run `npm test`. It checks that no start or spawn point sits inside an obstacle and that every spawn point can reach the player.
3. To fast-forward while testing, open `http://localhost:5273/?nolock=1` and use the console:
   - `__game.startGame(); __game.step(600)` advances the simulation by 10 seconds.
   - `__game.spawnEnemy({type:'heavy',dir:'N'})` spawns an enemy.
   - `__game.S` shows the game state.
4. To add an enemy type, add an entry to `ENEMY_TYPES` and use it in `WAVES[].units`. Its appearance is built in `spawnEnemy` in `main.js`.
5. To add a wave, add an entry to `WAVES`. `dirs` accepts N, E, W, and S. No code changes are needed.

## Known limitations

- Desktop keyboard and mouse only; there are no touch controls.
- The map boundary is an invisible wall.
- Enemies only stand; they do not take cover or throw grenades.
