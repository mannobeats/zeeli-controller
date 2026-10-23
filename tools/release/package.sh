#!/bin/sh
# Package a built console for a router: release/zeeli-controller.tar.gz holds the console
# (without source maps), its permission file, the updater, the version, and the agent laid
# out the way it sits on the router's filesystem (root/).
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

AGENT="$ROOT/tools/router/agent"
R="$PKG/root"
mkdir -p "$R/usr/share/rpcd/ucode" "$R/usr/share/ucode/zeeli" "$R/usr/lib/oui-httpd/rpc" "$R/usr/share/zeeli"
cp "$AGENT"/rpcd/*.uc "$R/usr/share/rpcd/ucode/"
cp "$AGENT"/lib/zeeli/*.uc "$R/usr/share/ucode/zeeli/"
cp "$AGENT/oui/zeeli" "$R/usr/lib/oui-httpd/rpc/zeeli"
if [ -d "$AGENT/init.d" ]; then
  mkdir -p "$R/etc/init.d" && cp "$AGENT"/init.d/* "$R/etc/init.d/" && chmod 755 "$R"/etc/init.d/*
fi
if [ -d "$AGENT/bin" ]; then
  mkdir -p "$R/usr/libexec/zeeli" && cp "$AGENT"/bin/* "$R/usr/libexec/zeeli/" && chmod 755 "$R"/usr/libexec/zeeli/*
fi
echo "$VERSION" >"$R/usr/share/zeeli/VERSION"
tar -C "$PKG" -czf "$OUT/zeeli-controller.tar.gz" .
rm -rf "$PKG"
