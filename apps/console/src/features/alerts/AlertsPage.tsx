import { useQuery, useQueryClient } from '@tanstack/react-query';
import { EVENT_KINDS, type HistoryEvent, type HistoryEventKind, type HistorySettings } from '@zeeli/router-api';
import { useWrite } from '../../api/queries.ts';
import { api } from '../../api/router.ts';
import { navigate } from '../../app/useHashRoute.ts';
import { errorMessage } from '../../lib/errors.ts';
import { ago } from '../../lib/format.ts';
import { Button } from '../../ui/Button.tsx';
import { useFeedback } from '../../ui/feedback.tsx';
import { SwitchRow, TextField } from '../../ui/fields.tsx';
import { Empty, PageHeader, Panel } from '../../ui/Layout.tsx';
import { SettingsForm, useForm } from '../../ui/SettingsForm.tsx';
import { useDeviceName } from '../dns/names.ts';
import { HistoryGate } from '../history/parts.tsx';
import { useAlerts } from '../history/useHistory.ts';
import { EVENT_LOOK, eventLink, eventText } from './text.ts';

/** What needs a look: new devices, uplinks that dropped, a hot router. Acknowledge what you’ve seen. */
export default function AlertsPage() {
  const { toast } = useFeedback();
  const alerts = useAlerts();
  const all = useWrite(() => api.stats.acknowledgeAll(), [['alerts']]);
  const unread = alerts.data?.unread ?? 0;
  return (
    <>
      <PageHeader
        title="Alerts"
        sub={alerts.data ? (unread ? `${unread} unread` : 'Nothing waiting') : undefined}
        actions={
          <Button
            disabled={!unread}
            busy={all.isPending}
            onClick={() =>
              all.mutateAsync(undefined).then(
                () => toast('All alerts acknowledged'),
                (err) => toast(errorMessage(err)),
              )
            }
          >
            Acknowledge all
          </Button>
        }
      />
      <HistoryGate>
        <Unread />
        <Earlier />
        <Settings />
      </HistoryGate>
    </>
  );
}

function EventList({ events, onAck }: { events: HistoryEvent[]; onAck?: (e: HistoryEvent) => void }) {
  const nameOf = useDeviceName();
  return (
    <ol className="timeline">
      {events.map((e) => {
        const { icon: Icon, tone } = EVENT_LOOK[e.kind];
        return (
          <li key={e.id} className={`tl-${tone}`}>
            <span className="tl-dot">
              <Icon size={16} stroke={1.75} />
            </span>
            <div className="tl-body">
              <button type="button" className="tl-link" onClick={() => navigate(eventLink(e))}>
                {eventText(e, nameOf)}
              </button>
            </div>
            <span className="tl-end">
              <time className="tl-time" dateTime={e.time.toISOString()} title={e.time.toLocaleString()}>
                {ago(e.time.getTime() / 1000)}
              </time>
              {onAck ? (
                <Button variant="ghost" onClick={() => onAck(e)} aria-label={`Acknowledge: ${eventText(e, nameOf)}`}>
                  Acknowledge
                </Button>
              ) : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function Unread() {
  const { toast } = useFeedback();
  const alerts = useAlerts();
  const ack = useWrite((id: number) => api.stats.acknowledge([id]), [['alerts']]);
  return (
    <Panel title="Unread">
      {alerts.data?.alerts.length ? (
        <EventList events={alerts.data.alerts} onAck={(e) => ack.mutateAsync(e.id).catch((err) => toast(errorMessage(err)))} />
      ) : (
        <Empty>{alerts.isLoading ? 'Reading alerts…' : 'Nothing needs your attention.'}</Empty>
      )}
    </Panel>
  );
}

/** Alerts already acknowledged, from the router’s record of events. */
function Earlier() {
  const alerts = useAlerts().data;
  const on = alerts?.on ?? [];
  const recent = useQuery({
    queryKey: ['alerts-earlier', on],
    queryFn: () => api.stats.events({ kinds: on, limit: 40 }),
    enabled: on.length > 0,
  });
  const unreadIds = new Set(alerts?.alerts.map((a) => a.id));
  const earlier = (recent.data ?? []).filter((e) => e.alert && !unreadIds.has(e.id)).slice(0, 15);
  if (!earlier.length) return null;
  return (
    <Panel className="section" title="Earlier" note="Already acknowledged">
      <EventList events={earlier} />
    </Panel>
  );
}

function Settings() {
  const alerts = useAlerts().data;
  const history = useQuery({ queryKey: ['history-settings'], queryFn: api.stats.settings });
  return (
    <>
      {alerts ? <KindsForm on={alerts.on} /> : null}
      {history.data ? <HistoryForm settings={history.data} /> : null}
    </>
  );
}

function KindsForm({ on }: { on: HistoryEventKind[] }) {
  const qc = useQueryClient();
  const form = useForm({ on });
  const kinds = Object.keys(EVENT_KINDS) as HistoryEventKind[];
  const picked = new Set(form.values.on);
  return (
    <SettingsForm
      title="Which events raise an alert"
      form={form}
      onSave={async () => {
        qc.setQueryData(['alerts'], await api.stats.setAlertKinds(form.values.on));
        return 'Alert settings saved';
      }}
    >
      {kinds.map((k) => (
        <SwitchRow
          key={k}
          label={EVENT_KINDS[k]}
          checked={picked.has(k)}
          onChange={(x) => form.set('on', x ? [...form.values.on, k] : form.values.on.filter((o) => o !== k))}
        />
      ))}
    </SettingsForm>
  );
}

function HistoryForm({ settings }: { settings: HistorySettings }) {
  const qc = useQueryClient();
  const form = useForm({ target: settings.target, tempHigh: String(settings.tempHigh) });
  return (
    <SettingsForm
      title="Health checks"
      note="Used for the internet health charts and the heat alert"
      form={form}
      onSave={async () => {
        const temp = Number(form.values.tempHigh);
        if (!Number.isInteger(temp) || temp < 50 || temp > 110) throw new Error('Enter a temperature from 50 to 110 °C.');
        qc.setQueryData(['history-settings'], await api.stats.saveSettings({ target: form.values.target.trim(), tempHigh: temp }));
        return 'Health check settings saved';
      }}
    >
      <TextField
        label="Address to ping"
        hint="An IP address or host name. The router pings it through each uplink, once a minute."
        value={form.values.target}
        onChange={(v) => form.set('target', v)}
        mono
      />
      <TextField
        label="Heat alert at"
        unit="°C"
        inputMode="numeric"
        value={form.values.tempHigh}
        onChange={(v) => form.set('tempHigh', v)}
      />
    </SettingsForm>
  );
}
