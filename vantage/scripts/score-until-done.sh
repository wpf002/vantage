#!/usr/bin/env bash
#
# Supervisor for the universe score sweep.
#
# Runs `RESUME=1 score:universe` repeatedly until the sweep CONVERGES — i.e.
# a full pass adds no new scores (everything scoreable is scored; only
# permanently insufficient-data tickers remain unscored). Each pass skips
# already-scored tickers, so a killed pass is cheap to resume.
#
# Detached from any Claude/terminal session: launch with `setsid` so it keeps
# running after the shell or Claude Code exits. Prevents idle sleep for its own
# lifetime via caffeinate. Fires a macOS notification + writes a .DONE marker
# when finished.
#
# Honest limits: a full power-off stops it (resume makes a manual relaunch cheap),
# and lid-closed-on-battery sleep pauses it (keep it plugged in / lid open).
#
set -uo pipefail

# Keep the Mac awake (idle sleep only) for this supervisor's lifetime.
caffeinate -i -w $$ &

API_DIR="/Users/willfoti/Documents/GitHub/vantage/vantage/packages/api"
LOG="/tmp/score-until-done.log"
DONE_MARKER="/tmp/score-until-done.DONE"
MAX_PASSES=24

cd "$API_DIR" || { echo "cannot cd $API_DIR"; exit 1; }
rm -f "$DONE_MARKER"

pg() { docker exec vantage-postgres psql -U vantage -d vantage -tAc "$1" 2>/dev/null | tr -d '[:space:]'; }

TOTAL=$(pg "select count(*) from platform_companies where market_type='public' and ticker is not null;")
echo "$(date '+%F %T') supervisor start: total=$TOTAL" >> "$LOG"

prev="-1"
for ((i=1; i<=MAX_PASSES; i++)); do
  scored=$(pg "select count(distinct ticker) from public_scores;")
  echo "$(date '+%F %T') pass $i: scored=$scored/$TOTAL (prev=$prev)" >> "$LOG"

  # Converged: the previous pass produced no new scores.
  if [ "$scored" = "$prev" ]; then
    echo "$(date '+%F %T') converged — no new scores in last pass" >> "$LOG"
    break
  fi
  prev="$scored"

  RESUME=1 pnpm score:universe >> "$LOG" 2>&1
  echo "$(date '+%F %T') pass $i exited code=$?" >> "$LOG"
done

final=$(pg "select count(distinct ticker) from public_scores;")
echo "$(date '+%F %T') FINISHED scored=$final/$TOTAL" >> "$LOG"
echo "$final/$TOTAL" > "$DONE_MARKER"
osascript -e "display notification \"Scored $final of $TOTAL tickers — screener fully populated\" with title \"Vantage universe sweep complete\" sound name \"Glass\"" 2>/dev/null || true
