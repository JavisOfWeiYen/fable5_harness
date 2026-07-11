# Apex Sprint Challenge

A complete, playable top-down open-wheel racing game built entirely with vanilla
HTML, CSS, JavaScript and the Canvas 2D API. No frameworks, no build step, no CDN,
no external image/font/audio assets. All teams, driver abbreviations and colours
are fictional.

---

## How to run

**Simplest — just open the file:**
Open `index.html` directly in a modern browser (Chrome/Edge/Firefox). Everything is
loaded with plain `<script src="...">` tags (not ES modules), so it works from
`file://` with no server and no build step.

**Fallback — local static server:**
If your browser restricts something under `file://` (some Firefox builds block
`Blob`-based downloads, for example), serve the folder statically:

```
python -m http.server 8000
# then open http://localhost:8000/index.html
```

You never need `npm install` or any bundler.

Open `tests.html` (directly or via the server) to run the test suite.

---

## Controls

| Key | Action |
|-----|--------|
| `W` / `↑` | Throttle |
| `S` / `↓` | Brake |
| `A` `D` / `←` `→` | Steer |
| `Shift` | Deploy ERS (extra power while charge remains) |
| `F` | DRS (only when eligible — see rules) |
| `P` | Pause / resume |
| `R` | Restart the race |
| `C` | Toggle chase camera / full-track camera |

While focus is inside an `<input>`, `<select>`, `<textarea>` or any
`contenteditable` element, these shortcuts are ignored (the game checks
`document.activeElement` / the event target first).

---

## Game modes

- **Start Race** — you drive car 1 (VMR); three AI cars fill the grid. 3 laps.
- **Demo Race** — all four cars, including yours, are AI-controlled. It runs the
  full start sequence, all three laps, and the real lap/checkpoint/ranking/
  tire/ERS/DRS/pit logic, then shows a real results screen. It is pausable and
  resettable. It is **not** scripted and does **not** teleport cars — it runs
  through the exact same `Race`/`Physics`/`AI` update functions as a normal race,
  just with AI input for all four cars.

---

## File structure

| File | Responsibility |
|------|----------------|
| `index.html` | DOM, HUD markup, script order, guarded bootstrap that calls `Game.init()`. |
| `styles.css` | All layout/HUD/menu/overlay styling (no assets). |
| `constants.js` | `window.CONFIG` — every tunable constant (physics, track, race, storage keys, team colours, timestep). Loaded first. |
| `physics.js` | `window.Physics` — car-state factory + fixed-dt integration, tire/fuel/ERS models, grip, wall & car-vs-car collision. No DOM. |
| `track.js` | `window.Track` — the fictional circuit geometry (Catmull-Rom centreline), surface/boundary/progress queries, checkpoints, DRS zone, pit lane, and the track renderer. |
| `ai.js` | `window.AI` — per-tick input frames: look-ahead, corner braking, recovery, anti-stuck, ERS/DRS use, pit decision. Normal/Hard profiles. |
| `race.js` | `window.Race` — state machine: 5-light start, race clock, checkpoint-gated lap counting, ranking, DRS eligibility, pit enforcement, pause, reset. |
| `storage.js` | `window.Storage` — safe localStorage wrapper + telemetry recording + CSV export. |
| `game.js` | `window.Game` — canvas/input/main-loop/camera/HUD/menus/rendering. Does nothing until `init()` is called. |
| `tests.html` / `tests.js` | Auto-running test suite exercising the real subsystems. |
| `dev-tools/` | Node re-verification harnesses (not part of the game). |

### Architecture in one line each
`CONFIG` holds all magic numbers → `Physics` steps plain car objects →
`Track` answers geometry queries about those positions → `AI` turns car+track+race
state into inputs → `Race` orchestrates cars through `Physics`+`AI` under the rules
→ `Storage` persists/records → `Game` wires canvas, input and the loop on top.

---

## Vehicle physics design

Arcade model in a fixed internal world-coordinate space (metres), independent of
canvas/CSS size and devicePixelRatio.

- Velocity is decomposed each tick into **forward** and **lateral** components in
  the car's heading frame.
- Throttle/brake act on the forward component; **quadratic aerodynamic drag** plus
  **linear rolling resistance** cap top speed (~87 m/s / ~310 km/h on track).
- **Lateral grip** scrubs the lateral component toward zero. Steering rotates the
  heading; the velocity then re-aligns via grip over subsequent ticks, so turning
  too fast (or on low grip) produces slip/slide (over/understeer feel).
- **Grass** raises drag/rolling resistance and lowers grip. **Walls** clamp the car
  back inside the boundary and remove only the outward velocity (so a car can slide
  along a wall and always pull away — it never locks). **Car-vs-car** collisions
  separate overlaps and damp the closing velocity (also never lock).
- **Tires**: temperature, wear %, grip coefficient. Grip peaks in a working
  temperature band (cold and overheated both lose grip) and falls with wear. Hard
  cornering/sliding/braking add heat and wear; grass cools slightly.
- **Fuel** depletes over time (faster on throttle), never negative; a lighter tank
  slightly improves acceleration.
- **ERS** charge is clamped to `[0,100]`: deploying (`Shift`) adds acceleration while
  charge remains and drains it; braking recharges; a trickle recharges under
  throttle. Depleted ERS gives exactly zero extra power.

Physics/AI/race all update on a **fixed 60 Hz timestep** driven by an accumulator
that is decoupled from `requestAnimationFrame`, with a clamp so a browser stall
cannot cause a huge catch-up jump (no teleporting after a stutter). Rendering runs
at display refresh.

---

## AI design

Each tick the AI:
1. Finds its position on the centreline and looks ahead along it.
2. Computes a **target speed** from the tightest curvature within its braking
   horizon (so it brakes *before* corners), then throttles or brakes toward it.
3. Steers toward a look-ahead point on the racing line.
4. **Recovers** onto the track if it runs onto the grass (steers back to the
   centreline, caps speed).
5. **Anti-stuck**: if it is barely moving for ~1 s it forces throttle and steers
   toward the track, so it can never sit dead against a wall.
6. **ERS**: deploys on straights when charge is available (more aggressively on
   Hard).
7. **DRS**: requests it inside the DRS zone; `Race` decides real eligibility.
8. **Pit**: once tire wear crosses `CONFIG.race.pitWearThreshold` it decides to
   pit, steers into the pit corridor, obeys (tries to) the speed limit and stops in
   the box.

Two profiles (`CONFIG.difficulty`): **Hard** brakes later, corners faster and uses
ERS more aggressively than **Normal**. All AI cars are driven through the *same*
`Physics.stepCar` as the player — there is no fixed-speed path following.

---

## Lap / checkpoint rules

A lap counts only if the three ordered checkpoints were passed **in order** *and*
the start/finish line is then crossed **forward**. The finish crossing is detected
as a forward wrap of normalised lap-progress (high→low); a backward wrap (low→high)
never counts and invalidates checkpoint progress, so reversing across the line
repeatedly can never farm laps. Ranking orders cars by `(completed laps, then track
progress within the lap)`, so who is ahead mid-lap is ranked correctly — not by lap
count alone.

## Tire / ERS / DRS / pit rules

- **DRS** is unusable on lap 1 entirely; otherwise it is usable only inside the DRS
  zone and only if the car was within `CONFIG.race.drsGapMetres` of the car ahead at
  the detection point that lap. It auto-closes on braking or on leaving the zone,
  and reduces drag while open. Pressing `F` when ineligible shows the reason on
  screen.
- **Pit**: the pit lane has a speed limit; exceeding it adds a time penalty and a
  warning. You must **stop inside the pit box**; after a fixed dwell the tires are
  serviced (wear reset, temperature dropped) with a countdown shown. There is no
  "instant tire swap anywhere on track". At least one AI pits based on tire wear.

---

## Telemetry CSV format

Player telemetry is sampled every `CONFIG.telemetry.sampleInterval` (0.25 s). The
**Export Telemetry (CSV)** button downloads it via a `Blob` + temporary
`<a download>` link (works from `file://` in Chromium/Firefox). The CSV has a header
row and one row per sample, in this exact column order:

```
time,lap,x,y,speed,throttle,brake,steer,tireTemp,tireWear,ers,drs,onTrack
```

(`drs` and `onTrack` are 0/1; `x,y` are world coordinates; `speed` is m/s.)

Persisted in localStorage (all reads fall back to sane defaults and never throw on
corrupt/missing data — a one-line notice is shown if defaults had to be restored):
best lap time, difficulty, UI settings, and the last race result.

---

## How to run the tests

Open `tests.html`. It auto-runs 14 tests and shows, per test, name / PASS-FAIL /
error detail, plus total counts. The tests call the real subsystems (e.g.
`Race.applyLapLogic`, `Physics.stepCar`, `Physics.computeGrip`,
`Race.computeRankings`, `Storage.getSettings`, a real demo update loop) — they are
not reimplementations and none are hardwired to pass.

For headless re-verification without a browser:
```
"/path/to/node" dev-tools/harness.js
```
which stubs the minimal browser globals, executes the scripts in order and prints
the same PASS/FAIL summary.

---

## Known limitations / explicitly not verified here

- The circuit geometry is a hand-placed Catmull-Rom loop; it is a clean closed
  circuit but is **not** a scale replica of any real track.
- AI pit-lane entry is not perfectly smooth — an AI can occasionally clip the pit
  speed limit on entry and take the (correctly enforced) time penalty.
- Lap times are on the long side (~70 s/lap) because the tight middle section is
  slow; this is a tuning choice, not a bug.
- **Not verified in the build environment (no browser/automation available there):**
  actual Canvas rendering correctness, real keyboard-driven play feel, the visual
  HUD layout, minimap appearance, and canvas resize behaviour. These were exercised
  only through code/logic execution (Node) and are expected — not proven — to render
  as intended. Please sanity-check them in a real browser.
