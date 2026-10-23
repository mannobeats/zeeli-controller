import {
  type Icon,
  IconArrowsExchange,
  IconDeviceMobile,
  IconDeviceMobileOff,
  IconDeviceMobilePlus,
  IconPlugConnected,
  IconPlugConnectedX,
  IconTemperature,
} from '@tabler/icons-react';
import { type HistoryEvent, type HistoryEventKind, uplinkName } from '@zeeli/router-api';

/** The dot beside each kind of event: its icon, and a tone for the states people should notice. */
export const EVENT_LOOK: Record<HistoryEventKind, { icon: Icon; tone: 'ok' | 'warn' | 'bad' | 'off' }> = {
  'device.new': { icon: IconDeviceMobilePlus, tone: 'warn' },
  'device.joined': { icon: IconDeviceMobile, tone: 'ok' },
  'device.left': { icon: IconDeviceMobileOff, tone: 'off' },
  'wan.down': { icon: IconPlugConnectedX, tone: 'bad' },
  'wan.up': { icon: IconPlugConnected, tone: 'ok' },
  'wan.failover': { icon: IconArrowsExchange, tone: 'warn' },
  'temp.high': { icon: IconTemperature, tone: 'bad' },
};

/** An event as a sentence. `nameOf` gives a device the name you know it by, or its MAC if unknown. */
export function eventText(e: HistoryEvent, nameOf: (mac: string) => string): string {
  const known = nameOf(e.subject);
  const device = known === e.subject && e.name ? e.name : known;
  switch (e.kind) {
    case 'device.new':
      return `${device} is new on your network`;
    case 'device.joined':
      return `${device} connected`;
    case 'device.left':
      return `${device} disconnected`;
    case 'wan.down':
      return `${uplinkName(e.subject)} went down`;
    case 'wan.up':
      return `${uplinkName(e.subject)} is back`;
    case 'wan.failover':
      return `The router switched from ${uplinkName(e.name)} to ${uplinkName(e.subject)}`;
    case 'temp.high':
      return `The router reached ${e.value ?? '?'} °C`;
  }
}

/** Where an event leads: a device opens its sheet, an uplink opens Internet, heat opens Device. */
export function eventLink(e: HistoryEvent): string {
  if (e.kind.startsWith('device.')) return `clients?device=${encodeURIComponent(e.subject)}`;
  return e.kind === 'temp.high' ? 'device' : 'internet';
}
