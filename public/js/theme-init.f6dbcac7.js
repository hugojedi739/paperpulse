// Aplica el tema guardado antes del primer pintado (evita el destello de tema incorrecto).
try {
  const s = JSON.parse(localStorage.getItem('paperpulse_settings') || '{}');
  const theme = s.theme || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  document.documentElement.dataset.theme = theme;
  if (s.sidebarCollapsed) document.documentElement.classList.add('nav-collapsed');
} catch {
  document.documentElement.dataset.theme = 'dark';
}
