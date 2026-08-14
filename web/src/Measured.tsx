import m from "./measured.json";

const fmtS = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

/** The measured-finality battery: stage decomposition of a live-cluster slot,
 *  the headline stats, and the depth comparison — all numbers from the
 *  committed benchmark artifacts (see measured.json for provenance). */
export default function Measured() {
  const c = m.cluster;
  const stages = [
    { label: "leader streams the block", ms: c.stream_p50_ms, cls: "st-stream" },
    { label: "replay", ms: Math.max(c.replay_p50_ms, 2), cls: "st-replay" },
    { label: "consensus: votes → cert", ms: c.consensus_p50_ms, cls: "st-consensus" },
  ];
  const total = stages.reduce((s, x) => s + x.ms, 0);
  const speedup = Math.round(m.mainnet.finality_p50_ms / c.finality_p50_ms);

  return (
    <section className="measured">
      <div className="race-head">
        <h2>Where the milliseconds go — measured on the live cluster</h2>
        <span className="sg-src">
          {c.slots_decomposed} slots decomposed · {m.measured_at}
        </span>
      </div>

      <div className="ms-tiles">
        <div className="ms-tile">
          <span className="ms-v good">{c.consensus_p50_ms} ms</span>
          <span className="ms-k">consensus alone (block frozen → finalized)</span>
        </div>
        <div className="ms-tile">
          <span className="ms-v good">{c.e2e_p50_ms} ms</span>
          <span className="ms-k">end-to-end (first shred → finalized)</span>
        </div>
        <div className="ms-tile">
          <span className="ms-v warn">{fmtS(m.mainnet.finality_p50_ms)}</span>
          <span className="ms-k">mainnet today · same method, same moment</span>
        </div>
        <div className="ms-tile">
          <span className="ms-v">{speedup}×</span>
          <span className="ms-k">measured, not claimed</span>
        </div>
      </div>

      <div className="ms-stagebar" role="img" aria-label="Stage breakdown of one finalized slot">
        {stages.map((s) => (
          <div
            key={s.label}
            className={`ms-seg ${s.cls}`}
            style={{ width: `${(s.ms / total) * 100}%` }}
            title={`${s.label}: ${s.ms} ms p50`}
          />
        ))}
      </div>
      <div className="ms-legend">
        {stages.map((s) => (
          <span key={s.label} className="ms-leg">
            <i className={`ms-dot ${s.cls}`} />
            {s.label} · <b>{s.ms === 2 ? "~0" : s.ms} ms</b>
          </span>
        ))}
      </div>

      <p className="ms-insight">
        Consensus is no longer the bottleneck — <b>downloading the block is.</b>{" "}
        The vote round finishes in {c.consensus_p50_ms} ms; most of a slot's
        finality time is the leader streaming it out over its ~{c.slot_ms} ms slot.
      </p>

      <div className="ms-depth">
        <div className="ms-depth-row">
          <span className="ms-depth-name">TowerBFT</span>
          <div className="ms-depth-track">
            <div className="ms-depth-fill tower" style={{ width: "100%" }} />
          </div>
          <span className="ms-depth-val">{m.local.tower_depth_slots} slots behind tip</span>
        </div>
        <div className="ms-depth-row">
          <span className="ms-depth-name">Alpenglow</span>
          <div className="ms-depth-track">
            <div
              className="ms-depth-fill alpen"
              style={{ width: `${(m.local.alpenglow_depth_slots / m.local.tower_depth_slots) * 100}%` }}
            />
          </div>
          <span className="ms-depth-val">≤{m.local.alpenglow_depth_slots} slot behind tip</span>
        </div>
      </div>

      <p className="race-note">
        Finality depth measured on identical hardware (real Agave LocalClusters):
        Tower exactly 32 slots; Alpenglow 0–1 slots in the 20%/40%-offline runs.
        The two all-online runs saturated this rig's CPU (depth p50 8–9) and are
        excluded from this figure — both are kept in the repo. Harness validated:
        the local TowerBFT control ({fmtS(m.local.tower_p50_ms)}) reproduces
        measured mainnet finality ({fmtS(m.mainnet.finality_p50_ms)}) within 5.3%.
      </p>
    </section>
  );
}
