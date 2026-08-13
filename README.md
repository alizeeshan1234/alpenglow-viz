# Alpenglow, visualized

An interactive visualizer for **Alpenglow** — Solana's new consensus protocol — driven by a
consensus engine written in **Rust** and compiled to **WebAssembly**.

Watch a slot reach consensus in real time: validators cast votes, stake accumulates toward the
**60%** and **80%** thresholds, and certificates snap into place — Notarize, Finalize, Skip,
and the ⚡ fast-finalization path.

> The simulation core is a faithful (simplified) model of the real `votor` logic: the vote
> types, the exact 60% / 80% thresholds, and overflow-safe stake comparison all mirror the
> production code.

## Scenarios

- **⚡ Fast finalize** — every validator notarizes the block; it crosses 60% (Notarized) then
  80% (Finalized in one shot — the headline Alpenglow speedup).
- **🔒 Slow finalize** — just enough stake notarizes (≥60%, <80%), then those validators cast
  Finalize votes — the two-step finality path.
- **⏭ Leader offline** — no valid block; validators vote Skip, the slot is skipped, and the
  chain moves on.
- **😈 Equivocation** — a byzantine leader signs **two conflicting blocks**; honest stake
  splits 50/50 and neither reaches 60%, until **notarize-fallback** votes ("safe-to-notar")
  rescue the slot.

## Real mainnet stake

Flip to **🌐 Real mainnet stake** and the simulation runs on Solana's actual validator set —
the top 60 validators by activated stake, fetched live (Stakewiz API, with a bundled
snapshot as offline fallback), long tail aggregated. Real names, real stake weights,
~435M SOL total.

Then answer the question people actually argue about, empirically:

- 💀 knock out the **top 8** validators (>20% of stake) → the **fast path dies**, but the
  slot still notarizes at 60%
- 💀 knock out the **top 25** (>40%) → **finality halts** — no threshold is reachable
- 💚 restore all → ~150 ms finality again

## The 150 ms, on a map

The headline feature: **watch a Solana slot finalize across the actual globe.** All ~700
mainnet validators are drawn at their real locations (dot size = activated stake). Block
shreds fan out leader → stake-weighted relays → everyone; notar votes stream back; the
60% and 80% stake thresholds get crossed **in real protocol milliseconds**, computed from
speed-of-light-in-fiber latencies over great-circle routes.

What it shows that a bar chart can't:

- A **Frankfurt leader** hits 60% of stake in **~22 ms** — because Frankfurt + Amsterdam +
  London host **half of all Solana stake**. Fast-finality lands at ~104 ms.
- Switch the leader to **Tokyo or Singapore** and finality jumps to ~150–165 ms — geography
  is the protocol's floor.
- TowerBFT's optimistic confirmation (~12.8 s) wouldn't even be a tenth done.

Scrub the timeline, slow it to 1/60×, pick different leaders.

## Break it yourself

Click any validator to knock it **offline** — its future votes are dropped. Reset and replay
a scenario to see how much stake consensus can lose and still survive (kill 2 of 10: fast
path degrades to slow; kill 5: the slot **stalls**, no threshold is reachable).

There's also a **real-time finality race**: Alpenglow (~150 ms) vs TowerBFT optimistic
confirmation (~12.8 s), animated in actual wall-clock time.

## Architecture

```
core/   Rust consensus engine  →  compiled to WASM
  types.rs        Validator, Vote, Certificate, BlockId
  threshold.rs    60/80% checks (overflow-safe u128 cross-multiply)
  sim.rs          the state machine + step()   ← the heart
  scenarios.rs    preset vote scripts
  wasm.rs         wasm-bindgen surface (SimHandle)

web/    React + TypeScript + Vite frontend
  src/useSimulation.ts   loads the WASM, drives step()/snapshot()
  src/App.tsx            validators, stake bars, certs, event log
```

Every `step()` returns a list of events (`VoteCast`, `CertFormed`, `Notarized`, `Finalized`,
`Skipped`); the UI reads that list and animates it. Clean contract between Rust and the screen.

## Run it

```bash
# 1. build the Rust core to WASM (needs wasm-pack)
cd core
wasm-pack build --target web --out-dir ../web/src/wasm

# 2. run the frontend
cd ../web
npm install
npm run dev        # → http://localhost:5173
```

## Tech

Rust · wasm-bindgen · WebAssembly · React · TypeScript · Vite

## Tests

The Rust core is unit-tested (`cargo test` in `core/`) — e.g. a certificate forms at exactly
60% of stake.
