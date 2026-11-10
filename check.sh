#!/usr/bin/env bash
# Run after updating herdr or ai-memory: checks that the ai-memory mod still
# loads in herdr and that every JSON field it reads still exists.
# Usage: ~/.config/herdr-app/mods/ai-memory/check.sh [project folder]
set -u
MOD="$(cd "$(dirname "$0")" && pwd)"
DIR="${1:-$PWD}"
fail=0
ok()  { printf '  \033[32m✓\033[0m %s\n' "$1"; }
bad() { printf '  \033[31m✗\033[0m %s\n' "$1"; fail=1; }

echo "herdr ($(hc server status 2>/dev/null | python3 -c 'import sys,json;print(json.load(sys.stdin).get("version","?"))' 2>/dev/null || echo '?'))"
if out=$(herdr-app check "$MOD" 2>&1); then ok "herdr-app check"; else bad "herdr-app check"; echo "$out" | sed 's/^/      /'; fi
for fn in terminals exec theme run; do
  grep -qE "^export function $fn\b" "${HERDR_APP_HOME:-$HOME/.config/herdr-app}/herdr.d.ts" \
    && ok "herdr API: $fn()" || bad "herdr API: $fn() desapareceu"
done

if hc ls --json 2>/dev/null | python3 -I -c "import sys,json;d=json.load(sys.stdin)['terminals'];assert all({'address','state','cwd'}<=t.keys() for t in d)" 2>/dev/null
then ok "hc ls: address/state/cwd"; else bad "hc ls: campos dos terminais mudaram"; fi

echo "ai-memory ($(ai-memory --version 2>/dev/null | awk '{print $2}'))"
probe() { # name, python expression over `d`, command...
  local name="$1" expr="$2"; shift 2
  local json; json=$(cd "$DIR" && "$@" --json 2>/dev/null)
  if [ -z "$json" ]; then bad "$name: sem resposta JSON"; return; fi
  if printf '%s' "$json" | python3 -I -c "import sys,json;d=json.load(sys.stdin);assert ($expr)" 2>/dev/null
  then ok "$name"; else bad "$name: campos mudaram ($expr)"; fi
}
probe "status"        "'version' in d and 'spool' in d" ai-memory status
probe "list-projects" "isinstance(d,list) and (not d or {'workspace_name','project_name','page_count','last_updated'} <= d[0].keys())" ai-memory list-projects
probe "doctor"        "{'workspace','project','server_unreachable','uncaptured'} <= d.keys()" ai-memory doctor
ws_proj=$(cd "$DIR" && ai-memory doctor --json 2>/dev/null | python3 -I -c 'import sys,json;d=json.load(sys.stdin);print(d["workspace"],d["project"])' 2>/dev/null)
if [ -n "$ws_proj" ]; then
  set -- $ws_proj
  probe "message list"  "isinstance(d,list) and (not d or {'subject','state','created_at'} <= d[0].keys())" ai-memory message list --workspace "$1" --project "$2"
  probe "handoffs"      "isinstance(d,list)" ai-memory handoffs --workspace "$1" --project "$2"
fi

[ $fail = 0 ] && echo "Tudo compatível." || echo "Há incompatibilidades: ajusta mods/ai-memory/data.js (ai-memory) ou main.js (herdr)."
exit $fail
