-- 0016: origen de las visitas de la portada (directo, Reddit, TikTok...) para Administración → Resumen.
-- Solo números: ver backend/visits.py.

-- Cargas de la portada por día (UTC) y origen: 'direct' (sin ?ref= ni página de procedencia reconocible) o uno de una lista
-- fija (reddit, tiktok, x, instagram, youtube, google, otro). El origen sale de ?ref= o, si no hay, del dominio de la página
-- de procedencia, y lo clasifica el navegador: aquí nunca llega una URL ni dato alguno que identifique a nadie. No cuenta robots.
-- El cron diario borra los días de más de 90 días.
CREATE TABLE visit_sources (
    day TEXT NOT NULL,
    source TEXT NOT NULL,
    views INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (day, source)
)
