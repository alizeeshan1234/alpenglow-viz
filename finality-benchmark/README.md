# Alpenglow finality, measured live — 218 ms vs 13.2 s

Anza's published simulations project Alpenglow finality at **100–150 ms**
(fast path ~100 ms, slow path ~150 ms). The Alpenglow community cluster —
~114 volunteer-run validators coordinated by Anza, SIMD-0326 active — is
public, so instead of waiting for mainnet activation we measured the real
implementation **today**, simultaneously with Solana mainnet, using the
identical method on both.

**Verdict: the claim survives.** End-to-end slot finality measured 218 ms median,
but decomposing it per stage shows the consensus path itself — block frozen →
votes → finalization certificate — runs at **68 ms median**. Most of the 218 ms
is the leader streaming the block out (propagation), not consensus.

## Results (measured 2026-08-14, 150 s capture)

| | Alpenglow community cluster | Solana mainnet (TowerBFT) |
|:---|:---:|:---:|
| **p50 finality** | **218 ms** | 13,152 ms |
| p90 | 435 ms | 13,391 ms |
| p99 | 446 ms | 13,545 ms |
| samples (slots) | 643 | 331 |
| **measured speedup** | **60×** | — |

Distribution: most Alpenglow slots finalize in **200–250 ms** — right at one
slot, since this cluster runs **~240 ms slots** (measured from slotSubscribe
cadence; mainnet measured ~403 ms/slot with the same probe). A tail finalizes
in under 60 ms; a small mode sits near two slots (~400–450 ms). Mainnet is a
tight band around 13.2 s (32 slots × 400 ms, plus jitter).

## Where the milliseconds go (501 slots, `slotsUpdatesSubscribe`)

| Stage | p50 | p90 |
|:---|:---:|:---:|
| Leader streams the block (first shred → complete) | 199 ms | 271 ms |
| Replay (complete → frozen) | ~0 ms | 33 ms |
| **Consensus: votes → finalization cert (frozen → root)** | **68 ms** | 209 ms |
| **End-to-end (first shred → finalized)** | **269 ms** | 413 ms |

The consensus round is *faster* than the claimed 100–150 ms on this cluster —
expected, since a small test cluster gathers votes quicker than 1,000+
geographically spread mainnet validators will. The claim is the mainnet
projection; this measurement says the mechanism delivers it with margin.

## Method — why this works from anywhere on earth

On a **single websocket per cluster**, timestamp each slot twice:

1. when it is first announced (`slotSubscribe`)
2. when it is rooted/finalized (`rootSubscribe`)

Both events ride the same connection from the same node, so the one-way network
delay is the same for both and **cancels in the delta**. The result is protocol
finality with millisecond precision — even though the community-cluster node is
~232 ms of RTT away from where we measured.

Both clusters are captured **at the same time with the same code**, so neither
side gets a favorable network moment.

## The full battery

`render_report.mjs` assembles this benchmark with the adversarial
`../crash-test/` results (real Agave LocalClusters: liveness boundary at
exactly 60% online, TowerBFT stalling at 40% offline, 32-slot vs ≤1-slot
finality depth on identical hardware) into one share card:
`results/report_card.png`. Every number on it is read from the measured JSON
artifacts — nothing is hand-typed.

## Reproduce it (Node ≥ 22, no dependencies)

```bash
node measure.mjs 150        # 150-second capture, writes results/finality_benchmark.json
node decompose.mjs 120      # per-stage breakdown, writes results/finality_decomposition.json
node render_chart.mjs       # renders results/finality_chart.png
```

Endpoints: the Alpenglow community cluster's public RPC `103.50.32.125:8899/8900`
(SIMD-0326 active, Agave 4.3.0, 114 nodes at time of measurement) and
`api.mainnet-beta.solana.com`.

## Validation

Before publication every number was cross-checked five independent ways —
instrument validation against known truths, reproduction runs hours apart,
third-party dashboards (Valid Blocks, Vybe), physical plausibility, and
precise interval definitions. Full dossier: [VALIDATION.md](VALIDATION.md).

## Honest caveats

- The community cluster is a **test cluster** (~114 volunteer-run validators) —
  we don't control its topology, and it is smaller than mainnet's ~1,000
  validators. Treat 218 ms as evidence the mechanism works as designed, not as
  a guaranteed mainnet number. Note it runs ~240 ms slots; mainnet is planned
  to step down from 400 ms toward 200 ms around Alpenglow activation.
- `rootNotification` granularity: rooting is observed via the node's own
  notification stream, which batches at slot boundaries — the ~400 ms mode is
  partly that quantization, so the true protocol number may be *better* than p90
  suggests.
- Mainnet's ~13.2 s is `rooted` finality (32 slots), the like-for-like
  comparison to Alpenglow's finalization. Optimistic confirmation (~6.4 s) is a
  weaker guarantee and would still be ~30× slower.
- The faucet on this RPC node is disabled, so end-to-end (submit → finalized)
  transaction timing wasn't measurable; the harness supports it (`airdropE2e`)
  if a faucet-enabled endpoint is available.
