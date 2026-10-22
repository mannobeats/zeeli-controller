import { IconExternalLink, IconRefresh, IconRotateClockwise, IconSearch } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { FIRMWARE_CHECK, type LogKind, type RouterInfo, type RouterStatus, type WifiTimer } from '@zeeli/router-api';
import { type ReactNode, useState } from 'react';
import { useInfo, useStatus, useWrite } from '../../api/queries.ts';
import { api, isDemo } from '../../api/router.ts';
import { useSettings } from '../../api/useSettings.ts';
import { errorMessage } from '../../lib/errors.ts';
import { BAND_LABEL, bytes, duration } from '../../lib/format.ts';
import { Button } from '../../ui/Button.tsx';
import { useFeedback } from '../../ui/feedback.tsx';
import { Row2, Segmented, SelectField, SwitchRow, TextField, WeekPicker } from '../../ui/fields.tsx';
import { Chip, Grid, KeyValues, Meter, Note, PageHeader, Panel, Stack } from '../../ui/Layout.tsx';
import { Loaded } from '../../ui/Loading.tsx';
import { SettingsForm, useForm } from '../../ui/SettingsForm.tsx';

const hm = (h: string | undefined, m: string | undefined) => `${(h ?? '00').padStart(2, '0')}:${(m ?? '00').padStart(2, '0')}`;
const splitTime = (t: string) => {
  const [h = '00', m = '00'] = t.split(':');
  return [h, m] as const;
};

/* ======================= Device ======================= */

export function DevicePage() {
  return (
    <>
      <PageHeader title="Device" actions={<RebootButton />} />
      <Grid cols={2}>
        <RouterFacts />
        <HardwareSettings />
      </Grid>
    </>
  );
}

function RebootButton() {
  const { toast, confirm } = useFeedback();
  const reboot = useWrite(() => api.system.reboot(), []);
  async function run() {
    if (
      !(await confirm({
        title: 'Reboot the router?',
        body: 'Every device loses its connection for about two minutes while the router restarts.',
        confirm: 'Reboot',
      }))
    )
      return;
    try {
      await reboot.mutateAsync(undefined);
      toast('Rebooting. This page reconnects when the router is back.');
    } catch (err) {
      toast(errorMessage(err));
    }
  }
  return (
    <Button variant="danger" icon={<IconRotateClockwise size={16} />} onClick={run}>
      Reboot router
    </Button>
  );
}

type Rows = [string, ReactNode][];

const infoRows = (info: RouterInfo | undefined): Rows => [
  ['Model', info?.model ?? ''],
  ['Firmware', info?.firmware ?? ''],
  ['OpenWrt', info?.openwrt ?? ''],
  ['Kernel', info?.kernel ?? ''],
  ['CPU', `${info?.architecture ?? ''}, ${info?.cpuCount ?? '?'} cores`],
];

function statusRows(status: RouterStatus): Rows {
  const used = status.memory.total - status.memory.free - status.memory.cache;
  const stored = status.flash.total - status.flash.free;
  return [
    ['Uptime', duration(status.uptime)],
    [
      'Memory',
      <>
        {bytes(used)} of {bytes(status.memory.total)}
        <Meter value={used / status.memory.total} />
      </>,
    ],
    ['Storage', `${bytes(stored)} of ${bytes(status.flash.total)}`],
    ['Temperature', status.cpuTemp === null ? '–' : `${status.cpuTemp} °C`],
  ];
}

function RouterFacts() {
  const info = useInfo().data;
  const status = useStatus().data;
  const fan = useQuery({ queryKey: ['fan'], queryFn: api.system.fan });
  const rows = infoRows(info);
  if (status) rows.push(...statusRows(status));
  if (fan.data) rows.push(['Fan', fan.data.status ? `${fan.data.speed} rpm` : 'Off']);
  rows.push([
    'Serial number',
    <span key="sn" className="mono">
      {info?.serial ?? ''}
    </span>,
  ]);
  return (
    <Panel title="Router">
      <KeyValues rows={rows} />
    </Panel>
  );
}

function HardwareSettings() {
  const fanCfg = useSettings('fan-config', api.device.fan);
  const led = useSettings('led', api.device.led);
  const usb = useSettings('usb', api.device.usb);
  const usbChoices = useQuery({ queryKey: ['usb-choices'], queryFn: api.device.usbChoices });
  return (
    <Stack>
      <Loaded query={fanCfg.query} title="">
        {(f) => <FanForm temp={f.temperature} save={(t) => fanCfg.save({ temperature: t })} />}
      </Loaded>
      <Loaded query={led.query} title="">
        {(l) => <LedForm on={l.led_enable} save={(on) => led.save({ led_enable: on })} />}
      </Loaded>
      {usbChoices.data?.length ? (
        <Loaded query={usb.query} title="">
          {(u) => <UsbForm value={u.protocol} choices={usbChoices.data} save={(p) => usb.save({ protocol: p })} />}
        </Loaded>
      ) : null}
    </Stack>
  );
}

function FanForm({ temp, save }: { temp: number; save: (t: number) => Promise<unknown> }) {
  const form = useForm({ temp: String(temp) });
  return (
    <SettingsForm
      title="Fan"
      form={form}
      onSave={async () => {
        const t = Number(form.values.temp);
        if (!(t >= 50 && t <= 100)) throw new Error('Pick a temperature from 50 to 100 °C.');
        await save(t);
        return `The fan starts at ${t} °C`;
      }}
    >
      <TextField
        label="Start the fan at"
        unit="°C"
        inputMode="numeric"
        value={form.values.temp}
        onChange={(x) => form.set('temp', x)}
        hint="The fan runs when the CPU reaches this temperature."
      />
    </SettingsForm>
  );
}

function LedForm({ on, save }: { on: boolean; save: (on: boolean) => Promise<unknown> }) {
  const form = useForm({ on });
  return (
    <SettingsForm
      title="Status light"
      form={form}
      onSave={async () => {
        await save(form.values.on);
        return `LED ${form.values.on ? 'on' : 'off'}`;
      }}
    >
      <SwitchRow label="LED on" checked={form.values.on} onChange={(x) => form.set('on', x)} />
    </SettingsForm>
  );
}

function UsbForm({
  value,
  choices,
  save,
}: {
  value: string;
  choices: { value: string; label: string }[];
  save: (p: string) => Promise<unknown>;
}) {
  const form = useForm({ value });
  return (
    <SettingsForm
      title="USB port"
      form={form}
      onSave={async () => {
        await save(form.values.value);
        return 'USB speed saved';
      }}
    >
      <SelectField
        label="Speed"
        value={form.values.value}
        options={choices.map((c) => [c.value, c.label] as const)}
        onChange={(x) => form.set('value', x)}
        hint="USB 3.0 can interfere with 2.4 GHz WiFi."
      />
    </SettingsForm>
  );
}

/* ======================= Firmware ======================= */

export function FirmwarePage() {
  const { toast, confirm } = useFeedback();
  const fw = useQuery({ queryKey: ['firmware'], queryFn: api.device.firmware });
  const checks = useSettings('firmware-checks', api.device.firmwareChecks);
  const install = useWrite(() => api.device.installOnline(), []);
  const [file, setFile] = useState<{
    name: string;
    result?: Awaited<ReturnType<typeof api.device.checkFile>>;
    error?: string;
    busy: boolean;
  } | null>(null);
  const [keep, setKeep] = useState(true);

  async function pick(f: File) {
    setFile({ name: f.name, busy: true });
    try {
      const result = await api.device.checkFile(f);
      setFile({ name: f.name, result, busy: false });
      setKeep(result.status === 0);
    } catch (err) {
      setFile({ name: f.name, error: errorMessage(err), busy: false });
    }
  }

  return (
    <Loaded query={fw} title="Firmware">
      {(f) => (
        <>
          <PageHeader
            title="Firmware"
            actions={
              <Button icon={<IconRefresh size={16} />} onClick={() => fw.refetch()}>
                Check again
              </Button>
            }
          />
          <Stack>
            <Panel
              title={f.available ? `Version ${f.available} is available` : 'Up to date'}
              actions={f.available ? <Chip tone="warn">Update</Chip> : <Chip tone="ok">Latest</Chip>}
            >
              <KeyValues
                rows={[
                  ['Installed', `${f.current} ${f.currentType}, built ${f.built}`],
                  ...(f.available ? ([['New version', f.available]] as [string, string][]) : []),
                ]}
              />
              {f.available && f.notes ? <pre className="log">{f.notes}</pre> : null}
              {f.available ? (
                <div className="row-actions start">
                  <Button
                    variant="strong"
                    busy={install.isPending}
                    onClick={async () => {
                      if (
                        !(await confirm({
                          title: `Install firmware ${f.available}?`,
                          body: 'The router downloads the update, installs it and restarts, keeping your settings. Every device is offline for several minutes. Don’t unplug it.',
                          confirm: 'Install and restart',
                          danger: false,
                        }))
                      )
                        return;
                      await install.mutateAsync(undefined).then(
                        () => toast('Downloading the update. The router restarts when it’s ready.'),
                        (e) => toast(errorMessage(e)),
                      );
                    }}
                  >
                    Install {f.available}
                  </Button>
                </div>
              ) : null}
            </Panel>
            <Loaded query={checks.query} title="">
              {(c) => <ChecksForm cfg={c} save={checks.save} />}
            </Loaded>
            <Panel title="Install from a file" note="A .bin or .img from your router maker or an OpenWrt build">
              <label className="input">
                Firmware file
                <span className="box">
                  <input type="file" accept=".bin,.img" onChange={(e) => e.target.files?.[0] && pick(e.target.files[0])} />
                </span>
              </label>
              {file?.busy ? <Note>Uploading and checking {file.name}. This can take a minute…</Note> : null}
              {file?.error ? <p className="form-error">{file.error}</p> : null}
              {file?.result ? <FileResult result={file.result} keep={keep} setKeep={setKeep} /> : null}
            </Panel>
          </Stack>
        </>
      )}
    </Loaded>
  );
}

function FileResult({
  result,
  keep,
  setKeep,
}: {
  result: Awaited<ReturnType<typeof api.device.checkFile>>;
  keep: boolean;
  setKeep: (k: boolean) => void;
}) {
  const { toast, confirm } = useFeedback();
  const check = FIRMWARE_CHECK[result.status];
  const install = useWrite(() => api.device.installFile(keep), []);
  return (
    <>
      <KeyValues
        rows={[
          ['Version', `${result.version ?? 'Unknown'} ${result.firmware_type ?? ''}`],
          [
            'SHA-256',
            <span key="h" className="mono hash">
              {result.sha256 ?? ''}
            </span>,
          ],
        ]}
      />
      {check ? <Note>{check.text}</Note> : null}
      {check?.blocks ? null : (
        <>
          <SwitchRow
            label="Keep settings and installed packages"
            hint={result.status === 0 ? undefined : 'Off is safer for this file.'}
            checked={keep}
            onChange={setKeep}
          />
          <div className="row-actions start">
            <Button
              variant="strong"
              busy={install.isPending}
              onClick={async () => {
                if (
                  !(await confirm({
                    title: `Install ${result.version ?? 'this firmware'}?`,
                    body: `The router installs it and restarts${keep ? ', keeping your settings' : ' with factory settings, at its factory address'}. Every device is offline for several minutes. Don’t unplug it.`,
                    confirm: 'Install and restart',
                    danger: !keep,
                  }))
                )
                  return;
                await install.mutateAsync(undefined).then(
                  () => toast('Installing. The router restarts when it’s done.'),
                  (e) => toast(errorMessage(e)),
                );
              }}
            >
              Install {result.version ?? 'this file'}
            </Button>
          </div>
        </>
      )}
    </>
  );
}

function ChecksForm({ cfg, save }: { cfg: { upgrade_enable: boolean; prompt: boolean }; save: (v: typeof cfg) => Promise<unknown> }) {
  const form = useForm(cfg);
  return (
    <SettingsForm
      title="Update checks"
      form={form}
      onSave={async () => {
        await save(form.values);
        return 'Update checks saved';
      }}
    >
      <SwitchRow label="Check for updates online" checked={form.values.upgrade_enable} onChange={(x) => form.set('upgrade_enable', x)} />
      <SwitchRow label="Tell me when an update is out" checked={form.values.prompt} onChange={(x) => form.set('prompt', x)} />
    </SettingsForm>
  );
}

/* ======================= Schedules ======================= */

export function SchedulesPage() {
  const reboot = useSettings('reboot-timer', api.device.reboot);
  const led = useSettings('led-timer', api.device.ledTimer);
  const wifi = useQuery({ queryKey: ['wifi-timers'], queryFn: api.device.wifiTimers });
  return (
    <>
      <PageHeader title="Schedules" sub="Things the router does on its own, on a timetable." />
      <Stack>
        <Loaded query={reboot.query} title="">
          {(r) => <RebootForm cfg={r} save={reboot.save} />}
        </Loaded>
        <Loaded query={led.query} title="">
          {(l) => <LedTimerForm cfg={l} save={led.save} />}
        </Loaded>
        {(wifi.data ?? [])
          .filter((w) => !w.guest)
          .map((w) => (
            <WifiTimerForm key={w.band} timer={w} all={wifi.data ?? []} />
          ))}
      </Stack>
    </>
  );
}

function RebootForm({
  cfg,
  save,
}: {
  cfg: { enable: boolean; hour?: string; min?: string; week?: number[] };
  save: (v: Partial<typeof cfg>) => Promise<unknown>;
}) {
  const form = useForm({ enable: cfg.enable, time: hm(cfg.hour, cfg.min), week: (cfg.week ?? []).map(Number) });
  const v = form.values;
  return (
    <SettingsForm
      title="Scheduled reboot"
      form={form}
      onSave={async () => {
        if (v.enable && !v.week.length) throw new Error('Pick at least one day.');
        const [hour, min] = splitTime(v.time);
        await save(v.enable ? { enable: true, hour, min, week: v.week } : { enable: false });
        return v.enable ? `Reboots at ${v.time}` : 'Scheduled reboot off';
      }}
    >
      <SwitchRow label="Reboot on a schedule" checked={v.enable} onChange={(x) => form.set('enable', x)} />
      <TextField label="Time" type="time" value={v.time} onChange={(x) => form.set('time', x)} />
      <WeekPicker value={v.week} onChange={(x) => form.set('week', x)} />
    </SettingsForm>
  );
}

function LedTimerForm({
  cfg,
  save,
}: {
  cfg: { enable: boolean; week: number[]; turnoff_hour?: string; turnoff_min?: string; turnon_hour?: string; turnon_min?: string };
  save: (v: Partial<typeof cfg>) => Promise<unknown>;
}) {
  const form = useForm({
    enable: cfg.enable,
    off: hm(cfg.turnoff_hour, cfg.turnoff_min),
    on: hm(cfg.turnon_hour, cfg.turnon_min),
    week: cfg.week.map(Number),
  });
  const v = form.values;
  return (
    <SettingsForm
      title="LED schedule"
      form={form}
      onSave={async () => {
        if (v.enable && v.on === v.off) throw new Error('On and off times must differ.');
        const [turnoff_hour, turnoff_min] = splitTime(v.off);
        const [turnon_hour, turnon_min] = splitTime(v.on);
        await save({ enable: v.enable, week: v.week, ...(v.enable ? { turnoff_hour, turnoff_min, turnon_hour, turnon_min } : {}) });
        return 'LED schedule saved';
      }}
    >
      <NightSchedule label="Turn the LED off at night" form={form} />
    </SettingsForm>
  );
}

/** The on switch, off and on times and days shared by the LED and WiFi night schedules. */
function NightSchedule({
  label,
  form,
}: {
  label: string;
  form: ReturnType<typeof useForm<{ enable: boolean; off: string; on: string; week: number[] }>>;
}) {
  const v = form.values;
  return (
    <>
      <SwitchRow label={label} checked={v.enable} onChange={(x) => form.set('enable', x)} />
      <Row2>
        <TextField label="Off at" type="time" value={v.off} onChange={(x) => form.set('off', x)} />
        <TextField label="On at" type="time" value={v.on} onChange={(x) => form.set('on', x)} />
      </Row2>
      <WeekPicker value={v.week} onChange={(x) => form.set('week', x)} />
    </>
  );
}

function WifiTimerForm({ timer, all }: { timer: WifiTimer; all: WifiTimer[] }) {
  const band = BAND_LABEL[timer.band] ?? timer.band;
  const form = useForm({
    enable: timer.enable,
    off: hm(timer.turnoff_hour, timer.turnoff_min),
    on: hm(timer.turnon_hour, timer.turnon_min),
    week: timer.week.map(Number),
  });
  const save = useWrite((t: WifiTimer) => api.device.setWifiTimer(all, t), [['wifi-timers']]);
  const v = form.values;
  return (
    <SettingsForm
      title={`${band} WiFi schedule`}
      note={all.some((g) => g.guest && g.band === timer.band) ? 'Guest WiFi on this band keeps its own schedule' : undefined}
      form={form}
      onSave={async () => {
        if (v.enable && v.on === v.off) throw new Error('On and off times must differ.');
        if (v.enable && !v.week.length) throw new Error('Pick at least one day.');
        const [turnoff_hour, turnoff_min] = splitTime(v.off);
        const [turnon_hour, turnon_min] = splitTime(v.on);
        await save.mutateAsync({ ...timer, enable: v.enable, week: v.week, turnoff_hour, turnoff_min, turnon_hour, turnon_min });
        return v.enable ? `${band} turns off at ${v.off}` : `${band} schedule off`;
      }}
    >
      <NightSchedule label={`Turn ${band} off at night`} form={form} />
    </SettingsForm>
  );
}

/* ======================= Time ======================= */

export function TimePage() {
  const tz = useSettings('timezone', api.device.timezone);
  const zones = useQuery({ queryKey: ['timezones'], queryFn: api.device.timezones, staleTime: Number.POSITIVE_INFINITY });
  return (
    <Loaded query={tz.query} title="Time zone">
      {(c) => (
        <>
          <PageHeader title="Time zone" />
          <TimeForm cfg={c} zones={zones.data ?? []} save={tz.save} />
        </>
      )}
    </Loaded>
  );
}

function TimeForm({
  cfg,
  zones,
  save,
}: {
  cfg: { zonename: string; timezone: string; autotimezone_enabled: boolean; tzoffset?: string };
  zones: { zonename: string; timezone: string }[];
  save: (v: Partial<typeof cfg>) => Promise<unknown>;
}) {
  const form = useForm({ auto: cfg.autotimezone_enabled, zone: cfg.zonename });
  const list = zones.some((z) => z.zonename === cfg.zonename) ? zones : [{ zonename: cfg.zonename, timezone: cfg.timezone }, ...zones];
  return (
    <SettingsForm
      title="Time zone"
      note={cfg.tzoffset ? `UTC${cfg.tzoffset}` : undefined}
      form={form}
      onSave={async () => {
        const z = list.find((x) => x.zonename === form.values.zone);
        if (!z) throw new Error('Pick a time zone.');
        await save({ zonename: z.zonename, timezone: z.timezone, autotimezone_enabled: form.values.auto });
        return `Time zone set to ${z.zonename.replace(/_/g, ' ')}`;
      }}
    >
      <SwitchRow label="Set the time zone automatically" checked={form.values.auto} onChange={(x) => form.set('auto', x)} />
      <SelectField
        label="Time zone"
        value={form.values.zone}
        options={list.map((z) => [z.zonename, z.zonename.replace(/_/g, ' ')] as const)}
        onChange={(x) => form.set('zone', x)}
      />
    </SettingsForm>
  );
}

/* ======================= Logs ======================= */

const LOGS: [LogKind, string][] = [
  ['system', 'System'],
  ['kernel', 'Kernel'],
  ['crash', 'Crashes'],
  ['nginx', 'Web server'],
];

export function LogsPage() {
  const [kind, setKind] = useState<LogKind>('system');
  const [filter, setFilter] = useState('');
  const log = useQuery({ queryKey: ['log', kind], queryFn: () => api.device.log(kind) });
  const lines = (log.data ?? '').split('\n').filter((l) => l && (!filter || l.toLowerCase().includes(filter.toLowerCase())));
  return (
    <>
      <PageHeader
        title="Logs"
        actions={
          <Button icon={<IconRefresh size={16} />} onClick={() => log.refetch()}>
            Refresh
          </Button>
        }
      />
      <Panel>
        <div className="toolbar">
          <Segmented label="Log" value={kind} options={LOGS} onChange={setKind} />
          <label className="search">
            <IconSearch size={16} stroke={1.75} />
            <input
              type="search"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter lines"
              aria-label="Filter log lines"
            />
          </label>
        </div>
        <pre className="log">{log.isLoading ? 'Loading…' : lines.length ? lines.slice(-800).join('\n') : 'Nothing logged.'}</pre>
        <Note>
          {lines.length} lines{lines.length > 800 ? ', showing the last 800' : ''}.
        </Note>
      </Panel>
    </>
  );
}

/* ======================= Admin and access ======================= */

export function AdminPage() {
  const { toast } = useFeedback();
  const luci = useQuery({ queryKey: ['luci-installed'], queryFn: api.device.luciInstalled });
  const install = useWrite(() => api.device.installLuci(), [['luci-installed']]);
  const form = useForm({ old: '', next: '', again: '' });
  const v = form.values;
  return (
    <>
      <PageHeader title="Admin and access" sub="Who can manage this router." />
      <Stack>
        <SettingsForm
          title="Admin password"
          form={form}
          save="Change password"
          onSave={async () => {
            if (v.next.length < 8) throw new Error('Use at least 8 characters.');
            if (v.next !== v.again) throw new Error('The two new passwords don’t match.');
            if (v.next === v.old) throw new Error('The new password is the same as the current one.');
            await api.device.changePassword(v.old, v.next);
            setTimeout(() => api.session.logout().then(() => location.reload()), 1500);
            return 'Password changed. Sign in again with the new one.';
          }}
        >
          <TextField label="Current password" type="password" value={v.old} onChange={(x) => form.set('old', x)} />
          <TextField
            label="New password"
            type="password"
            value={v.next}
            onChange={(x) => form.set('next', x)}
            hint="This is also the root password for SSH and LuCI."
          />
          <TextField label="New password again" type="password" value={v.again} onChange={(x) => form.set('again', x)} />
        </SettingsForm>
        <Panel title="LuCI" actions={luci.data ? <Chip tone="ok">Installed</Chip> : <span className="tone-off">Not installed</span>}>
          <Note>OpenWrt’s own web interface. This console already uses it underneath for firewall rules, routes, leases and packages.</Note>
          <div className="row-actions start">
            {luci.data ? (
              <a className="btn default" href={isDemo ? '#admin' : '/cgi-bin/luci'} target="_blank" rel="noopener noreferrer">
                Open LuCI <IconExternalLink size={14} />
              </a>
            ) : (
              <Button
                variant="strong"
                busy={install.isPending}
                onClick={() =>
                  install.mutateAsync(undefined).then(
                    () => toast('LuCI installed'),
                    (e) => toast(errorMessage(e)),
                  )
                }
              >
                Install LuCI
              </Button>
            )}
          </div>
        </Panel>
        <Note>Ports for the admin pages and SSH, and access from the internet, are in Security → Remote management.</Note>
      </Stack>
    </>
  );
}

/* ======================= Operating mode ======================= */

export function ModePage() {
  const mode = useQuery({ queryKey: ['netmode'], queryFn: api.networkExtras.mode });
  return (
    <>
      <PageHeader title="Operating mode" />
      <Panel title={`This router runs in ${mode.data ?? '…'} mode`}>
        <Note>
          Router mode gives you everything in this console. Access point, extender, WDS and bridge modes hand routing to another device,
          change this router’s address and turn off most features. Switching needs a guided setup with the other device, so it stays in the
          firmware’s own setup for now.
        </Note>
      </Panel>
    </>
  );
}

/* ======================= Factory reset ======================= */

export function ResetPage() {
  const { toast, confirm } = useFeedback();
  const form = useForm({ typed: '' });
  return (
    <>
      <PageHeader title="Factory reset" />
      <SettingsForm
        title="Erase every setting"
        form={form}
        save="Reset to factory settings"
        onSave={async () => {
          if (form.values.typed !== 'RESET') throw new Error('Type RESET in capitals to confirm.');
          if (
            !(await confirm({
              title: 'Reset the router now?',
              body: 'This can’t be undone. The router restarts with factory settings and every device disconnects.',
              confirm: 'Reset router',
            }))
          )
            return false;
          await api.device.reset();
          toast('Resetting. The router restarts with factory settings.');
          return undefined;
        }}
      >
        <Note>
          The router goes back to how it shipped: WiFi names and passwords, the admin password, VLANs, reservations, VPN, and this console
          (it lives in the router’s storage) are all erased.
        </Note>
        <TextField label="Type RESET to confirm" value={form.values.typed} onChange={(x) => form.set('typed', x)} placeholder="RESET" />
      </SettingsForm>
    </>
  );
}
