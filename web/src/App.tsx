import { useEffect, useMemo, useRef, useState } from "react";
import { useSimulation, type SimEvent } from "./useSimulation";
import WorldMap from "./WorldMap";
import FinalityLive from "./FinalityLive";
import CrashTest from "./CrashTest";
import ScenarioGrid from "./ScenarioGrid";

const BLOCK = (n: number) => String.fromCharCode(65 + n); // 0 -> A

const PRESETS: { id: string; label: string; blurb: string }[] = [
  {
    id: "fast",
    label: "⚡ Fast finalize",
    blurb:
      "Every validator notarizes the same block. 80% of stake in a single round → instant finality. This is Alpenglow's headline path.",
  },
  {
    id: "slow",
    label: "🔒 Slow finalize",
    blurb:
      "Only 60% of stake notarizes — enough to notarize, not enough for the fast path. A second round of Finalize votes seals it: two-step finality.",
  },
  {
    id: "offline",
    label: "⏭ Leader offline",
    blurb:
      "The leader never produced a block. Validators vote Skip; at 60% a skip certificate forms and the chain moves on to the next slot.",
  },
  {
    id: "split",
    label: "😈 Equivocation",
    blurb:
      "A byzantine leader (V0) signed two conflicting blocks. Honest stake splits 50/50 — neither block reaches 60% — until notarize-fallback votes rescue the slot.",
  },
];

function voteKindLabel(kind: any): { text: string; cls: string } {
  if (kind === "Skip") return { text: "Skip", cls: "vote-skip" };
  if (kind === "SkipFallback") return { text: "Skip-fb", cls: "vote-skip" };
  if (kind === "Finalize") return { text: "Finalize", cls: "vote-finalize" };
  if (kind && typeof kind === "object") {
    if ("Notarize" in kind)
      return { text: `Notarize ${BLOCK(kind.Notarize)}`, cls: "vote-notarize" };
    if ("NotarizeFallback" in kind)
      return {
        text: `Fallback ${BLOCK(kind.NotarizeFallback)}`,
        cls: "vote-fallback",
      };
  }
  return { text: String(kind), cls: "" };
}

function certLabel(kind: any): string {
  if (kind === "Finalize") return "Finalize (slow) 🔒";
  if (kind === "Skip") return "Skip ⏭";
  if (kind && typeof kind === "object") {
    if ("Notarize" in kind) return `Notarize ${BLOCK(kind.Notarize)}`;
    if ("NotarizeFallback" in kind)
      return `Notar-fallback ${BLOCK(kind.NotarizeFallback)} 🛟`;
    if ("FinalizeFast" in kind)
      return `Finalize-Fast ${BLOCK(kind.FinalizeFast)} ⚡`;
  }
  return String(kind);
}

function describe(e: SimEvent): string {
  switch (e.type) {
    case "VoteCast":
      return `V${e.validator_id} → ${voteKindLabel(e.kind).text}`;
    case "CertFormed":
      return `⬦ cert: ${certLabel(e.kind)}`;
    case "Notarized":
      return `✓ notarized block ${BLOCK(e.block)}`;
    case "Finalized":
      return e.fast
        ? `⚡ finalized (fast) block ${BLOCK(e.block)}`
        : `🔒 finalized block ${BLOCK(e.block)}`;
    case "Skipped":
      return `⏭ slot ${e.slot} skipped`;
    case "VoteDropped":
      return `✕ V${e.validator} is offline — vote lost`;
    case "Idle":
      return "· end of scenario";
    default:
      return e.type;
  }
}

function Marks({ marks }: { marks: number[] }) {
  return (
    <>
      {marks.map((m) => (
        <div key={m} className="bar-mark" style={{ left: `${m}%` }}>
          <span>{m}%</span>
        </div>
      ))}
    </>
  );
}

function StakeBar(props: {
  label: string;
  value: number;
  fallback?: number;
  total: number;
  marks: number[];
  cls: string;
}) {
  const pct = props.total > 0 ? (props.value / props.total) * 100 : 0;
  const fpct =
    props.total > 0 && props.fallback ? (props.fallback / props.total) * 100 : 0;
  return (
    <div className="bar-row">
      <div className="bar-label">{props.label}</div>
      <div className="bar-track">
        <div className={`bar-fill ${props.cls}`} style={{ width: `${pct}%` }} />
        {fpct > 0 && (
          <div
            className="bar-fill fill-fallback"
            style={{ left: `${pct}%`, width: `${fpct}%` }}
            title="notarize-fallback stake"
          />
        )}
        <Marks marks={props.marks} />
      </div>
      <div className="bar-pct">{Math.round(pct + fpct)}%</div>
    </div>
  );
}

const ALPENGLOW_S = 0.15; // ~150 ms target finality
const TOWER_S = 12.8; // ~32 slots × 400 ms optimistic confirmation

function FinalityRace() {
  const [elapsed, setElapsed] = useState(0);
  const [running, setRunning] = useState(false);
  const startRef = useRef(0);
  const rafRef = useRef(0);

  useEffect(() => {
    if (!running) return;
    const tick = () => {
      const e = (performance.now() - startRef.current) / 1000;
      setElapsed(e);
      if (e < TOWER_S) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        setRunning(false);
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [running]);

  const start = () => {
    startRef.current = performance.now();
    setElapsed(0);
    setRunning(true);
  };

  const row = (name: string, dur: number, cls: string) => {
    const p = Math.min(elapsed / dur, 1) * 100;
    const done = elapsed >= dur && elapsed > 0;
    return (
      <div className="race-row">
        <div className="race-name">{name}</div>
        <div className="race-track">
          <div className={`race-fill ${cls}`} style={{ width: `${p}%` }} />
        </div>
        <div className={`race-time ${done ? "done" : ""}`}>
          {elapsed === 0 && !running
            ? `${dur >= 1 ? dur + " s" : dur * 1000 + " ms"}`
            : done
            ? `${dur >= 1 ? dur + " s" : dur * 1000 + " ms"} ✓`
            : `${elapsed.toFixed(2)} s…`}
        </div>
      </div>
    );
  };

  return (
    <section className="race">
      <div className="race-head">
        <h2>Why it matters — finality race (real time)</h2>
        <button onClick={start} disabled={running}>
          {running ? "racing…" : elapsed > 0 ? "🔁 Race again" : "🏁 Start race"}
        </button>
      </div>
      {row("Alpenglow", ALPENGLOW_S, "race-alpen")}
      {row("TowerBFT", TOWER_S, "race-tower")}
      <p className="race-note">
        Both bars run in actual wall-clock time. Alpenglow finalizes in ~150 ms
        (one voting round at network latency); today's TowerBFT optimistic
        confirmation takes ~12.8 s (32 slots × 400 ms). That's the ~100×.
      </p>
    </section>
  );
}

export default function App() {
  const {
    ready,
    snapshot,
    log,
    preset,
    playing,
    setPlaying,
    loadPreset,
    step,
    toggleOffline,
    setOfflineSet,
    source,
    switchSource,
    mainnet,
  } = useSimulation();

  const lastVote = useMemo(() => {
    const map: Record<number, any> = {};
    for (let i = log.length - 1; i >= 0; i--) {
      const e = log[i];
      if (e.type === "VoteCast") map[e.validator_id] = e.kind;
    }
    return map;
  }, [log]);

  if (!ready || !snapshot) {
    return <div className="loading">Loading WebAssembly engine…</div>;
  }

  const total: number = snapshot.total_stake;
  const notarize: [number, number][] = snapshot.notarize;
  const notarFallback: [number, number][] = snapshot.notar_fallback ?? [];
  const skip: number = snapshot.skip_stake;
  const finalize: number = snapshot.finalize_stake;
  const certs: any[] = snapshot.certs;
  const offline: number[] = snapshot.offline ?? [];

  const blockIds: number[] = Array.from(
    new Set([...notarize.map((e) => e[0]), ...notarFallback.map((e) => e[0])])
  ).sort();
  if (blockIds.length === 0) blockIds.push(0);

  const hasFast = certs.some(
    (c) => typeof c.kind === "object" && "FinalizeFast" in c.kind
  );
  const hasPlainNotarize = certs.some(
    (c) => typeof c.kind === "object" && "Notarize" in c.kind
  );
  const hasFallbackCert = certs.some(
    (c) => typeof c.kind === "object" && "NotarizeFallback" in c.kind
  );
  const hasSkip = certs.some((c) => c.kind === "Skip");
  const exhausted =
    snapshot.pending_len > 0 && snapshot.cursor >= snapshot.pending_len;
  const stalled = exhausted && !snapshot.finalized && certs.length === 0;

  const offlineStake = snapshot.validators
    .filter((v: any) => offline.includes(v.id))
    .reduce((s: number, v: any) => s + v.stake, 0);
  const livePct = total > 0 ? ((total - offlineStake) / total) * 100 : 100;

  const killTop = (n: number) =>
    setOfflineSet(snapshot.validators.slice(0, n).map((v: any) => v.id));

  const status = snapshot.finalized
    ? hasFast
      ? "Finalized ⚡ (fast path, ≥80% in one round)"
      : "Finalized 🔒 (slow path, notarize + finalize)"
    : stalled
    ? "🪦 Stalled — live stake can't reach any threshold"
    : hasSkip
    ? "Slot skipped ⏭ — chain moves on"
    : hasFallbackCert && !hasPlainNotarize
    ? `Rescued 🛟 — block ${BLOCK(snapshot.notarized_block)} notarized via fallback`
    : snapshot.notarized_block !== null && snapshot.notarized_block !== undefined
    ? `Notarized ✓ (block ${BLOCK(snapshot.notarized_block)})`
    : "Voting…";

  const blurb = PRESETS.find((p) => p.id === preset)?.blurb ?? "";

  return (
    <div className="app">
      <header>
        <h1>
          Alpenglow, <span>visualized</span>
        </h1>
        <p>
          Watch a Solana slot reach consensus — votes accumulate, certificates
          form at 60% / 80%. Then try to break it.
        </p>
      </header>

      <CrashTest />

      <ScenarioGrid />

      <FinalityLive />

      <div className="controls">
        <div className="presets">
          <button
            className={source === "demo" ? "active" : ""}
            onClick={() => switchSource("demo")}
          >
            🧪 10 equal validators
          </button>
          <button
            className={source === "mainnet" ? "active" : ""}
            onClick={() => switchSource("mainnet")}
            disabled={!mainnet}
            title={
              mainnet
                ? `${mainnet.totalValidators} live validators, ${
                    mainnet.live ? "fetched live" : `snapshot ${mainnet.fetchedAt}`
                  }`
                : "loading mainnet stake…"
            }
          >
            🌐 Real mainnet stake{mainnet ? "" : " (loading…)"}
          </button>
        </div>
      </div>

      {source === "mainnet" && mainnet && (
        <p className="hint">
          Top 60 validators by activated stake ({mainnet.live ? "live from" : "snapshot via"}{" "}
          Stakewiz{mainnet.live ? "" : `, ${mainnet.fetchedAt}`}), remaining{" "}
          {mainnet.totalValidators - 60} aggregated into one tile. Total ≈{" "}
          {Math.round(total / 1e6)}M SOL.
        </p>
      )}

      <div className="controls">
        <div className="presets">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              className={preset === p.id ? "active" : ""}
              onClick={() => loadPreset(p.id)}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="transport">
          <button onClick={() => setPlaying(!playing)}>
            {playing ? "⏸ Pause" : "▶ Play"}
          </button>
          <button onClick={() => step()}>⭯ Step</button>
          <button onClick={() => loadPreset(preset)}>↺ Reset</button>
        </div>
      </div>

      <p className="blurb">{blurb}</p>

      <div className={`status ${snapshot.finalized ? "done" : ""} ${stalled ? "stalled" : ""}`}>
        {status}
        <span className={`live-stake ${livePct < 60 ? "danger" : ""}`}>
          live stake: {livePct.toFixed(1)}%
        </span>
      </div>

      {source === "mainnet" && (
        <div className="kill-row">
          <span>Knock offline:</span>
          <button onClick={() => killTop(5)}>💀 top 5</button>
          <button onClick={() => killTop(8)}>💀 top 8 (&gt;20% — kills fast path)</button>
          <button onClick={() => killTop(25)}>💀 top 25 (&gt;40% — halts finality)</button>
          <button onClick={() => setOfflineSet([])}>💚 restore all</button>
        </div>
      )}

      <section className="bars">
        {blockIds.map((b) => (
          <StakeBar
            key={b}
            label={`Notarize ${BLOCK(b)}`}
            value={notarize.find((e) => e[0] === b)?.[1] ?? 0}
            fallback={notarFallback.find((e) => e[0] === b)?.[1] ?? 0}
            total={total}
            marks={[60, 80]}
            cls="fill-notarize"
          />
        ))}
        <StakeBar
          label="Finalize"
          value={finalize}
          total={total}
          marks={[60]}
          cls="fill-finalize"
        />
        <StakeBar label="Skip" value={skip} total={total} marks={[60]} cls="fill-skip" />
      </section>

      <section className={`validators ${source === "mainnet" ? "dense" : ""}`}>
        {snapshot.validators.map((v: any) => {
          const isOffline = offline.includes(v.id);
          const lv = lastVote[v.id];
          const info =
            lv !== undefined ? voteKindLabel(lv) : { text: "—", cls: "vote-none" };
          const stakeText =
            source === "mainnet"
              ? `${((v.stake / total) * 100).toFixed(1)}%`
              : v.stake;
          return (
            <button
              key={v.id}
              className={`validator ${info.cls} ${isOffline ? "offline" : ""} ${
                v.byzantine ? "byz" : ""
              }`}
              title={
                isOffline
                  ? `${v.label} is offline — click to revive`
                  : `${v.label}: ${info.text} — click to knock offline`
              }
              onClick={() => toggleOffline(v.id)}
            >
              <div className="vlabel">
                {v.byzantine ? "😈 " : ""}
                {v.label}
              </div>
              <div className="vstake">{isOffline ? "✕ offline" : stakeText}</div>
            </button>
          );
        })}
      </section>
      <p className="hint">
        💡 Click validators to knock them offline (their future votes are
        dropped), then ↺ Reset and replay — how much stake can consensus lose
        and still survive?
      </p>

      <div className="panels">
        <section className="certs">
          <h2>Certificates</h2>
          {certs.length === 0 && <div className="empty">none yet</div>}
          {certs.map((c, i) => (
            <div key={i} className="cert">
              <span className="cert-kind">{certLabel(c.kind)}</span>
              <span className="cert-stake">
                {Math.round((c.stake / total) * 100)}%
              </span>
            </div>
          ))}
        </section>

        <section className="events">
          <h2>Event log</h2>
          {log.map((e, i) => (
            <div key={i} className="event">
              {describe(e)}
            </div>
          ))}
        </section>
      </div>

      <WorldMap />

      <FinalityRace />

      <footer>
        Rust → WebAssembly consensus core · faithful to Alpenglow votor
        mechanics (60% / 80% thresholds, fallback votes, overflow-safe stake
        math)
      </footer>
    </div>
  );
}
