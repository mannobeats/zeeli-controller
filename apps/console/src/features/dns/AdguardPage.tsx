import { IconRefresh } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import type { AdguardProtections, AdguardState } from '@zeeli/router-api';
import { useWrite } from '../../api/queries.ts';
import { api } from '../../api/router.ts';
import { useSettings } from '../../api/useSettings.ts';
import { errorMessage } from '../../lib/errors.ts';
import { Button } from '../../ui/Button.tsx';
import { DataTable } from '../../ui/DataTable.tsx';
import { useFeedback } from '../../ui/feedback.tsx';
import { Switch, SwitchRow } from '../../ui/fields.tsx';
import { Empty, PageHeader, Panel } from '../../ui/Layout.tsx';
import { Loaded } from '../../ui/Loading.tsx';
import { SettingsForm, useForm } from '../../ui/SettingsForm.tsx';
import { DnsStats } from './DnsStats.tsx';
import { QueryLog } from './QueryLog.tsx';

/** AdGuard Home as an app: on/off, statistics and filter lists, all in the console. */
export default function AdguardPage() {
  const { query, save } = useSettings('adguard', api.dns.adguard);
  return (
    <Loaded query={query} title="AdGuard Home">
      {(state) => (
        <>
          <PageHeader title="AdGuard Home" sub="Network-wide blocking of ads, trackers and malware." />
          <AdguardForm state={state} save={save} />
          {state.enabled ? (
            <>
              <ProtectionsForm />
              <div className="section-gap">
                <DnsStats />
              </div>
              <QueryLog />
              <FilterLists />
            </>
          ) : null}
        </>
      )}
    </Loaded>
  );
}

function AdguardForm({ state, save }: { state: AdguardState; save: (v: Partial<AdguardState>, what?: string) => Promise<unknown> }) {
  const form = useForm(state);
  return (
    <SettingsForm
      title="Protection"
      note="Starting it takes up to a minute"
      form={form}
      onSave={async () => {
        await save(form.values.enabled ? form.values : { enabled: false }, 'AdGuard Home');
        return `AdGuard Home ${form.values.enabled ? 'on' : 'off'}`;
      }}
    >
      <SwitchRow label="Block ads and trackers" checked={form.values.enabled} onChange={(x) => form.set('enabled', x)} />
      <SwitchRow
        label="Handle DNS for every device"
        hint="Off means only devices pointed at it manually are filtered"
        checked={form.values.dns_enabled}
        onChange={(x) => form.set('dns_enabled', x)}
      />
    </SettingsForm>
  );
}

/** Safe browsing, adult content and SafeSearch: one switch each, kept by AdGuard Home itself. */
function ProtectionsForm() {
  const { query, save } = useSettings('adguard-protections', api.dns.protections);
  if (!query.data) return <output className="panel skeleton form-panel" aria-busy="true" aria-label="Loading protections" />;
  return <ProtectionsFields state={query.data} save={save} />;
}

function ProtectionsFields({
  state,
  save,
}: {
  state: AdguardProtections;
  save: (v: Partial<AdguardProtections>, what?: string) => Promise<unknown>;
}) {
  const form = useForm(state);
  return (
    <SettingsForm
      title="Extra protection"
      form={form}
      onSave={async () => {
        await save(form.values, 'the protection settings');
        return 'Protection settings saved';
      }}
    >
      <SwitchRow
        label="Malware and phishing"
        hint="Blocks sites known to spread malware or steal passwords"
        checked={form.values.safeBrowsing}
        onChange={(x) => form.set('safeBrowsing', x)}
      />
      <SwitchRow
        label="Adult content"
        hint="Blocks adult sites for every device"
        checked={form.values.adultContent}
        onChange={(x) => form.set('adultContent', x)}
      />
      <SwitchRow
        label="SafeSearch"
        hint="Google, Bing, DuckDuckGo and YouTube show family-safe results"
        checked={form.values.safeSearch}
        onChange={(x) => form.set('safeSearch', x)}
      />
    </SettingsForm>
  );
}

function FilterLists() {
  const { toast } = useFeedback();
  const lists = useQuery({ queryKey: ['adguard-filters'], queryFn: api.dns.filterLists });
  const toggle = useWrite(
    ({ url, name, on }: { url: string; name: string; on: boolean }) => api.dns.setFilterList(url, name, on),
    [['adguard-filters']],
  );
  const refresh = useWrite(() => api.dns.refreshFilters(), [['adguard-filters']]);
  return (
    <Panel
      className="section"
      title="Filter lists"
      actions={
        <Button
          icon={<IconRefresh size={16} />}
          busy={refresh.isPending}
          onClick={() =>
            refresh.mutateAsync(undefined).then(
              () => toast('Filter lists updated'),
              (e) => toast(errorMessage(e)),
            )
          }
        >
          Update now
        </Button>
      }
    >
      {lists.data?.filters.length ? (
        <DataTable
          label="Filter lists"
          rows={lists.data.filters}
          rowKey={(f) => f.url}
          rowClass={(f) => (f.enabled ? undefined : 'off')}
          columns={[
            { key: 'name', header: 'List', phone: 'title', cell: (f) => <span className="name">{f.name}</span> },
            { key: 'rules', header: 'Rules', phone: 'sub', cell: (f) => (f.enabled ? `${f.rules_count.toLocaleString()} rules` : 'Off') },
            {
              key: 'on',
              header: 'On',
              align: 'end',
              phone: 'end',
              cell: (f) => (
                <Switch
                  checked={f.enabled}
                  label={`${f.name} on`}
                  disabled={toggle.isPending}
                  onChange={(on) =>
                    toggle.mutateAsync({ url: f.url, name: f.name, on }).then(
                      () => toast(`${f.name} ${on ? 'on' : 'off'}`),
                      (e) => toast(errorMessage(e)),
                    )
                  }
                />
              ),
            },
          ]}
        />
      ) : (
        <Empty>{lists.isError ? `Couldn’t read AdGuard Home: ${errorMessage(lists.error)}` : 'No filter lists.'}</Empty>
      )}
    </Panel>
  );
}
