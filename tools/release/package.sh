#!/bin/sh
# Package a built console for a router: release/zeeli-controller.tar.gz holds the console
# (without source maps), its permission file, the updater and the version.
# Usage: sh tools/release/package.sh <version>
set -eu
# no macOS resource-fork files in the archive
export COPYFILE_DISABLE=1

VERSION="$1"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$ROOT/release"
PKG="$OUT/pkg"

rm -rf "$OUT" && mkdir -p "$PKG/www"
cp -R "$ROOT/apps/console/dist/." "$PKG/www/"
find "$PKG/www" -name '*.map' -delete
# the router's web server serves gl_home.html as a folder's index
ln -s index.html "$PKG/www/gl_home.html"
cp "$ROOT/tools/router/zeeli-controller.acl.json" "$ROOT/tools/router/zeeli-update" "$PKG/"
echo "$VERSION" >"$PKG/VERSION"
tar -C "$PKG" -czf "$OUT/zeeli-controller.tar.gz" .
rm -rf "$PKG"
