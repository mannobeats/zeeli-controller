import type { Column } from './DataTable.tsx';
import { ToneText } from './Layout.tsx';

/** The read-only On/Off column at the end of a list of rules. */
export const stateColumn = <T extends { enabled: boolean }>(): Column<T> => ({
  key: 'on',
  header: 'State',
  align: 'end',
  phone: 'end',
  cell: (r) => <ToneText tone={r.enabled ? 'ok' : 'off'}>{r.enabled ? 'On' : 'Off'}</ToneText>,
});
