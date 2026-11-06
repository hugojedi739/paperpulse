// Genera los estáticos para el CDN de Vercel: public/ (ficheros JS y CSS con hash en el nombre) y backend/templates/index.html.
// Uso: npm run build:static   (el resultado se versiona, como frontend/vendor; un test comprueba que está al día)
//
// - Cada fichero JS/CSS se renombra a nombre.<hash8>.ext. El hash cubre el fichero y todo lo que importa (también con
//   ciclos: se calcula por componentes fuertemente conexos), así que cualquier cambio renombra a los que dependen de él.
// - Los imports (estáticos y dinámicos) se reescriben a los nombres con hash: sin import maps ni scripts inline (CSP).
// - index.html se escribe en build/ y NO en public/: lo sirve la función (inserta el dominio real) y apunta al CDN.
// - Los ficheros con hash llevan Cache-Control immutable (vercel.json); sw.js, manifest.json e imágenes conservan su nombre.
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sha = (...parts) => createHash('sha256').update(parts.join('\n')).digest('hex');

const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
const rel = (root, file) => relative(root, file).split(sep).join('/');

// from './x.js' · import './x.js' · import('./x.js') · rutas absolutas /vendor/…
const SPEC = /((?:\bfrom|\bimport)\s*\(?\s*)(['"])((?:\.{1,2}\/|\/vendor\/)[^'"]+\.m?js)\2/g;
const STATIC_SPEC = /(\bfrom\s*|^\s*import\s*)(['"])((?:\.{1,2}\/|\/vendor\/)[^'"]+\.m?js)\2/gm;

/** Ruta (relativa a frontend/) a la que apunta un especificador desde el fichero `from`. */
const resolveSpec = (from, spec) => (spec.startsWith('/') ? spec.slice(1) : posix.normalize(posix.join(posix.dirname(from), spec)));

export function build({ root = ROOT, out = join(root, 'public'), indexOut = join(root, 'backend/templates/index.html') } = {}) {
  const src = join(root, 'frontend');
  const files = walk(src).map((f) => rel(src, f));
  const isJs = (f) => /\.m?js$/.test(f) && (f.startsWith('js/') || f === 'vendor/lightweight-charts.mjs');
  const hashed = files.filter((f) => isJs(f) || f === 'css/app.css');
  const text = new Map(hashed.map((f) => [f, readFileSync(join(src, f), 'utf8')]));

  // Grafo de dependencias (estáticas y dinámicas)
  const deps = new Map();
  for (const f of hashed) {
    const set = new Set();
    if (isJs(f)) {
      for (const m of text.get(f).matchAll(SPEC)) {
        const d = resolveSpec(f, m[3]);
        if (!text.has(d)) throw new Error(`${f}: import sin resolver ${m[3]}`);
        set.add(d);
      }
    }
    deps.set(f, [...set].sort());
  }

  // Componentes fuertemente conexos (Tarjan) y hash de cada componente
  let counter = 0;
  const index = new Map(), low = new Map(), onStack = new Set(), stack = [], comp = new Map(), comps = [];
  const visit = (v) => {
    index.set(v, counter); low.set(v, counter); counter++; stack.push(v); onStack.add(v);
    for (const w of deps.get(v)) {
      if (!index.has(w)) { visit(w); low.set(v, Math.min(low.get(v), low.get(w))); }
      else if (onStack.has(w)) low.set(v, Math.min(low.get(v), index.get(w)));
    }
    if (low.get(v) === index.get(v)) {
      const members = [];
      let w;
      do { w = stack.pop(); onStack.delete(w); members.push(w); comp.set(w, comps.length); } while (w !== v);
      comps.push(members.sort());
    }
  };
  for (const f of [...hashed].sort()) if (!index.has(f)) visit(f);
  const compHash = [];
  comps.forEach((members, i) => { // Tarjan entrega cada componente después de sus dependencias
    const external = [...new Set(members.flatMap((m) => deps.get(m)).filter((d) => comp.get(d) !== i).map((d) => compHash[comp.get(d)]))].sort();
    compHash[i] = sha(...members.map((m) => `${m}\n${text.get(m)}`), ...external);
  });
  const name = new Map(hashed.map((f) => [f, f.replace(/(\.[^./]+)$/, `.${sha(compHash[comp.get(f)], f).slice(0, 8)}$1`)]));

  // Escritura
  rmSync(out, { recursive: true, force: true });
  rmSync(indexOut, { force: true });
  const put = (file, data) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, data); };
  for (const f of hashed) {
    let body = text.get(f);
    if (isJs(f)) {
      body = body.replace(SPEC, (all, pre, q, spec) => {
        const target = name.get(resolveSpec(f, spec));
        return `${pre}${q}${spec.startsWith('/') ? `/${target}` : `${posix.dirname(spec)}/${posix.basename(target)}`}${q}`;
      });
    }
    put(join(out, name.get(f)), body);
  }
  const url = (f) => `/${name.get(f)}`;
  const staticClosure = (entry) => { // lo que main.js necesita para arrancar (solo imports estáticos)
    const seen = new Set();
    const go = (f) => {
      if (seen.has(f)) return;
      seen.add(f);
      for (const m of text.get(f).matchAll(STATIC_SPEC)) go(resolveSpec(f, m[3]));
    };
    go(entry);
    return [...seen].sort();
  };

  // index.html
  let html = readFileSync(join(src, 'index.html'), 'utf8');
  for (const f of ['css/app.css', 'js/theme-init.js', 'js/main.js', 'js/ui/status.js']) {
    if (!html.includes(`"/${f}"`)) throw new Error(`index.html no referencia /${f}`);
    html = html.replace(`"/${f}"`, `"${url(f)}"`);
  }
  const preload = staticClosure('js/main.js').filter((f) => f !== 'js/main.js').map((f) => `  <link rel="modulepreload" href="${url(f)}">`).join('\n');
  html = html.replace(/(  <link rel="stylesheet" href="[^"]+">\n)/, `$1${preload}\n`);
  put(indexOut, html);

  // Resto de ficheros tal cual; sw.js con los nombres con hash y una caché nueva en cada versión
  const buildId = sha(...[...name.values()].sort()).slice(0, 8);
  for (const f of files) {
    if (hashed.includes(f) || f === 'index.html') continue;
    if (f === 'sw.js') {
      let sw = readFileSync(join(src, f), 'utf8');
      for (const a of ['css/app.css', 'js/main.js']) sw = sw.replace(`'/${a}'`, `'${url(a)}'`);
      sw = sw.replace("'paperpulse-shell-v1'", `'paperpulse-shell-${buildId}'`);
      put(join(out, f), sw);
    } else {
      mkdirSync(dirname(join(out, f)), { recursive: true });
      cpSync(join(src, f), join(out, f));
    }
  }
  return { out, indexOut, files: hashed.length, buildId };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const r = build();
  console.log(`public/ y backend/templates/index.html generados: ${r.files} ficheros con hash (versión ${r.buildId}).`);
}
