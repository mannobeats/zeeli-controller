import { useQuery } from '@tanstack/react-query';
import { type AppState, WAKE_COMMAND } from '@zeeli/router-api';
import { useState } from 'react';
import { useClients } from '../../api/queries.ts';
import { api } from '../../api/router.ts';
import { errorMessage } from '../../lib/errors.ts';
import { Button } from '../../ui/Button.tsx';
import { useFeedback } from '../../ui/feedback.tsx';
import { SelectField } from '../../ui/fields.tsx';
import { Note, Panel } from '../../ui/Layout.tsx';

/** Shown instead of a button the router won't allow yet. */
const NEEDS_PERMISSION = (
  <>
    The router doesn’t let the console run this yet. Install the console with <code className="mono">pnpm deploy:router</code>, which adds
    its permission file.
  </>
);

function useCanRun(command: readonly string[]) {
  return useQuery({ queryKey: ['can-run', command.join(' ')], queryFn: () => api.apps.canRun(command), staleTime: 60_000 }).data;
}

/** An app's one-off command as a button, like starting a speed test server. */
export function RunPanel({ app }: { app: AppState }) {
  const { toast } = useFeedback();
  const [busy, setBusy] = useState(false);
  const allowed = useCanRun(app.run ? [app.run.command, ...app.run.params] : []);
  if (!app.run) return null;
  const { label, title, done } = app.run;
  return (
    <Panel title={title}>
      {allowed === false ? <Note>{NEEDS_PERMISSION}</Note> : null}
      <div className="row-actions start">
        <Button
          variant="strong"
          busy={busy}
          disabled={allowed !== true}
          onClick={async () => {
            setBusy(true);
            try {
              await api.apps.run(app);
              toast(done);
            } catch (err) {
              toast(errorMessage(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          {label}
        </Button>
      </div>
    </Panel>
  );
}

/** Wake a device by picking it from the offline ones the router has seen. */
export function WakePanel() {
  const { toast } = useFeedback();
  const clients = useClients().data ?? [];
  // wired machines are the usual Wake on LAN targets, so they come first
  const asleep = clients
    .filter((c) => !c.online)
    .sort((a, b) => Number(b.link.medium === 'wired') - Number(a.link.medium === 'wired') || a.name.localeCompare(b.name));
  const [mac, setMac] = useState('');
  const [busy, setBusy] = useState(false);
  const allowed = useCanRun([...WAKE_COMMAND, '*']);
  const chosen = mac || asleep[0]?.mac || '';
  const name = clients.find((c) => c.mac === chosen)?.name ?? chosen;
  return (
    <Panel title="Wake a device">
      {allowed === false ? <Note>{NEEDS_PERMISSION}</Note> : null}
      {asleep.length ? (
        <div className="wake-row">
          <SelectField label="Device" value={chosen} options={asleep.map((c) => [c.mac, `${c.name} · ${c.mac}`])} onChange={setMac} />
          <Button
            variant="strong"
            busy={busy}
            disabled={allowed !== true}
            onClick={async () => {
              setBusy(true);
              try {
                await api.apps.wake(chosen);
                toast(`Wake packet sent to ${name}`);
              } catch (err) {
                toast(errorMessage(err));
              } finally {
                setBusy(false);
              }
            }}
          >
            Wake
          </Button>
        </div>
      ) : (
        <Note>No device is asleep right now. Devices the router has seen that are offline show here.</Note>
      )}
    </Panel>
  );
}
