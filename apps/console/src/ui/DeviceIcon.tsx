import type { Client } from '@zeeli/router-api';
import { type Category, iconFor } from '../lib/devices.ts';

export function DeviceIcon({ client, size = 16 }: { client: Pick<Client, 'deviceClass' | 'link'>; size?: number }) {
  const I = iconFor(client);
  return <I size={size} stroke={1.75} aria-hidden />;
}

export const Swatch = ({ category }: { category: Category }) => <span className={`swatch cat-${category}`} aria-hidden />;
