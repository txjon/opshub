#!/bin/zsh
# FOG God Mode refresh: merge every CSV in exports/, rebuild both outputs.
# After running: commit + push dev (the OpsHub page serves the generated TS),
# and optionally ask Claude to republish fog-godmode.html to the artifact URL.
set -e
cd "$(dirname "$0")"
if [ ! -x .venv/bin/python ]; then
  python3 -m venv .venv && .venv/bin/pip install -q pandas
fi
.venv/bin/python aggregate.py
python3 build.py
echo "Done. Commit app/api/fog-analytics/dashboard-html.generated.ts + fog-data.json, push dev."
