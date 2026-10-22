import { type Icon, IconFocusCentered, IconNetwork, IconRouter, IconSearch, IconWorld } from '@tabler/icons-react';
import {
  Background,
  Controls,
  type Edge,
  Handle,
  MiniMap,
  type Node,
  type NodeProps,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useQuery } from '@tanstack/react-query';
import { type Client, inSubnet, type Network, UPLINKS } from '@zeeli/router-api';
import { memo, useMemo, useState } from 'react';
import { useClients, useInfo, useStatus } from '../../api/queries.ts';
import { api } from '../../api/router.ts';
import { navigate } from '../../app/useHashRoute.ts';
import { CATEGORIES, type Category, categoryOf, iconFor } from '../../lib/devices.ts';
import { plural, rateText } from '../../lib/format.ts';
import { Button } from '../../ui/Button.tsx';
import { Swatch } from '../../ui/DeviceIcon.tsx';
import { PageHeader } from '../../ui/Layout.tsx';
import { absolute, litPath } from './path.ts';

/* ---------- node data ---------- */

interface CoreData extends Record<string, unknown> {
  kind: 'internet' | 'uplink' | 'router' | 'network';
  title: string;
  sub: string;
  icon: Icon;
}
interface DeviceData extends Record<string, unknown> {
  kind: 'device';
  client: Client;
  category: Category;
}
interface NetworkData extends Record<string, unknown> {
  network: Network;
  online: number;
  total: number;
}
type TopoNode = Node<CoreData, 'core'> | Node<NetworkData, 'network'> | Node<DeviceData, 'device'>;

/** 1.5px idle up to 7px at about 100 Mbps, on a log scale so small talkers still show. */
const wireWidth = (bytesPerSec: number) => 1.5 + Math.min(5.5, Math.log10(1 + (bytesPerSec * 8) / 1e5) * 2.75);

/** Fixed sizes, so fit-to-view and the minimap are right before the DOM is measured. */
const NODE = { width: 200, height: 44 } as const;
const GAP = 12;
const PAD = 16;
const HEAD = 52;
/** Devices sit in a grid inside their network; four across keeps a 100-device home readable. */
const PER_ROW = 4;
const NET_X = 760;

const gridSize = (n: number) => {
  const cols = Math.max(2, Math.min(n, PER_ROW));
  const rows = Math.max(1, Math.ceil(n / PER_ROW));
  return { width: PAD * 2 + cols * NODE.width + (cols - 1) * GAP, height: HEAD + PAD + rows * NODE.height + (rows - 1) * GAP };
};

/**
 * Internet → uplink → router on the left; each network is a box on the right holding its
 * devices. The router wires once to each network, as thick as that network's traffic.
 */
function buildGraph(
  clients: Client[],
  networks: Network[],
  host: string,
  lanIp: string,
  uplink: string,
  uplinkSub = 'Active uplink',
): { nodes: TopoNode[]; edges: Edge[] } {
  const nodes: TopoNode[] = [];
  const edges: Edge[] = [];
  const groups = networks
    .filter((n) => n.enabled)
    .map((n) => {
      const devices = clients
        .filter((c) => inSubnet(c.ip, n.ip, n.netmask))
        .sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name));
      return { net: n, devices, size: gridSize(devices.length) };
    });
  const height = groups.reduce((h, g) => h + g.size.height + 24, -24);
  const mid = Math.max(0, height / 2 - NODE.height / 2);
  const core = (id: string, x: number, data: CoreData): TopoNode => ({ id, type: 'core', ...NODE, position: { x, y: mid }, data });

  nodes.push(core('internet', 0, { kind: 'internet', title: 'Internet', sub: '', icon: IconWorld }));
  nodes.push(core('uplink', 260, { kind: 'uplink', title: uplink, sub: uplinkSub, icon: IconNetwork }));
  nodes.push(core('router', 520, { kind: 'router', title: host, sub: lanIp, icon: IconRouter }));
  edges.push({ id: 'e-i-u', source: 'internet', target: 'uplink', animated: true, className: 'topo-edge live' });
  edges.push({ id: 'e-u-r', source: 'uplink', target: 'router', animated: true, className: 'topo-edge live' });

  let y = 0;
  for (const { net, devices, size } of groups) {
    const netId = `net-${net.id}`;
    const online = devices.filter((d) => d.online);
    nodes.push({
      id: netId,
      type: 'network',
      ...size,
      position: { x: NET_X, y },
      data: { network: net, online: online.length, total: devices.length },
    });
    edges.push({
      id: `e-r-${netId}`,
      source: 'router',
      target: netId,
      animated: online.length > 0,
      className: `topo-edge${online.length ? ' live' : ''}`,
      style: { strokeWidth: wireWidth(online.reduce((n, c) => n + c.rx + c.tx, 0)) },
    });
    devices.forEach((c, i) => {
      nodes.push({
        id: `dev-${c.mac}`,
        type: 'device',
        parentId: netId,
        extent: 'parent',
        draggable: false,
        ...NODE,
        position: { x: PAD + (i % PER_ROW) * (NODE.width + GAP), y: HEAD + Math.floor(i / PER_ROW) * (NODE.height + GAP) },
        data: { kind: 'device', client: c, category: categoryOf(c) },
      });
    });
    y += size.height + 24;
  }
  return { nodes, edges };
}

/* ---------- nodes ---------- */

const CoreNode = memo(function CoreNode({ data }: NodeProps<Node<CoreData, 'core'>>) {
  const I = data.icon;
  return (
    <div className={`topo-node core ${data.kind}`}>
      {data.kind === 'internet' ? null : <Handle type="target" position={Position.Left} />}
      <I size={20} stroke={1.75} />
      <div>
        <b>{data.title}</b>
        {data.sub ? <span>{data.sub}</span> : null}
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
});

const DeviceNode = memo(function DeviceNode({ data }: NodeProps<Node<DeviceData, 'device'>>) {
  const c = data.client;
  const I = iconFor(c);
  return (
    <div className={`topo-node device${c.online ? '' : ' offline'}`}>
      <Handle type="target" position={Position.Left} />
      <I size={18} stroke={1.75} />
      <div>
        <b>{c.name}</b>
        <span className="conn">
          <Swatch category={data.category} />
          {c.online ? `${c.link.label} · ${rateText(c.rx)}` : 'Offline'}
        </span>
      </div>
    </div>
  );
});

const NetworkNode = memo(function NetworkNode({ data }: NodeProps<Node<NetworkData, 'network'>>) {
  const n = data.network;
  return (
    <div className="topo-net">
      <Handle type="target" position={Position.Left} />
      <div className="topo-net-head">
        <b>{n.label}</b>
        <span className="num">
          {n.ip}
          {n.vlanId ? ` · VLAN ${n.vlanId}` : ''} · {data.online} of {data.total} online
        </span>
      </div>
      {data.total ? null : <p className="topo-net-empty">No devices on this network</p>}
    </div>
  );
});

const NODE_TYPES = { core: CoreNode, network: NetworkNode, device: DeviceNode };
const FIT = { padding: 0.15 } as const;

/* ---------- page ---------- */

export default function TopologyPage() {
  return (
    <ReactFlowProvider>
      <Topology />
    </ReactFlowProvider>
  );
}

/** The map's data: clients and networks laid out, offline devices only when asked. */
function useGraph(showOffline: boolean) {
  const clientsQuery = useClients();
  const clients = clientsQuery.data ?? [];
  const info = useInfo().data;
  const status = useStatus().data;
  const nets = useQuery({ queryKey: ['networks'], queryFn: api.networks.list });

  const active = UPLINKS.find((u) => status?.uplinks.some((x) => x.interface === u.id && x.up));
  const uplink = active?.name ?? 'No uplink';
  // a repeater uplink is named by the network it joined, like on the dashboard
  const rep = useQuery({ queryKey: ['repeater'], queryFn: api.internet.repeater, enabled: active?.id === 'wwan' }).data;
  const uplinkSub = rep?.connected ? `${rep.ssid}${rep.signal == null ? '' : ` · ${String(rep.signal).replace('-', '−')} dBm`}` : undefined;
  const shown = showOffline ? clients : clients.filter((c) => c.online);
  const graph = useMemo(
    () => buildGraph(shown, nets.data ?? [], info?.hostname ?? 'Router', status?.lanIp ?? '', uplink, uplinkSub),
    [shown, nets.data, info?.hostname, status?.lanIp, uplink, uplinkSub],
  );
  return { clients, nets: nets.data ?? [], graph, ready: Boolean(nets.data && clientsQuery.data) };
}

function Topology() {
  const [focus, setFocus] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [showOffline, setShowOffline] = useState(false);
  const flow = useReactFlow();
  const { clients, nets, graph, ready } = useGraph(showOffline);

  // focus: keep the chosen node's path to the internet lit, dim everything else
  const path = useMemo(() => (focus ? litPath(graph.nodes, graph.edges, focus) : null), [focus, graph]);
  const nodes = path ? graph.nodes.map((n) => ({ ...n, className: path.has(n.id) ? 'lit' : 'dim' })) : graph.nodes;
  const edges = path ? graph.edges.map((e) => ({ ...e, className: `${e.className} ${path.has(e.id) ? 'lit' : 'dim'}` })) : graph.edges;

  const find = (text: string) => {
    setQ(text);
    const needle = text.trim().toLowerCase();
    if (needle.length < 2) return setFocus(null);
    const hit = graph.nodes.find(
      (n) =>
        n.type === 'device' && `${(n.data as DeviceData).client.name} ${(n.data as DeviceData).client.ip}`.toLowerCase().includes(needle),
    );
    if (!hit) return;
    setFocus(hit.id);
    const at = absolute(graph.nodes, hit);
    flow.setCenter(at.x + NODE.width / 2, at.y + NODE.height / 2, { zoom: 1.2, duration: 400 });
  };

  return (
    <>
      <PageHeader
        title="Topology"
        sub={`${plural(clients.filter((c) => c.online).length, 'device')} online across ${plural(nets.filter((n) => n.enabled).length, 'network')}`}
        actions={
          <>
            <label className="ctx-check">
              <input type="checkbox" checked={showOffline} onChange={(e) => setShowOffline(e.target.checked)} />
              Show offline
            </label>
            <label className="search">
              <IconSearch size={16} stroke={1.75} />
              <input
                type="search"
                value={q}
                onChange={(e) => find(e.target.value)}
                placeholder="Find a device"
                aria-label="Find a device on the map"
              />
            </label>
            <Button
              icon={<IconFocusCentered size={16} />}
              onClick={() => {
                setFocus(null);
                setQ('');
                flow.fitView({ ...FIT, duration: 400 });
              }}
            >
              Fit
            </Button>
          </>
        }
      />
      <div className="topo-canvas panel">
        {/* mount once the data is in, so the first fit-to-view frames the whole network */}
        {ready ? <TopologyCanvas nodes={nodes} edges={edges} focus={focus} setFocus={setFocus} /> : null}
      </div>
    </>
  );
}

function TopologyCanvas({
  nodes,
  edges,
  focus,
  setFocus,
}: {
  nodes: TopoNode[];
  edges: Edge[];
  focus: string | null;
  setFocus: (id: string | null) => void;
}) {
  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={NODE_TYPES}
      fitView
      fitViewOptions={FIT}
      minZoom={0.2}
      maxZoom={2}
      nodesConnectable={false}
      proOptions={{ hideAttribution: true }}
      onNodeClick={(_e, n) => setFocus(n.id === focus ? null : n.id)}
      onNodeDoubleClick={(_e, n) =>
        n.type === 'device' && navigate(`clients?device=${encodeURIComponent((n.data as DeviceData).client.mac)}`)
      }
      onPaneClick={() => setFocus(null)}
    >
      <Background gap={24} size={1} />
      <Controls showInteractive={false} className="topo-controls" />
      <Panel position="top-left" className="topo-legend">
        {CATEGORIES.map(([k, l]) => (
          <span className="conn" key={k}>
            <Swatch category={k} />
            {l}
          </span>
        ))}
      </Panel>
      <Panel position="bottom-center" className="topo-hint">
        Click a device to trace its path. Double-click to open it.
      </Panel>
      <MiniMap
        pannable
        zoomable
        className="topo-minimap"
        nodeClassName={(n) => (n.type === 'device' ? `cat-${(n.data as DeviceData).category}` : `mm-${n.type}`)}
      />
    </ReactFlow>
  );
}
