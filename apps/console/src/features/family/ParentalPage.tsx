import { IconPlus, IconSearch, IconX } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import {
  type AppEntry,
  type Bedtime,
  bedtimeAt,
  type Client,
  FAMILY_CATEGORIES,
  type Pause,
  type Profile,
  type ProfileInput,
  routerClock,
  weekdayOf,
  windowsFor,
} from '@zeeli/router-api';
import { useState } from 'react';
import { useClients, useStatus, useWrite } from '../../api/queries.ts';
import { api } from '../../api/router.ts';
import { errorMessage } from '../../lib/errors.ts';
import { plural, rateText } from '../../lib/format.ts';
import { Button } from '../../ui/Button.tsx';
import { DeviceIcon } from '../../ui/DeviceIcon.tsx';
import { useFeedback } from '../../ui/feedback.tsx';
import { ChipPicker, Row2, Segmented, Switch, SwitchRow, TextField } from '../../ui/fields.tsx';
import { Note, PageHeader, Panel, ToneText } from '../../ui/Layout.tsx';
import { Loaded } from '../../ui/Loading.tsx';
import { Sheet } from '../../ui/Sheet.tsx';
import { TextArea } from '../../ui/TextArea.tsx';
import { buildProfile, dailyBedtime, newProfile, type PresetDefaults, weekBedtimes } from './profile.ts';

const DAY = { 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat', 7: 'Sun' } as const;
const PRESETS = {
  kid: {
    label: 'Young child',
    note: 'Bedtime 8 PM to 7 AM. Blocks adult, gambling, scams, social, games and shopping.',
    bedtime: ['20:00', '07:00'],
    categories: Object.keys(FAMILY_CATEGORIES),
  },
  teen: {
    label: 'Teenager',
    note: 'Bedtime 11 PM to 6:30 AM. Blocks adult, gambling and scams.',
    bedtime: ['23:00', '06:30'],
    categories: ['sexual_content', 'gambling', 'malicious_content'],
  },
  safe: {
    label: 'Safe browsing only',
    note: 'No bedtime. Blocks adult, gambling and scams.',
    bedtime: null,
    categories: ['sexual_content', 'gambling', 'malicious_content'],
  },
} as const;
type PresetKey = keyof typeof PRESETS | '';

const TICKS = [
  ['h0', '12 AM'],
  ['h6', '6 AM'],
  ['h12', '12 PM'],
  ['h18', '6 PM'],
  ['h24', '12 AM'],
] as const;
const clock = (d: Date) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });
const minClock = (m: number) => clock(new Date(Date.UTC(2000, 0, 1, Math.floor(m / 60) % 24, m % 60)));

export default function ParentalPage() {
  const { toast } = useFeedback();
  const status = useStatus();
  const clients = useClients().data ?? [];
  const config = useQuery({ queryKey: ['family'], queryFn: api.family.config });
  const pauses = useQuery({ queryKey: ['family-pauses'], queryFn: api.family.pauses, retry: false });
  const master = useWrite((on: boolean) => api.family.setEnabled(on), [['family']]);
  const profileOn = useWrite(({ p, on }: { p: Profile; on: boolean }) => api.family.save({ ...p, enabled: on }, p.id), [['family']]);
  const [editing, setEditing] = useState<{ profile: Profile | null; preset: PresetKey } | null>(null);
  const [pausing, setPausing] = useState<Profile | null>(null);
  const resume = useWrite((list: Pause[]) => api.family.resume(list), [['family-pauses']]);

  const s = status.data;
  const now = s ? routerClock(s.timestamp, s.tzoffset, status.dataUpdatedAt) : new Date();

  return (
    <Loaded query={config} title="Parental control">
      {({ enabled, profiles }) => (
        <>
          <PageHeader
            title="Parental control"
            sub={
              profiles.length
                ? `${plural(profiles.length, 'profile')}, router time ${clock(now)}`
                : 'Group a child’s devices into a profile, then set bedtime and what to block.'
            }
            actions={
              <>
                <span className="switch-label">
                  {enabled ? 'On' : 'Off'}
                  <Switch
                    checked={enabled}
                    label="Parental control on"
                    disabled={master.isPending}
                    onChange={(on) =>
                      master.mutateAsync(on).then(
                        () => toast(`Parental control ${on ? 'on' : 'off'}`),
                        (e) => toast(errorMessage(e)),
                      )
                    }
                  />
                </span>
                {profiles.length ? (
                  <Button variant="strong" icon={<IconPlus size={16} />} onClick={() => setEditing({ profile: null, preset: '' })}>
                    New profile
                  </Button>
                ) : null}
              </>
            }
          />
          {enabled || !profiles.length ? null : (
            <div className="panel notice">Parental control is off, so none of these profiles apply. Turn it on at the top right.</div>
          )}
          {profiles.length ? (
            <div className="profiles">
              {profiles.map((p) => {
                const pause = pauses.data?.find((x) => x.profileId === p.id);
                return (
                  <ProfileCard
                    key={p.id}
                    profile={p}
                    clients={clients}
                    now={now}
                    enforced={enabled}
                    pause={pause}
                    pauseAvailable={!pauses.isError}
                    onToggle={(on) =>
                      profileOn.mutateAsync({ p, on }).then(
                        () => toast(`${p.name} ${on ? 'on' : 'off'}`),
                        (e) => toast(errorMessage(e)),
                      )
                    }
                    onEdit={() => setEditing({ profile: p, preset: '' })}
                    onPause={() => setPausing(p)}
                    onResume={() =>
                      pause &&
                      resume.mutateAsync([pause]).then(
                        () => toast(`${p.name} back online`),
                        (e) => toast(errorMessage(e)),
                      )
                    }
                  />
                );
              })}
            </div>
          ) : (
            <Panel title="Start with a preset">
              <Presets onPick={(preset) => setEditing({ profile: null, preset })} />
            </Panel>
          )}
          {editing ? (
            <ProfileSheet
              key={editing.profile?.id ?? `new-${editing.preset}`}
              profile={editing.profile}
              preset={editing.preset}
              profiles={profiles}
              clients={clients}
              masterOn={enabled}
              pause={pauses.data?.find((x) => x.profileId === editing.profile?.id)}
              onClose={() => setEditing(null)}
            />
          ) : null}
          {pausing ? (
            <PauseSheet
              profile={pausing}
              now={now}
              existing={pauses.data?.find((x) => x.profileId === pausing.id)}
              onClose={() => setPausing(null)}
            />
          ) : null}
        </>
      )}
    </Loaded>
  );
}

function Presets({ onPick }: { onPick: (k: PresetKey) => void }) {
  return (
    <div className="presets">
      {(Object.entries(PRESETS) as [keyof typeof PRESETS, (typeof PRESETS)[keyof typeof PRESETS]][]).map(([k, p]) => (
        <button type="button" className="preset" key={k} onClick={() => onPick(k)}>
          <b>{p.label}</b>
          <span>{p.note}</span>
        </button>
      ))}
      <button type="button" className="preset" onClick={() => onPick('')}>
        <b>From scratch</b>
        <span>Pick everything yourself</span>
      </button>
    </div>
  );
}

interface CardProps {
  profile: Profile;
  clients: Client[];
  now: Date;
  enforced: boolean;
  pause: Pause | undefined;
  pauseAvailable: boolean;
  onToggle: (on: boolean) => void;
  onEdit: () => void;
  onPause: () => void;
  onResume: () => void;
}

function ProfileState({ profile: p, now, enforced, pause }: { profile: Profile; now: Date; enforced: boolean; pause: Pause | undefined }) {
  if (!p.enabled) return <ToneText tone="off">Profile off</ToneText>;
  if (!enforced) return <ToneText tone="off">Not enforced</ToneText>;
  if (pause) return <ToneText tone="warn">Paused{pause.until ? ` until ${clock(pause.until)}` : ''}</ToneText>;
  const bed = bedtimeAt(p, now);
  if (bed) return <ToneText tone="warn">Bedtime until {minClock(bed.until % 1440)}</ToneText>;
  return <ToneText tone="ok">Internet allowed</ToneText>;
}

const blockedSummary = (p: Profile) =>
  [
    p.categories.length && plural(p.categories.length, 'category', 'categories'),
    p.apps.length && plural(p.apps.length, 'app'),
    p.sites.length && plural(p.sites.length, 'site'),
  ]
    .filter(Boolean)
    .join(', ') || 'Nothing blocked';

function ProfileDevices({ macs, clients }: { macs: string[]; clients: Client[] }) {
  const byMac = new Map(clients.map((c) => [c.mac, c]));
  if (!macs.length) return <span className="muted">No devices</span>;
  return (
    <>
      {macs.map((mac) => {
        const d = byMac.get(mac);
        return d ? (
          <span
            key={mac}
            className={`pdev${d.online ? ' on' : ''}`}
            title={`${d.name}${d.online ? `, ${rateText(d.rx)} down now` : ', offline'}`}
          >
            <DeviceIcon client={d} size={14} />
            <span>{d.name}</span>
          </span>
        ) : (
          <span key={mac} className="pdev">
            <span className="mono">{mac}</span>
          </span>
        );
      })}
    </>
  );
}

function ProfileCard({ profile: p, clients, now, enforced, pause, pauseAvailable, onToggle, onEdit, onPause, onResume }: CardProps) {
  const macs = new Set(p.macs);
  const online = clients.filter((c) => c.online && macs.has(c.mac));
  return (
    <article className={`panel profile${p.enabled ? '' : ' is-off'}`}>
      <div className="profile-head">
        <div>
          <h2>{p.name}</h2>
          <div className="profile-state">
            <ProfileState profile={p} now={now} enforced={enforced} pause={pause} />
          </div>
        </div>
        <Switch checked={p.enabled} label={`${p.name} on`} onChange={onToggle} />
      </div>
      <div className="profile-devices">
        <ProfileDevices macs={p.macs} clients={clients} />
      </div>
      <div className="profile-meta">
        <span>
          {online.length} of {p.macs.length} online{online.length ? `, ${rateText(online.reduce((n, d) => n + d.rx, 0))} now` : ''}
        </span>
        <span>{blockedSummary(p)}</span>
      </div>
      <WeekStrip profile={p} now={now} />
      <div className="profile-actions">
        {pause ? (
          <Button onClick={onResume}>Resume internet</Button>
        ) : (
          <Button
            onClick={onPause}
            disabled={!p.macs.length || !pauseAvailable}
            title={pauseAvailable ? undefined : 'Pausing needs OpenWrt access. Open Firewall rules once to unlock it.'}
          >
            Pause internet
          </Button>
        )}
        <Button variant="ghost" onClick={onEdit}>
          Edit
        </Button>
      </div>
    </article>
  );
}

/** Seven rows, 24 hours across, bedtime filled; a marker shows now. */
function WeekStrip({ profile, now }: { profile: Profile; now: Date }) {
  if (!profile.bedtimeOn) return <Note>No bedtime</Note>;
  const today = weekdayOf(now);
  const mNow = now.getUTCHours() * 60 + now.getUTCMinutes();
  return (
    <div className="wk" role="img" aria-label="Weekly bedtime">
      {([1, 2, 3, 4, 5, 6, 7] as const).map((day) => {
        const segs: [number, number][] = [];
        for (const [b, e] of windowsFor(profile, day)) segs.push(b < e ? [b, e] : [b, 1440]);
        for (const [b, e] of windowsFor(profile, day === 1 ? 7 : day - 1)) if (b > e) segs.push([0, e]);
        return (
          <div key={day} className={`wk-row${day === today ? ' today' : ''}`}>
            <span>{DAY[day]}</span>
            <div className="wk-track">
              {segs.map(([b, e]) => (
                <i key={`${b}-${e}`} style={{ left: `${b / 14.4}%`, width: `${(e - b) / 14.4}%` }} />
              ))}
              {day === today ? <b style={{ left: `${mNow / 14.4}%` }} /> : null}
            </div>
          </div>
        );
      })}
      <div className="wk-row wk-axis">
        <span />
        <div className="wk-ticks">
          {TICKS.map(([key, label], i) => (
            <span key={key} style={{ left: `${i * 25}%` }}>
              {label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function PauseSheet({
  profile,
  now,
  existing,
  onClose,
}: {
  profile: Profile;
  now: Date;
  existing: Pause | undefined;
  onClose: () => void;
}) {
  const { toast } = useFeedback();
  const morning = new Date(now);
  morning.setUTCDate(morning.getUTCDate() + (now.getUTCHours() >= 7 ? 1 : 0));
  morning.setUTCHours(7, 0, 0, 0);
  const options: [string, string, number | null][] = [
    ['15', '15 minutes', 15 * 60_000],
    ['60', '1 hour', 3_600_000],
    [
      'morning',
      `Until ${morning.toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'UTC' })}`,
      morning.getTime() - now.getTime(),
    ],
    ['manual', 'Until I resume', null],
  ];
  const [choice, setChoice] = useState('15');
  const pause = useWrite(({ until }: { until: Date | null }) => api.family.pause(profile, now, until, existing), [['family-pauses']]);
  return (
    <Sheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Pause ${profile.name}`}
      sub="Cuts internet and network access for every device in this profile. The router lifts it on its own when the time is up."
      save="Pause now"
      onSave={async () => {
        const ms = options.find(([v]) => v === choice)?.[2] ?? null;
        const until = ms === null ? null : new Date(now.getTime() + ms);
        await pause.mutateAsync({ until });
        toast(until ? `${profile.name} paused until ${clock(until)}` : `${profile.name} paused until you resume`);
      }}
    >
      <div className="pause-opts" role="radiogroup" aria-label="Pause for">
        {options.map(([v, label]) => (
          <label className="pause-opt" key={v}>
            <input type="radio" name="pause-for" value={v} checked={choice === v} onChange={() => setChoice(v)} />
            <span>{label}</span>
          </label>
        ))}
      </div>
    </Sheet>
  );
}

interface SheetProps {
  profile: Profile | null;
  preset: PresetKey;
  profiles: Profile[];
  clients: Client[];
  masterOn: boolean;
  pause: Pause | undefined;
  onClose: () => void;
}

/** The sheet's editable copy of a profile, with both bedtime layouts kept so switching between them loses nothing. */
function useProfileDraft(profile: Profile | null, preset: PresetDefaults | null) {
  const daily = dailyBedtime(profile, preset);
  const [v, setV] = useState<ProfileInput>(() => profile ?? newProfile(preset, daily));
  const [perDay, setPerDay] = useState<Bedtime[]>(() => weekBedtimes(profile, daily));
  const [everyday, setEveryday] = useState({ begin: daily.begin, end: daily.end });
  const [sites, setSites] = useState(() => v.sites.join('\n'));
  const set =
    <K extends keyof ProfileInput>(k: K) =>
    (value: ProfileInput[K]) =>
      setV((x) => ({ ...x, [k]: value }));
  return { v, set, perDay, setPerDay, everyday, setEveryday, sites, setSites };
}

/** Saving and deleting a profile. A first profile also turns parental control on; deleting lifts its pause. */
function useProfileWrites(profile: Profile | null, masterOn: boolean, pause: Pause | undefined, onClose: () => void) {
  const { toast, confirm } = useFeedback();
  const save = useWrite(
    async (input: ProfileInput) => {
      await api.family.save(input, profile?.id);
      if (!profile && !masterOn) await api.family.setEnabled(true);
    },
    [['family']],
  );
  const remove = useWrite(async () => {
    if (!profile) return;
    await api.family.remove(profile.id);
    if (pause) await api.family.resume([pause]);
  }, [['family'], ['family-pauses']]);
  async function deleteProfile() {
    if (!profile) return;
    if (
      !(await confirm({
        title: `Delete ${profile.name}?`,
        body: 'Its devices go back to unrestricted internet, and its bedtime and blocks are gone.',
        confirm: 'Delete profile',
      }))
    )
      return;
    try {
      await remove.mutateAsync(undefined);
      toast(`Deleted ${profile.name}`);
      onClose();
    } catch (err) {
      toast(errorMessage(err));
    }
  }

  return { save, deleteProfile };
}

function ProfileSheet({ profile, preset, profiles, clients, masterOn, pause, onClose }: SheetProps) {
  const { toast } = useFeedback();
  const p = preset ? PRESETS[preset] : null;
  const { v, set, perDay, setPerDay, everyday, setEveryday, sites, setSites } = useProfileDraft(profile, p);
  const { save, deleteProfile } = useProfileWrites(profile, masterOn, pause, onClose);

  return (
    <Sheet
      open
      wide
      onOpenChange={(o) => !o && onClose()}
      title={profile ? `Edit ${profile.name}` : `New profile${p ? `: ${p.label}` : ''}`}
      save={profile ? 'Save profile' : 'Create profile'}
      danger={profile ? { label: 'Delete profile', onClick: deleteProfile } : undefined}
      onSave={async () => {
        const input = buildProfile(
          v,
          sites,
          { everyday, perDay },
          profiles.filter((x) => x.id !== profile?.id),
        );
        await save.mutateAsync(input);
        toast(profile ? `Saved ${input.name}` : `Created ${input.name}${masterOn ? '' : ' and turned parental control on'}`);
      }}
    >
      <TextField label="Profile name" value={v.name} onChange={set('name')} placeholder="Maya" />
      <DevicePicker macs={v.macs} onChange={set('macs')} clients={clients} others={profiles.filter((x) => x.id !== profile?.id)} />
      <section className="group">
        <h3>Bedtime</h3>
        <SwitchRow label="No internet during bedtime" checked={v.bedtimeOn} onChange={set('bedtimeOn')} />
        <Segmented
          label="Days"
          value={v.bedtimeDays}
          onChange={set('bedtimeDays')}
          options={[
            ['everyday', 'Same every day'],
            ['customize', 'Different per day'],
          ]}
        />
        {v.bedtimeDays === 'everyday' ? (
          <Row2>
            <TextField label="Starts" type="time" value={everyday.begin} onChange={(begin) => setEveryday((x) => ({ ...x, begin }))} />
            <TextField label="Ends" type="time" value={everyday.end} onChange={(end) => setEveryday((x) => ({ ...x, end }))} />
          </Row2>
        ) : (
          <PerDayBedtime days={perDay} onChange={setPerDay} />
        )}
      </section>
      <section className="group">
        <h3>Block</h3>
        <ChipPicker legend="Categories" options={Object.entries(FAMILY_CATEGORIES)} value={v.categories} onChange={set('categories')} />
        <AppBlocker apps={v.apps} onChange={set('apps')} />
        <TextArea label="Block these websites, one per line" value={sites} onChange={setSites} mono rows={3} />
      </section>
      <SwitchRow label="Profile on" checked={v.enabled} onChange={set('enabled')} />
    </Sheet>
  );
}

function DevicePicker({
  macs,
  onChange,
  clients,
  others,
}: {
  macs: string[];
  onChange: (m: string[]) => void;
  clients: Client[];
  others: Profile[];
}) {
  const [q, setQ] = useState('');
  const taken = new Map(others.flatMap((x) => x.macs.map((m) => [m, x.name] as const)));
  const picked = new Set(macs);
  const needle = q.trim().toLowerCase();
  const devices = [...clients]
    .sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name))
    .filter((d) => !needle || `${d.name} ${d.ip} ${d.mac}`.toLowerCase().includes(needle));
  return (
    <section className="group">
      <h3>Devices</h3>
      <label className="search">
        <IconSearch size={16} stroke={1.75} />
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a device" aria-label="Find a device" />
      </label>
      <div className="dev-pick">
        {devices.map((d) => {
          const other = taken.get(d.mac);
          return (
            <label key={d.mac} className={`pick${other ? ' taken' : ''}`}>
              <input
                type="checkbox"
                checked={picked.has(d.mac)}
                disabled={Boolean(other)}
                onChange={(e) => onChange(e.target.checked ? [...macs, d.mac] : macs.filter((m) => m !== d.mac))}
              />
              <span className={`mark${d.online ? ' ok' : ''}`} />
              <DeviceIcon client={d} />
              <span className="pick-name">{d.name}</span>
              <span className="pick-sub">{other ? `In ${other}` : d.ip}</span>
            </label>
          );
        })}
      </div>
    </section>
  );
}

function PerDayBedtime({ days, onChange }: { days: Bedtime[]; onChange: (d: Bedtime[]) => void }) {
  const edit = (week: number, patch: Partial<Bedtime>) => onChange(days.map((y) => (y.week === week ? { ...y, ...patch } : y)));
  return (
    <div className="day-rows">
      {days.map((b) => {
        const day = DAY[b.week as keyof typeof DAY];
        return (
          <div className="day-row" key={b.week}>
            <label className="day-on">
              <input type="checkbox" checked={b.enabled} onChange={(e) => edit(b.week, { enabled: e.target.checked })} />
              <span>{day}</span>
            </label>
            <span className="box">
              <input type="time" value={b.begin} aria-label={`${day} starts`} onChange={(e) => edit(b.week, { begin: e.target.value })} />
            </span>
            <span className="muted">to</span>
            <span className="box">
              <input type="time" value={b.end} aria-label={`${day} ends`} onChange={(e) => edit(b.week, { end: e.target.value })} />
            </span>
          </div>
        );
      })}
    </div>
  );
}

function AppBlocker({ apps: chosen, onChange }: { apps: string[]; onChange: (a: string[]) => void }) {
  const list = useQuery({ queryKey: ['family-apps'], queryFn: api.family.apps, staleTime: Number.POSITIVE_INFINITY });
  const [q, setQ] = useState('');
  const catalog: AppEntry[] = list.data ?? [];
  const labels = new Map(catalog.map((a) => [a.name, a.label]));
  const picked = new Set(chosen);
  const needle = q.trim().toLowerCase();
  const hits = needle.length < 2 ? [] : catalog.filter((a) => a.label.toLowerCase().includes(needle) && !picked.has(a.name)).slice(0, 12);
  return (
    <>
      <label className="search">
        <IconSearch size={16} stroke={1.75} />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Block a specific app: TikTok, Roblox, YouTube…"
          aria-label="Find an app"
        />
      </label>
      {hits.length ? (
        <div className="app-results">
          {hits.map((a) => (
            <button
              type="button"
              className="app-hit"
              key={a.name}
              onClick={() => {
                onChange([...chosen, a.name]);
                setQ('');
              }}
            >
              <span>{a.label}</span>
              <span className="muted">{FAMILY_CATEGORIES[a.category as keyof typeof FAMILY_CATEGORIES] ?? a.category}</span>
            </button>
          ))}
        </div>
      ) : needle.length >= 2 ? (
        <Note>No app by that name. Add its website below instead.</Note>
      ) : null}
      {chosen.length ? (
        <div className="app-chips">
          {chosen.map((n) => (
            <button
              type="button"
              className="chip bad chip-remove"
              key={n}
              aria-label={`Unblock ${labels.get(n) ?? n}`}
              onClick={() => onChange(chosen.filter((x) => x !== n))}
            >
              {labels.get(n) ?? n} <IconX size={12} />
            </button>
          ))}
        </div>
      ) : null}
    </>
  );
}
