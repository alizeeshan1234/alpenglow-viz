use serde::Serialize;

pub type Stake = u64;
pub type ValidatorId = usize;

#[derive(Clone, Debug, Serialize)]
pub struct Validator {
    pub id: ValidatorId,
    pub stake: Stake,
    pub label: String,
    pub byzantine: bool,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq, Hash)]
pub struct BlockId(pub u8);

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq, Hash)]
pub enum VoteKind {
    Notarize(BlockId),
    Skip,
    Finalize,
    NotarizeFallback(BlockId),
    SkipFallback,
}

#[derive(Clone, Copy, Debug, Serialize)]
pub struct Vote {
    pub validator_id: ValidatorId,
    pub slot: u64,
    pub kind: VoteKind,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug, Serialize)]
pub enum CertKind {
    Notarize(BlockId),
    NotarizeFallback(BlockId),
    Finalize,
    FinalizeFast(BlockId),
    Skip,
}

#[derive(Debug, Serialize, Clone)]
pub struct Certificate {
    pub slot: u64,
    pub kind: CertKind,
    pub stake: Stake,
    pub voters: Vec<ValidatorId>,
}