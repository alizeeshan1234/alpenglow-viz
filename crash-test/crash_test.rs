//! Alpenglow Crash Test harness.
//!
//! Boots a real TowerBFT or Alpenglow `LocalCluster`, warms it up until it is
//! finalizing, injects an offline-stake fault, then measures whether the cluster
//! keeps finalizing or stalls. Emits one machine-parseable
//! `CRASH_RESULT ...` line per run, consumed by the Crash Test report.
//!
//! Deliberately avoids `spend_and_verify_all_nodes` (its strict gossip-discovery
//! assertion is flaky on loaded machines); finalization is measured directly via
//! RPC `getSlot(finalized)` polling of the alive nodes.

use {
    serial_test::serial,
    solana_commitment_config::CommitmentConfig,
    solana_core::validator::ValidatorConfig,
    solana_epoch_schedule::MINIMUM_SLOTS_PER_EPOCH,
    solana_keypair::{keypair_from_seed, Keypair},
    solana_local_cluster::{
        cluster::Cluster,
        integration_tests::{ValidatorKeys, AG_DEBUG_LOG_FILTER, DEFAULT_NODE_STAKE},
        local_cluster::{ClusterConfig, LocalCluster},
        validator_configs::make_identical_validator_configs,
    },
    solana_net_utils::SocketAddrSpace,
    solana_poh_config::PohConfig,
    solana_pubkey::Pubkey,
    solana_rpc_client::rpc_client::RpcClient,
    solana_signer::Signer,
    std::{
        sync::Arc,
        thread::sleep,
        time::{Duration, Instant},
    },
};

/// Tight-poll one node: timestamp each slot when first seen at `processed`,
/// again when first seen at `finalized`. The per-slot delta is that slot's
/// wall-clock time-to-finality on this machine; `depths` records the
/// processed→finalized slot gap each iteration (protocol-defined, and thus
/// meaningful even though every node is colocated).
///
/// Slots already processed before the loop starts are excluded — a slot only
/// yields a sample if both of its timestamps were observed by this loop.
fn measure_latency(rpc: &RpcClient, window: Duration) -> (Vec<f64>, Vec<u64>) {
    let start = Instant::now();
    let mut t_processed: std::collections::HashMap<u64, Instant> = Default::default();
    let mut deltas_ms: Vec<f64> = Vec::new();
    let mut depths: Vec<u64> = Vec::new();
    let mut hi_processed: Option<u64> = None;
    let mut hi_finalized: Option<u64> = None;

    while start.elapsed() < window {
        let p = rpc.get_slot_with_commitment(CommitmentConfig::processed());
        let f = rpc.get_slot_with_commitment(CommitmentConfig::finalized());
        let now = Instant::now();
        if let (Ok(p), Ok(f)) = (p, f) {
            match hi_processed {
                None => {
                    t_processed.insert(p, now);
                }
                Some(hp) => {
                    for s in (hp + 1)..=p {
                        t_processed.insert(s, now);
                    }
                }
            }
            hi_processed = Some(hi_processed.map_or(p, |hp| hp.max(p)));
            if let Some(hf) = hi_finalized {
                for s in (hf + 1)..=f {
                    if let Some(t0) = t_processed.remove(&s) {
                        deltas_ms.push(now.duration_since(t0).as_secs_f64() * 1000.0);
                    }
                }
            }
            hi_finalized = Some(hi_finalized.map_or(f, |hf| hf.max(f)));
            depths.push(p.saturating_sub(f));
        }
        sleep(Duration::from_millis(2));
    }
    (deltas_ms, depths)
}

fn pctl_f64(sorted: &[f64], p: f64) -> f64 {
    if sorted.is_empty() {
        return f64::NAN;
    }
    let idx = ((p / 100.0) * sorted.len() as f64).floor() as usize;
    sorted[idx.min(sorted.len() - 1)]
}

fn pctl_u64(sorted: &[u64], p: f64) -> u64 {
    if sorted.is_empty() {
        return 0;
    }
    let idx = ((p / 100.0) * sorted.len() as f64).floor() as usize;
    sorted[idx.min(sorted.len() - 1)]
}

/// Minimum finalized slot across the given alive nodes, or `None` if none respond.
fn min_finalized(cluster: &LocalCluster, pubkeys: &[Pubkey]) -> Option<u64> {
    let mut min = u64::MAX;
    let mut any = false;
    for pk in pubkeys {
        if let Some(ci) = cluster.get_contact_info(pk) {
            if let Some(addr) = ci.rpc() {
                let rpc = RpcClient::new(format!("http://{addr}"));
                if let Ok(slot) = rpc.get_slot_with_commitment(CommitmentConfig::finalized()) {
                    any = true;
                    min = min.min(slot);
                }
            }
        }
    }
    any.then_some(min)
}

/// Poll until the alive nodes gain `target` new finalized slots past `baseline`,
/// or `window` elapses. Returns (new_roots_observed, seconds_elapsed, finalized).
fn measure_finalization(
    cluster: &LocalCluster,
    alive: &[Pubkey],
    baseline: u64,
    target: u64,
    window: Duration,
) -> (u64, f64, bool) {
    let start = Instant::now();
    let mut best = 0u64;
    while start.elapsed() < window {
        if let Some(cur) = min_finalized(cluster, alive) {
            best = best.max(cur.saturating_sub(baseline));
            if best >= target {
                return (best, start.elapsed().as_secs_f64(), true);
            }
        }
        sleep(Duration::from_millis(400));
    }
    (best, start.elapsed().as_secs_f64(), false)
}

/// One crash-test run: N nodes, `num_offline` taken offline after warmup.
fn run_crash_scenario(num_nodes: usize, num_offline: usize, alpenglow: bool) {
    agave_logger::setup_with_default(AG_DEBUG_LOG_FILTER);
    let pct = num_offline as f64 / num_nodes as f64 * 100.0;
    let consensus = if alpenglow { "alpenglow" } else { "tower" };

    let validator_keys = (0..num_nodes)
        .map(|i| {
            (
                ValidatorKeys {
                    node_keypair: Arc::new(keypair_from_seed(&[i as u8; 32]).unwrap()),
                    vote_keypair: Arc::new(Keypair::new()),
                },
                true,
            )
        })
        .collect::<Vec<_>>();

    let mut validator_config = ValidatorConfig::default_for_test();
    validator_config.wait_for_supermajority = Some(0);
    let mut config = ClusterConfig {
        validator_configs: make_identical_validator_configs(&validator_config, num_nodes),
        validator_keys: Some(validator_keys.clone()),
        node_stakes: vec![DEFAULT_NODE_STAKE; num_nodes],
        // Alpenglow's own local-cluster test uses accelerated 8-tick slots.
        // Legacy Tower needs the normal 64-tick cadence here: with 8-tick
        // slots, five validators can fork before gossip converges and wedge a
        // healthy baseline at root 0. We compare liveness, never wall time,
        // across the two modes.
        ticks_per_slot: if alpenglow { 8 } else { 64 },
        slots_per_epoch: MINIMUM_SLOTS_PER_EPOCH * 2,
        stakers_slot_offset: MINIMUM_SLOTS_PER_EPOCH * 2,
        poh_config: PohConfig {
            target_tick_duration: PohConfig::default().target_tick_duration,
            hashes_per_tick: None,
            target_tick_count: None,
        },
        ..ClusterConfig::default()
    };

    let mut cluster = if alpenglow {
        LocalCluster::new_alpenglow(&mut config, SocketAddrSpace::Unspecified)
    } else {
        LocalCluster::new(&mut config, SocketAddrSpace::Unspecified)
    };
    assert_eq!(cluster.validators.len(), num_nodes);

    // --- Warmup: wait until the healthy cluster is finalizing. ---
    // Tower finality trails the tip by roughly 32 slots. Requiring slot 40 makes
    // sure both modes have reached steady state before the fault is injected.
    let all_pubkeys = cluster.get_node_pubkeys();
    let warmup = Instant::now();
    let warmup_cap = if alpenglow { 90 } else { 180 };
    let mut warm_ok = false;
    while warmup.elapsed() < Duration::from_secs(warmup_cap) {
        if let Some(s) = min_finalized(&cluster, &all_pubkeys) {
            if s >= 40 {
                warm_ok = true;
                break;
            }
        }
        sleep(Duration::from_millis(400));
    }
    assert!(
        warm_ok,
        "{consensus} healthy cluster failed to reach finalized slot 40"
    );

    // --- Inject fault: take `num_offline` nodes offline. ---
    if num_offline > 0 {
        for (key, _) in validator_keys.iter().take(num_offline) {
            cluster.exit_node(&key.node_keypair.pubkey());
        }
    }

    // Alive nodes only (exited nodes are removed from the validator set).
    let alive = cluster.get_node_pubkeys();
    // Drain votes cast before the fault. Otherwise Tower can appear live for a
    // few roots even when no new supermajority can form after the fault.
    let settle = Duration::from_secs(5);
    sleep(settle);
    let baseline = min_finalized(&cluster, &alive).unwrap_or(0);

    // --- Measure: does it sustain finalization under the fault? ---
    let target = 16u64;
    let (new_roots, secs, finalized) =
        measure_finalization(&cluster, &alive, baseline, target, Duration::from_secs(60));

    let outcome = if finalized { "FINALIZED" } else { "STALLED" };
    // Single machine-parseable line for the report generator.
    println!(
        "CRASH_RESULT consensus={consensus} nodes={num_nodes} offline={num_offline} \
         pct={pct:.1} warm_ok={warm_ok} outcome={outcome} new_roots={new_roots} \
         target={target} secs={secs:.1} settle_secs={} baseline_slot={baseline}",
        settle.as_secs(),
    );
}

#[test]
#[serial]
fn crash_4node_0offline() {
    run_crash_scenario(4, 0, true);
}

#[test]
#[serial]
fn crash_4node_1offline() {
    run_crash_scenario(4, 1, true);
}

#[test]
#[serial]
fn crash_4node_2offline() {
    run_crash_scenario(4, 2, true);
}

#[test]
#[serial]
fn crash_4node_3offline() {
    run_crash_scenario(4, 3, true);
}

// 5-node sweep pins the boundary: 2/5 offline = 40% offline = exactly 60% online
// (the finalization threshold edge — should still finalize), 3/5 = 40% online (stall).
#[test]
#[serial]
fn crash_5node_0offline() {
    run_crash_scenario(5, 0, true);
}

#[test]
#[serial]
fn crash_5node_1offline() {
    run_crash_scenario(5, 1, true);
}

#[test]
#[serial]
fn crash_5node_2offline() {
    run_crash_scenario(5, 2, true);
}

#[test]
#[serial]
fn crash_5node_3offline() {
    run_crash_scenario(5, 3, true);
}

// TowerBFT control runs — identical clusters/faults, old consensus. Tower needs a
// 2/3 (66.7%) supermajority vs Alpenglow's 60%, so 40% offline (60% online) should
// STALL under Tower while Alpenglow finalizes — the before/after.
#[test]
#[serial]
fn crash_tower_5node_0offline() {
    run_crash_scenario(5, 0, false);
}

#[test]
#[serial]
fn crash_tower_5node_1offline() {
    run_crash_scenario(5, 1, false);
}

#[test]
#[serial]
fn crash_tower_5node_2offline() {
    run_crash_scenario(5, 2, false);
}

/// Finality-latency run: boot, warm up, optionally inject an offline fault,
/// then tight-poll one alive node and measure per-slot processed→finalized
/// wall time plus the slot-depth gap.
///
/// Cross-consensus comparisons use the slot-depth gap only (Alpenglow ~1 slot
/// vs Tower ~32 — protocol-defined, colocation-immune). Millisecond numbers
/// are only compared *within* one consensus mode at one cadence (the
/// Alpenglow offline sweep), never across modes or to a real network.
fn run_finality_scenario(num_nodes: usize, num_offline: usize, alpenglow: bool) {
    agave_logger::setup_with_default(AG_DEBUG_LOG_FILTER);
    let pct = num_offline as f64 / num_nodes as f64 * 100.0;
    let consensus = if alpenglow { "alpenglow" } else { "tower" };
    let ticks_per_slot: u64 = if alpenglow { 8 } else { 64 };

    let validator_keys = (0..num_nodes)
        .map(|i| {
            (
                ValidatorKeys {
                    node_keypair: Arc::new(keypair_from_seed(&[i as u8; 32]).unwrap()),
                    vote_keypair: Arc::new(Keypair::new()),
                },
                true,
            )
        })
        .collect::<Vec<_>>();

    let mut validator_config = ValidatorConfig::default_for_test();
    validator_config.wait_for_supermajority = Some(0);
    let mut config = ClusterConfig {
        validator_configs: make_identical_validator_configs(&validator_config, num_nodes),
        validator_keys: Some(validator_keys.clone()),
        node_stakes: vec![DEFAULT_NODE_STAKE; num_nodes],
        ticks_per_slot,
        slots_per_epoch: MINIMUM_SLOTS_PER_EPOCH * 2,
        stakers_slot_offset: MINIMUM_SLOTS_PER_EPOCH * 2,
        poh_config: PohConfig {
            target_tick_duration: PohConfig::default().target_tick_duration,
            hashes_per_tick: None,
            target_tick_count: None,
        },
        ..ClusterConfig::default()
    };

    let mut cluster = if alpenglow {
        LocalCluster::new_alpenglow(&mut config, SocketAddrSpace::Unspecified)
    } else {
        LocalCluster::new(&mut config, SocketAddrSpace::Unspecified)
    };
    assert_eq!(cluster.validators.len(), num_nodes);

    // Warmup: identical bar to the crash scenarios — finalized slot 40.
    let all_pubkeys = cluster.get_node_pubkeys();
    let warmup = Instant::now();
    let warmup_cap = if alpenglow { 90 } else { 180 };
    let mut warm_ok = false;
    while warmup.elapsed() < Duration::from_secs(warmup_cap) {
        if let Some(s) = min_finalized(&cluster, &all_pubkeys) {
            if s >= 40 {
                warm_ok = true;
                break;
            }
        }
        sleep(Duration::from_millis(400));
    }
    assert!(
        warm_ok,
        "{consensus} healthy cluster failed to reach finalized slot 40"
    );

    if num_offline > 0 {
        for (key, _) in validator_keys.iter().take(num_offline) {
            cluster.exit_node(&key.node_keypair.pubkey());
        }
        // Let pre-fault votes drain so we measure steady state under the fault.
        sleep(Duration::from_secs(5));
    }

    let alive = cluster.get_node_pubkeys();
    let rpc_addr = alive
        .iter()
        .find_map(|pk| cluster.get_contact_info(pk).and_then(|ci| ci.rpc()))
        .expect("no alive node exposes RPC");
    let rpc = RpcClient::new(format!("http://{rpc_addr}"));

    // Tower's finality pipeline is ~32 slots deep (~12.8 s at 400 ms slots), so
    // it needs a longer window for slots to complete their journey inside it.
    let window = Duration::from_secs(if alpenglow { 30 } else { 45 });
    let (mut deltas_ms, mut depths) = measure_latency(&rpc, window);
    deltas_ms.sort_by(|a, b| a.partial_cmp(b).unwrap());
    depths.sort_unstable();

    let outcome = if deltas_ms.len() >= 10 {
        "FINALIZED"
    } else {
        "STALLED"
    };
    println!(
        "FINALITY_RESULT consensus={consensus} nodes={num_nodes} offline={num_offline} \
         pct={pct:.1} ticks_per_slot={ticks_per_slot} window_secs={} n={} outcome={outcome} \
         p50_ms={:.1} p90_ms={:.1} min_ms={:.1} max_ms={:.1} \
         depth_p50={} depth_p90={}",
        window.as_secs(),
        deltas_ms.len(),
        pctl_f64(&deltas_ms, 50.0),
        pctl_f64(&deltas_ms, 90.0),
        deltas_ms.first().copied().unwrap_or(f64::NAN),
        deltas_ms.last().copied().unwrap_or(f64::NAN),
        pctl_u64(&depths, 50.0),
        pctl_u64(&depths, 90.0),
    );
}

// Alpenglow offline sweep: how does time-to-finality degrade as offline stake
// approaches the 40% liveness boundary? (3/5 offline stalls — covered by the
// crash sweep — so the curve ends at the measured cliff.)
#[test]
#[serial]
fn finality_alpenglow_5node_0offline() {
    run_finality_scenario(5, 0, true);
}

#[test]
#[serial]
fn finality_alpenglow_5node_1offline() {
    run_finality_scenario(5, 1, true);
}

#[test]
#[serial]
fn finality_alpenglow_5node_2offline() {
    run_finality_scenario(5, 2, true);
}

// TowerBFT control on identical hardware: compared via slot-depth only.
#[test]
#[serial]
fn finality_tower_5node_0offline() {
    run_finality_scenario(5, 0, false);
}
