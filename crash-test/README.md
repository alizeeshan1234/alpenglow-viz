# Alpenglow Crash Test

An independent, reproducible adversarial benchmark of **Solana's real Alpenglow
consensus** — not a simulation. It boots actual Agave `LocalCluster::new_alpenglow`
clusters, injects faults (offline stake, and later equivocation / partition), and
measures whether the real consensus keeps finalizing or **stalls**.

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

1. Boots an N-node Alpenglow cluster with equal stake.
2. Waits until it is finalizing (warmup) — proving a healthy baseline.
3. Takes `num_offline` validators offline via `exit_node`.
4. Polls the **alive** nodes' `getSlot(finalized)` over a fixed window and records
   whether finalized roots keep advancing.
5. Emits one `CRASH_RESULT ...` line, parsed into `results/*.json`.

It intentionally skips `spend_and_verify_all_nodes` (its strict gossip-discovery
assertion is flaky on loaded machines) and measures finalization directly.

## Reproduce

```bash
# needs an Alpenglow-capable agave checkout (>= 4.3) at $AGAVE_DIR (default ~/Desktop/agave)
AGAVE_DIR=~/Desktop/agave ./run.sh
# → writes results/offline_sweep.json
```

On macOS the script exports `LIBCLANG_PATH` and `DYLD_FALLBACK_LIBRARY_PATH`
(pointing at the CommandLineTools libclang) so RocksDB's bindgen build links.

## Files

- `crash_test.rs` — the harness (copied into `agave/local-cluster/tests/`).
- `run.sh` — one-command runner across the scenario sweep.
- `parse_results.py` — `CRASH_RESULT` lines → structured JSON (records agave SHA).
- `results/` — measured output, committed as reproducible artifacts.

## Provenance

Each result records the agave commit it was measured against and the machine
topology. Results are only as strong as the fault model: exceeding Alpenglow's
documented 20%-Byzantine + 20%-offline model producing a stall is **expected
behavior**, not a bug — this benchmark characterizes that boundary, it does not
claim vulnerabilities.
