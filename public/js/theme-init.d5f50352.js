// Aplica el tema guardado antes del primer pintado (evita el destello de tema incorrecto).
try {
  const s = JSON.parse(localStorage.getItem('paperpulse_settings') || '{}');
  const theme = s.theme || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  document.documentElement.dataset.theme = theme;
  if (s.sidebarCollapsed) document.documentElement.classList.add('nav-collapsed');
  // Acento para comparar: «neutral» (por defecto) o «teal» (tokens en app.css, bloque MINIMAL)
  if (s.accent === 'teal') document.documentElement.dataset.accent = 'teal';
} catch {
  document.documentElement.dataset.theme = 'dark';
}
