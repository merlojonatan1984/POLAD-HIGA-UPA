-- entorno-prueba/01_tabla_efectivos_especiales_ficticia.sql
--
-- La tabla `efectivos_especiales` (24hs / parejas, usada por "Asignación
-- rápida" en pages/admin.js y por lib/asignacionRapidaFlujo.js) NO está
-- creada por ningún archivo de supabase/migrations/ ni por
-- tests/pg/00_esquema_base_ficticio.sql — igual que `efectivos` antes de
-- 0001, el código la asume preexistente en la base real de Supabase, a la
-- que nunca tuvimos acceso.
--
-- Esta es una reconstrucción FICTICIA de su esquema, inferida por
-- inspección de código (pages/admin.js, función cargarEspeciales/
-- agregarEspecial/quitarEspecial, y lib/asignacionRapidaFlujo.js) — no es
-- un dump de la tabla real. Reproduce únicamente las columnas que el
-- código efectivamente lee o escribe:
--   lugar  (HIGA/UPA/MODULAR)
--   tipo   ('24hs' | 'pareja')
--   legajo1 (siempre)
--   legajo2 (solo si tipo='pareja'; null si tipo='24hs')
--   activo (boolean — "quitar" es un soft-delete: activo=false)
--
-- Se corre DESPUÉS de tests/pg/00_esquema_base_ficticio.sql (necesita que
-- `efectivos` ya exista, aunque no hay una FK real -- el código nunca la
-- usa como tal) y ANTES de poblar datos ficticios con
-- 02_seed_tres_destinos.sql de esta misma carpeta.
--
-- Pensada para una base de PRUEBA nueva y separada (ver entorno-prueba/LEEME.md)
-- — nunca para la base real de producción.

create table if not exists efectivos_especiales (
  id       bigserial primary key,
  lugar    text not null,
  tipo     text not null check (tipo in ('24hs', 'pareja')),
  legajo1  text not null,
  legajo2  text,
  activo   boolean not null default true
);
