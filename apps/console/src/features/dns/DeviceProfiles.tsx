import { IconPlus } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import {
  type AdguardClient,
  type Client,
  describeProfile,
  type Group,
  isProfile,
  newProfile,
  PROFILE_PREFIX,
  profileIds,
  profileName,
  type ServiceCatalog,
} from '@zeeli/router-api';
import { useState } from 'react';
import { useClients, useWrite } from '../../api/queries.ts';
import { api } from '../../api/router.ts';
import { errorMessage } from '../../lib/errors.ts';
import { plural } from '../../lib/format.ts';
import { Button } from '../../ui/Button.tsx';
import { DataTable } from '../../ui/DataTable.tsx';
import { useFeedback } from '../../ui/feedback.tsx';
import { SelectField, SwitchRow } from '../../ui/fields.tsx';
import { Chip, Empty, Note, Panel } from '../../ui/Layout.tsx';
import { useForm } from '../../ui/SettingsForm.tsx';
import { Sheet } from '../../ui/Sheet.tsx';
import { confirmedDelete } from '../policies/confirmedDelete.ts';
import { useAgentVersion, useGroupList } from '../policies/queries.ts';
import { ServicePicker, useServiceCatalog } from './Services.tsx';

const KEY = ['adguard-clients'];

/** Something a profile can be for: a group of devices, or one device. */
interface Target {
  key: string;
  name: string;
  kind: 'group' | 'device';
  devices: Client[];
}

function targetsOf(groups: Group[], clients: Client[]): Target[] {
  const named = (g: Group) => g.members.flatMap((m) => clients.filter((c) => c.mac === m));
  return [
    ...groups.map((g): Target => ({ key: `group:${g.id}`, name: g.name, kind: 'group', devices: named(g) })),
    ...clients.map((c): Target => ({ key: `device:${c.mac}`, name: c.name, kind: 'device', devices: [c] })),
  ];
}

const labelOf = (p: AdguardClient) => p.name.slice(PROFILE_PREFIX.length);

/** Per-group and per-device protection: AdGuard "clients" that Zeeli keeps in step with the group's devices. */
export function DeviceProfiles() {
  const { profiles, mine, targets, free, catalog } = useProfileData();
  const [editing, setEditing] = useState<AdguardClient | 'new' | null>(null);
  return (
    <>
      <Panel
        title="Device profiles"
        note={mine.length ? plural(mine.length, 'profile') : undefined}
        actions={
          <Button
            variant="strong"
            icon={<IconPlus size={16} />}
            disabled={!free.length || !profiles.data}
            onClick={() => setEditing('new')}
          >
            New profile
          </Button>
        }
      >
        <Note>Give a group or one device its own protection and blocked services. Groups are made in Clients.</Note>
        {profiles.isError ? (
          <Empty>Couldn’t read AdGuard Home: {errorMessage(profiles.error)}</Empty>
        ) : (
          <ProfileList ready={Boolean(profiles.data)} profiles={mine} targets={targets} services={catalog.data} onOpen={setEditing} />
        )}
      </Panel>
      {editing && catalog.data ? (
        <ProfileSheet
          key={editing === 'new' ? 'new' : editing.name}
          profile={editing === 'new' ? null : editing}
          targets={editing === 'new' ? free : targets}
          catalog={catalog.data}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </>
  );
}

/** Our profiles in AdGuard, and what each could be for: the groups and devices that don't have one yet. */
function useProfileData() {
  const clients = useClients();
  const agent = useAgentVersion();
  const groups = useGroupList(Boolean(agent.data));
  const profiles = useQuery({ queryKey: KEY, queryFn: api.dns.adguardClients });
  const catalog = useServiceCatalog();
  const mine = (profiles.data ?? []).filter(isProfile);
  const targets = targetsOf(groups.data ?? [], clients.data ?? []);
  const free = targets.filter((t) => !mine.some((p) => p.name === profileName(t.name)));
  return { profiles, mine, targets, free, catalog };
}

function ProfileList({ ready, profiles, ...table }: { ready: boolean; profiles: AdguardClient[] } & Omit<TableProps, 'profiles'>) {
  if (profiles.length) return <ProfileTable profiles={profiles} {...table} />;
  return <Empty>{ready ? 'No profiles yet. Try one for Kids: parental control on and a few apps blocked.' : 'Loading…'}</Empty>;
}

const sameIds = (a: string[], b: string[]) => [...a].sort().join() === [...b].sort().join();

interface TableProps {
  profiles: AdguardClient[];
  targets: Target[];
  services: ServiceCatalog | undefined;
  onOpen: (p: AdguardClient) => void;
}

function ProfileTable({ profiles, targets, services, onOpen }: TableProps) {
  const targetOf = (p: AdguardClient) => targets.find((t) => profileName(t.name) === p.name);
  const serviceName = (id: string) => services?.services.find((s) => s.id === id)?.name ?? id;
  // the group gained or lost a device since the profile was saved
  const stale = (p: AdguardClient) => {
    const t = targetOf(p);
    return t !== undefined && !sameIds(profileIds(t.devices), p.ids);
  };
  return (
    <DataTable
      label="Device profiles"
      rows={profiles}
      rowKey={(p) => p.name}
      onRowClick={onOpen}
      columns={[
        {
          key: 'name',
          header: 'Profile',
          phone: 'title',
          cell: (p) => (
            <span className="dev-cell">
              {labelOf(p)}
              {targetOf(p)?.kind === 'group' ? <Chip>Group</Chip> : null}
              {stale(p) ? <Chip tone="warn">Devices changed</Chip> : null}
            </span>
          ),
        },
        { key: 'devices', header: 'Devices', cell: (p) => devicesText(p, targetOf(p)) },
        { key: 'does', header: 'What it does', phone: 'sub', cell: (p) => describeProfile(p, serviceName) },
      ]}
    />
  );
}

function devicesText(p: AdguardClient, target: Target | undefined) {
  if (!target) return p.ids.join(', ');
  return target.kind === 'group' ? plural(target.devices.length, 'device') : 'One device';
}

interface Draft {
  custom: boolean;
  ads: boolean;
  malware: boolean;
  adult: boolean;
  safeSearch: boolean;
  ownServices: boolean;
  services: string[];
}

const draftOf = (p: AdguardClient): Draft => ({
  custom: !p.use_global_settings,
  ads: p.filtering_enabled,
  malware: p.safebrowsing_enabled,
  adult: p.parental_enabled,
  safeSearch: p.safe_search.enabled,
  ownServices: !p.use_global_blocked_services,
  services: p.blocked_services,
});

const withDraft = (p: AdguardClient, d: Draft): AdguardClient => ({
  ...p,
  use_global_settings: !d.custom,
  filtering_enabled: d.ads,
  safebrowsing_enabled: d.malware,
  parental_enabled: d.adult,
  safe_search: { ...p.safe_search, enabled: d.safeSearch },
  use_global_blocked_services: !d.ownServices,
  blocked_services: d.services,
});

function ProfileSheet({
  profile,
  targets,
  catalog,
  onClose,
}: {
  profile: AdguardClient | null;
  targets: Target[];
  catalog: ServiceCatalog;
  onClose: () => void;
}) {
  const feedback = useFeedback();
  const [pick, setPick] = useState(targets[0]?.key ?? '');
  const form = useForm(draftOf(profile ?? newProfile('', [])));
  const { save, remove } = useProfileWrites(profile);
  // an existing profile stays tied to the group or device its name says
  const target = targets.find((t) => (profile ? profileName(t.name) === profile.name : t.key === pick));
  const label = profile ? labelOf(profile) : (target?.name ?? '');

  async function onSave() {
    const name = profile?.name ?? profileName(label);
    const ids = target ? profileIds(target.devices) : (profile?.ids ?? []);
    if (!ids.length) throw new Error(`${label || 'That'} has no devices yet. Add some to the group first.`);
    // the ids are always rebuilt from the group's devices as they are now
    await save.mutateAsync({ ...withDraft(profile ?? newProfile(name, ids), form.values), ids });
    feedback.toast(`Saved the ${label} profile`);
  }

  return (
    <Sheet
      open
      wide
      onOpenChange={(o) => !o && onClose()}
      title={profile ? `${label} profile` : 'New profile'}
      sub={target ? `${target.kind === 'group' ? 'Group' : 'Device'}: ${target.name}` : undefined}
      save={profile ? 'Save profile' : 'Create profile'}
      danger={
        profile
          ? {
              label: 'Delete profile',
              onClick: async () => {
                const body = 'Its devices go back to the protection everyone else has.';
                if (await confirmedDelete(feedback, `the ${label} profile`, body, () => remove.mutateAsync(undefined))) onClose();
              },
            }
          : undefined
      }
      onSave={onSave}
    >
      {profile ? null : (
        <SelectField
          label="For"
          value={pick}
          onChange={setPick}
          options={targets.map((t) => [t.key, `${t.name}${t.kind === 'group' ? ' (group)' : ''}`] as const)}
        />
      )}
      <ProtectionFields form={form} />
      <ServiceFields form={form} catalog={catalog} />
    </Sheet>
  );
}

function ServiceFields({ form, catalog }: { form: ReturnType<typeof useForm<Draft>>; catalog: ServiceCatalog }) {
  const { values: v, set } = form;
  async function setOwn(on: boolean) {
    set('ownServices', on);
    // start from what everyone has blocked, so "different" is a change on top of it
    if (on && !v.services.length) set('services', (await api.dns.blockedServices()).ids);
  }
  return (
    <>
      <SwitchRow
        label="Block different services than everyone else"
        hint="The list below replaces the one for the whole network, for this profile only"
        checked={v.ownServices}
        onChange={setOwn}
      />
      {v.ownServices ? (
        <ServicePicker
          catalog={catalog}
          value={v.services}
          onToggle={(s, on) => set('services', on ? [...v.services, s.id] : v.services.filter((x) => x !== s.id))}
        />
      ) : null}
    </>
  );
}

function useProfileWrites(profile: AdguardClient | null) {
  const save = useWrite(
    (p: AdguardClient) => (profile ? api.dns.updateAdguardClient(profile.name, p) : api.dns.addAdguardClient(p)),
    [KEY],
  );
  const remove = useWrite(async () => {
    if (profile) await api.dns.deleteAdguardClient(profile.name);
  }, [KEY]);
  return { save, remove };
}

function ProtectionFields({ form }: { form: ReturnType<typeof useForm<Draft>> }) {
  const { values: v, set } = form;
  return (
    <>
      <SwitchRow
        label="Use different protection than everyone else"
        hint="Off follows the Overview settings"
        checked={v.custom}
        onChange={(x) => set('custom', x)}
      />
      {v.custom ? (
        <>
          <SwitchRow label="Block ads and trackers" checked={v.ads} onChange={(x) => set('ads', x)} />
          <SwitchRow label="Malware and phishing" checked={v.malware} onChange={(x) => set('malware', x)} />
          <SwitchRow label="Adult content" checked={v.adult} onChange={(x) => set('adult', x)} />
          <SwitchRow label="SafeSearch" checked={v.safeSearch} onChange={(x) => set('safeSearch', x)} />
        </>
      ) : null}
    </>
  );
}
