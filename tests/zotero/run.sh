#!/bin/sh
# Runs tests/zotero/*.test.js inside a separate Zotero: own temporary profile,
# data directory (build/test-profile) and local server port, so a Zotero which
# is already running (and its data) is not touched. Loads this plugin from
# addon/, Zotero Safe Edit from SAFE_EDIT (default: ../zotero-safe-edit/addon)
# and the harness from tests/zotero/harness/. Zotero opens briefly.
#
#   tests/zotero/run.sh            (ZOTERO=<path to the zotero binary> to override)
set -e
cd "$(dirname "$0")/../.."
root=$PWD
ZOTERO=${ZOTERO:-/Applications/Zotero.app/Contents/MacOS/zotero}
dir="$root/build/test-profile"
results="$dir/results.json"

rm -rf "$dir"
mkdir -p "$dir/extensions" "$dir/data"
# unpacked plugins: a file named after the plugin ID with the path to its source
SAFE_EDIT=${SAFE_EDIT:-$root/../zotero-safe-edit/addon}
[ -f "$SAFE_EDIT/manifest.json" ] || { echo "Zotero Safe Edit not found at $SAFE_EDIT (set SAFE_EDIT)"; exit 2; }
echo "$(cd "$SAFE_EDIT" && pwd)" > "$dir/extensions/safe-edit@ipbes-data"
echo "$root/addon" > "$dir/extensions/fix-proposals@ipbes-data"
echo "$root/tests/zotero/harness" > "$dir/extensions/fix-proposals-tests@ipbes-data"
cat > "$dir/user.js" <<PREFS
user_pref("extensions.zotero.dataDir", "$dir/data");
user_pref("extensions.zotero.useDataDir", true);
user_pref("extensions.zotero.httpServer.port", 23139);
user_pref("extensions.zotero.sync.autoSync", false);
user_pref("extensions.zotero.firstRun2", false);
user_pref("extensions.autoDisableScopes", 0);
user_pref("extensions.enabledScopes", 15);
user_pref("app.update.enabled", false);
user_pref("app.update.auto", false);
user_pref("extensions.safe-edit.allowedFields", "DOI, extra");
user_pref("extensions.fix-proposals-tests.dir", "$root/tests/zotero");
user_pref("extensions.fix-proposals-tests.webDir", "$dir/web");
user_pref("extensions.fix-proposals-tests.webURL", "http://127.0.0.1:23141/");
user_pref("extensions.fix-proposals-tests.results", "$results");
PREFS

# a small web server for the test of feeds from a web address
mkdir -p "$dir/web"
python3 -m http.server 23141 --bind 127.0.0.1 --directory "$dir/web" > "$dir/web.log" 2>&1 &
web=$!
trap 'kill $web 2>/dev/null || true' EXIT

MOZ_NO_REMOTE=1 "$ZOTERO" -profile "$dir" -no-remote > "$dir/zotero.log" 2>&1 &
pid=$!
i=0
while [ ! -f "$results" ] && [ $i -lt 300 ] && kill -0 $pid 2>/dev/null; do
  sleep 1
  i=$((i + 1))
done
if [ ! -f "$results" ]; then
  kill $pid 2>/dev/null || true
  echo "No results (Zotero log: $dir/zotero.log)"
  exit 2
fi
sleep 2
kill $pid 2>/dev/null || true

node -e '
const r = require(process.argv[1]);
for (const t of r) {
  console.log((t.ok ? "PASS  " : "FAIL  ") + t.name + (t.ok ? "" : "\n      " + t.error.split("\n").slice(0, 8).join("\n      ")));
}
const failed = r.filter((t) => !t.ok).length;
console.log(`${r.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
' "$results"
