/* global FixProposals */

// Logic of the fix window which does not need Zotero (tested in Node:
// tests/logic.test.js). Changes are those of the proposals file:
// {item_key, title, field, old, new, reason, proposed, note, doi, openalex,
//  choice, preselect, append}.
FixProposals.logic = {
  FIELD_LABELS: {
    DOI: "DOI",
    publicationTitle: "Journal",
    volume: "Volume",
    issue: "Issue",
    pages: "Pages",
    date: "Date",
    language: "Language",
    extra: "Extra",
    url: "URL",
    ISBN: "ISBN",
    ISSN: "ISSN",
    title: "Title",
  },

  fieldLabel(field) {
    return this.FIELD_LABELS[field] || field;
  },

  // changes which add a line (append) are based on the current value in
  // Zotero, so that other changes of the field do not get in the way; a line
  // which is there already counts as made (new = current)
  rebase(change, current) {
    if (!change.append || current === null || current === undefined) {
      return change;
    }
    if (current.split("\n").includes(change.append)) {
      return { ...change, old: current, new: current };
    }
    return { ...change, old: current, new: current === "" ? change.append : current + "\n" + change.append };
  },

  // whether Zotero has the new value already; DOIs are not case sensitive
  isMade(change, current) {
    if (current === null || current === undefined) {
      return false;
    }
    return change.field === "DOI"
      ? current.toLowerCase() === change.new.toLowerCase()
      : current === change.new;
  },

  // as Safe Edit checks for its line batches: only one line added at the end
  // of Extra, or removed again
  isLineChange(c) {
    var added = (before, after) => {
      var start = before === "" ? "" : before + "\n";
      if (!after.startsWith(start)) return false;
      var line = after.slice(start.length);
      return line.trim() !== "" && !line.includes("\n");
    };
    return c.field === "extra" && (added(c.old, c.new) || added(c.new, c.old));
  },

  // largest batch Safe Edit accepts for these changes
  maxBatch(status, changes) {
    var n = status.max_batch_size || 25;
    if (status.line_batches && changes.length > n && changes.every((c) => this.isLineChange(c))) {
      return status.max_line_batch_size;
    }
    return n;
  },

  batches(list, size) {
    var out = [];
    for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
    return out;
  },

  // changes selected at the start: those Safe Edit accepts, except
  // alternatives not preselected
  initialSelection(changes, ok) {
    var s = new Set();
    changes.forEach((c, i) => {
      if (ok[i] && c.preselect !== false) s.add(i);
    });
    // at most one per choice
    var seen = new Set();
    for (let i of [...s]) {
      var ch = changes[i].choice;
      if (ch === null || ch === undefined) continue;
      if (seen.has(ch)) s.delete(i);
      else seen.add(ch);
    }
    return s;
  },

  // ticks or unticks change i; ticking an alternative unticks the others of
  // the same choice (like radio buttons)
  select(selected, changes, i, on) {
    var s = new Set(selected);
    if (!on) {
      s.delete(i);
      return s;
    }
    var ch = changes[i].choice;
    if (ch !== null && ch !== undefined) {
      for (let j of [...s]) {
        if (changes[j].choice === ch) s.delete(j);
      }
    }
    s.add(i);
    return s;
  },

  // items of a fix (alternatives count once) and how many are made already
  counts(changes, made) {
    var key = (c) => (c.choice === null || c.choice === undefined ? c.item_key + "|" + c.field : "choice|" + c.choice);
    var items = new Set();
    var fixed = new Set();
    changes.forEach((c, i) => {
      if (!c.proposed) return;
      items.add(key(c));
      if (made && made[i]) fixed.add(key(c));
    });
    return { items: items.size, fixed: made ? fixed.size : null };
  },

  // status as in the report
  status(open, severity) {
    if (open === 0) return "OK";
    if (severity === "fix") return "Please fix";
    if (severity === "check") return "Please check";
    return "For information";
  },

  // what a batch of the log did: time, the most frequent reason, the fields
  batchLabel(entries) {
    var why = (e) =>
      e.action === "undo"
        ? "Undo of an earlier change"
        : e.action === "restore"
          ? "Restore from backup"
          : e.reason_for_change || "";
    var count = new Map();
    for (let e of entries) count.set(why(e), (count.get(why(e)) || 0) + 1);
    var reason = [...count].sort((a, b) => b[1] - a[1])[0][0];
    var fields = [...new Set(entries.map((e) => this.fieldLabel(e.field)))].sort().join(", ");
    var time = new Date(entries[0].time);
    var pad = (n) => String(n).padStart(2, "0");
    var local =
      `${time.getFullYear()}-${pad(time.getMonth() + 1)}-${pad(time.getDate())} ` +
      `${pad(time.getHours())}:${pad(time.getMinutes())}`;
    return `${local} · ${reason} · ${fields} (${entries.length})`;
  },

  // checks a proposals file; returns a list of problems (empty if fine)
  checkFile(data) {
    var problems = [];
    if (!data || data.format !== "zotero-fix-proposals") problems.push("not a proposals file");
    else if (data.version !== 1) problems.push(`version ${data.version} is not supported`);
    else {
      for (let f of data.fixes || []) {
        for (let c of f.changes || []) {
          if (!/^[A-Z0-9]{8}$/.test(c.item_key) || typeof c.old != "string" || typeof c.new != "string" || !c.field) {
            problems.push(`fix ${f.id}: change of item ${c.item_key} is incomplete`);
            break;
          }
        }
      }
    }
    return problems;
  },
};
