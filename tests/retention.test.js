// Pruebas de contenido y de ficheros de la capa de retención: lecciones, glosario, PWA y cron.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const { LESSONS, GLOSSARY, glossaryIndex } = await import('../frontend/js/lib/learn-content.js');
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const TICKERS = /\b(BTC|ETH|SOL|BNB|XRP|ADA|DOGE|DOT|AVAX|LINK|TRX|POL|NVDA|AAPL|TSLA|MSFT|AMZN|GOOGL|META|IBEX|SAN|BBVA|ITX|IBE|REP|TEF|Bitcoin|Ethereum|Santander|Inditex|Nvidia|Apple|Tesla)\b/;
const ADVICE = /(te recomend|deber[ií]as (comprar|vender)|compra ya|vende ya|inversión segura|rentabilidad (asegurada|garantizada)|no puedes perder)/i;

test('hay entre 8 y 10 lecciones completas y con identificadores únicos', () => {
  assert.ok(LESSONS.length >= 8 && LESSONS.length <= 10, `lecciones: ${LESSONS.length}`);
  assert.equal(new Set(LESSONS.map((l) => l.id)).size, LESSONS.length);
  for (const l of LESSONS) {
    assert.match(l.id, /^[a-z0-9-]+$/);
    assert.ok(l.title && l.summary && l.tip && l.minutes >= 2 && l.minutes <= 4, l.id);
    assert.ok(l.body.length >= 3 && l.body.every((p) => typeof p === 'string' && p.length > 40), l.id);
    assert.match(l.link[0], /^#\//, `enlace interno en ${l.id}`);
  }
});

test('las lecciones cubren los temas pedidos', () => {
  const all = LESSONS.map((l) => `${l.title} ${l.summary}`).join(' ').toLowerCase();
  for (const topic of ['límite', 'stop', 'riesgo', 'comisiones', 'diversificación', 'errores']) assert.ok(all.includes(topic), topic);
});

test('el contenido es neutral: no nombra activos concretos ni da consejos de compra o venta', () => {
  const text = LESSONS.flatMap((l) => [l.title, l.summary, l.tip, ...l.body]).concat(GLOSSARY.flat()).join('\n');
  assert.doesNotMatch(text, TICKERS);
  assert.doesNotMatch(text, ADVICE);
  assert.match(text, /no es asesoramiento|Es una simulación|simulación/i);
});

test('el contenido educativo es texto plano (sin HTML) y el glosario no repite términos', () => {
  const text = LESSONS.flatMap((l) => [l.title, l.summary, l.tip, ...l.body]).concat(GLOSSARY.flat()).join('\n');
  assert.doesNotMatch(text, /<[a-z/][^>]*>/i);
  assert.ok(GLOSSARY.length >= 20);
  assert.equal(new Set(GLOSSARY.map(([t]) => t.toLowerCase())).size, GLOSSARY.length);
  assert.ok(glossaryIndex('stop-loss') >= 0 && glossaryIndex('inexistente') === -1);
});

test('el service worker nunca guarda /api ni /ws y solo toca GET del mismo origen', () => {
  const sw = read('frontend/sw.js');
  assert.match(sw, /startsWith\('\/api\/'\)/);
  assert.match(sw, /startsWith\('\/ws\/'\)/);
  assert.match(sw, /req\.method !== 'GET'/);
  assert.match(sw, /url\.origin !== self\.location\.origin/);
  assert.doesNotMatch(sw, /eval\(|importScripts|innerHTML/);
});

test('el manifest es instalable: nombre, inicio, iconos 192/512 y maskable por separado', () => {
  const m = JSON.parse(read('frontend/manifest.json'));
  assert.equal(m.display, 'standalone');
  assert.equal(m.lang, 'es');
  assert.equal(m.start_url, '/');
  for (const size of ['192x192', '512x512']) {
    assert.ok(m.icons.some((i) => i.sizes === size && i.purpose === 'any'), `any ${size}`);
    assert.ok(m.icons.some((i) => i.sizes === size && i.purpose === 'maskable'), `maskable ${size}`);
  }
  assert.ok(m.icons.every((i) => !i.purpose.includes(' ')), 'purpose no debe mezclar any y maskable');
  assert.ok(m.shortcuts.length >= 2);
});

test('el cron diario de Vercel llama al endpoint de mantenimiento una vez al día (plan gratuito)', () => {
  const v = JSON.parse(read('vercel.json'));
  assert.equal(v.crons.length, 1);
  assert.equal(v.crons[0].path, '/api/cron/daily');
  assert.match(v.crons[0].schedule, /^\d+ \d+ \* \* \*$/); // una vez al día
});

test('la CSP sigue sin scripts ni estilos inline y solo permite el worker propio', () => {
  const app = read('backend/app.py');
  assert.match(app, /"worker-src 'self'"/);
  assert.match(app, /"script-src 'self'"/);
  assert.match(app, /"style-src 'self'"/);
  assert.match(app, /"connect-src 'self'"/);
  assert.doesNotMatch(read('frontend/index.html'), /<script(?![^>]*\bsrc=)[^>]*>[^<]/);
});

/* ---------- Textos legales ---------- */
const legal = await import('../frontend/js/lib/legal-content.js');
const flat = (page) => page.sections.flatMap((s) => [s.h, ...s.p.flatMap((x) => (typeof x === 'string' ? [x] : x.link ? [x.link[0]] : x.list))]).join('\n');

test('hay cinco páginas legales marcadas como borrador, con versión y sin HTML', () => {
  assert.deepEqual(legal.PAGES.map((p) => p.id), ['aviso-legal', 'privacidad', 'terminos', 'cookies', 'normas']);
  assert.match(legal.DRAFT_NOTICE, /Borrador pendiente de revisión legal/);
  assert.match(legal.LEGAL_VERSION, /borrador/);
  for (const p of legal.PAGES) assert.doesNotMatch(flat(p), /<[a-z/][^>]*>/i, p.id);
});

test('la política de privacidad nombra a Vercel y Turso, las transferencias y los derechos RGPD', () => {
  const t = flat(legal.pageById('privacidad'));
  for (const word of ['Vercel', 'Turso', 'Estados Unidos', 'cláusulas contractuales', 'Marco de Privacidad', 'AEPD', 'RGPD', 'LOPDGDD', 'portabilidad', '14 años', 'Anthropic', 'Google']) assert.ok(t.includes(word), word);
  assert.match(t, /\[PENDIENTE:/); // la región de Turso sigue sin confirmar
  assert.match(t, /formulario de contacto/);
});

test('los datos del titular están completos y solo quedan pendientes la región de Turso y las transferencias', () => {
  const t = flat(legal.pageById('aviso-legal'));
  assert.match(t, /Titular: PaperPulse \(proyecto personal sin ánimo de lucro\)/);
  assert.match(t, /NIF\/CIF: No aplica/);
  assert.match(t, /Dominio: https:\/\/paperpulse-delta\.vercel\.app/);
  assert.doesNotMatch(t, /\[PENDIENTE/);
  const pending = legal.PAGES.flatMap((p) => flat(p).match(/\[PENDIENTE: [^\]]*\]/g) ?? []);
  assert.equal(pending.length, 2, pending.join(' | '));
  assert.ok(pending.every((x) => /región de la base de datos|transferencias|adhesión/i.test(x)), pending.join(' | '));
});

test('el aviso legal, la privacidad y los términos enlazan al formulario de contacto y no publican ningún correo', () => {
  for (const id of ['aviso-legal', 'privacidad', 'terminos']) {
    const page = legal.pageById(id);
    const links = page.sections.flatMap((s) => s.p).filter((x) => x.link);
    assert.ok(links.some((x) => x.link[1] === '#/contact'), `${id} enlaza a #/contact`);
  }
  for (const p of legal.PAGES) assert.doesNotMatch(JSON.stringify(p), /[\w.+-]+@[\w-]+\.[\w.-]+|mailto:/i, p.id);
  assert.match(flat(legal.pageById('privacidad')), /formulario de contacto/);
});


test('la política de cookies describe el almacenamiento real y justifica que no haya banner', () => {
  const t = flat(legal.pageById('cookies'));
  for (const word of ['pp_session', 'pp_oauth', 'localStorage', 'sessionStorage', 'service worker', '22.2', 'sin analítica'.replace('sin ', 'No usamos ')]) assert.ok(t.includes(word), word);
  assert.doesNotMatch(read('frontend/index.html'), /cookie-banner|aceptar cookies/i);
});

test('las normas prohíben promocionar servicios de pago, señales y afiliados, y avisan de que no es asesoramiento', () => {
  const t = flat(legal.pageById('normas')) + legal.RULES.flat().join(' ');
  for (const word of ['señales de pago', 'afiliado', 'servicio', 'asesoramiento financiero', 'ocultar', 'suspender']) assert.ok(t.includes(word), word);
  assert.match(legal.DISCLAIMER, /simulador educativo con dinero virtual/);
});

test('el pie, el registro y el menú enlazan a los textos legales y a las descargas de datos', () => {
  const html = read('frontend/index.html');
  for (const id of ['aviso-legal', 'privacidad', 'terminos', 'cookies', 'normas']) assert.ok(html.includes(`#/legal/${id}`), id);
  const dialogs = read('frontend/js/ui/dialogs.js');
  assert.match(dialogs, /name="acceptTerms" required/);
  assert.match(dialogs, /name="ageConfirmed" required/);
  assert.match(dialogs, /#\/legal\/terminos/);
  assert.match(read('frontend/js/main.js'), /export-data/);
});

test('el diálogo de términos bloquea a las cuentas nuevas sin aceptar y solo avisa a las anteriores', () => {
  const src = read('frontend/js/ui/terms.js');
  assert.match(src, /blocking = user\.termsVersion == null/);
  assert.match(src, /addEventListener\('cancel', \(e\) => e\.preventDefault\(\)/); // Escape no cierra el bloqueante
});

test('el formulario de contacto: campos de solo texto con límite, honeypot oculto y enlace en el pie', () => {
  const view = read('frontend/js/views/contact.js');
  assert.match(view, /reason: 100, message: 2000/);
  assert.match(view, /HONEYPOT = 'website'/);
  assert.match(view, /class: 'hp'/);
  assert.doesNotMatch(view, /innerHTML|mailto:|style:|onclick/);
  assert.match(read('frontend/index.html'), /<a href="#\/contact">Contacto<\/a>/);
  assert.match(read('frontend/index.html'), /data-view="contact"/);
  assert.match(read('frontend/css/app.css'), /\.hp \{/);
});

test('la bandeja de mensajes del panel pinta el texto de usuarios solo con nodos de texto', () => {
  const view = read('frontend/js/views/messages.js');
  assert.doesNotMatch(view, /innerHTML|html`|\braw\(/);
  assert.match(view, /userText\(m\.message\)/);
  assert.match(read('frontend/js/views/admin.js'), /\['messages', 'Mensajes'/);
});

test('ningún fichero del frontend propio contiene una dirección de correo', () => {
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? (e.name === 'vendor' ? [] : walk(`${dir}/${e.name}`)) : [`${dir}/${e.name}`]);
  const found = [];
  for (const f of walk(new URL('../frontend', import.meta.url).pathname).filter((f) => /\.(js|html|css|json)$/.test(f))) {
    const m = readFileSync(f, 'utf8').match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g);
    if (m) found.push(`${f}: ${m.join(', ')}`);
  }
  assert.deepEqual(found, []);
});
