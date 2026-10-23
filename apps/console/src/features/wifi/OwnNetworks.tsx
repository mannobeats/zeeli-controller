import { useQuery } from '@tanstack/react-query';
import { isOwn, type OwnWifi } from '@zeeli/router-api';
import { useState } from 'react';
import { useWrite } from '../../api/queries.ts';
import { api } from '../../api/router.ts';
import { navigate } from '../../app/useHashRoute.ts';
import { errorMessage } from '../../lib/errors.ts';
import { plural } from '../../lib/format.ts';
import { Button } from '../../ui/Button.tsx';
import { useFeedback } from '../../ui/feedback.tsx';
import { Empty, Panel } from '../../ui/Layout.tsx';
import { OwnNetworkSheet } from './OwnNetworkSheet.tsx';
import { OwnTable } from './OwnTable.tsx';

/** The agent's version: undefined while asking, null on a router that doesn't have it. */
export const useAgent = () => useQuery({ queryKey: ['agent-version'], queryFn: api.agent.version, staleTime: 60_000 }).data;

const nameOf = (list: OwnWifi[]) => (list.length === 1 ? `“${list[0]?.ssid}”` : plural(list.length, 'network'));

/** Switch, delete and apply, each followed by one WiFi reload for the whole batch. */
function useOwnActions() {
  const { toast, confirm } = useFeedback();
  const toggle = useWrite(
    async ({ list, on }: { list: OwnWifi[]; on: boolean }) => {
      await Promise.all(list.map((n) => api.wifiNetworks.setEnabled(n.id, on)));
      await api.wifiNetworks.apply();
    },
    [['wifi-networks'], ['status']],
  );
  const remove = useWrite(
    async (list: OwnWifi[]) => {
      await Promise.all(list.map((n) => api.wifiNetworks.remove(n.id)));
      await api.wifiNetworks.apply();
    },
    [['wifi-networks'], ['wifi'], ['status']],
  );
  const apply = useWrite(() => api.wifiNetworks.apply(), [['wifi-networks'], ['status']]);

  async function setOn(list: OwnWifi[], on: boolean) {
    const sure =
      on ||
      (await confirm({
        title: `Turn off ${nameOf(list)}?`,
        body: 'Devices on it disconnect. If you’re on one of them, you lose this page until you reconnect another way.',
        confirm: 'Turn off',
      }));
    if (!sure) return;
    try {
      await toggle.mutateAsync({ list, on });
      toast(`${nameOf(list)} turned ${on ? 'on. Devices can join in a few seconds' : 'off'}.`);
    } catch (err) {
      toast(`Couldn’t change WiFi: ${errorMessage(err)}`);
    }
  }

  async function removeAll(list: OwnWifi[]) {
    const ok = await confirm({
      title: `Delete ${nameOf(list)}?`,
      body: 'Devices on them disconnect and their passwords are forgotten. This can’t be undone.',
      confirm: 'Delete',
    });
    if (!ok) return;
    try {
      await remove.mutateAsync(list);
      toast(`Deleted ${nameOf(list)}`);
    } catch (err) {
      toast(`Couldn’t delete: ${errorMessage(err)}`);
    }
  }

  async function applyNow() {
    try {
      await apply.mutateAsync(undefined);
      toast('WiFi reloaded. Devices on changed networks reconnect in a few seconds.');
    } catch (err) {
      toast(`Couldn’t reload WiFi: ${errorMessage(err)}`);
    }
  }

  return { setOn, removeAll, applyNow, busy: toggle.isPending, applying: apply.isPending };
}

/** Networks made here (not the router’s own slots): the table, the add and edit sheet, bulk actions. */
export function OwnNetworks({ adding, onAddClosed }: { adding: boolean; onAddClosed: () => void }) {
  const agent = useAgent();
  const overview = useQuery({ queryKey: ['wifi-networks'], queryFn: api.wifiNetworks.overview, enabled: Boolean(agent) });
  const networks = useQuery({ queryKey: ['networks'], queryFn: api.networks.list, staleTime: 30_000 });
  const [editing, setEditing] = useState<OwnWifi | null>(null);
  const actions = useOwnActions();

  if (agent === null) return <NoAgent />;
  const data = overview.data;
  if (!data) return null;
  const mine = data.networks.filter(isOwn);
  const labels = Object.fromEntries((networks.data ?? []).map((n) => [n.id, n.label]));

  return (
    <>
      {data.pending ? (
        <div className="panel notice">
          Some changes are saved but not on the radios yet. Devices on those networks reconnect briefly when you apply them.{' '}
          <Button variant="strong" busy={actions.applying} onClick={actions.applyNow}>
            Apply now
          </Button>
        </div>
      ) : null}
      <Panel className="section" title="Custom networks" note="Made here, on any bands and any network">
        {mine.length ? (
          <OwnTable
            rows={mine}
            labels={labels}
            busy={actions.busy}
            onOpen={setEditing}
            onSwitch={actions.setOn}
            onDelete={actions.removeAll}
          />
        ) : (
          <Empty>No custom networks yet. Add one for the kids, a workshop or visitors, on the bands and network you choose.</Empty>
        )}
      </Panel>
      {editing || adding ? (
        <OwnNetworkSheet
          key={editing?.id ?? 'new'}
          network={editing}
          overview={data}
          labels={labels}
          onClose={() => {
            setEditing(null);
            onAddClosed();
          }}
        />
      ) : null}
    </>
  );
}

function NoAgent() {
  return (
    <div className="panel notice">
      Your own WiFi networks need Zeeli’s agent on the router, and this router doesn’t have it yet. Updating the console installs it.{' '}
      <button type="button" className="link" onClick={() => navigate('firmware')}>
        Go to updates
      </button>
    </div>
  );
}
