// Copia las dependencias de node_modules a frontend/vendor y genera el sprite de iconos.
// Uso: npm install && npm run vendor
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const nm = join(root, 'node_modules');
const out = join(root, 'frontend/vendor');

const ICONS = [
  'log-in', 'log-out', 'cloud-check', 'cloud-upload',
  'layout-dashboard', 'chart-candlestick', 'coins', 'newspaper', 'book-open', 'search', 'sun', 'moon',
  'bell', 'user', 'settings', 'x', 'plus', 'star', 'trending-up', 'trending-down', 'arrow-up-right',
  'arrow-down-right', 'arrow-right', 'wallet', 'activity', 'maximize-2', 'minimize-2', 'chevron-down',
  'chevron-right', 'chevron-left', 'info', 'triangle-alert', 'circle-check', 'sparkles', 'send', 'bot',
  'download', 'upload', 'trash-2', 'play', 'rotate-ccw', 'globe', 'clock', 'external-link', 'eye',
  'eye-off', 'circle-help', 'command', 'layers', 'history', 'pencil', 'scale', 'shield-check', 'zap',
  'refresh-cw', 'target', 'flame', 'calendar', 'users', 'copy', 'shield', 'chart-line', 'chart-area', 'chart-column', 'crosshair',
  'bell-ring', 'wifi-off', 'keyboard', 'graduation-cap', 'sliders-horizontal', 'list-filter', 'scan',
  // Comunidad
  'message-square', 'trophy', 'rss', 'flag', 'share-2', 'user-plus', 'user-check', 'lock', 'ban',
  'arrow-big-up', 'arrow-big-down', 'reply', 'scroll-text', 'ellipsis',
];

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'fonts'), { recursive: true });

cpSync(join(nm, 'lightweight-charts/dist/lightweight-charts.standalone.production.mjs'), join(out, 'lightweight-charts.mjs'));
cpSync(join(nm, 'lightweight-charts/LICENSE'), join(out, 'lightweight-charts.LICENSE'));

for (const [pkg, file] of [
  ['inter', 'inter-latin-wght-normal.woff2'],
  ['inter', 'inter-latin-ext-wght-normal.woff2'],
  ['jetbrains-mono', 'jetbrains-mono-latin-wght-normal.woff2'],
  ['jetbrains-mono', 'jetbrains-mono-latin-ext-wght-normal.woff2'],
  ['sora', 'sora-latin-wght-normal.woff2'], // titulares y cifras grandes (rediseño Aurora)
]) {
  cpSync(join(nm, `@fontsource-variable/${pkg}/files/${file}`), join(out, 'fonts', file));
}

const symbols = ICONS.map((name) => {
  const svg = readFileSync(join(nm, `lucide-static/icons/${name}.svg`), 'utf8');
  const body = svg.slice(svg.indexOf('>', svg.indexOf('<svg')) + 1, svg.lastIndexOf('</svg>')).trim();
  return `<symbol id="${name}" viewBox="0 0 24 24">${body.replace(/\s*\n\s*/g, '')}</symbol>`;
});
writeFileSync(
  join(root, 'frontend/img/icons.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg"><!-- lucide-static (ISC) -->${symbols.join('')}</svg>\n`,
);

console.log(`vendor: ${ICONS.length} iconos, LW Charts y fuentes copiados`);
