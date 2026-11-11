// Gráficos sobre TradingView Lightweight Charts v5: gráfico de trading con paneles, curvas de patrimonio
// y sparklines SVG. Los colores salen de las variables CSS para seguir el tema activo.
import {
  createChart, CandlestickSeries, BarSeries, AreaSeries, LineSeries, HistogramSeries, BaselineSeries,
  createSeriesMarkers, createTextWatermark, CrosshairMode, LineStyle, LastPriceAnimationMode,
} from '/vendor/lightweight-charts.7d001f7d.mjs';
import { html, raw } from './dom.a575914e.js';
import { num, pct, volume, trendClass } from './format.df74909c.js';

/* ---------- Tema ---------- */
export function palette() {
  const css = getComputedStyle(document.documentElement);
  const v = (name) => css.getPropertyValue(name).trim();
  return {
    text: v('--text-2'), muted: v('--text-3'), grid: v('--chart-grid'), border: v('--border'),
    up: v('--up'), down: v('--down'), accent: v('--accent'), surface: v('--surface-1'),
    upFill: v('--up-fill'), downFill: v('--down-fill'), accentFill: v('--accent-fill'),
    s1: v('--series-1'), s2: v('--series-2'), s7: v('--series-7'),
  };
}

const alpha = (hex, a) => {
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};

function baseOptions(c, extra = {}) {
  return {
    autoSize: true,
    layout: {
      background: { color: 'transparent' }, textColor: c.text, fontSize: 11,
      fontFamily: 'Inter Variable, Inter, system-ui, sans-serif', attributionLogo: false,
      panes: { separatorColor: c.grid, separatorHoverColor: c.border },
    },
    grid: { vertLines: { color: c.grid }, horzLines: { color: c.grid } },
    crosshair: {
      mode: CrosshairMode.Normal,
      vertLine: { color: c.muted, width: 1, style: LineStyle.Solid, labelBackgroundColor: c.accent },
      horzLine: { color: c.muted, width: 1, style: LineStyle.Solid, labelBackgroundColor: c.accent },
    },
    rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.12, bottom: 0.12 } },
    timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false, rightOffset: 6, minBarSpacing: 2 },
    localization: { locale: 'es-ES', priceFormatter: (p) => num(p) },
    ...extra,
  };
}

/* ---------- Indicadores ---------- */
export function sma(data, period) {
  const out = [];
  let sum = 0;
  data.forEach((d, i) => {
    sum += d.close;
    if (i >= period) sum -= data[i - period].close;
    if (i >= period - 1) out.push({ time: d.time, value: sum / period });
  });
  return out;
}

export function ema(data, period) {
  if (data.length < period) return [];
  const k = 2 / (period + 1);
  let e = data.slice(0, period).reduce((s, d) => s + d.close, 0) / period;
  const out = [{ time: data[period - 1].time, value: e }];
  for (let i = period; i < data.length; i++) out.push({ time: data[i].time, value: (e = data[i].close * k + e * (1 - k)) });
  return out;
}

export function bollinger(data, period = 20, mult = 2) {
  const upper = [], lower = [];
  for (let i = period - 1; i < data.length; i++) {
    const slice = data.slice(i - period + 1, i + 1).map((d) => d.close);
    const mean = slice.reduce((a, b) => a + b, 0) / period;
    const sd = Math.sqrt(slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period);
    upper.push({ time: data[i].time, value: mean + mult * sd });
    lower.push({ time: data[i].time, value: mean - mult * sd });
  }
  return { upper, lower };
}

/** RSI de Wilder. */
export function rsi(data, period = 14) {
  if (data.length <= period) return [];
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = data[i].close - data[i - 1].close;
    if (d >= 0) gain += d; else loss -= d;
  }
  gain /= period; loss /= period;
  const out = [];
  for (let i = period; i < data.length; i++) {
    if (i > period) {
      const d = data[i].close - data[i - 1].close;
      gain = (gain * (period - 1) + Math.max(d, 0)) / period;
      loss = (loss * (period - 1) + Math.max(-d, 0)) / period;
    }
    out.push({ time: data[i].time, value: loss === 0 ? 100 : 100 - 100 / (1 + gain / loss) });
  }
  return out;
}

export const INDICATORS = {
  volume: { label: 'Volumen' },
  ma: { label: 'MA 20', color: 's1' },
  ema: { label: 'EMA 50', color: 's2' },
  bb: { label: 'Bollinger 20', color: 's7' },
  rsi: { label: 'RSI 14', color: 's7' },
};

/* ---------- Gráfico de trading ---------- */
export function createTradingChart(container, legendEl) {
  let c = palette();
  const chart = createChart(container, baseOptions(c));
  let type = 'candles';
  let data = [];
  let meta = { label: '', quote: '' };
  let main = null;
  let markers = null;
  let watermark = null;
  let lines = [];
  const ind = {};
  const vals = {};
  const active = new Set();
  const track = (key, points) => { vals[key] = new Map(points.map((x) => [x.time, x.value])); return points; };

  const volumeColor = (d) => (d.close >= d.open ? alpha(c.up, 0.35) : alpha(c.down, 0.35));
  const mainPoint = (d) => (type === 'candles' || type === 'bars' ? d : { time: d.time, value: d.close });

  function createMain() {
    if (main) chart.removeSeries(main);
    const common = { priceLineStyle: LineStyle.Dotted, lastPriceAnimation: LastPriceAnimationMode.OnDataUpdate };
    main = type === 'candles'
      ? chart.addSeries(CandlestickSeries, { ...common, upColor: c.up, downColor: c.down, borderVisible: false, wickUpColor: c.up, wickDownColor: c.down })
      : type === 'bars'
        ? chart.addSeries(BarSeries, { ...common, upColor: c.up, downColor: c.down, thinBars: false })
        : type === 'area'
          ? chart.addSeries(AreaSeries, { ...common, lineColor: c.accent, lineWidth: 2, topColor: alpha(c.accent, 0.28), bottomColor: alpha(c.accent, 0) })
          : chart.addSeries(LineSeries, { ...common, color: c.accent, lineWidth: 2 });
    main.setData(data.map(mainPoint));
    markers = createSeriesMarkers(main, []);
  }

  function syncIndicators() {
    const want = (k) => active.has(k) && data.length > 0;
    const ensure = (key, factory) => (ind[key] ??= factory());
    const drop = (key) => { if (ind[key]) { chart.removeSeries(ind[key]); delete ind[key]; } };
    const thin = (color, extra = {}) => ({ color, lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, ...extra });

    if (want('volume')) {
      ensure('volume', () => {
        const s = chart.addSeries(HistogramSeries, { priceFormat: { type: 'volume' }, priceScaleId: 'vol', lastValueVisible: false, priceLineVisible: false });
        chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
        return s;
      }).setData(data.map((d) => ({ time: d.time, value: d.volume, color: volumeColor(d) })));
    } else drop('volume');

    if (want('ma')) ensure('ma', () => chart.addSeries(LineSeries, thin(c.s1))).setData(track('ma', sma(data, 20))); else drop('ma');
    if (want('ema')) ensure('ema', () => chart.addSeries(LineSeries, thin(c.s2))).setData(track('ema', ema(data, 50))); else drop('ema');
    if (want('bb')) {
      const bb = bollinger(data);
      ensure('bbU', () => chart.addSeries(LineSeries, thin(alpha(c.s7, 0.8), { lineWidth: 1 }))).setData(track('bbU', bb.upper));
      ensure('bbL', () => chart.addSeries(LineSeries, thin(alpha(c.s7, 0.8), { lineWidth: 1 }))).setData(track('bbL', bb.lower));
    } else { drop('bbU'); drop('bbL'); }

    if (want('rsi')) {
      const s = ensure('rsi', () => {
        const series = chart.addSeries(LineSeries, thin(c.s7, { lastValueVisible: true }), 1);
        series.createPriceLine({ price: 70, color: c.border, lineWidth: 1, lineStyle: LineStyle.Solid, axisLabelVisible: false });
        series.createPriceLine({ price: 30, color: c.border, lineWidth: 1, lineStyle: LineStyle.Solid, axisLabelVisible: false });
        chart.panes()[1]?.setStretchFactor(0.28);
        return series;
      });
      s.setData(track('rsi', rsi(data)));
    } else if (ind.rsi) {
      drop('rsi');
      if (chart.panes().length > 1) chart.removePane(1);
    }
  }

  /* Leyenda superpuesta: OHLC del punto bajo el cursor (o la última vela) e indicadores activos */
  function legend(point) {
    if (!legendEl) return;
    const d = point ?? data.at(-1);
    if (!d) { legendEl.textContent = ''; return; }
    const chg = d.open ? ((d.close - d.open) / d.open) * 100 : 0;
    const cls = trendClass(chg);
    const valueAt = (key) => {
      const v = vals[key]?.get(d.time);
      return v != null ? num(v) : '—';
    };
    const item = (key, label, value) => html`<span class="lg-ind"><i class="swatch sw-${key}"></i>${label} <b>${value}</b></span>`;
    legendEl.innerHTML = String(html`
      <div class="lg-row"><strong>${meta.label}</strong>
        <span>O <b class="${cls}">${num(d.open)}</b></span><span>H <b class="${cls}">${num(d.high)}</b></span>
        <span>L <b class="${cls}">${num(d.low)}</b></span><span>C <b class="${cls}">${num(d.close)}</b></span>
        <span class="${cls}">${pct(chg)}</span>
        ${active.has('volume') && d.volume ? html`<span>Vol <b>${volume(d.volume)}</b></span>` : ''}
      </div>
      ${active.size > (active.has('volume') ? 1 : 0) ? html`<div class="lg-row">
        ${active.has('ma') ? item('s1', 'MA 20', valueAt('ma')) : ''}
        ${active.has('ema') ? item('s2', 'EMA 50', valueAt('ema')) : ''}
        ${active.has('bb') ? item('s7', 'BB 20', `${valueAt('bbU')} / ${valueAt('bbL')}`) : ''}
        ${active.has('rsi') ? item('s7', 'RSI 14', valueAt('rsi')) : ''}
      </div>` : ''}`);
  }

  chart.subscribeCrosshairMove((param) => {
    const p = param.time && main ? param.seriesData.get(main) : null;
    if (!p) return legend(null);
    const full = data.find((d) => d.time === param.time) ?? { ...p, open: p.value, high: p.value, low: p.value, close: p.value };
    legend(full);
  });

  function nearestTime(t) {
    let lo = 0, hi = data.length - 1, ans = null;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (data[mid].time <= t) { ans = data[mid].time; lo = mid + 1; } else hi = mid - 1;
    }
    return ans;
  }

  const api = {
    chart,
    setData(candles, info) {
      data = candles;
      meta = info;
      chart.applyOptions({ timeScale: { timeVisible: info.intraday !== false } });
      createMain();
      syncIndicators();
      watermark?.detach();
      watermark = createTextWatermark(chart.panes()[0], {
        horzAlign: 'center', vertAlign: 'center',
        lines: [{ text: info.symbol ?? '', color: alpha(c.text, 0.07), fontSize: 64, fontStyle: '700' }],
      });
      const n = candles.length;
      if (n > 140) chart.timeScale().setVisibleLogicalRange({ from: n - 120, to: n + 4 });
      else chart.timeScale().fitContent();
      legend(null);
    },
    /** Actualiza o añade la vela en curso. */
    update(candle) {
      if (!data.length || candle.time < data.at(-1).time) return;
      if (candle.time === data.at(-1).time) data[data.length - 1] = candle; else data.push(candle);
      main.update(mainPoint(candle));
      if (ind.volume) ind.volume.update({ time: candle.time, value: candle.volume, color: volumeColor(candle) });
      if (active.size > 1) throttledSync();
      legend(null);
    },
    setType(next) {
      type = next;
      if (!data.length) return;
      createMain();
      api.setLines(lines.map((l) => l.opts));
    },
    toggleIndicator(key, on) {
      if (on) active.add(key); else active.delete(key);
      syncIndicators();
      legend(null);
    },
    setIndicators(keys) { active.clear(); keys.forEach((k) => active.add(k)); syncIndicators(); },
    /** Líneas horizontales: entradas de posición, órdenes pendientes y alertas. */
    setLines(list) {
      lines.forEach((l) => { try { main?.removePriceLine(l.line); } catch { /* serie recreada */ } });
      lines = main ? list.map((opts) => ({ opts, line: main.createPriceLine({ lineWidth: 1, axisLabelVisible: true, ...opts }) })) : [];
    },
    setMarkers(list) {
      if (!markers) return;
      const m = list.map((x) => ({ ...x, time: nearestTime(x.time) })).filter((x) => x.time != null).sort((a, b) => a.time - b.time);
      markers.setMarkers(m);
    },
    /** Añade velas más antiguas por la izquierda sin mover la vista (histórico infinito). */
    prepend(older) {
      const first = data[0]?.time ?? Infinity;
      const add = older.filter((c) => c.time < first);
      if (!add.length || !main) return 0;
      data = add.concat(data);
      main.setData(data.map(mainPoint));
      syncIndicators();
      return add.length;
    },
    /** Llama a `cb` cuando el usuario se acerca al principio de los datos cargados. */
    onReachStart(cb, margin = 60) {
      chart.timeScale().subscribeVisibleLogicalRangeChange((r) => { if (r && data.length && r.from < margin) cb(); });
    },
    /** Muestra el intervalo [from, to] (epoch s) ajustado a las velas disponibles. */
    showRange(from, to = data.at(-1)?.time) {
      if (!data.length) return;
      const start = Math.max(from, data[0].time);
      if (start >= to) return chart.timeScale().fitContent();
      chart.timeScale().setVisibleRange({ from: start, to });
    },
    /** Centra la vista en un instante (epoch s) mostrando `bars` velas alrededor. */
    scrollToTime(t, bars = 120) {
      const i = data.findIndex((d) => d.time >= t);
      const idx = i === -1 ? data.length - 1 : i;
      chart.timeScale().setVisibleLogicalRange({ from: idx - bars / 2, to: idx + bars / 2 });
    },
    fit: () => chart.timeScale().fitContent(),
    firstCandle: () => data[0],
    lastCandle: () => data.at(-1),
    theme() {
      c = palette();
      chart.applyOptions(baseOptions(c));
      if (data.length) { createMain(); Object.keys(ind).forEach((k) => { chart.removeSeries(ind[k]); delete ind[k]; }); syncIndicators(); api.setLines(lines.map((l) => l.opts)); }
    },
    colors: () => c,
    destroy: () => chart.remove(),
  };
  let syncTimer = null;
  const throttledSync = () => { syncTimer ??= setTimeout(() => { syncTimer = null; syncIndicators(); }, 1000); };
  return api;
}

/* ---------- Curva de patrimonio (línea base = capital inicial) ---------- */
export function createEquityChart(container, { formatter }) {
  let c = palette();
  const opts = () => baseOptions(c, {
    handleScroll: false, handleScale: false,
    grid: { vertLines: { visible: false }, horzLines: { color: c.grid } },
    rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.15, bottom: 0.1 } },
    localization: { locale: 'es-ES', priceFormatter: formatter },
  });
  const chart = createChart(container, opts());
  const seriesOpts = (base) => ({
    baseValue: { type: 'price', price: base },
    topLineColor: c.up, topFillColor1: alpha(c.up, 0.22), topFillColor2: alpha(c.up, 0.02),
    bottomLineColor: c.down, bottomFillColor1: alpha(c.down, 0.02), bottomFillColor2: alpha(c.down, 0.22),
    lineWidth: 2, priceLineVisible: false, lastValueVisible: true,
  });
  let base = 0;
  let series = chart.addSeries(BaselineSeries, seriesOpts(0));
  return {
    setData(points, baseValue) {
      base = baseValue;
      series.applyOptions(seriesOpts(base));
      series.setData(points);
      chart.timeScale().fitContent();
    },
    theme() { c = palette(); chart.applyOptions(opts()); series.applyOptions(seriesOpts(base)); },
    destroy: () => chart.remove(),
  };
}

/* ---------- Minigráfico de línea (tarjetas del Resumen): sin ejes, rejilla ni etiquetas; verde si sube y rojo si baja ---------- */
export function createMiniChart(container) {
  let c = palette();
  let up = true;
  const chart = createChart(container, {
    autoSize: true,
    layout: { background: { color: 'transparent' }, textColor: c.muted, attributionLogo: false },
    grid: { vertLines: { visible: false }, horzLines: { visible: false } },
    crosshair: { mode: CrosshairMode.Hidden },
    rightPriceScale: { visible: false, scaleMargins: { top: 0.12, bottom: 0.12 } },
    leftPriceScale: { visible: false },
    timeScale: { visible: false, fixLeftEdge: true, fixRightEdge: true },
    handleScroll: false, handleScale: false,
  });
  const series = chart.addSeries(LineSeries, { lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
  const paint = () => series.applyOptions({ color: up ? c.up : c.down });
  return {
    /** `values`: serie de precios en orden cronológico (sin fechas: se reparten de forma uniforme). */
    setData(values) {
      const v = values.filter(Number.isFinite);
      if (v.length < 2) return false;
      up = v.at(-1) >= v[0];
      series.setData(v.map((value, i) => ({ time: i * 3600, value })));
      paint();
      chart.timeScale().fitContent();
      return true;
    },
    theme() { c = palette(); paint(); },
    destroy: () => chart.remove(),
  };
}

/* ---------- Sparkline SVG (sin canvas, compatible con CSP estricta) ---------- */
export function sparkline(values, { width = 96, height = 32 } = {}) {
  const v = (values || []).filter(Number.isFinite);
  if (v.length < 2) return html`<span class="muted">—</span>`;
  const min = Math.min(...v), max = Math.max(...v);
  const span = max - min || 1;
  const pts = v.map((y, i) => `${((i / (v.length - 1)) * width).toFixed(1)},${(height - 2 - ((y - min) / span) * (height - 4)).toFixed(1)}`);
  const cls = trendClass(v.at(-1) - v[0]);
  return raw(`<svg class="spark ${cls}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">
    <path class="spark-fill" d="M0,${height} L${pts.join(' L')} L${width},${height} Z"/>
    <path class="spark-line" d="M${pts.join(' L')}"/></svg>`);
}
