import { useMemo, useState } from "react";
import data from "./crash_data.json";

interface Run {
  consensus?: "alpenglow" | "tower";
  num_nodes: number;
  num_offline: number;
  pct_offline: number;
  pct_online: number;
  outcome: string;
  finalized: boolean;
  new_roots: number;
  seconds: number;
  roots_per_sec?: number;
}

export default function CrashTest() {
  const runs = data.runs as Run[];

  // One Alpenglow point per distinct offline %, ordered along the axis. Tower
  // runs are controls and must not change Alpenglow's boundary slider.
  const points = useMemo(() => {
    const byPct = new Map<number, Run>();
    for (const r of runs.filter((run) => (run.consensus ?? "alpenglow") === "alpenglow")) {
      const existing = byPct.get(r.pct_offline);
      // prefer the higher node count (finer granularity) at a given %
      if (!existing || r.num_nodes > existing.num_nodes) byPct.set(r.pct_offline, r);
    }
    return [...byPct.values()].sort((a, b) => a.pct_offline - b.pct_offline);
  }, [runs]);

  const thresholdControl = useMemo(() => {
    const atBoundary = runs.filter(
      (run) => run.num_nodes === 5 && run.num_offline === 2,
    );
    return {
      alpenglow: atBoundary.find(
        (run) => (run.consensus ?? "alpenglow") === "alpenglow",
      ),
      tower: atBoundary.find((run) => run.consensus === "tower"),
    };
  }, [runs]);

  const [idx, setIdx] = useState(0);
  const cur = points[idx];

  // Boundary: last finalized %, first stalled %.
  const lastFinal = [...points].reverse().find((p) => p.finalized);
  const firstStall = points.find((p) => !p.finalized);
  const boundaryLo = lastFinal?.pct_offline ?? 0;
  const boundaryHi = firstStall?.pct_offline ?? 100;

  return (
    <section className="crash">
      <div className="crash-badge">
        ⬤ MEASURED · real Agave Alpenglow · commit {data.agave_commit}
      </div>
      <h2 className="crash-h">
        We tried to break Solana's new consensus.
      </h2>
      <p className="crash-sub">
        Real Alpenglow validators, booted locally and knocked offline one by one.
        It keeps finalizing until <b>{boundaryLo}%</b> of stake is offline — then,
        somewhere before <b>{boundaryHi}%</b>, it stops dead. Drag it and watch.
      </p>

      {thresholdControl.alpenglow && thresholdControl.tower && (
        <div className="control-compare">
          <div className="control-copy">
            <span>THE BEFORE / AFTER</span>
            <strong>Same 5-validator stake split · 40% offline</strong>
            <p>
              60% online is below Tower's two-thirds requirement, but reaches
              Alpenglow's 60% certificate threshold.
            </p>
          </div>
          <div className="control-results">
            <div className="control-result tower">
              <span>TowerBFT</span>
              <strong>🛑 STALLED</strong>
              <small>{thresholdControl.tower.new_roots} roots · 60s window</small>
            </div>
            <div className="control-arrow" aria-hidden="true">→</div>
            <div className="control-result alpenglow">
              <span>Alpenglow</span>
              <strong>✅ FINALIZED</strong>
              <small>{thresholdControl.alpenglow.new_roots} new roots</small>
            </div>
          </div>
        </div>
      )}

      <div className="crash-readout">
        <div className={`crash-verdict ${cur.finalized ? "ok" : "dead"}`}>
          {cur.finalized ? "✅ FINALIZING" : "🛑 STALLED"}
        </div>
        <div className="crash-nums">
          <div>
            <span className="k">offline stake</span>
            <span className="v">{cur.pct_offline}%</span>
          </div>
          <div>
            <span className="k">online</span>
            <span className="v">{cur.pct_online}%</span>
          </div>
          <div>
            <span className="k">finalized roots</span>
            <span className="v">{cur.new_roots}</span>
          </div>
          <div>
            <span className="k">{cur.finalized ? "in" : "after"}</span>
            <span className="v">{cur.seconds.toFixed(1)}s</span>
          </div>
        </div>
      </div>

      {/* the cliff track */}
      <div className="crash-track">
        {points.map((p, i) => {
          const left = (p.pct_offline / (points[points.length - 1].pct_offline || 1)) * 100;
          return (
            <div
              key={i}
              className={`crash-tick ${p.finalized ? "ok" : "dead"} ${i === idx ? "on" : ""}`}
              style={{ left: `${left}%` }}
              title={`${p.pct_offline}% offline — ${p.outcome}`}
            />
          );
        })}
        <div
          className="crash-boundary"
          style={{
            left: `${((boundaryLo + boundaryHi) / 2 / (points[points.length - 1].pct_offline || 1)) * 100}%`,
          }}
        >
          <span>stall boundary</span>
        </div>
      </div>

      <input
        className="crash-slider"
        type="range"
        min={0}
        max={points.length - 1}
        step={1}
        value={idx}
        onChange={(e) => setIdx(Number(e.target.value))}
      />
      <div className="crash-axis">
        <span>0% offline</span>
        <span>{points[points.length - 1].pct_offline}% offline</span>
      </div>

      <p className="crash-note">
        {points.length} measured configurations · {data.machine}. Behavioral
        outcome (finalize vs stall) is robust to single-machine colocation;
        finalization times are relative, not network-representative. Tower uses
        its normal 64-tick cadence, so cross-consensus wall time is not compared.
      </p>
    </section>
  );
}
