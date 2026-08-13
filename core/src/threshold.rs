pub const NOTARIZE: usize = 60;
pub const SKIP: usize = 60;
pub const FINALIZE: usize = 60;

pub const FASTFINALIZE: usize = 80;

pub fn meets(stake: u64, total_stake: u64, threshold: usize) -> bool {
    (stake as u128) * 100 >= (threshold as u128) * (total_stake as u128)
}