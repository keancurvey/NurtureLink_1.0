// The axis of a chart: round numbers that cover the values.

/** Round tick values that cover [min, max]: about `count` steps of 1, 2, 2.5, 5 or 10 times a power of ten. */
export function niceTicks(min, max, count = 5) {
  const span = max - min || 1;
  const raw = span / count;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((n) => n * power).find((n) => n >= raw) ?? raw;
  const first = Math.floor(min / step) * step;
  const ticks = [];
  for (let v = first; v <= max + step / 2; v += step) ticks.push(Math.round(v * 1000) / 1000);
  return { ticks, step };
}
