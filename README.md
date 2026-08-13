<h1 align="center">Alpenglow, visualized & measured</h1>

<p align="center">
  <strong>Solana's 100× finality upgrade — simulated, mapped, and benchmarked live on mainnet</strong>
</p>

<p align="center">
  <a href="https://alpenglow-viz.vercel.app"><img src="https://img.shields.io/badge/Live-alpenglow--viz.vercel.app-green?style=flat-square" alt="Live" /></a>
  <a href="https://github.com/solana-foundation/solana-improvement-documents/pull/326"><img src="https://img.shields.io/badge/SIMD-0326-blue?style=flat-square" alt="SIMD-0326" /></a>
  <img src="https://img.shields.io/badge/Rust%20%E2%86%92%20WASM-consensus%20core-orange?style=flat-square" alt="Rust WASM" />
  <img src="https://img.shields.io/badge/Tests-3%2F3%20passing-brightgreen?style=flat-square" alt="Tests" />
  <img src="https://img.shields.io/badge/Validators-698%20real%20(geo%20%2B%20stake)-purple?style=flat-square" alt="Validators" />
</p>

<p align="center">
  An interactive model of Alpenglow's votor logic (Rust → WebAssembly), driven by
  <strong>real mainnet stake</strong> at <strong>real validator locations</strong> — plus a
  <strong>live wall-clock finality benchmark</strong> that will capture the moment
  mainnet switches from ~12.8 s to ~150 ms.
</p>

---

## At a glance

| | TowerBFT (today) | Alpenglow |
|:---|:---:|:---:|
| **Finality** | ~12,800 ms (32 slots) | **100–150 ms claimed** |
| **Mechanism** | tower votes on-chain | one round of off-chain BLS votes |
| **Fast path** | — | ≥80% stake in a single round |
| **Slow path** | — | 60% notarize + 60% finalize |
| **Resilience** | ~33% | **20% byzantine + 20% offline** |
| **Live measurement** | [12.8 s right now →](https://alpenglow-viz.vercel.app) | *this repo will measure it at activation* |

**Measured with real geography** (698 mainnet validators, speed-of-light-in-fiber model):

| Leader location | 60% notarized | 80% fast-finalized |
|:---|:---:|:---:|
| Frankfurt | **~22 ms** | ~104 ms |
| Tokyo | ~144 ms | ~147 ms |
| Singapore | ~160 ms | ~165 ms |

Why the spread? **Frankfurt + Amsterdam + London physically host ~half of all Solana stake.**

## Live finality benchmark — TowerBFT vs Alpenglow, measured

The site header measures **both networks side by side, live**:

| | Mainnet (TowerBFT) | **Alpenglow test cluster** (SIMD-0326 active, Agave 4.3.0) |
|:---|:---:|:---:|
| finalized vs processed slot gap | **32 slots** (10/10 samples) | **0 slots** (9/10 samples) |
| time-to-finality | **12,800 ms** | **< 400 ms** — finalized within its own slot |
| wall-clock upper bound | — | p90 537 ms *including* cross-internet RTT + polling overhead |

Measured 2026-08-14 against Anza's public Alpenglow cluster. Reproduce it yourself:

```bash
curl -s -X POST http://103.50.32.125:8899 -H "content-type: application/json" \
  -d '[{"jsonrpc":"2.0","id":1,"method":"getSlot","params":[{"commitment":"processed"}]},
       {"jsonrpc":"2.0","id":2,"method":"getSlot","params":[{"commitment":"finalized"}]}]'
# → both results are the same slot. On mainnet they differ by 32.
```

The mainnet card measures two ways:

- **Wall-clock (primary):** timestamp each slot when first announced (`slotSubscribe`),
  again when rooted (`rootSubscribe`); the delta is real measured finality with ms
  resolution — reads **~12.8 s** in the TowerBFT era, and will capture the actual
  post-activation number against the 100–150 ms claim.
- **Slot-gap (fallback):** `finalized` vs `processed` slot × 400 ms over HTTP.

When sustained finality drops under 2 s, the page flips to **⚡ ALPENGLOW IS LIVE**
on its own. Activation window: **Aug–Oct 2026**.

## The simulator

Watch a slot reach consensus vote by vote — stake accumulates toward the 60% / 80%
thresholds and certificates snap into place. The core is a faithful (simplified) model
of the real votor logic: exact thresholds, all five vote kinds, overflow-safe u128
stake math.

- **⚡ Fast finalize** — 80% of stake in one round: the headline path
- **🔒 Slow finalize** — 60% notarize + 60% finalize: two-step finality
- **⏭ Leader offline** — skip votes; the chain moves on
- **😈 Equivocation** — a byzantine leader signs two conflicting blocks; honest stake
  splits 50/50 until **notarize-fallback** votes rescue the slot

**Break it yourself:** flip to real mainnet stake, then click validators offline —
kill the top 8 (>20%) and the fast path dies; kill the top 25 (>40%) and finality
halts. Restore them and it heals.

## Architecture

```
core/   Rust consensus engine  →  compiled to WASM (74 KB)
  threshold.rs    60/80% checks (overflow-safe u128 cross-multiply)
  sim.rs          the votor state machine + step()
  scenarios.rs    preset vote scripts (incl. stake-balanced equivocation)
  wasm.rs         wasm-bindgen surface

web/    React + TypeScript + Vite (~92 KB gzipped total, no map libraries)
  FinalityLive.tsx   live mainnet benchmark (websocket + HTTP fallback)
  WorldMap.tsx       698 validators, real geo, Canvas 2D, latency physics
  App.tsx            simulator UI: presets, kill switches, cert log
```

## Run it

```bash
cd core && wasm-pack build --target web --out-dir ../web/src/wasm
cd ../web && npm install && npm run dev   # → http://localhost:5173
cd ../core && cargo test                  # 3/3
```

## Honest model notes

The simulator is an educational model, not Anza's implementation: relay selection is
simplified (top-40 stake vs per-shred sampling), votes are observed at the leader,
and there's no erasure-coding detail. The latency model (great-circle × 1.4 routing
+ hop overhead) reproduces real-world ping times within ~15%. Stake & geo snapshots:
Stakewiz, 2026-08-13.
