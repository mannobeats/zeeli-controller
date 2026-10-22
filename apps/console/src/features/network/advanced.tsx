import { type Ipv6Config, isIpv6, type NetNat, QOS_CATEGORIES, type QosConfig, type QosLevel, type SqmConfig } from '@zeeli/router-api';
import { api } from '../../api/router.ts';
import { useSettings } from '../../api/useSettings.ts';
import { useFeedback } from '../../ui/feedback.tsx';
import { Row2, SelectField, SwitchRow, TextField } from '../../ui/fields.tsx';
import { PageHeader, Stack } from '../../ui/Layout.tsx';
import { Loaded } from '../../ui/Loading.tsx';
import { SettingsForm, useForm } from '../../ui/SettingsForm.tsx';

const mbpsOk = (v: string) => Number(v) >= 1 && Number(v) <= 10_000;

/* ---------- QoS ---------- */

export function QosPage() {
  const { query, save } = useSettings('qos', api.traffic.qos);
  return (
    <Loaded query={query} title="QoS">
      {(cfg) => (
        <>
          <PageHeader title="QoS" sub="Gives some kinds of traffic priority when the line is busy." />
          <QosForm cfg={cfg} save={save} />
        </>
      )}
    </Loaded>
  );
}

function QosForm({ cfg, save }: { cfg: QosConfig; save: (v: Partial<QosConfig>) => Promise<QosConfig> }) {
  const level = (c: string): QosLevel => (['high', 'middle', 'low'] as const).find((l) => cfg[l].includes(c)) ?? 'middle';
  const form = useForm({
    enable: cfg.enable,
    download: cfg.download,
    upload: cfg.upload,
    levels: Object.fromEntries(Object.keys(QOS_CATEGORIES).map((c) => [c, level(c)])) as Record<string, QosLevel>,
  });
  const v = form.values;
  return (
    <SettingsForm
      title="Priorities"
      form={form}
      onSave={async () => {
        if (v.enable && !(mbpsOk(v.download) && mbpsOk(v.upload))) throw new Error('Enter your line speeds, 1 to 10000 Mbps.');
        const by = (l: QosLevel) => Object.keys(QOS_CATEGORIES).filter((k) => v.levels[k] === l);
        await save({ enable: v.enable, download: v.download, upload: v.upload, high: by('high'), middle: by('middle'), low: by('low') });
        return v.enable ? 'QoS saved' : 'QoS off';
      }}
    >
      <SwitchRow label="QoS on" checked={v.enable} onChange={(x) => form.set('enable', x)} />
      <Row2>
        <TextField
          label="Your download speed"
          unit="Mbps"
          inputMode="numeric"
          hint="About 90% of a speed test"
          value={v.download}
          onChange={(x) => form.set('download', x)}
        />
        <TextField label="Your upload speed" unit="Mbps" inputMode="numeric" value={v.upload} onChange={(x) => form.set('upload', x)} />
      </Row2>
      <div className="level-grid">
        {Object.entries(QOS_CATEGORIES).map(([k, label]) => (
          <SelectField
            key={k}
            label={label}
            value={v.levels[k] ?? 'middle'}
            options={[
              ['high', 'High'],
              ['middle', 'Normal'],
              ['low', 'Low'],
            ]}
            onChange={(l) => form.set('levels', { ...v.levels, [k]: l })}
          />
        ))}
      </div>
    </SettingsForm>
  );
}

/* ---------- SQM ---------- */

export function SqmPage() {
  const { query, save } = useSettings('sqm', api.traffic.sqm);
  return (
    <Loaded query={query} title="SQM">
      {(cfg) => (
        <>
          <PageHeader title="SQM" sub="Smart queue management keeps latency low while the line is busy (fixes bufferbloat)." />
          <SqmForm cfg={cfg} save={save} />
        </>
      )}
    </Loaded>
  );
}

function SqmForm({ cfg, save }: { cfg: SqmConfig; save: (v: Partial<SqmConfig>) => Promise<SqmConfig> }) {
  const form = useForm({ enable: cfg.enable, download: cfg.download, upload: cfg.upload, qdisc: cfg.qdisc });
  const v = form.values;
  return (
    <SettingsForm
      title="SQM"
      form={form}
      onSave={async () => {
        if (v.enable && !(mbpsOk(v.download) && mbpsOk(v.upload))) throw new Error('Enter limits from 1 to 10000 Mbps.');
        await save(v);
        return v.enable ? 'SQM on' : 'SQM off';
      }}
    >
      <SwitchRow label="SQM on" checked={v.enable} onChange={(x) => form.set('enable', x)} />
      <Row2>
        <TextField
          label="Download limit"
          unit="Mbps"
          inputMode="numeric"
          hint="A little below your real speed"
          value={v.download}
          onChange={(x) => form.set('download', x)}
        />
        <TextField label="Upload limit" unit="Mbps" inputMode="numeric" value={v.upload} onChange={(x) => form.set('upload', x)} />
      </Row2>
      <SelectField
        label="Queue"
        value={v.qdisc}
        options={[
          ['cake', 'CAKE (recommended)'],
          ['fq_codel', 'fq_codel'],
        ]}
        onChange={(x) => form.set('qdisc', x)}
      />
    </SettingsForm>
  );
}

/* ---------- IPv6 ---------- */

const IPV6_MODES: [Ipv6Config['lan_mode'], string][] = [
  ['nat6', 'NAT6: one shared address, works everywhere'],
  ['relay', 'Relay: devices get public addresses from upstream'],
  ['native', 'Native: a routed prefix from your provider'],
  ['static', 'Static prefix'],
];

export function Ipv6Page() {
  const { query, save } = useSettings('ipv6', api.networkExtras.ipv6);
  return (
    <Loaded query={query} title="IPv6">
      {(cfg) => (
        <>
          <PageHeader title="IPv6" />
          <Ipv6Form cfg={cfg} save={save} />
        </>
      )}
    </Loaded>
  );
}

function Ipv6Form({ cfg, save }: { cfg: Ipv6Config; save: (v: Partial<Ipv6Config>) => Promise<Ipv6Config> }) {
  const form = useForm({
    enable: cfg.enable,
    lan_mode: cfg.lan_mode,
    lan_ip: cfg.lan_ip ?? '',
    lan_dns_mode: cfg.lan_dns_mode,
    lan_dns1: cfg.lan_dns1 ?? '',
    lan_dns2: cfg.lan_dns2 ?? '',
  });
  const v = form.values;
  return (
    <SettingsForm
      title="IPv6"
      form={form}
      onSave={async () => {
        const p: Partial<Ipv6Config> = { enable: v.enable };
        if (v.enable) {
          Object.assign(p, { lan_mode: v.lan_mode, lan_dns_mode: v.lan_dns_mode });
          if (v.lan_mode === 'static') p.lan_ip = v.lan_ip;
          if (!v.lan_dns_mode) {
            if (!isIpv6(v.lan_dns1)) throw new Error('Enter at least one IPv6 DNS server.');
            p.lan_dns1 = v.lan_dns1;
            if (v.lan_dns2) p.lan_dns2 = v.lan_dns2;
          }
        }
        await save(p);
        return v.enable ? 'IPv6 saved' : 'IPv6 off';
      }}
    >
      <SwitchRow label="IPv6 on" checked={v.enable} onChange={(x) => form.set('enable', x)} />
      {v.enable ? (
        <>
          <SelectField label="Give LAN devices IPv6 by" value={v.lan_mode} options={IPV6_MODES} onChange={(x) => form.set('lan_mode', x)} />
          {v.lan_mode === 'static' ? <TextField label="LAN prefix" mono value={v.lan_ip} onChange={(x) => form.set('lan_ip', x)} /> : null}
          <SwitchRow
            label="Hand out the router as the IPv6 DNS server"
            checked={v.lan_dns_mode}
            onChange={(x) => form.set('lan_dns_mode', x)}
          />
          {v.lan_dns_mode ? null : (
            <Row2>
              <TextField label="DNS server 1" mono value={v.lan_dns1} onChange={(x) => form.set('lan_dns1', x)} />
              <TextField label="DNS server 2" mono value={v.lan_dns2} onChange={(x) => form.set('lan_dns2', x)} />
            </Row2>
          )}
        </>
      ) : null}
    </SettingsForm>
  );
}

/* ---------- IGMP ---------- */

export function IgmpPage() {
  const { query, save } = useSettings('igmp', api.networkExtras.igmp);
  return (
    <Loaded query={query} title="IGMP snooping">
      {(cfg) => (
        <>
          <PageHeader title="IGMP snooping" />
          <IgmpForm cfg={cfg} save={save} />
        </>
      )}
    </Loaded>
  );
}

function IgmpForm({
  cfg,
  save,
}: {
  cfg: { enable: boolean; version: number };
  save: (v: { enable: boolean; version: number }) => Promise<unknown>;
}) {
  const form = useForm({ enable: cfg.enable, version: cfg.version });
  return (
    <SettingsForm
      title="IGMP snooping"
      form={form}
      onSave={async () => {
        await save(form.values);
        return `IGMP snooping ${form.values.enable ? 'on' : 'off'}`;
      }}
    >
      <SwitchRow
        label="IGMP snooping on"
        hint="Sends multicast (IPTV, speakers, casting) only to the devices that asked for it."
        checked={form.values.enable}
        onChange={(x) => form.set('enable', x)}
      />
      <SelectField
        label="Version"
        value={form.values.version}
        options={[
          [2, 'IGMPv2'],
          [3, 'IGMPv3'],
        ]}
        onChange={(x) => form.set('version', x)}
      />
    </SettingsForm>
  );
}

/* ---------- acceleration and NAT ---------- */

export function AccelPage() {
  const accel = useSettings('netnat', api.networkExtras.acceleration);
  const nat = useSettings('nat', api.networkExtras.nat);
  return (
    <Loaded query={accel.query} title="NAT and acceleration">
      {(a) => (
        <>
          <PageHeader title="NAT and acceleration" />
          <Stack>
            <AccelForm cfg={a} save={accel.save} />
            <Loaded query={nat.query} title="">
              {(n) => <NatForm cfg={n} save={nat.save} />}
            </Loaded>
          </Stack>
        </>
      )}
    </Loaded>
  );
}

function AccelForm({ cfg, save }: { cfg: NetNat; save: (v: Partial<NetNat>) => Promise<unknown> }) {
  const form = useForm({ enable: cfg.enable });
  const conflicts = (cfg.conflict_features ?? []).join(', ') || 'none';
  return (
    <SettingsForm
      title="Hardware acceleration"
      form={form}
      onSave={async () => {
        await save({ ...cfg, enable: form.values.enable });
        return `Acceleration ${form.values.enable ? 'on' : 'off'}`;
      }}
    >
      <SwitchRow
        label="Hardware acceleration"
        hint={`Pushes traffic through the hardware engine for full speed. While on, these can’t run: ${conflicts}.`}
        checked={form.values.enable}
        onChange={(x) => form.set('enable', x)}
      />
    </SettingsForm>
  );
}

function NatForm({
  cfg,
  save,
}: {
  cfg: { nat_enable: number; sip_enable: number };
  save: (v: { nat_enable: number; sip_enable: number }) => Promise<unknown>;
}) {
  const form = useForm({ cone: Boolean(cfg.nat_enable), sip: Boolean(cfg.sip_enable) });
  return (
    <SettingsForm
      title="NAT"
      form={form}
      onSave={async () => {
        await save({ nat_enable: form.values.cone ? 1 : 0, sip_enable: form.values.sip ? 1 : 0 });
        return 'NAT settings saved';
      }}
    >
      <SwitchRow
        label="Full cone NAT"
        hint="Helps games and voice calls connect. Slightly more open to unsolicited traffic."
        checked={form.values.cone}
        onChange={(x) => form.set('cone', x)}
      />
      <SwitchRow
        label="SIP ALG"
        hint="Rewrites SIP for VoIP phones behind NAT. Turn off if calls drop."
        checked={form.values.sip}
        onChange={(x) => form.set('sip', x)}
      />
    </SettingsForm>
  );
}

/* ---------- EdgeRouter ---------- */

export function EdgeRouterPage() {
  const { query, save } = useSettings('edgerouter', api.networkExtras.edgeRouter);
  return (
    <Loaded query={query} title="EdgeRouter">
      {(cfg) => (
        <>
          <PageHeader title="EdgeRouter" />
          <EdgeForm cfg={cfg} save={save} />
        </>
      )}
    </Loaded>
  );
}

function EdgeForm({ cfg, save }: { cfg: { enable: boolean; ignore?: boolean }; save: (v: { enable: boolean }) => Promise<unknown> }) {
  const { confirm } = useFeedback();
  const form = useForm({ enable: cfg.enable });
  return (
    <SettingsForm
      title="Use as an edge device"
      form={form}
      onSave={async () => {
        if (
          form.values.enable &&
          !(await confirm({
            title: 'Turn on EdgeRouter mode?',
            body: 'Routing moves upstream. The router’s address and DHCP may change, and you may need to find it again on your network.',
            confirm: 'Turn on',
            danger: false,
          }))
        )
          return false;
        await save({ ...cfg, enable: form.values.enable });
        return `EdgeRouter ${form.values.enable ? 'on' : 'off'}`;
      }}
    >
      <SwitchRow
        label="EdgeRouter mode"
        hint="Hands routing to an upstream router (such as a UniFi gateway) while this one keeps WiFi and clients."
        checked={form.values.enable}
        onChange={(x) => form.set('enable', x)}
      />
    </SettingsForm>
  );
}
