# 0001 The Last Block: initial design and technical decisions

Date: 2026-11-12
Status: first version complete; numbers and feel are provisional defaults

## Overview
A single-player first-person shooter for the browser. Fictional setting: enemy airborne troops break into Taichung, and the player holds the civic center in the 7th Redevelopment Zone through six waves.

## Design and technical decisions

| # | Decision | Reason | Rejected alternatives |
|---|----------|--------|-----------------------|
| 1 | three.js r160, vendored as a single file in `vendor/`, with no build step | Runs offline with `python3 -m http.server`; r160 is one of the last single-file ES module builds | Vite + npm: an extra toolchain with no benefit at this size. Babylon or PlayCanvas: larger |
| 2 | Single-player, six-wave defense of the command post in the park | One scene gives a complete arc; enemies arrive along four roads, so the whole map gets used | Linear levels: need several maps and scripting |
| 3 | Low-poly models with procedural textures (facades, signs, and the flag are drawn on canvas) and audio synthesized with Web Audio | No external assets means no licensing questions and no downloads | Realistic asset packs: licensing and size costs |
| 4 | The map is a stylized layout. Road names and landmarks (City Hall, the National Taichung Theater, Maple Garden, the park, Taiwan Blvd, Wenxin Rd, Huilai Rd, Henan Rd, Huizhong Rd, Shizheng Rd) are real, but positions, sizes, and building counts are arranged for gameplay | There is no survey data, so the game does not claim accuracy and says so on the menu | Modelling from OpenStreetMap data: possible, left for a later stage |
| 5 | The department store is labelled generically, with no real brand names or logos | Avoids trademark issues | None |
| 6 | Enemies path with a BFS flow field on a 2 m grid, recomputed from the player's position every 0.35 s. A cell is blocked if any obstacle, inflated by the unit radius, touches it | All enemies share one field, so cost does not grow with their number; a path through cell centres never clips an obstacle | A* per enemy; NavMesh (needs extra tooling). A 4 m grid with the same blocking rule seals the sandbag post into an island and enemies fall back to walking straight into walls |
| 7 | Collision and ray casting are hand-written AABB code in `core.js`, with no physics engine | The scene is all axis-aligned boxes, so this is the fastest and the easiest to test | cannon or rapier: far more than needed |
| 8 | Pure logic (`core.js`, `map.js`, `config.js`) does not depend on three.js or the DOM | It can be tested with `node --test` | Everything in `main.js`: untestable |
| 9 | Looking and firing do not depend on Pointer Lock. Without it, cursor movement and edge turning act as a fallback | Some embedded browsers do not support mouse lock, and the game should still be playable there | Requiring the lock |
| 10 | The enemy is described only as a military force, with no real people and no targeting of any ethnic group | The story is a fictional defense against an invading army | None |
| 11 | Kills pay money and an armory (key B) sells weapons. Opening it pauses the fight. The sniper rifle is the only weapon for sale so far, plus its ammo | Gives kills a second purpose and makes the sniper a goal to work toward | A buy phase only between waves: simpler to balance, but the player could not react to running dry mid-wave. Selling health and grenades too: left out until the economy has been play-tested |
| 12 | The sniper rifle uses a full-screen scope overlay, hides the view model while scoped, and is perfectly accurate only when scoped | Reads clearly as a sniper and keeps it weak from the hip | A magnified picture-in-picture scope: needs a second render pass |
| 13 | The pause screen offers Resume and Main Menu; returning to the menu discards the run | A run is short, so there is nothing worth saving | Confirm dialog before quitting: one more click for little benefit |

## Tunable items (all provisional, all in `src/config.js`)
1. **Difficulty**: standing still under fire from eight riflemen kills the player in about 10 seconds (measured).
2. **Pacing**: first contact in wave 1 takes about 25 seconds; 14 seconds between waves; 120 enemies across six waves.
3. **Ammo economy**: rifle reserve 180 with a cap of 300; enemies drop ammo 30% of the time; each resupply adds 180. The pistol has unlimited reserve ammo as a fallback.
4. **Feel**: recoil, spread, movement speed, and the aim-down-sights multiplier.
5. **Tone**: the menu story and radio lines (`WAVES[].radio` and `STORY` in `config.js`, plus the intro text in `index.html`).
6. **Title**: "The Last Block" is a working title.
7. **Economy**: rewards are 100 (rifleman), 120 (assault trooper), 300 (heavy gunner), and 150 (drone), plus 50 for a headshot. The sniper costs 2,000 and 10 rounds cost 400. A full clear of wave 1 pays 800 and waves 1 and 2 together pay 2,280 before headshot bonuses, so the sniper is affordable during wave 2.
8. **Sniper**: 230 damage (2.5x to the head), 5-round magazine, 1.25 s between shots, 20 reserve rounds with a cap of 30.

## Known limitations
- Desktop keyboard and mouse only; no touch controls. Chrome or Safari is recommended.
- The map boundary is an invisible wall.
- Enemies only stand; they do not take cover or throw grenades.
- Lit-window patterns repeat, because buildings of one style share a texture.

## Fixed issues

| Issue | Cause | Fix | Regression guard |
|---|---|---|---|
| Soldiers got stuck beside cars and the wave stalled | Only obstacles taller than 2 m were in the grid | All obstacles go into the grid, cells block conservatively, cell size reduced from 4 m to 2 m | Test 7 in `tests/core.test.mjs`: 60 player positions by 15 spawn points, walked with collision |
| Assault troopers stalled at barriers without firing | They closed in along a straight line while engaged | Closing in now follows the flow field | Same test |
| A supply crate was consumed even when everything was full | Missing cap check | Not picked up when ammo, health, and grenades are all full | None |
| A grenade thrown against a wall got stuck inside it | The release point could already be inside the wall | Released from the camera position when the path ahead is blocked | None |
| Grenades hurt targets through walls | The blast did not check occlusion | Added a ray check from the blast point to the target | None |
| No firing or looking in browsers without mouse lock | Input assumed the lock had succeeded | See decision 9; a click buffer was also added | None |

## Verification
- `npm test`: eight tests (ray casting, low-cover occlusion, collision, map points clear of obstacles, all spawn points reachable, valid wave data, walking simulation with collision, shop data).
- Browser run of the new features: kill rewards, opening the armory, a refused purchase when short of money, buying the sniper and its ammo, a scoped shot, and pause, resume, and return to the main menu with real key presses and clicks.
- Browser run (`?nolock=1` with `window.__game.step()`): menu, combat, death screen, restart, grenades and drones, and a full six-wave clear, with no console errors.
- Firing and looking were verified with real mouse events.
