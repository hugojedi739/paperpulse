-- 0005: cada denuncia guarda una copia del mensaje y de su autor en el momento de denunciar.
-- Así el moderador ve siempre lo denunciado aunque el autor lo borre o cambie de alias después.
-- (Si se elimina la cuenta del autor, sus mensajes y las denuncias sobre ellos se borran en cascada.)
ALTER TABLE reports ADD COLUMN post_body TEXT;
ALTER TABLE reports ADD COLUMN post_author_id INTEGER;
ALTER TABLE reports ADD COLUMN post_author_alias TEXT;
