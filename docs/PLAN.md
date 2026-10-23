# Zeeli Controller: the next plan

The goal: someone used to UniFi or MikroTik can run their family's network from Zeeli and never feel boxed in. Everything the hardware can do should be reachable, but the default screens stay simple.

This plan is based on a full inventory of the console (47 pages) and a read-only survey of the GL-BE9300 we test on (GL firmware 4.10.1, OpenWrt 23.05, kernel 5.4).

## 1. Where we are

The console talks to the router three ways:

| Backend                              | Used for                                                                                                      | Problem                                                                                |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| GL.iNet's `/rpc` API                 | About 85% of the console: WiFi, networks, clients, VPN, DNS, parental control, QoS, multi-WAN, mesh, firmware | It is shaped around GL's own screens: fixed slots, on/off switches, short fixed lists  |
| OpenWrt ubus/UCI through LuCI        | Firewall rules, routing, DHCP leases, family pause, packages, add-ons                                         | Needs the "Advanced unlock" second sign-in, and LuCI's permissions block most commands |
| `file.exec` with our permission file | iperf3, Wake on LAN, console updates                                                                          | Every new command needs a new permission line                                          |

Most of the console's limits come from GL's API, not from the hardware:
- **WiFi**: one network per band in each of main, guest and IoT, plus MLO. Networks can't be added or deleted, and can't be attached to a custom network.
- **Networks**: Main, Guest and IoT can't be removed; internet access has three modes.
- **Clients**: a fixed list of 15 device types, and blocking only works in block-list mode.
- **QoS**: 8 fixed categories with 3 levels; parental control has 6 fixed categories; the content filter has 8.
- **VPN**: tunnels can't be edited or paused; groups can't be deleted; ZeroTier joins one network only.
- **Mesh**: you can add nodes, but not list or remove them.
- **History**: traffic resets on reboot, and only hour, day and week views exist.
- **Firewall**: zones are read-only, and rules can't be reordered.
- **Display only**: operating mode, cellular, tethering, Samba shares, multi-WAN health checks.

## 2. What the hardware can do

| Area              | The GL-BE9300 has                                                                                                                                                                                                                                  | Zeeli uses today                         |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| CPU and storage   | Qualcomm IPQ5332, 3 cores, 1 GB RAM, 6.7 GB free flash                                                                                                                                                                                             | Nothing stored                           |
| WiFi              | Wi-Fi 7 on 3 radios: 2.4 GHz (40 MHz), 5 GHz (up to 160 MHz), 6 GHz (320 MHz). Up to 17 networks per radio; 5 or 6 in use. MLO across all three bands. 802.11k/v already on; 802.11r, band steering and per-network client isolation are available | Fixed GL slots                           |
| Ports             | 2.5G WAN plus 4 LAN ports on a VLAN-capable switch (RTL8372N). LAN1 can be a second WAN. Tagged and untagged VLANs per port                                                                                                                        | Per-port role, untagged VLAN and trunk   |
| Routing and NAT   | Qualcomm NSS hardware acceleration, nftables firewall (fw4), policy routing, bonding, GRE, VXLAN, L2TP, MAP-T, macsec                                                                                                                              | Static routes and a firewall rule editor |
| Multi-WAN         | Failover or load balancing over Ethernet, WiFi repeater, USB tethering and cellular                                                                                                                                                                | Mode, order, weights                     |
| Traffic awareness | Netify per-app detection, GL DPI, flow statistics, conntrack                                                                                                                                                                                       | Top apps, per-device totals              |
| Shaping           | SQM with CAKE or fq_codel, HTB, per-client speed limits, DPI-based QoS                                                                                                                                                                             | On/off and fixed categories              |
| VPN               | WireGuard and OpenVPN clients and servers, Tailscale, ZeroTier, Tor, IPsec kernel support                                                                                                                                                          | Most of it, inside GL's shapes           |
| DNS               | AdGuard Home, dnsmasq-full, DNS over HTTPS/TLS (stubby, dnscrypt-proxy)                                                                                                                                                                            | Most of it                               |
| Mesh              | EasyMesh (prplMesh) and GL mesh                                                                                                                                                                                                                    | Turn on, add nodes                       |
| USB               | USB 3 storage (Samba, WebDAV, FTP, DLNA), modems and tethering                                                                                                                                                                                     | Add-ons                                  |
| Extensibility     | `rpcd-mod-ucode` and ucode with ubus, uci and fs modules                                                                                                                                                                                           | Not used                                 |

The last row matters most. **The router can run our own API without a new daemon.** A ucode script in `/usr/share/rpcd/ucode/` becomes a `zeeli` object on the router's bus, protected by its own permission file. The same API can later run on our own firmware.

## 3. The core change: a Zeeli agent on the router

Today the console has to take whatever GL's API offers. Instead, ship a small agent with every release:
- **`zeeli` ubus API** (`/usr/share/rpcd/ucode/zeeli.uc`): our own calls, shaped around Zeeli's model rather than GL's screens, such as `zeeli.wifi.list/create/update/delete`, `zeeli.networks.*`, `zeeli.clients.*` and `zeeli.stats.*`. Behind it, the agent writes UCI and reloads the affected service the way OpenWrt expects. One permission file grants the admin session access to `zeeli.*`, so pages no longer need the Advanced unlock or one-off `file.exec` lines.
- **Collector** (a small procd service): every minute it records bytes per client, per WAN and per network, plus events (joins, leaves, WAN failover, blocks). That gives real history: 24 hours at 1-minute detail, 30 days hourly, 12 months daily, kept in RAM and saved to flash every 15 minutes. On this router that is a few MB at most.
- **Shipped and updated like the console**: the release package gains `agent/`, and `zeeli-update` installs it. The console checks the agent's version and offers to update it.

Ownership moves step by step:
- **GL's API stays** where it already does the job well: VPN providers, AdGuard settings, DPI signatures, firmware.
- **The agent takes over** where GL's shapes are the limit: WiFi, networks, port profiles, client groups, policies and history.
- **The firmware step**: on our own firmware the agent keeps the same `zeeli` API with no GL underneath, so the console doesn't change.

The risk is GL's own scripts. Today, GL's `wifi.set_config`, `vlan_subnet` and the GL panel rewrite their own UCI sections. They have to treat ours as unknown sections. Before the agent writes anything in an area, we test on the router what GL's scripts do to sections they didn't create, and document the result in the agent. Where GL fights us, the agent goes through GL's API for that piece.

## 4. The model: how UniFi thinks, and how Zeeli will

UniFi feels powerful because a few objects connect to each other everywhere. Zeeli adopts the same model:

| Object           | What it is                                                                                                                                                                                                                   | Connects to                                            |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| **Network**      | A segment with its own subnet, VLAN, DHCP, DNS and internet rules: Main, Guest, IoT, Kids, Cameras, Work and any you add                                                                                                     | WiFi networks, ports, policies                         |
| **WiFi network** | A name and password on any bands, attached to one network                                                                                                                                                                    | One network; a schedule; client limits                 |
| **Port profile** | What a port carries: one network untagged, others tagged, or everything                                                                                                                                                      | Ports                                                  |
| **Client**       | A device, with a name, type, icon, owner, reserved address and limits                                                                                                                                                        | Groups; policies                                       |
| **Group**        | People and their devices ("Kids", "Mum's devices"), or any set of devices                                                                                                                                                    | Policies, schedules, reports                           |
| **Policy**       | One rule in plain words: who (client, group or network), what (internet, a site, an app, a category, another network), when (always or a schedule), and the action (allow, block, limit speed, route through a VPN or a WAN) | Firewall, DPI, routing, QoS, all compiled by the agent |
| **Device**       | Hardware Zeeli manages: this router; later mesh nodes, other OpenWrt access points and switches                                                                                                                              | Topology, firmware, ports                              |

Policy is the big one. Today blocking, parental control, access control, firewall rules, VPN routing and speed limits are separate pages, each with its own shape. UniFi folds most of these into one "Traffic & Policy" area. Zeeli gets a **Policies** page that writes to all of these back ends. The expert pages (raw firewall, routes) stay under Advanced for people who want them.

## 5. Feature map

The columns:
- **Today**: what Zeeli does now.
- **Plan**: what Zeeli will do.
- **How**: the mechanism. "Agent" means the Zeeli agent from section 3, and "GL" means GL's `/rpc` API.

### Networks and WiFi

| Feature                                                    | UniFi / MikroTik                                                                                                                        | Today                         | Plan                                                                                                  | How                                                |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Create WiFi networks                                       | Any number, any bands                                                                                                                   | Fixed GL slots                | Add, edit, delete; pick bands, network, security, hidden. Up to 16 per radio                          | Agent: `wireless` wifi-iface sections              |
| WiFi on any network (SSID to VLAN)                         | Yes                                                                                                                                     | Main, Guest, IoT only         | Any network                                                                                           | Agent sets `network=` on the iface                 |
| Per-network WiFi options                                   | Client isolation, max clients, band steering, 802.11r fast roaming, PMF, WPA2/WPA3 transition, minimum data rate, multicast enhancement | Security, password, hidden    | All of these, behind "Advanced" in the sheet                                                          | Agent, from options the driver already exposes     |
| WiFi schedules                                             | Per network                                                                                                                             | Main network per band only    | Per WiFi network ("Kids WiFi off 22:00–07:00")                                                        | Agent and cron                                     |
| Private keys (one password per device or group, same name) | UniFi PPSK                                                                                                                              | —                             | Investigate; depends on the Qualcomm driver's SAE/PSK file support                                    | Later                                              |
| Radio control                                              | Channel, width, power, DFS, minimum RSSI                                                                                                | Through the main network only | A Radios panel: channel and width per radio, channel scan with neighbour networks, interference score | GL `wifi` get_acs_state and set_htmode, plus agent |
| Networks                                                   | Unlimited, with VLAN, DHCP options, DNS, isolation, multicast DNS                                                                       | Custom networks through GL    | Keep GL, and add DHCP options, multicast DNS between networks and per-network DNS filtering           | GL `vlan_subnet` plus agent                        |
| Port profiles                                              | Yes                                                                                                                                     | Per-port VLAN                 | Profiles applied to ports; a port view with link speed and connected device                           | GL `cable` plus agent                              |
| Topology                                                   | Full map with switches and APs                                                                                                          | One router                    | Add mesh nodes, the switch ports and wired devices behind each port                                   | Agent: bridge FDB, mesh status                     |

### Clients and policy

| Feature                  | UniFi / MikroTik                                        | Today                                       | Plan                                                                                                                         | How                                              |
| ------------------------ | ------------------------------------------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Client details           | Name, icon, fingerprint, history, signal, roaming, apps | Name, type, speed limit, reservation        | Device fingerprint (vendor and type from DHCP and DPI), connection history, signal over time, top apps, a "what changed" log | Agent collector and Netify                       |
| Groups                   | Yes                                                     | —                                           | Groups of devices or people, usable in every policy                                                                          | Agent stores them in UCI `zeeli`                 |
| Policies                 | Traffic rules                                           | Five separate pages                         | One Policies page: who, what, when, action                                                                                   | Agent compiles to fw4, DPI, QoS and route_policy |
| Block or pause           | Yes                                                     | Block list; pause needs the Advanced unlock | One click, any device or group, with a timer                                                                                 | Agent                                            |
| Speed limits             | Per client or group                                     | Per client                                  | Per client, group or network                                                                                                 | Agent: tc/HTB; GL QoS as fallback                |
| Route through VPN or WAN | Policy-based routing                                    | Tunnel rules through GL                     | A policy action: "route Kids' TV through the UK VPN"                                                                         | GL `route_policy`, later the agent               |
| Family reports           | —                                                       | —                                           | Weekly per-person usage: time online, top apps, blocked attempts                                                             | Agent collector                                  |

### Internet, routing and security

| Feature                       | UniFi / MikroTik                       | Today                         | Plan                                                                          | How                                   |
| ----------------------------- | -------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------- | ------------------------------------- |
| Multi-WAN                     | Failover, load balance, per-policy WAN | Mode, order, weights          | Plus health-check targets, WAN health history and per-policy WAN choice       | GL `kmwan` plus agent                 |
| WAN health                    | Latency, loss, outages                 | Up/down                       | A latency and loss graph per WAN, an outage log and ISP speed tests           | Agent collector (ping and iperf)      |
| Firewall                      | Zones, rules, order, groups            | Rules, zones read-only        | Zones editable; rules reordered by dragging; address and port groups          | Agent: fw4 UCI with rollback          |
| Intrusion and threat blocking | IPS/IDS, country blocking              | —                             | Country and threat-list blocking with banIP; a log of blocked attempts        | banIP package; agent reads its report |
| Remote access                 | Teleport, WireGuard                    | WG/OpenVPN servers, Tailscale | Add "Invite a device": a QR code for a WireGuard peer in one step             | GL `wg-server`                        |
| DNS                           | Content filtering, per-network         | AdGuard and GL DNS            | Per-network or per-group filtering profiles; custom block lists; DNS rewrites | AdGuard clients and settings API      |

### System and devices

| Feature                   | UniFi / MikroTik                    | Today         | Plan                                                                                                               | How                                      |
| ------------------------- | ----------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------- |
| History and stats         | 1 year                              | Since boot    | 24 h / 30 d / 12 mo for WAN, networks, clients and apps                                                            | Agent collector                          |
| Alerts                    | Push, email                         | —             | New device joined, WAN down, firmware out, high temperature; shown in the console, optionally push (ntfy) or email | Agent                                    |
| Backup and restore        | Yes                                 | —             | Download and restore the whole configuration, with automatic snapshots before risky changes                        | Agent: `sysupgrade -b` and UCI snapshots |
| Draft changes             | Review before applying              | Instant apply | A pending-changes tray: review, apply all, roll back                                                               | Agent with uci staging and rollback      |
| Mesh                      | Adopt, list, remove, per-node stats | Add only      | List nodes, signal and backhaul, remove, reboot, upgrade                                                           | GL `mesh` plus prplMesh data             |
| Multiple routers or sites | Yes                                 | One router    | Later: one console managing several Zeeli routers                                                                  | After the firmware work                  |
| Hardware                  | CPU, temperature, ports             | Facts and fan | Port speeds and errors, CPU and RAM history, thermal history                                                       | Agent collector                          |

## 6. Order of work

Each phase ships as releases, with every gate passing and tests on the real router.
1. **The agent foundation**
   - The `zeeli` ucode API, its permission file, an agent version check and install through `zeeli-update`
   - A test harness: the agent runs against a copy of `/etc/config` on the computer through ucode, plus the real router
   - A study of how GL's scripts treat our sections in `wireless`, `network`, `firewall` and `dhcp`
2. **WiFi and networks, fully open**
   - Create, edit and delete WiFi networks on any bands, attached to any network
   - Advanced WiFi options and per-network schedules
   - A Radios panel with channel scan
   - The **Add network** button on the WiFi page that you asked for
3. **History and insight**
   - Collector and storage
   - Client details with history
   - WAN health graphs
   - Long-range traffic views
   - Alerts in the console
4. **Groups and Policies**
   - Device groups
   - The Policies page, compiling to firewall, DPI, QoS and routing
   - Pause with a timer; family reports
5. **Safety and control**
   - Draft changes with review and rollback
   - Backup and restore with automatic snapshots
   - Firewall zones and rule order
   - Port profiles and the port view
6. **Mesh and devices**
   - Mesh node list and management
   - Topology with switch ports
   - Wired devices behind ports
7. **Own firmware**
   - An OpenWrt build for the GL-BE9300 with the agent and console built in
   - The same `zeeli` API, without GL's packages

Phases 1 and 2 come first because every later phase builds on the agent. Phase 2 is also the limit you hit today.

## 7. Risks and limits to keep in mind

- **The Qualcomm WiFi driver** (`qcawificfg80211`) is not the standard OpenWrt one. Most standard options work, but each advanced option must be tested on the router before it appears in the console. Private per-device keys may not be possible.
- **Hardware acceleration and per-device features conflict.** NSS acceleration bypasses the parts of the kernel that count and shape traffic. Per-device limits, SQM and some statistics need it off or partly off. The console must say so when you turn such a feature on, as it already does on the NAT page.
- **GL firmware upgrades** may reset GL's own sections. The agent stores Zeeli's own state in `/etc/config/zeeli` and re-applies it after an upgrade.
- **Flash wear.** History is kept in RAM and written every 15 minutes, so writes stay small. The router has 6.7 GB free.
