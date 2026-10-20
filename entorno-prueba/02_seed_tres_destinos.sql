-- entorno-prueba/02_seed_tres_destinos.sql
--
-- Datos 100% FICTICIOS para probar manualmente HIGA, UPA y MODULAR en un
-- entorno separado, sobre una base de PRUEBA compartida entre los tres
-- destinos (exactamente como lo permite el esquema real: todas las tablas
-- tienen una columna `lugar`, y el mismo legajo puede existir en más de un
-- lugar como filas distintas — ver tests/pg/01_seed_ficticio.sql, mismo
-- criterio). NO toca ni referencia la base real de producción.
--
-- Se corre DESPUÉS de, en este orden:
--   tests/pg/00_esquema_base_ficticio.sql
--   entorno-prueba/01_tabla_efectivos_especiales_ficticia.sql
--   supabase/migrations/0001_borrador_publicacion.sql
--   supabase/migrations/0004_reglas_individuales_y_avisos.sql
--   supabase/migrations/0005_correcciones_ronda_bugs.sql
--   supabase/migrations/0006_correcciones_ronda3.sql
-- (ver entorno-prueba/LEEME.md para el detalle y por qué se omiten 0002/0003)
--
-- SEGURIDAD — nada de esto puede alcanzar a una persona real:
--   - Los legajos usados (91xxxx/92xxxx/93xxxx) son rangos ficticios, para
--     no confundirse nunca con un legajo real si esto se corriera por
--     error contra otra base (aun así, se insertan SOLO en la base de
--     prueba que arme el usuario — ver LEEME.md).
--   - Los teléfonos son números ficticios con un prefijo claramente
--     inválido (no corresponden a ninguna línea real dada de alta en
--     WhatsApp) — alcanzan para que el botón "Enviar guardias por
--     WhatsApp" aparezca y se pueda probar la pantalla (abrir/confirmar),
--     pero un wa.me a ese número no tiene a quién llegarle.
--   - No se configura ninguna credencial real de la API de WhatsApp/Meta
--     en esta base (eso se controla aparte, con las variables de entorno
--     WHATSAPP_*, que esta prueba no necesita).

-- ----------------------------------------------------------------------------
-- Administrador de PRUEBA, multi-destino (mismo legajo, una fila por lugar
-- — mismo patrón ya verificado en tests/pg/07_admin_multidestino.js): con
-- un solo legajo se puede entrar como administrador a los tres destinos.
-- La contraseña de administrador NO es esta columna `password` — la
-- valida el servidor contra la variable de entorno ADMIN_PASSWORD (ver
-- entorno-prueba/LEEME.md), igual en los tres destinos.
-- ----------------------------------------------------------------------------
insert into efectivos (legajo, nombre, es_admin, lugar, tipo, jerarquia) values
  ('ADMIN1', 'Administrador de Prueba (FICTICIO)', true, 'HIGA',    'Uniformado', 'Comisario'),
  ('ADMIN1', 'Administrador de Prueba (FICTICIO)', true, 'UPA',     'Uniformado', 'Comisario'),
  ('ADMIN1', 'Administrador de Prueba (FICTICIO)', true, 'MODULAR', 'Uniformado', 'Comisario')
on conflict (legajo, lugar) do nothing;

-- ----------------------------------------------------------------------------
-- Efectivos de PRUEBA, 2 por destino (password null = clave inicial igual
-- al legajo, como ya documenta la pantalla de ingreso: "Clave inicial: tu
-- número de legajo").
-- ----------------------------------------------------------------------------
insert into efectivos (legajo, nombre, es_admin, lugar, tipo, jerarquia, telefono) values
  ('910001', 'Prueba HIGA Uno, Efectivo (FICTICIO)',    false, 'HIGA',    'Uniformado',   'Oficial',    '5490000000001'),
  ('910002', 'Prueba HIGA Dos, Efectivo (FICTICIO)',    false, 'HIGA',    'Serv. General', null,        null),
  ('920001', 'Prueba UPA Uno, Efectivo (FICTICIO)',     false, 'UPA',     'Uniformado',   'Oficial',    '5490000000002'),
  ('920002', 'Prueba UPA Dos, Efectivo (FICTICIO)',     false, 'UPA',     'Destacamento', null,        null),
  ('930001', 'Prueba Modular Uno, Efectivo (FICTICIO)', false, 'MODULAR', 'Uniformado',   'Oficial',    '5490000000003'),
  ('930002', 'Prueba Modular Dos, Efectivo (FICTICIO)', false, 'MODULAR', 'Serv. General', null,        null)
on conflict (legajo, lugar) do nothing;

-- Mismo legajo en dos lugares a la vez (para poder probar, si se quiere,
-- que cada destino tiene su propio padrón aunque comparta la base — igual
-- idea que tests/pg/01_seed_ficticio.sql).
insert into efectivos (legajo, nombre, es_admin, lugar, tipo) values
  ('910001', 'Prueba HIGA Uno, Efectivo (FICTICIO)', false, 'MODULAR', 'Uniformado')
on conflict (legajo, lugar) do nothing;

-- ----------------------------------------------------------------------------
-- Ventana de disponibilidad ABIERTA hoy, en los tres destinos, para no
-- tener que tocar nada más antes de poder probar la carga de
-- disponibilidad como efectivo. Calculada en el momento en que se corre
-- este script (hora de Argentina, igual criterio que
-- lib/tiempoArgentina.js), así que sigue sirviendo sin importar qué día se
-- ejecute. Si se corre este script más de una vez (p.ej. recreando la
-- base), simplemente actualiza la fecha de apertura a "hoy" de nuevo.
-- ----------------------------------------------------------------------------
insert into configuracion (lugar, dia, hora_inicio, hora_fin, mes_apertura, anio_apertura)
select
  v.lugar,
  extract(day from (now() at time zone 'America/Argentina/Buenos_Aires'))::int,
  '00:00',
  '23:59',
  extract(month from (now() at time zone 'America/Argentina/Buenos_Aires'))::int,
  extract(year from (now() at time zone 'America/Argentina/Buenos_Aires'))::int
from (values ('HIGA'), ('UPA'), ('MODULAR')) as v(lugar)
on conflict (lugar) do update set
  dia = excluded.dia,
  hora_inicio = excluded.hora_inicio,
  hora_fin = excluded.hora_fin,
  mes_apertura = excluded.mes_apertura,
  anio_apertura = excluded.anio_apertura;

-- ----------------------------------------------------------------------------
-- Un caso de "24hs" y un caso de "pareja" en HIGA (opcional, solo para
-- tener algo armado si se quiere probar directamente la pantalla
-- "Asignación rápida" sin configurarlo a mano primero).
-- ----------------------------------------------------------------------------
insert into efectivos_especiales (lugar, tipo, legajo1, legajo2, activo) values
  ('HIGA', '24hs',   '910001', null,     true),
  ('UPA',  'pareja', '920001', '920002', true)
on conflict do nothing;

do $$ begin
  raise notice '=== Seed ficticio de los tres destinos (HIGA/UPA/MODULAR) cargado ===';
  raise notice 'Administrador de prueba: legajo ADMIN1 (clave = la que se configure en ADMIN_PASSWORD)';
  raise notice 'Efectivos de prueba: 910001/910002 (HIGA), 920001/920002 (UPA), 930001/930002 (MODULAR) — clave inicial = el propio legajo';
end $$;
