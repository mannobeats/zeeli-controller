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

## Tests

```sh
ZEELI_TEST_ROUTER=root@192.168.8.1 sh tools/router/agent/test/run.sh   # on a router over SSH, in /tmp only
sh tools/router/agent/test/run.sh                                      # in an OpenWrt 23.05 container (CI)
```

Each `test/*.test.uc` runs on a fresh copy of `test/fixtures/be9300`: the GL-BE9300's `wireless`, `network`, `firewall`, `dhcp` and `mlo` settings, with passwords, names and MAC addresses scrubbed. Use `plugin('<area>')` from `test/assert.uc` to call methods the way rpcd does, then read the sandbox with `cursor()` to check what was written.

## WiFi and the firmware

`zeeli.wifi` (`rpcd/zeeli-wifi.uc`, `lib/zeeli/wifi.uc`) lets people make their own WiFi networks on any radio and attach them to any LAN network. This section records what the firmware does to `/etc/config/wireless`, because the agent shares that file with GL's panel. It was worked out by reading the scripts on a GL-BE9300 (firmware 4.10.1) and running only read-only commands. Where a conclusion rests on reading code rather than seeing the router do it, it says so, and the question is listed under [Live checks](#live-checks).

### The API

| Method                            | Arguments                                                                                      | Result                                                                                     |
| --------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `list`                            | none                                                                                           | `networks`, `radios`, `lanNetworks`, `internal`, `pending`. Never a key: `hasKey` instead. |
| `reveal`                          | `id`                                                                                           | `{ password }` of one network the agent made                                               |
| `create`                          | `ssid`, `password`, `bands`, `network`, `security`, `hidden`, `isolate`, `options`, `schedule` | `{ id, sections, pending }`                                                                |
| `update`                          | `id` and any of the above except `schedule`                                                    | `{ id, pending }`. No password keeps the current one.                                      |
| `delete`                          | `id`                                                                                           | `{ pending }`                                                                              |
| `set_enabled`                     | `id`, `enabled`                                                                                | `{ pending }`                                                                              |
| `apply`                           | none                                                                                           | `{ applied }`                                                                              |
| `set_schedule` / `clear_schedule` | `id`, `enabled`, `days`, `off`, `on` / `id`                                                    | `{ schedule }` / `{ pending }`                                                             |
| `tick`                            | none                                                                                           | `{ changed }`. Enforces schedules; the service below calls it.                             |
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

Left out on purpose: `multi_ap` and `wps_*` (mesh and WPS), `mld` (MLO networks are out of scope), `init`, `factory_macaddr` and `random_bssid` (GL's first-run state), `disablecoext` (radio-wide, and set by the main AP).

### Writes and `apply`

`create`, `update`, `delete`, `set_enabled` and the schedule methods commit to `/etc/config/wireless` and `/etc/config/zeeli` right away and set `pending`. They do not touch the radios. `apply` does, with `/sbin/wifi reload`, which on this firmware is `ubus call network reload`. It is the command GL's own `wifi.set_config` ends with. The console writes, then applies once, so a bulk change is one reload. If an apply fails, `list` still reports `pending: true` and the console offers "Apply now".

What a device experiences, from `qca-wifi-configurator` (the Lua daemon behind the `qsdk-wifi` ubus object, which `network reload` wakes) and `/lib/wifi/qcawificfg80211.sh`. It compares each vap with the config it applied last (`/tmp/qcawificfg80211_<radio>_bak`) and acts per vap, not per radio:
- **Changing a name, password, hidden, isolate or encryption** patches that vap's hostapd config and re-adds just that BSS (`wpa_cli … REMOVE` then `ADD bss_config`). Devices on that network disconnect and reconnect within a few seconds. Other networks on the radio keep running.
- **Anything else on a vap (a new network, switching one on, changing its network, options)** runs `wifi gl_multi_up <radio> <vap>` for that vap only. Same effect for its devices. The radio restarts only if every vap on it is in the list, which `apply` never causes.
- **Switching off** takes the vap down; its devices drop.
- Radio settings (channel, width, power) are not written by the agent, so they never cause a radio restart.

This rests on reading the daemon's strings and the scripts. It is the first live check.

### Schedules

A schedule is `config wifi_schedule 'wifi_<id>'` in `/etc/config/zeeli` with `enabled`, `list days`, `off` and `on` (`HH:MM`, local time). A window starts at `off` on a listed day and may run past midnight.

It is enforced by `init.d/zeeli-wifi-schedule`, a procd service that runs `bin/zeeli-wifi-schedule`: once a minute, on the minute, it calls `zeeli.wifi tick`, and when that switched something it calls `apply`. The first pass runs at start, so a router that reboots inside a window turns the network off again. Why a service and not cron: this firmware runs `crond -c /tmp/gl_crontabs`, a RAM spool that GL rebuilds from `crontabs.d/*` whenever its timer settings change. The usual `/etc/crontabs/root` isn't read, and a line added to the spool would vanish on the next rebuild or reboot. The service touches no crontab at all, so it can't clobber GL's.

`tick` works on edges, not levels. When a network's wanted state changes it sets `disabled '1'` and `sched_off '1'` on its interfaces (off), or clears both on the ones it marked (on). It never turns on an interface that was off before the window began. A person can still flip the switch inside a window and it stays until the next edge; `set_enabled` clears `sched_off`. The last state it saw is in `$state/wifi-schedule.json` (RAM), which is why a reboot enforces the window again.

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

   Expect the same lines both times: `wpa_key_mgmt=WPA-PSK`, `ieee80211w=0`, `no_beacon_rsnxe=1`, no `sae_*`. A `SAE` appearing means the hostapd patch widened it, and the agent has to restart the vap (`wifi gl_multi_up wifi0 wlan030`) instead of relying on `network reload`.
3. **GL's panel and RPC with our network present.** In the GL panel open WiFi: no `ZTest` row, and nothing else changed. Then:

   ```sh
   curl -s -H 'glinet: 1' http://127.0.0.1/rpc -d '{"jsonrpc":"2.0","method":"call","params":["","wifi","get_config",{}],"id":1}' | jsonfilter -e '@.result.res[*].ifaces[*].name'
   ```

   (Use the port in `/etc/nginx/conf.d/gl.conf` if it isn't 80.) It's fine if `zeeli_…` is listed, since the console drops it. A Lua error, or a missing main network, isn't: that means `guest 'zeeli'` upsets GL, and the marker has to change.
4. **GL's timer still hits the main network.** This is what the timer runs (it switches the real main 5 GHz network off and on, so do it when that is fine):

   ```sh
   gl_timer_control_wifi turn_onoff turnoff 5G 0; uci get wireless.wifi5g.disabled; uci get wireless.zeeli_<id>_5g.disabled
   gl_timer_control_wifi turn_onoff turnon 5G 0
   ```

   Expect `1` then `0`.
5. **GL's 6 GHz address handling leaves ours alone.** Make a 6 GHz network (`"bands":["6g"],"security":"sae"`), apply, note `uci get wireless.zeeli_<id>_6g.macaddr`, save the main 6 GHz network unchanged in the GL panel, read it again. Expect the same address and no restart of our vap in `logread`. Also check a 6 GHz client sees both networks.
6. **Options take effect.** Make one with `"options":{"fastRoaming":true,"maxClients":20,"multicastToUnicast":true,"dtim":3}`, apply, then:

   ```sh
   cfg80211tool wlan130 get_maxsta; cfg80211tool wlan130 g_mcastenhance
   grep -E 'wpa_key_mgmt|mobility_domain|nas_identifier|ft_|r1_key_holder' /var/run/hostapd-wlan130.conf
   ```

   Expect `20`, `2`, and `FT-PSK`/`FT-SAE` in `wpa_key_mgmt` with the other FT lines. If `get_maxsta` stays at 271, `maxsta` is read only at radio start.
7. **Schedules and reboot.** Set a window around now, in the router's local time (`date`):

   ```sh
   ubus call zeeli.wifi set_schedule '{"id":"<id>","days":["mon","tue","wed","thu","fri","sat","sun"],"off":"HH:MM","on":"HH:MM"}'
   /etc/init.d/zeeli-wifi-schedule enabled && ps | grep [z]eeli-wifi-schedule
   ```

   Within a minute: `uci get wireless.zeeli_<id>_5g.disabled` is `1` with `sched_off` set, and `logread` shows the vap going down. Inside the window, `reboot`: after boot the network is off again (`ls /var/lib/zeeli` shows `wifi-schedule.json`). After `on`, it comes back by itself. A network you switched off yourself (`set_enabled`) must still be off after the window.
8. **Deleting a network under it.** Delete the network a Zeeli network joins in the GL panel. Expect `uci get wireless.zeeli_<id>_5g.network` to still name it, and the vap to come up unbridged or not at all. Decide whether the Networks page should refuse, or take the WiFi networks down with it.
