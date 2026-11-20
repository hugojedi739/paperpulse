// Análisis avanzado del gráfico de Operar: MACD, volumen medio y soportes/resistencias simples.
// Solo cálculo en el navegador sobre las velas ya cargadas (sin servidor, sin red). Sin imports, para probarlo en
// tests/analysis.test.js. Es una herramienta de estudio: no predice el precio ni es una recomendación.

/** EMA de una lista de números; devuelve un array alineado con `values` (null donde aún no hay suficientes datos). */
function emaValues(values, period) {
  const out = new Array(values.length).fill(null);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let e = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = e;
  for (let i = period; i < values.length; i++) out[i] = e = values[i] * k + e * (1 - k);
  return out;
}

/** MACD (12, 26, 9 por defecto): línea, señal e histograma como series {time, value}. */
export function macd(data, fast = 12, slow = 26, signalPeriod = 9) {
  const empty = { macd: [], signal: [], hist: [] };
  if (data.length < slow + signalPeriod - 1) return empty;
  const closes = data.map((d) => d.close);
  const f = emaValues(closes, fast), s = emaValues(closes, slow);
  const line = closes.map((_, i) => (f[i] != null && s[i] != null ? f[i] - s[i] : null));
  const start = line.findIndex((v) => v != null);
  const sig = emaValues(line.slice(start), signalPeriod);
  const out = { macd: [], signal: [], hist: [] };
  for (let i = start; i < data.length; i++) {
    const m = line[i], g = sig[i - start];
    out.macd.push({ time: data[i].time, value: m });
    if (g != null) {
      out.signal.push({ time: data[i].time, value: g });
      out.hist.push({ time: data[i].time, value: m - g });
    }
  }
  return out;
}

/** Media móvil simple del volumen. */
export function volumeAverage(data, period = 20) {
  const out = [];
  let sum = 0;
  data.forEach((d, i) => {
    sum += d.volume || 0;
    if (i >= period) sum -= data[i - period].volume || 0;
    if (i >= period - 1) out.push({ time: d.time, value: sum / period });
  });
  return out;
}

/**
 * Soportes y resistencias simples: máximos y mínimos locales («pivotes») de las últimas `lookback` velas, agrupados
 * cuando están a menos de `tolerance` (0,5 %) unos de otros. Un nivel vale más cuantas más veces lo ha tocado el precio.
 * Devuelve como mucho `max` niveles de cada tipo, los más cercanos al último cierre (resistencias por encima, soportes
 * por debajo), cada uno con `price` y `touches` (≥ 2).
 */
export function supportResistance(data, { lookback = 300, wing = 5, tolerance = 0.005, max = 3 } = {}) {
  const bars = data.slice(-lookback);
  if (bars.length < wing * 2 + 1) return { supports: [], resistances: [] };
  const last = bars.at(-1).close;
  const pivots = [];
  for (let i = wing; i < bars.length - wing; i++) {
    let hi = true, lo = true;
    for (let j = i - wing; j <= i + wing && (hi || lo); j++) {
      if (j === i) continue;
      // en una meseta (máximos iguales) solo cuenta el primer punto: izquierda estricta, derecha con empate
      if (j < i ? bars[j].high >= bars[i].high : bars[j].high > bars[i].high) hi = false;
      if (j < i ? bars[j].low <= bars[i].low : bars[j].low < bars[i].low) lo = false;
    }
    if (hi) pivots.push(bars[i].high);
    if (lo) pivots.push(bars[i].low);
  }
  const levels = []; // {sum, n}
  for (const p of pivots.sort((a, b) => a - b)) {
    const g = levels.at(-1);
    if (g && p <= (g.sum / g.n) * (1 + tolerance)) { g.sum += p; g.n += 1; } else levels.push({ sum: p, n: 1 });
  }
  const all = levels.filter((g) => g.n >= 2).map((g) => ({ price: g.sum / g.n, touches: g.n }));
  const near = (a, b) => Math.abs(a.price - last) - Math.abs(b.price - last);
  return {
    resistances: all.filter((l) => l.price > last).sort(near).slice(0, max),
    supports: all.filter((l) => l.price < last).sort(near).slice(0, max),
  };
}
