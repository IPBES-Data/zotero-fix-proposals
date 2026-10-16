# Zotero Fix Proposals

A Zotero 10 plugin which shows **fixes proposed for Zotero groups** and applies
the ones you choose. The proposals come from a published feed, e.g. the
[IPBES Literature Report](https://ipbes-data.github.io/IPBES.LiteratureReport/),
which checks the IPBES Zotero groups and proposes fixes (DOIs in the wrong
field or form, dates and journal details from OpenAlex, DOIs found in
OpenAlex, ISO language codes, …).

This plugin **never writes to your items itself**: every change goes through
[Zotero Safe Edit](https://github.com/IPBES-Data/zotero-safe-edit) (0.2.0 or
newer), which checks it (automatic sync off, fresh backup, allowed fields,
unchanged old value), shows it for your approval, writes it, logs it and lets
you undo it.

## Install

1. Download Zotero Safe Edit and this plugin from the [report website](https://ipbes-data.github.io/IPBES.LiteratureReport/)
   (section *Zotero plugins*) and install both (Tools → Plugins → gear icon →
   *Install Plugin From File…*). They update themselves afterwards.
2. In Settings → Safe Edit, allow the fields to be fixed (e.g. `DOI, language,
   date, publicationTitle, volume, issue, pages, extra, ISSN`).
3. Switch off automatic sync (Settings → Sync).
4. Tools → **Fix Proposals…** — the first time, confirm that the plugin may
   propose edits through Safe Edit.

## Where the proposals come from

Settings → Fix Proposals: a web address, e.g. the GitHub Pages of the report
(`https://ipbes-data.github.io/IPBES.LiteratureReport/fixes/`, the default) or
a raw GitHub address, or a **local folder**. The address is a folder with
`index.json` (the groups) and one file per group; the format is described by
`schema.json` in the same folder.

## The window

- **Status**: Safe Edit's checks for the group (sync, backup, …), *Make a
  backup*, and per fix the problem, the value written, the field, the items,
  how many are fixed already and the status as in the report.
- **Fixes**: the outstanding changes of a fix with the differences
  highlighted, links to the item in Zotero, the DOI and OpenAlex. Options for
  the same item can be ticked one at a time. Fixes with nothing to check (e.g.
  adding the OpenAlex ID to Extra) are sent with one button.
- **Undo**: the log of the group by batch; undo single changes or batches.
- **Restore**: compare with a backup and restore the fields.

Fixes build on each other: once an item has a DOI, the fixes with values from
OpenAlex find it after the next sync and report run.

## Development

```sh
node --test tests/logic.test.js   # logic without Zotero, incl. a sample feed file
tests/zotero/run.sh               # tests inside a separate Zotero (test profile)
./build.sh                        # builds build/zotero-fix-proposals-<version>.xpi (for testing)
```

`tests/zotero/run.sh` starts a second Zotero with its own temporary profile,
data directory and port, loads this plugin from `addon/` and Zotero Safe Edit
from `../zotero-safe-edit/addon` (or `SAFE_EDIT`), creates a test group and a
feed in a local folder, and drives the window. A running Zotero is not
touched. `tests/fixtures/sample.json` is a shortened file from the report
pipeline: if the format changes there, the tests fail here.

## Release

Development happens on `dev`; `main` holds released versions. The plugin is
published on the website of the [IPBES Literature Report](https://ipbes-data.github.io/IPBES.LiteratureReport/), which
has it as a submodule (`plugins/zotero-fix-proposals`):

1. On `dev`: set the version in `addon/manifest.json`, add it to `CHANGELOG.md`.
2. Run the tests (see Development).
3. Merge `dev` into `main`, tag `v<version>`, push `main`, `dev` and the tag.
4. In IPBES.LiteratureReport: update the submodule to the tag
   (`git -C plugins/zotero-fix-proposals fetch --tags && git -C plugins/zotero-fix-proposals checkout v<version>`),
   run the pipeline (`targets::tar_make()`), which builds the `.xpi` and
   `updates.json` into `output/report/plugins/zotero-fix-proposals/`, commit and push.

Installed copies find the new version through `updates.json` on the website
(the `update_url` in `addon/manifest.json`) and update themselves.

## Licence

MIT, see [LICENSE](LICENSE).
