import {
  IconArrowDown,
  IconArrowUp,
  IconDevices,
  IconDots,
  IconLayoutDashboard,
  IconLogout,
  IconMenu2,
  IconMoon,
  IconNetwork,
  IconRouter,
  IconSearch,
  IconSun,
  IconWifi,
} from '@tabler/icons-react';
import { type RouterInfo, uplinkName } from '@zeeli/router-api';
import { DropdownMenu, Tooltip } from 'radix-ui';
import { type ReactNode, useState } from 'react';
import { useClients, useInfo, useStatus } from '../api/queries.ts';
import { isDemo } from '../api/router.ts';
import { duration, rateText } from '../lib/format.ts';
import { CommandPalette } from './CommandPalette.tsx';
import { pageById, SECTIONS, type Section } from './nav.ts';
import { toggleTheme, useTheme } from './theme.ts';
import { navigate } from './useHashRoute.ts';

const firstPage = (s: Section) => s.groups[0]?.pages[0]?.id ?? 'dashboard';
const hasPages = (s: Section) => s.groups.length > 1 || s.groups.some((g) => g.pages.length > 1);

/** Phone bottom bar: the four places people go most, then the full menu. */
const TABS = [
  ['dashboard', 'Dashboard', IconLayoutDashboard],
  ['clients', 'Clients', IconDevices],
  ['wifi', 'WiFi', IconWifi],
  ['networks', 'Networks', IconNetwork],
] as const;

export function Shell({ page, children, onSignOut }: { page: string; children: ReactNode; onSignOut: () => void }) {
  const section = pageById(page)?.section ?? SECTIONS[0];
  const [drawer, setDrawer] = useState(false);
  const [palette, setPalette] = useState(false);
  const go = (id: string) => {
    navigate(id);
    setDrawer(false);
  };
  if (!section) return null;

  return (
    <Tooltip.Provider delayDuration={400}>
      <div className={`app${hasPages(section) ? ' has-ctx' : ''}`}>
        <TopBar onSearch={() => setPalette(true)} onSignOut={onSignOut} />
        <Rail current={section} go={go} />
        <aside className={`ctx${drawer ? ' open' : ''}`} aria-label={drawer ? 'Menu' : `${section.title} pages`}>
          {drawer ? <AllPages current={page} go={go} /> : <SectionPages section={section} current={page} go={go} />}
        </aside>
        {drawer ? <button type="button" className="scrim open ctx-scrim" aria-label="Close menu" onClick={() => setDrawer(false)} /> : null}
        <main className="main" id="main" tabIndex={-1}>
          <div className="page">{children}</div>
        </main>
        <PhoneTabs page={page} go={go} onMenu={() => setDrawer(true)} />
        <CommandPalette open={palette} onOpenChange={setPalette} />
      </div>
    </Tooltip.Provider>
  );
}

function TopBar({ onSearch, onSignOut }: { onSearch: () => void; onSignOut: () => void }) {
  const info = useInfo().data;
  return (
    <header className="topbar">
      <span className="brand-mark" aria-hidden>
        <IconRouter size={18} stroke={1.75} />
      </span>
      <div className="router-id">
        <span className="host">{info?.hostname ?? 'Router'}</span>
        <span className="model">
          {info?.model}
          {isDemo ? ' · demo' : ''}
        </span>
      </div>
      <LinkState />
      <div className="right">
        <LiveRate />
        <button type="button" className="search-trigger" onClick={onSearch}>
          <IconSearch size={16} stroke={1.75} />
          <span>Search</span>
          <kbd>⌘K</kbd>
        </button>
        <ThemeButton />
        <AccountMenu info={info} onSignOut={onSignOut} />
      </div>
    </header>
  );
}

/** "Online via Ethernet 1" in words, so the uplink is never more than a glance away. */
function LinkState() {
  const status = useStatus().data;
  if (!status) return null;
  const up = status.uplinks.filter((u) => u.up).map((u) => uplinkName(u.interface));
  return (
    <button type="button" className={`link-state${up.length ? '' : ' down'}`} onClick={() => navigate('internet')}>
      <span className="mark" />
      {up.length ? `Online via ${up.join(' + ')}` : 'Offline'}
    </button>
  );
}

function LiveRate() {
  const clients = useClients().data;
  if (!clients) return null;
  let down = 0;
  let up = 0;
  for (const c of clients) {
    if (!c.online) continue;
    down += c.rx;
    up += c.tx;
  }
  return (
    <span className="live-rate num" title="Live traffic through the router">
      <IconArrowDown size={14} stroke={2} />
      {rateText(down)}
      <IconArrowUp size={14} stroke={2} />
      {rateText(up)}
    </span>
  );
}

function ThemeButton() {
  const dark = useTheme() === 'dark';
  return (
    <button
      type="button"
      className="icon-btn"
      onClick={toggleTheme}
      aria-label={dark ? 'Use light mode' : 'Use dark mode'}
      title={dark ? 'Light mode' : 'Dark mode'}
    >
      {dark ? <IconSun size={18} stroke={1.75} /> : <IconMoon size={18} stroke={1.75} />}
    </button>
  );
}

function AccountMenu({ info, onSignOut }: { info: RouterInfo | undefined; onSignOut: () => void }) {
  const status = useStatus().data;
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button type="button" className="icon-btn" aria-label="Account">
          <IconDots size={18} stroke={1.75} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="menu open" align="end" sideOffset={6}>
          <div className="who">
            <b>{info?.hostname}</b>
            {info?.model} · firmware {info?.firmware}
            {status ? <span>Up {duration(status.uptime)} · signed in as root</span> : null}
          </div>
          <DropdownMenu.Separator asChild>
            <hr />
          </DropdownMenu.Separator>
          <DropdownMenu.Item className="menu-item" onSelect={onSignOut}>
            <IconLogout size={16} stroke={1.75} />
            Sign out
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function Rail({ current, go }: { current: Section; go: (id: string) => void }) {
  return (
    <nav className="rail" aria-label="Sections">
      {SECTIONS.map((s) => (
        <Tooltip.Root key={s.id}>
          <Tooltip.Trigger asChild>
            <button
              type="button"
              className="rail-btn"
              aria-current={s.id === current.id ? 'true' : undefined}
              aria-label={s.title}
              onClick={() => go(firstPage(s))}
            >
              <s.icon size={20} stroke={1.75} />
            </button>
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content side="right" sideOffset={10} className="tooltip">
              {s.title}
            </Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip.Root>
      ))}
    </nav>
  );
}

function PageButton({ id, title, current, go }: { id: string; title: string; current: string; go: (id: string) => void }) {
  return (
    <button type="button" className="ctx-item" aria-current={id === current ? 'page' : undefined} onClick={() => go(id)}>
      {title}
    </button>
  );
}

function SectionPages({ section, current, go }: { section: Section; current: string; go: (id: string) => void }) {
  return (
    <>
      <h2 className="ctx-title">{section.title}</h2>
      {section.groups.map((g) => (
        <div key={g.label ?? 'main'}>
          {g.label ? <div className="ctx-sub">{g.label}</div> : null}
          <div className="ctx-list">
            {g.pages.map((p) => (
              <PageButton key={p.id} id={p.id} title={p.title} current={current} go={go} />
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

/** Phone menu: every section once. A one-page section is a single row, not a heading over itself. */
function AllPages({ current, go }: { current: string; go: (id: string) => void }) {
  return (
    <>
      {SECTIONS.map((s) => {
        const pages = s.groups.flatMap((g) => g.pages);
        const only = pages.length === 1 ? pages[0] : undefined;
        if (only)
          return (
            <div key={s.id} className="ctx-group">
              <button
                type="button"
                className="ctx-item ctx-solo"
                aria-current={only.id === current ? 'page' : undefined}
                onClick={() => go(only.id)}
              >
                <s.icon size={16} stroke={1.75} />
                {s.title}
              </button>
            </div>
          );
        return (
          <div key={s.id} className="ctx-group">
            <div className="ctx-sub ctx-sub-icon">
              <s.icon size={16} stroke={1.75} />
              {s.title}
            </div>
            <div className="ctx-list">
              {pages.map((p) => (
                <PageButton key={p.id} id={p.id} title={p.title} current={current} go={go} />
              ))}
            </div>
          </div>
        );
      })}
    </>
  );
}

function PhoneTabs({ page, go, onMenu }: { page: string; go: (id: string) => void; onMenu: () => void }) {
  return (
    <nav className="tabs" aria-label="Main">
      {TABS.map(([id, label, Icon]) => (
        <button key={id} type="button" aria-current={page === id ? 'page' : undefined} onClick={() => go(id)}>
          <Icon size={20} stroke={1.75} />
          {label}
        </button>
      ))}
      <button type="button" onClick={onMenu}>
        <IconMenu2 size={20} stroke={1.75} />
        More
      </button>
    </nav>
  );
}
