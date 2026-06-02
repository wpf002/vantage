#!/usr/bin/env bash
#
# launchd entry point for the universe score sweep.
#
# Wraps score-until-done.sh with two guards so the LaunchAgent is idempotent:
#   1. If the sweep already completed (/tmp/score-until-done.DONE exists), no-op
#      with a clean exit — so RunAtLoad after a reboot doesn't re-run it.
#   2. If a supervisor is already running, no-op — so we never double up.
# Exiting 0 in both cases means KeepAlive (SuccessfulExit=false) won't restart us.
#
# ⚠️  macOS TCC CAVEAT: launchd-spawned processes cannot read ~/Documents,
# ~/Desktop, or ~/Downloads without Full Disk Access. Because this repo lives
# under ~/Documents, loading the LaunchAgent fails with "Operation not
# permitted" (launchctl status 126) until ONE of these is done:
#   (a) Grant Full Disk Access to /bin/bash in
#       System Settings > Privacy & Security > Full Disk Access, OR
#   (b) Move the repo out of a TCC-protected folder (e.g. ~/dev, ~/Projects)
#       and update the absolute paths in this script + the .plist.
# Without that, use the detached nohup supervisor instead:
#   ( nohup bash scripts/score-until-done.sh >/dev/null 2>&1 </dev/null & )
# which inherits the interactive session's file access and survives logout,
# but NOT a reboot.
#
set -uo pipefail

DONE="/tmp/score-until-done.DONE"
SUPERVISOR="/Users/willfoti/Documents/GitHub/vantage/vantage/scripts/score-until-done.sh"

[ -f "$DONE" ] && exit 0
if pgrep -f 'score-until-done.sh' >/dev/null 2>&1; then exit 0; fi

exec /bin/bash "$SUPERVISOR"
