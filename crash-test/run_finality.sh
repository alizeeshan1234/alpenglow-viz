#!/usr/bin/env bash
# Finality-latency sweep — boots real Agave clusters and measures per-slot
# processed→finalized wall time as offline stake approaches Alpenglow's 40%
# liveness boundary, plus a TowerBFT slot-depth control.
# Writes results/finality_sweep.json.
set -euo pipefail

AGAVE_DIR="${AGAVE_DIR:-$HOME/Desktop/agave}"
OUT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_DIR="$OUT_DIR/logs"
mkdir -p "$LOG_DIR" "$OUT_DIR/results"

if [[ "$(uname)" == "Darwin" ]]; then
  CLANG_LIB="/Library/Developer/CommandLineTools/usr/lib"
  export LIBCLANG_PATH="${LIBCLANG_PATH:-$CLANG_LIB}"
  export DYLD_FALLBACK_LIBRARY_PATH="${DYLD_FALLBACK_LIBRARY_PATH:-$CLANG_LIB}"
fi

HARNESS="$AGAVE_DIR/local-cluster/tests/crash_test.rs"
if [[ ! -f "$HARNESS" ]] || ! cmp -s "$OUT_DIR/crash_test.rs" "$HARNESS"; then
  echo "Installing crash_test harness into $AGAVE_DIR ..."
  cp "$OUT_DIR/crash_test.rs" "$HARNESS"
fi

SCENARIOS=(
  finality_alpenglow_5node_0offline
  finality_alpenglow_5node_1offline
  finality_alpenglow_5node_2offline
  finality_tower_5node_0offline
)

cd "$AGAVE_DIR"
RESULT_LOGS=()
for s in "${SCENARIOS[@]}"; do
  log="$LOG_DIR/$s.log"
  RESULT_LOGS+=("$log")
  passed=false
  for attempt in 1 2; do
    echo "=== running $s (attempt $attempt/2) ==="
    if cargo test -p solana-local-cluster --test crash_test "$s" \
      -- --exact --nocapture --test-threads=1 2>&1 | tee "$log" \
      && grep -q "FINALITY_RESULT" "$log"; then
      passed=true
      break
    fi
    echo "=== $s did not produce an admissible result; retrying ==="
  done
  if [[ "$passed" != true ]]; then
    echo "ERROR: $s failed twice without a FINALITY_RESULT" >&2
    exit 1
  fi
done

AGAVE_DIR="$AGAVE_DIR" python3 "$OUT_DIR/parse_finality.py" "${RESULT_LOGS[@]}" \
  > "$OUT_DIR/results/finality_sweep.json"
echo "=== wrote $OUT_DIR/results/finality_sweep.json ==="
cat "$OUT_DIR/results/finality_sweep.json"
