export interface FacetOption {
  value: string;
  label: string;
  count?: number;
}

export interface Facet {
  /** "Device", "Result": the label read out and shown when nothing is picked ("Any device"). */
  label: string;
  /** What "nothing picked" reads as; defaults to "Any <label>". */
  any?: string;
  value: string;
  options: FacetOption[];
  onChange: (value: string) => void;
}

/**
 * The options for a facet, taken from the rows themselves: only values that occur, busiest first,
 * each with how many rows it has. A device that made no queries is never offered.
 */
export function facetOptions<T>(rows: T[], value: (row: T) => string, label: (value: string) => string = (v) => v): FacetOption[] {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const v = value(r);
    if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return [...counts]
    .map(([v, count]) => ({ value: v, label: label(v), count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/** Rows matching every word of a search, each word in any of the given fields. */
export function matches(needle: string, fields: (string | null | undefined)[]): boolean {
  const hay = fields.filter(Boolean).join(' ').toLowerCase();
  return needle
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w));
}
