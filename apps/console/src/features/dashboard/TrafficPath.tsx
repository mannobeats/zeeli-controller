import { type Icon, IconCellSignal5, IconDeviceMobile, IconPlugConnected, IconRouter, IconWifi, IconWorld } from '@tabler/icons-react';
import type { Client, RepeaterStatus, RouterStatus } from '@zeeli/router-api';
import { categoryOf, iconFor } from '../../lib/devices.ts';
import { BAND_LABEL, rateText, signal, wireWidth } from '../../lib/format.ts';
import type { Uplinks } from './DashboardPage.tsx';

const KIND_ICON: Record<string, Icon> = { wifi: IconWifi, wired: IconPlugConnected, phone: IconDeviceMobile, cellular: IconCellSignal5 };

interface Props {
  status: RouterStatus;
  hostname: string;
  links: Uplinks;
  rep: RepeaterStatus | null;
  busiest: Client[];
  total: number;
  onDevice: (mac: string) => void;
}

const CORE = { x: 600, y: 140, w: 220, h: 76 };
const DEV_X = 900;
const TOP = 34;

/** The dashboard's signature: the uplink path, line weight = live rate, flow dots moving. */
export function TrafficPath({ status, hostname, links, rep, busiest, total, onDevice }: Props) {
  const shown = busiest.slice(0, 5);
  const rest = busiest.length - shown.length;
  const rows = shown.length + (rest > 0 ? 1 : 0);
  const step = rows > 1 ? (300 - TOP) / (rows - 1) : 0;
  const online = links.active.length > 0;
  const lw = wireWidth(total);
  const UplinkIcon = rep ? IconRouter : (KIND_ICON[links.active[0]?.kind ?? 'wired'] ?? IconPlugConnected);

  const wire = (d: string) => (
    <>
      <path className={`wire${online ? '' : ' idle'}`} d={d} strokeWidth={online ? lw : 1.5} />
      {online ? <path className="flow" d={d} /> : null}
    </>
  );

  return (
    <svg viewBox="0 0 1200 330" aria-labelledby="path-title">
      <title id="path-title">Path from the internet through this router to the busiest devices</title>
      <StandbyLinks links={links} />

      {wire(`M 70 ${CORE.y} L 250 ${CORE.y}`)}
      {wire(`M 330 ${CORE.y} L ${CORE.x - CORE.w / 2} ${CORE.y}`)}
      <rect className="node" x={18} y={CORE.y - 26} width={52} height={52} rx={12} />
      <IconWorld className="ico on" x={34} y={CORE.y - 10} width={20} height={20} stroke={1.75} />
      <text className="t-name" x={18} y={CORE.y + 50}>
        Internet
      </text>
      <rect className="node" x={250} y={CORE.y - 26} width={80} height={52} rx={12} />
      <UplinkIcon className="ico on" x={280} y={CORE.y - 10} width={20} height={20} stroke={1.75} />
      <UplinkLabel rep={rep} name={online ? links.active[0]?.name : 'No uplink'} />

      <rect className="node core" x={CORE.x - CORE.w / 2} y={CORE.y - CORE.h / 2} width={CORE.w} height={CORE.h} rx={12} />
      <IconRouter className="ico on" x={CORE.x - CORE.w / 2 + 16} y={CORE.y - 22} width={20} height={20} stroke={1.75} />
      <text className="t-name" x={CORE.x - CORE.w / 2 + 46} y={CORE.y - 7}>
        {hostname}
      </text>
      <text className="t-mono" x={CORE.x - CORE.w / 2 + 46} y={CORE.y + 12}>
        {status.lanIp}
      </text>
      <text className="t-meta" x={CORE.x - CORE.w / 2 + 16} y={CORE.y + 30}>
        {status.clients.wired} wired · {status.clients.wireless} wireless
      </text>

      {shown.map((c, i) => (
        <DeviceBranch key={c.mac} client={c} y={rows > 1 ? TOP + i * step : CORE.y} onDevice={onDevice} />
      ))}
      {rest > 0 ? (
        <text className="more-row" x={DEV_X + 30} y={TOP + shown.length * step + 4}>
          and {rest} more online
        </text>
      ) : null}
    </svg>
  );
}

/** Standby uplinks, dashed into the router. */
function StandbyLinks({ links }: { links: Uplinks }) {
  return (
    <>
      {links.standby.map((u, i) => {
        const y = 232 + i * 30;
        const I = KIND_ICON[u.kind] ?? IconPlugConnected;
        return (
          <g key={u.id}>
            <path className="standby" d={`M 400 ${y} C 470 ${y}, 520 ${CORE.y + 20}, ${CORE.x - CORE.w / 2} ${CORE.y + 24}`} />
            <I className="ico" x={290} y={y - 10} width={20} height={20} stroke={1.75} />
            <text className="t-dim" x={318} y={y + 4}>
              {u.name}
            </text>
          </g>
        );
      })}
    </>
  );
}

function UplinkLabel({ rep, name }: { rep: RepeaterStatus | null; name: string | undefined }) {
  if (!rep)
    return (
      <text className="t-name" x={250} y={CORE.y + 50}>
        {name}
      </text>
    );
  const sig = signal(rep.signal);
  return (
    <>
      <text className="t-name" x={250} y={CORE.y + 50}>
        Upstream gateway
      </text>
      <text className="t-mono" x={250} y={CORE.y + 67}>
        {rep.gateway}
      </text>
      <text className="t-name" x={350} y={CORE.y - 40}>
        {rep.ssid}
      </text>
      <text className="t-meta" x={350} y={CORE.y - 22}>
        {BAND_LABEL[rep.band] ?? rep.band} · ch {rep.channel}
        {rep.dfs ? ' · DFS' : ''}
      </text>
      <text className={sig.weak ? 't-warn' : 't-ok'} x={350} y={CORE.y + 30}>
        {String(rep.signal).replace('-', '−')} dBm, {sig.word}
      </text>
    </>
  );
}

function DeviceBranch({ client: c, y, onDevice }: { client: Client; y: number; onDevice: (mac: string) => void }) {
  const x0 = CORE.x + CORE.w / 2;
  const d = `M ${x0} ${CORE.y} C ${x0 + 70} ${CORE.y}, ${DEV_X - 110} ${y}, ${DEV_X - 14} ${y}`;
  const r = c.rx + c.tx;
  const idle = r * 8 < 1000;
  const I = iconFor(c);
  return (
    <g>
      <path className={`wire ${idle ? 'idle' : `cat-${categoryOf(c)}`}`} d={d} strokeWidth={idle ? 1.5 : wireWidth(r)} />
      {idle ? null : <path className="flow" d={d} />}
      {/* biome-ignore lint/a11y/useSemanticElements: an SVG group can't be a <button>; role and keys make it one */}
      <g
        className="dev"
        tabIndex={0}
        role="button"
        aria-label={`${c.name}, ${rateText(c.rx)} down`}
        onClick={() => onDevice(c.mac)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onDevice(c.mac);
          }
        }}
      >
        <rect className="hit" x={DEV_X - 10} y={y - 22} width={300} height={44} rx={8} />
      </g>
      <g className="dev-label" aria-hidden>
        <I className="ico on" x={DEV_X} y={y - 10} width={20} height={20} stroke={1.75} />
        <text className="t-name" x={DEV_X + 30} y={y - 3}>
          {c.name.slice(0, 22)}
        </text>
        <text className="t-meta" x={DEV_X + 30} y={y + 14}>
          {c.link.label} · {c.ip}
        </text>
        <text className="t-rate" textAnchor="end" x={DEV_X + 282} y={y - 3}>
          {rateText(c.rx)} ↓
        </text>
        <text className="t-meta" textAnchor="end" x={DEV_X + 282} y={y + 14}>
          {rateText(c.tx)} ↑
        </text>
      </g>
    </g>
  );
}

/** Phones: the same path as a vertical chain. */
export function VerticalPath({ status, hostname, links, rep }: Omit<Props, 'busiest' | 'total' | 'onDevice'>) {
  const sig = signal(rep?.signal);
  const UplinkIcon = rep ? IconWifi : (KIND_ICON[links.active[0]?.kind ?? 'wired'] ?? IconPlugConnected);
  const knot = (I: Icon, core = false) => (
    <div className="dotcol">
      <div className={`knot${core ? ' core' : ''}`}>
        <I size={15} stroke={1.75} />
      </div>
      <div className={`stem${core ? ' thin' : ''}`} />
    </div>
  );
  return (
    <div className="vpath">
      <div className="vchain">
        {knot(IconWorld)}
        <div className="lbl">
          <b>Internet</b>
          {rep ? <span>through {rep.gateway}</span> : null}
        </div>
        <div />
        {knot(UplinkIcon)}
        <div className="lbl">
          {rep ? (
            <>
              <b>{rep.ssid}</b>
              <span>
                {BAND_LABEL[rep.band] ?? rep.band} · ch {rep.channel} ·{' '}
              </span>
              <span className={sig.weak ? 'weak' : 'good'}>
                {String(rep.signal).replace('-', '−')} dBm, {sig.word}
              </span>
            </>
          ) : (
            <b>{links.active[0]?.name ?? 'No uplink'}</b>
          )}
        </div>
        <div />
        {knot(IconRouter, true)}
        <div className="lbl">
          <b>{hostname}</b>
          <span>
            {status.clients.wired} wired · {status.clients.wireless} wireless
          </span>
        </div>
        <div />
      </div>
      {links.standby.length ? <div className="vstandby">Standby: {links.standby.map((u) => u.name).join(', ')}</div> : null}
    </div>
  );
}
