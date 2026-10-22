# Architecture

Zeeli Controller is a static single-page app that is served from the router's admin origin and talks to the router's own APIs. It has no backend of its own. This document covers how the code is laid out, how a request reaches the router, and how to add to it.

## Packages

```
apps/console           @zeeli/console     React 19 interface (Vite, TanStack Query)
packages/router-api    @zeeli/router-api  Typed domain API, transports, mock router
```

The console depends on `@zeeli/router-api` through the workspace. `router-api` has no runtime dependencies and knows nothing about React. Its entry point is `src/index.ts`, consumed as TypeScript source, so it has no separate build step.

## Request path

```
page component
  -> TanStack Query hook (useQuery, useSettings, useWrite)
    -> api.<area>.<method>()          packages/router-api/src/domain/*
      -> Transport.call / ubus / adguard / upload / download
        -> GL.iNet firmware  or  in-memory mock
```

### The domain API

`createRouterApi(transport)` in `packages/router-api/src/api.ts` builds one object with an entry per area: `system`, `device`, `clients`, `networks`, `internet`, `wifi`, `networkExtras`, `openwrt`, `security`, `dns`, `vpn`, `family`, `traffic`, `apps`, `activity`. Each area lives in `src/domain/<area>.ts` and is a factory that takes the transport.

Domain modules do three jobs:
- They name the operation for what it does (`clients.setBlocked`, `internet.join`), not for the firmware's call.
- They turn raw firmware shapes into typed objects. For example, `RawIface` becomes `WifiNetwork`, and kilobytes per second become Mbps.
- They raise `RouterError` (`src/errors.ts`) with a `kind` (`offline`, `timeout`, `signedOut`, `tooManyAttempts`, `advancedLocked`, `notKept`, `invalid`, `failed`) and a message written to be shown to the person as is.

`src/domain/openwrt.ts` covers settings the GL.iNet API does not expose, such as firewall zones and rules, static routes, DHCP leases and packages. It works by reading and writing UCI over ubus. `src/net.ts` holds the address and route parsing helpers both sides use.

### Transports

`Transport` (`src/transport/types.ts`) is the only seam between the interface and a router:

| Member                       | Used for                                                   |
| ---------------------------- | ---------------------------------------------------------- |
| `call(module, fn, args)`     | GL.iNet firmware module calls (`clients.get_list`)         |
| `ubus(object, method, args)` | Raw OpenWrt ubus calls (UCI, network, `file.exec`)         |
| `execDirect(command, args)`  | LuCI cgi-exec, for output over ubus's 4 MB (feed lists)    |
| `adguard(path, init)`        | AdGuard Home's HTTP API                                    |
| `upload` / `download`        | Files, such as VPN profiles and backups                    |
| `session`                    | Sign-in, liveness, sign-out, and the second OpenWrt unlock |

**`createGlTransport`** (`src/transport/gl.ts`) targets GL.iNet firmware 4.x:
- JSON-RPC to `/rpc` (oui-httpd). Sign-in is challenge-response: the router returns an algorithm, salt and nonce; the browser computes a SHA-crypt hash of the password and sends only `sha256(root:<hash>:<nonce>)`.
- The session id is kept in the `Admin-Token` cookie, the same cookie the stock GL.iNet panel uses, so a sign-in in either interface works in both.
- OpenWrt ubus goes through LuCI at `/cgi-bin/luci/admin/ubus`. GL firmware needs a second LuCI sign-in for this; sign-in opens it with the same password, and `AdvancedGate` in the console asks again only if that session expires.
- AdGuard Home is reached under `/control/`; files go to `/upload` and come from `/download`.
- Every request has a timeout (15 seconds by default, longer for slow writes). Firmware errors are mapped to `RouterError` kinds, and an "Access denied" answer signs the console out.

**`createMockTransport`** (`src/mock/transport.ts`) is an in-memory router used by the demo and by tests:
- `seed.ts` builds a home network: a GL-BE9300, clients, subnets and radios. Names and addresses are made up, and every MAC is locally administered.
- `handlers.ts` and `more-handlers.ts` map keys to functions over that state. Keys are `module.fn` for firmware calls, `ubus:object.method` for ubus, and `adguard:path` for AdGuard Home.
- `settings-data.ts` lists every get/set settings pair as `'module.get_fn': [set_fn, initialValue]`. A write merges into the stored value, so read-back verification behaves as it does on real hardware.
- It adds randomised latency, enforces sign-in (password `demo`), and locks ubus calls until the advanced unlock, so loading states and gates can be exercised.
- A call without a handler answers `{}`, so a missing handler shows up as an empty page rather than a crash.

A plain-OpenWrt transport is planned. It will implement the same interface, so no screen has to change.

## Writes and read-back

Firmware often answers "ok" to a value it then ignores: an unsupported option, a clamped number, a key under another name. The console only reports a write as saved when the router actually kept it.
- **`writeAndVerify(write, read, kept, what)`** (`src/verify.ts`) runs the write, reads the state back, and throws `RouterError('notKept', "The router didn't keep <what>.")` if `kept(current)` is false. It returns the state it read, so callers can show that state rather than what they sent.
- **`settings<T>(transport, module, options)`** (`src/settings.ts`) wraps a firmware module's `get_config` / `set_config` pair, or other function names through `get` and `set`. `set(values)` sends only the keys passed in, then checks each one with `sameValue`. `sameValue` compares by meaning, because firmware echoes numbers as strings and booleans as `0`/`1`. Keys listed in `writeOnly`, such as passwords, are not compared, and neither are keys the router does not echo back.
- Writes that are not plain settings call `writeAndVerify` directly with their own check. One example is `clients.setBlocked`, which merges into the firmware's block list and confirms each MAC is in or out.
- One-shot actions that cannot be read back, such as a reboot or forgetting a device, go through `useWrite` in the console, which refetches the queries they affect.

On the console side, `useSettings(key, pair)` (`apps/console/src/api/useSettings.ts`) pairs a query with a `save` that calls `pair.set` and writes the verified result into the query cache. `SettingsForm` (`src/ui/SettingsForm.tsx`) shows the error under the fields when a save throws, and shows a toast when it succeeds.

## Console structure

```
apps/console/src/
  main.tsx        QueryClient, theme, global styles, root render
  app/            the shell and routing
  api/            the router API instance and query hooks
  features/       one folder per area, holding its pages
  ui/             shared components
  lib/            pure helpers (formatting, device classes, days, file save)
  styles/         tokens.css (design tokens), app.css, console.css, fonts
```

- **`app/`**: `nav.ts` holds the whole information architecture (sections, groups, pages and their command-palette keywords), and its order is the order on screen. `pages.tsx` maps each page id to a lazy-loaded component, so each area loads on first visit. `useHashRoute.ts` routes by URL hash (`#wifi`), so one build works at any path. `App.tsx` handles the session phases (checking, signed out, signed in) and page titles and focus. `Shell.tsx` renders the top bar, icon rail and section panel. `CommandPalette.tsx` is the Cmd+K finder, and `theme.ts` sets light or dark.
- **`api/`**: `router.ts` creates the single `api` object, with the mock transport when the build mode is `demo` and the GL.iNet transport otherwise. `queries.ts` holds shared hooks (`useClients`, `useStatus`, `useInfo`), the refresh intervals (`LIVE`), and `useWrite`, a mutation that invalidates the given query keys when it settles. `useSettings.ts` is described above.
- **`features/`**: one folder per area (`dashboard`, `clients`, `wifi`, `networks`, `firewall`, `vpn`, `apps`, `system`, and so on). Large pages get their own file. Small related pages share a `pages.tsx` and are exported by name. Pure logic that a page needs, such as mapping a form to an API payload, sits next to it with a test (`networks/form.ts`, `family/profile.ts`).
- **`ui/`**: shared components. These include `Layout.tsx` (`PageHeader`, `Panel`, `Stack`, `KeyValues`, `Note`, `Chip`, `Empty`), `fields.tsx` (text fields, switches, segmented controls), `SettingsForm.tsx` with `useForm` (Save stays disabled until something changes), `DataTable.tsx` (tables with a phone layout), `Sheet.tsx`, `feedback.tsx` (toasts and confirmations), `Loading.tsx`, `PageError.tsx`, and `AdvancedGate.tsx`.
- **`lib/`**: framework-free helpers with unit tests.
- **`styles/`**: `tokens.css` defines every colour, size and radius as a custom property using `light-dark()`, and component CSS uses only those tokens. The design rules are in [`DESIGN.md`](../DESIGN.md).

The build mode decides the transport. Vite defines `import.meta.env.VITE_TRANSPORT` as `mock` for `--mode demo` and `gl` otherwise. Outside demo mode, the dev server proxies `/rpc`, `/cgi-bin`, `/upload`, `/download` and `/control` to `ROUTER_URL`. When `VERIFY_SSH` is set, the dev-only plugin in `apps/console/dev/ssh-readonly.ts` answers reads by running them on the router over SSH and rejects every write.

## Adding a page

1. **Router side.** Add the calls to the matching module in `packages/router-api/src/domain/`, typed, with raw firmware shapes kept private. For a settings pair, use `settings<T>(t, 'module')`; for any other write that can be checked, use `writeAndVerify`. If you create a new area, register it in `api.ts` and export it from `index.ts`.
2. **Mock.** Add handlers in `src/mock/` for every new call. For a settings pair, add one line to `settings-data.ts`. Then check the page works in `pnpm dev:demo`.
3. **Navigation.** Add the page to `SECTIONS` in `apps/console/src/app/nav.ts`, with an id, a title, and keywords people might type.
4. **Component.** Write the page in `apps/console/src/features/<area>/` and register it under the same id in `app/pages.tsx`. Build it from `PageHeader`, `Panel` and `SettingsForm`, read with `useQuery` or `useSettings`, and write with `useSettings().save` or `useWrite`.
5. **Tests.** Put pure mapping or parsing logic in its own module with a `*.test.ts` next to it.
6. Run `pnpm check`.

## Adding an app

Apps are listed in `APP_CATALOG` in `packages/router-api/src/domain/apps.ts`, and the App store page is built from it.
1. Add an `AppDefinition` with an `id`, `name`, one-line `summary` and `category`. Mark it as `builtIn` (shipped with the firmware; `service` is its name in system status) or give it the opkg `packages` that install it.
2. Give it an icon in `APP_ICON` in `apps/console/src/features/apps/common.tsx`.
3. A built-in app with settings sets `page` to its own page id, added as described above under Apps, Installed in `nav.ts`.
4. A package app gets the generic page `#app-<id>` (`AppPage.tsx`) and a menu entry under Add-ons with no extra code. Describe it in the definition: `service` (its `/etc/init.d` script, for Start/Stop and Start at boot), `fields` (UCI options as `config.section.option`, where the section is a name or a type), `records` (UCI sections to list, like shares), `needsDrive`, `usage` (steps; `{router}` becomes the LAN address) and `comingNext` (what it can't do yet, and why).
5. Add mock handlers so the demo can install it and show its settings: the feed entry and init script in `mock/apps-handlers.ts`, the UCI config in `appConfigs()`.

Packages are installed with opkg-call, which always exits 0 and reports `{code, stdout, stderr}`; `opkgResult` turns a non-zero code into a `RouterError` with opkg's last stderr line, and every install or remove reads the installed list back. Services go through `luci.getInitList` and `luci.setInitAction`, which the stock ACLs allow; procd's `rc` object is used instead when the session may call it, which is also the only way to read whether a service is running.
