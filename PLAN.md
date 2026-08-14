# Alpenglow Crash Test — Build Plan

> **Can you break Solana's new consensus before it reaches mainnet?**
> An independent, reproducible adversarial benchmark of Agave's *real* Alpenglow
> implementation — not a simulation.

## Thesis

The current `alpenglow-viz` is a WASM *model* of Votor. Educational, but the
territory is occupied (ValidBlocks, Vybe) and protocol engineers don't respect a
model. The upgrade — the p-token move applied to consensus — is to run **Agave's
actual `LocalCluster::new_alpenglow`** through fault-injected scenarios and
publish **measured, reproducible** results.

Confirmed feasible: `LocalCluster::new_alpenglow(config, socket_addr_space)` is a
real public constructor in `agave/local-cluster/src/local_cluster.rs`, and
`local-cluster/tests/local_cluster.rs` already contains the fault-injection
machinery (54 Alpenglow references: offline, partition, restart, equivocation).
We are wiring up and productizing real instrumentation, not inventing it.

## Two hard amendments to the original idea

1. **Headline is behavioral, not millisecond latency.** Local clusters colocate
   all validators on one machine; Anza's own `KNOWN_NON_ISSUES.md` explicitly
   discredits single-machine latency numbers. So the hero metrics are the ones
   robust to colocation:
   - Does it finalize, or **stall**? At what fault level is the boundary?
   - **Fast-path vs slow-path %** (80% one-round vs 60%+60%).
   - **Skip rate.**
   - **Recovery time** (slots to first finalization after healing).
   Latency (p50/p95) is reported as *relative/internal* only, clearly caveated —
   never as the headline.

2. **Feasibility-first sequencing.** Getting the harness to build and run is 90%
   of the risk. A one-day spike gates the entire project (see Phase 0).

## Metrics captured per run

- First-shred → notarization → finalization (internal event timing, relative).
- Fast vs slow finalization fraction.
- Skip rate / skipped windows.
- Recovery time after fault heals.
- Votes, certificates, bytes per slot (throughput).
- Provenance: Agave commit SHA, hardware, topology, **random seed** (reproducible).

## Scenario matrix

| Scenario | Fault injected | Headline result |
|---|---|---|
| Healthy | none | baseline fast-final %, skip rate |
| Offline sweep | 0–45% stake offline | **finalize → stall boundary** |
| 20 + 20 | 20% Byzantine + 20% offline | liveness holds? behavior at the model edge |
| Leader crash | kill leader mid-window | skip + recovery time |
| Equivocation | leader signs conflicting blocks | fallback-path behavior |
| Vote degradation | delay / jitter / loss | fast-final % vs network quality |
| Regional partition | EU/US/APAC split | which side makes progress |
| Alpenswitch | Tower → Votor migration | downtime, first finalized slot |

Start with **Offline sweep** — highest signal, robust to colocation, directly
visualizes the 20+20 model everyone quotes.

## Architecture

```
harness/        Rust — drives agave LocalCluster, injects faults, emits JSON
  scenarios/    one module per scenario row
  metrics.rs    parse internal slot-tracking events → structured results
  runner.rs     seed, SHA, topology capture; matrix sweep
results/        committed JSON traces (reproducible artifacts)
web/            existing site, restructured:
  Crash Test    (homepage) interactive slider over REAL precomputed traces
  Learn         the existing WASM simulator (kept, honest as a model)
  Live          mainnet vs community-cluster finality tracker (supporting)
```

## Interactive site (the viral surface)

Homepage opens on one control:

```
Offline stake:  0% ━━━━━●━━━━━ 45%
```

Dragging it replays **real measured traces**: fast-final dominates < 20%,
slow/fallback paths appear mid-range, finalization **stalls** at the measured
boundary. "Equivocate leader" button replays that real trace. Every state emits a
downloadable share card. Hero copy uses only produced numbers — blanks stay blank
until the benchmark fills them.

## Corrections carried over to the current build (do regardless)

- **Rotor label:** the world map models Rotor relay dissemination, but SIMD-0326's
  initial activation keeps **Turbine** and is Votor-only. Relabel: *"Future Rotor
  model — not part of the initial Votor activation,"* or cut it.
- `processed == finalized` proves same-slot finality, not an exact ms figure.
- RPC polling is an upper bound; benchmark timing comes from agave internals.
- GitHub repo metadata: description, homepage, topics, license, social preview.

## Launch

1. Short **video** (not a screenshot): drag the slider, watch it stall.
2. Methodology post + raw JSON.
3. One-command reproduction.
4. **Private Anza preview first** — let them validate/correct the method before
   public posting; invites amplification instead of "well actually."
5. Then tag Anza, SIMD authors, Toly.

## Bug bounty handling (parallel, private)

Official Alpenglow competition: up to 50,000 SOL, Aug 5–19, 2026, covers votor /
votor-messages / BLS / integration surface. The harness can double as bug-hunt
infra. If it surfaces a *security* issue: submit via the official portal before
Aug 19, do **not** publish the trace/exploit (public = ineligible). The
non-sensitive aggregate benchmark still launches publicly. Note: measuring
documented fault behavior (e.g. stalls past 20+20) is **expected**, not a bug —
the benchmark and the bug-hunt are separate tracks.

## Phases & the gate

- **Phase 0 — Feasibility spike (day 1, MAKE-OR-BREAK):** clone + build agave, run
  `LocalCluster::new_alpenglow`, inject offline stake, extract one behavioral
  result (finalize vs stall). **Gate:** works on this machine in ~a day → proceed.
  Fails/too heavy → pivot (polish the sim + ship the corrections + live tracker),
  known on day 1 not day 4.
- **Phase 1 — One scenario, rigorous (days 2–3):** offline sweep, full metrics,
  fixed seed, recorded SHA/topology. This alone is postable.
- **Phase 2 — Matrix + site (days 3–4):** add scenarios as time allows; build the
  slider homepage over real traces; relabel Rotor; sim → Learn tab.
- **Phase 3 — Launch (day 5):** video, methodology, repro, private Anza preview.

## Honest risk register

- Agave build/harness may be heavy or flaky on the dev machine → Phase 0 gate.
- Single-machine latency is not credible → behavioral headline (amendment 1).
- Full matrix may not finish in the window → one rigorous scenario beats eight
  half-done; Phase 1 is independently shippable.
- No project guarantees virality — but a reproducible crash test of
  production-bound consensus, launched during its 50k-SOL security window, has a
  far better shot than another visualizer.
