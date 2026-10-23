import { BAND_RADIO, type OwnWifi, SECURITY } from '@zeeli/router-api';
import { useState } from 'react';
import { useWrite } from '../../api/queries.ts';
import { api } from '../../api/router.ts';
import { errorMessage } from '../../lib/errors.ts';
import { Button } from '../../ui/Button.tsx';
import { useFeedback } from '../../ui/feedback.tsx';
import { KeyValues } from '../../ui/Layout.tsx';
import { Sheet } from '../../ui/Sheet.tsx';

export const MLO_LOCKED =
  'On this firmware a multi-link network can’t be changed or switched off while the router runs. Delete it and make it again.';

/** Deleting a multi-link network can’t take it off the air: that waits for a restart. */
export const mloDeleteBody =
  'The network stays on the air until the router restarts, which takes about two minutes and disconnects every device. You can restart right after.';

interface Props {
  network: OwnWifi;
  /** The networks page's names for networks, by id. */
  labels: Record<string, string>;
  onClose: () => void;
}

/** A multi-link network, read-only: it can be deleted and made again, not edited. */
export function MloDetails({ network, labels, onClose }: Props) {
  const { toast, confirm } = useFeedback();
  const [password, setPassword] = useState<string | null>(null);
  const drop = useWrite(() => api.wifiNetworks.remove(network.id), [['wifi-networks'], ['wifi'], ['status']]);

  async function showPassword() {
    try {
      setPassword(await api.wifiNetworks.reveal(network.id));
    } catch (err) {
      toast(`Couldn’t read the password: ${errorMessage(err)}`);
    }
  }

  async function remove() {
    const ok = await confirm({ title: `Delete “${network.ssid}”?`, body: mloDeleteBody, confirm: 'Delete' });
    if (!ok) return;
    try {
      await drop.mutateAsync(undefined);
      toast(`Deleted ${network.ssid}. Restart the router to finish removing it.`);
      onClose();
    } catch (err) {
      toast(`Couldn’t delete: ${errorMessage(err)}`);
    }
  }

  const secret =
    password === null ? (
      <button type="button" className="link" onClick={showPassword}>
        Show password
      </button>
    ) : (
      <span className="mono">{password}</span>
    );

  return (
    <Sheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={network.ssid}
      sub="Multi-link (Wi-Fi 7) network"
      danger={{ label: 'Delete network', onClick: remove }}
      wide
    >
      <p className="hint">{MLO_LOCKED}</p>
      <KeyValues
        rows={[
          ['Bands', `MLO · ${network.bands.map((b) => BAND_RADIO[b]).join(' + ')}`],
          ['Joins network', labels[network.network] ?? network.network],
          ['Security', SECURITY[network.security] ?? network.security],
          ['Hidden', network.hidden ? 'Yes' : 'No'],
          ['Keeps devices apart', network.isolate ? 'Yes' : 'No'],
          ['Password', secret],
        ]}
      />
    </Sheet>
  );
}

/** Shown until the router has restarted: the network is gone from the settings but still on the air. */
export function RestartPanel({ names }: { names: string[] }) {
  const { toast, confirm } = useFeedback();
  const reboot = useWrite(() => api.system.reboot(), [['wifi-networks']]);
  const quoted = names.map((n) => `‘${n}’`).join(', ');

  async function run() {
    const ok = await confirm({
      title: 'Reboot the router?',
      body: 'Every device loses its connection for about two minutes while the router restarts.',
      confirm: 'Reboot',
    });
    if (!ok) return;
    try {
      await reboot.mutateAsync(undefined);
      toast('Rebooting. This page reconnects when the router is back.');
    } catch (err) {
      toast(errorMessage(err));
    }
  }

  return (
    <div className="panel notice">
      Restart the router to finish removing {quoted}. It stays on the air until then, and WiFi changes wait.{' '}
      <Button variant="strong" busy={reboot.isPending} onClick={run}>
        Restart router
      </Button>
    </div>
  );
}
