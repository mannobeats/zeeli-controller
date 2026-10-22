#!/bin/sh
# Install the console on a router next to its stock panel: https://<router>/zeeli/
# Usage: pnpm deploy:router [root@192.168.8.1]
# Needs SSH key access to the router. The stock panel, LuCI and SSH are left untouched;
# remove the console with:
#   ssh <router> 'rm -rf /www/zeeli /usr/share/rpcd/acl.d/zeeli-controller.json && /etc/init.d/rpcd reload'
set -eu

TARGET="${1:-${ROUTER_SSH:-root@192.168.8.1}}"
DEST=/www/zeeli
DIST="$(dirname "$0")/../apps/console/dist"
ACL="$(dirname "$0")/router/zeeli-controller.acl.json"

pnpm --filter @zeeli/console build >/dev/null
# ship everything but source maps; swap the folder in one move so a half-copied
# console is never served
tar -C "$DIST" --exclude='*.map' -cf - . | ssh "$TARGET" "
  set -e
  rm -rf $DEST.new && mkdir -p $DEST.new && tar -C $DEST.new -xf -
  # the router's web server serves gl_home.html as a folder's index
  ln -s index.html $DEST.new/gl_home.html
  rm -rf $DEST.old && { [ ! -d $DEST ] || mv $DEST $DEST.old; } && mv $DEST.new $DEST && rm -rf $DEST.old
"
# the console's own permissions: service state, and starting the speed test server or a
# Wake on LAN packet from its pages (see the file for the exact commands)
ssh "$TARGET" "cat > /usr/share/rpcd/acl.d/zeeli-controller.json && /etc/init.d/rpcd reload" < "$ACL"
echo "Installed. Open https://${TARGET#*@}/zeeli/"
