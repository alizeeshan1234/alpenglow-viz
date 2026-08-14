//! Alpenglow Crash Test harness.
//!
//! Boots a real Alpenglow `LocalCluster`, warms it up until it is finalizing,
//! injects an offline-stake fault, then measures whether the cluster keeps
//! finalizing (and how fast) or stalls. Emits one machine-parseable
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
    solana_keypair::{Keypair, keypair_from_seed},
    solana_local_cluster::{
        cluster::Cluster,
        integration_tests::{AG_DEBUG_LOG_FILTER, DEFAULT_NODE_STAKE, ValidatorKeys},
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
fn run_crash_scenario(num_nodes: usize, num_offline: usize) {
    agave_logger::setup_with_default(AG_DEBUG_LOG_FILTER);
    let pct = num_offline as f64 / num_nodes as f64 * 100.0;

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
        ticks_per_slot: 8,
        slots_per_epoch: MINIMUM_SLOTS_PER_EPOCH * 2,
        stakers_slot_offset: MINIMUM_SLOTS_PER_EPOCH * 2,
        poh_config: PohConfig {
            target_tick_duration: PohConfig::default().target_tick_duration,
            hashes_per_tick: None,
            target_tick_count: None,
        },
        ..ClusterConfig::default()
    };

    let mut cluster = LocalCluster::new_alpenglow(&mut config, SocketAddrSpace::Unspecified);
    assert_eq!(cluster.validators.len(), num_nodes);

    // --- Warmup: wait until the healthy cluster is finalizing. ---
    let all_pubkeys = cluster.get_node_pubkeys();
    let warmup = Instant::now();
    let mut warm_ok = false;
    while warmup.elapsed() < Duration::from_secs(90) {
        if let Some(s) = min_finalized(&cluster, &all_pubkeys) {
            if s >= 3 {
                warm_ok = true;
                break;
            }
        }
        sleep(Duration::from_millis(400));
    }

    // --- Inject fault: take `num_offline` nodes offline. ---
    if num_offline > 0 {
        for (key, _) in validator_keys.iter().take(num_offline) {
            cluster.exit_node(&key.node_keypair.pubkey());
        }
    }

    // Alive nodes only (exited nodes are removed from the validator set).
    let alive = cluster.get_node_pubkeys();
    let baseline = min_finalized(&cluster, &alive).unwrap_or(0);

    // --- Measure: does it keep finalizing under the fault? ---
    let target = 8u64;
    let (new_roots, secs, finalized) =
        measure_finalization(&cluster, &alive, baseline, target, Duration::from_secs(60));

    let outcome = if finalized { "FINALIZED" } else { "STALLED" };
    // Single machine-parseable line for the report generator.
    println!(
        "CRASH_RESULT nodes={num_nodes} offline={num_offline} pct={pct:.1} \
         warm_ok={warm_ok} outcome={outcome} new_roots={new_roots} \
         target={target} secs={secs:.1} baseline_slot={baseline}"
    );
}

#[test]
#[serial]
fn crash_4node_0offline() {
    run_crash_scenario(4, 0);
}

#[test]
#[serial]
fn crash_4node_1offline() {
    run_crash_scenario(4, 1);
}

#[test]
#[serial]
fn crash_4node_2offline() {
    run_crash_scenario(4, 2);
}

#[test]
#[serial]
fn crash_4node_3offline() {
    run_crash_scenario(4, 3);
}

// 5-node sweep pins the boundary: 2/5 offline = 40% offline = exactly 60% online
// (the finalization threshold edge — should still finalize), 3/5 = 40% online (stall).
#[test]
#[serial]
fn crash_5node_0offline() {
    run_crash_scenario(5, 0);
}

#[test]
#[serial]
fn crash_5node_1offline() {
    run_crash_scenario(5, 1);
}

#[test]
#[serial]
fn crash_5node_2offline() {
    run_crash_scenario(5, 2);
}

#[test]
#[serial]
fn crash_5node_3offline() {
    run_crash_scenario(5, 3);
}
