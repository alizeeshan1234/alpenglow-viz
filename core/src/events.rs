use crate::types::*;
use serde::Serialize;

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "type")]
pub enum SimEvent {
    BlockProposed { slot: u64, block: BlockId, leader: ValidatorId },
    VoteCast(Vote),
    CertFormed(Certificate),
    Notarized { slot: u64, block: BlockId },
    Finalized { slot: u64, block: BlockId, fast: bool },
    Skipped { slot: u64 },
    Idle,
}