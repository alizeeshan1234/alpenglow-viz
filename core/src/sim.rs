use crate::types::*;
use std::collections::HashMap;

use crate::events::*;
use crate::threshold::*;
use serde::Serialize;

pub struct Simulation {
    validator: Vec<Validator>,
    total_stake: Stake,
    slot: u64,
    pending: Vec<Vote>,
    cursor: usize,
    notarize_stake: HashMap<BlockId, Stake>,
    notarize_voters: HashMap<BlockId, Vec<ValidatorId>>,
    skip_stake: Stake,
    finalize_stake: Stake,
    certs: Vec<Certificate>,
    notarized_block: Option<BlockId>,
    finalized: bool,
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
            skip_stake: 0,
            finalize_stake: 0,
            certs: Vec::new(),
            notarized_block: None,
            finalized: false,
        }
    }

    pub fn load(&mut self, slot: u64, votes: Vec<Vote>) {
        self.slot = slot;
        self.pending = votes;
        self.cursor = 0;
        self.notarize_stake.clear();
        self.notarize_voters.clear();
        self.skip_stake = 0;
        self.finalize_stake = 0;
        self.certs.clear();
        self.notarized_block = None;
        self.finalized = false;
    }

    pub fn validators(&self) -> &[Validator] {
        &self.validator
    }

    pub fn snapshot(&self) -> Snapshot {
        let mut notarize: Vec<(BlockId, Stake)> =
            self.notarize_stake.iter().map(|(b, s)| (*b, *s)).collect();
        notarize.sort_by_key(|(b, _)| b.0);
        Snapshot {
            validators: self.validator.clone(),
            total_stake: self.total_stake,
            slot: self.slot,
            cursor: self.cursor,
            pending_len: self.pending.len(),
            notarize,
            skip_stake: self.skip_stake,
            finalize_stake: self.finalize_stake,
            certs: self.certs.clone(),
            notarized_block: self.notarized_block,
            finalized: self.finalized,
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
            VoteKind::Skip => {
                self.skip_stake += voter_stake;

                let already_skipped = self.certs.iter().any(|c| c.kind == CertKind::Skip);
                if !already_skipped && meets(self.skip_stake, self.total_stake, SKIP) {
                    let voters = self.pending[..self.cursor]
                        .iter()
                        .filter(|v| v.kind == VoteKind::Skip)
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
                            .filter(|v| v.kind == VoteKind::Finalize)
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
            VoteKind::NotarizeFallback(_) | VoteKind::SkipFallback => {
                // fallback votes not modeled yet
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
    pub skip_stake: Stake,
    pub finalize_stake: Stake,
    pub certs: Vec<Certificate>,
    pub notarized_block: Option<BlockId>,
    pub finalized: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn notarize_cert_forms_at_sixty_percent() {
        let validators: Vec<Validator> = (0..10)
            .map(|id| Validator {
                id,
                stake: 10,
                label: format!("v{id}"),
                byzantine: false,
            })
            .collect();
        let mut sim = Simulation::new(validators);

        let votes: Vec<Vote> = (0..6)
            .map(|id| Vote {
                validator_id: id,
                slot: 0,
                kind: VoteKind::Notarize(BlockId(0)),
            })
            .collect();

        sim.load(0, votes);
        for _ in 0..6 {
            sim.step();
        }

        assert!(sim
            .certs
            .iter()
            .any(|c| c.kind == CertKind::Notarize(BlockId(0))));
    }

}