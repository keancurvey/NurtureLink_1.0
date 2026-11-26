import { TriangleAlert } from 'lucide-react';
import { niceTicks } from '../../lib/chartTicks.js';
import { formatDayMonth } from '../../lib/format.js';

const W = 340;
const H = 190;
const M = { left: 40, right: 10, top: 10, bottom: 28 };

/**
 * A line chart of readings over time, drawn as inline SVG (no chart library). Points outside the normal range are triangles
 * in the alert colour (shape and colour, and the legend says so); the normal range is a soft band.
 *   points  [{ at, value, outOfRange }] oldest first
 *   range   { min, max } of the normal range, a missing end meaning no limit on that side
 *   from, to  the period the x axis covers, in milliseconds
 *   label   what a screen reader hears (the facts of the series)
 */
export default function LineChart({ points, range, from, to, label, lang = 'en', legend }) {
  const values = points.map((p) => p.value);
  const lows = [...values, range.min ?? Infinity].filter(Number.isFinite);
  const highs = [...values, range.max ?? -Infinity].filter(Number.isFinite);
  const low = Math.min(...lows);
  const high = Math.max(...highs);
  const pad = (high - low) * 0.08; // room so a point at the lowest or highest value is not cut by the edge
  const { ticks, step } = niceTicks(low - pad, high + pad);
  const yMin = ticks[0];
  const yMax = ticks[ticks.length - 1];
  const x = (at) => M.left + ((at - from) / (to - from || 1)) * (W - M.left - M.right);
  const y = (v) => M.top + (1 - (v - yMin) / (yMax - yMin || 1)) * (H - M.top - M.bottom);
  const decimals = step < 1 ? 1 : 0;
  const bandTop = y(Math.min(range.max ?? yMax, yMax));
  const bandBottom = y(Math.max(range.min ?? yMin, yMin));
  const dayTicks = [0, 1 / 3, 2 / 3, 1].map((f) => from + f * (to - from));
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.at).toFixed(1)} ${y(p.value).toFixed(1)}`).join(' ');

  return (
    <figure className="chart">
      <svg className="chart__svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
        <rect className="chart__band" x={M.left} y={bandTop} width={W - M.left - M.right} height={Math.max(0, bandBottom - bandTop)} />
        {ticks.map((tick) => (
          <g key={tick}>
            <line className="chart__grid" x1={M.left} x2={W - M.right} y1={y(tick)} y2={y(tick)} />
            <text className="chart__tick" x={M.left - 6} y={y(tick)} textAnchor="end" dominantBaseline="middle">
              {tick.toFixed(decimals)}
            </text>
          </g>
        ))}
        {dayTicks.map((at, i) => (
          <text key={at} className="chart__tick" x={x(at)} y={H - 6} textAnchor={i === 0 ? 'start' : i === dayTicks.length - 1 ? 'end' : 'middle'}>
            {formatDayMonth(at, lang)}
          </text>
        ))}
        <path className="chart__line" d={path} />
        {points.map((p) =>
          p.outOfRange ? (
            <polygon key={p.at} className="chart__flag" points={`${x(p.at)},${y(p.value) - 6} ${x(p.at) - 6},${y(p.value) + 5} ${x(p.at) + 6},${y(p.value) + 5}`} />
          ) : (
            <circle key={p.at} className="chart__dot" cx={x(p.at)} cy={y(p.value)} r="3" />
          ),
        )}
      </svg>
      {legend ? (
        <figcaption className="chart__legend">
          <span className="chart__item">
            <span className="chart__key chart__key--band" aria-hidden="true" />
            {legend.normal}
          </span>
          <span className="chart__item">
            <TriangleAlert className="chart__key-icon" size={16} aria-hidden="true" />
            {legend.outside}
          </span>
        </figcaption>
      ) : null}
    </figure>
  );
}
