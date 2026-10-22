import type { ReactNode } from 'react';

export function PageHeader({ title, sub, actions }: { title: string; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {sub ? <div className="sub">{sub}</div> : null}
      </div>
      {actions ? <div className="actions">{actions}</div> : null}
    </div>
  );
}

/** One surface on the page: a heading row (title, note, actions) and its content. */
export function Panel({
  title,
  note,
  actions,
  children,
  className,
}: {
  title?: ReactNode;
  note?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel${className ? ` ${className}` : ''}`}>
      {title || note || actions ? (
        <div className="panel-head">
          {title ? <h2>{title}</h2> : <span />}
          {note || actions ? (
            <div className="head-end">
              {note ? <span className="note">{note}</span> : null}
              {actions}
            </div>
          ) : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export const Grid = ({ cols = 2, children }: { cols?: 2 | 3; children: ReactNode }) => <div className={`grid g${cols}`}>{children}</div>;
export const Stack = ({ children }: { children: ReactNode }) => <div className="stack">{children}</div>;

export function Empty({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <p className="empty">
      {children}
      {action}
    </p>
  );
}

export const Note = ({ children }: { children: ReactNode }) => <p className="kicker">{children}</p>;

export type Tone = 'ok' | 'warn' | 'bad' | 'brand' | 'off';
export const Chip = ({ tone, children }: { tone?: Tone; children: ReactNode }) => (
  <span className={`chip${tone ? ` ${tone}` : ''}`}>{children}</span>
);
export const ToneText = ({ tone, children }: { tone: Tone; children: ReactNode }) => <span className={`tone-${tone}`}>{children}</span>;

/** Label/value rows, values right-aligned. Labels are unique within one list. */
export function KeyValues({ rows }: { rows: [label: string, value: ReactNode][] }) {
  return (
    <dl className="kv">
      {rows.map(([k, v]) => (
        <div className="kv-row" key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Meter({ value, warnAt = 0.85 }: { value: number; warnAt?: number }) {
  const pct = Math.max(0, Math.min(1, value));
  return (
    <>
      <meter className="sr-only" value={pct} min={0} max={1} high={warnAt}>
        {Math.round(pct * 100)}%
      </meter>
      <span className={`meter${pct >= warnAt ? ' warn' : ''}`} aria-hidden>
        <i style={{ width: `${pct * 100}%` }} />
      </span>
    </>
  );
}
