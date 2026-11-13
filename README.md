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
| Space | Jump (you can get onto car roofs and sandbags) | 1 / 2 / 3 / 4 / wheel | M16 / Beretta 92 / M24 / Desert Eagle |
| G | Grenade | B | Armory (shop) |
| Esc | Pause (resume or return to the main menu) | | |

On Windows and Linux, Ctrl+W closes the browser tab and a page cannot block it, so use C to crouch while moving forward there.

## What is in the game

- **Map**: Taichung City Hall, the National Taichung Theater, Maple Garden, the central park, and the surrounding boulevards, with abandoned cars, barriers, and sandbags as cover.
- **Weapons**: M16 rifle, Beretta 92 pistol (unlimited reserve ammo as a fallback), grenades, and two weapons you buy in the armory: an M24 sniper rifle with a scope and a Desert Eagle.
- **Money**: every kill pays a reward, with a bonus for headshots. Press B at any time and anywhere to open the armory, which pauses the fight. It sells the sniper rifle, the Desert Eagle, ammo for both, grenades, and medkits.
- **Enemies**: riflemen, assault troops, heavy machine gunners, and kamikaze drones. There are 120 across the six waves. The soldiers are one rigged, animated model (run, aim, death) carrying an M16, tinted and scaled per type.
- **Between waves**: a supply crate appears at the command post with ammo, health, and grenades.
- **Art and audio**: low-poly scenery with canvas-generated textures, GLB weapon models held by box-built arms in first person, and sound synthesized with Web Audio.

## Files

| File | Contents |
|---|---|
| `src/config.js` | **Every tunable number**: player, weapons, shop stock and prices, enemies and kill rewards, waves, drops, radio lines |
| `src/map.js` | Map data: roads, blocks, landmarks, cover, spawn points (fixed random seed) |
| `src/core.js` | Pure logic: ray casting, collision, flow-field pathfinding |
| `src/main.js` | three.js scene, player, weapons, enemy AI, HUD, audio |
| `index.html` | Menus, HUD, styles |
| `assets/models/` | Weapon models and the rigged soldier (GLB). The game falls back to box placeholders if a file is missing |
| `tools/viewer.html` | Dev page that shows models side by side with axes, and can pose a rigged model at any moment of a clip: `http://localhost:5273/tools/viewer.html?m=soldier,soldier&anim=1&t=0,0.5&lock=1` |
| `vendor/` | three.js r160 and its GLTF loader |
| `scripts/stamp.mjs` | Writes content-hash versions for every module into `index.html` (cache busting) |
| `tests/core.test.mjs` | Unit tests, run with `npm test` |
| `docs/decisions/` | Design decisions and tunable items |

## Tests

```bash
npm test
```

The nine tests have no dependencies; they were run on Node.js 22. They cover ray casting, cover occlusion, collision, spawn-point validity, reachability, wave data, shop data, the version stamp in `index.html`, and a walking simulation that sends a soldier from every spawn point to 60 player positions with collision enabled.

## Releasing a change

After editing anything in `src/`, `vendor/`, or `assets/`, run:

```bash
npm run stamp
```

This rewrites the import map in `index.html` so each module URL carries a hash of its content, and updates the build id shown on the menu. Players then get the new files on a normal reload, with no hard refresh and no mix of old and new modules. `npm test` fails if you forget. GitHub Pages still caches `index.html` itself for about 10 minutes, so an open tab may take that long to see a release.

## Tuning checklist

1. Change values only in `src/config.js`, then reload the page. Run `npm run stamp` before committing.
2. After editing the map (`map.js`), always run `npm test`. It checks that no start or spawn point sits inside an obstacle and that every spawn point can reach the player.
3. To fast-forward while testing, open `http://localhost:5273/?nolock=1` and use the console:
   - `__game.startGame(); __game.step(600)` advances the simulation by 10 seconds.
   - `__game.spawnEnemy({type:'heavy',dir:'N'})` spawns an enemy.
   - `__game.S` shows the game state.
4. To add an enemy type, add an entry to `ENEMY_TYPES` and use it in `WAVES[].units`. Its appearance is built in `spawnEnemy` in `main.js`.
5. To swap or add a weapon model, put the GLB in `assets/models/` and edit the `VIEW` table in `main.js` (file name, real length, which way the barrel points, barrel height). Check it first in `tools/viewer.html`. The hands are placed per weapon in the `ARMS` table (hand and elbow points).
6. To replace the soldier, put a rigged GLB with a Mixamo skeleton in `assets/models/` and edit the `SOLDIER` table in `main.js`: which clip index is run, aim, and death, the standing height, the tint per enemy type, and how the rifle sits in the right hand.
7. To sell a new weapon, add it to `WEAPONS` with a `price` and add a matching entry to `SHOP`. Its view model and sound are in `main.js`.
8. To add a wave, add an entry to `WAVES`. `dirs` accepts N, E, W, and S. No code changes are needed.

## Known limitations

- Desktop keyboard and mouse only; there are no touch controls.
- The map boundary is an invisible wall.
- Enemies do not crouch, take cover, or throw grenades.
