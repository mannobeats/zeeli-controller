import {
  type Icon,
  IconActivity,
  IconBell,
  IconChartBar,
  IconChartLine,
  IconDeviceTv,
  IconFolders,
  IconGauge,
  IconPower,
  IconShieldCheck,
  IconShieldLock,
  IconSpy,
  IconWorldWww,
} from '@tabler/icons-react';
import type { AppDefinition } from '@zeeli/router-api';
import { useState } from 'react';
import { useWrite } from '../../api/queries.ts';
import { api } from '../../api/router.ts';
import { errorMessage } from '../../lib/errors.ts';
import { useFeedback } from '../../ui/feedback.tsx';
import { Panel } from '../../ui/Layout.tsx';

const APP_ICON: Record<string, Icon> = {
  adguard: IconShieldCheck,
  tailscale: IconShieldLock,
  zerotier: IconWorldWww,
  tor: IconSpy,
  ddns: IconWorldWww,
  bark: IconBell,
  dpi: IconActivity,
  samba: IconFolders,
  minidlna: IconDeviceTv,
  vnstat: IconChartLine,
  nlbwmon: IconChartBar,
  iperf3: IconGauge,
  wol: IconPower,
  banip: IconShieldLock,
};

export function AppIcon({ id }: { id: string }) {
  const I = APP_ICON[id] ?? IconActivity;
  return (
    <span className={`app-icon app-${id}`}>
      <I size={22} stroke={1.75} />
    </span>
  );
}

/** What is being installed or removed right now, named for the wait message. */
interface AppBusy {
  id: string;
  wait: string;
}

/**
 * Install or remove a package app: removal is confirmed, the wait is named (opkg can
 * take minutes), and the toast reports what the router read back.
 */
export function useAppChange() {
  const { toast, confirm } = useFeedback();
  const [busy, setBusy] = useState<AppBusy | null>(null);
  const change = useWrite(
    ({ app, remove }: { app: AppDefinition; remove: boolean }) => (remove ? api.apps.remove(app) : api.apps.install(app)),
    [['apps'], ['packages'], ['packages-available']],
  );

  async function run(app: AppDefinition, remove: boolean) {
    if (
      remove &&
      !(await confirm({
        title: `Remove ${app.name}?`,
        body: `This uninstalls ${(app.packages ?? []).join(', ')}. Settings it saved may stay on the router.`,
        confirm: `Remove ${app.name}`,
      }))
    )
      return;
    const wait = `${remove ? 'Removing' : 'Installing'} ${app.name}…`;
    setBusy({ id: app.id, wait });
    toast(`${wait} This can take a few minutes.`);
    try {
      await change.mutateAsync({ app, remove });
      toast(`${app.name} ${remove ? 'removed' : 'installed'}`);
    } catch (err) {
      toast(`Couldn’t ${remove ? 'remove' : 'install'} ${app.name}: ${errorMessage(err)}`);
    } finally {
      setBusy(null);
    }
  }

  return { run, busy };
}

/** The named wait while opkg works, so a long install never looks stuck. */
export function WaitNote({ busy }: { busy: AppBusy | null }) {
  if (!busy) return null;
  return (
    <Panel>
      <output className="kicker app-wait">{busy.wait} This can take a few minutes; keep this page open.</output>
    </Panel>
  );
}
