/* global Zotero, Services, Cc, Ci, ChromeUtils */

// Test harness, loaded only into the test profile made by tests/zotero/run.sh:
// runs every tests/zotero/*.test.js inside Zotero, writes the results to the
// file given in the pref extensions.fix-proposals-tests.results and quits Zotero.

function install() {}
function uninstall() {}
function shutdown() {}

// Zotero starts plugins one after the other and waits for each startup():
// the tests run detached, so that the plugins can start in the meantime
function startup() {
  run();
}

async function run() {
  await Zotero.initializationPromise;
  var win = Zotero.getMainWindow();
  var IO = win.IOUtils;
  var P = win.PathUtils;
  var dir = Services.prefs.getStringPref("extensions.fix-proposals-tests.dir");
  var out = Services.prefs.getStringPref("extensions.fix-proposals-tests.results");
  var results = [];
  try {
    for (let i = 0; i < 600 && !(Zotero.SafeEdit && Zotero.SafeEdit.api && Zotero.FixProposals); i++) {
      await Zotero.Promise.delay(100);
    }
    if (!(Zotero.SafeEdit && Zotero.SafeEdit.api && Zotero.FixProposals)) {
      // errors of the plugin from the error console
      var errors = Services.console
        .getMessageArray()
        .map((m) => `${m.sourceName || ""} ${m.errorMessage || m.message || m}`)
        .filter((m) => /safe-edit|SafeEdit|fix-proposals|FixProposals/i.test(m))
        .slice(-20);
      throw new Error("Safe Edit or Fix Proposals did not start within 60 s\n" + errors.join("\n"));
    }
    var tests = [];
    var assert = {
      ok(v, msg) {
        if (!v) throw new Error(msg || "expected a true value");
      },
      equal(a, b, msg) {
        if (a !== b) throw new Error(`${msg || "not equal"}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
      },
      match(s, re, msg) {
        if (!re.test(String(s))) throw new Error(`${msg || "no match"}: ${JSON.stringify(s)} !~ ${re}`);
      },
    };
    var files = (await IO.getChildren(dir)).filter((f) => f.endsWith(".test.js")).sort();
    for (let f of files) {
      Services.scriptloader.loadSubScript(P.toFileURI(f), {
        Zotero,
        Services,
        Cc,
        Ci,
        ChromeUtils,
        IOUtils: IO,
        PathUtils: P,
        assert,
        test: (name, fn) => tests.push({ file: P.filename(f), name, fn }),
      });
    }
    for (let t of tests) {
      var start = Date.now();
      try {
        await t.fn();
        results.push({ file: t.file, name: t.name, ok: true, ms: Date.now() - start });
      } catch (e) {
        results.push({ file: t.file, name: t.name, ok: false, error: `${e}\n${(e && e.stack) || ""}` });
      }
    }
  } catch (e) {
    results.push({ file: "harness", name: "setup", ok: false, error: `${e}\n${(e && e.stack) || ""}` });
  }
  await IO.writeUTF8(out, JSON.stringify(results, null, 1));
  Services.startup.quit(Ci.nsIAppStartup.eForceQuit);
}
