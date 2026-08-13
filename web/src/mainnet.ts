import bundled from "./mainnet_snapshot.json";

export interface ValidatorSpec {
  label: string;
  stake: number; // SOL, rounded
}

export interface MainnetSet {
  fetchedAt: string;
  live: boolean; // true = fetched just now, false = bundled snapshot
  totalValidators: number;
  validators: ValidatorSpec[]; // top N + one aggregated long-tail entry
}

const TOP = 60;

function fromStakewiz(rows: any[]): Omit<MainnetSet, "live" | "fetchedAt"> {
  const alive = rows
    .filter((v) => !v.delinquent && v.activated_stake > 0)
    .sort((a, b) => b.activated_stake - a.activated_stake);
  const top = alive.slice(0, TOP);
  const tail = alive.slice(TOP);
  const tailStake = tail.reduce((s, v) => s + v.activated_stake, 0);
  const name = (v: any) =>
    (v.name || "").trim() || `${String(v.identity).slice(0, 8)}…`;
  return {
    totalValidators: alive.length,
    validators: [
      ...top.map((v) => ({
        label: name(v).slice(0, 24),
        stake: Math.round(v.activated_stake),
      })),
      { label: `Other ${tail.length} validators`, stake: Math.round(tailStake) },
    ],
  };
}

export async function loadMainnet(): Promise<MainnetSet> {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 6000);
    const res = await fetch("https://api.stakewiz.com/validators", {
      signal: ctl.signal,
    });
    clearTimeout(t);
    if (!res.ok) throw new Error(`http ${res.status}`);
    const rows = await res.json();
    return {
      ...fromStakewiz(rows),
      live: true,
      fetchedAt: new Date().toISOString().slice(0, 10),
    };
  } catch {
    return {
      totalValidators: bundled.total_validators,
      validators: bundled.validators as ValidatorSpec[],
      live: false,
      fetchedAt: bundled.fetched_at,
    };
  }
}
