import { type Icon, IconAccessPoint } from '@tabler/icons-react';
import type { Edge, Node } from '@xyflow/react';
import type { MeshMember, PortLink } from '@zeeli/router-api';
import { plural } from '../../lib/format.ts';

/** One physical port in the router card's back panel. */
export interface RouterPort {
  label: string;
  up: boolean;
  /** "2.5 Gb/s · 3 devices", for its tooltip. */
  detail: string;
}

/** What the map's core cards (internet, uplink, router, mesh nodes) show. */
export interface CoreData extends Record<string, unknown> {
  kind: 'internet' | 'uplink' | 'router' | 'mesh';
  title: string;
  sub: string;
  icon: Icon;
  /** The router's ports, drawn inside its card rather than as cards of their own. */
  ports?: RouterPort[];
}
export type CoreNode = Node<CoreData, 'core'>;

/** Fixed sizes, so fit-to-view and the minimap are right before the DOM is measured. */
export const NODE = { width: 200, height: 44 } as const;
/** The router card is taller when it shows its ports. */
export const ROUTER_WITH_PORTS = { width: 240, height: 70 } as const;
const GAP = 12;
const BELOW = 90;

const speed = (mbps: number | null) => (mbps ? `${mbps >= 1000 ? `${mbps / 1000} Gb/s` : `${mbps} Mb/s`}` : '');

/** The back panel: every port, lit when a cable is in. */
export const routerPorts = (ports: PortLink[]): RouterPort[] =>
  ports.map((p) => ({
    label: p.label,
    up: p.link === true,
    detail: p.link
      ? [p.role === 'wan' ? 'Internet' : '', speed(p.speedMbps), p.devices.length ? plural(p.devices.length, 'device') : '']
          .filter(Boolean)
          .join(' · ')
      : 'No cable',
  }));

/** Which LAN port each wired device sits behind, where the router can tell. */
export function portOf(ports: PortLink[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const p of ports) if (p.role === 'lan' && p.link) for (const d of p.devices) map.set(d.mac, p.label);
  return map;
}

/**
 * Mesh nodes, in a column under the router with one wire each. Devices behind a port get no wire
 * of their own: the port shows in their card, which keeps the map readable as it grows.
 */
export function meshGraph(router: { x: number; y: number; height: number }, mesh: MeshMember[]): { nodes: CoreNode[]; edges: Edge[] } {
  const nodes: CoreNode[] = [];
  const edges: Edge[] = [];
  mesh
    .filter((n) => !n.self)
    .forEach((n, i) => {
      const link =
        n.backhaul === 'wired' ? 'Wired' : n.backhaul === 'wireless' ? `WiFi${n.signal === null ? '' : ` · ${n.signal} dBm`}` : '';
      const id = `mesh-${n.mac}`;
      nodes.push({
        id,
        type: 'core',
        ...NODE,
        position: { x: router.x, y: router.y + router.height + BELOW - NODE.height + i * (NODE.height + GAP) },
        data: {
          kind: 'mesh',
          title: n.name || n.model,
          sub: [n.online ? link : 'Offline', plural(n.clients, 'client')].filter(Boolean).join(' · '),
          icon: IconAccessPoint,
        },
      });
      edges.push({
        id: `e-r-${id}`,
        source: 'router',
        sourceHandle: 'below',
        target: id,
        type: 'smoothstep',
        animated: n.online,
        className: `topo-edge${n.online ? ' live' : ' offline'}`,
      });
    });
  return { nodes, edges };
}
