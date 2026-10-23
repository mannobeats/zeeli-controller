# The Zeeli agent

The router-side half of Zeeli Controller. It gives the console its own API where the stock firmware's API is too limited (see [docs/PLAN.md](../../../docs/PLAN.md)), and later runs unchanged on Zeeli's own firmware.

## How a call travels

```
console  api.<area>.x()  →  transport.zeeli('wifi', 'list', args)
GL /rpc  call [sid, 'zeeli', 'call', { area, method, args }]   (GL checks the admin session)
oui/zeeli (Lua bridge)   →  ubus call zeeli.wifi list args
rpcd/zeeli-wifi.uc       →  lib/zeeli/wifi.uc  →  UCI, services, files
```

- The bridge accepts only area and method names matching `^[a-z][a-z0-9_]*$`.
- A method that returns `{ error: 'message' }` reaches the console as a `RouterError('failed', message)`. Write that message for the person reading it.
- The console needs no Advanced unlock and no ACL file for agent calls.

## Layout

| In the repo            | On the router                  | What                                                                                                |
| ---------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------- |
| `rpcd/zeeli-<area>.uc` | `/usr/share/rpcd/ucode/`       | One ubus object per file, `zeeli.<area>`. Keep these thin: argument checks, then a call into `lib/` |
| `lib/zeeli/<area>.uc`  | `/usr/share/ucode/zeeli/`      | The logic, imported as `zeeli.<area>`                                                               |
| `lib/zeeli/common.uc`  | same                           | Shared helpers: `cursor()`, `fail()`, `run()`, `services.reload()`, `valid`, `paths`                |
| `oui/zeeli`            | `/usr/lib/oui-httpd/rpc/zeeli` | The bridge from GL's `/rpc`                                                                         |
| `init.d/<name>`        | `/etc/init.d/`                 | Services, such as the collector; enabled and restarted on install                                   |
| `bin/<name>`           | `/usr/libexec/zeeli/`          | Scripts that services run                                                                           |
| `test/*.test.uc`       | —                              | Tests (see below)                                                                                   |

`tools/release/package.sh` lays these out under `root/`. `zeeli-update` copies what changed, removes files a release dropped (using `/usr/share/zeeli/manifest`), then restarts rpcd and reloads nginx.

## Rules

- **ucode 2023-11 on the router.** Mark nothing `export` inline: `export function f() {}` followed by more code doesn't compile. List exports at the end instead: `export { a, b };`.
- **Define a function above the code that calls it.** ucode compiles top to bottom and doesn't hoist: a call to a function further down is a compile error. Regex literals have no `\x00` escapes (use `[[:cntrl:]]` or `[^ -~]`), `int("0x1f")` is 0 (use `hex()`), and a JSON `null` doesn't survive the bus, so take `0` for "unset" in arguments.
- **Declare every argument.** rpcd checks argument types against `args`, e.g. `args: { name: 'name', bands: [], options: {} }`. Read only declared ones from `request.args`.
- **Every method returns an object.** Return `{ … }` on success and `fail('…')` on failure, never `null`.
- **Validate everything from the console.** Check types, ranges and name patterns before touching UCI.
  - Never build a shell string from input. Use `run([argv…])`, which quotes each word.
  - Never pass a path from input to `fs` functions.
- **Settings go through `cursor()`.** Then call `services.reload(name)`. In tests, both point at a sandbox and nothing reloads.
- **Agent-owned UCI sections are named `zeeli_<something>`.** They also carry `option zeeli '1'`, so they never collide with the firmware's own sections and are easy to find.
  - Don't modify sections the firmware created unless the plan for that area says so and a test covers it.
  - Zeeli's own state lives in `/etc/config/zeeli`.
- **Runtime data goes under `paths.state`** (`/var/lib/zeeli`, in RAM). Copy it to flash at most every 15 minutes.

## Snapshots and confirm-or-roll-back

Two helpers any area can use before a write that could cut the console off or that a person may want to undo.
- `zeeli.snapshots` copies `/etc/config` (or just the files named) to `/overlay/zeeli/snapshots` and can list, diff and restore them. `create(reason, only?, kind?)` is the call to make before a risky write; use `'auto'` for the router's own snapshots. Manual and automatic snapshots each keep the newest 10, so ten firewall edits can't push out a person's, and a snapshot a waiting change needs is never pruned or deleted. The folder is on flash, so snapshots survive a reboot, but outside `/etc`, so they appear in neither a snapshot nor a `sysupgrade -b` backup.
- `zeeli.rollback` wraps a write in a countdown. Call `begin(area, ['firewall'], 'changing a firewall rule')` after checking the request and before writing, write, reload through `reloader.run(name)` from `zeeli.snapshots` (it returns the exit code; on a failure call `abandon(arm, why)`), call `admin.flush()`, then return `{ ...result, token, seconds, settle }`. Give your rpcd object a `confirm` method that calls `rollback.confirm(token)`; the console's `confirmChange(transport, area, armed)` calls it within the window. Only one change waits at a time.
  - If no confirm arrives, `bin/zeeli-rollback-timer` (started by `begin`) restores the snapshot of those files and reloads their service.
  - The waiting record is on flash (`/overlay/zeeli/rollback`). `init.d/zeeli-rollback` runs at boot (START=18, before firewall 19, dropbear 19 and network 20) and puts back any change still waiting, writing the files only.
  - fw4 accepts established connections before it looks at zone rules, so a confirm over the connection that made the change proves nothing. `admin.flush()` starts `bin/zeeli-flush-admin`, which a second later ends the TCP connections to the router's own addresses on ports 80 and 443 (`conntrack -D`). The console waits `settle` seconds before its first confirm, so it has to pass the new rules on a new connection.
  - `restoreSnapshot(id)` is a restore that is a confirmable change when it touches network, wireless, firewall or dropbear.
- `zeeli.firewall` refuses writes that would lock out the admin network: the zone holding `lan` must keep input ACCEPT and keep the `lan` network, and no enabled rule may reject or drop that zone's traffic to the router on 22, 53, 67, 80, 443 or all ports.
- A restore reloads what can be reloaded (`network`, `dhcp`, `firewall`, `system`, `dropbear`; `wireless` through the network reload) and reports `rebootNeeded` for GL's own settings, which are only read at startup.
- A downloaded backup holds passwords and keys. The console calls `finish_download` as soon as it has the file, and `bin/zeeli-backup-expire` deletes it after five minutes regardless. `/tmp/zeeli` is created 0700 and refused if it is a link or not owned by root.

Sections the agent owns (`zeeli_*` names, or `option zeeli '1'`) are hidden from `zeeli.firewall`, so a policy engine can add its own rules and includes without the firewall page touching them.

## Tests

```sh
ZEELI_TEST_ROUTER=root@192.168.8.1 sh tools/router/agent/test/run.sh   # on a router over SSH, in /tmp only
sh tools/router/agent/test/run.sh                                      # in an OpenWrt 23.05 container (CI)
```

Each `test/*.test.uc` runs on a fresh copy of `test/fixtures/be9300`: the GL-BE9300's `wireless`, `network`, `firewall`, `dhcp` and `mlo` settings, with passwords, names and MAC addresses scrubbed. Use `plugin('<area>')` from `test/assert.uc` to call methods the way rpcd does, then read the sandbox with `cursor()` to check what was written.

## WiFi and the firmware

`zeeli.wifi` (`rpcd/zeeli-wifi.uc`, `lib/zeeli/wifi.uc`) lets people make their own WiFi networks on any radio and attach them to any LAN network. This section records what the firmware does to `/etc/config/wireless`, because the agent shares that file with GL's panel. It was worked out by reading the scripts on a GL-BE9300 (firmware 4.10.1) and running only read-only commands. Where a conclusion rests on reading code rather than seeing the router do it, it says so, and the question is listed under [Live checks](#live-checks).

### The API

| Method                            | Arguments                                                                                             | Result                                                                                            |
| --------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `list`                            | none                                                                                                  | `networks`, `radios`, `lanNetworks`, `mlo`, `internal`, `pending`. Never a key: `hasKey` instead. |
| `reveal`                          | `id`                                                                                                  | `{ password }` of one network the agent made                                                      |
| `create`                          | `ssid`, `password`, `bands`, `network`, `security`, `hidden`, `isolate`, `options`, `schedule`, `mlo` | `{ id, sections, pending }`                                                                       |
| `update`                          | `id` and any of the above except `schedule`                                                           | `{ id, pending }`. No password keeps the current one.                                             |
| `delete`                          | `id`                                                                                                  | `{ pending }`                                                                                     |
| `set_enabled`                     | `id`, `enabled`                                                                                       | `{ pending }`                                                                                     |
| `apply`                           | none                                                                                                  | `{ applied }`                                                                                     |
| `set_schedule` / `clear_schedule` | `id`, `enabled`, `days`, `off`, `on` / `id`                                                           | `{ schedule }` / `{ pending }`                                                                    |
| `tick`                            | none                                                                                                  | `{ changed }`. Enforces schedules; the service below calls it.                                    |
- A network the agent made has an `id` like `k3x9wq`; it owns one `wifi-iface` per band, named `zeeli_<id>_<band>`. The router's own slots are listed with their section name as `id` and `owner: 'firmware'`, plus a `role`: `main`, `guest`, `iot`, `mlo`, `mlo-guest` or `other`. Station and mesh-backhaul interfaces come back under `internal`, not in `networks`.
- Only `owner: 'zeeli'` networks can be changed, and only if the section has both the `zeeli_<id>_<band>` name and `option zeeli '1'`. Everything else is refused with a message.
- `network` is the name the networks page uses (`main`, `guest`, a custom name) or the UCI interface name. It has to be a `network` interface that is switched on and whose `device` is a bridge.
- `security` is `sae` (WPA3), `sae-mixed` (WPA2/WPA3) or `psk2` (WPA2). 6 GHz takes `sae` only.
- Limits: SSID 1 to 32 bytes; password 8 to 63 printable ASCII characters; no two networks with the same name on one radio; 17 slots per radio. The 17 comes from the driver (`iw phy phy1 info`: `#{ AP } <= 17, total <= 17`), and counts every AP section, switched on or not (the GL panel can switch its own slots on at any time), plus station interfaces that are on.
- `options` (anything else is refused): `fastRoaming`, `rrm`, `bssTransition`, `maxClients` (1 to 128), `multicastToUnicast`, `dtim` (1 to 10). `maxClients` and `dtim` take `0` for "the radio's default". Each maps to a key the qcawificfg80211 scripts read (`/lib/wifi/hostapd.sh`, `/lib/wifi/qcawificfg80211.sh`):

| Option               | UCI keys                                                                                                 | Read by                                                                                                                                                                                                             |
| -------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fastRoaming`        | `ieee80211r`, `mobility_domain`, `nasid`, `r1_key_holder`, `ft_psk_generate_local '1'`, `ft_over_ds '0'` | `hostapd_set_bss_options`. `ft_psk_generate_local` matters: the script defaults it to 0, and with no R0KH/R1KH list FT-PSK would fail. The domain comes from the network id, so every band of a network shares one. |
| `rrm`                | `ieee80211k`                                                                                             | `cfg80211tool <vap> rrm`                                                                                                                                                                                            |
| `bssTransition`      | `bss_transition`                                                                                         | hostapd `bss_transition`                                                                                                                                                                                            |
| `maxClients`         | `maxsta`                                                                                                 | `cfg80211tool <vap> maxsta`                                                                                                                                                                                         |
| `multicastToUnicast` | `mcastenhance '2'`, `multicast_to_unicast '1'`                                                           | `cfg80211tool <vap> mcastenhance`; hostapd                                                                                                                                                                          |
| `dtim`               | `dtim_period`                                                                                            | `cfg80211tool <vap> dtim_period`                                                                                                                                                                                    |

### The shape of a network's section

Copied from the router's own enabled main AP (`wifi5g`), minus what only the mesh, WPS, MLO and GL's first-run flow use. Each option, and why:

| Option                                            | Value                                                                                                           | Why                                                                                                                                                                                                  |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `device`, `network`, `mode 'ap'`, `ssid`, `key`   |                                                                                                                 | the AP                                                                                                                                                                                               |
| `encryption`, `sae`, `no_beacon_rsnxe`, `sae_pwe` | WPA3: `ccmp`, `1`, `0`, and `sae_pwe 1` on 6 GHz. WPA2/WPA3: `psk2+ccmp`, `1`, `0`. WPA2: `psk2+ccmp`, `0`, `1` | exactly what GL writes for those three choices (`wifi6g`, `wifi5g`, `wifi2g`), and what the live hostapd configs show (`wpa_key_mgmt=SAE`, `WPA-PSK SAE`, `WPA-PSK`)                                 |
| `hidden`, `isolate`                               | `0` or `1`                                                                                                      | hostapd `ignore_broadcast_ssid`, `ap_isolate`                                                                                                                                                        |
| `ifname`                                          | `wlan<radio digit><n>`, n from 30                                                                               | the driver scripts look a vap up by it. The firmware's slots use `wlan0`, `wlan01`…`wlan06`; ours start at 30 so the two never meet. Names already in `wireless` or in `/sys/class/net` are skipped. |
| `macaddr`                                         | random, locally administered                                                                                    | GL gives each AP its own BSSID. On 6 GHz the BSSIDs are a multiple-BSSID set, so GL counts up the last byte from the radio's first 6 GHz address (`03_gl_random-bssid`); the agent does the same.    |
| `wds '1'`                                         |                                                                                                                 | GL sets it on every AP, guest ones included; its repeaters and mesh nodes need it                                                                                                                    |
| `notify_mgmt_frames '1'`                          |                                                                                                                 | GL's clients daemon learns about joins and leaves from hostapd with it                                                                                                                               |
| `zeeli '1'`                                       |                                                                                                                 | ours                                                                                                                                                                                                 |
| `guest 'zeeli'`                                   |                                                                                                                 | see "GL's WiFi timer" below. Not `0` or `1` on purpose.                                                                                                                                              |
| `disabled`                                        | `0` or `1`                                                                                                      | the person's switch                                                                                                                                                                                  |
| `sched_off '1'`                                   | only while a schedule holds the network off                                                                     | see Schedules                                                                                                                                                                                        |

Left out on purpose: `multi_ap` and `wps_*` (mesh and WPS), `mld` (only multi-link networks carry it, see below), `init`, `factory_macaddr` and `random_bssid` (GL's first-run state), `disablecoext` (radio-wide, and set by the main AP).

### Writes and `apply`

`create`, `update`, `delete`, `set_enabled` and the schedule methods commit to `/etc/config/wireless` and `/etc/config/zeeli` right away and set `pending`. They do not touch the radios. `apply` does, with `/sbin/wifi reload`, which on this firmware is `ubus call network reload`. It is the command GL's own `wifi.set_config` ends with. It blocks rpcd only briefly: the command sources the driver scripts (0.24 s, measured with `wifi status`, which does the same) and hands the work to netifd, which brings the changed vaps up after the call has returned. The agent runs it as `timeout 25 /sbin/wifi reload` so a stuck router can't hold rpcd for long. If the timeout hits, `apply` fails with a message, the changes stay saved, and `pending` stays true, so the console keeps offering "Apply now". The console writes, then applies once, so a bulk change is one reload. If an apply fails, `list` still reports `pending: true` and the console offers "Apply now".

What a device experiences, from `qca-wifi-configurator` (the Lua daemon behind the `qsdk-wifi` ubus object, which `network reload` wakes) and `/lib/wifi/qcawificfg80211.sh`. It compares each vap with the config it applied last (`/tmp/qcawificfg80211_<radio>_bak`) and acts per vap, not per radio:
- **Changing a name, password, hidden, isolate or encryption** patches that vap's hostapd config and re-adds just that BSS (`wpa_cli … REMOVE` then `ADD bss_config`). Devices on that network disconnect and reconnect within a few seconds. Other networks on the radio keep running.
- **Anything else on a vap (a new network, switching one on, changing its network, options)** runs `wifi gl_multi_up <radio> <vap>` for that vap only. Same effect for its devices. The radio restarts only if every vap on it is in the list, which `apply` never causes.
- **Switching off** takes the vap down; its devices drop.
- Radio settings (channel, width, power) are not written by the agent, so they never cause a radio restart.

This rests on reading the daemon's strings and the scripts. It is the first live check.

### Password characters

Any printable ASCII (space to `~`) is allowed, 8 to 63 characters: hostapd's own rule. Characters such as `/ & \ | ' " $` and backticks were checked against every place a key travels, and none of them can break or inject into the generated config:
- **Stored raw, like GL's panel.** GL's `wifi` RPC validates a key with `gl.validator.wpakey` (length 8 to 63, or 64 hex; `/usr/lib/lua/gl/validator.lua:330`) and writes it to the same `key` option, unescaped. libuci quotes it on disk (`option key '...'\''...'`) and `uci export` quotes it again for the shell scripts.
- **The generator never evaluates it.** `hostapd_set_bss_options` reads it with `config_get psk "$vif" key` and adds it with `append "$var" "wpa_passphrase=$psk"` (`/lib/wifi/hostapd.sh:285-296`). `append` (`/lib/functions.sh:35-41`) puts the value in with `\$value` inside its `eval`, so the value is data, not code. The file is then written with an unquoted heredoc whose only expansion is `$hostapd_cfg` (`hostapd.sh:2461-2466`), and expansions are not repeated on the result. The SSID goes through the same path.
- **Checked on the router, not just read.** A key and SSID made of `$(touch ...)`, backticks, `\n` and `&|/"';#` went through the agent, `config_load`, `append` and the heredoc in a `/tmp` sandbox: they came out as literal text in the conf and nothing ran. The agent test `any printable character is a valid password...` covers the UCI half.
- **The only other shell that sees a key** is the `case "$key" in *"|id="*)` in `qcawificfg80211.sh` (SAE password identifiers). It sits behind `[ -z "$$sae_password_count" ]`, where `$$` is the shell's PID, so it never runs. A key containing `|id=` would be harmless anyway.
- **Newlines and control characters** are the one thing that would inject a hostapd line, and the agent refuses them in keys and names.

Not checked: `qca-wifi-configurator` re-writes a vap's `wpa_passphrase=` line itself when a password changes. It does that with Lua file calls (its only `sed` commands take fixed text and the config path), but its bytecode wouldn't disassemble here, so whether it handles `%` in a key (a Lua replacement-string character) is part of live check 2.

### Schedules

A schedule is `config wifi_schedule 'wifi_<id>'` in `/etc/config/zeeli` with `enabled`, `list days`, `off` and `on` (`HH:MM`, local time). A window starts at `off` on a listed day and may run past midnight.

It is enforced by `init.d/zeeli-wifi-schedule`, a procd service that runs `bin/zeeli-wifi-schedule`: once a minute, on the minute, it calls `zeeli.wifi tick`, and when that switched something it calls `apply`. The first pass runs at start, so a router that reboots inside a window turns the network off again. Why a service and not cron: this firmware runs `crond -c /tmp/gl_crontabs`, a RAM spool that GL rebuilds from `crontabs.d/*` whenever its timer settings change. The usual `/etc/crontabs/root` isn't read, and a line added to the spool would vanish on the next rebuild or reboot. The service touches no crontab at all, so it can't clobber GL's.

`tick` works on edges, not levels. When a network's wanted state changes it sets `disabled '1'` and `sched_off '1'` on its interfaces (off), or clears both on the ones it marked (on). It never turns on an interface that was off before the window began. A person can still flip the switch inside a window and it stays until the next edge; `set_enabled` clears `sched_off`. The last state it saw is in `$state/wifi-schedule.json` (RAM), which is why a reboot enforces the window again.

Removing Zeeli must release the networks a schedule is holding off, or they stay off with nothing left to turn them on. `zeeli-update remove` does this after it has stopped `zeeli-wifi-schedule` (so the loop can't hold them again):

```sh
for s in $(uci -q show wireless | sed -n "s/^wireless\.\(zeeli_[a-z0-9_]*\)\.sched_off='1'$/\1/p"); do
	uci -q set wireless.$s.disabled=0
	uci -q delete wireless.$s.sched_off
done
uci -q commit wireless && wifi reload
```

The section names are matched by `[a-z0-9_]` only, so nothing from the config reaches the shell unquoted. The networks themselves stay in `/etc/config/wireless` (the user's WiFi, now with no agent to edit it); delete the `zeeli_*` sections in the same loop if removal should take them away too.

### GL's WiFi timer

GL's own WiFi schedules (`gl_timer`, cron lines calling `/usr/bin/gl_timer_control_wifi`) pick the interface to switch with `get_iface`: the **last** AP in `wireless` that is not `iot2g`/`iot5g`, is not `multi_ap 1`, has no `mld`, is on the radio and has `guest` 0 or unset. Our sections are appended at the end and would match, so with that timer on, "turn 5 GHz off at 22:00" would switch our network and leave the main one up. The `guest 'zeeli'` marker is the way out: it is neither `0` nor `1`, so the shell comparison fails. This was checked by running the script's own selection function on a sandbox with three networks made by the agent: it picks `wifi2g`, `wifi5g`, `wifi6g` with the marker, and `zeeli_…` without it (there is a test for the same logic too). The cost: GL code that treats any `guest` value as true would call ours guest networks. The console already hides `zeeli_*` sections from GL's lists (`domain/wifi.ts`).

### Which GL code touches `wireless`

| Who                                                                                                            | What it does                                                                                                                                                                                                                                                                                                              | Effect on `zeeli_*` sections                                                                                                                                                                                                      |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `wifi` RPC (`/usr/lib/oui-httpd/rpc/wifi`, Lua bytecode, read with `strings`, plus `/usr/lib/lua/gl/wifi.lua`) | `set_config` writes the section named in `iface_name`, then `/sbin/wifi reload`. Some helpers walk every `wifi-iface`: dropping `disablecoext` radio-wide, re-deriving 6 GHz `macaddr`s (`add_qca6g_bssid`), looking for an active `guest` AP, bridging `guest`/`iot` networks. `get_config` lists the APs of each radio. | Never renamed or deleted. Our 6 GHz `macaddr` may be rewritten when GL saves the main 6 GHz network (not seen, see live checks). `get_config` very likely lists ours as extra "main" networks; the console filters `zeeli_*` out. |
| `qca-wifi-configurator`                                                                                        | The `qsdk-wifi` daemon: diffs vaps on `network reload` and applies the least it can. Also commits a radio's `channel` after ACS/bSTA sync.                                                                                                                                                                                | Treats ours like any other vap                                                                                                                                                                                                    |
| `/etc/init.d/gl-mesh`, `/etc/init.d/repeater`                                                                  | At start, for `mode sta` sections only: delete them, or set `disabled 1`; `bbss*` get `mode ap`                                                                                                                                                                                                                           | None: ours are `mode ap`                                                                                                                                                                                                          |
| `mesh` RPC (role switch)                                                                                       | Walks `wifi-iface`/`wifi-mld`: backs up and disables APs flagged `guest`, rewrites mesh/MLO defaults                                                                                                                                                                                                                      | Possibly disables ours if `guest 'zeeli'` reads as true. Mesh is another engineer's area; check when it lands.                                                                                                                    |
| `netmode` RPC (operating mode)                                                                                 | Resets `disabled` on guest slots, deletes `guest2g/5g`, `iot2g/5g`, then `brctl addif br-<network> <ifname>` for every enabled iface                                                                                                                                                                                      | Ours stay, and are re-bridged. The network they join may be gone after a mode change.                                                                                                                                             |
| `vlan_subnet` (`/usr/lib/lua/gl/vlan_subnet.lua`, the Networks RPC)                                            | Reads `wireless` only: lists ifaces whose `network` matches as that network's WiFi members, and writes `brport/isolated` for their `ifname` when a network's isolation changes. Writes nothing to `wireless`.                                                                                                             | Ours show as members of their network, which is right. **Deleting a network does not remove ours**: the `network` option dangles.                                                                                                 |
| `qcawifi-legacy` init, boot                                                                                    | `wifi reload_legacy`, then bridges every enabled iface to `br-<network>`                                                                                                                                                                                                                                                  | Ours come up like the rest                                                                                                                                                                                                        |
| `uci-defaults/03_gl_random-bssid`                                                                              | First boot only: random `macaddr` for every AP                                                                                                                                                                                                                                                                            | None after first boot                                                                                                                                                                                                             |
| `set_2b_function.sh`                                                                                           | Factory provisioning only: SSID and key onto the first non-guest AP of each band, by file order                                                                                                                                                                                                                           | Ours come later in the file; and they carry `guest`                                                                                                                                                                               |
| `fix-qsdk-wifi` / `fix_qsdk_wifi.sh`                                                                           | Re-triggers 6 GHz ACS                                                                                                                                                                                                                                                                                                     | None                                                                                                                                                                                                                              |
| `/lib/wifi/wps-*-update-uci` (WPS button)                                                                      | Writes SSID and key of the AP that did WPS                                                                                                                                                                                                                                                                                | Ours have no WPS                                                                                                                                                                                                                  |
| `/etc/hotplug.d/*`                                                                                             | Nothing that writes `wireless` but the WPS button handler                                                                                                                                                                                                                                                                 | None                                                                                                                                                                                                                              |
| Factory reset, `firstboot`                                                                                     | Wipes `/etc/config`                                                                                                                                                                                                                                                                                                       | Ours go with it. A sysupgrade that keeps config keeps them.                                                                                                                                                                       |

### Multi-link (MLO) networks

`create` with `mlo: true` makes one Wi-Fi 7 multi-link network: one name that devices use over two or three bands at once. The scope was decided from what the firmware and driver showed, read-only on a GL-BE9300:
- **The limit is GL's, not the hardware's.** GL's panel has two MLD slots, `mld0` (main) and `mld1` (guest), hard-coded in its `wifi` RPC (`set_mlo_config`, `get_mlo_config`, `set_mlo_iface_disabled`) and in `qca-wifi-configurator` (`/sbin/wifi gl_multi_up mld0`, `mld1`). The driver (`umac.ko`) caps MLDs at 24 and, per link, at 16 (`MAX_AP_MLDS_PER_LINK`, the `cmp #0x10` in `ieee80211_add_vdev_ids`; "Max MLD creation limit reached" is the `cmp #0x18` in `wlan_cfg80211_mld_add_virtual_intf`). `mld-phy0` allows 17 APs. The scripts take every `wifi-mld` section of `/etc/config/wireless` generically (`scan_wifi` fills `MLD_DEVICES`; the hostapd and qcawificfg80211 scripts loop over it). So the agent makes more MLDs, numbered 2 up to 15, and stops at 16 in total with GL's two.
- **Nothing here has been seen live beyond mld0 and mld1.** A third MLD is read from the scripts and the driver, not run. See the live checks below.
- **Section layout.** One `wifi-mld` section `zeeli_mld<n>` (`mld_ssid`, `mld_macaddr`, `zeeli '1'`) in `/etc/config/wireless`, plus one link `wifi-iface` per band, `zeeli_<id>_<band>`, which is the same shape as a per-band network with `option mld 'zeeli_mld<n>'` and `zeeli '1'`. The MLD is named `zeeli_mld<n>` because the scripts take the MLD number (`mld_id`) from the digits of its name and treat any name containing `mld` as an MLD; GL's panel only looks at `^mld` and `^wlanmld`, so it never sees ours. A network id never contains `mld`, for the same reason. All links carry identical security, so a multi-link network never gets `sae_pwe` even on 6 GHz (GL's own `wlanmld6g` has none either).
- **`/etc/config/mlo` is not written.** It holds GL's two slots' settings (`bands`, `disabled`) and `global.support_bands`. The agent reads `support_bands` (a band not listed can't join a multi-link network) and leaves the rest alone; a test checks it is unchanged.
- **Rules.** WPA3 only (`security` defaults to `sae` and anything else is refused), at least two bands, every band in `support_bands`, a free MLD number, plus the per-band checks (name unique per radio, free slot, network on and bridged). `list.mlo` is `{ supported, bands, reason }` so a form can say no first. An existing multi-link network can change its name, password, hidden, isolate, options and schedule; its bands and its network are fixed, because the scripts add or remove links and move the MLD between bridges only by restarting its group, which hasn't been tried. The edit is refused and the message says to delete it and make it again.
- **Taking it off the air.** The `wifi reload` doesn't remove a deleted interface, so `delete` queues `{ mld, links }` and `apply` then does what GL's own `set_mlo_config` does when it removes the guest MLD: `iw <link> del` for each link, `hostapd_cli … REMOVE <link>`, `ip link set dev zeeli_mld<n> nomaster`, `iw zeeli_mld<n> del`. The wireless sections are gone by then, so the next `wifi reload` doesn't bring them back.

### Live checks

These change the router, so the agent's author didn't run them. Run them in order on the router, from a session on a wired port or a main-network device you don't mind losing for a few seconds. `<id>` is what `create` returns. Undo everything with `ubus call zeeli.wifi delete '{"id":"<id>"}'` and `ubus call zeeli.wifi apply`.
1. **A network comes up and the rest of the radio doesn't blink.** Start a ping from a client on the main 5 GHz network, and `iw dev wlan1 station dump | grep -c Station` for a baseline. Then:

   ```sh
   ubus call zeeli.wifi create '{"ssid":"ZTest","password":"test-password-1","bands":["5g"],"network":"main","security":"sae-mixed"}'
   uci show wireless | grep zeeli_        # the section as written; no apply yet, so no new vap
   logread -f &                           # then:
   ubus call zeeli.wifi apply
   iw dev wlan130 info                    # exists: type AP, ssid ZTest
   brctl show br-lan | grep wlan130       # bridged to the network it joins
   grep -E '^(ssid|bridge|wpa|ieee80211w|wpa_key_mgmt|ignore_broadcast_ssid)' /var/run/hostapd-wlan130.conf
   ```

   Expect: a `gl_multi_up wifi1 wlan130` (or hostapd `ADD`) line in the log for that vap only; the ping keeps going; the station count is unchanged; `wpa_key_mgmt=WPA-PSK SAE`, `ieee80211w=1`. If the vap doesn't appear, `apply` isn't enough for a new interface and the agent has to call `wifi gl_multi_up wifi1 wlan130` itself.
2. **A password change on a WPA2 network keeps it WPA2.** The daemon patches hostapd with one `sed` block per encryption, and the strings don't say which one `psk2+ccmp` with `sae 0` gets.

   ```sh
   ubus call zeeli.wifi create '{"ssid":"ZTest2g","password":"test-password-2","bands":["2g"],"network":"main","security":"psk2"}'; ubus call zeeli.wifi apply
   grep -E 'wpa_key_mgmt|ieee80211w|sae|no_beacon_rsnxe' /var/run/hostapd-wlan030.conf
   ubus call zeeli.wifi update '{"id":"<id>","password":"another-password-2"}'; ubus call zeeli.wifi apply
   grep -E 'wpa_key_mgmt|ieee80211w|sae|no_beacon_rsnxe' /var/run/hostapd-wlan030.conf
   ```

   Repeat once with a password containing `%1` and `%` (`another-%1-pass%`) and check that `grep wpa_passphrase /var/run/hostapd-wlan030.conf` shows it unchanged: the daemon's own patching is the one place a key isn't proven literal.
   Expect the same lines both times: `wpa_key_mgmt=WPA-PSK`, `ieee80211w=0`, `no_beacon_rsnxe=1`, no `sae_*`. A `SAE` appearing means the hostapd patch widened it, and the agent has to restart the vap (`wifi gl_multi_up wifi0 wlan030`) instead of relying on `network reload`.
3. **Reload time.** `time ubus call zeeli.wifi apply` should take about a second, and `logread` should show the vap coming up some seconds later. If it takes 20 s or more, `apply` has to run detached with a status the console polls.
4. **GL's panel and RPC with our network present.** In the GL panel open WiFi: no `ZTest` row, and nothing else changed. Then:

   ```sh
   curl -s -H 'glinet: 1' http://127.0.0.1/rpc -d '{"jsonrpc":"2.0","method":"call","params":["","wifi","get_config",{}],"id":1}' | jsonfilter -e '@.result.res[*].ifaces[*].name'
   ```

   (Use the port in `/etc/nginx/conf.d/gl.conf` if it isn't 80.) It's fine if `zeeli_…` is listed, since the console drops it. A Lua error, or a missing main network, isn't: that means `guest 'zeeli'` upsets GL, and the marker has to change.
5. **GL's timer still hits the main network.** This is what the timer runs (it switches the real main 5 GHz network off and on, so do it when that is fine):

   ```sh
   gl_timer_control_wifi turn_onoff turnoff 5G 0; uci get wireless.wifi5g.disabled; uci get wireless.zeeli_<id>_5g.disabled
   gl_timer_control_wifi turn_onoff turnon 5G 0
   ```

   Expect `1` then `0`.
6. **GL's 6 GHz address handling leaves ours alone.** Make a 6 GHz network (`"bands":["6g"],"security":"sae"`), apply, note `uci get wireless.zeeli_<id>_6g.macaddr`, save the main 6 GHz network unchanged in the GL panel, read it again. Expect the same address and no restart of our vap in `logread`. Also check a 6 GHz client sees both networks.
7. **Options take effect.** Make one with `"options":{"fastRoaming":true,"maxClients":20,"multicastToUnicast":true,"dtim":3}`, apply, then:

   ```sh
   cfg80211tool wlan130 get_maxsta; cfg80211tool wlan130 g_mcastenhance
   grep -E 'wpa_key_mgmt|mobility_domain|nas_identifier|ft_|r1_key_holder' /var/run/hostapd-wlan130.conf
   ```

   Expect `20`, `2`, and `FT-PSK`/`FT-SAE` in `wpa_key_mgmt` with the other FT lines. If `get_maxsta` stays at 271, `maxsta` is read only at radio start.
8. **Schedules and reboot.** Set a window around now, in the router's local time (`date`):

   ```sh
   ubus call zeeli.wifi set_schedule '{"id":"<id>","days":["mon","tue","wed","thu","fri","sat","sun"],"off":"HH:MM","on":"HH:MM"}'
   /etc/init.d/zeeli-wifi-schedule enabled && ps | grep [z]eeli-wifi-schedule
   ```

   Within a minute: `uci get wireless.zeeli_<id>_5g.disabled` is `1` with `sched_off` set, and `logread` shows the vap going down. Inside the window, `reboot`: after boot the network is off again (`ls /var/lib/zeeli` shows `wifi-schedule.json`). After `on`, it comes back by itself. A network you switched off yourself (`set_enabled`) must still be off after the window.
9. **Deleting a network under it.** Delete the network a Zeeli network joins in the GL panel. Expect `uci get wireless.zeeli_<id>_5g.network` to still name it, and the vap to come up unbridged or not at all. Decide whether the Networks page should refuse, or take the WiFi networks down with it.
10. **A third MLD, end to end.** The first one that matters for multi-link. Note `iw dev | grep -c mld_addr` and `ip -br link | grep mld`, then, from a wired port:

    ```sh
    ubus call zeeli.wifi list | jsonfilter -e '@.mlo'      # supported true, three bands, reason null
    ubus call zeeli.wifi create '{"ssid":"ZMLO","password":"test-password-3","bands":["5g","6g"],"network":"main","mlo":true}'
    uci show wireless | grep -E 'zeeli_mld|mld=' ; uci show mlo | md5sum   # same md5 as before: mlo untouched
    ubus call zeeli.wifi apply
    sleep 15; ip -br link | grep zeeli_mld2; iw dev | grep -B8 ZMLO
    brctl show br-lan | grep -E 'zeeli_mld2'
    ```

    Expect: `zeeli_mld2` up and in `br-lan`; two `wlan` interfaces (`wlan130`, `wlan230`) with `ssid ZMLO` and the same `mld_addr`, equal to `uci get wireless.zeeli_mld2.mld_macaddr`; `mld0` and `mld1` and every main network unchanged (compare the `iw dev` listing and a ping from a 5 GHz client). A Wi-Fi 7 client (a recent phone or laptop) joins ZMLO; `iw dev wlan130 station dump` and `wlan230` both list it when it uses both links. If the MLD doesn't appear within 20 s the reload alone doesn't create it; try `wifi gl_multi_up zeeli_mld2` and tell the author, because `apply` then has to run it. If hostapd or the driver rejects a third MLD (look for "Max MLD creation limit" or hostapd errors in `logread`), the limit is lower than the driver's constant: delete it (below) and lower `MLD_LIMIT` in `lib/zeeli/wifi.uc` to 2.
11. **Deleting it.** `ubus call zeeli.wifi delete '{"id":"<id>"}'; ubus call zeeli.wifi apply; sleep 5`. Expect `iw dev | grep ZMLO` and `ip -br link | grep zeeli_mld` to print nothing, `uci show wireless | grep zeeli_` to print nothing, `mld0`, `mld1` and all main networks still in `iw dev` with the same `ssid`s, and the pinging client unbroken. `logread` shows no `qca-wifi-configurator` errors; and the GL panel's MLO page still opens and shows its own two.
12. **GL's panel with a multi-link network present.** While ZMLO exists, open GL's WiFi and MLO pages: no `ZMLO` row, nothing changed, saving GL's own MLO settings still works. Also `curl … wifi get_mlo_config` as in check 4: it must still report mld0 and mld1 only.
13. **Disabled and edited.** `set_enabled` false then `apply`: ZMLO disappears from `iw dev` (the configurator removes a fully disabled MLD group); true and apply brings it back. Rename it with `update` and apply: devices reconnect, the `mld_ssid` and link ssids match.

## History: `zeeli.stats` and the collector

`init.d/zeeli-collector` runs `bin/zeeli-collector run` under procd (respawned, low priority). ucode here has no uloop, so the loop is plain: sample, `sleep()` until the next minute, repeat. A sample takes about 0.1 s of wall time, mostly pings, and the process holds 2.4 MB. `lib/zeeli/collector.uc` has the logic (`tick` takes a snapshot as an argument, so tests feed it made-up ones), `lib/zeeli/sources.uc` reads the router, `lib/zeeli/ring.uc` stores, `lib/zeeli/stats.uc` answers `rpcd/zeeli-stats.uc`.

| What                     | Where it comes from                                                                                                                                 |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Uplink bytes             | `/sys/class/net/<l3_device>/statistics`, the files GL's own WAN speed reads                                                                         |
| Device bytes             | `gl-clients list` totals, which GL's `oui-tertf` kernel module counts, offloaded flows included                                                     |
| Network bytes            | The sum over a network's devices (matched by subnet). Bridge counters can miss flows the hardware forwards                                          |
| CPU, memory, temperature | `/proc/stat`, `/proc/meminfo`, the hottest thermal zone                                                                                             |
| Latency and loss         | Four `ping -A` to the uplink's gateway and to `target` (default 1.1.1.1), bound to that uplink and run in parallel; none for an uplink that is down |
| Active uplink            | The device of the lowest-metric default route in `/proc/net/route`                                                                                  |
- **Storage:** one text file per device, network, uplink, `system` and per-uplink `health` in `/var/lib/zeeli/stats/` (RAM). Each holds three fixed rings: 1-minute slots for 24 hours, hourly for 30 days, daily for 12 months (local days). A traffic file is 61 KB and never grows (slots are 12 hex digits, 281 TB; the first release used 10 and its files are widened on first use); the cap is 96 devices (about 6 MB). A slot with no sample is `-`, not zero, so a gap shows as a gap.
- **Flash:** every 15 minutes and on a clean stop (`stop_service` runs `zeeli-collector persist`) the files are brought up to date in `/overlay/zeeli`: a file that didn't change isn't touched, and a changed ring file has only its changed 4 KB blocks rewritten (its header last). A ring that is written every minute costs about 12 KB a save, 1.1 MB a day. That is on the overlay partition, so it survives reboots, but it is outside `/etc` so backups don't carry megabytes of history and a factory reset clears it. A router without `/overlay` keeps history in RAM only (`status.durable` is false). `ZEELI_PERSIST` overrides the place. History older than a year, and the least recently seen devices beyond the cap, are dropped when it saves.
- **Events** are one JSON line each in `events.jsonl` (the newest 500). A device counts as new when it has no history and wasn't in GL's list on an earlier tick; the first run after an install only learns what is there. Alerts are events flagged at the time they happen, from the kinds turned on in `/etc/config/zeeli` (`config alerts 'zeeli_alerts'`). Acknowledgements are written through to flash straight away.
- **Settings** in `/etc/config/zeeli`: `config stats 'zeeli_stats'` has `target` and `temp_high`; `config alerts 'zeeli_alerts'` has `list on`.
- **Signals:** connecting to ubus installs uloop's signal handlers, which swallow SIGTERM when no uloop runs. `sources.uc` resets them, or procd could only stop the collector with SIGKILL.
- **Whole-number maths:** ucode's `/` divides whole numbers without a fraction (`2150 / 100` is 21). Use `/ 100.0`, or the `ratio` helper, where you need the fraction.
## Groups and policies

`zeeli.groups` and `zeeli.policies` (see the headers of `lib/zeeli/groups.uc` and `lib/zeeli/policies.uc` for the shapes). Groups and policies live in `/etc/config/zeeli` as `group` and `policy` sections named `zeeli_g_<id>` and `zeeli_p_<id>`.

| File                       | What                                                                                                            |
| -------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `lib/zeeli/store.uc`       | UCI read and write, and the rules for what may be stored (limits: 64 groups, 256 devices a group, 128 policies) |
| `lib/zeeli/nftpolicy.uc`   | Pure: policies and the clock in, nft text out. Golden output in `test/golden/*.nft`                             |
| `lib/zeeli/policyapply.uc` | Everything that touches the router: checks, writes, reloads, dnsmasq, speed limits, the 30-second loop          |
| `init.d/zeeli-policies`    | procd service running `bin/policy-loop` (`serve()`), enabled and restarted by `zeeli-update`                    |

### How a policy reaches the router

- **Blocking and allowing.** One fw4 include, `config include 'zeeli_policies'` (type `nftables`, position `table-prepend`), pointing at `/etc/zeeli/policies.nft`. It adds a base chain `zeeli_forward` to `inet fw4` at forward priority -1, so it runs before fw4's own `forward` chain and before its "established, related: accept" rule, which means a new block also cuts flows already open. It jumps to one chain per policy in list order. A chain holds the policy's rules while the policy applies and is empty otherwise. Rules match only the original direction of a connection (`ct direction original`), so a blocked side can't start connections but still answers ones the other side opened ("IoT can't reach LAN" leaves LAN's connections into IoT working). `drop` for a block; `accept` for an allow, which ends the Zeeli chain, so an allow above a block is an exception to it (fw4's own rules still apply after it). The file never contains a name a person typed.
- **Who and what.** MAC sets (`zeeli_g_<group>` per group, `zeeli_c_<policy>` for a policy's own devices, matched with `ether saddr`) or `iifname` for a network. The internet is `oifname` of every zone that masquerades (WAN, VPN clients; not Tailscale or ZeroTier). Another network is `oifname` of its zone. `wan` and any zone that masquerades are refused as "who": a policy for an uplink would cut off everyone behind it. A network is its firewall zone's name (`lan`, `guest`, `iot`, `vlan<id>`). Zone devices are written out in the rules, from `/var/run/fw4.state`, not as fw4 `$<zone>_devices` defines: a define for a zone that has gone would stop fw4 loading anything. The loop notices a change of devices and swaps the rules.
- **Only routed traffic.** Traffic inside one network stays on its bridge and never reaches the firewall, as with GL's own block list. "Everything" means everything routed between networks and to the internet. The router's own services (DHCP, DNS, the admin pages) stay reachable.
- **Schedules and expiry** are decided by the agent in the router's local time (`localtime`, which knows the zone and daylight saving), not with nft `meta hour`, `meta day` or `meta time`. The kernel supports them (5.4 and nft 1.0.8) but compares in UTC: `meta day` ignores the zone and `meta hour` is converted by whoever loads the file, so a schedule would shift an hour at each daylight-saving change until the next reload, and a 22:00 to 07:00 window would land on the wrong weekdays. Instead the 30-second loop (`tick`) compiles the policies for the current minute. When only a schedule or an expiry changed, only the policy chains differ, and the loop swaps those on the running firewall with one atomic `nft -f` of `flush chain` and `add rule`, without a reload. A pause ends at most 30 seconds after its time, with the console closed; the loop empties the chain first, then deletes the policy (which reloads the firewall to tidy up).
- **After a write.** Console writes run the same reconcile straight away: compile, `nft -c -f` on the file inside a scratch table, then write the file and `services.reload('firewall')`. If `nft -c` refuses, nothing changes: the UCI edit is reverted, the old file stays, and the error carries nft's first line. Success is read back, not assumed: the file ends with `chain zeeli_rev`, which nothing jumps to and whose one rule's comment holds a hash of the file (`zeeli-rev:xxxxxxxx`; rule comments work on kernel 5.4, fw4 uses them too). After a reload or a live swap the agent reads `nft list chain inet fw4 zeeli_rev` and compares; it also checks the reload's exit code. If fw4 rejected the new file and kept the old ruleset, or the reload failed, the previous file is restored and the firewall reloaded again; the same file is not retried for ten minutes. fw4 reloads keep chains and sets the new file no longer declares, so after a reload the agent deletes the `zeeli_*` chains and sets it no longer owns. A change that only flips a schedule or switches a policy on or off is applied live and does not reload.
- **Sites.** For each "sites" policy the agent writes two sets (`zeeli_s4_<id>`, `zeeli_s6_<id>`, with a one-hour default timeout) and two dnsmasq `ipset` sections (`zeeli_site4_<id>`, `zeeli_site6_<id>` in `/etc/config/dhcp`), which dnsmasq-full 2.92 turns into `nftset=/domain/…` entries: every answer dnsmasq passes on for the domain or any subdomain adds its addresses to the sets, and the policy chain drops traffic from the covered devices to them. The catch is where devices' DNS goes. With AdGuard Home on, GL's `inet dns_table` redirects every device's port-53 traffic straight to AdGuard (port 3053), so dnsmasq never sees the lookups, and `nftset` alone would stay empty. So while a sites policy applies, its own chain `zeeli_d_<id>`, hooked from `zeeli_dns` (a NAT chain at priority -101, ahead of GL's -100), redirects the covered devices' DNS to dnsmasq (`redirect to :53`). dnsmasq's upstream is AdGuard (`server=127.0.0.1#3053`), so AdGuard's filtering still applies; the only cost is that AdGuard's log shows those devices as the router. With AdGuard off, GL already sends DNS to dnsmasq and the redirect changes nothing. The agent also asks dnsmasq for each active domain (`timeout 3 nslookup <domain> 127.0.0.1`) so the sets hold addresses before the devices next look the name up: only when a sites policy starts or gains a domain, after any firewall reload (which empties the sets) and every ten minutes, at most 24 domains and 20 seconds a pass, and never while the lock is held. Limits: it blocks addresses, not names, so a device using its own encrypted DNS (DoH, DoT) bypasses the redirect and is only blocked by addresses already in the set, and a shared CDN address can block other sites on it for as long as it stays in the set.
- **Hardware acceleration.** With flow offload or the Qualcomm acceleration engine (ECM; NSS or PPE) on, an already accelerated flow never reaches nft. When a device becomes blocked the agent deletes its conntrack entries (`conntrack -D -s <ip>` and `-r <ip>` for each address `/proc/net/arp` and `ip -6 neigh` know), and ECM defuncts the flow when its conntrack entry is destroyed. `/sys/kernel/debug/ecm/ecm_db/defunct_all` exists as a heavier fallback (GL's own scripts use it) that the agent does not use, since it resets every accelerated flow. ECM is off on the GL-BE9300 as shipped (`/etc/config/ecm`, `enabled 0`).
- **Locking.** Console writes and the 30-second loop share one lock: a directory under `/var/lib/zeeli` holding its owner's pid. A lock whose owner is gone is taken over at once; one whose owner is alive is never broken. Nothing slow (DNS lookups, waiting on a reload of another service) happens inside it except the firewall reload itself.
- **Speed limits.** Per device, through GL's own `gl_eqos` (what the firmware's `qos.set_speed_limit_rule` ends up running), so they show on the device in the GL panel and work with its acceleration: `gl_eqos add <MAC> <KiB/s down> <KiB/s up>`, `gl_eqos del <MAC>`, and `gl_eqos start` once if QoS has not built its queues. The agent records what it set in `zeeli_applied` and only ever changes those; a device that already has a limit someone set by hand is left alone with a warning. Limits for a whole network are refused. In `gl_eqos` a direction given as 0 gets no queue class at all (`[ $dl -gt 0 ]`), so 0 means "no limit" in that direction, which is what a download-only or upload-only policy sends. `gl_eqos start 312500 312500` (what the firmware itself runs before the first per-device limit) is router-wide but doesn't switch on GL's QoS mode (`qos.general.enable` is untouched): it tears down and rebuilds an HTB queue on `br-lan`, `br-guest`, `br-iot`, every `br-vlan*` and the WAN, caps each at 2.5 Gbit (312500 KiB/s), mirrors every ingress packet to an `ifb` device for upload shaping, and restarts `bridger` once. So after the first limit all traffic goes through a software queue, which can lower top speed on very fast links, and traffic through those devices is shaped in software even if hardware acceleration is on. The agent adds a warning to the result when it does this and the policy sheet says so. The last `gl_eqos del` stops it again.

### Not done

- **VPN or WAN routing as a policy action** ("route Kids' TV through the UK VPN"). It needs GL's `route_policy` config plus a way to read each tunnel's state, or fw4 marks with `ip rule`s of our own; either has to be studied against GL's kmwan and VPN-client scripts first.
- `zeeli-update remove` takes the include and dnsmasq sections away but not the speed limits the agent set (`zeeli_applied`); see the lines in the report to add to it.
