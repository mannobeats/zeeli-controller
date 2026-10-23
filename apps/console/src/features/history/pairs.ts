import type { HistoryEvent, HistoryEventKind } from '@zeeli/router-api';

/** A stretch between an opening and a closing event: an outage, a visit. `to` is null while it lasts. */
export interface Span {
  from: Date;
  to: Date | null;
}

/**
 * Match each `open` event with the next `close` after it, newest first. A close with nothing
 * open is skipped: the record may start in the middle of one.
 */
export function pairUp(events: HistoryEvent[], open: HistoryEventKind, close: HistoryEventKind): Span[] {
  const spans: Span[] = [];
  let since: Date | null = null;
  for (const e of [...events].sort((a, b) => a.time.getTime() - b.time.getTime())) {
    if (e.kind === open && !since) since = e.time;
    if (e.kind === close && since) {
      spans.push({ from: since, to: e.time });
      since = null;
    }
  }
  if (since) spans.push({ from: since, to: null });
  return spans.reverse();
}

/** How long a span lasted, in words: "40 s", "4 min", "2 h 5 min", "3 days". */
export function lasted(span: Span, now = new Date()): string {
  const s = Math.max(0, Math.round(((span.to ?? now).getTime() - span.from.getTime()) / 1000));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.round(s / 60)} min`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h${s % 3600 >= 60 ? ` ${Math.floor((s % 3600) / 60)} min` : ''}`;
  return `${Math.round(s / 86_400)} days`;
}

/** A time for a list: "Thu, Oct 22, 8:05 PM". */
export const when = (d: Date) =>
  d.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
