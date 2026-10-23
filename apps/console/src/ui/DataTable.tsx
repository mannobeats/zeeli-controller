import { IconX } from '@tabler/icons-react';
import { type CSSProperties, type KeyboardEvent as KeyEvent, type ReactNode, useEffect, useEffectEvent, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { STEP, useLimit } from './limit.tsx';
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
  /** Rows drawn at a time in a scrolling list; `false` for short lists that must show whole. Reorderable tables always show every row. */
  limit?: number | false;
}

/**
 * Every list in the console. Rows are keyboard-focusable when clickable; with `bulk`,
 * each row gets a checkbox and shift-click selects a range; with `reorder`, a grip. A long list
 * keeps its height and scrolls inside, drawing `limit` rows at a time as you go.
 */
export function DataTable<T>({ rows: all, columns, rowKey, onRowClick, rowClass, selectedKey, bulk, label, reorder, ...rest }: Props<T>) {
  const step = stepOf(rest.limit, reorder);
  const { shown: rows, more } = useLimit(all, step);
  const order = useReorder(rows, reorder, rowKey);
  const [checked, setChecked] = useState<Set<string>>(() => new Set());
  const anchor = useRef<number | null>(null);
  // select-all takes every row, drawn yet or not; ranges index into the drawn ones, which lead `all`
  const keys = all.map(rowKey);
  const live = new Set(keys.filter((k) => checked.has(k)));
  const picked = all.filter((r) => live.has(rowKey(r)));
  const allOn = all.length > 0 && live.size === all.length;

  const toggle = (index: number, shift: boolean) => {
    setChecked(ticked(keys, live, index, shift, anchor.current));
    anchor.current = index;
  };

  const actions = bulk?.filter((a) => !a.when || a.when(picked)) ?? [];

  return (
    <>
      {bulk && live.size > 0 ? <BulkBar count={live.size} actions={actions} picked={picked} clear={() => setChecked(new Set())} /> : null}
      <div className={wrapClass(step)}>
        <table className={`data-table ${order.tableClass}`.trim()} aria-label={label}>
          <Head
            columns={columns}
            grip={Boolean(reorder)}
            select={bulk ? { all: allOn, some: live.size > 0, toggle: () => setChecked(new Set(allOn ? [] : keys)) } : undefined}
          />
          <tbody>
            {rows.map((row, i) => {
              const key = rowKey(row);
              return (
                <Row
                  key={key}
                  row={row}
                  columns={columns}
                  rowClass={rowClass}
                  selected={selectedKey === key || live.has(key)}
                  lift={order.row(i)}
                  onOpen={onRowClick}
                  grip={reorder && order.handle(row, i)}
                  check={
                    bulk && (
                      <input
                        type="checkbox"
                        aria-label={`Select row ${i + 1}`}
                        checked={live.has(key)}
                        onChange={(e) => toggle(i, (e.nativeEvent as MouseEvent).shiftKey)}
                      />
                    )
                  }
                />
              );
            })}
          </tbody>
        </table>
        {more}
      </div>
      {reorder ? (
        <div className="sr-only" aria-live="assertive">
          {order.announcement}
        </div>
      ) : null}
    </>
  );
}

/** Ticking row `index` flips it; with a shift-click from `from`, every row in between follows it. */
function ticked(keys: string[], live: Set<string>, index: number, shift: boolean, from: number | null): Set<string> {
  const next = new Set(live);
  const on = !live.has(keys[index] ?? '');
  const [a, b] = shift && from !== null ? [Math.min(from, index), Math.max(from, index)] : [index, index];
  for (const k of keys.slice(a, b + 1)) on ? next.add(k) : next.delete(k);
  return next;
}

function Row<T>({
  row,
  columns,
  rowClass,
  selected,
  lift,
  onOpen,
  grip,
  check,
}: {
  row: T;
  columns: Column<T>[];
  rowClass: ((row: T) => string | undefined) | undefined;
  selected: boolean;
  lift: { className?: string; style?: CSSProperties };
  onOpen: ((row: T) => void) | undefined;
  grip: ReactNode;
  check: ReactNode;
}) {
  const className = [rowClass?.(row), selected ? 'sel' : '', lift.className].filter(Boolean).join(' ');
  const open = onOpen && (() => onOpen(row));
  return (
    <tr
      className={className || undefined}
      style={lift.style}
      tabIndex={open ? 0 : undefined}
      onClick={open}
      onKeyDown={open && ((e) => activate(e, open))}
    >
      {grip ? <OwnCell className="c-grip">{grip}</OwnCell> : null}
      {check ? <OwnCell className="c-check">{check}</OwnCell> : null}
      {columns.map((c) => (
        <td
          key={c.key}
          className={[c.align === 'end' ? 'r' : '', c.phone ? `ph-${c.phone}` : 'ph-hide', c.className ?? ''].filter(Boolean).join(' ')}
        >
          {c.cell(row)}
        </td>
      ))}
    </tr>
  );
}

/** Enter or Space on the row itself opens it, like a click. */
function activate(e: KeyEvent<HTMLElement>, open: () => void) {
  if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return;
  e.preventDefault();
  open();
}

/**
 * A cell whose clicks and Enter or Space stay out of the row: picking up a row by its grip, or
 * ticking its checkbox, mustn't open it. Escape still reaches the bulk bar.
 */
function OwnCell({ className, children }: { className: string; children: ReactNode }) {
  return (
    <td
      className={className}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') e.stopPropagation();
      }}
    >
      {children}
    </td>
  );
}

function Head<T>({
  columns,
  grip,
  select,
}: {
  columns: Column<T>[];
  grip: boolean;
  select: { all: boolean; some: boolean; toggle: () => void } | undefined;
}) {
  return (
    <thead>
      <tr>
        {grip ? (
          <th className="c-grip">
            <span className="sr-only">Reorder</span>
          </th>
        ) : null}
        {select ? (
          <th className="c-check">
            <input
              type="checkbox"
              aria-label="Select all"
              checked={select.all}
              ref={(el) => {
                if (el) el.indeterminate = select.some && !select.all;
              }}
              onChange={select.toggle}
            />
          </th>
        ) : null}
        {columns.map((c) => (
          <th key={c.key} className={[c.align === 'end' ? 'r' : '', c.size ? `col-${c.size}` : ''].filter(Boolean).join(' ') || undefined}>
            {c.header}
          </th>
        ))}
      </tr>
    </thead>
  );
}

/** A list drawn in batches keeps its height and scrolls inside the card. */
const wrapClass = (step: number) => (Number.isFinite(step) ? 'table-wrap scroll-box' : 'table-wrap');

/** A reorderable table shows every row: dragging needs them all on screen. */
const stepOf = (limit: number | false = STEP, reorder: unknown = null) => (reorder || limit === false ? Number.POSITIVE_INFINITY : limit);

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
