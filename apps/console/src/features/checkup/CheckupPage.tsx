import { IconAlertOctagon, IconAlertTriangle, IconBulb, IconRefresh } from '@tabler/icons-react';
import { useWrite } from '../../api/queries.ts';
import { api } from '../../api/router.ts';
import { navigate } from '../../app/useHashRoute.ts';
import { errorMessage } from '../../lib/errors.ts';
import { Button } from '../../ui/Button.tsx';
import { useFeedback } from '../../ui/feedback.tsx';
import { Empty, PageHeader, Panel } from '../../ui/Layout.tsx';
import { ScrollBox, useLimit } from '../../ui/limit.tsx';
import { type Finding, type Fix, type Severity, summary } from './checks.ts';
import { useCheckup } from './useCheckup.ts';

const LOOK: Record<Severity, { icon: typeof IconBulb; tone: string; label: string }> = {
  problem: { icon: IconAlertOctagon, tone: 'tl-bad', label: 'Problem' },
  warning: { icon: IconAlertTriangle, tone: 'tl-warn', label: 'Warning' },
  tip: { icon: IconBulb, tone: '', label: 'Tip' },
};

async function applyFix(fix: Fix) {
  if (fix.type === 'remote') {
    await api.security.wanAccess.set({ [fix.key]: false }, 'Remote access');
    return;
  }
  await Promise.all(fix.ids.map((id) => api.wifiNetworks.update(id, fix.patch)));
  await api.wifiNetworks.apply();
}

/** Reviews the whole setup and lists what looks wrong, worst first. */
export default function CheckupPage() {
  const checkup = useCheckup();
  const { findings = [], skipped = [] } = checkup.data ?? {};
  const done = checkup.data !== undefined;
  return (
    <>
      <PageHeader
        title="Network checkup"
        sub={done ? summary(findings) || 'Nothing to fix' : undefined}
        actions={
          <Button icon={<IconRefresh size={16} />} busy={checkup.isFetching} onClick={() => checkup.refetch()}>
            Check again
          </Button>
        }
      />
      {done ? (
        <Panel title={findings.length ? 'What to look at' : undefined}>
          {findings.length ? <FindingList findings={findings} /> : <Empty>All good. Nothing needs your attention.</Empty>}
          {skipped.length ? (
            <p className="kicker">Not checked, because the router didn’t say: {skipped.join(', ').toLowerCase()}.</p>
          ) : null}
        </Panel>
      ) : (
        <output className="panel skeleton" aria-busy="true" aria-label="Checking your network" />
      )}
    </>
  );
}

function FindingList({ findings }: { findings: Finding[] }) {
  const { shown, more } = useLimit(findings, 20);
  return (
    <ScrollBox label="Findings">
      <ul className="timeline">
        {shown.map((f) => (
          <FindingRow key={f.id} finding={f} />
        ))}
      </ul>
      {more}
    </ScrollBox>
  );
}

function FindingRow({ finding: f }: { finding: Finding }) {
  const { toast, confirm } = useFeedback();
  const fix = useWrite(applyFix, [['checkup'], ['wifi-networks'], ['wan-access']]);
  const { icon: Icon, tone, label } = LOOK[f.severity];
  const { action } = f;
  const run = async () => {
    if (action.kind === 'open') return navigate(action.page);
    if (!(await confirm({ title: action.label, body: action.confirm, confirm: action.label, danger: false }))) return;
    fix.mutateAsync(action.fix).then(
      () => toast(action.done),
      (err) => toast(errorMessage(err)),
    );
  };
  return (
    <li className={tone}>
      <span className="tl-dot">
        <Icon size={16} stroke={1.75} />
      </span>
      <div className="tl-body">
        <b>
          <span className="sr-only">{label}: </span>
          {f.title}
        </b>
        <div>{f.why}</div>
      </div>
      <Button
        variant={action.kind === 'fix' ? 'strong' : 'default'}
        busy={fix.isPending}
        onClick={run}
        aria-label={`${action.label}: ${f.title}`}
      >
        {action.label}
      </Button>
    </li>
  );
}
