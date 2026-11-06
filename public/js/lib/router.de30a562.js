// Enrutado por hash: #/vista/parámetro
export const go = (path) => {
  if (location.hash !== `#${path}`) location.hash = path;
};
export function current() {
  const [route = 'dashboard', param = ''] = location.hash.replace(/^#\/?/, '').split('/');
  return { route: route || 'dashboard', param: decodeURIComponent(param) };
}
