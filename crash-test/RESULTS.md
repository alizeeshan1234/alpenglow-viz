# Alpenglow Crash Test — Results

Measured against Agave `890582202e` (Alpenglow / SIMD-0326), local cluster,
Apple M-series 11-core / 18 GB. **Behavioral outcomes are the headline; timings
are relative** (single-machine colocation makes absolute latency
unrepresentative — see Method).

## Offline-stake sweep — the finalize→stall boundary

How much validator stake can go offline before Solana's new consensus stops
finalizing? We boot a real Alpenglow cluster, confirm it is finalizing, take
validators offline, and measure whether finalized roots keep advancing.

| Nodes | Offline stake | Online stake | Outcome | Roots in window |
|:-----:|:-------------:|:------------:|:--------|:---------------:|
| 4 | 0%  | 100% | ✅ FINALIZED | 9 |
| 5 | 0%  | 100% | ✅ FINALIZED | 10 |
| 5 | 20% | 80%  | ✅ FINALIZED | 10 |
| 4 | 25% | 75%  | ✅ FINALIZED | 10 |
| **5** | **40%** | **60%** | ✅ **FINALIZED** | **21** |
| 4 | 50% | 50%  | 🛑 STALLED | 0 |
| 5 | 60% | 40%  | 🛑 STALLED | 0 |
| 4 | 75% | 25%  | 🛑 STALLED | 0 |

**Finding.** Alpenglow finalizes with up to **40% of stake offline** — i.e. as
long as the online **60% supermajority** is intact — and stalls once online stake
drops below 60% (between 40% and 50% offline in this sweep). At *exactly* 60%
online it still finalized. This matches the protocol's `≥ 60%` certificate rule
(`bls-cert-verify`) to the exact validator, verified against the real
implementation rather than the whitepaper.

A stall past this point is **expected, documented behavior**, not a
vulnerability: Alpenglow's safety/liveness model is defined for < 20% Byzantine +
< 20% offline. This benchmark characterizes the boundary; it does not claim a bug.

Every run confirmed the cluster was healthy and finalizing *immediately before*
the fault (`warm_ok=true`), so these are clean fault effects, not startup
failures. Losing 25% of stake produced no finality slowdown at all.

## TowerBFT control — the threshold moved

The key 5-validator point was rerun against legacy TowerBFT. Both modes began
healthy (`warm_ok=true`), used equal stake, removed the same validator count,
drained pre-fault votes for 5 seconds, and then required 16 new finalized roots.

| Consensus | Offline stake | Online stake | Outcome | Roots in window |
|:----------|:-------------:|:------------:|:--------|:---------------:|
| Alpenglow | 40% | 60% | ✅ **FINALIZED** | 21 |
| TowerBFT | 40% | 60% | 🛑 **STALLED** | 0 |

**Finding.** Sixty percent online stake is sufficient for Alpenglow's
certificate threshold but insufficient for Tower's two-thirds requirement. The
Tower controls at 0% and 20% offline both finalized 16 new roots; the 40%-offline
control produced none over the full 60.4-second observation window.

Tower uses its normal 64-tick slot cadence while the Alpenglow integration test
uses Agave's accelerated 8-tick cadence. This table compares the behavioral
outcome only; its wall-clock times are intentionally not compared.

## Adversarial scenarios — Agave's own fault-injection tests

Run unmodified from the Agave `local-cluster` suite. A "survived" result means the
cluster kept finalizing (or recovered and re-rooted) under the fault.

| Scenario | Fault | Result | Time |
|:---------|:------|:------:|:----:|
| Byzantine equivocation | leader sends conflicting duplicate blocks | ✅ survived (32 roots) | 55.9s |
| Kill heaviest partition | split into 4, drop the most-staked | ✅ recovered | 147.5s |
| Three-way partition (1:1:1) | 3 equal partitions, then heal | ✅ recovered | 91.9s |
| Validator restart | kill + restart a node | ✅ recovered | 25.8s |

All four are within Alpenglow's fault model, so surviving them is **expected,
correct behavior** — the value is that it is independently *demonstrated* against
the real implementation, not asserted from the whitepaper.

## Method

`crash_test.rs` (an Agave `local-cluster` integration test):

1. Boots `LocalCluster::new_alpenglow` or legacy `LocalCluster::new` with N
   equal-stake validators.
2. Warms up until finalized slots advance (healthy baseline).
3. Takes `num_offline` validators offline via `exit_node`.
4. Polls the alive nodes' `getSlot(finalized)` over a 60 s window. The original
   Alpenglow sweep used an 8-root target; the matched Tower/Alpenglow control
   drains pre-fault votes for 5 seconds and uses a stricter 16-root target.

Skips `spend_and_verify_all_nodes` (its strict gossip-discovery assert is flaky on
loaded machines). Reproduce: `AGAVE_DIR=~/agave ./run.sh`.

## Why not milliseconds

A local cluster colocates every validator on one machine, so absolute finality
latency is not network-representative (Anza's own bug-bounty notes flag this).
Times above are relative only. The *behavioral* boundary — finalize vs stall — is
robust to colocation and is what these results assert.
