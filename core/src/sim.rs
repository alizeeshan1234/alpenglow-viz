use crate::events::*;
use crate::threshold::*;
use crate::types::*;
use serde::Serialize;
use std::collections::{HashMap, HashSet};

pub struct Simulation {
    validator: Vec<Validator>,
    total_stake: Stake,
    slot: u64,
    pending: Vec<Vote>,
    cursor: usize,
    notarize_stake: HashMap<BlockId, Stake>,
    notarize_voters: HashMap<BlockId, Vec<ValidatorId>>,
    notar_fallback_stake: HashMap<BlockId, Stake>,
    notar_fallback_voters: HashMap<BlockId, Vec<ValidatorId>>,
    skip_stake: Stake,
    skip_voters: Vec<ValidatorId>,
    finalize_stake: Stake,
    finalize_voters: Vec<ValidatorId>,
    certs: Vec<Certificate>,
    notarized_block: Option<BlockId>,
    finalized: bool,
    // Offline validators survive load() so a scenario can be replayed without them.
    offline: HashSet<ValidatorId>,
}

impl Simulation {
    pub fn new(validators: Vec<Validator>) -> Self {
        let total_stake = validators.iter().map(|v| v.stake).sum();
        Self {
            validator: validators,
            total_stake,
            slot: 0,
            pending: Vec::new(),
            cursor: 0,
            notarize_stake: HashMap::new(),
            notarize_voters: HashMap::new(),
            notar_fallback_stake: HashMap::new(),
            notar_fallback_voters: HashMap::new(),
            skip_stake: 0,
            skip_voters: Vec::new(),
            finalize_stake: 0,
            finalize_voters: Vec::new(),
            certs: Vec::new(),
            notarized_block: None,
            finalized: false,
            offline: HashSet::new(),
        }
    }

    pub fn load(&mut self, slot: u64, votes: Vec<Vote>) {
        self.slot = slot;
        self.pending = votes;
        self.cursor = 0;
        self.notarize_stake.clear();
        self.notarize_voters.clear();
        self.notar_fallback_stake.clear();
        self.notar_fallback_voters.clear();
        self.skip_stake = 0;
        self.skip_voters.clear();
        self.finalize_stake = 0;
        self.finalize_voters.clear();
        self.certs.clear();
        self.notarized_block = None;
        self.finalized = false;
    }

    pub fn validators(&self) -> &[Validator] {
        &self.validator
    }

    pub fn toggle_offline(&mut self, id: ValidatorId) {
        if !self.offline.remove(&id) {
            self.offline.insert(id);
        }
    }

    pub fn set_byzantine(&mut self, id: ValidatorId, byzantine: bool) {
        if let Some(v) = self.validator.get_mut(id) {
            v.byzantine = byzantine;
        }
    }

    /// Completes slow-path finality whenever both conditions hold, in either
    /// arrival order: a notarized block and >=60% Finalize stake.
    fn maybe_slow_finalize(&mut self, events: &mut Vec<SimEvent>) {
        if self.finalized {
            return;
        }
        let Some(block_id) = self.notarized_block else {
            return;
        };
        if !meets(self.finalize_stake, self.total_stake, FINALIZE) {
            return;
        }
        self.finalized = true;
        let cert = Certificate {
            slot: self.slot,
            kind: CertKind::Finalize,
            stake: self.finalize_stake,
            voters: self.finalize_voters.clone(),
        };
        events.push(SimEvent::CertFormed(cert.clone()));
        self.certs.push(cert);
        events.push(SimEvent::Finalized {
            slot: self.slot,
            block: block_id,
            fast: false,
        });
    }

    pub fn snapshot(&self) -> Snapshot {
        let mut notarize: Vec<(BlockId, Stake)> =
            self.notarize_stake.iter().map(|(b, s)| (*b, *s)).collect();
        notarize.sort_by_key(|(b, _)| b.0);
        let mut notar_fallback: Vec<(BlockId, Stake)> = self
            .notar_fallback_stake
            .iter()
            .map(|(b, s)| (*b, *s))
            .collect();
        notar_fallback.sort_by_key(|(b, _)| b.0);
        let mut offline: Vec<ValidatorId> = self.offline.iter().copied().collect();
        offline.sort();
        Snapshot {
            validators: self.validator.clone(),
            total_stake: self.total_stake,
            slot: self.slot,
            cursor: self.cursor,
            pending_len: self.pending.len(),
            notarize,
            notar_fallback,
            skip_stake: self.skip_stake,
            finalize_stake: self.finalize_stake,
            certs: self.certs.clone(),
            notarized_block: self.notarized_block,
            finalized: self.finalized,
            offline,
        }
    }

    pub fn step(&mut self) -> Vec<SimEvent> {
        let mut events = Vec::new();

        if self.cursor >= self.pending.len() {
            events.push(SimEvent::Idle);
            return events;
        }

        let vote = self.pending[self.cursor];
        self.cursor += 1;

        // An offline validator's vote never reaches the network.
        if self.offline.contains(&vote.validator_id) {
            events.push(SimEvent::VoteDropped {
                validator: vote.validator_id,
            });
            return events;
        }

        // Unknown validator ids are dropped rather than panicking.
        let Some(voter) = self.validator.get(vote.validator_id) else {
            events.push(SimEvent::VoteDropped {
                validator: vote.validator_id,
            });
            return events;
        };
        let voter_stake = voter.stake;

        events.push(SimEvent::VoteCast(vote));

        match vote.kind {
            VoteKind::Notarize(block_id) => {
                // One notarize vote per validator per block: duplicates are inert.
                let voters = self.notarize_voters.entry(block_id).or_default();
                if voters.contains(&vote.validator_id) {
                    return events;
                }
                voters.push(vote.validator_id);
                *self.notarize_stake.entry(block_id).or_insert(0) += voter_stake;

                let stake = self.notarize_stake[&block_id];

                if self.notarized_block.is_none() && meets(stake, self.total_stake, NOTARIZE) {
                    self.notarized_block = Some(block_id);
                    let cert = Certificate {
                        slot: self.slot,
                        kind: CertKind::Notarize(block_id),
                        stake,
                        voters: self.notarize_voters[&block_id].clone(),
                    };
                    events.push(SimEvent::CertFormed(cert.clone()));
                    self.certs.push(cert);
                    events.push(SimEvent::Notarized {
                        slot: self.slot,
                        block: block_id,
                    });
                    // Slow-path finality is order-invariant: if enough Finalize
                    // stake arrived before notarization, it completes now.
                    self.maybe_slow_finalize(&mut events);
                }

                if !self.finalized && meets(stake, self.total_stake, FASTFINALIZE) {
                    self.finalized = true;
                    let cert = Certificate {
                        slot: self.slot,
                        kind: CertKind::FinalizeFast(block_id),
                        stake,
                        voters: self.notarize_voters[&block_id].clone(),
                    };
                    events.push(SimEvent::CertFormed(cert.clone()));
                    self.certs.push(cert);
                    events.push(SimEvent::Finalized {
                        slot: self.slot,
                        block: block_id,
                        fast: true,
                    });
                }
            }
            // A fallback cert counts each validator once across its regular
            // notarize vote and its fallback vote ("safe-to-notar").
            VoteKind::NotarizeFallback(block_id) => {
                let fallback_voters = self.notar_fallback_voters.entry(block_id).or_default();
                if fallback_voters.contains(&vote.validator_id) {
                    return events;
                }
                fallback_voters.push(vote.validator_id);
                *self.notar_fallback_stake.entry(block_id).or_insert(0) += voter_stake;

                // Union of notarize + fallback voters, each counted once.
                let mut union: Vec<ValidatorId> = self
                    .notarize_voters
                    .get(&block_id)
                    .cloned()
                    .unwrap_or_default();
                for &v in &self.notar_fallback_voters[&block_id] {
                    if !union.contains(&v) {
                        union.push(v);
                    }
                }
                let combined: Stake = union.iter().map(|&v| self.validator[v].stake).sum();

                let already = self
                    .certs
                    .iter()
                    .any(|c| c.kind == CertKind::NotarizeFallback(block_id));
                if !already && meets(combined, self.total_stake, NOTARIZE) {
                    let cert = Certificate {
                        slot: self.slot,
                        kind: CertKind::NotarizeFallback(block_id),
                        stake: combined,
                        voters: union,
                    };
                    events.push(SimEvent::CertFormed(cert.clone()));
                    self.certs.push(cert);
                    if self.notarized_block.is_none() {
                        self.notarized_block = Some(block_id);
                        events.push(SimEvent::Notarized {
                            slot: self.slot,
                            block: block_id,
                        });
                        self.maybe_slow_finalize(&mut events);
                    }
                }
            }
            // Skip and skip-fallback count toward one skip certificate, one
            // vote per validator.
            VoteKind::Skip | VoteKind::SkipFallback => {
                if self.skip_voters.contains(&vote.validator_id) {
                    return events;
                }
                self.skip_voters.push(vote.validator_id);
                self.skip_stake += voter_stake;

                let already_skipped = self.certs.iter().any(|c| c.kind == CertKind::Skip);
                if !already_skipped && meets(self.skip_stake, self.total_stake, SKIP) {
                    let cert = Certificate {
                        slot: self.slot,
                        kind: CertKind::Skip,
                        stake: self.skip_stake,
                        voters: self.skip_voters.clone(),
                    };
                    events.push(SimEvent::CertFormed(cert.clone()));
                    self.certs.push(cert);
                    events.push(SimEvent::Skipped { slot: self.slot });
                }
            }
            VoteKind::Finalize => {
                if self.finalize_voters.contains(&vote.validator_id) {
                    return events;
                }
                self.finalize_voters.push(vote.validator_id);
                self.finalize_stake += voter_stake;
                self.maybe_slow_finalize(&mut events);
            }
        }

        events
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct Snapshot {
    pub validators: Vec<Validator>,
    pub total_stake: Stake,
    pub slot: u64,
    pub cursor: usize,
    pub pending_len: usize,
    pub notarize: Vec<(BlockId, Stake)>,
    pub notar_fallback: Vec<(BlockId, Stake)>,
    pub skip_stake: Stake,
    pub finalize_stake: Stake,
    pub certs: Vec<Certificate>,
    pub notarized_block: Option<BlockId>,
    pub finalized: bool,
    pub offline: Vec<ValidatorId>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::scenarios;

    fn ten_equal_validators() -> Vec<Validator> {
        (0..10)
            .map(|id| Validator {
                id,
                stake: 10,
                label: format!("v{id}"),
                byzantine: false,
            })
            .collect()
    }

    fn run_to_end(sim: &mut Simulation) {
        while sim.cursor < sim.pending.len() {
            sim.step();
        }
    }

    #[test]
    fn notarize_cert_forms_at_sixty_percent() {
        let mut sim = Simulation::new(ten_equal_validators());

        let votes: Vec<Vote> = (0..6)
            .map(|id| Vote {
                validator_id: id,
                slot: 0,
                kind: VoteKind::Notarize(BlockId(0)),
            })
            .collect();

        sim.load(0, votes);
        run_to_end(&mut sim);

        assert!(
            sim.certs
                .iter()
                .any(|c| c.kind == CertKind::Notarize(BlockId(0)))
        );
    }

    #[test]
    fn split_vote_rescued_by_fallback() {
        let validators = ten_equal_validators();
        let mut sim = Simulation::new(validators.clone());
        let (slot, votes) = scenarios::preset("split", &validators);
        sim.load(slot, votes);
        run_to_end(&mut sim);

        // Neither block reached 60% on plain notarize votes...
        assert!(
            !sim.certs
                .iter()
                .any(|c| matches!(c.kind, CertKind::Notarize(_)))
        );
        // ...but the fallback cert rescued block A.
        assert!(
            sim.certs
                .iter()
                .any(|c| c.kind == CertKind::NotarizeFallback(BlockId(0)))
        );
        assert_eq!(sim.notarized_block, Some(BlockId(0)));
        assert!(!sim.finalized);
    }

    #[test]
    fn offline_validators_stall_consensus() {
        let validators = ten_equal_validators();
        let mut sim = Simulation::new(validators.clone());
        // Kill 5 of 10 equal-stake validators: 50% live stake < 60% threshold.
        for id in 0..5 {
            sim.toggle_offline(id);
        }
        let (slot, votes) = scenarios::preset("fast", &validators);
        sim.load(slot, votes);
        run_to_end(&mut sim);

        assert!(sim.certs.is_empty());
        assert!(!sim.finalized);

        // Bring them back and replay: fast finality again.
        for id in 0..5 {
            sim.toggle_offline(id);
        }
        let (slot, votes) = scenarios::preset("fast", &validators);
        sim.load(slot, votes);
        run_to_end(&mut sim);
        assert!(sim.finalized);
    }

    #[test]
    fn duplicate_votes_do_not_double_count() {
        let mut sim = Simulation::new(ten_equal_validators());
        // Six notarize votes, but all from the same validator: 10% of stake,
        // repeated. Must never reach the 60% notarize threshold.
        let votes: Vec<Vote> = (0..6)
            .map(|_| Vote {
                validator_id: 0,
                slot: 0,
                kind: VoteKind::Notarize(BlockId(0)),
            })
            .collect();
        sim.load(0, votes);
        run_to_end(&mut sim);
        assert!(sim.certs.is_empty());
        assert!(!sim.finalized);

        // Same for skip duplicates.
        let votes: Vec<Vote> = (0..6)
            .map(|_| Vote {
                validator_id: 0,
                slot: 0,
                kind: VoteKind::Skip,
            })
            .collect();
        sim.load(0, votes);
        run_to_end(&mut sim);
        assert!(sim.certs.is_empty());

        // A validator voting both notarize and fallback for the same block
        // counts once toward the fallback certificate.
        let mut votes: Vec<Vote> = (0..5)
            .map(|id| Vote {
                validator_id: id,
                slot: 0,
                kind: VoteKind::Notarize(BlockId(0)),
            })
            .collect();
        votes.extend((0..5).map(|id| Vote {
            validator_id: id,
            slot: 0,
            kind: VoteKind::NotarizeFallback(BlockId(0)),
        }));
        sim.load(0, votes);
        run_to_end(&mut sim);
        // 5 distinct voters = 50% < 60%: no certificate of any kind.
        assert!(sim.certs.is_empty());
    }

    #[test]
    fn slow_finality_is_arrival_order_invariant() {
        let mut sim = Simulation::new(ten_equal_validators());
        // Finalize votes arrive BEFORE the notarization quorum completes.
        let mut votes: Vec<Vote> = (0..6)
            .map(|id| Vote {
                validator_id: id,
                slot: 0,
                kind: VoteKind::Finalize,
            })
            .collect();
        votes.extend((0..6).map(|id| Vote {
            validator_id: id,
            slot: 0,
            kind: VoteKind::Notarize(BlockId(0)),
        }));
        sim.load(0, votes);
        run_to_end(&mut sim);
        assert!(sim.finalized, "slow finality must not depend on vote order");
        assert!(sim.certs.iter().any(|c| c.kind == CertKind::Finalize));
    }

    #[test]
    fn equivocation_split_survives_aggregated_whale() {
        // Mainnet-shaped set: 60 small validators plus one aggregated
        // long-tail entry holding 40% of total stake (like the site's
        // "Other validators" tile). The split preset must still produce two
        // sub-60% camps so the fallback-rescue story holds.
        let mut validators: Vec<Validator> = (0..60)
            .map(|id| Validator {
                id,
                stake: 10,
                label: format!("v{id}"),
                byzantine: false,
            })
            .collect();
        validators.push(Validator {
            id: 60,
            stake: 400,
            label: "aggregate".into(),
            byzantine: false,
        });
        let mut sim = Simulation::new(validators.clone());
        let (slot, votes) = scenarios::preset("split", &validators);
        sim.load(slot, votes);
        run_to_end(&mut sim);

        // Neither camp may reach 60% on plain notarize votes...
        assert!(
            !sim.certs
                .iter()
                .any(|c| matches!(c.kind, CertKind::Notarize(_))),
            "aggregated whale must not tip a camp past the notarize threshold"
        );
        // ...and the fallback votes must rescue the slot.
        assert!(
            sim.certs
                .iter()
                .any(|c| matches!(c.kind, CertKind::NotarizeFallback(_)))
        );
        assert!(sim.notarized_block.is_some());
    }

    #[test]
    fn unknown_validator_ids_are_dropped() {
        let mut sim = Simulation::new(ten_equal_validators());
        let votes = vec![Vote {
            validator_id: 99,
            slot: 0,
            kind: VoteKind::Notarize(BlockId(0)),
        }];
        sim.load(0, votes);
        run_to_end(&mut sim);
        assert!(sim.certs.is_empty());
    }
}
