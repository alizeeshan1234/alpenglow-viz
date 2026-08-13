import { useMemo } from "react";
import { useSimulation, type SimEvent } from "./useSimulation";

const BLOCK = (n: number) => String.fromCharCode(65 + n); // 0 -> A

function voteKindLabel(kind: any): { text: string; cls: string } {
  if (kind === "Skip") return { text: "Skip", cls: "vote-skip" };
  if (kind === "SkipFallback") return { text: "Skip-fb", cls: "vote-skip" };
  if (kind === "Finalize") return { text: "Finalize", cls: "vote-finalize" };
  if (kind && typeof kind === "object") {
    if ("Notarize" in kind)
      return { text: `Notarize ${BLOCK(kind.Notarize)}`, cls: "vote-notarize" };
    if ("NotarizeFallback" in kind)
      return { text: `Notar-fb ${BLOCK(kind.NotarizeFallback)}`, cls: "vote-notarize" };
  }
  return { text: String(kind), cls: "" };
}

function certLabel(kind: any): string {
  if (kind === "Finalize") return "Finalize (slow) 🔒";
  if (kind === "Skip") return "Skip ⏭";
  if (kind && typeof kind === "object") {
    if ("Notarize" in kind) return `Notarize ${BLOCK(kind.Notarize)}`;
    if ("NotarizeFallback" in kind) return `Notar-fallback ${BLOCK(kind.NotarizeFallback)}`;
    if ("FinalizeFast" in kind) return `Finalize-Fast ${BLOCK(kind.FinalizeFast)} ⚡`;
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
    case "Idle":
      return "· end of scenario";
    default:
      return e.type;
  }
}

function Bar(props: {
  label: string;
  value: number;
  total: number;
  marks: number[];
  cls: string;
}) {
  const pct = props.total > 0 ? (props.value / props.total) * 100 : 0;
  return (
    <div className="bar-row">
      <div className="bar-label">{props.label}</div>
      <div className="bar-track">
        <div className={`bar-fill ${props.cls}`} style={{ width: `${pct}%` }} />
        {props.marks.map((m) => (
          <div key={m} className="bar-mark" style={{ left: `${m}%` }}>
            <span>{m}%</span>
          </div>
        ))}
      </div>
      <div className="bar-pct">{Math.round(pct)}%</div>
    </div>
  );
}

export default function App() {
  const { ready, snapshot, log, preset, playing, setPlaying, loadPreset, step } =
    useSimulation();

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
  const notarizeA: number =
    snapshot.notarize.find((e: any) => e[0] === 0)?.[1] ?? 0;
  const skip: number = snapshot.skip_stake;
  const finalize: number = snapshot.finalize_stake;
  const certs: any[] = snapshot.certs;

  const hasFast = certs.some(
    (c) => typeof c.kind === "object" && "FinalizeFast" in c.kind
  );
  const hasSkip = certs.some((c) => c.kind === "Skip");
  const status = snapshot.finalized
    ? hasFast
      ? "Finalized ⚡ (fast path, ≥80%)"
      : "Finalized 🔒 (slow path)"
    : hasSkip
    ? "Slot skipped ⏭"
    : snapshot.notarized_block !== null && snapshot.notarized_block !== undefined
    ? `Notarized ✓ (block ${BLOCK(snapshot.notarized_block)})`
    : "Voting…";

  return (
    <div className="app">
      <header>
        <h1>
          Alpenglow, <span>visualized</span>
        </h1>
        <p>
          Watch a Solana slot reach consensus — votes accumulate, certificates
          form at 60% / 80%.
        </p>
      </header>

      <div className="controls">
        <div className="presets">
          {["fast", "slow", "offline"].map((p) => (
            <button
              key={p}
              className={preset === p ? "active" : ""}
              onClick={() => loadPreset(p)}
            >
              {p === "fast"
                ? "⚡ Fast finalize"
                : p === "slow"
                ? "🔒 Slow finalize"
                : "⏭ Leader offline"}
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

      <div className={`status ${snapshot.finalized ? "done" : ""}`}>{status}</div>

      <section className="bars">
        <Bar
          label={`Notarize ${BLOCK(0)}`}
          value={notarizeA}
          total={total}
          marks={[60, 80]}
          cls="fill-notarize"
        />
        <Bar label="Finalize" value={finalize} total={total} marks={[60]} cls="fill-finalize" />
        <Bar label="Skip" value={skip} total={total} marks={[60]} cls="fill-skip" />
      </section>

      <section className="validators">
        {snapshot.validators.map((v: any) => {
          const lv = lastVote[v.id];
          const info =
            lv !== undefined ? voteKindLabel(lv) : { text: "—", cls: "vote-none" };
          return (
            <div key={v.id} className={`validator ${info.cls}`} title={info.text}>
              <div className="vlabel">{v.label}</div>
              <div className="vstake">{v.stake}</div>
            </div>
          );
        })}
      </section>

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

      <footer>
        Rust → WebAssembly consensus core · faithful to Alpenglow votor mechanics
      </footer>
    </div>
  );
}
