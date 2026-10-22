# Contributing

Thanks for helping. This file covers how to set up the repo, what every pull request has to pass, and the conventions the code follows.

## Setup

You need Node 24 (see [`.nvmrc`](.nvmrc)) and pnpm 11 (the exact version is pinned in `package.json` under `packageManager`; `corepack enable` picks it up).

```sh
pnpm install
pnpm dev:demo   # the console against an in-memory demo router, password "demo"
pnpm dev        # the console against a real router (see README for ROUTER_URL)
```

Most work can be done against the demo. If you change how the console talks to the firmware, test it on a real router too, and say which model and firmware version you used in the pull request.

## Gates

Every pull request has to pass:

```sh
pnpm check
```

That runs, in order:

| Command          | What it checks                                             |
| ---------------- | ---------------------------------------------------------- |
| `pnpm lint`      | Biome lint and formatting. `pnpm format` fixes most of it. |
| `pnpm typecheck` | TypeScript across all packages                             |
| `pnpm test`      | Vitest unit tests                                          |
| `pnpm doctor`    | react-doctor checks on the console                         |
| `pnpm fallow`    | Unused code, duplication and dependency hygiene            |
| `pnpm build`     | Production build                                           |

CI runs the same steps. A pull request with a failing gate will not be merged.

## Code style

[Biome](https://biomejs.dev) is the formatter and linter; its configuration is [`biome.json`](biome.json). Don't argue with the formatter, and don't add `biome-ignore` comments without a reason written next to them.

## Conventions

- **Every router call goes through `@zeeli/router-api`.** Components never call `fetch`, build JSON-RPC bodies, or touch a transport directly. If the console needs something new from the router, add it to the matching domain module in `packages/router-api/src/domain/` with typed input and output.
- **Every write is read back.** Settings use a `settings()` get/set pair, or `writeAndVerify` for anything else that can be checked. Don't show "Saved" because the firmware answered "ok"; show it because the router kept the value. Writes from the console go through `useSettings` or `useWrite`, so the affected queries refresh afterwards.
- **The mock keeps up.** When you add a domain call, add a handler for it in `packages/router-api/src/mock/` so the demo and tests can exercise it. For a get/set settings pair, add its initial value in `mock/settings-data.ts`.
- **Design tokens only in CSS.** Colours, spacing, radii, type sizes and shadows come from the custom properties in `apps/console/src/styles/tokens.css`. No raw hex values or one-off pixel sizes in component styles, and no inline styles for things a token covers. [`DESIGN.md`](DESIGN.md) is the design reference.
- **One component per job.** Reuse what is in `apps/console/src/ui/` (`SettingsForm`, `DataTable`, `Sheet`, fields, layout primitives) before writing a new one. A new component should do one thing and have a name that says what.
- **Write for people.** Error messages, labels and notes are plain sentences in sentence case. `RouterError` messages are shown to users as written.
- **Tests sit next to the code** as `*.test.ts`. Pure logic (parsing, form mapping, comparisons) should have tests.

## Pull requests

- Keep each pull request to one change, and explain why it is needed as well as what it does.
- Fill in the pull request template, including how you tested.
- For visible changes, attach before and after screenshots, in light and dark themes.

## Reporting bugs and security issues

Use the issue templates for bugs and feature requests. Report security issues privately as described in [SECURITY.md](SECURITY.md).

By contributing, you agree that your contributions are licensed under the [Apache License 2.0](LICENSE).
