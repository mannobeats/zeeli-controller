import { BAND_RADIO, type OwnWifi, SECURITY } from '@zeeli/router-api';
import { bandCategory } from '../../lib/devices.ts';
import { DataTable } from '../../ui/DataTable.tsx';
import { Swatch } from '../../ui/DeviceIcon.tsx';
import { Switch } from '../../ui/fields.tsx';
import { Chip } from '../../ui/Layout.tsx';

const scheduleText = (n: OwnWifi) => (n.schedule?.enabled ? `Off ${n.schedule.off} to ${n.schedule.on}` : '');

interface Props {
  rows: OwnWifi[];
  /** The networks page's names for networks, by id. */
  labels: Record<string, string>;
  busy: boolean;
  onOpen: (n: OwnWifi) => void;
  onSwitch: (list: OwnWifi[], on: boolean) => void;
  onDelete: (list: OwnWifi[]) => void;
}

/** The networks made here, with the same row and bulk-bar patterns as the router’s own groups. */
export function OwnTable({ rows, labels, busy, onOpen, onSwitch, onDelete }: Props) {
  return (
    <DataTable
      label="Custom networks"
      rows={rows}
      rowKey={(n) => n.id}
      onRowClick={onOpen}
      rowClass={(n) => (n.disabled ? 'off' : undefined)}
      bulk={[
        { label: 'Turn on', run: (l) => onSwitch(l, true), when: (l) => l.some((n) => n.disabled) },
        { label: 'Turn off', run: (l) => onSwitch(l, false), when: (l) => l.some((n) => !n.disabled) },
        { label: 'Delete', danger: true, run: onDelete },
      ]}
      columns={[
        {
          key: 'ssid',
          header: 'Name',
          phone: 'title',
          cell: (n) => (
            <span className="name">
              {n.ssid} {n.hidden ? <Chip>Hidden</Chip> : null} {n.scheduledOff ? <Chip tone="off">Scheduled off</Chip> : null}
            </span>
          ),
        },
        {
          key: 'bands',
          header: 'Bands',
          phone: 'sub',
          size: 'lg',
          cell: (n) => (
            <span className="conn">
              {n.bands.map((b) => (
                <span className="conn" key={b}>
                  <Swatch category={bandCategory(b)} />
                  {BAND_RADIO[b]}
                </span>
              ))}
            </span>
          ),
        },
        { key: 'net', header: 'Network', size: 'md', cell: (n) => labels[n.network] ?? n.network },
        { key: 'sec', header: 'Security', size: 'md', cell: (n) => SECURITY[n.security] ?? n.security },
        { key: 'sched', header: 'Schedule', size: 'lg', cell: (n) => scheduleText(n) || <span className="muted">—</span> },
        {
          key: 'on',
          header: 'On',
          align: 'end',
          size: 'sm',
          phone: 'end',
          cell: (n) => (
            // biome-ignore lint/a11y/noStaticElementInteractions: stops the row from opening when the switch is used
            // biome-ignore lint/a11y/useKeyWithClickEvents: the switch inside handles keys itself
            <span onClick={(e) => e.stopPropagation()}>
              <Switch checked={!n.disabled} label={`${n.ssid} on`} onChange={(on) => onSwitch([n], on)} disabled={busy} />
            </span>
          ),
        },
      ]}
    />
  );
}
