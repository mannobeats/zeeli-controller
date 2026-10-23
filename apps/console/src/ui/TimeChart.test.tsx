import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { type ChartSeries, TimeChart } from './TimeChart.tsx';

afterEach(cleanup);

const START = new Date(2026, 9, 22, 0, 0).getTime() / 1000;
const down: ChartSeries = { key: 'down', label: 'Download', tone: 'brand', shape: 'area', values: [10, 20, null, 40, 30] };
const up: ChartSeries = { key: 'up', label: 'Upload', tone: 'ok', shape: 'line', dashed: true, values: [1, 2, 3, 4, 5] };
const unit = (v: number) => `${v} units`;

const chart = (series: ChartSeries[] = [down, up], extra = {}) =>
  render(<TimeChart label="Traffic" start={START} step={3600} series={series} format={unit} {...extra} />);

test('it labels its axes, names each line and says in words how high they go', () => {
  chart();
  expect(screen.getByRole('figure', { name: 'Traffic: Download up to 40 units, Upload up to 5 units' })).toBeTruthy();
  // the scale tops out at a round number above the data, with the middle and the bottom
  expect(screen.getByText('50 units')).toBeTruthy();
  expect(screen.getByText('25 units')).toBeTruthy();
  expect(screen.getByText('0 units')).toBeTruthy();
  expect(screen.getAllByText('Download').length).toBeGreaterThan(0);
  expect(screen.getAllByText('Upload').length).toBeGreaterThan(0);
  // a line drawn without a gap where nothing was measured
  const lines = document.querySelectorAll('path.chart-line');
  expect(lines).toHaveLength(2);
  expect(lines[0]?.getAttribute('d')).toBe('M0.5 80 L1.5 60 M3.5 20 L4.5 40');
  expect(lines[1]?.classList.contains('dashed')).toBe(true);
});

test('bars, an outage band and a fixed scale', () => {
  const bars: ChartSeries = { key: 'loss', label: 'Lost', tone: 'warn', shape: 'bars', values: [0, 2, null, 4] };
  chart([bars], { max: 5, bands: [{ from: START + 3600, to: START + 7200, label: 'Down Thu' }] });
  expect(document.querySelector('path.chart-bar')?.getAttribute('d')).toContain('M1.12 100 V60');
  expect(screen.getByText('5 units')).toBeTruthy();
  expect(document.querySelector('rect.chart-band title')?.textContent).toBe('Down Thu');
});

test('pointing at the plot shows the numbers for that moment', () => {
  chart();
  const plot = document.querySelector('.chart-plot') as HTMLElement;
  vi.spyOn(plot, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    width: 500,
    top: 0,
    height: 140,
    right: 500,
    bottom: 140,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
  fireEvent.pointerMove(plot, { clientX: 250 });
  // the third point, where the download was not measured
  expect(screen.getByText('No data')).toBeTruthy();
  expect(screen.getByText('3 units')).toBeTruthy();
  fireEvent.pointerMove(plot, { clientX: 450 });
  expect(screen.getByText('30 units')).toBeTruthy();
  fireEvent.pointerLeave(plot);
  expect(screen.queryByText('30 units')).toBeNull();
});

test('a chart with nothing in it still draws its frame', () => {
  chart([{ ...down, values: [] }]);
  expect(screen.getByRole('figure')).toBeTruthy();
  expect(document.querySelectorAll('path.chart-line')).toHaveLength(1);
});
