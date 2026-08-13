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

        _ => (0, Vec::new()),
    }
}
