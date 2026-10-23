/** A big number with a label above it and, optionally, a note below. Sit several in a `.figures` row. */
export function Figure({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'bad' }) {
  return (
    <div className="figure">
      <span className="label">{label}</span>
      <span className={`value num${tone ? ` tone-${tone}` : ''}`}>{value}</span>
      {sub ? <span className="sub num">{sub}</span> : null}
    </div>
  );
}
