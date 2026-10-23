import { useQuery } from '@tanstack/react-query';
import type { ServiceCatalog, ServiceInfo } from '@zeeli/router-api';
import { useState } from 'react';
import { useWrite } from '../../api/queries.ts';
import { api } from '../../api/router.ts';
import { errorMessage } from '../../lib/errors.ts';
import { FilterBar } from '../../ui/FilterBar.tsx';
import { useFeedback } from '../../ui/feedback.tsx';
import { Switch } from '../../ui/fields.tsx';
import { facetOptions, matches } from '../../ui/filter.ts';
import { Empty, Panel } from '../../ui/Layout.tsx';
import { ScrollBox, useLimit } from '../../ui/limit.tsx';

const groupLabel = (id: string) => {
  const words = id.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
};

export const useServiceCatalog = () =>
  useQuery({ queryKey: ['adguard-service-catalog'], queryFn: api.dns.serviceCatalog, staleTime: Number.POSITIVE_INFINITY });
const useBlockedServices = () => useQuery({ queryKey: ['adguard-services'], queryFn: api.dns.blockedServices });

/** Services blocked for the whole network. Each switch saves at once. */
export function BlockedServices() {
  const { toast } = useFeedback();
  const catalog = useServiceCatalog();
  const blocked = useBlockedServices();
  const save = useWrite((ids: string[]) => api.dns.setBlockedServices(ids), [['adguard-services']]);
  const ids = blocked.data?.ids ?? [];
  const toggle = (s: ServiceInfo, on: boolean) =>
    save.mutateAsync(on ? [...ids, s.id] : ids.filter((x) => x !== s.id)).then(
      () => toast(`${s.name} ${on ? 'blocked' : 'allowed'}`),
      (e) => toast(`Couldn’t save: ${errorMessage(e)}`),
    );
  const error = catalog.error ?? blocked.error;
  return (
    <Panel title="Blocked services" note={blocked.data ? `${ids.length} blocked` : undefined}>
      {catalog.data && blocked.data ? (
        <ServicePicker catalog={catalog.data} value={ids} disabled={save.isPending} onToggle={toggle} />
      ) : (
        <Empty>{error ? `Couldn’t read AdGuard Home: ${errorMessage(error)}` : 'Loading…'}</Empty>
      )}
    </Panel>
  );
}

/** Every service AdGuard knows, as switches: the blocked ones first, then by kind. Searchable. */
export function ServicePicker({
  catalog,
  value,
  onToggle,
  disabled,
}: {
  catalog: ServiceCatalog;
  value: string[];
  onToggle: (service: ServiceInfo, on: boolean) => void;
  disabled?: boolean;
}) {
  const [q, setQ] = useState('');
  const [group, setGroup] = useState('');
  const on = new Set(value);
  const rows = catalog.services
    .filter((s) => (!group || s.group === group) && matches(q, [s.name, s.id, groupLabel(s.group)]))
    .sort((a, b) => Number(on.has(b.id)) - Number(on.has(a.id)) || a.group.localeCompare(b.group) || a.name.localeCompare(b.name));
  const { shown, more } = useLimit(rows, 24);
  const sections = new Map<string, ServiceInfo[]>();
  for (const s of shown) {
    const label = on.has(s.id) ? 'Blocked' : groupLabel(s.group);
    sections.set(label, [...(sections.get(label) ?? []), s]);
  }
  return (
    <>
      <FilterBar
        search={{ value: q, onChange: setQ, placeholder: 'Find a service', label: 'Find a service' }}
        facets={[{ label: 'Kind', value: group, onChange: setGroup, options: facetOptions(catalog.services, (s) => s.group, groupLabel) }]}
        shown={rows.length}
        total={catalog.services.length}
        onClear={() => {
          setQ('');
          setGroup('');
        }}
      />
      {rows.length ? (
        <ScrollBox label="Services">
          {[...sections].map(([label, list]) => (
            <section key={label} className="svc-group">
              <h3>{label}</h3>
              <ul className="svc-grid">
                {list.map((s) => (
                  <li key={s.id} className="svc">
                    {s.icon ? <img src={s.icon} alt="" width={20} height={20} /> : <span className="svc-blank" />}
                    <span className="name">{s.name}</span>
                    <Switch label={`Block ${s.name}`} checked={on.has(s.id)} disabled={disabled} onChange={(x) => onToggle(s, x)} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {more}
        </ScrollBox>
      ) : (
        <Empty>No services match.</Empty>
      )}
    </>
  );
}
