import { IconRefresh, IconSearch } from '@tabler/icons-react';
import { type UseQueryResult, useQuery } from '@tanstack/react-query';
import { compareVersions, type Package } from '@zeeli/router-api';
import { useDeferredValue, useMemo, useState } from 'react';
import { useWrite } from '../../api/queries.ts';
import { api } from '../../api/router.ts';
import { errorMessage } from '../../lib/errors.ts';
import { bytes } from '../../lib/format.ts';
import { AdvancedGate } from '../../ui/AdvancedGate.tsx';
import { Button } from '../../ui/Button.tsx';
import { DataTable } from '../../ui/DataTable.tsx';
import { useFeedback } from '../../ui/feedback.tsx';
import { Segmented } from '../../ui/fields.tsx';
import { Chip, Empty, PageHeader, Panel } from '../../ui/Layout.tsx';
import { Loaded } from '../../ui/Loading.tsx';

type View = 'installed' | 'available' | 'updates';
type Change = 'install' | 'remove' | 'upgrade';
/** Rows shown before "Show more"; the feeds list thousands of packages. */
const STEP = 100;

const VERBS: Record<Change, [doing: string, done: string, button: string]> = {
  install: ['Installing', 'installed', 'Install'],
  remove: ['Removing', 'removed', 'Remove'],
  upgrade: ['Updating', 'updated', 'Update'],
};

export function PackagesPage() {
  return (
    <AdvancedGate title="Packages">
      <PackagesBody />
    </AdvancedGate>
  );
}

interface Row extends Package {
  /** Installed version, when it is installed. */
  current?: string;
  hay: string;
}

function PackagesBody() {
  const { toast, confirm } = useFeedback();
  const [view, setView] = useState<View>('installed');
  const [q, setQ] = useState('');
  const needle = useDeferredValue(q.trim().toLowerCase());
  const installed = useQuery({ queryKey: ['packages'], queryFn: api.openwrt.packages.installed });
  const available = useQuery({
    queryKey: ['packages-available'],
    queryFn: api.openwrt.packages.available,
    staleTime: 10 * 60_000,
  });
  const write = useWrite(
    ({ change, pkg }: { change: Change; pkg: Row }) =>
      change === 'upgrade' ? api.openwrt.packages.upgrade(pkg) : api.openwrt.packages[change]([pkg.name]),
    [['packages'], ['apps']],
  );
  const refresh = useWrite(() => api.openwrt.packages.refresh(), [['packages-available']]);

  const lists = useMemo(() => {
    const row = (p: Package, current?: string): Row => ({
      ...p,
      ...(current ? { current } : {}),
      hay: `${p.name} ${p.description}`.toLowerCase(),
    });
    const have = new Map((installed.data ?? []).map((p) => [p.name, p.version]));
    const feed = (available.data ?? []).map((p) => row(p, have.get(p.name)));
    // the status file has no descriptions; the feed does
    const described = new Map(feed.map((p) => [p.name, p.description]));
    return {
      installed: (installed.data ?? []).map((p) => row({ ...p, description: described.get(p.name) ?? p.description }, p.version)),
      available: feed,
      updates: feed.filter((p) => p.current && compareVersions(p.version, p.current) > 0),
    };
  }, [installed.data, available.data]);

  const all = lists[view].filter((p) => !needle || p.hay.includes(needle));
  const pending = write.isPending ? write.variables : undefined;

  async function act(change: Change, pkg: Row) {
    const [doing, done, button] = VERBS[change];
    const ok = await confirm({
      title: `${button} ${pkg.name}?`,
      body:
        change === 'remove'
          ? 'Removing packages the firmware relies on can break features. Only remove what you installed yourself.'
          : `opkg ${change === 'upgrade' ? `updates it from ${pkg.current} to` : 'installs'} ${pkg.version}, with anything it needs.`,
      confirm: `${button} ${pkg.name}`,
      danger: change === 'remove',
    });
    if (!ok) return;
    toast(`${doing} ${pkg.name}… This can take a few minutes.`);
    await write.mutateAsync({ change, pkg }).then(
      () => toast(`${pkg.name} ${done}`),
      (e) => toast(`Couldn’t ${button.toLowerCase()} ${pkg.name}: ${errorMessage(e)}`),
    );
  }

  const count = (n: number | undefined, loaded: boolean) => (loaded ? ` ${(n ?? 0).toLocaleString('en')}` : '');
  const feedLoaded = available.data !== undefined;

  return (
    <Loaded query={installed} title="Packages">
      {(pkgs) => (
        <>
          <PageHeader
            title="Packages"
            sub={`${pkgs.length} installed. For curated apps, use the App store.`}
            actions={
              <Button
                icon={<IconRefresh size={16} />}
                busy={refresh.isPending}
                onClick={() =>
                  refresh.mutateAsync(undefined).then(
                    () => toast('Package list refreshed'),
                    (e) => toast(`Couldn’t refresh the package list: ${errorMessage(e)}`),
                  )
                }
              >
                Refresh list
              </Button>
            }
          />
          <Panel>
            <div className="toolbar">
              <Segmented
                label="Show"
                value={view}
                onChange={setView}
                options={[
                  ['installed', `Installed${count(pkgs.length, true)}`],
                  ['available', `Available${count(lists.available.length, feedLoaded)}`],
                  ['updates', `Updates${count(lists.updates.length, feedLoaded)}`],
                ]}
              />
              <label className="search">
                <IconSearch size={16} stroke={1.75} />
                <input
                  type="search"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Name or description"
                  aria-label="Search packages"
                />
              </label>
            </div>
            {pending ? (
              <output className="kicker app-wait">
                {VERBS[pending.change][0]} {pending.pkg.name}… This can take a few minutes; keep this page open.
              </output>
            ) : null}
            {view !== 'installed' && !feedLoaded ? (
              <FeedState query={available} />
            ) : all.length ? (
              <PackageRows
                key={`${view} ${needle}`}
                rows={all}
                view={view}
                pending={pending?.pkg.name}
                locked={write.isPending}
                act={act}
              />
            ) : (
              <Empty>{emptyText(needle ? q.trim() : '', view)}</Empty>
            )}
          </Panel>
        </>
      )}
    </Loaded>
  );
}

const emptyText = (query: string, view: View) =>
  query ? `No package matches “${query}”.` : view === 'updates' ? 'Everything installed is up to date.' : 'Nothing here.';

function FeedState({ query }: { query: UseQueryResult<Package[]> }) {
  return query.isError ? (
    <Empty action={<Button onClick={() => query.refetch()}>Try again</Button>}>
      Couldn’t read the package list: {errorMessage(query.error)}{' '}
    </Empty>
  ) : (
    <output className="skeleton app-skeleton" aria-busy="true" aria-label="Loading the package list" />
  );
}

/** The matching packages, a page at a time; keyed by view and search, so paging starts over. */
function PackageRows({
  rows,
  view,
  pending,
  locked,
  act,
}: {
  rows: Row[];
  view: View;
  pending: string | undefined;
  locked: boolean;
  act: (change: Change, pkg: Row) => void;
}) {
  const [limit, setLimit] = useState(STEP);
  const action = (p: Row) => {
    const change: Change | null = view === 'installed' ? 'remove' : view === 'updates' ? 'upgrade' : p.current ? null : 'install';
    if (!change) return <Chip>Installed</Chip>;
    const [doing, , label] = VERBS[change];
    return (
      <Button
        variant={change === 'remove' ? 'ghost' : 'default'}
        busy={pending === p.name}
        disabled={locked}
        onClick={() => act(change, p)}
      >
        {pending === p.name ? `${doing}…` : label}
      </Button>
    );
  };
  return (
    <>
      <DataTable
        label="Packages"
        rows={rows.slice(0, limit)}
        rowKey={(p) => p.name}
        columns={[
          { key: 'name', header: 'Package', phone: 'title', cell: (p) => <span className="name mono">{p.name}</span> },
          {
            key: 'ver',
            header: 'Version',
            phone: 'sub',
            cell: (p) => <span className="mono muted">{view === 'updates' ? `${p.current} → ${p.version}` : p.version}</span>,
          },
          { key: 'desc', header: 'Description', cell: (p) => <span className="truncate">{p.description}</span> },
          {
            key: 'size',
            header: 'Size',
            align: 'end',
            phone: 'hide',
            cell: (p) => <span className="num muted">{p.size ? bytes(p.size) : ''}</span>,
          },
          { key: 'act', header: '', align: 'end', phone: 'end', cell: action },
        ]}
      />
      {rows.length > limit ? (
        <div className="app-more">
          <span className="kicker">
            Showing {limit.toLocaleString('en')} of {rows.length.toLocaleString('en')}. Search to narrow the list.
          </span>
          <Button onClick={() => setLimit((n) => n + STEP)}>Show more</Button>
        </div>
      ) : null}
    </>
  );
}
