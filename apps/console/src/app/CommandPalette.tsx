import { IconMoon } from '@tabler/icons-react';
import { Command } from 'cmdk';
import { Dialog } from 'radix-ui';
import { useEffect, useEffectEvent } from 'react';
import { useClients } from '../api/queries.ts';
import { DeviceIcon } from '../ui/DeviceIcon.tsx';
import { PAGES } from './nav.ts';
import { toggleTheme } from './theme.ts';
import { navigate } from './useHashRoute.ts';

/** ⌘K / Ctrl+K: jump to any page, device or action by typing. */
export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const clients = useClients().data ?? [];

  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      onOpenChange(!open);
    }
  });
  useEffect(() => {
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const run = (fn: () => void) => {
    fn();
    onOpenChange(false);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="scrim open" />
        <Dialog.Content className="palette" aria-describedby={undefined}>
          <Dialog.Title className="sr-only">Search</Dialog.Title>
          <Command label="Search the console" loop>
            <Command.Input placeholder="Search pages, devices and actions" className="palette-input" />
            <Command.List className="palette-list">
              <Command.Empty className="palette-empty">Nothing matches.</Command.Empty>
              <Command.Group heading="Pages">
                {PAGES.map((p) => (
                  <Command.Item
                    key={p.id}
                    value={`${p.title} ${p.section.title} ${p.keywords ?? ''}`}
                    onSelect={() => run(() => navigate(p.id))}
                    className="palette-item"
                  >
                    <p.section.icon size={16} stroke={1.75} />
                    <span>{p.title}</span>
                    <span className="palette-hint">{p.section.title}</span>
                  </Command.Item>
                ))}
              </Command.Group>
              <Command.Group heading="Devices">
                {clients.map((c) => (
                  <Command.Item
                    key={c.mac}
                    value={`${c.name} ${c.ip} ${c.mac}`}
                    onSelect={() => run(() => navigate(`clients?device=${encodeURIComponent(c.mac)}`))}
                    className="palette-item"
                  >
                    <DeviceIcon client={c} />
                    <span>{c.name}</span>
                    <span className="palette-hint mono">{c.ip}</span>
                  </Command.Item>
                ))}
              </Command.Group>
              <Command.Group heading="Actions">
                <Command.Item value="toggle theme dark light mode" onSelect={() => run(toggleTheme)} className="palette-item">
                  <IconMoon size={16} stroke={1.75} />
                  <span>Switch light or dark mode</span>
                </Command.Item>
              </Command.Group>
            </Command.List>
          </Command>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
