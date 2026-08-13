import snapshot from "./map_snapshot.json";

export interface GeoValidator {
  label: string;
  stake: number;
  lat: number;
  lon: number;
  city: string;
}

export const GEO_VALIDATORS: GeoValidator[] = snapshot.validators;
export const GEO_FETCHED_AT: string = snapshot.fetched_at;
export const TOTAL_GEO_STAKE = GEO_VALIDATORS.reduce((s, v) => s + v.stake, 0);

const EARTH_R = 6371;
// Light in fiber ≈ 200 km/ms; real routes aren't great circles (×1.4);
// plus per-hop forwarding overhead.
const FIBER_KM_PER_MS = 200;
const ROUTE_FACTOR = 1.4;
const HOP_OVERHEAD_MS = 4;
const VOTE_PROCESS_MS = 1;

export function distKm(a: GeoValidator, b: GeoValidator): number {
  const rad = Math.PI / 180;
  const la1 = a.lat * rad,
    la2 = b.lat * rad;
  const h =
    Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(((b.lon - a.lon) * rad) / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(h));
}

export function latMs(a: GeoValidator, b: GeoValidator): number {
  return (distKm(a, b) / FIBER_KM_PER_MS) * ROUTE_FACTOR + HOP_OVERHEAD_MS;
}

export interface Timing {
  leader: number;
  relays: number[];
  /** ms when each validator receives the block */
  recvAt: number[];
  /** relay index each validator got its shreds from (-1 = direct from leader) */
  via: number[];
  /** ms when each validator's notar vote lands back at the leader/observer */
  voteLandsAt: number[];
  t60: number; // 60% of stake notarized (observer sees notarization)
  t80: number; // 80% — fast-finalized
  tEnd: number;
}

const N_RELAYS = 40;

/** Rotor-style dissemination (simplified): leader → stake-weighted relays →
 *  everyone; each validator hears the block via its fastest relay. Votes are
 *  observed at the leader's position. */
export function computeTiming(leader: number): Timing {
  const vs = GEO_VALIDATORS;
  const L = vs[leader];
  const relays: number[] = [];
  for (let i = 0; i < vs.length && relays.length < N_RELAYS; i++) {
    if (i !== leader) relays.push(i); // vs is sorted by stake desc
  }
  const relayRecv = new Map<number, number>(
    relays.map((r) => [r, latMs(L, vs[r])])
  );

  const recvAt: number[] = new Array(vs.length);
  const via: number[] = new Array(vs.length).fill(-1);
  for (let i = 0; i < vs.length; i++) {
    if (i === leader) {
      recvAt[i] = 0;
      continue;
    }
    if (relayRecv.has(i)) {
      recvAt[i] = relayRecv.get(i)!;
      continue;
    }
    let best = Infinity;
    let bestRelay = -1;
    for (const r of relays) {
      const t = relayRecv.get(r)! + latMs(vs[r], vs[i]);
      if (t < best) {
        best = t;
        bestRelay = r;
      }
    }
    recvAt[i] = best;
    via[i] = bestRelay;
  }

  const voteLandsAt = vs.map(
    (v, i) => recvAt[i] + VOTE_PROCESS_MS + (i === leader ? 0 : latMs(v, L))
  );

  const order = vs
    .map((_, i) => i)
    .sort((a, b) => voteLandsAt[a] - voteLandsAt[b]);
  let acc = 0;
  let t60 = 0;
  let t80 = 0;
  for (const i of order) {
    acc += vs[i].stake;
    if (!t60 && acc * 100 >= 60 * TOTAL_GEO_STAKE) t60 = voteLandsAt[i];
    if (!t80 && acc * 100 >= 80 * TOTAL_GEO_STAKE) {
      t80 = voteLandsAt[i];
      break;
    }
  }

  return {
    leader,
    relays,
    recvAt,
    via,
    voteLandsAt,
    t60,
    t80,
    tEnd: t80 + 80,
  };
}

/** Interesting leader choices: top stakers + one per far-flung region. */
export function leaderChoices(): number[] {
  const picks: number[] = [0, 1, 2, 3, 4];
  const wanted = ["Tokyo", "Singapore", "Los Angeles", "New York", "Washington", "Sydney"];
  for (const city of wanted) {
    const i = GEO_VALIDATORS.findIndex((v) => v.city.startsWith(city));
    if (i >= 0 && !picks.includes(i)) picks.push(i);
  }
  return picks;
}
