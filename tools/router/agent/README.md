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

## Groups and policies

`zeeli.groups` and `zeeli.policies` (see the headers of `lib/zeeli/groups.uc` and `lib/zeeli/policies.uc` for the shapes). Groups and policies live in `/etc/config/zeeli` as `group` and `policy` sections named `zeeli_g_<id>` and `zeeli_p_<id>`.

| File                         | What                                                                                                           |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `lib/zeeli/store.uc`         | UCI read and write, and the rules for what may be stored (limits: 64 groups, 256 devices a group, 128 policies) |
| `lib/zeeli/nftpolicy.uc`     | Pure: policies and the clock in, nft text out. Golden output in `test/golden/*.nft`                            |
| `lib/zeeli/policyapply.uc`   | Everything that touches the router: checks, writes, reloads, dnsmasq, speed limits, the 30-second loop        |
| `init.d/zeeli-policies`      | procd service running `bin/policy-loop` (`serve()`), enabled and restarted by `zeeli-update`                    |

### How a policy reaches the router

- **Blocking and allowing.** One fw4 include, `config include 'zeeli_policies'` (type `nftables`, position `table-prepend`), pointing at `/etc/zeeli/policies.nft`. It adds a base chain `zeeli_forward` to `inet fw4` at forward priority -1, so it runs before fw4's own `forward` chain and before its "established, related: accept" rule, which means a new block also cuts flows already open. It jumps to one chain per policy in list order. A chain holds the policy's rules while the policy applies and is empty otherwise. `drop` for a block; `accept` for an allow, which ends the Zeeli chain, so an allow above a block is an exception to it (fw4's own rules still apply after it). The file never contains a name a person typed.
- **Who and what.** MAC sets (`zeeli_g_<group>` per group, `zeeli_c_<policy>` for a policy's own devices, matched with `ether saddr`) or `iifname` for a network. The internet is `oifname` of every zone that masquerades (WAN, VPN clients; not Tailscale or ZeroTier). Another network is `oifname` of its zone. A network is its firewall zone's name (`lan`, `guest`, `iot`, `vlan<id>`). Zone devices are written out in the rules, from `/var/run/fw4.state`, not as fw4 `$<zone>_devices` defines: a define for a zone that has gone would stop fw4 loading anything. The loop notices a change of devices and swaps the rules.
- **Only routed traffic.** Traffic inside one network stays on its bridge and never reaches the firewall, as with GL's own block list. "Everything" means everything routed between networks and to the internet. The router's own services (DHCP, DNS, the admin pages) stay reachable.
- **Schedules and expiry** are decided by the agent in the router's local time (`localtime`, which knows the zone and daylight saving), not with nft `meta hour`, `meta day` or `meta time`. The kernel supports them (5.4 and nft 1.0.8) but compares in UTC: `meta day` ignores the zone and `meta hour` is converted by whoever loads the file, so a schedule would shift an hour at each daylight-saving change until the next reload, and a 22:00 to 07:00 window would land on the wrong weekdays. Instead the 30-second loop (`tick`) compiles the policies for the current minute. When only a schedule or an expiry changed, only the policy chains differ, and the loop swaps those on the running firewall with one atomic `nft -f` of `flush chain` and `add rule`, without a reload. A pause ends at most 30 seconds after its time, with the console closed; the loop empties the chain first, then deletes the policy (which reloads the firewall to tidy up).
- **After a write.** Console writes run the same reconcile straight away: compile, `nft -c -f` on the file inside a scratch table, then write the file and `services.reload('firewall')`. If `nft -c` refuses, nothing changes: the UCI edit is reverted, the old file stays, and the error carries nft's first line. If the firewall comes back without `zeeli_forward`, the previous file is restored and the firewall reloaded again; the same file is not retried for ten minutes. A change that only flips a schedule or switches a policy on or off is applied live and does not reload.
- **Sites.** For each "sites" policy the agent writes two sets (`zeeli_s4_<id>`, `zeeli_s6_<id>`, with a one-hour default timeout) and two dnsmasq `ipset` sections (`zeeli_site4_<id>`, `zeeli_site6_<id>` in `/etc/config/dhcp`), which dnsmasq-full 2.92 turns into `nftset=/domain/…` entries: every answer dnsmasq passes on for the domain or any subdomain adds its addresses to the sets, and the policy chain drops traffic from the covered devices to them. The catch is where devices' DNS goes. With AdGuard Home on, GL's `inet dns_table` redirects every device's port-53 traffic straight to AdGuard (port 3053), so dnsmasq never sees the lookups, and `nftset` alone would stay empty. So while a sites policy applies, its own chain `zeeli_d_<id>`, hooked from `zeeli_dns` (a NAT chain at priority -101, ahead of GL's -100), redirects the covered devices' DNS to dnsmasq (`redirect to :53`). dnsmasq's upstream is AdGuard (`server=127.0.0.1#3053`), so AdGuard's filtering still applies; the only cost is that AdGuard's log shows those devices as the router. With AdGuard off, GL already sends DNS to dnsmasq and the redirect changes nothing. The loop also asks dnsmasq for each active domain (`nslookup <domain> 127.0.0.1`) so the sets hold addresses before the devices next look the name up. Limits: it blocks addresses, not names, so a device using its own encrypted DNS (DoH, DoT) bypasses the redirect and is only blocked by addresses already in the set, and a shared CDN address can block other sites on it for as long as it stays in the set.
- **Hardware acceleration.** With flow offload or the Qualcomm acceleration engine (ECM; NSS or PPE) on, an already accelerated flow never reaches nft. When a device becomes blocked the agent deletes its conntrack entries (`conntrack -D -s <ip>` and `-r <ip>` for each address `/proc/net/arp` and `ip -6 neigh` know), and ECM defuncts the flow when its conntrack entry is destroyed. `/sys/kernel/debug/ecm/ecm_db/defunct_all` exists as a heavier fallback (GL's own scripts use it) that the agent does not use, since it resets every accelerated flow. ECM is off on the GL-BE9300 as shipped (`/etc/config/ecm`, `enabled 0`).
- **Speed limits.** Per device, through GL's own `gl_eqos` (what the firmware's `qos.set_speed_limit_rule` ends up running), so they show on the device in the GL panel and work with its acceleration: `gl_eqos add <MAC> <KiB/s down> <KiB/s up>`, `gl_eqos del <MAC>`, and `gl_eqos start` once if QoS has not built its queues. The agent records what it set in `zeeli_applied` and only ever changes those; a device that already has a limit someone set by hand is left alone with a warning. Limits for a whole network are refused.

### Not done

- **VPN or WAN routing as a policy action** ("route Kids' TV through the UK VPN"). It needs GL's `route_policy` config plus a way to read each tunnel's state, or fw4 marks with `ip rule`s of our own; either has to be studied against GL's kmwan and VPN-client scripts first.
- A removed agent (`zeeli-update remove`) leaves `/etc/zeeli`, the include section and the `zeeli` config behind, so policies keep applying without the loop. `zeeli-update` would need to remove them.
