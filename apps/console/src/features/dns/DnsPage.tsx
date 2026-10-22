import { useQuery } from '@tanstack/react-query';
import { DNS_PROTOCOLS, DNS_PROVIDERS, type DnsConfig, type DnsMode, type DnsProvider, isIpv4, isIpv6 } from '@zeeli/router-api';
import { type ReactNode, useState } from 'react';
import { api } from '../../api/router.ts';
import { useSettings } from '../../api/useSettings.ts';
import { navigate } from '../../app/useHashRoute.ts';
import { Button } from '../../ui/Button.tsx';
import { useFeedback } from '../../ui/feedback.tsx';
import { SelectField, SwitchRow, TextField } from '../../ui/fields.tsx';
import { Chip, Grid, KeyValues, Note, PageHeader, Panel } from '../../ui/Layout.tsx';
import { Loaded } from '../../ui/Loading.tsx';
import { SettingsForm, useForm } from '../../ui/SettingsForm.tsx';
import { Sheet } from '../../ui/Sheet.tsx';
import { TextArea } from '../../ui/TextArea.tsx';
import { type SecureChoice, sourceSettings } from './source.ts';

const SLOTS = ['first', 'second', 'third', 'fourth'] as const;
const MODES: Record<DnsMode, string> = {
  auto: 'From your internet provider',
  manual: 'Servers you choose',
  secure: 'Encrypted DNS',
  proxy: 'DNS proxy',
};

type Rows = [string, ReactNode][];
const manualRows = (dns: DnsConfig): Rows =>
  dns.manual_list.map((s, i) => [
    `Server ${i + 1}`,
    <span key={s} className="mono">
      {s}
    </span>,
  ]);
function secureRows(dns: DnsConfig): Rows {
  const rows: Rows = [
    ['Provider', DNS_PROVIDERS[dns.provider] ?? dns.provider],
    ['Protocol', DNS_PROTOCOLS[dns.proto] ?? dns.proto],
  ];
  if (dns.servers_list[0]) rows.push(['Filtering', dns.servers_list[0]]);
  if (dns.nextdns_id)
    rows.push([
      'NextDNS ID',
      <span key="n" className="mono">
        {dns.nextdns_id}
      </span>,
    ]);
  return rows;
}
const autoRows = (dns: DnsConfig): Rows => [
  [
    'Servers',
    <span key="a" className="mono">
      {(dns.server_auto ?? []).join(', ') || 'Automatic'}
    </span>,
  ],
];
const SOURCE_ROWS: Partial<Record<DnsMode, (dns: DnsConfig) => Rows>> = { manual: manualRows, secure: secureRows };
/** What the DNS source panel lists for the current mode. */
const sourceRows = (dns: DnsConfig) => (SOURCE_ROWS[dns.mode] ?? autoRows)(dns);

export default function DnsPage() {
  const { query, save } = useSettings('dns', api.dns.config);
  const adguard = useQuery({ queryKey: ['adguard'], queryFn: api.dns.adguard.get });
  const [sheet, setSheet] = useState<'source' | 'servers' | null>(null);
  return (
    <Loaded query={query} title="DNS and filtering">
      {(dns) => (
        <>
          <PageHeader title="DNS and filtering" sub="Where the router looks up names, and what it refuses to look up." />
          <Grid cols={2}>
            <Panel
              title="DNS source"
              note={MODES[dns.mode]}
              actions={
                <span className="row-actions">
                  {dns.mode === 'manual' ? <Button onClick={() => setSheet('servers')}>Edit servers</Button> : null}
                  <Button onClick={() => setSheet('source')}>Change</Button>
                </span>
              }
            >
              {adguard.data?.enabled && adguard.data.dns_enabled ? (
                <Note>AdGuard Home answers DNS on this network; these servers are what it forwards to.</Note>
              ) : null}
              <KeyValues rows={sourceRows(dns)} />
            </Panel>
            <Panel
              title="AdGuard Home"
              actions={adguard.data?.enabled ? <Chip tone="ok">Blocking</Chip> : <span className="tone-off">Off</span>}
            >
              <Note>Blocks ads, trackers and malware for every device, with statistics for every query.</Note>
              <div className="row-actions start">
                <Button onClick={() => navigate('adguard')}>Open AdGuard Home</Button>
                <Button variant="ghost" onClick={() => navigate('dns-insights')}>
                  See DNS queries
                </Button>
              </div>
            </Panel>
          </Grid>
          <div className="section-gap">
            <ProtectionsForm dns={dns} save={save} />
          </div>
          <div className="section-gap">
            <HostsForm />
          </div>
          {sheet === 'source' ? <SourceSheet dns={dns} save={save} onClose={() => setSheet(null)} /> : null}
          {sheet === 'servers' ? <ServersSheet dns={dns} save={save} onClose={() => setSheet(null)} /> : null}
        </>
      )}
    </Loaded>
  );
}

function ProtectionsForm({ dns, save }: { dns: DnsConfig; save: (v: Partial<DnsConfig>) => Promise<unknown> }) {
  const form = useForm({ force_dns: dns.force_dns, rebind_protection: dns.rebind_protection, override_vpn: dns.override_vpn });
  return (
    <SettingsForm
      title="Protections"
      form={form}
      onSave={async () => {
        await save({ ...dns, ...form.values });
        return 'DNS protections saved';
      }}
    >
      <SwitchRow
        label="Override DNS on every device"
        hint="Devices with their own DNS settings still use the router"
        checked={form.values.force_dns}
        onChange={(x) => form.set('force_dns', x)}
      />
      <SwitchRow
        label="DNS rebinding protection"
        hint="Turn off if a captive portal or local hostnames stop resolving"
        checked={form.values.rebind_protection}
        onChange={(x) => form.set('rebind_protection', x)}
      />
      <SwitchRow
        label="Use these servers inside VPN tunnels"
        checked={form.values.override_vpn}
        onChange={(x) => form.set('override_vpn', x)}
      />
    </SettingsForm>
  );
}

/** Local names: "192.168.8.10 nas.home" lines, answered by the router itself. */
function HostsForm() {
  const hosts = useQuery({ queryKey: ['dns-hosts'], queryFn: api.dns.hosts });
  return (
    <Loaded query={hosts} title="">
      {(content) => <HostsEditor content={content} />}
    </Loaded>
  );
}

function HostsEditor({ content }: { content: string }) {
  const form = useForm({ content });
  return (
    <SettingsForm
      title="Local names"
      note="Give devices names like nas.home that work on every device"
      form={form}
      onSave={async () => {
        const lines = form.values.content
          .split('\n')
          .map((l) => l.trim())
          .filter((l) => l && !l.startsWith('#'));
        const bad = lines.find((l) => {
          const [ip = '', ...names] = l.split(/\s+/);
          return !(isIpv4(ip) || isIpv6(ip)) || !names.length;
        });
        if (bad) throw new Error(`“${bad}” should be an address then a name, like 192.168.8.10 nas.home`);
        await api.dns.setHosts(form.values.content);
        return 'Local names saved';
      }}
    >
      <TextArea
        label="One per line: address, then name"
        value={form.values.content}
        onChange={(x) => form.set('content', x)}
        mono
        rows={5}
        placeholder="192.168.8.10 nas.home"
      />
    </SettingsForm>
  );
}

function SourceSheet({
  dns,
  save,
  onClose,
}: {
  dns: DnsConfig;
  save: (v: Partial<DnsConfig>, what?: string) => Promise<unknown>;
  onClose: () => void;
}) {
  const { toast } = useFeedback();
  const providers = useQuery({ queryKey: ['dns-providers'], queryFn: api.dns.providers });
  const [mode, setMode] = useState<DnsMode>(dns.mode);
  const [choice, setChoice] = useState<SecureChoice>({
    provider: dns.provider || 'cloudflare',
    proto: dns.proto || 'dot',
    server: dns.servers_list[0] ?? '',
    nextdns: dns.nextdns_id,
  });
  const info = providers.data?.find((x) => x.provider === choice.provider);
  const modes = (['auto', 'manual', 'secure', ...(dns.mode === 'proxy' ? ['proxy'] : [])] as DnsMode[]).map((m) => [m, MODES[m]] as const);
  return (
    <Sheet
      open
      onOpenChange={(o) => !o && onClose()}
      title="DNS source"
      sub="Where the router sends lookups it can’t answer itself."
      save="Apply"
      onSave={async () => {
        await save(sourceSettings(dns, mode, choice, info), 'the DNS source');
        toast(mode === 'secure' ? `DNS now uses ${DNS_PROVIDERS[choice.provider]}` : `DNS now ${MODES[mode].toLowerCase()}`);
      }}
    >
      <SelectField label="Source" value={mode} options={modes} onChange={setMode} />
      {mode === 'secure' ? <SecureFields providers={providers.data ?? []} choice={choice} onChange={setChoice} /> : null}
    </Sheet>
  );
}

function SecureFields({
  providers,
  choice,
  onChange,
}: {
  providers: DnsProvider[];
  choice: SecureChoice;
  onChange: (c: SecureChoice) => void;
}) {
  const info = providers.find((x) => x.provider === choice.provider);
  const protos = info?.protocols ?? ['dot'];
  const servers = info?.servers ?? [];
  const set = (k: keyof SecureChoice) => (v: string) => onChange({ ...choice, [k]: v });
  return (
    <>
      <SelectField
        label="Provider"
        value={choice.provider}
        options={providers.map((x) => [x.provider, DNS_PROVIDERS[x.provider] ?? x.provider] as const)}
        onChange={set('provider')}
      />
      <SelectField
        label="Protocol"
        value={protos.includes(choice.proto) ? choice.proto : (protos[0] ?? 'dot')}
        options={protos.map((x) => [x, DNS_PROTOCOLS[x] ?? x] as const)}
        onChange={set('proto')}
      />
      {servers.length ? (
        <SelectField
          label="Filtering"
          value={choice.server || (servers[0]?.name ?? '')}
          options={servers.map((s) => [s.name, `${s.name} · ${s.description.split(/[.,(]/)[0]}`] as const)}
          onChange={set('server')}
        />
      ) : null}
      {choice.provider === 'nextdns' ? (
        <TextField label="NextDNS configuration ID" mono value={choice.nextdns} onChange={set('nextdns')} placeholder="abc123" />
      ) : null}
    </>
  );
}

function ServersSheet({ dns, save, onClose }: { dns: DnsConfig; save: (v: Partial<DnsConfig>) => Promise<unknown>; onClose: () => void }) {
  const { toast } = useFeedback();
  const [servers, setServers] = useState(() => [0, 1, 2, 3].map((i) => dns.manual_list[i] ?? ''));
  return (
    <Sheet
      open
      onOpenChange={(o) => !o && onClose()}
      title="DNS servers"
      sub="The router sends lookups to these in order. IPv4 or IPv6."
      onSave={async () => {
        const list = servers.map((s) => s.trim()).filter(Boolean);
        if (!list.length) throw new Error('Add at least one server.');
        const bad = list.find((a) => !isIpv4(a) && !isIpv6(a));
        if (bad) throw new Error(`${bad} isn’t an IP address.`);
        await save({ ...dns, manual_list: list });
        toast('DNS servers saved');
      }}
    >
      {servers.map((s, i) => (
        <TextField
          key={SLOTS[i]}
          label={`Server ${i + 1}`}
          mono
          value={s}
          placeholder={i ? 'Optional' : '1.1.1.1'}
          onChange={(v) => setServers((x) => x.map((y, j) => (j === i ? v : y)))}
        />
      ))}
    </Sheet>
  );
}
