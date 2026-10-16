// Tests of addon/src/logic.js outside Zotero: node --test tests/
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
global.FixProposals = {};
eval(fs.readFileSync(__dirname + "/../addon/src/logic.js", "utf8"));
const L = FixProposals.logic;

const ch = (o) => ({ item_key: "AAAAAAAA", field: "DOI", old: "", new: "10.1/x", proposed: true, ...o });

test("made already: DOIs ignore case, other fields do not", () => {
  assert.ok(L.isMade(ch({ new: "10.1/ABC" }), "10.1/abc"));
  assert.ok(!L.isMade(ch({ field: "language", new: "en" }), "EN"));
  assert.ok(!L.isMade(ch(), null));
});

test("adding a line is based on the current value", () => {
  const c = ch({ field: "extra", new: "OpenAlex: W1", append: "OpenAlex: W1" });
  assert.deepStrictEqual(L.rebase(c, "PMID: 1"), { ...c, old: "PMID: 1", new: "PMID: 1\nOpenAlex: W1" });
  assert.strictEqual(L.rebase(c, "").new, "OpenAlex: W1");
  const there = L.rebase(c, "PMID: 1\nOpenAlex: W1");
  assert.ok(L.isMade(there, "PMID: 1\nOpenAlex: W1"), "line there already = made");
  const other = ch();
  assert.strictEqual(L.rebase(other, "x"), other, "other changes unchanged");
});

test("batch size: large only for added Extra lines with line batches on", () => {
  const s = { max_batch_size: 25, line_batches: true, max_line_batch_size: 10000 };
  const lines = Array.from({ length: 30 }, () => ch({ field: "extra", new: "OpenAlex: W1" }));
  const dois = Array.from({ length: 30 }, () => ch());
  assert.strictEqual(L.maxBatch(s, lines), 10000);
  assert.strictEqual(L.maxBatch(s, dois), 25);
  assert.strictEqual(L.maxBatch({ ...s, line_batches: false }, lines), 25);
  assert.deepStrictEqual(L.batches([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
});

test("one option per item, like radio buttons", () => {
  const c = [ch({ choice: "K1" }), ch({ choice: "K1" }), ch({ choice: "K2" }), ch()];
  let s = L.select(new Set(), c, 0, true);
  s = L.select(s, c, 2, true);
  s = L.select(s, c, 1, true);
  assert.deepStrictEqual([...s].sort(), [1, 2], "ticking 1 unticks 0");
  s = L.select(s, c, 1, false);
  assert.deepStrictEqual([...s], [2], "unticking leaves the item without");
});

test("initial selection: accepted changes, preselected options only, one per item", () => {
  const c = [ch({ choice: "K1", preselect: true }), ch({ choice: "K1", preselect: false }), ch({ choice: "K2", preselect: false }), ch()];
  assert.deepStrictEqual([...L.initialSelection(c, [true, true, true, false])], [0]);
});

test("counts: options count once, fixed from what is made", () => {
  const c = [ch({ choice: "K1" }), ch({ choice: "K1" }), ch({ item_key: "BBBBBBBB" }), ch({ item_key: "CCCCCCCC", proposed: false })];
  assert.deepStrictEqual(L.counts(c, [false, true, false, false]), { items: 2, fixed: 1 });
  assert.deepStrictEqual(L.counts(c, null), { items: 2, fixed: null });
});

test("status as in the report", () => {
  assert.strictEqual(L.status(0, "fix"), "OK");
  assert.strictEqual(L.status(3, "fix"), "Please fix");
  assert.strictEqual(L.status(3, "check"), "Please check");
  assert.strictEqual(L.status(3, "info"), "For information");
});

test("batch labels say what a batch did", () => {
  const e = [
    { time: "2026-10-15T15:58:19Z", action: "edit", field: "extra", reason_for_change: "OpenAlex ID of the DOI" },
    { time: "2026-10-15T15:58:20Z", action: "edit", field: "extra", reason_for_change: "OpenAlex ID of the DOI" },
  ];
  assert.match(L.batchLabel(e), /^\d{4}-\d\d-\d\d \d\d:\d\d · OpenAlex ID of the DOI · Extra \(2\)$/);
  assert.match(L.batchLabel([{ ...e[0], action: "undo", field: "DOI" }]), /Undo of an earlier change · DOI \(1\)/);
});

test("proposals files are checked", () => {
  const sample = JSON.parse(fs.readFileSync(__dirname + "/fixtures/sample.json", "utf8"));
  assert.deepStrictEqual(L.checkFile(sample), [], "sample from the pipeline");
  assert.ok(L.checkFile({ format: "other" }).length);
  assert.ok(L.checkFile({ ...sample, version: 2 }).length);
  const bad = JSON.parse(JSON.stringify(sample));
  bad.fixes.find((f) => f.changes.length).changes[0].item_key = "abc";
  assert.ok(L.checkFile(bad).length, "bad item key");
});
