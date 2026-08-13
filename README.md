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
