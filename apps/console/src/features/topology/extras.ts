import { type Icon, IconAccessPoint, IconPlug } from '@tabler/icons-react';
import type { Edge, Node } from '@xyflow/react';
import type { MeshMember, PortLink } from '@zeeli/router-api';
import { plural } from '../../lib/format.ts';

/** What the map's core cards (internet, uplink, router, mesh nodes, ports) show. */
export interface CoreData extends Record<string, unknown> {
  kind: 'internet' | 'uplink' | 'router' | 'network' | 'mesh' | 'port';
  title: string;
  sub: string;
  icon: Icon;
}
export type CoreNode = Node<CoreData, 'core'>;

/** Fixed sizes, so fit-to-view and the minimap are right before the DOM is measured. */
export const NODE = { width: 200, height: 44 } as const;
const GAP = 12;
/** Mesh nodes sit under the uplink and ports under the router, below the main row. */
const MESH_X = 260;
const PORT_X = 520;
const BELOW = 90;

const speed = (mbps: number | null) => (mbps ? `${mbps >= 1000 ? `${mbps / 1000} Gb/s` : `${mbps} Mb/s`}` : '');

const slot = (x: number, y: number, i: number) => ({ x, y: y + BELOW + i * (NODE.height + GAP) });

/**
 * Mesh nodes and physical ports, added under the router, and a wire from each port to the wired
 * devices known to sit behind it. `deviceIds` are the device cards on the map, so a device that
 * is hidden (offline) gets no wire.
 */
export function extraGraph(
  router: { x: number; y: number },
  inputs: { mesh: MeshMember[]; ports: PortLink[]; deviceIds: Set<string> },
): { nodes: CoreNode[]; edges: Edge[] } {
  const nodes: CoreNode[] = [];
  const edges: Edge[] = [];
  const add = (id: string, position: { x: number; y: number }, data: CoreData, live: boolean) => {
    nodes.push({ id, type: 'core', ...NODE, position, data });
    edges.push({
      id: `e-r-${id}`,
      source: 'router',
      sourceHandle: 'below',
      target: id,
      animated: live,
      className: `topo-edge${live ? ' live' : ' offline'}`,
    });
  };

  inputs.mesh
    .filter((n) => !n.self)
    .forEach((n, i) => {
      const link =
        n.backhaul === 'wired' ? 'Wired' : n.backhaul === 'wireless' ? `WiFi${n.signal === null ? '' : ` · ${n.signal} dBm`}` : '';
      const sub = [n.online ? link : 'Offline', plural(n.clients, 'client')].filter(Boolean).join(' · ');
      add(`mesh-${n.mac}`, slot(MESH_X, router.y, i), { kind: 'mesh', title: n.name || n.model, sub, icon: IconAccessPoint }, n.online);
    });

  inputs.ports
    .filter((p) => p.link)
    .forEach((p, i) => {
      const sub = [speed(p.speedMbps), p.devices.length ? plural(p.devices.length, 'device') : ''].filter(Boolean).join(' · ');
      const id = `port-${p.name}`;
      add(
        id,
        slot(PORT_X, router.y, i),
        { kind: 'port', title: p.label, sub: p.role === 'wan' ? `Internet · ${sub}` : sub, icon: IconPlug },
        true,
      );
      for (const d of p.devices) {
        const target = `dev-${d.mac}`;
        if (inputs.deviceIds.has(target)) edges.push({ id: `e-${id}-${target}`, source: id, target, className: 'topo-edge live' });
      }
    });

  return { nodes, edges };
}
