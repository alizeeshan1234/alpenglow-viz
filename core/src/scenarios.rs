use crate::types::*;

/// Returns `(slot, ordered vote script)` for a named preset.
/// The order of votes is the order `step()` plays them — i.e. the animation order.
pub fn preset(name: &str, validators: &[Validator]) -> (u64, Vec<Vote>) {
    let slot = 1;
    match name {
        // Happy path: every validator notarizes block A.
        // Crosses 60% (Notarized) then 80% (Finalized fast).
        "fast" => {
            let votes = validators
                .iter()
                .map(|v| Vote {
                    validator_id: v.id,
                    slot,
                    kind: VoteKind::Notarize(BlockId(0)),
                })
                .collect();
            (slot, votes)
        }

        // Leader offline: everyone votes to skip the slot.
        "offline" => {
            let votes = validators
                .iter()
                .map(|v| Vote {
                    validator_id: v.id,
                    slot,
                    kind: VoteKind::Skip,
                })
                .collect();
            (slot, votes)
        }

        // Two-step (slow) finality: just enough stake to pass 60% notarize
        // (but under 80%, so no fast path), then those same validators finalize.
        "slow" => {
            let total: Stake = validators.iter().map(|v| v.stake).sum();
            let mut acc: Stake = 0;
            let mut quorum: Vec<ValidatorId> = Vec::new();
            for v in validators {
                if (acc as u128) * 100 >= 60u128 * (total as u128) {
                    break;
                }
                acc += v.stake;
                quorum.push(v.id);
            }
            let mut votes: Vec<Vote> = quorum
                .iter()
                .map(|&id| Vote {
                    validator_id: id,
                    slot,
                    kind: VoteKind::Notarize(BlockId(0)),
                })
                .collect();
            votes.extend(quorum.iter().map(|&id| Vote {
                validator_id: id,
                slot,
                kind: VoteKind::Finalize,
            }));
            (slot, votes)
        }

        // Byzantine leader equivocates: it signed block A *and* block B, so the
        // honest majority splits ~50/50 and neither block reaches 60%. Once the
        // split is visible, the B camp casts notarize-fallback votes for A
        // ("safe-to-notar") and the slot is rescued.
        //
        // Camps are balanced by *stake*, not by count, so the story holds for
        // wildly uneven distributions (i.e. real mainnet stake).
        "split" => {
            let mut camp_a: Vec<ValidatorId> = Vec::new();
            let mut camp_b: Vec<ValidatorId> = Vec::new();
            let (mut stake_a, mut stake_b): (Stake, Stake) = (0, 0);
            // Greedy split on stake-descending order (LPT): balances even when
            // one entry aggregates a large long tail (e.g. mainnet's "Other
            // validators" tile), keeping both camps under the 60% threshold.
            let mut by_stake: Vec<&Validator> = validators.iter().collect();
            by_stake.sort_by(|a, b| b.stake.cmp(&a.stake));
            for v in by_stake {
                if stake_a <= stake_b {
                    stake_a += v.stake;
                    camp_a.push(v.id);
                } else {
                    stake_b += v.stake;
                    camp_b.push(v.id);
                }
            }
            // Interleave A and B votes so the two bars race on screen.
            let mut votes: Vec<Vote> = Vec::new();
            let mut a = camp_a.iter();
            let mut b = camp_b.iter();
            loop {
                let (va, vb) = (a.next(), b.next());
                if va.is_none() && vb.is_none() {
                    break;
                }
                if let Some(&id) = va {
                    votes.push(Vote {
                        validator_id: id,
                        slot,
                        kind: VoteKind::Notarize(BlockId(0)),
                    });
                }
                if let Some(&id) = vb {
                    votes.push(Vote {
                        validator_id: id,
                        slot,
                        kind: VoteKind::Notarize(BlockId(1)),
                    });
                }
            }
            for &id in &camp_b {
                votes.push(Vote {
                    validator_id: id,
                    slot,
                    kind: VoteKind::NotarizeFallback(BlockId(0)),
                });
            }
            (slot, votes)
        }

        _ => (0, Vec::new()),
    }
}
