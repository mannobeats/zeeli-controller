import { IconQrcode } from '@tabler/icons-react';
import { useMemo, useState } from 'react';
import { errorMessage } from '../../lib/errors.ts';
import { Button } from '../../ui/Button.tsx';
import { useFeedback } from '../../ui/feedback.tsx';
import { Sheet } from '../../ui/Sheet.tsx';
import { qrPath, wifiQrText } from './wifi-qr.ts';

/** Copies `text` and says so. The text itself never goes in the toast. */
export function CopyButton({ text, what }: { text: string; what: string }) {
  const { toast } = useFeedback();
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      toast(`Copied the ${what}.`);
    } catch {
      toast(`Couldn’t copy the ${what}. Select it and copy by hand.`);
    }
  }
  return (
    <button type="button" className="link" onClick={copy} aria-label={`Copy the ${what}`}>
      Copy
    </button>
  );
}

interface CardProps {
  ssid: string;
  password: string;
  hidden: boolean;
}

/** The code, then the name and password in text, which is also what a screen reader gets. */
function ShareCard({ ssid, password, hidden }: CardProps) {
  const qr = useMemo(() => qrPath(wifiQrText(ssid, password, hidden)), [ssid, password, hidden]);
  return (
    <div className="share-card">
      <svg
        className="share-qr"
        role="img"
        aria-label={`QR code to join ${ssid}`}
        viewBox={`0 0 ${qr.size} ${qr.size}`}
        shapeRendering="crispEdges"
      >
        <rect width={qr.size} height={qr.size} fill="#fff" />
        <path d={qr.d} fill="#000" />
      </svg>
      <p className="hint">Point a phone camera at the code to join. Or type the name and password.</p>
      <dl className="share-text">
        <dt>Network name</dt>
        <dd>
          <span className="mono">{ssid}</span> <CopyButton text={ssid} what="network name" />
        </dd>
        {password ? (
          <>
            <dt>Password</dt>
            <dd>
              <span className="mono">{password}</span> <CopyButton text={password} what="password" />
            </dd>
          </>
        ) : null}
      </dl>
    </div>
  );
}

interface Props {
  ssid: string;
  hidden: boolean;
  /** Reads the password when asked, so it isn't held in the page until someone shares. */
  getPassword: () => Promise<string> | string;
}

/** A Share button that opens the join code for one network, with a print layout. */
export function ShareButton({ ssid, hidden, getPassword }: Props) {
  const { toast } = useFeedback();
  const [password, setPassword] = useState<string | null>(null);
  async function open() {
    try {
      setPassword(await getPassword());
    } catch (err) {
      toast(`Couldn’t read the password: ${errorMessage(err)}`);
    }
  }
  return (
    <>
      <Button icon={<IconQrcode size={16} />} onClick={open}>
        Share
      </Button>
      {password === null ? null : (
        <Sheet open onOpenChange={(o) => !o && setPassword(null)} title={`Share ${ssid}`} sub="Let a guest join without typing.">
          <ShareCard ssid={ssid} password={password} hidden={hidden} />
          <Button onClick={() => window.print()}>Print</Button>
        </Sheet>
      )}
    </>
  );
}
