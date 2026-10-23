import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useAgent, useWrite } from '../../api/queries.ts';
import { api } from '../../api/router.ts';
import { navigate } from '../../app/useHashRoute.ts';
import { plural } from '../../lib/format.ts';
import { Button } from '../../ui/Button.tsx';
import { useFeedback } from '../../ui/feedback.tsx';
import { ChipPicker, Segmented } from '../../ui/fields.tsx';
import { Sheet } from '../../ui/Sheet.tsx';

/** What to do with a network once it exists: give it Wi-Fi, carry it on ports. */
export function NextSteps({ name, onClose }: { name: string; onClose: () => void }) {
  const agent = useAgent();
  const [ports, setPorts] = useState(false);
  if (ports) return <PortsSheet name={name} onClose={onClose} />;
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()} title={`${name} is ready`} sub="Two more things make it useful.">
      <Button
        variant="strong"
        onClick={() => {
          onClose();
          navigate(`wifi?create=${encodeURIComponent(name)}&ssid=${encodeURIComponent(name)}`);
        }}
      >
        Add WiFi for it
      </Button>
      {agent.data ? <Button onClick={() => setPorts(true)}>Carry it on ports</Button> : null}
      <Button variant="ghost" onClick={onClose}>
        Done
      </Button>
    </Sheet>
  );
}

type Mode = 'untagged' | 'tagged';

/** Puts the network on LAN ports through a port profile, the same way Network → Ports does. */
function PortsSheet({ name, onClose }: { name: string; onClose: () => void }) {
  const { toast, confirm } = useFeedback();
  const ports = useQuery({ queryKey: ['ports'], queryFn: api.internet.ports });
  const lan = (ports.data ?? []).filter((p) => p.role === 'lan');
  const [picked, setPicked] = useState<string[]>([]);
  const [mode, setMode] = useState<Mode>('untagged');
  const apply = useWrite(
    async (chosen: string[]) => {
      const nets = await api.networks.list();
      const vlan = nets.find((n) => n.id === name)?.vlanId;
      if (!vlan) throw new Error('The network has no VLAN, so it can’t be put on a port.');
      const main = nets.find((n) => n.id === 'main')?.vlanId ?? 1;
      const tagged = mode === 'tagged';
      const profileName = tagged ? `${name} trunk` : `${name} port`;
      const existing = (await api.safety.ports.profiles()).find((p) => p.name === profileName);
      await api.safety.ports.saveProfile({
        ...(existing ? { id: existing.id } : {}),
        name: profileName,
        untagged: tagged ? 'main' : name,
        tagged: tagged ? [name] : [],
      });
      // one port at a time: GL reconfigures the switch for each
      await lan
        .filter((p) => chosen.includes(p.name))
        .reduce(
          (done, port) =>
            done.then(() =>
              api.internet.setPortVlans(port, tagged ? 'Multiple VLANs' : 'Standard', tagged ? main : vlan, tagged ? [vlan] : []),
            ),
          Promise.resolve<unknown>(undefined),
        );
    },
    [['port-profiles'], ['ports'], ['port-status']],
  );
  return (
    <Sheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Carry ${name} on ports`}
      sub="Saved as a port profile you can reuse in Network → Ports."
      save="Apply"
      onSave={async () => {
        if (!picked.length) throw new Error('Pick at least one port.');
        const labels = lan.filter((p) => picked.includes(p.name)).map((p) => p.label);
        const ok = await confirm({
          title: `Put ${name} on ${labels.join(', ')}?`,
          body: `Whatever is plugged into ${plural(labels.length, 'this port', 'these ports')} changes network. A device on a port you’re using to reach the router may need to reconnect.`,
          confirm: 'Apply',
          danger: false,
        });
        if (!ok) return false;
        await apply.mutateAsync(picked);
        toast(`${name} is on ${labels.join(', ')}`);
      }}
    >
      <Segmented
        label="How"
        value={mode}
        options={[
          ['untagged', 'Untagged'],
          ['tagged', 'Tagged'],
        ]}
        onChange={setMode}
      />
      <p className="page-note">
        {mode === 'untagged'
          ? 'Plain devices on the port join this network.'
          : 'The port carries your main network, and this one for devices that understand VLANs, like an access point.'}
      </p>
      <ChipPicker legend="LAN ports" options={lan.map((p) => [p.name, p.label] as const)} value={picked} onChange={setPicked} />
    </Sheet>
  );
}
