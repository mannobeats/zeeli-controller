import { IconX } from '@tabler/icons-react';
import { type ReactNode, useEffect, useEffectEvent, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { type Reorder, useReorder } from './reorder.tsx';

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
  /** A grip column to drag rows into a new order, or to move them with the keyboard. */
  reorder?: Reorder<T>;
}

/**
 * Every list in the console. Rows are keyboard-focusable when clickable; with `bulk`,
 * each row gets a checkbox and shift-click selects a range; with `reorder`, a grip.
 */
export function DataTable<T>({ rows, columns, rowKey, onRowClick, rowClass, selectedKey, bulk, label, reorder }: Props<T>) {
  const order = useReorder(rows, reorder, rowKey);
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
      {bulk && live.size > 0 ? <BulkBar count={live.size} actions={actions} picked={picked} clear={() => setChecked(new Set())} /> : null}
      <div className="table-wrap">
        <table className={`data-table ${order.tableClass}`.trim()} aria-label={label}>
          <thead>
            <tr>
              {reorder ? (
                <th className="c-grip">
                  <span className="sr-only">Reorder</span>
                </th>
              ) : null}
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
              const lift = order.row(i);
              const cls = [rowClass?.(row), selectedKey === key || live.has(key) ? 'sel' : '', lift.className].filter(Boolean).join(' ');
              return (
                <tr
                  key={key}
                  className={cls || undefined}
                  style={lift.style}
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
                  {reorder ? (
                    <td
                      className="c-grip"
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => {
                        // picking up a row with Enter or Space mustn't open it
                        if (e.key === 'Enter' || e.key === ' ') e.stopPropagation();
                      }}
                    >
                      {order.handle(row, i)}
                    </td>
                  ) : null}
                  {bulk ? (
                    <td
                      className="c-check"
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => {
                        // keep Enter and Space on the checkbox from opening the row; let Escape reach the bar
                        if (e.key === 'Enter' || e.key === ' ') e.stopPropagation();
                      }}
                    >
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
      {reorder ? (
        <div className="sr-only" aria-live="assertive">
          {order.announcement}
        </div>
      ) : null}
    </>
  );
}

/**
 * What to do with the checked rows: a bar floating over the bottom of the screen, so it
 * never pushes the list down and stays in reach while you scroll. Escape clears.
 */
function BulkBar<T>({ count, actions, picked, clear }: { count: number; actions: BulkAction<T>[]; picked: T[]; clear: () => void }) {
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.key === 'Escape') clear();
  });
  useEffect(() => {
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return createPortal(
    <div className="bulk-bar" role="toolbar" aria-label={`${count} selected`}>
      <span className="bulk-count num">{count} selected</span>
      <span className="bulk-sep" aria-hidden />
      {actions.map((a) => (
        <button
          key={a.label}
          type="button"
          className={`bulk-btn${a.danger ? ' danger' : ''}`}
          onClick={() => {
            a.run(picked);
            clear();
          }}
        >
          {a.label}
        </button>
      ))}
      <button type="button" className="bulk-btn bulk-close" onClick={clear} aria-label="Clear selection" title="Clear selection (Esc)">
        <IconX size={16} stroke={1.75} />
      </button>
    </div>,
    document.body,
  );
}
