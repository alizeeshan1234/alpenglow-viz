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
    finalize_stake: Stake,
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
            finalize_stake: 0,
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
        self.finalize_stake = 0;
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

        events.push(SimEvent::VoteCast(vote));

        let voter_stake = self.validator[vote.validator_id].stake;

        match vote.kind {
            VoteKind::Notarize(block_id) => {
                *self.notarize_stake.entry(block_id).or_insert(0) += voter_stake;
                self.notarize_voters
                    .entry(block_id)
                    .or_default()
                    .push(vote.validator_id);

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
            // A fallback cert counts regular notarize votes for the block too:
            // the "safe-to-notar" path after an equivocation split.
            VoteKind::NotarizeFallback(block_id) => {
                *self.notar_fallback_stake.entry(block_id).or_insert(0) += voter_stake;
                self.notar_fallback_voters
                    .entry(block_id)
                    .or_default()
                    .push(vote.validator_id);

                let combined = self.notarize_stake.get(&block_id).copied().unwrap_or(0)
                    + self.notar_fallback_stake[&block_id];

                let already = self
                    .certs
                    .iter()
                    .any(|c| c.kind == CertKind::NotarizeFallback(block_id));
                if !already && meets(combined, self.total_stake, NOTARIZE) {
                    let mut voters = self
                        .notarize_voters
                        .get(&block_id)
                        .cloned()
                        .unwrap_or_default();
                    voters.extend(self.notar_fallback_voters[&block_id].iter().copied());
                    let cert = Certificate {
                        slot: self.slot,
                        kind: CertKind::NotarizeFallback(block_id),
                        stake: combined,
                        voters,
                    };
                    events.push(SimEvent::CertFormed(cert.clone()));
                    self.certs.push(cert);
                    if self.notarized_block.is_none() {
                        self.notarized_block = Some(block_id);
                        events.push(SimEvent::Notarized {
                            slot: self.slot,
                            block: block_id,
                        });
                    }
                }
            }
            // Skip-fallback votes count toward the same skip certificate.
            VoteKind::Skip | VoteKind::SkipFallback => {
                self.skip_stake += voter_stake;

                let already_skipped = self.certs.iter().any(|c| c.kind == CertKind::Skip);
                if !already_skipped && meets(self.skip_stake, self.total_stake, SKIP) {
                    let voters = self.pending[..self.cursor]
                        .iter()
                        .filter(|v| {
                            matches!(v.kind, VoteKind::Skip | VoteKind::SkipFallback)
                                && !self.offline.contains(&v.validator_id)
                        })
                        .map(|v| v.validator_id)
                        .collect();
                    let cert = Certificate {
                        slot: self.slot,
                        kind: CertKind::Skip,
                        stake: self.skip_stake,
                        voters,
                    };
                    events.push(SimEvent::CertFormed(cert.clone()));
                    self.certs.push(cert);
                    events.push(SimEvent::Skipped { slot: self.slot });
                }
            }
            VoteKind::Finalize => {
                self.finalize_stake += voter_stake;

                if !self.finalized && meets(self.finalize_stake, self.total_stake, FINALIZE) {
                    if let Some(block_id) = self.notarized_block {
                        self.finalized = true;
                        let voters = self.pending[..self.cursor]
                            .iter()
                            .filter(|v| {
                                v.kind == VoteKind::Finalize
                                    && !self.offline.contains(&v.validator_id)
                            })
                            .map(|v| v.validator_id)
                            .collect();
                        let cert = Certificate {
                            slot: self.slot,
                            kind: CertKind::Finalize,
                            stake: self.finalize_stake,
                            voters,
                        };
                        events.push(SimEvent::CertFormed(cert.clone()));
                        self.certs.push(cert);
                        events.push(SimEvent::Finalized {
                            slot: self.slot,
                            block: block_id,
                            fast: false,
                        });
                    }
                }
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

        assert!(sim
            .certs
            .iter()
            .any(|c| c.kind == CertKind::Notarize(BlockId(0))));
    }

    #[test]
    fn split_vote_rescued_by_fallback() {
        let validators = ten_equal_validators();
        let mut sim = Simulation::new(validators.clone());
        let (slot, votes) = scenarios::preset("split", &validators);
        sim.load(slot, votes);
        run_to_end(&mut sim);

        // Neither block reached 60% on plain notarize votes...
        assert!(!sim
            .certs
            .iter()
            .any(|c| matches!(c.kind, CertKind::Notarize(_))));
        // ...but the fallback cert rescued block A.
        assert!(sim
            .certs
            .iter()
            .any(|c| c.kind == CertKind::NotarizeFallback(BlockId(0))));
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
}
