import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';
import { Searchable } from './FilterBar.tsx';

afterEach(cleanup);

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i, name: `Rule ${i}`, port: 8000 + i }));

const list = (n: number, min?: number) =>
  render(
    <Searchable rows={rows(n)} label="Search rules" placeholder="Name or port" none="No rules match." min={min}>
      {(hit) => (
        <ul>
          {hit.map((r) => (
            <li key={r.id}>{r.name}</li>
          ))}
        </ul>
      )}
    </Searchable>,
  );

test('a short list gets no search box', () => {
  list(3);
  expect(screen.queryByRole('searchbox')).toBeNull();
  expect(screen.getAllByRole('listitem')).toHaveLength(3);
});

test('a long list can be searched by any value, every word at once', () => {
  list(12);
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search rules' }), { target: { value: 'rule 8003' } });
  expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Rule 3']);
  expect(screen.getByText('1 of 12')).toBeTruthy();
});

test('nothing matching says so, and Clear brings everything back', () => {
  list(12);
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'zzz' } });
  expect(screen.getByText('No rules match.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
  expect(screen.getAllByRole('listitem')).toHaveLength(12);
});
