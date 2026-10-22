import { type ReactNode, use, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { PanelSlot } from './panel-slot.ts';

// Below this width the section panel is hidden, so the page shows its controls inline.
const NARROW = '(max-width: 860px)';
const subscribe = (cb: () => void) => {
  const mq = window.matchMedia(NARROW);
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
};
const isNarrow = () => window.matchMedia(NARROW).matches;

/**
 * Page controls that live in the section panel beside the rail, like Clients' filters.
 * On narrow screens, where that panel is gone, they render in place above the page.
 */
export function SectionPanel({ label, children }: { label: string; children: ReactNode }) {
  const slot = use(PanelSlot);
  const narrow = useSyncExternalStore(subscribe, isNarrow, () => false);
  const body = (
    <section className="filters" aria-label={label}>
      {children}
    </section>
  );
  return slot && !narrow ? createPortal(body, slot) : body;
}
