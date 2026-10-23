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

## History: `zeeli.stats` and the collector

`init.d/zeeli-collector` runs `bin/zeeli-collector run` under procd (respawned, low priority). ucode here has no uloop, so the loop is plain: sample, `sleep()` until the next minute, repeat. A sample takes about 0.1 s of wall time, mostly pings, and the process holds 2.4 MB. `lib/zeeli/collector.uc` has the logic (`tick` takes a snapshot as an argument, so tests feed it made-up ones), `lib/zeeli/sources.uc` reads the router, `lib/zeeli/ring.uc` stores, `lib/zeeli/stats.uc` answers `rpcd/zeeli-stats.uc`.

| What                                        | Where it comes from                                                                                                                               |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Uplink bytes                                | `/sys/class/net/<l3_device>/statistics`, the files GL's own WAN speed reads                                                                       |
| Device bytes                                | `gl-clients list` totals, which GL's `oui-tertf` kernel module counts, offloaded flows included                                                   |
| Network bytes                               | The sum over a network's devices (matched by subnet). Bridge counters can miss flows the hardware forwards                                        |
| CPU, memory, temperature                    | `/proc/stat`, `/proc/meminfo`, the hottest thermal zone                                                                                           |
| Latency and loss                            | Four `ping -A` to the uplink's gateway and to `target` (default 1.1.1.1), bound to that uplink and run in parallel; none for an uplink that is down |
| Active uplink                               | The device of the lowest-metric default route in `/proc/net/route`                                                                                |

- **Storage:** one text file per device, network, uplink, `system` and per-uplink `health` in `/var/lib/zeeli/stats/` (RAM). Each holds three fixed rings: 1-minute slots for 24 hours, hourly for 30 days, daily for 12 months (local days). A traffic file is 50 KB and never grows; the cap is 96 devices (about 5 MB). A slot with no sample is `-`, not zero, so a gap shows as a gap.
- **Flash:** every 15 minutes and on a clean stop (`stop_service` runs `zeeli-collector persist`) the files are copied to `/overlay/zeeli`. That is on the overlay partition, so it survives reboots, but it is outside `/etc` so backups don't carry megabytes of history and a factory reset clears it. A router without `/overlay` keeps history in RAM only (`status.durable` is false). `ZEELI_PERSIST` overrides the place. History older than a year, and the least recently seen devices beyond the cap, are dropped when it saves.
- **Events** are one JSON line each in `events.jsonl` (the newest 500). A device counts as new when it has no history and wasn't in GL's list on an earlier tick; the first run after an install only learns what is there. Alerts are events flagged at the time they happen, from the kinds turned on in `/etc/config/zeeli` (`config alerts 'zeeli_alerts'`). Acknowledgements are written through to flash straight away.
- **Settings** in `/etc/config/zeeli`: `config stats 'zeeli_stats'` has `target` and `temp_high`; `config alerts 'zeeli_alerts'` has `list on`.
- **Signals:** connecting to ubus installs uloop's signal handlers, which swallow SIGTERM when no uloop runs. `sources.uc` resets them, or procd could only stop the collector with SIGKILL.
- **Whole-number maths:** ucode's `/` divides whole numbers without a fraction (`2150 / 100` is 21). Use `/ 100.0`, or the `ratio` helper, where you need the fraction.
