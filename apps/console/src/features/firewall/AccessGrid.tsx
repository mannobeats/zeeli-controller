import { IconChevronDown } from '@tabler/icons-react';
import type { AgentForwarding, AgentZone, ChangeOutcome } from '@zeeli/router-api';
import { useState } from 'react';
import { api } from '../../api/router.ts';
import { errorMessage } from '../../lib/errors.ts';
import { Button } from '../../ui/Button.tsx';
import { Note, Panel } from '../../ui/Layout.tsx';
import { cellKey, changes, currentGrid, type Grid, gridZones, recommendedGrid, zoneColor } from './access.ts';
import { zoneLabel } from './labels.ts';

export type Apply = (done: string, write: () => Promise<{ outcome: ChangeOutcome }>) => Promise<void>;

/** What a cell means, in words, for the tooltip. */
function explain(from: string, to: string, allowed: boolean, replies: boolean) {
  const [a, b] = [zoneLabel(from), zoneLabel(to)];
  if (allowed) return `${a} devices can start connections to ${b} devices. ${b} devices can answer them.`;
  if (replies) return `${a} devices can’t start connections to ${b}, but can answer ones ${b} starts. This is the usual setting for IoT.`;
  return `${a} devices can’t start connections to ${b} devices, and ${b} can’t start any to ${a}.`;
}

function Dot({ zone }: { zone: string }) {
  return (
    <span
      aria-hidden
      style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 5, marginRight: 8, background: zoneColor(zone) }}
    />
  );
}

function Cell({ from, to, grid, onChange }: { from: string; to: string; grid: Grid; onChange: (allow: boolean) => void }) {
  const allowed = grid[cellKey(from, to)] === true;
  const replies = !allowed && grid[cellKey(to, from)] === true;
  return (
    <span className="select" title={explain(from, to, allowed, replies)}>
      <select
        aria-label={`${zoneLabel(from)} to ${zoneLabel(to)}`}
        value={allowed ? 'allow' : 'block'}
        onChange={(e) => onChange(e.target.value === 'allow')}
      >
        <option value="allow">Allowed</option>
        <option value="block">{replies ? 'Replies only' : 'Blocked'}</option>
      </select>
      <IconChevronDown size={14} />
    </span>
  );
}

/** UniFi-style grid: rows start connections, columns receive them. Changes are drafted, then applied in one confirmed change. */
export function AccessGrid({ zones, forwardings, apply }: { zones: AgentZone[]; forwardings: AgentForwarding[]; apply: Apply }) {
  const nets = gridZones(zones);
  const live = currentGrid(nets, forwardings);
  const [draft, setDraft] = useState<Grid | null>(null);
  const [problem, setProblem] = useState('');
  const grid = draft ?? live;
  const pending = changes(live, grid);
  if (nets.length < 2) return null;

  async function save() {
    setProblem('');
    try {
      await apply('Network access updated', () => api.safety.firewall.applyAccess(pending));
    } catch (err) {
      setProblem(errorMessage(err));
      return;
    }
    setDraft(null);
  }

  return (
    <Panel
      title="Network access"
      note="Who may start connections to whom. Replies to a connection always get back, so “Replies only” means: can answer, can’t start."
    >
      <div style={{ overflowX: 'auto' }}>
        <table className="data-table" aria-label="Network access">
          <thead>
            <tr>
              <th scope="col">
                <span className="muted">From ↓ To →</span>
              </th>
              {nets.map((n) => (
                <th scope="col" key={n.name}>
                  <Dot zone={n.name} />
                  {zoneLabel(n.name)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {nets.map((from) => (
              <tr key={from.name}>
                <th scope="row">
                  <Dot zone={from.name} />
                  {zoneLabel(from.name)}
                </th>
                {nets.map((to) => (
                  <td key={to.name}>
                    {to === from ? (
                      <span className="muted" title="Devices on one network always reach each other">
                        n/a
                      </span>
                    ) : (
                      <Cell
                        from={from.name}
                        to={to.name}
                        grid={grid}
                        onChange={(allow) => setDraft({ ...grid, [cellKey(from.name, to.name)]: allow })}
                      />
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {problem ? (
        <p className="kicker" role="alert">
          {problem}
        </p>
      ) : null}
      <div className="row-actions start">
        <Button variant="strong" disabled={!pending.length} onClick={save}>
          {pending.length ? `Apply ${pending.length} ${pending.length === 1 ? 'change' : 'changes'}` : 'Apply changes'}
        </Button>
        <Button disabled={!draft} onClick={() => setDraft(null)}>
          Discard
        </Button>
        <Button onClick={() => setDraft(recommendedGrid(nets))}>Use recommended</Button>
      </div>
      <Note>
        Recommended: Main reaches every network; Guest and IoT start nothing, so IoT devices only answer. Applying keeps the change only if
        this page can still reach the router a moment later. No cell here can cut a network off from the router itself.
      </Note>
    </Panel>
  );
}
