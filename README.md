# TRAFFER

**Draw the roads. Keep the city moving.**

TRAFFER is a complete, mobile-first road-network traffic puzzle game in the spirit of
*Junctions* / *Freeways* / *Highways & Co.*: you pave streets, avenues and grade-separated
freeways across a procedurally generated landscape, districts generate commuters coloured by
their destination, and every junction, queue and gridlock you create is simulated for real.

Built with zero game-framework dependencies: TypeScript + Canvas 2D + WebAudio, ~163 kB of JS
gzipped-adjacent, no binary assets at all (every icon, sound and texture is generated at runtime).

---

## Play it

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + production bundle in dist/
npm run preview    # serve the production bundle
```

Open it on a phone (portrait **or** landscape) or on desktop — the HUD, docks and gestures
re-layout themselves for each.

### Modes

| Mode        | What it is                                                                 |
| ----------- | -------------------------------------------------------------------------- |
| **Campaign**| 36 hand-designed levels in 4 chapters (Greenfield → River City → Downtown → Metropolis). Stars for finishing, for clean traffic, and for fast commutes. |
| **Endless** | Seeded, shareable cities whose demand grows forever. Survive until gridlock; chase the high score. |
| **Daily**   | One seed for the whole world each day, with a streak counter.               |
| **Sandbox** | Unlimited funds, every tool, placeable districts, save/load of whole cities. |

### The simulation (what makes it *deep*)

- **Real network, real routing.** Roads are polyline edges between junction nodes. Strokes snap
  to nodes, edges and a grid; crossings become junctions automatically.
- **Freeways grade-separate.** A freeway flies *over* surface roads without connecting; it only
  joins the street grid where you end it (a ramp). Overpasses get viaduct shadows.
- **Car-following traffic.** Each driver keeps a constant-time gap to the car ahead
  (Greenshields-style speed/density on every link), queues spill back out of saturated junctions,
  and commuters re-route around jams when a better path appears.
- **Economy.** Fares are paid per delivered commuter by trip length; your starting budget only
  covers part of the city, so growth is earned. Bulldozing refunds a third.
- **Upgrades by over-drawing.** Pave an avenue on top of a street and the street is replaced
  (part-refunded) instead of stacking two roads.
- **Jam meter.** When the city crawls, the meter fills; full means gridlock and the run ends.
- **Day/night cycle** (endless & sandbox) with headlights and lit districts.

### Controls

| Input                          | Action                                   |
| ------------------------------ | ---------------------------------------- |
| 1 finger / left-drag           | use the selected tool (draw, raze, place) |
| 2 fingers / right-drag / space | pan; pinch / wheel to zoom                |
| `1 2 3` · `X` · `Q`            | street · avenue · freeway / raze / district |
| `Z` / `Y`                      | undo / redo (whole strokes)               |
| `H` · `F` · `S` · `G` · `M`    | hint · fit map · speed · grid snap · mute |
| `Esc` / `Space`                | pause                                     |

---

## How the code is organised

```
src/
  core/        rng (seeded), math/geometry, storage, procedural audio, dom helpers
  world/       terrain generation + painter (percentile-controlled biomes, rivers, lakes)
  net/         road network (snapping, junctions, grade separation, upgrades, snapshots)
               and A* routing with congestion weights
  sim/         districts & demand matrix, car-following traffic, jam model
  render/      cached terrain + road layers, batched car drawing, effects, night, culling
  game/        config/tuning, level table, procedural generator, greedy planner (solver),
               balance data, save system, input/gestures, the Game orchestrator
  ui/          widget kit + icons, HUD, all overlay screens, CSS design system
  tools/       dev-only harnesses (see below)
```

### Rendering strategy (why it runs on phones)

Terrain and road geometry are baked into two offscreen layers sized to the device
(`texScale` adapts to viewport, DPR and quality setting) and re-baked **only when the network
changes**. Every frame composites those layers plus cars (one batched path per colour),
districts, effects and overlays. Paving roads are drawn live and folded into the cache when
done. All draw calls are culled to the viewport.

### Balance is measured, not guessed

`npm run sim` runs a headless "reference bot" through every campaign level with the *real*
terrain generator, planner and traffic sim (re-investing fares like a player), then:

- `npm run sim` — report table: minimal connection cost, budget headroom, deliveries at each
  minute, peak cars, peak jam, gridlock times.
- `npm run sim -- --calibrate` — rewrites `src/game/balance.ts` (budgets, goals, star pars)
  from those measurements.
- `npm run sim -- endless` — difficulty curve of the endless mode.

### Testing

- `npm run smoke` — boots the whole game in jsdom against a **mock 2D context that throws on any
  non-finite coordinate**, then plays a scripted session: attract mode, every overlay screen,
  building/upgrading/bulldozing roads, undo/redo, a win, a gridlock, endless, daily, sandbox
  save/load round-trip and all 36 levels accepting a first road. 16 checks, ~1.4 M draw calls
  validated.
- `npm run shot -- <level> [desktop|mobile|landscape] [seconds] [near] [night]` — headless
  screenshot pipeline (SVG recorder → PNG) used to inspect the visuals without a browser:
  `npm run shot -- m5 desktop 150`, `npm run shot -- r2 mobile`, `npm run shot -- m7 desktop 150 near night`.

Both harnesses are dev-only (`src/tools/`) and never ship.

---

## Design notes

- Districts are colour-blind friendly on request (R/C/I letters), and always show their state:
  *needs a road* → *no route yet* → *N served · M linked*.
- Hints point at the pair of districts whose current route is most indirect, so the suggestion is
  actually useful ("add a shortcut between X and Y").
- Tutorial levels coach by watching what you do, not by modal walls of text.
- Everything persists: stars, stats, milestones, endless records, daily streak, sandbox cities.

## Licence

MIT — see the repository. Built as a single-session production build on the
`arena/0003d6e4-traffer` branch.
