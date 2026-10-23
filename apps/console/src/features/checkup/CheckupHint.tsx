import { navigate } from '../../app/useHashRoute.ts';
import { summary } from './checks.ts';
import { useCheckup } from './useCheckup.ts';

/** One line for the Dashboard: what the checkup found. Says nothing when all is well. */
export function CheckupHint() {
  const findings = useCheckup().data?.findings ?? [];
  if (!findings.length) return null;
  return (
    <p className="kicker">
      Checkup: {summary(findings)}{' '}
      <button type="button" className="link" onClick={() => navigate('checkup')}>
        Review
      </button>
    </p>
  );
}
