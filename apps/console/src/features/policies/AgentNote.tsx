import { navigate } from '../../app/useHashRoute.ts';
import { PageHeader } from '../../ui/Layout.tsx';
import { useAgentVersion } from './queries.ts';

/** What a page about groups or policies shows on a router that doesn't have the Zeeli agent yet. */
export function AgentMissing({ title, what }: { title: string; what: string }) {
  return (
    <>
      <PageHeader title={title} />
      <div className="panel notice">
        <h2>{what} need the Zeeli agent</h2>
        <p className="kicker">
          The agent is the part of Zeeli that runs on the router. It installs with the console, so open{' '}
          <button type="button" className="link" onClick={() => navigate('firmware')}>
            Firmware
          </button>{' '}
          and update the console, then come back.
        </p>
      </div>
    </>
  );
}

/** A line on the older pages (blocking, parental control, access control) that ends in a link to Policies, once the agent is there. */
export function PolicyNote({ children }: { children: string }) {
  const agent = useAgentVersion();
  if (!agent.data) return null;
  return (
    <p className="page-note">
      {children}{' '}
      <button type="button" className="link" onClick={() => navigate('policies')}>
        Policies
      </button>
      .
    </p>
  );
}
