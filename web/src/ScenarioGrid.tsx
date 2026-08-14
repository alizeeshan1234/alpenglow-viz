import data from "./scenarios_data.json";

interface Scenario {
  id: string;
  name: string;
  fault: string;
  source: string;
  outcome: string;
  detail: string;
  secs?: number;
}

export default function ScenarioGrid() {
  const scenarios = data.scenarios as Scenario[];
  if (scenarios.length === 0) return null;

  return (
    <section className="scenarios-grid">
      <div className="race-head">
        <h2>Adversarial scenarios — did it survive?</h2>
        <span className="sg-src">Agave's own fault-injection tests · commit {data.agave_commit}</span>
      </div>
      <div className="sg-cards">
        {scenarios.map((s) => {
          const survived = s.outcome === "SURVIVED";
          return (
            <div key={s.id} className={`sg-card ${survived ? "ok" : "dead"}`}>
              <div className="sg-verdict">
                {survived ? "✓ survived" : "✕ broke"}
              </div>
              <div className="sg-name">{s.name}</div>
              <div className="sg-fault">{s.fault}</div>
              <div className="sg-detail">{s.detail}</div>
              <div className="sg-foot">
                <code>{s.source}</code>
                {s.secs != null && <span>{s.secs.toFixed(0)}s</span>}
              </div>
            </div>
          );
        })}
      </div>
      <p className="race-note">
        These run Agave's real Alpenglow fault-injection tests unmodified. A
        "survived" result means the cluster kept finalizing under the fault.
        Outcomes within Alpenglow's 20%-Byzantine + 20%-offline model are
        expected behavior, not vulnerabilities.
      </p>
    </section>
  );
}
