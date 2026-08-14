# Alpenglow Crash Test

An independent, reproducible adversarial benchmark of **Solana's real Alpenglow
consensus** — not a simulation. It boots actual Agave `LocalCluster` clusters,
injects faults, and measures whether the real consensus keeps finalizing or
**stalls**. Legacy TowerBFT runs provide a behavioral control.

## What it measures

Headline metrics are **behavioral**, because they are robust to the fact that a
local cluster colocates every validator on one machine:

- **Finalize vs stall** — does the cluster keep producing finalized roots under the
  fault, and at what fault level does it stop?
- **New finalized roots** observed in a fixed window after the fault.
- **Warmup confirmation** — the cluster was healthy and finalizing *before* the fault.

Wall-clock latency is deliberately **not** a headline: single-machine colocation
makes absolute millisecond timings unrepresentative of a real network (Anza's own
bug-bounty notes call this out). We report relative timing only.

## Method

`crash_test.rs` (an Agave `local-cluster` integration test) for each scenario:

1. Boots an N-node Alpenglow or TowerBFT cluster with equal stake.
2. Waits until it is finalizing (warmup) — proving a healthy baseline.
3. Takes `num_offline` validators offline via `exit_node`.
4. Polls the **alive** nodes' `getSlot(finalized)` over a fixed window and records
   whether finalized roots keep advancing.
5. Emits one `CRASH_RESULT ...` line, parsed into `results/*.json`.

Tower uses its normal 64-tick slot cadence; Alpenglow uses Agave's accelerated
8-tick local-test cadence. The cross-consensus comparison is therefore strictly
**finalize vs stall**, never wall-clock speed. At 40% offline, the measured
Alpenglow run finalized while the Tower control stalled.

It intentionally skips `spend_and_verify_all_nodes` (its strict gossip-discovery
assertion is flaky on loaded machines) and measures finalization directly.

## Finality-latency sweep (`run_finality.sh`)

A second battery boots the same real clusters and tight-polls one node
(~5 ms sample period) to timestamp every slot at `processed` and again at
`finalized` — per-slot wall-clock time-to-finality plus the slot-depth gap
(measured 2026-08-14, Agave `890582202e`; finalize/stall outcomes for the
60%-offline row come from the crash sweep, `results/offline_sweep.json`):

| stake offline | Alpenglow (needs 60% online) | TowerBFT (needs 66.7%) |
|:---:|:---|:---|
| 0% | ✓ finalizes *(latency n/a — rig CPU-bound at 5 nodes)* | ✓ finalizes · **32 slots behind tip** (p50 12.5 s) |
| 20% | ✓ finalizes · **0 slots behind tip** (p50 42 ms) | ✓ finalizes |
| 40% *(60% online — the edge)* | ✓ finalizes · **1 slot behind tip** (p50 92 ms) | ✕ **STALLS** |
| 60% | ✕ stalls — as designed | — |

Two findings survive the colocation caveat:

- **Finality depth is protocol-defined**: Tower roots exactly 32 slots behind
  the tip (p50 = p90 = 32) while Alpenglow stays at 0–1 slots in every healthy
  run, on identical hardware (the CPU-saturated all-online runs also degraded
  depth — both are kept in `logs/`). The local Tower control (12.5 s) also
  reproduces the measured mainnet finality (13.2 s) within 5.3% — validating
  the harness against the real network.
- **The liveness boundary is exactly as documented**: still finalizing at
  precisely 60% online, stalled at 40% online, while Tower is already dead at
  40% offline.

The all-online 5-validator baseline saturates this machine's CPU (both runs
kept in `logs/`), so no latency claim is made for that row — colocated
absolute timings are reported only where the run was demonstrably healthy,
and only alongside the slot-depth metric.

## Reproduce

```bash
# needs an Alpenglow-capable agave checkout (>= 4.3) at $AGAVE_DIR (default ~/Desktop/agave)
AGAVE_DIR=~/Desktop/agave ./run.sh           # crash sweep → results/offline_sweep.json
AGAVE_DIR=~/Desktop/agave ./run_finality.sh  # latency sweep → results/finality_sweep.json
```

On macOS the script exports `LIBCLANG_PATH` and `DYLD_FALLBACK_LIBRARY_PATH`
(pointing at the CommandLineTools libclang) so RocksDB's bindgen build links.

## Files

- `crash_test.rs` — the harness (copied into `agave/local-cluster/tests/`).
- `run.sh` — one-command runner across the Alpenglow sweep and Tower controls;
  retries startup failures that emit no admissible result.
- `parse_results.py` — `CRASH_RESULT` lines → structured JSON (records agave SHA).
- `results/` — measured output, committed as reproducible artifacts.

## Provenance

Each result records the agave commit it was measured against and the machine
topology. Results are only as strong as the fault model: exceeding Alpenglow's
documented 20%-Byzantine + 20%-offline model producing a stall is **expected
behavior**, not a bug — this benchmark characterizes that boundary, it does not
claim vulnerabilities.
