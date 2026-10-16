#!/bin/sh
# Builds build/zotero-fix-proposals-<version>.xpi from addon/ (for testing; the released
# files and updates.json are built by the IPBES Literature Report pipeline and
# published on its website, see README).
set -e
cd "$(dirname "$0")"
version=$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' addon/manifest.json | head -1)
mkdir -p build
xpi="build/zotero-fix-proposals-$version.xpi"
rm -f "$xpi"
(cd addon && zip -qr "../$xpi" . -x '.*')
echo "$xpi"
