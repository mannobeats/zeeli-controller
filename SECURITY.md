# Security policy

## Reporting a vulnerability

Please report security issues privately through [GitHub Security Advisories](https://github.com/mannobeats/zeeli-controller/security/advisories/new). Do not open a public issue, pull request or discussion for a vulnerability.

Include what you found, how to reproduce it, the router model and firmware version if it matters, and the impact you expect. We will acknowledge the report within a week, keep you informed while we work on a fix, and credit you in the advisory unless you ask us not to.

## Supported versions

The project is pre-1.0. Fixes go into the latest commit on `main` only.

## Scope

In scope:
- The console in `apps/console`, for example cross-site scripting, injection through router data shown in the interface, or session handling flaws.
- The router API in `packages/router-api`, for example a write that skips verification, unsafe handling of firmware responses, or credential handling.
- The development tooling in `apps/console/dev` and the Vite configuration, where a flaw could affect a developer's machine or router.

Out of scope:
- Vulnerabilities in GL.iNet firmware, OpenWrt, AdGuard Home or other software on the router. Report those to their maintainers. If one interacts with Zeeli Controller in a way that makes it worse, we still want to hear about it.
- Issues that require an attacker who already has admin access to the router.
- The demo mode, which runs entirely in the browser and has no real router behind it.

## How the console handles credentials

- The console is a static web app served from the router's own admin origin. It talks only to that router, through the same endpoints as the stock admin panel. It calls no third-party service and sends no telemetry.
- The admin password is never stored. Sign-in uses the firmware's challenge-response login, so the password is hashed with a router-supplied salt and nonce in the browser, and only that hash is sent. The router returns a session id, which is kept in the same `Admin-Token` cookie the stock panel uses (`SameSite=Strict`, and `Secure` over HTTPS).
- To unlock OpenWrt (LuCI) settings, the password is posted once to the router's LuCI login and then dropped.
- The only thing the console writes to `localStorage` is the theme preference.
