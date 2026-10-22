# Zeeli Controller design system

The console for a router you own. Built with ui-director; every screen is checked against this file.

## Direction

```
App: Zeeli Controller, for the person who owns the router (a family's "network person", a
  homelabber, a small office), checking it daily and changing settings weekly. They open it
  asking: "Is the internet up, through what, and who is using it right now?"
Key object: the link. The path from the internet through an uplink, the router, a network
  (LAN, guest, IoT VLAN) and a radio or port to each device, with its live rate. States:
  active, standby, weak, down; device online, idle, offline, blocked, limited, paused.
Moments: the peak is spotting the device eating the link and limiting it from the same view;
  the core flow ends with a toast that names the change and offers Undo, after the router
  has read the value back; they return to the dashboard.
Needs attention: a down or weak uplink, a blocked or paused device, a setting the router
  refused. Amber for weak, red only for down, blocked, refused and destructive.
Actions: the dashboard has no primary (monitoring). Frequent: open a device, limit, pause,
  block, rename; find anything with Cmd+K. Rare: reboot, firmware, operating mode.
  Destructive: forget, delete a network, factory reset, always confirmed and named.
Density: standard to dense, because the owner wants every number in one place (UniFi-like).
Shell: top bar + icon rail + section panel, because there are ten sections people move
  between and the content needs the width. Phones get a bottom tab bar and a menu drawer.
Obvious version: "Welcome back", four stat cards with icon circles and green % pills,
  a gradient area chart, a device table with a status badge on every row, everything in
  cards, a colored sidebar, a top bar with a tab that repeats the section name.
Three directions, each from one thing in the owner's world:
  A. The patch cable: the live path internet > uplink > router > devices, line weight is
     the live rate, standby uplinks dashed; the same path is the topology canvas.
     / graphite, one signal blue, band hues / Geist + Geist Mono for addresses.
  B. The front panel: the router's ports and radios as a lit strip. / graphite / Geist.
  C. The spectrum: 2.4 / 5 / 6 GHz as bands with clients placed on channels. / Geist.
Pick: A, because the router's whole state is "which uplink, how good, who is using it",
  and the path scales from the dashboard to a 100-device canvas without a new idea.
Signature: the live path. On the dashboard it's a flow diagram whose wires are as thick
  as the traffic; on Topology it's a zoomable canvas of the same path; and the top bar
  always carries the live down/up rate, so the link is never more than a glance away.
Palette: graphite neutrals (Zeeli's 6% frame, 9% canvas, 92% ink), one signal blue
  (#006fff light, #459bf7 dark) for primary actions, links, toggles and live wires. Band
  hues at equal lightness: wired blue, 2.4 GHz amber, 5 GHz teal, 6 GHz violet, MLO pink.
  Green = up/running, amber = weak, red = down/blocked/destructive, grey = standby/off.
Type: Geist (neutral, tabular numerals, ships variable), Geist Mono only for IPs, MACs
  and keys. App scale 12 / 13 / 14 / 16 / 20 / 24, 32 for the live rate.
First screen: online through Ethernet 1 at 72.9 / 13.5 Mbps, and the path from the internet
  through the router to the five busiest devices, drawn at their live rates.
```

## Shell rules

- Top bar, left to right: the Zeeli mark centred over the rail; the router (hostname, model)
  as the account switcher; the uplink state in words ("Online via Ethernet 1"); then, right,
  the live rate, search (Cmd+K), theme, account menu. No section tab: the rail and the page
  title already say where you are.
- The router name in the top bar starts on the same vertical line as the section panel's
  items, on every page, with or without the panel.
- Rail icons are muted; the current one gets the selection fill. In dark mode selection is
  ink on a 12% ink wash, never blue. Blue is a signal, not a location.
- Page title (20/600) once, with at most one short context line. Primary action sits in
  the page header, never also in the top bar.

## Surfaces

- Canvas `--bg`; panels `--panel` with a 1px `--line` and 12px radius; floating layers
  (sheets, dialogs, menus, palette) `--surface` with `--shadow-lg`. Never a panel in a panel;
  inside a sheet, fields group in `.group` insets.
- Panel heading row is 32px: title left (14/600), a note and actions right.
- Tables sit flush with the panel edges; numbers right-aligned and tabular; IDs in mono.
- Rows: 40px desktop, two-line rows on phones.

## Page layout

- `.page` is a two-column grid with one 16px gap. That gap is the only space between page
  blocks: no margins on panels, headers or notices.
- Everything spans both columns except settings forms (`SettingsForm`), which pair up two per
  row, so a form is never wider than half the page and its fields, switches and Save button
  share the panel's edges. Below 1100px they stack.
- `.section-gap` is `display: contents`: wrapping panels in it never adds space of its own.
- A section can give its panel to the page (`panel: true` in `nav.ts`); the page renders its
  controls through `SectionPanel`, which falls back to inline on narrow screens. Clients uses
  this for its filters.

## Controls

- Heights: 28 (small, toolbars), 32 (default), 44 (touch, sign-in).
- Radius: 6 controls, 8 rows and menus, 12 panels and sheets.
- Buttons: `primary` (blue, one per view), `default` (outlined), `ghost`, `danger` (red,
  names the action). No arrows or icons that repeat the label.
- Chips only for a state that needs action or a fixed category; never a dot in a chip.
- Band swatches (10px rounded squares, 8px on topology cards) mark the connection category
  everywhere it appears. Never a coloured border or stripe on a card.
- Checkboxes and radios are drawn with the tokens (one style, 16px); toggle chips (`ChipPicker`)
  show selection with the selection fill plus a full border, so the state reads in both themes.
- Multi-line fields use `TextArea`; the box draws the border and grows with its rows.
- On/off settings are `SwitchRow`s: label left, switch on the panel's right edge.

## Motion

- Controls 140ms; sheets and menus 220ms ease-out; app screens appear at once.
- The live wires carry a slow dash flow; it stops under reduced motion.

## Tokens

Source: `apps/console/src/styles/tokens.css`. Components never use raw colors, sizes or
shadows. Dark mode is designed (Zeeli palette), not inverted.

## Done means

Looked at in a browser at 1440 and 390 wide, light and dark, every control once.
