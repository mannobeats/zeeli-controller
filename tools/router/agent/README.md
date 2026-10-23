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

## Snapshots and confirm-or-roll-back

Two helpers any area can use before a write that could cut the console off or that a person may want to undo.

- `zeeli.snapshots` copies `/etc/config` (or just the files named) to `/overlay/zeeli/snapshots`, keeps the newest 10, and can list, diff and restore them. `create(reason, only?)` is the call to make before a risky write. The folder is on flash, so snapshots survive a reboot, but outside `/etc`, so they appear in neither a snapshot nor a `sysupgrade -b` backup.
- `zeeli.rollback` wraps a write in a countdown. Call `begin(area, ['firewall'], 'changing a firewall rule')` after checking the request and before writing, write and reload, then return `{ ...result, token, seconds }`. Give your rpcd object a `confirm` method that calls `rollback.confirm(token)`; the console's `confirmChange(transport, area, armed)` calls it within the window. If no confirm arrives, `bin/zeeli-rollback-timer` (started by `begin`) restores the snapshot of those files and reloads their service. Only one change waits at a time.
- A restore reloads what can be reloaded (`network`, `dhcp`, `firewall`, `system`, `dropbear`; `wireless` through the network reload) and reports `rebootNeeded` for GL's own settings, which are only read at startup.

Sections the agent owns (`zeeli_*` names, or `option zeeli '1'`) are hidden from `zeeli.firewall`, so a policy engine can add its own rules and includes without the firewall page touching them.

## Tests

```sh
ZEELI_TEST_ROUTER=root@192.168.8.1 sh tools/router/agent/test/run.sh   # on a router over SSH, in /tmp only
sh tools/router/agent/test/run.sh                                      # in an OpenWrt 23.05 container (CI)
```

Each `test/*.test.uc` runs on a fresh copy of `test/fixtures/be9300`: the GL-BE9300's `wireless`, `network`, `firewall`, `dhcp` and `mlo` settings, with passwords, names and MAC addresses scrubbed. Use `plugin('<area>')` from `test/assert.uc` to call methods the way rpcd does, then read the sandbox with `cursor()` to check what was written.
