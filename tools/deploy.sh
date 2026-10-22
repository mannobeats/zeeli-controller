#!/bin/sh
# Install the console on a router next to its stock panel: https://<router>/zeeli/
# Usage: pnpm deploy:router [root@192.168.8.1]
# Needs SSH key access to the router. The stock panel, LuCI and SSH are left untouched;
# remove the console with:
#   ssh <router> 'rm -rf /www/zeeli /usr/libexec/zeeli-update /usr/share/rpcd/acl.d/zeeli-controller.json && /etc/init.d/rpcd reload'
set -eu

TARGET="${1:-${ROUTER_SSH:-root@192.168.8.1}}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# a build from a working copy says which commit it came from, and never counts as a release
VERSION="$(git -C "$ROOT" describe --tags --always --dirty)-dev"

ZEELI_VERSION="$VERSION" pnpm --filter @zeeli/console build >/dev/null
sh "$ROOT/tools/release/package.sh" "$VERSION"
# the same steps a release update takes, minus the signature check: the console folder,
# the updater and the permission file (see tools/router/zeeli-controller.acl.json)
ssh "$TARGET" "cat > /tmp/zeeli-controller.tar.gz" <"$ROOT/release/zeeli-controller.tar.gz"
ssh "$TARGET" "sh -s apply /tmp/zeeli-controller.tar.gz; rm -f /tmp/zeeli-controller.tar.gz" <"$ROOT/tools/router/zeeli-update"
rm -rf "$ROOT/release"
echo "Open https://${TARGET#*@}/zeeli/"
