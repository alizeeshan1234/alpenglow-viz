# Validation dossier

Every headline number in this benchmark was cross-checked five independent ways
before publication. This file documents each check so readers can audit the
audit.

## 1. The instrument reads known truths correctly

The same measurement code (`measure.mjs`, slot-announced → slot-rooted delta on
a single websocket) was pointed at targets whose true values are known:

| Target | Known truth | Our reading |
|:---|:---:|:---:|
| Solana mainnet finality | ~12.8–13 s (32 slots × ~400 ms) | **13.15 s** (run 1) / **13.21 s** (run 2) |
| Local TowerBFT cluster depth | exactly 32 slots (protocol constant) | **p50 = p90 = 32 slots** |
| Local TowerBFT wall clock vs real mainnet | should agree | **12.46 s vs 13.15 s — within ~5%** |
| Mainnet slot cadence | ~400 ms | **403 ms** (slotSubscribe probe) |

An instrument that reads four known values correctly is not lying about the
fifth.

## 2. Reproduction across independent runs

| Run | When (UTC) | Slots | Result |
|:---|:---|:---:|:---|
| Full benchmark, run 1 | 2026-08-14 ~13:00 | 643 | slot→root p50 218 ms |
| Stage decomposition, run 1 | 2026-08-14 13:08 | 501 | consensus (frozen→root) p50 **67.6 ms** |
| Stage decomposition, rerun | 2026-08-14 18:24 | 262 | consensus p50 **70.7 ms** |
| Full benchmark, run 2 | 2026-08-15 | 663 | slot→root p50 ~0 ms, p90 227 ms; mainnet 13.21 s |

The consensus-path median reproduces within 3 ms across independent samples
hours apart. (Run 2's ~0 ms slot→root median reflects root notifications
arriving in the same websocket flush as slot announcements once finalization
fits within one notification interval — the p90 of 227 ms ≈ one slot is the
informative figure there.) Raw data for every run is committed in `results/`.

## 3. Third-party corroboration (tools we did not write)

- **Valid Blocks explorer** ([ag.validblocks.com](https://ag.validblocks.com)),
  community-built, measuring from its own node: **"Finalization time · last 1h:
  avg 103 ms (min 97, max 116)"** and **"Slot time · last 1h: avg 213 ms"**
  (screenshot: `results/evidence_validblocks_2026-08-15.jpg`). True cluster
  finality ≈ 100 ms — inside Anza's 100–150 ms projection, and consistent with
  our tighter frozen→root component (68–71 ms) plus vote-propagation overhead.
- **Vybe dashboard** ([alp.vybenetwork.com](https://alp.vybenetwork.com)):
  finalization **"0 ms · 0 slots behind"** (our zero-gap finding) and live
  slot time **227 ms** (5-minute window) — corroborating our measured ~241 ms
  cadence and refuting any 400 ms assumption.
- **Anza's own announcement** (May 2026): "sub-150 ms finality" on this
  cluster — our end-to-end components bracket it; nothing we measured
  contradicts the builders.

Three independent measurement stacks, three vantage points, one consistent
picture.

## 4. Physical plausibility

Alpenglow's fast path is a single vote round plus aggregation. The community
cluster is ~114 nodes, heavily datacenter-concentrated (one hosting provider
alone runs ~a fifth), with inter-node RTTs of 10–50 ms — one round over that
topology is expected to land in tens of milliseconds. For contrast, our
mainnet-geography model (698 real validator locations, speed-of-light-in-fiber)
puts a Frankfurt leader at ~104 ms to reach 80% of stake — a smaller, tighter
cluster being faster than that is coherence, not surprise. This is also why
none of these numbers should be quoted as a mainnet prediction: Anza's
100–150 ms *is* the mainnet projection, and it stands.

## 5. Definitions are printed on every number

- **68–71 ms** = block frozen at our observer → finalization observed (the
  tail of the vote round; other validators' votes are already in flight while
  the observer replays).
- **269 ms** = first shred seen → finalized (everything, including the leader
  streaming the block over its ~213–240 ms slot).
- **103 ms** (Valid Blocks) = their node's vote-latency-style finalization
  measure.
- **218 ms** = slot first announced → rooted, at our observer, over the
  internet.

Different intervals, all labeled, all mutually consistent. No number in this
repo is presented as something it isn't.
