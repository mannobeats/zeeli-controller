import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, isDemo } from '../../api/router.ts';
import { navigate } from '../../app/useHashRoute.ts';
import { errorMessage } from '../../lib/errors.ts';
import { ago } from '../../lib/format.ts';
import { Button } from '../../ui/Button.tsx';
import { useFeedback } from '../../ui/feedback.tsx';
import { Chip, KeyValues, Note, Panel } from '../../ui/Layout.tsx';
import { newer, parts, REPO, type Release, useRelease, VERSION } from './console-release.ts';

/** In the top bar while a newer console is out. */
export function UpdateNotice() {
  const release = useRelease().data;
  if (!release || !newer(release.tag, VERSION)) return null;
  return (
    <button type="button" className="chip warn update-notice" onClick={() => navigate('firmware')}>
      Update to {release.tag.slice(1)}
    </button>
  );
}

const DEV = !parts(VERSION);

function latestText(release: Release | null | undefined) {
  if (release === undefined) return 'Checking…';
  return release ? `${release.tag.slice(1)}, published ${ago(release.published)}` : 'None yet';
}

function StateChip({ behind, known }: { behind: boolean; known: boolean }) {
  if (behind) return <Chip tone="warn">Update</Chip>;
  return known && !DEV ? <Chip tone="ok">Latest</Chip> : null;
}

/** The console's own version, the latest release, and installing it on the router. */
export function ConsoleUpdatePanel() {
  const { data: r, error } = useRelease();
  const behind = Boolean(r && newer(r.tag, VERSION));
  return (
    <Panel
      title={behind ? `Zeeli Controller ${r?.tag.slice(1)} is available` : 'Zeeli Controller'}
      actions={<StateChip behind={behind} known={Boolean(r)} />}
    >
      <KeyValues
        rows={[
          ['Installed', DEV ? `Development build ${VERSION}` : VERSION],
          ['Latest release', error ? 'Unknown' : latestText(r)],
        ]}
      />
      {error ? <p className="form-error">{errorMessage(error)}</p> : null}
      {r && (behind || DEV) ? <InstallRelease release={r} notes={behind} /> : null}
    </Panel>
  );
}

function InstallRelease({ release, notes }: { release: Release; notes: boolean }) {
  const { toast, confirm } = useFeedback();
  const [busy, setBusy] = useState(false);
  const { tag, changes } = release;
  // a router installed before the agent existed can't update itself until it's installed once
  const agent = useQuery({ queryKey: ['agent-version'], queryFn: api.agent.version, staleTime: 60_000 }).data;
  const allowed = agent === undefined ? undefined : agent !== null;

  async function install() {
    if (
      !(await confirm({
        title: `Install Zeeli Controller ${tag.slice(1)}?`,
        body: 'The router downloads it from GitHub, checks its signature and replaces this console. Your settings and every device’s connection stay as they are. The page reloads when it’s done.',
        confirm: 'Install',
        danger: false,
      }))
    )
      return;
    setBusy(true);
    try {
      await api.agent.installConsole(tag);
      toast(`Installed ${tag.slice(1)}. Reloading…`);
      if (!isDemo) setTimeout(() => location.reload(), 1500);
    } catch (err) {
      toast(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {notes && changes.length ? (
        <ul className="release-notes">
          {changes.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      ) : null}
      {allowed === false ? (
        <Note>
          The router doesn’t let the console update itself yet. Run the install command from the{' '}
          <a href={`https://github.com/${REPO}/releases/latest`} target="_blank" rel="noreferrer">
            release notes
          </a>{' '}
          once over SSH, and later updates install from here.
        </Note>
      ) : null}
      <div className="row-actions start">
        <Button variant="strong" busy={busy} disabled={allowed !== true} onClick={install}>
          Install {tag.slice(1)}
        </Button>
      </div>
    </>
  );
}
