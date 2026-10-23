import { IconBell } from '@tabler/icons-react';
import { navigate } from '../../app/useHashRoute.ts';
import { useAlerts } from '../history/useHistory.ts';

/** The top bar’s bell: how many alerts are waiting, and a way to the Alerts page. Absent on a router that can’t record them. */
export function AlertsBell() {
  const unread = useAlerts().data?.unread;
  if (unread === undefined) return null;
  return (
    <button
      type="button"
      className="icon-btn bell"
      aria-label={unread ? `Alerts, ${unread} unread` : 'Alerts'}
      title="Alerts"
      onClick={() => navigate('alerts')}
    >
      <IconBell size={18} stroke={1.75} />
      {unread ? <span className="badge num">{unread > 9 ? '9+' : unread}</span> : null}
    </button>
  );
}
