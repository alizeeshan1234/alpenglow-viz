#!/usr/bin/env python3
"""Parse `CRASH_RESULT ...` lines from harness output into structured JSON.

Usage: python3 parse_results.py <harness-output.log> [more.log ...] > results.json
Each CRASH_RESULT line looks like:
  CRASH_RESULT nodes=4 offline=2 pct=50.0 warm_ok=true outcome=STALLED new_roots=0 target=8 secs=60.0 baseline_slot=42
"""
import json
import subprocess
import sys
import datetime


def parse_line(line: str) -> dict:
    kv = {}
    for tok in line.split("CRASH_RESULT", 1)[1].split():
        if "=" in tok:
            k, v = tok.split("=", 1)
            kv[k] = v
    # typed coercion
    out = {
        "num_nodes": int(kv["nodes"]),
        "num_offline": int(kv["offline"]),
        "pct_offline": float(kv["pct"]),
        "pct_online": round(100 - float(kv["pct"]), 1),
        "warm_ok": kv.get("warm_ok") == "true",
        "outcome": kv["outcome"],
        "finalized": kv["outcome"] == "FINALIZED",
        "new_roots": int(kv["new_roots"]),
        "target_roots": int(kv["target"]),
        "seconds": float(kv["secs"]),
        "baseline_slot": int(kv.get("baseline_slot", 0)),
    }
    if out["finalized"] and out["seconds"] > 0:
        out["roots_per_sec"] = round(out["new_roots"] / out["seconds"], 3)
    return out


def agave_sha() -> str:
    try:
        return subprocess.check_output(
            ["git", "-C", "/Users/mohammedzeeshan/Desktop/agave", "rev-parse", "--short", "HEAD"],
            text=True,
        ).strip()
    except Exception:
        return "unknown"


def main():
    runs = []
    for path in sys.argv[1:]:
        with open(path, errors="ignore") as f:
            for line in f:
                if "CRASH_RESULT" in line:
                    try:
                        runs.append(parse_line(line))
                    except Exception as e:
                        print(f"skip: {e}", file=sys.stderr)
    runs.sort(key=lambda r: (r["num_nodes"], r["num_offline"]))
    doc = {
        "scenario": "offline_stake_sweep",
        "generated_at": datetime.date.today().isoformat(),
        "agave_commit": agave_sha(),
        "machine": "Apple M-series, 11 cores, 18GB (local cluster, colocated)",
        "note": "Behavioral results (finalize vs stall) are robust to colocation; timings are relative.",
        "runs": runs,
    }
    print(json.dumps(doc, indent=2))


if __name__ == "__main__":
    main()
