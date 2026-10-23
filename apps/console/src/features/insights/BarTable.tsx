import { bytes } from '../../lib/format.ts';
import { DataTable } from '../../ui/DataTable.tsx';
import { Searchable } from '../../ui/FilterBar.tsx';

export interface BarRow {
  key: string;
  name: string;
  down: number;
  up: number;
  total: number;
}

/** A table of who moved how much, each name with a bar scaled to the busiest row. */
export function BarTable({ rows, label, onRow }: { rows: BarRow[]; label: string; onRow?: (key: string) => void }) {
  const max = Math.max(1, ...rows.map((r) => r.total));
  return (
    <Searchable
      rows={rows}
      label={`Search ${label.toLowerCase()}`}
      placeholder="Search by name"
      none="Nothing matches."
      fields={(r) => [r.name]}
    >
      {(hit) => <Bars rows={hit} label={label} max={max} onRow={onRow} />}
    </Searchable>
  );
}

function Bars({ rows, label, max, onRow }: { rows: BarRow[]; label: string; max: number; onRow?: (key: string) => void }) {
  return (
    <DataTable
      label={label}
      rows={rows}
      rowKey={(r) => r.key}
      onRowClick={onRow ? (r) => onRow(r.key) : undefined}
      columns={[
        {
          key: 'name',
          header: 'Name',
          phone: 'title',
          cell: (r) => (
            <div className="bar-cell start">
              <span className="name">{r.name}</span>
              <span className="bar">
                <i style={{ width: `${Math.max(2, (r.total / max) * 100)}%` }} />
              </span>
            </div>
          ),
        },
        { key: 'down', header: 'Download', align: 'end', phone: 'sub', cell: (r) => bytes(r.down) },
        { key: 'up', header: 'Upload', align: 'end', cell: (r) => bytes(r.up) },
        { key: 'total', header: 'Total', align: 'end', phone: 'end', cell: (r) => bytes(r.total) },
      ]}
    />
  );
}
