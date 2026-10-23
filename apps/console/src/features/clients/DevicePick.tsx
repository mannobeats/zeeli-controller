import { IconSearch } from '@tabler/icons-react';
import type { Client } from '@zeeli/router-api';
import { useState } from 'react';
import { DeviceIcon } from '../../ui/DeviceIcon.tsx';

interface Props {
  clients: Client[];
  /** MAC addresses ticked. */
  value: string[];
  onChange: (macs: string[]) => void;
  /** Devices that can't be ticked here, by MAC, with the name of what holds them. */
  taken?: Map<string, string>;
}

/** A searchable list of devices to tick, online first: for profiles, groups and policies. */
export function DevicePick({ clients, value, onChange, taken }: Props) {
  const [q, setQ] = useState('');
  const picked = new Set(value);
  const needle = q.trim().toLowerCase();
  const devices = [...clients]
    .sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name))
    .filter((d) => !needle || `${d.name} ${d.ip} ${d.mac}`.toLowerCase().includes(needle));
  return (
    <>
      <label className="search">
        <IconSearch size={16} stroke={1.75} />
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a device" aria-label="Find a device" />
      </label>
      <div className="dev-pick">
        {devices.map((d) => {
          const other = taken?.get(d.mac);
          return (
            <label key={d.mac} className={`pick${other ? ' taken' : ''}`}>
              <input
                type="checkbox"
                checked={picked.has(d.mac)}
                disabled={Boolean(other)}
                onChange={(e) => onChange(e.target.checked ? [...value, d.mac] : value.filter((m) => m !== d.mac))}
              />
              <span className={`mark${d.online ? ' ok' : ''}`} />
              <DeviceIcon client={d} />
              <span className="pick-name">{d.name}</span>
              <span className="pick-sub">{other ? `In ${other}` : d.ip}</span>
            </label>
          );
        })}
      </div>
    </>
  );
}
