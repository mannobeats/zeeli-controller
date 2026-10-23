import { navigate } from '../../app/useHashRoute.ts';
import { SectionPanel } from '../../ui/SectionPanel.tsx';

const PAGES = [
  ['clients', 'Clients'],
  ['groups', 'Groups'],
] as const;

/** Clients owns the section panel for its filters, so the section's two pages are switched here. */
export function ClientPages({ current }: { current: (typeof PAGES)[number][0] }) {
  return (
    <SectionPanel label="Pages">
      <div className="ctx-list">
        {PAGES.map(([id, label]) => (
          <button
            key={id}
            type="button"
            className="ctx-item"
            aria-current={current === id ? 'page' : undefined}
            onClick={() => navigate(id)}
          >
            {label}
          </button>
        ))}
      </div>
    </SectionPanel>
  );
}
