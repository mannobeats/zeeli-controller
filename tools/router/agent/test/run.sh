#!/bin/sh
# Run the agent's tests on OpenWrt. Each test file gets a fresh sandbox holding the
# GL-BE9300 settings in test/fixtures/be9300 (secrets scrubbed), so results don't depend on
# the router. Nothing on the router changes: everything happens in a temporary folder.
#   ZEELI_TEST_ROUTER=root@192.168.8.1 sh tools/router/agent/test/run.sh   on a router, over SSH
#   sh tools/router/agent/test/run.sh                                      in an OpenWrt container (CI)
set -eu
AGENT="$(cd "$(dirname "$0")/.." && pwd)"
export COPYFILE_DISABLE=1

# one test run: unpack the agent, then run every *.test.uc on a fresh copy of the fixtures
remote='
set -e
T=$(mktemp -d /tmp/zeeli-test.XXXXXX)
trap "rm -rf $T" EXIT
tar -C "$T" -xf -
export ZEELI_AGENT="$T" ZEELI_CONFDIR="$T/config" ZEELI_SAVEDIR="$T/save" ZEELI_SHARE="$T/share" ZEELI_STATE="$T/state"
status=0
for t in "$T"/test/*.test.uc; do
  rm -rf "$T/config" "$T/save" "$T/share" "$T/state"
  mkdir -p "$T/save" "$T/share" "$T/state" && cp -a "$T/test/fixtures/be9300" "$T/config"
  echo test > "$T/share/VERSION"
  echo "# ${t##*/}"
  ucode -L "$T/lib/*.uc" -L "$T/test/*.uc" "$t" || status=1
done
exit $status
'

if [ -n "${ZEELI_TEST_ROUTER:-}" ]; then
  tar -C "$AGENT" -cf - lib rpcd test | ssh "$ZEELI_TEST_ROUTER" "$remote"
else
  tar -C "$AGENT" -cf - lib rpcd test | docker run --rm -i "${ZEELI_TEST_IMAGE:-openwrt/rootfs:x86-64-23.05.6}" /bin/sh -c "mkdir -p /var/lock /tmp; $remote"
fi
