import { useQuery } from '@tanstack/react-query';
import { type Client, localName } from '@zeeli/router-api';
import { useWrite } from '../../api/queries.ts';
import { api } from '../../api/router.ts';
import { errorMessage } from '../../lib/errors.ts';
import { Button } from '../../ui/Button.tsx';
import { useFeedback } from '../../ui/feedback.tsx';
import { SwitchRow } from '../../ui/fields.tsx';
import { attempt, keepIp, useLocalNames } from './localNames.ts';

/** The device's address, whether it keeps it, and the name it answers to on the network. */
export function DeviceAddress({ client }: { client: Client }) {
  const { toast } = useFeedback();
  const reservations = useQuery({ queryKey: ['reservations'], queryFn: api.networks.reservations });
  const reserved = reservations.data?.find((r) => r.mac === client.mac);
  const keep = useWrite(() => keepIp(client, client.name), [['reservations']]);
  const release = useWrite(async () => reserved && api.networks.unreserve(reserved), [['reservations']]);
  return (
    <section>
      <h3>Address</h3>
      <div className="field-row">
        <div>
          <span className="mono">{reserved?.ip ?? client.ip}</span>
          <div className="hint">{reserved ? 'Kept: this device always gets this address' : 'Assigned by DHCP, so it can change'}</div>
        </div>
        <div className="section-actions">
          <Button
            busy={keep.isPending}
            disabled={Boolean(reserved) || !client.ip}
            title={reserved ? 'This address is already kept for this device' : undefined}
            onClick={() => attempt(toast, keep, `${client.name} keeps ${client.ip}`)}
          >
            Keep this IP
          </Button>
          {reserved ? (
            <Button variant="ghost" busy={release.isPending} onClick={() => attempt(toast, release, 'Reservation removed')}>
              Remove reservation
            </Button>
          ) : null}
        </div>
      </div>
      <LocalName client={client} />
    </section>
  );
}

/** `nas-01.lan` with a copy button, and the switch for giving every named device such a name. */
function LocalName({ client }: { client: Client }) {
  const { toast } = useFeedback();
  const names = useLocalNames().data;
  const toggle = useWrite(
    async (on: boolean) => {
      await api.names.setEnabled(on);
      // the addresses go across now rather than at the router's next minute
      if (on) await api.names.sync(await api.clients.list());
    },
    [['names']],
  );
  if (!names) return null;
  const address = localName(names, client.mac);
  return (
    <>
      {address ? (
        <div className="field-row">
          <div>
            Reachable as <span className="mono">{address}</span>
          </div>
          <Button
            variant="ghost"
            onClick={() =>
              navigator.clipboard.writeText(address).then(
                () => toast(`Copied ${address}`),
                () => toast('Couldn’t copy. Select the name and copy it yourself.'),
              )
            }
          >
            Copy
          </Button>
        </div>
      ) : null}
      <SwitchRow
        label="Give devices local names"
        hint={
          names.enabled && !address
            ? `Name this device and it answers as a name ending in .${names.zone}`
            : `Every named device answers as its name ending in .${names.zone}`
        }
        checked={names.enabled}
        onChange={(on) => toggle.mutateAsync(on).catch((e) => toast(errorMessage(e)))}
        disabled={toggle.isPending}
      />
    </>
  );
}
