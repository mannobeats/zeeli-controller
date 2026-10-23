import { IconSearch, IconX } from '@tabler/icons-react';
import { type ReactNode, useState } from 'react';
import { type Facet, matches, textOf } from './filter.ts';
import { Empty } from './Layout.tsx';

/**
 * One filter row for a long list: a search, a few facets as menus, how many rows match and a way
 * back to everything. The same on every page, so finding a thing works the same way everywhere.
 */
export function FilterBar({
  search,
  facets = [],
  shown,
  total,
  onClear,
}: {
  search?: { value: string; onChange: (q: string) => void; placeholder: string; label: string };
  facets?: Facet[];
  shown: number;
  total: number;
  onClear: () => void;
}) {
  const active = Boolean(search?.value.trim()) || facets.some((f) => f.value);
  return (
    <div className="filter-bar">
      {search ? (
        <label className="search">
          <IconSearch size={16} stroke={1.75} />
          <input
            type="search"
            value={search.value}
            onChange={(e) => search.onChange(e.target.value)}
            placeholder={search.placeholder}
            aria-label={search.label}
          />
        </label>
      ) : null}
      {facets.map((f) => (
        <select
          key={f.label}
          className={`facet${f.value ? ' on' : ''}`}
          aria-label={f.label}
          value={f.value}
          onChange={(e) => f.onChange(e.target.value)}
        >
          <option value="">{f.any ?? `Any ${f.label.toLowerCase()}`}</option>
          {/* a picked value stays listed even once it has no rows left */}
          {f.value && !f.options.some((o) => o.value === f.value) ? <option value={f.value}>{f.value}</option> : null}
          {f.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.count === undefined ? o.label : `${o.label} (${o.count})`}
            </option>
          ))}
        </select>
      ))}
      {active ? (
        <span className="filter-count">
          <span className="num">
            {shown} of {total}
          </span>
          <button type="button" className="filter-clear" onClick={onClear}>
            <IconX size={14} stroke={1.75} />
            Clear
          </button>
        </span>
      ) : null}
    </div>
  );
}

/**
 * A search box over one list. The bar only shows once the list is long enough to need it (a filter
 * over three rows is noise), and stays while a search is typed. `rows` is what matches.
 */
function useSearch<T extends object>(
  all: T[],
  search: { label: string; placeholder: string; fields?: (row: T) => (string | null | undefined)[] },
  min = 8,
) {
  const [q, setQ] = useState('');
  const rows = q.trim() ? all.filter((r) => matches(q, search.fields?.(r) ?? textOf(r))) : all;
  const bar =
    all.length >= min || q ? (
      <FilterBar
        search={{ value: q, onChange: setQ, label: search.label, placeholder: search.placeholder }}
        shown={rows.length}
        total={all.length}
        onClear={() => setQ('')}
      />
    ) : null;
  return { rows, bar };
}

/** `useSearch` around a table or list: the bar above, the rows that match inside, "none match" when nothing does. */
export function Searchable<T extends object>({
  rows: all,
  label,
  placeholder,
  none,
  fields,
  min,
  children,
}: {
  rows: T[];
  label: string;
  placeholder: string;
  /** What to say when the search hides every row: "No rules match." */
  none: string;
  fields?: (row: T) => (string | null | undefined)[];
  min?: number;
  children: (rows: T[]) => ReactNode;
}) {
  const { rows, bar } = useSearch(all, { label, placeholder, fields }, min);
  return (
    <>
      {bar}
      {rows.length ? children(rows) : <Empty>{none}</Empty>}
    </>
  );
}
