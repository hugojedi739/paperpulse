-- 0014: contador de visitas de la portada para Administración → Resumen, sin cookies y sin guardar datos
-- reconocibles. Solo se cuenta GET / (ni /api, ni estáticos, ni HEAD). Ver backend/visits.py.

-- Agregados por día (UTC) y tipo de visitante: 'anon' (sin sesión), 'user' (con sesión) y 'bot' (user-agent de
-- robot evidente). visitors = visitantes únicos del día; views = cargas de la portada. No guarda IP, user-agent,
-- usuario ni identificador alguno: solo números. El cron diario borra los días de más de 90 días.
CREATE TABLE visit_days (
    day TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('anon', 'user', 'bot')),
    visitors INTEGER NOT NULL DEFAULT 0,
    views INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (day, kind)
);

-- Visitantes ya contados hoy, solo para no contar dos veces a la misma persona el mismo día.
-- visitor = HMAC-SHA256(secreto 'visits', día + IP + user-agent), recortado: no se guarda la IP ni el user-agent,
-- y como el día entra en el cálculo, el valor cambia cada día y no permite seguir a nadie de un día a otro.
-- El cron diario borra todas las filas de días anteriores al de hoy.
CREATE TABLE visit_seen (
    day TEXT NOT NULL,
    visitor TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('anon', 'user', 'bot')),
    PRIMARY KEY (day, visitor, kind)
);

-- Secreto propio del contador (separado del del asistente), en la tabla server_secrets de la migración 0010.
INSERT INTO server_secrets (name, value) VALUES ('visits', lower(hex(randomblob(32))))
