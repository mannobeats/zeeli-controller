import { useQuery } from '@tanstack/react-query';
import type { Client, EthernetPort, PortLink } from '@zeeli/router-api';
import { useAgent, useClients } from '../../api/queries.ts';
import { api } from '../../api/router.ts';
import type { Column } from '../../ui/DataTable.tsx';
import { Chip } from '../../ui/Layout.tsx';

/** Link speed as people say it: 2.5 Gb/s, 100 Mb/s. */
const speedText = (mbps: number) => (mbps >= 1000 ? `${mbps / 1000} Gb/s` : `${mbps} Mb/s`);

/** The agent's view of the ports: link state, and the devices known to sit behind each. */
export interface PortLinks {
  byName: Map<string, PortLink>;
  unplaced: string[];
}

/** Undefined without the agent, so the ports page is then exactly what GL's own settings show. */
export function usePortLinks(): PortLinks | undefined {
  const agent = useAgent().data;
  const status = useQuery({
    queryKey: ['port-status'],
    queryFn: api.safety.ports.status,
    refetchInterval: 10_000,
    enabled: Boolean(agent),
  });
  const clients = useClients().data ?? [];
  const name = (mac: string) => clients.find((c: Client) => c.mac.toUpperCase() === mac)?.name ?? mac;
  if (!agent || !status.data) return undefined;
  return {
    byName: new Map(status.data.ports.map((p) => [p.name, { ...p, devices: p.devices.map((d) => ({ ...d, mac: name(d.mac) })) }])),
    unplaced: status.data.unattributed.map((d) => name(d.mac)),
  };
}

/** Link state, speed and duplex as the hardware reports them, next to the port. */
export const linkColumns = (links?: PortLinks): Column<EthernetPort>[] =>
  links
    ? [
        {
          key: 'link',
          header: 'Link',
          cell: (port) => {
            const p = links.byName.get(port.name);
            if (!p || p.link === null) return <span className="muted">Not reported</span>;
            if (!p.link) return <span className="muted">No cable</span>;
            return (
              <>
                <Chip tone="ok">Connected</Chip> {p.speedMbps ? <span className="num">{speedText(p.speedMbps)}</span> : null}
                {p.duplex ? <span className="muted"> {p.duplex} duplex</span> : null}
              </>
            );
          },
        },
      ]
    : [];

/** The devices seen behind each port. `inferred` ones are placed only because theirs is the one cable on the switch. */
export const deviceColumns = (links?: PortLinks): Column<EthernetPort>[] =>
  links
    ? [
        {
          key: 'devices',
          header: 'Devices',
          cell: (port) => {
            const found = links.byName.get(port.name)?.devices ?? [];
            if (!found.length) return <span className="muted">—</span>;
            return found.map((d) => d.mac).join(', ') + (found.some((d) => d.inferred) ? ' (the only cable on this switch)' : '');
          },
        },
      ]
    : [];
