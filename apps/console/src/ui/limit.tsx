import { type ReactNode, useEffect, useEffectEvent, useRef, useState } from 'react';

/** How many rows a long list draws before it draws more. */
export const STEP = 25;

/**
 * The first `step` rows of a list and, while there are more, a marker that draws the next `step`
 * as it scrolls into view. Put both inside a `ScrollBox`: the card keeps its height and the list
 * scrolls within it, filling in as you go.
 */
export function useLimit<T>(rows: T[], step = STEP) {
  const [limit, setLimit] = useState(step);
  return {
    shown: rows.slice(0, limit),
    // keyed by the limit, so a marker still in view after a batch asks again
    more: limit < rows.length ? <Sentinel key={limit} onSeen={() => setLimit(limit + step)} /> : null,
  };
}

function Sentinel({ onSeen }: { onSeen: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const seen = useEffectEvent(onSeen);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && seen(), { rootMargin: '0px 0px 160px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return <div ref={ref} className="scroll-more" aria-hidden />;
}

/** A card's list area with a fixed height that scrolls inside; `short` for small side cards. */
export function ScrollBox({ label, short, children }: { label: string; short?: boolean; children: ReactNode }) {
  return (
    // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrolling region has to take focus to scroll by keyboard
    <section className={`scroll-box${short ? ' short' : ''}`} aria-label={label} tabIndex={0}>
      {children}
    </section>
  );
}
