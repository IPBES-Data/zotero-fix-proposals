/* global Zotero, Services, IOUtils, PathUtils, test, assert */

// Tests of the fix window inside Zotero (run by tests/zotero/run.sh): a test
// group with items, a feed with proposals for them in a local folder, and the
// window driven through its DOM. Safe Edit's approval dialog and permission
// question are answered by the tests.

var FP = Zotero.FixProposals;
var SE = Zotero.SafeEdit;
var GID = 9990002;
var ctx = {};

async function waitFor(fn, what, ms = 20000) {
  var start = Date.now();
  for (;;) {
    var v = await fn();
    if (v) return v;
    if (Date.now() - start > ms) {
      var busy = ctx.win && ctx.win.document.getElementById("busy");
      throw new Error(`timed out waiting for ${what}` + (busy && busy.textContent ? ` (window says: ${busy.textContent})` : ""));
    }
    await Zotero.Promise.delay(100);
  }
}

async function item(fields) {
  var it = new Zotero.Item("journalArticle");
  it.libraryID = ctx.group.libraryID;
  for (let [k, v] of Object.entries(fields)) it.setField(k, v);
  await it.saveTx();
  return it;
}

var change = (it, field, old, neu, more = {}) => ({
  item_key: it.key, title: it.getField("title"), field, old, new: neu, reason: "test", proposed: true,
  note: null, doi: null, openalex: null, choice: null, preselect: null, append: null, ...more,
});

var doc = () => ctx.win.document;
var $ = (sel) => doc().querySelector(sel);
var $$ = (sel) => [...doc().querySelectorAll(sel)];

async function chooseFix(id) {
  doc().querySelector('#tabs button[data-tab="fixes"]').click();
  var ml = $("#fix");
  ml.value = id;
  ml.dispatchEvent(new ctx.win.Event("command"));
  await waitFor(() => !/Loading/.test($("#fix-body").textContent) && $("#fix-body").textContent.length, "fix " + id);
}

test("setup: test group, items, feed in a local folder, permission", async () => {
  var g = new Zotero.Group();
  Object.assign(g, { id: GID, name: "Fix Proposals test group", description: "", editable: true, filesEditable: true, version: 1, archived: false });
  await g.saveTx();
  ctx.group = g;

  var a = [];
  for (let i = 0; i < 3; i++) a.push(await item({ title: "Link " + i, DOI: "https://doi.org/10.1/a" + i }));
  var e = await item({ title: "Not proposed", language: "Español" });
  var d = await item({ title: "No DOI" });
  var x1 = await item({ title: "Extra empty" });
  var x2 = await item({ title: "Extra with PMID", extra: "PMID: 1" });
  ctx.items = { a, e, d, x1, x2 };

  var feed = {
    format: "zotero-fix-proposals", version: 1, created: new Date().toISOString(), group_id: GID, name: "Test",
    checks: [
      { id: "doi-form", check: "DOI form", count: 3, severity: "fix", status: "Please fix" },
      { id: "doi-candidates", check: "DOI found", count: 1, severity: "check", status: "Please check" },
      { id: "openalex-id", check: "OpenAlex ID", count: 2, severity: "info", status: "For information" },
    ],
    fixes: [
      { id: "doi_form", problem: "DOI as link", value: "DOI only", field: "DOI", check: "doi-form", bulk: false,
        changes: [...a.map((it, i) => change(it, "DOI", "https://doi.org/10.1/a" + i, "10.1/a" + i)),
          change(e, "language", "Español", "", { proposed: false, note: "Language not recognised" })] },
      { id: "doi_candidates", problem: "No DOI", value: "DOI found", field: "DOI", check: "doi-candidates", bulk: false,
        changes: [change(d, "DOI", "", "10.1/d1", { choice: d.key, preselect: true }),
          change(d, "DOI", "", "10.1/d2", { choice: d.key, preselect: false })] },
      { id: "openalex_id", problem: "No OpenAlex ID", value: "OpenAlex ID", field: "Extra", check: "openalex-id", bulk: true,
        changes: [change(x1, "extra", "", "OpenAlex: W1", { append: "OpenAlex: W1" }),
          change(x2, "extra", "", "OpenAlex: W2", { append: "OpenAlex: W2" })] },
    ],
  };
  ctx.feed = feed;
  var dir = PathUtils.join(PathUtils.tempDir, "fix-proposals-feed-" + Date.now());
  ctx.feedDir = dir;
  await IOUtils.makeDirectory(dir);
  await IOUtils.writeUTF8(PathUtils.join(dir, "index.json"),
    JSON.stringify({ format: "zotero-fix-proposals-index", version: 1, created: feed.created, groups: [{ group_id: GID, name: "Test", file: "test.json" }] }));
  await IOUtils.writeUTF8(PathUtils.join(dir, "test.json"), JSON.stringify(feed));
  // a plain folder path, as a user would enter it
  Zotero.Prefs.set("extensions.fix-proposals.feedURL", dir, true);
  assert.equal(FP.feed.url(), PathUtils.toFileURI(dir) + "/", "folder path read as file address");

  // Safe Edit: permission once, a fresh backup, approval answered by the tests
  SE.clients._confirm = () => true;
  await SE.backup.create(GID);
  SE.dialog.open = async (rows) => ({ approved: rows.filter((r) => r.ok).map((r) => r.index), scrolled_to_end: true });
});

test("the window opens and shows the status of each fix", async () => {
  ctx.win = FP.openWindow();
  await waitFor(() => ctx.win.document.readyState === "complete", "window");
  var rows = await waitFor(() => {
    var r = $$("#fixes-status tr[data-fix]");
    return r.length === 3 && r.every((tr) => !/…/.test(tr.textContent)) && r;
  }, "status table");
  var cells = (id) => [...doc().querySelector(`#fixes-status tr[data-fix="${id}"]`).children].map((c) => c.textContent);
  assert.equal(cells("doi_form")[3], "3", "items doi_form");
  assert.match(cells("doi_form")[5], /Please fix/, "status doi_form");
  assert.match(cells("doi_form")[6], /1 not proposed/, "not proposed");
  assert.equal(cells("doi_candidates")[3], "1", "options count as one item");
  assert.equal(cells("openalex_id")[3], "2", "items openalex_id");
  assert.ok(SE.clients.forPlugin("fix-proposals@ipbes-data"), "registered with Safe Edit");
  assert.match($("#updated").textContent, /^Fixes updated: /, "when the fixes were updated");
});

test("sending the current page writes the changes, then they are made already", async () => {
  await chooseFix("doi_form");
  assert.equal($$("#changes input[data-k]").length, 3, "3 changes");
  assert.equal($$("#not-proposed tr").length, 2, "not proposed listed");
  $("#send-page").click();
  await waitFor(() => $("#result"), "result");
  assert.match($("#result").textContent, /3 of 3 changes applied/, "result");
  for (let [i, it] of ctx.items.a.entries()) {
    assert.equal((await Zotero.Items.getAsync(it.id)).getField("DOI"), "10.1/a" + i, "written " + i);
  }
  await chooseFix("doi_form");
  assert.match($("#fix-body").textContent, /all 3 changes are made already/, "made already");
});

test("options of an item: only one can be ticked", async () => {
  await chooseFix("doi_candidates");
  var boxes = $$("#changes input.option");
  assert.equal(boxes.length, 2, "2 options");
  assert.ok(boxes[0].checked && !boxes[1].checked, "the likely one preselected");
  boxes[1].checked = true;
  boxes[1].dispatchEvent(new ctx.win.Event("change"));
  assert.ok(!boxes[0].checked && boxes[1].checked, "ticking the second unticks the first");
  $("#send-all").click();
  await waitFor(() => $("#result"), "result");
  assert.equal((await Zotero.Items.getAsync(ctx.items.d.id)).getField("DOI"), "10.1/d2", "chosen option written");
});

test("one-button fix adds the line to the current Extra", async () => {
  await chooseFix("openalex_id");
  assert.equal($$("#changes").length, 0, "no table");
  assert.match($("#fix-body").textContent, /2 items/, "count");
  $("#send-all").click();
  await waitFor(() => $("#result"), "result");
  assert.equal((await Zotero.Items.getAsync(ctx.items.x1.id)).getField("extra"), "OpenAlex: W1", "empty Extra");
  assert.equal((await Zotero.Items.getAsync(ctx.items.x2.id)).getField("extra"), "PMID: 1\nOpenAlex: W2", "line added");
});

test("after making a backup, the old \"backup too old\" message is gone", async () => {
  // a backup 999 minutes old, until "Make a backup" is clicked
  var ageMinutes = SE.backup.ageMinutes;
  SE.backup.ageMinutes = async () => 999;
  var create = SE.backup.create;
  SE.backup.create = async (gid) => {
    SE.backup.ageMinutes = ageMinutes;
    return create.call(SE.backup, gid);
  };
  try {
    doc().querySelector('#tabs button[data-tab="status"]').click();
    $("#refresh").click();
    await waitFor(() => $$("#fixes-status tr[data-fix]").length === 3 && !/…/.test($("#fixes-status").textContent), "status");
    await chooseFix("doi_candidates");
    assert.match($("#fix-body").textContent, /999 minutes old/, "blocked with the old backup");
    doc().querySelector('#tabs button[data-tab="status"]').click();
    $("#backup").click();
    await waitFor(() => /Backup made/.test(($("#busy") || {}).textContent || ""), "backup made");
    await waitFor(() => !/…/.test($("#fixes-status").textContent), "status after backup");
    await chooseFix("doi_candidates");
    assert.ok(!/minutes old/.test($("#fix-body").textContent), "message gone after the backup");
  } finally {
    SE.backup.ageMinutes = ageMinutes;
    SE.backup.create = create;
  }
});

test("switching automatic sync off removes its message without Refresh", async () => {
  Zotero.Prefs.set("sync.autoSync", true);
  try {
    await chooseFix("doi_candidates");
    assert.match($("#fix-body").textContent, /Automatic sync is on/, "message while sync is on");
    Zotero.Prefs.set("sync.autoSync", false);
    doc().querySelector('#tabs button[data-tab="status"]').click();
    await waitFor(() => /Automatic sync\s*off/.test($("#tab-status").textContent), "status shows sync off");
    await chooseFix("doi_candidates");
    assert.ok(!/Automatic sync is on/.test($("#fix-body").textContent), "message gone");
  } finally {
    Zotero.Prefs.set("sync.autoSync", false);
  }
});

test("a group you cannot edit: nothing can be sent", async () => {
  var g = Zotero.Groups.get(GID);
  g.editable = false;
  await g.saveTx();
  try {
    $("#refresh").click();
    await waitFor(() => !/Loading/.test(($("#busy") || {}).textContent || "") && $$("#fixes-status tr[data-fix]").length === 3, "reloaded");
    await chooseFix("openalex_id");
    var b = $("#send-all");
    assert.ok(!b || b.disabled, "Send all off");
  } finally {
    g.editable = true;
    await g.saveTx();
    $("#refresh").click();
    await waitFor(() => $$("#fixes-status tr[data-fix]").length === 3 && !/…/.test($("#fixes-status").textContent), "reloaded");
  }
});

test("while a group loads, nothing of the previous one is shown", async () => {
  $("#refresh").click();
  assert.ok(!$("#fixes-status"), "old status table gone at once");
  assert.match($("#tab-status").textContent, /Loading/, "loading shown");
  await waitFor(() => $$("#fixes-status tr[data-fix]").length === 3 && !/…/.test($("#fixes-status").textContent), "reloaded");
});

test("\"Show in Zotero\" selects the item in the main window", async () => {
  await chooseFix("doi_form");
  var box = $("#show-done");
  box.checked = true;
  box.dispatchEvent(new ctx.win.Event("change"));
  var link = await waitFor(() => $$("#made a").find((a) => a.textContent === "Show in Zotero"), "link");
  link.click();
  var zp = Zotero.getMainWindow().ZoteroPane;
  await waitFor(() => zp.getSelectedItems().length === 1 && zp.getSelectedItems()[0].key === ctx.items.a[0].key, "item selected");
});

test("only one window: opening it again brings it to the front", async () => {
  var again = FP.openWindow();
  var count = [...Services.wm.getEnumerator(null)].filter((w) => String(w.location).includes("fixes.xhtml")).length;
  assert.equal(count, 1, "one window");
  assert.ok(again === ctx.win, "the same window");
});

test("undo of the last batch restores Extra", async () => {
  doc().querySelector('#tabs button[data-tab="undo"]').click();
  var batches = await waitFor(() => { var b = $$("#undo-body details.batch"); return b.length >= 3 && b; }, "batches");
  assert.match(batches[0].querySelector("summary").textContent, /test · Extra \(2\)/, "newest batch first, described");
  var box = batches[0].querySelector("summary input");
  box.checked = true;
  box.dispatchEvent(new ctx.win.Event("change"));
  $("#undo").click();
  await waitFor(async () => (await Zotero.Items.getAsync(ctx.items.x2.id)).getField("extra") === "PMID: 1", "undone");
  assert.equal((await Zotero.Items.getAsync(ctx.items.x1.id)).getField("extra"), "", "first undone too");
  ctx.win.close();
});

// ---- feeds: web address and errors (the window is opened anew) -------------

async function reopen() {
  for (let w of Services.wm.getEnumerator(null)) if (String(w.location).includes("fixes.xhtml")) w.close();
  await Zotero.Promise.delay(300);
  ctx.win = FP.openWindow();
  await waitFor(() => ctx.win.document.readyState === "complete", "window");
}

test("proposals from a web address", async () => {
  var web = Services.prefs.getStringPref("extensions.fix-proposals-tests.webDir");
  for (let f of ["index.json", "test.json"]) {
    await IOUtils.copy(PathUtils.join(ctx.feedDir, f), PathUtils.join(web, f));
  }
  Zotero.Prefs.set("extensions.fix-proposals.feedURL", Services.prefs.getStringPref("extensions.fix-proposals-tests.webURL"), true);
  await reopen();
  await waitFor(() => $$("#fixes-status tr[data-fix]").length === 3 && !/…/.test($("#fixes-status").textContent), "status from the web");
  ctx.win.close();
});

test("an address without proposals gives a clear message", async () => {
  Zotero.Prefs.set("extensions.fix-proposals.feedURL", PathUtils.join(PathUtils.tempDir, "no-such-folder-" + Date.now()), true);
  await reopen();
  var msg = await waitFor(() => { var b = $("#busy"); return b && b.className === "warn" && b.textContent; }, "error message");
  assert.match(msg, /index\.json|No such file|not found|NotFoundError/i, "says what is missing: " + msg);
  ctx.win.close();
});

test("a damaged proposals file gives a clear message", async () => {
  var dir = PathUtils.join(PathUtils.tempDir, "fix-proposals-bad-" + Date.now());
  await IOUtils.makeDirectory(dir);
  await IOUtils.writeUTF8(PathUtils.join(dir, "index.json"),
    JSON.stringify({ format: "zotero-fix-proposals-index", version: 1, groups: [{ group_id: GID, name: "Test", file: "test.json" }] }));
  var bad = JSON.parse(JSON.stringify(ctx.feed));
  bad.fixes[0].changes[0].item_key = "not a key";
  await IOUtils.writeUTF8(PathUtils.join(dir, "test.json"), JSON.stringify(bad));
  Zotero.Prefs.set("extensions.fix-proposals.feedURL", dir, true);
  await reopen();
  var msg = await waitFor(() => { var b = $("#busy"); return b && b.className === "warn" && b.textContent; }, "error message");
  assert.match(msg, /incomplete/, "names the problem: " + msg);
  ctx.win.close();
  Zotero.Prefs.set("extensions.fix-proposals.feedURL", ctx.feedDir, true);
});

test("disabling and enabling the plugin: menu entry and interface go and come back", async () => {
  var { AddonManager } = ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs");
  var addon = await AddonManager.getAddonByID("fix-proposals@ipbes-data");
  var menu = () => Zotero.getMainWindow().document.getElementById("fix-proposals-menuitem");
  assert.ok(menu(), "menu entry before");
  FP.openWindow();
  var windows = () => [...Services.wm.getEnumerator(null)].filter((w) => String(w.location).includes("fixes.xhtml")).length;
  await waitFor(() => windows() === 1, "window open");
  await addon.disable();
  await waitFor(() => !Zotero.FixProposals && !menu(), "gone after disabling");
  await waitFor(() => windows() === 0, "window closed after disabling");
  await addon.enable();
  await waitFor(() => Zotero.FixProposals && menu(), "back after enabling");
  FP = Zotero.FixProposals;
});
