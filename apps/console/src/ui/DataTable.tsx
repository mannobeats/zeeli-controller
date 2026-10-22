import { type ReactNode, useRef, useState } from 'react';

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /** Right-align numbers, times and actions. */
  align?: 'end';
  /** Shown on phones as the second line; omit to hide on phones. */
  phone?: 'title' | 'sub' | 'end' | 'hide';
  className?: string;
  /** A fixed column width, so stacked tables on one page line up. */
  size?: 'xs' | 'sm' | 'md' | 'lg';
}

interface BulkAction<T> {
  label: string;
  run: (rows: T[]) => void;
  danger?: boolean;
  /** Hide the action when it makes no sense for this selection. */
  when?: (rows: T[]) => boolean;
}

interface Props<T> {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  rowClass?: (row: T) => string | undefined;
  selectedKey?: string | null;
  /** Bulk actions appear in a bar once one or more rows are checked. */
  bulk?: BulkAction<T>[];
  label: string;
}

/**
 * Every list in the console. Rows are keyboard-focusable when clickable; with `bulk`,
 * each row gets a checkbox and shift-click selects a range.
 */
export function DataTable<T>({ rows, columns, rowKey, onRowClick, rowClass, selectedKey, bulk, label }: Props<T>) {
  const [checked, setChecked] = useState<Set<string>>(() => new Set());
  const anchor = useRef<number | null>(null);
  const keys = rows.map(rowKey);
  const live = new Set(keys.filter((k) => checked.has(k)));
  const picked = rows.filter((r) => live.has(rowKey(r)));
  const allOn = rows.length > 0 && live.size === rows.length;

  const toggle = (index: number, shift: boolean) => {
    const next = new Set(live);
    const key = keys[index];
    if (key === undefined) return;
    const on = !next.has(key);
    const [from, to] =
      shift && anchor.current !== null ? [Math.min(anchor.current, index), Math.max(anchor.current, index)] : [index, index];
    for (let i = from; i <= to; i++) {
      const k = keys[i];
      if (k !== undefined) on ? next.add(k) : next.delete(k);
    }
    setChecked(next);
    anchor.current = index;
  };

  const actions = bulk?.filter((a) => !a.when || a.when(picked)) ?? [];

  return (
    <>
      {bulk && live.size > 0 ? (
        <div className="bulk-bar" role="toolbar" aria-label={`${live.size} selected`}>
          <span className="bulk-count">{live.size} selected</span>
          <div className="bulk-actions">
            {actions.map((a) => (
              <button
                key={a.label}
                type="button"
                className={`btn ${a.danger ? 'danger' : 'default'}`}
                onClick={() => {
                  a.run(picked);
                  setChecked(new Set());
                }}
              >
                {a.label}
              </button>
            ))}
            <button type="button" className="btn ghost" onClick={() => setChecked(new Set())}>
              Clear
            </button>
          </div>
        </div>
      ) : null}
      <div className="table-wrap">
        <table className="data-table" aria-label={label}>
          <thead>
            <tr>
              {bulk ? (
                <th className="c-check">
                  <input
                    type="checkbox"
                    aria-label="Select all"
                    checked={allOn}
                    ref={(el) => {
                      if (el) el.indeterminate = live.size > 0 && !allOn;
                    }}
                    onChange={() => setChecked(allOn ? new Set() : new Set(keys))}
                  />
                </th>
              ) : null}
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={[c.align === 'end' ? 'r' : '', c.size ? `col-${c.size}` : ''].filter(Boolean).join(' ') || undefined}
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const key = rowKey(row);
              const cls = [rowClass?.(row), selectedKey === key || live.has(key) ? 'sel' : ''].filter(Boolean).join(' ');
              return (
                <tr
                  key={key}
                  className={cls || undefined}
                  tabIndex={onRowClick ? 0 : undefined}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  onKeyDown={
                    onRowClick
                      ? (e) => {
                          if (e.target !== e.currentTarget) return;
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            onRowClick(row);
                          }
                        }
                      : undefined
                  }
                >
                  {bulk ? (
                    <td className="c-check" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        aria-label={`Select row ${i + 1}`}
                        checked={live.has(key)}
                        onChange={(e) => toggle(i, (e.nativeEvent as MouseEvent).shiftKey)}
                      />
                    </td>
                  ) : null}
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      className={[c.align === 'end' ? 'r' : '', c.phone ? `ph-${c.phone}` : 'ph-hide', c.className ?? '']
                        .filter(Boolean)
                        .join(' ')}
                    >
                      {c.cell(row)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
