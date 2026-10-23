import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { DataTable } from './DataTable.tsx';

interface Item {
  id: string;
  name: string;
  locked?: boolean;
}
const ITEMS: Item[] = [
  { id: 'a', name: 'Alpha' },
  { id: 'b', name: 'Bravo' },
  { id: 'c', name: 'Charlie', locked: true },
  { id: 'd', name: 'Delta' },
];

const onMove = vi.fn();
const onClick = vi.fn();

function renderTable(rows = ITEMS) {
  render(
    <DataTable
      label="Items"
      rows={rows}
      rowKey={(r) => r.id}
      onRowClick={onClick}
      reorder={{ onMove, label: (r) => r.name, canMove: (r) => !r.locked }}
      columns={[{ key: 'name', header: 'Name', cell: (r) => r.name }]}
    />,
  );
}

const grip = (name: string) => screen.getByRole('button', { name: `Move ${name}` });
const said = () => document.querySelector('[aria-live]')?.textContent;
const key = (name: string, k: string) => fireEvent.keyDown(grip(name), { key: k });

// jsdom has no layout: every row is 40px tall, stacked in DOM order
beforeEach(() => {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const row = this.closest('tr');
    const i = row?.parentElement ? Array.from(row.parentElement.children).indexOf(row) : 0;
    return { top: i * 40, bottom: i * 40 + 40, left: 0, right: 100, width: 100, height: 40, x: 0, y: i * 40, toJSON: () => ({}) };
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  onMove.mockClear();
  onClick.mockClear();
});

test('a row is picked up, moved and dropped from the keyboard, announced as it goes', () => {
  renderTable();
  key('Alpha', ' ');
  expect(said()).toBe('Alpha, position 1 of 4');
  expect(grip('Alpha').getAttribute('aria-pressed')).toBe('true');
  key('Alpha', 'ArrowDown');
  key('Alpha', 'ArrowDown');
  expect(said()).toBe('Alpha, position 3 of 4');
  // other rows step aside by the lifted row’s height while it travels
  expect(screen.getByText('Bravo').closest('tr')?.style.transform).toBe('translateY(-40px)');
  expect(screen.getByText('Alpha').closest('tr')?.className).toContain('lifted');
  expect(onMove).not.toHaveBeenCalled();
  key('Alpha', 'Enter');
  expect(onMove).toHaveBeenCalledOnce();
  expect(onMove).toHaveBeenCalledWith(ITEMS[0], 0, 2);
  expect(said()).toBe('Alpha dropped, position 3 of 4');
  expect(onClick).not.toHaveBeenCalled();
});

test('the arrow keys stop at the ends, and a drop where it started moves nothing', () => {
  renderTable();
  key('Bravo', 'Enter');
  key('Bravo', 'ArrowUp');
  key('Bravo', 'ArrowUp');
  expect(said()).toBe('Bravo, position 1 of 4');
  key('Bravo', 'ArrowDown');
  key('Bravo', ' ');
  expect(onMove).not.toHaveBeenCalled();
});

test('arrow keys do nothing until a row is picked up', () => {
  renderTable();
  key('Alpha', 'ArrowDown');
  expect(said()).toBe('');
  expect(screen.getByText('Bravo').closest('tr')?.style.transform).toBe('');
});

test('Escape cancels a keyboard move', () => {
  renderTable();
  key('Alpha', ' ');
  key('Alpha', 'ArrowDown');
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(onMove).not.toHaveBeenCalled();
  expect(said()).toBe('Move cancelled, Alpha stays at position 1 of 4');
  expect(screen.getByText('Alpha').closest('tr')?.className ?? '').not.toContain('lifted');
  // and the arrow keys are idle again
  key('Alpha', 'ArrowDown');
  expect(said()).toBe('Move cancelled, Alpha stays at position 1 of 4');
});

test('leaving the handle cancels a keyboard move', () => {
  renderTable();
  key('Alpha', ' ');
  key('Alpha', 'ArrowDown');
  fireEvent.blur(grip('Alpha'));
  expect(onMove).not.toHaveBeenCalled();
});

test('dragging with a pointer lifts the row, shifts the others and drops once', () => {
  renderTable();
  const handle = grip('Alpha');
  fireEvent.pointerDown(handle, { button: 0, clientY: 20, pointerId: 1 });
  expect(screen.getByRole('table').className).toContain('by-pointer');
  // 85px down: Alpha’s bottom edge (125) has passed Bravo’s and Charlie’s middles, not Delta’s
  fireEvent.pointerMove(handle, { clientY: 105, pointerId: 1 });
  expect(screen.getByText('Alpha').closest('tr')?.style.transform).toBe('translateY(85px)');
  expect(screen.getByText('Bravo').closest('tr')?.style.transform).toBe('translateY(-40px)');
  expect(screen.getByText('Charlie').closest('tr')?.style.transform).toBe('translateY(-40px)');
  expect(screen.getByText('Delta').closest('tr')?.style.transform).toBe('');
  expect(said()).toBe('Alpha, position 3 of 4');
  expect(onMove).not.toHaveBeenCalled();
  fireEvent.pointerUp(handle, { pointerId: 1 });
  expect(onMove).toHaveBeenCalledOnce();
  expect(onMove).toHaveBeenCalledWith(ITEMS[0], 0, 2);
});

test('a row can be dragged up, and no further than the list', () => {
  renderTable();
  const handle = grip('Delta');
  fireEvent.pointerDown(handle, { button: 0, clientY: 140, pointerId: 1 });
  fireEvent.pointerMove(handle, { clientY: -500, pointerId: 1 });
  expect(screen.getByText('Delta').closest('tr')?.style.transform).toBe('translateY(-120px)');
  fireEvent.pointerUp(handle, { pointerId: 1 });
  expect(onMove).toHaveBeenCalledWith(ITEMS[3], 3, 0);
});

test('Escape and a cancelled pointer both leave the order alone', () => {
  renderTable();
  const handle = grip('Alpha');
  fireEvent.pointerDown(handle, { button: 0, clientY: 20, pointerId: 1 });
  fireEvent.pointerMove(handle, { clientY: 105, pointerId: 1 });
  fireEvent.keyDown(window, { key: 'Escape' });
  fireEvent.pointerUp(handle, { pointerId: 1 });
  expect(onMove).not.toHaveBeenCalled();
  fireEvent.pointerDown(handle, { button: 0, clientY: 20, pointerId: 2 });
  fireEvent.pointerMove(handle, { clientY: 105, pointerId: 2 });
  fireEvent.pointerCancel(handle, { pointerId: 2 });
  expect(onMove).not.toHaveBeenCalled();
});

test('only the primary button drags, and a click on the grip does not open the row', () => {
  renderTable();
  fireEvent.pointerDown(grip('Alpha'), { button: 2, clientY: 20, pointerId: 1 });
  expect(screen.getByRole('table').className).not.toContain('reordering');
  fireEvent.click(grip('Alpha'));
  expect(onClick).not.toHaveBeenCalled();
});

test('rows that can’t move have no handle', () => {
  renderTable();
  expect(screen.queryByRole('button', { name: 'Move Charlie' })).toBeNull();
  expect(screen.getAllByRole('button', { name: /^Move / })).toHaveLength(3);
});

test('a table without reorder has no grip column or announcer', () => {
  render(<DataTable label="Plain" rows={ITEMS} rowKey={(r) => r.id} columns={[{ key: 'name', header: 'Name', cell: (r) => r.name }]} />);
  expect(screen.queryByRole('button')).toBeNull();
  expect(document.querySelector('[aria-live]')).toBeNull();
});
