/** A tiny two-line chart of recent samples, download and upload. */
export function Sparkline({
  samples,
  width = 200,
  height = 44,
  label,
}: {
  samples: [down: number, up: number][];
  width?: number;
  height?: number;
  label: string;
}) {
  const max = Math.max(1, ...samples.map(([d, u]) => Math.max(d, u))) * 1.1;
  const pts = (i: 0 | 1) =>
    samples.map((v, j) => `${(j / Math.max(1, samples.length - 1)) * width},${height - 2 - (v[i] / max) * (height - 6)}`).join(' ');
  return (
    <svg className="spark" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={label}>
      <polyline className="down" points={pts(0)} fill="none" strokeWidth="1.75" vectorEffect="non-scaling-stroke" />
      <polyline className="up" points={pts(1)} fill="none" strokeWidth="1.75" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
