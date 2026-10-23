import { IconGripVertical } from '@tabler/icons-react';
import { type CSSProperties, type KeyboardEvent, type PointerEvent, useEffect, useEffectEvent, useRef, useState } from 'react';

/** Opt-in drag-to-reorder for a `DataTable`. */
export interface Reorder<T> {
  /** Called once per drop that changes the order: the row, where it was and its final position. */
  onMove: (row: T, from: number, to: number) => void;
  /** What the row is called, for the handle’s name and the spoken announcements. */
  label: (row: T) => string;
  /** Rows that can’t move get no handle. */
  canMove?: (row: T) => boolean;
  /** Handles stay but do nothing, e.g. while the last move is still being saved. */
  disabled?: boolean;
}

interface Drag {
  key: string;
  from: number;
  over: number;
  /** How far the lifted row has travelled from its slot, in px. */
  dy: number;
  pointer: boolean;
}
interface Span {
  top: number;
  bottom: number;
}

const mid = (s: Span) => (s.top + s.bottom) / 2;
const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi);

/** The array with the item at `from` taken out and put at `to`. */
export function moved<T>(list: T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  if (item !== undefined) next.splice(to, 0, item);
  return next;
}

/** The slot the lifted row is over: every row whose middle its leading edge has passed counts as one step. */
function landing(spans: Span[], from: number, dy: number): number {
  const own = spans[from];
  if (!own) return from;
  const top = own.top + dy;
  const bottom = own.bottom + dy;
  return spans.reduce((over, s, j) => over + Number(j > from && mid(s) < bottom) - Number(j < from && mid(s) > top), from);
}

/** How far the lifted row sits from its own slot when it is over slot `over`. */
function travel(spans: Span[], from: number, over: number): number {
  const a = spans[from];
  const b = spans[over];
  if (!a || !b) return 0;
  return over > from ? b.bottom - a.bottom : b.top - a.top;
}

/** Keep the lifted row inside the list. */
function limit(spans: Span[], from: number, dy: number): number {
  const a = spans[from];
  const first = spans[0];
  const last = spans.at(-1);
  return a && first && last ? clamp(dy, first.top - a.top, last.bottom - a.bottom) : 0;
}

/** The rows between the lifted one and where it will land step aside by its height. */
const stepAside = (i: number, d: Drag, height: number) => {
  if (i > d.from && i <= d.over) return -height;
  if (i < d.from && i >= d.over) return height;
  return 0;
};

const measure = (from: HTMLElement): Span[] =>
  Array.from(from.closest('tbody')?.rows ?? [], (tr) => {
    const { top, bottom } = tr.getBoundingClientRect();
    return { top, bottom };
  });

const idle = <T,>(): Reorder<T> => ({ onMove: () => {}, label: () => '', canMove: () => false });

/**
 * The drag state and handlers behind `DataTable`'s reorder column. Pointer events with capture
 * (so touch works); the handle is also a button you pick up with Space or Enter, move with the
 * arrow keys and drop with Space or Enter. Escape cancels either way.
 */
export function useReorder<T>(rows: T[], reorder: Reorder<T> | undefined, rowKey: (row: T) => string) {
  const r = reorder ?? idle<T>();
  const [drag, setDrag] = useState<Drag | null>(null);
  const [said, setSaid] = useState('');
  const geo = useRef({ spans: [] as Span[], startY: 0 });
  const refocus = useRef<string | null>(null);

  const say = (row: T | undefined, at: number) => {
    if (row !== undefined) setSaid(`${r.label(row)}, position ${at + 1} of ${rows.length}`);
  };

  function lift(row: T, i: number, pointer: boolean, spans: Span[], startY = 0) {
    geo.current = { spans, startY };
    setDrag({ key: rowKey(row), from: i, over: i, dy: 0, pointer });
    say(row, i);
  }

  function finish(commit: boolean) {
    if (!drag) return;
    setDrag(null);
    const row = rows[drag.from];
    // a refresh that changed the list mid-drag leaves nothing safe to move
    if (!row || rowKey(row) !== drag.key) return;
    const name = r.label(row);
    if (commit && drag.over !== drag.from) {
      r.onMove(row, drag.from, drag.over);
      setSaid(`${name} dropped, position ${drag.over + 1} of ${rows.length}`);
    } else setSaid(`${commit ? 'Dropped' : 'Move cancelled'}, ${name} stays at position ${drag.from + 1} of ${rows.length}`);
  }

  function goTo(over: number, dy: number) {
    if (!drag) return;
    setDrag({ ...drag, over, dy });
    if (over !== drag.over) say(rows[drag.from], over);
  }

  const onEscape = useEffectEvent((e: globalThis.KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    // the selection bar listens for Escape too; cancelling a drag shouldn't also clear it
    e.stopPropagation();
    finish(false);
  });
  const dragging = drag !== null;
  useEffect(() => {
    if (!dragging) return;
    window.addEventListener('keydown', onEscape, true);
    return () => window.removeEventListener('keydown', onEscape, true);
  }, [dragging]);

  function onPointerDown(e: PointerEvent<HTMLButtonElement>, row: T, i: number) {
    if (e.button !== 0 || drag) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    lift(row, i, true, measure(e.currentTarget), e.clientY);
  }

  function onPointerMove(e: PointerEvent<HTMLButtonElement>) {
    if (!drag?.pointer) return;
    const dy = limit(geo.current.spans, drag.from, e.clientY - geo.current.startY);
    goTo(landing(geo.current.spans, drag.from, dy), dy);
  }

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, row: T, i: number) {
    if (drag?.pointer) return;
    const press = e.key === 'Enter' || e.key === ' ';
    const step = Number(e.key === 'ArrowDown') - Number(e.key === 'ArrowUp');
    if (!press && !(drag && step)) return;
    e.preventDefault();
    if (!drag) return lift(row, i, false, measure(e.currentTarget));
    if (press) {
      refocus.current = drag.key;
      return finish(true);
    }
    const over = clamp(drag.over + step, 0, rows.length - 1);
    goTo(over, travel(geo.current.spans, drag.from, over));
  }

  return {
    announcement: said,
    /** Classes for the table while a row is lifted. */
    tableClass: [drag && 'reordering', drag?.pointer && 'by-pointer'].filter(Boolean).join(' '),
    /** Class and transform for row `i`. */
    row(i: number): { className?: string; style?: CSSProperties } {
      if (!drag) return {};
      if (i === drag.from) return { className: 'lifted', style: { transform: `translateY(${drag.dy}px)` } };
      const own = geo.current.spans[drag.from];
      const by = stepAside(i, drag, own ? own.bottom - own.top : 0);
      return by ? { style: { transform: `translateY(${by}px)` } } : {};
    },
    /** The grip button for row `i`, or nothing when that row can’t move. */
    handle(row: T, i: number) {
      if (!reorder || reorder.canMove?.(row) === false) return null;
      const key = rowKey(row);
      const lifted = drag?.key === key;
      return (
        <button
          type="button"
          className="grip"
          aria-label={`Move ${reorder.label(row)}`}
          aria-pressed={lifted && !drag.pointer ? true : undefined}
          title="Drag to reorder, or press Space and use the arrow keys"
          disabled={reorder.disabled}
          ref={(el) => {
            // moving rows in the DOM can drop focus; a keyboard drop keeps it on the grip
            if (el && refocus.current === key) {
              refocus.current = null;
              el.focus();
            }
          }}
          onPointerDown={(e) => onPointerDown(e, row, i)}
          onPointerMove={onPointerMove}
          onPointerUp={() => drag?.pointer && finish(true)}
          onPointerCancel={() => drag?.pointer && finish(false)}
          onKeyDown={(e) => onKeyDown(e, row, i)}
          onBlur={() => drag && !drag.pointer && finish(false)}
        >
          <IconGripVertical size={16} stroke={1.75} />
        </button>
      );
    },
  };
}
