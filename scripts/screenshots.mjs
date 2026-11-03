// Capturas de todas las vistas en escritorio y móvil, tema claro y oscuro, con una cuenta de práctica de ejemplo.
// Requiere el servidor en marcha. Uso: npm run screenshots  (CHROME_PATH=/ruta/chrome para otro navegador)
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const BASE = process.env.BASE_URL || 'http://localhost:8000';
const OUT = new URL('../screenshots/', import.meta.url).pathname;
const VIEWS = ['dashboard', 'trade/BTC', 'markets', 'news', 'journal'];
const DEVICES = [{ name: 'desktop', width: 1440, height: 900 }, { name: 'mobile', width: 390, height: 844, isMobile: true, hasTouch: true }];

// Datos de demostración: se cargan antes del arranque de la app y solo en este navegador temporal
const seed = (theme) => `(() => {
  if (sessionStorage.getItem('seeded')) return;
  sessionStorage.setItem('seeded', '1');
  const set = (k, v) => localStorage.setItem('paperpulse_' + k, JSON.stringify(v));
  const now = Date.now(), d = 864e5;
  set('schema_version', 3); set('practice_active', true); set('initial_capital', 10000); set('balance', 4200);
  set('settings', { theme: '${theme}', tourDone: true, interval: '1h', chartType: 'candles', indicators: ['volume', 'ma'] });
  set('positions', [
    { id: 'demo-1', symbol: 'BTC', amount: 0.03, entryPrice: 78000, investedUsd: 2340, openedAt: now - 3 * d },
    { id: 'demo-2', symbol: 'ETH', amount: 0.8, entryPrice: 2550, investedUsd: 2040, openedAt: now - 5 * d },
    { id: 'demo-3', symbol: 'SAN', amount: 50, entryPrice: 11.2, quote: 'EUR', investedUsd: 610, openedAt: now - 2 * d },
  ]);
  set('trades', Array.from({ length: 14 }, (_, i) => {
    const pnl = Math.round((Math.sin(i * 1.7) * 120 + 25) * 100) / 100;
    return { id: 'demo-t' + i, symbol: ['BTC', 'ETH', 'SOL', 'NVDA'][i % 4], amount: 0.5, entryPrice: 100, exitPrice: 100 + pnl / 5,
      investedUsd: 500, pnl, date: new Date(now - i * 2 * d).toISOString(), openedAt: now - i * 2 * d - 72e5, setup: 'Rebote en soporte', emotion: 'Disciplinado' };
  }));
  let v = 1e4;
  set('equity_history', Array.from({ length: 240 }, (_, i) => ({ time: Math.floor((now - (240 - i) * 36e5) / 1000), value: Math.round((v += Math.sin(i / 9) * 30 + 4) * 100) / 100 })));
})();`;

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
for (const theme of ['dark', 'light']) {
  for (const { name, ...viewport } of DEVICES) {
    const ctx = await browser.newContext({ viewport, colorScheme: theme, locale: 'es-ES', isMobile: viewport.isMobile, hasTouch: viewport.hasTouch });
    await ctx.addInitScript(seed(theme));
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.error(`[${theme}/${name}]`, e.message));
    await page.goto(`${BASE}/#/dashboard`);
    for (const view of VIEWS) {
      await page.evaluate((h) => { location.hash = `/${h}`; }, view);
      await page.waitForTimeout(4500);
      const file = `${OUT}${view.replace('/', '-')}_${name}_${theme}.png`;
      await page.screenshot({ path: file, fullPage: name === 'mobile' });
      console.log('✓', file);
    }
    await ctx.close();
  }
}
await browser.close();
