/* global Zotero, document, window */

// The fix window: reads the proposals of a group from the feed, shows them
// with the current values and differences (Safe Edit preview) and sends the
// chosen ones to Zotero Safe Edit, which asks for approval, writes and logs.
// Item data is only ever inserted as text.

var FP, SE, L, api;
var S = { index: null, entry: null, data: null, status: null, group: null, previews: new Map(), result: null };
var PAGE = 50;

// the window's styles, with the version in the address: Zotero keeps
// stylesheets in memory while it runs, so an update would otherwise not show
document.head.append(
  Object.assign(document.createElementNS("http://www.w3.org/1999/xhtml", "link"), {
    rel: "stylesheet",
    href: "chrome://fix-proposals/content/fixes.css?v=" + Zotero.FixProposals.version,
  })
);

// ---- small helpers ----------------------------------------------------------

function el(tag, attrs, ...children) {
  var e = document.createElement(tag);
  for (let [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (k === "class") e.className = v;
    else e.setAttribute(k, v === true ? k : v);
  }
  for (let c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    e.append(typeof c == "string" || typeof c == "number" ? document.createTextNode(String(c)) : c);
  }
  return e;
}
var $ = (id) => document.getElementById(id);
var show = (node, ...children) => node.replaceChildren(...children.flat().filter(Boolean));
var warn = (text) => el("p", { class: "warn" }, text);
var localTime = (iso) => (iso ? new Date(iso).toLocaleString() : "");
var plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
var kind = (label) => ({ OK: "ok", "Please fix": "fix", "Please check": "check" })[label] || "info";
var light = (k, text) => el("span", { class: "light " + k }, text);
var pill = (label, ...buttons) => el("div", { class: "pill" }, el("span", {}, label), ...buttons);
// drop-downs are Zotero's menulist: HTML select lists do not open in
// separate Zotero windows
function setItems(menulist, items) {
  menulist.menupopup.replaceChildren(
    ...items.map(({ value, label }) => {
      var mi = document.createXULElement("menuitem");
      mi.setAttribute("value", String(value));
      mi.setAttribute("label", label);
      return mi;
    })
  );
  menulist.selectedIndex = items.length ? 0 : -1;
}

function menulist(id, items) {
  var ml = document.createXULElement("menulist");
  ml.id = id;
  ml.appendChild(document.createXULElement("menupopup"));
  setItems(ml, items);
  return ml;
}

var fixLabel = (f) => `${f.problem} → ${f.value} in ${f.field}${f.field.includes(",") ? " fields" : " field"}`;

// runs an event handler; errors are shown at the top of the window
function guarded(fn) {
  return async (...args) => {
    try {
      busy(null);
      await fn(...args);
    } catch (e) {
      Zotero.logError(e);
      busy(String(e.message || e), true);
    }
  };
}

function busy(text, error = false) {
  var b = $("busy") || $("connection").parentNode.appendChild(el("span", { id: "busy" }));
  b.className = error ? "warn" : "notes";
  b.textContent = text || "";
}

function toChange(c) {
  return { group_id: S.data.group_id, item_key: c.item_key, field: c.field, old: c.old, new: c.new, reason: c.reason };
}

// ---- start -------------------------------------------------------------------

window.addEventListener("load", guarded(init));

async function init() {
  FP = Zotero.FixProposals;
  SE = Zotero.SafeEdit;
  L = FP.logic;
  for (let b of document.querySelectorAll("#tabs button")) {
    b.addEventListener("click", guarded(() => showTab(b.dataset.tab)));
  }
  $("refresh").addEventListener("click", guarded(() => loadGroup()));
  $("group").addEventListener("command", guarded(() => loadGroup()));
  $("fix").addEventListener("command", guarded(() => showFix()));

  if (!SE || !SE.api) {
    show($("tab-status"), warn(
      "Zotero Safe Edit 0.2.0 or newer is needed to write changes. It is not installed, not enabled, or too old."));
    return;
  }
  try {
    api = await SE.api.connect({ pluginID: FP.id, name: "Zotero Fix Proposals" });
  } catch (e) {
    show($("tab-status"), warn(e.message), el("button", { onclick: guarded(init) }, "Try again"));
    return;
  }
  busy("Loading the proposals …");
  S.index = await FP.feed.index();
  var groups = [...S.index.groups].sort((a, b) => a.name.localeCompare(b.name));
  var inZotero = (g) => !!Zotero.Groups.getLibraryIDFromGroupID(g.group_id);
  setItems(
    $("group"),
    groups.map((g) => ({ value: g.group_id, label: g.name + (inZotero(g) ? "" : " (not in this Zotero)") }))
  );
  var first = groups.find(inZotero);
  if (first) $("group").value = String(first.group_id);
  await loadGroup();
}

// tabs wait for a group which is still loading (S.loading)
function loadGroup() {
  S.loading = loadGroupNow();
  return S.loading;
}

async function loadGroupNow() {
  var gid = Number($("group").value);
  S.entry = S.index.groups.find((g) => g.group_id === gid);
  S.previews = new Map();
  S.result = null;
  // nothing of the previous group stays visible while loading
  for (let id of ["tab-status", "fix-body", "undo-body", "restore-body"]) {
    show($(id), el("p", { class: "notes loading" }, "Loading " + S.entry.name + " …"));
  }
  busy("Loading the proposals of " + S.entry.name + " …");
  S.data = await FP.feed.group(S.entry);
  await refreshStatus();
  var fixValue = $("fix").value;
  setItems($("fix"), S.data.fixes.map((f) => ({ value: f.id, label: fixLabel(f) })));
  if (fixValue && S.data.fixes.some((f) => f.id === fixValue)) $("fix").value = fixValue;
  busy(null);
  await renderStatus();
  var active = document.querySelector("#tabs button.active").dataset.tab;
  if (active !== "status") await showTab(active, false);
}

async function refreshStatus() {
  S.status = await api.status([S.data.group_id]);
  S.group = S.status.groups[0];
  $("connection").textContent =
    `Safe Edit ${S.status.plugin_version} · report data of ${localTime(S.data.created)}`;
}

async function showTab(name, wait = true) {
  if (wait && S.loading) await S.loading;
  for (let b of document.querySelectorAll("#tabs button")) b.classList.toggle("active", b.dataset.tab === name);
  for (let s of document.querySelectorAll("main > section")) s.hidden = s.id !== "tab-" + name;
  if (name === "status") {
    // Safe Edit's checks (sync, backup) may have changed since
    await refreshStatus();
    await renderStatus();
  }
  if (name === "fixes") await showFix();
  if (name === "undo") await renderUndo();
  if (name === "restore") renderRestore();
}

// ---- proposals with the current values in Zotero -----------------------------

async function prepared(fix) {
  if (S.previews.has(fix.id)) return S.previews.get(fix.id);
  var proposed = fix.changes.filter((c) => c.proposed);
  var p = { changes: proposed, notProposed: fix.changes.filter((c) => !c.proposed), rows: [], made: null, blockers: [], notCurrent: [] };
  if (S.group.in_zotero && proposed.length) {
    var pv = await api.preview(proposed.map(toChange));
    var current = pv.rows.map((r) => (r.current === undefined ? null : r.current));
    var rebased = proposed.map((c, i) => L.rebase(c, current[i]));
    if (rebased.some((c, i) => c !== proposed[i])) pv = await api.preview(rebased.map(toChange));
    p.changes = rebased;
    p.rows = pv.rows;
    p.blockers = pv.blockers.filter((b) => !/^Too many changes/.test(b));
    p.made = rebased.map((c, i) => L.isMade(c, current[i]));
  }
  if (S.group.in_zotero && p.notProposed.length) {
    var pn = await api.preview(p.notProposed.map(toChange));
    p.notCurrent = pn.rows.map((r) => (r.current === undefined ? null : r.current));
  }
  S.previews.set(fix.id, p);
  return p;
}

// Safe Edit's checks of the whole batch (automatic sync, backup age, …) as they
// are now: they change independently of the items, so they are not kept with
// the proposals but asked for each time (one change is enough)
async function blockersNow(p) {
  if (!S.group.in_zotero || !p.changes.length) return [];
  var pv = await api.preview([toChange(p.changes[0])]);
  return pv.blockers.filter((b) => !/^Too many changes/.test(b));
}

// changes still to make: not made, and no other option of the item made
function outstanding(p) {
  var madeChoices = new Set(
    p.changes.filter((c, i) => p.made && p.made[i] && c.choice != null).map((c) => c.choice)
  );
  var open = [];
  var done = [];
  p.changes.forEach((c, i) => {
    if (p.made && p.made[i]) done.push(i);
    else if (!(c.choice != null && madeChoices.has(c.choice))) open.push(i);
  });
  return { open, done };
}

// ---- Status ------------------------------------------------------------------

async function renderStatus() {
  var s = S.status;
  var g = S.group;
  var age = g.backup_age_minutes;
  var fresh = age !== null && age !== undefined && age <= s.max_backup_age_minutes;
  var rows = [
    ["Automatic sync", s.auto_sync ? light("fix", "on — switch it off in Zotero (Settings → Sync) before editing") : light("ok", "off")],
    [
      "Backup of this group",
      age === null || age === undefined
        ? light("fix", "none — make one before editing")
        : fresh
          ? light("ok", `${Math.round(age)} minutes old`)
          : light("fix", `${Math.round(age)} minutes old (at most ${s.max_backup_age_minutes}) — make a new one`),
    ],
    ["Group in this Zotero", light(g.in_zotero ? "ok" : "fix", g.in_zotero ? "yes" : "no")],
    ["You can edit this group", light(g.editable ? "ok" : "fix", g.editable ? "yes" : "no")],
  ];
  var backup = el("button", { id: "backup", disabled: !g.in_zotero }, "Make a backup of this group");
  backup.addEventListener(
    "click",
    guarded(async () => {
      busy("Making a backup …");
      await api.backup(S.data.group_id);
      // the proposals checked before still carry Safe Edit's old assessment
      // (e.g. "backup too old"): check them again
      S.previews = new Map();
      await refreshStatus();
      busy("Backup made.");
      await renderStatus();
    })
  );
  var fixesTable = el(
    "table",
    { class: "status", id: "fixes-status" },
    el("tr", {}, el("th", {}, "Problem"), el("th", {}, "Value"), el("th", {}, "Field"),
      el("th", { class: "count" }, "Items"), el("th", { class: "count" }, "Fixed"), el("th", {}, "Status"), el("th", {}, ""))
  );
  show(
    $("tab-status"),
    el("table", { class: "status" }, rows.map(([k, v]) => el("tr", {}, el("th", {}, k), el("td", {}, v)))),
    el("p", { class: "notes" },
      "Fields which may be edited: ", s.allowed_fields.map((f) => L.fieldLabel(f)).join(", "),
      ` · at most ${s.max_batch_size} changes per approval (set in Zotero: Settings → Safe Edit)`),
    pill("Zotero", backup),
    el("h3", {}, "Fixes"),
    fixesTable,
    el("p", { class: "notes" },
      `Items: from the report data of ${localTime(S.data.created)}. Fixed: of these, items which have the proposed ` +
      "value in Zotero now. Click a problem to show its outstanding proposed changes. ",
      S.data.report ? el("a", { onclick: () => Zotero.launchURL(S.data.report) }, "Open the report") : null),
    el("p", { class: "notes" },
      "Some fixes build on others: once an item has a DOI (from another field or found in OpenAlex), the fixes with " +
      "values from OpenAlex (date, empty fields, OpenAlex ID) can only find it after the next sync and run of the " +
      "report. So several rounds may be needed: fix, sync, wait for the report, fix again.")
  );
  // one row per fix; the counts need the current values, filled in as they come
  for (let fix of S.data.fixes) {
    var cells = { fixed: el("td", { class: "count" }, "…"), status: el("td", {}, "") };
    var link = el("a", { class: "fix-link" }, fix.problem);
    link.addEventListener("click", guarded(async () => {
      $("fix").value = fix.id;
      await showTab("fixes");
    }));
    var counts = L.counts(fix.changes, null);
    var notProposed = fix.changes.filter((c) => !c.proposed).length;
    fixesTable.append(
      el("tr", { "data-fix": fix.id }, el("th", {}, link), el("td", {}, fix.value), el("td", {}, fix.field),
        el("td", { class: "count" }, counts.items), cells.fixed, cells.status,
        el("td", { class: "notes" }, notProposed ? `${notProposed} not proposed` : ""))
    );
    var check = S.data.checks.find((c) => c.id === fix.check);
    var p = await prepared(fix);
    var c2 = L.counts(p.changes, p.made);
    cells.fixed.textContent = c2.fixed === null ? "–" : c2.fixed;
    var label = L.status(c2.items - (c2.fixed || 0), check ? check.severity : "info");
    show(cells.status, light(kind(label), label));
  }
}

// ---- Fixes -------------------------------------------------------------------

async function showFix() {
  var fix = S.data.fixes.find((f) => f.id === $("fix").value);
  var body = $("fix-body");
  show(body, el("p", { class: "notes" }, "Loading …"));
  var p = await prepared(fix);
  p.blockers = await blockersNow(p);
  var { open, done } = outstanding(p);
  var canSend = S.group.in_zotero && S.group.editable && !p.blockers.length;
  var parts = [];
  if (S.result) parts.push(el("p", { id: "result" }, el("strong", {}, S.result)));
  S.result = null;
  if (!S.group.in_zotero) parts.push(warn("This group is not in this Zotero: the changes can be looked at, but not sent."));
  if (p.blockers.length) {
    parts.push(el("div", { class: "warn" }, "Zotero Safe Edit will refuse these changes:", el("ul", {}, p.blockers.map((b) => el("li", {}, b)))));
  }
  if (fix.bulk) {
    var all = el("button", { class: "primary", id: "send-all", disabled: !open.length || !canSend }, "Send all to Zotero for approval");
    all.addEventListener("click", guarded(() => send(open.map((i) => p.changes[i]), "edit")));
    parts.push(
      el("p", { class: "notes" },
        "Nothing to check here: the changes are sent to Zotero without a table, where you approve them. Each change " +
        "only adds a line, so all can be approved at once if \"Allow large batches which only add a line\" is " +
        `ticked in Zotero (Settings → Safe Edit); otherwise at most ${S.status.max_batch_size} per approval. ` +
        "Changes made already are left out."),
      pill(plural(open.length, "item"), all)
    );
  } else if (!open.length) {
    parts.push(el("p", {}, done.length ? `Nothing outstanding — all ${plural(done.length, "change")} are made already.` : "Nothing to change."));
  } else {
    parts.push(changesTable(p, open, "edit", canSend));
  }
  if (done.length) {
    var box = el("input", { type: "checkbox", id: "show-done" });
    var doneDiv = el("div", {});
    box.addEventListener("change", () => show(doneDiv, box.checked ? madeTable(p, done) : null));
    parts.push(el("p", {}, el("label", {}, box, ` Show the ${plural(done.length, "change")} made already`)), doneDiv);
  }
  if (p.notProposed.length) parts.push(notProposedTable(p));
  show(body, parts);
}

function diffNode(diff) {
  if (!diff) return null;
  var line = (side) => {
    var div = el("div", { class: "value " + side });
    var showType = side === "before" ? "removed" : "added";
    var any = false;
    for (let s of diff.segments) {
      if (s.type === "same") {
        div.append(el("span", {}, s.display));
        any = true;
      } else if (s.type === showType) {
        div.append(el("span", { class: s.type }, s.display));
        any = true;
      }
    }
    if (!any) div.append(el("span", { class: "empty" }, "(empty)"));
    return div;
  };
  return el("div", {}, line("before"), line("after"),
    diff.notes && diff.notes.length ? el("div", { class: "notes" }, "Note: " + diff.notes.join("; ")) : null);
}

function links(c) {
  var gid = S.data.group_id;
  var out = el("div", { class: "links" });
  if (S.group.in_zotero) {
    out.append(el("a", { onclick: guarded(() => selectInZotero(c.item_key)) }, "Show in Zotero"));
  } else {
    out.append(el("a", { onclick: () => Zotero.launchURL(`https://www.zotero.org/groups/${gid}/items/${c.item_key}`) }, "Zotero (web)"));
  }
  if (c.doi) out.append(el("a", { onclick: () => Zotero.launchURL("https://doi.org/" + encodeURI(c.doi)) }, "DOI"));
  if (c.openalex) out.append(el("a", { onclick: () => Zotero.launchURL(c.openalex) }, "OpenAlex"));
  return out;
}

async function selectInZotero(key) {
  var libraryID = Zotero.Groups.getLibraryIDFromGroupID(S.data.group_id);
  var item = await Zotero.Items.getByLibraryAndKeyAsync(libraryID, key);
  if (!item) throw new Error("Item " + key + " not found in this Zotero");
  var win = Zotero.getMainWindow();
  await win.ZoteroPane.selectItem(item.id);
  win.focus();
}

// table of the outstanding changes: one option per item, pages, sending
function changesTable(p, open, action, canSend) {
  var list = open.map((i) => p.changes[i]);
  var rows = open.map((i) => p.rows[i] || {});
  var ok = rows.map((r) => !!r.ok);
  var selected = L.initialSelection(list, ok);
  var page = 0;
  var pages = Math.max(1, Math.ceil(list.length / PAGE));
  var table = el("table", { id: "changes", class: "changes" });
  var pager = el("div", { class: "pager" });

  function render() {
    var from = page * PAGE;
    var to = Math.min(list.length, from + PAGE);
    var trs = [el("tr", {}, el("th", {}, ""), el("th", {}, "Title"), el("th", {}, "Field"), el("th", {}, "Change"),
      el("th", {}, "Why"), el("th", {}, "Check"), el("th", {}, "Open"))];
    var lastChoice = null;
    for (let k = from; k < to; k++) {
      var c = list[k];
      var title = c.title || rows[k].title || c.item_key;
      var isOption = c.choice !== null && c.choice !== undefined;
      if (isOption && c.choice !== lastChoice) {
        trs.push(el("tr", { class: "group-head" }, el("td", {}, ""), el("td", { colspan: 6 }, title)));
      }
      lastChoice = isOption ? c.choice : null;
      var box = el("input", { type: "checkbox", class: isOption ? "option" : null, "data-k": k, disabled: !ok[k] });
      box.checked = selected.has(k);
      box.addEventListener("change", (ev) => {
        selected = L.select(selected, list, Number(ev.target.dataset.k), ev.target.checked);
        for (let b of table.querySelectorAll("input[data-k]")) b.checked = selected.has(Number(b.dataset.k));
      });
      trs.push(el("tr", { class: isOption ? "option" : null },
        // options: the description of the option (e.g. the work found) under
        // the item's title, where there is room for it
        el("td", {}, box), el("td", {}, isOption ? c.reason || "" : title), el("td", {}, L.fieldLabel(c.field)),
        el("td", {}, diffNode(rows[k].diff)), el("td", {}, isOption ? "" : c.reason || ""),
        el("td", {}, ok[k] ? "OK" : rows[k].problem || ""), el("td", {}, links(c))));
    }
    show(table, trs);
    var prev = el("button", { disabled: page === 0 }, "Previous");
    var next = el("button", { disabled: page >= pages - 1 }, "Next");
    prev.addEventListener("click", () => { page--; render(); });
    next.addEventListener("click", () => { page++; render(); });
    show(pager, pages > 1 ? [prev, el("span", {}, `Page ${page + 1} of ${pages} · ${plural(list.length, "change")}`), next] : el("span", { class: "notes" }, plural(list.length, "change")));
  }
  render();

  var sendSel = (onPage) =>
    guarded(async () => {
      var ks = [...selected].sort((a, b) => a - b);
      if (onPage) ks = ks.filter((k) => k >= page * PAGE && k < (page + 1) * PAGE);
      if (!ks.length) {
        busy("No changes selected.", true);
        return;
      }
      await send(ks.map((k) => list[k]), action);
    });
  var current = el("button", { class: "primary", id: "send-page", disabled: !canSend }, "Current Page");
  var all = el("button", { id: "send-all", disabled: !canSend }, "All Pages");
  current.addEventListener("click", sendSel(true));
  all.addEventListener("click", sendSel(false));
  return el("div", {}, el("h3", {}, "Proposed changes"), pager, table, pill("Submit Selected to Zotero for approval", current, all));
}

function madeTable(p, done) {
  return el("table", { id: "made" },
    el("tr", {}, el("th", {}, "Title"), el("th", {}, "Field"), el("th", {}, "Change"), el("th", {}, "Open")),
    done.map((i) => el("tr", { class: "made" },
      el("td", {}, p.changes[i].title || ""), el("td", {}, L.fieldLabel(p.changes[i].field)),
      el("td", {}, diffNode((p.rows[i] || {}).diff)), el("td", {}, links(p.changes[i])))));
}

function notProposedTable(p) {
  return el("div", {},
    el("h3", {}, "Not proposed"),
    el("p", { class: "notes" }, "Fix these by hand in Zotero."),
    el("table", { id: "not-proposed" },
      el("tr", {}, el("th", {}, "Title"), el("th", {}, "Field"), el("th", {}, "Value"), el("th", {}, "Note"), el("th", {}, "Open")),
      p.notProposed.map((c, i) => {
        var now = p.notCurrent[i];
        var fixed = now !== null && now !== undefined && now !== c.old;
        return el("tr", {},
          el("td", {}, c.title || ""), el("td", {}, L.fieldLabel(c.field)), el("td", {}, c.old),
          el("td", {}, fixed ? `Fixed locally (now: ${now === "" ? "empty" : now})` : c.note || ""), el("td", {}, links(c)));
      })));
}

// sends changes in batches as large as Safe Edit accepts; stops at the first
// batch which is cancelled or refused
async function send(list, action) {
  var batches = L.batches(list, L.maxBatch(S.status, list));
  var results = [];
  var stopped = null;
  for (let [i, b] of batches.entries()) {
    busy(`Batch ${i + 1} of ${batches.length}: approve the changes in Zotero …`);
    var r = await api.apply(b.map(toChange), action);
    if (r.status !== "done") {
      stopped = `batch ${i + 1}: ${r.status}${r.reasons ? " — " + r.reasons.join("; ") : ""}`;
      break;
    }
    results.push(...r.results);
  }
  var n = (st) => results.filter((x) => x.status === st).length;
  S.result =
    `${n("applied")} of ${plural(list.length, "change")} applied` +
    (n("skipped") ? `, ${n("skipped")} skipped (changed since)` : "") +
    (n("deselected") ? `, ${n("deselected")} deselected` : "") +
    (n("failed") ? `, ${n("failed")} failed` : "") +
    (stopped ? ` — stopped at ${stopped}` : "") + ".";
  busy(null);
  S.previews = new Map();
  await refreshStatus();
  var active = document.querySelector("#tabs button.active").dataset.tab;
  if (active === "restore") {
    show($("restore-body"), el("p", {}, el("strong", { id: "result" }, S.result)));
    S.result = null;
    renderRestore(true);
  } else {
    await showFix();
  }
  renderStatus();
}

// ---- Undo --------------------------------------------------------------------

async function renderUndo() {
  var body = $("undo-body");
  if (!S.group.in_zotero) {
    show(body, warn("This group is not in this Zotero."));
    return;
  }
  var entries = await api.log(S.data.group_id);
  if (!entries.length) {
    show(body, el("p", {}, "No changes have been made through Safe Edit in this group."));
    return;
  }
  var batches = new Map();
  for (let e of entries) {
    if (!batches.has(e.batch_id)) batches.set(e.batch_id, []);
    batches.get(e.batch_id).push(e);
  }
  var undoable = (e) => e.status === "applied" && !e.undone && e.state === "unchanged since";
  var selected = new Set();
  var list = [...batches.values()].reverse().map((es) => {
    var boxes = [];
    var batchBox = el("input", { type: "checkbox", disabled: !es.some(undoable) });
    var trs = es.map((e) => {
      var b = el("input", { type: "checkbox", "data-id": e.id, disabled: !undoable(e) });
      b.addEventListener("change", () => {
        if (b.checked) selected.add(e.id);
        else selected.delete(e.id);
      });
      boxes.push(b);
      return el("tr", {}, el("td", {}, b), el("td", {}, e.title || e.item_key), el("td", {}, L.fieldLabel(e.field)),
        el("td", {}, e.old || "(empty)"), el("td", {}, e.new || "(empty)"), el("td", {}, e.status),
        el("td", {}, e.undone ? "undone" : e.state || ""));
    });
    batchBox.addEventListener("change", () => {
      for (let b of boxes) {
        if (b.disabled) continue;
        b.checked = batchBox.checked;
        if (b.checked) selected.add(b.dataset.id);
        else selected.delete(b.dataset.id);
      }
    });
    var counts = {};
    for (let e of es) counts[e.status] = (counts[e.status] || 0) + 1;
    return el("details", { class: "batch" },
      el("summary", {}, batchBox, " ", L.batchLabel(es), el("span", { class: "notes" }, " · " +
        Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(", "))),
      el("table", {}, el("tr", {}, el("th", {}, ""), el("th", {}, "Title"), el("th", {}, "Field"), el("th", {}, "Old"),
        el("th", {}, "New"), el("th", {}, "Status"), el("th", {}, "Since then")), trs));
  });
  var undo = el("button", { class: "primary", id: "undo" }, "Undo selected changes");
  undo.addEventListener("click", guarded(async () => {
    var ids = [...selected];
    if (!ids.length) {
      busy("No changes selected.", true);
      return;
    }
    var chosen = entries.filter((e) => selected.has(e.id)).map((e) => ({ field: e.field, old: e.new, new: e.old }));
    var size = L.maxBatch(S.status, chosen);
    var done = 0;
    for (let b of L.batches(ids, size)) {
      busy("Approve the undo in Zotero …");
      var r = await api.undo(S.data.group_id, b);
      if (r.status !== "done") {
        busy(`Undo: ${r.status}${r.refused && r.refused.length ? " — " + r.refused.map((x) => x.reason).join("; ") : ""}`, true);
        break;
      }
      done += r.results.filter((x) => x.status === "applied").length;
    }
    S.previews = new Map();
    await refreshStatus();
    await renderUndo();
    busy(`${plural(done, "change")} undone.`);
  }));
  show(body, list, undo);
}

// ---- Restore -----------------------------------------------------------------

function renderRestore(keep = false) {
  var body = $("restore-body");
  if (!S.group.in_zotero) {
    show(body, warn("This group is not in this Zotero."));
    return;
  }
  var backups = S.group.backups || [];
  if (!backups.length) {
    show(body, el("p", { class: "warn" }, "No backups of this group — make one on the Status tab."));
    return;
  }
  var select = menulist("snapshot", backups.map((b) => ({ value: b.name, label: localTime(b.created) })));
  var out = el("div", {});
  var load = el("button", {}, "Show proposed changes");
  load.addEventListener("click", guarded(async () => {
    busy("Comparing with the backup …");
    var r = await api.restore(S.data.group_id, select.value);
    var changes = r.changes.map((c) => ({ ...c, title: null, proposed: true }));
    if (!changes.length) {
      busy(null);
      show(out, el("p", {}, "Nothing to restore: the fields are as in the backup."));
      return;
    }
    var pv = await api.preview(changes);
    busy(null);
    var p = { changes, rows: pv.rows };
    show(out,
      pv.blockers.filter((b) => !/^Too many changes/.test(b)).map((b) => warn(b)),
      changesTable(p, changes.map((c, i) => i), "restore", S.group.editable && !pv.blockers.some((b) => !/^Too many changes/.test(b))),
      r.not_restored.length
        ? el("p", { class: "notes" }, `${plural(r.not_restored.length, "difference")} in fields which may not be edited are not restored.`)
        : null);
  }));
  var keepNodes = keep ? [...body.childNodes] : [];
  show(body, keepNodes, el("label", {}, "Backup to restore from "), select, " ", load, out);
}
