-- ============================================================================
-- Prueba REAL (no simulada) de supabase/migrations/0002_rls_propuesta.sql
-- contra un PostgreSQL 16 real local (polad_test), con el esquema ficticio
-- de 00_esquema_base_ficticio.sql y los datos de 01_seed_ficticio.sql ya
-- cargados.
--
-- Qué hace: crea dos roles de Postgres que imitan el comportamiento de
-- Supabase sin necesitar Supabase —
--   - anon:    sin BYPASSRLS, con los mismos GRANT de tabla que
--                         Supabase le da a `anon` (select/insert/update/
--                         delete), para que un rechazo sea por RLS y no
--                         simplemente por falta de permisos de tabla.
--   - service_role: con BYPASSRLS, como `service_role` en Supabase.
-- y después, usando SET ROLE (el superusuario de la prueba puede
-- cambiarse a cualquier rol sin pedir contraseña), repite las mismas
-- consultas como cada rol para comprobar que el bloqueo —y el acceso de la
-- service role— son reales a nivel de PostgreSQL, no solo "en teoría".
--
-- Esto NO reemplaza probar esto mismo contra el proyecto Supabase real:
-- ver supabase/diagnostico_lectura.sql para ver antes el estado actual ahí.
--
-- Ejecutar: psql -f 04_rls.sql (ver tests/pg/README.md)
-- ============================================================================

\set ON_ERROR_STOP on

-- ----------------------------------------------------------------------------
-- 0) Preparar los roles de prueba (se recrean desde cero cada corrida).
-- ----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'drop owned by anon';
    execute 'drop role anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'drop owned by service_role';
    execute 'drop role service_role';
  end if;
end $$;

create role anon nologin nosuperuser nobypassrls;
create role service_role nologin nosuperuser bypassrls;

grant select, insert, update, delete on
  disponibilidad, configuracion, publicaciones, turnos_publicados,
  disponibilidad_auditoria, turnos, efectivos
  to anon;

grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;

-- ----------------------------------------------------------------------------
-- 1) Aplicar la migración 0002 (activa RLS + políticas) tal como está en
--    supabase/migrations/0002_rls_propuesta.sql, en esta misma base de
--    prueba — se corre acá, antes de cambiar de rol, porque hace falta ser
--    dueño/superusuario para las sentencias ALTER TABLE / CREATE POLICY.
-- ----------------------------------------------------------------------------
\ir ../../supabase/migrations/0002_rls_propuesta.sql

-- ----------------------------------------------------------------------------
-- 2) Como anon (sin BYPASSRLS): disponibilidad, configuracion y
--    las 3 tablas nuevas tienen que quedar bloqueadas, aunque ya haya
--    filas cargadas por el seed (si no bloqueara de verdad, un select
--    anon vería las filas de ADMIN1/100001/100002/100003 del seed).
-- ----------------------------------------------------------------------------
set role anon;

do $$
declare n int;
begin
  select count(*) into n from disponibilidad; -- RLS: using(false) → 0 filas, sin error
  if n <> 0 then raise exception 'FALLO: anon pudo leer % fila(s) de disponibilidad (debería ser 0)', n; end if;
  raise notice 'OK (anon) - select en disponibilidad devuelve 0 filas aunque hay datos cargados';
end $$;

do $$
declare n int;
begin
  select count(*) into n from configuracion;
  if n <> 0 then raise exception 'FALLO: anon pudo leer % fila(s) de configuracion (debería ser 0)', n; end if;
  raise notice 'OK (anon) - select en configuracion devuelve 0 filas aunque hay datos cargados';
end $$;

do $$
declare n int;
begin
  select count(*) into n from publicaciones;
  if n <> 0 then raise exception 'FALLO: anon pudo leer % fila(s) de publicaciones (debería ser 0)', n; end if;
  raise notice 'OK (anon) - select en publicaciones devuelve 0 filas';
end $$;

do $$
declare n int;
begin
  select count(*) into n from turnos_publicados;
  if n <> 0 then raise exception 'FALLO: anon pudo leer % fila(s) de turnos_publicados (debería ser 0)', n; end if;
  raise notice 'OK (anon) - select en turnos_publicados devuelve 0 filas';
end $$;

do $$
declare n int;
begin
  select count(*) into n from disponibilidad_auditoria;
  if n <> 0 then raise exception 'FALLO: anon pudo leer % fila(s) de disponibilidad_auditoria (debería ser 0)', n; end if;
  raise notice 'OK (anon) - select en disponibilidad_auditoria devuelve 0 filas';
end $$;

-- Un insert con anon tiene que rechazarse (with check (false)), no solo
-- "ver 0 filas": confirma que tampoco puede escribir a ciegas.
do $$
begin
  begin
    insert into disponibilidad (legajo, dia, turno, mes, anio, lugar) values ('999999', 1, 'd', 11, 2026, 'HIGA');
    raise exception 'FALLO: anon pudo insertar en disponibilidad (debería haberlo rechazado la política RLS)';
  exception when insufficient_privilege or others then
    raise notice 'OK (anon) - insert en disponibilidad queda rechazado por la política RLS';
  end;
end $$;

do $$
begin
  begin
    insert into configuracion (lugar, dia) values ('NEUQUEN_FALSO', 5);
    raise exception 'FALLO: anon pudo insertar en configuracion (debería haberlo rechazado la política RLS)';
  exception when insufficient_privilege or others then
    raise notice 'OK (anon) - insert en configuracion queda rechazado por la política RLS';
  end;
end $$;

-- turnos y efectivos: NUEVO en esta revisión (punto 1 — "no puede quedar
-- como mejora futura"), ahora que admin.js/ControlApp.js/carga-planillas.js
-- ya no leen/escriben estas tablas con la clave anon (todo migrado a
-- endpoints autenticados — ver 0002_rls_propuesta.sql). Antes de esta
-- migración, el seed sí cargaba filas en ambas tablas y un select anon las
-- veía; ahora tiene que volver a dar 0, igual que el resto de las tablas.
do $$
declare n int;
begin
  select count(*) into n from turnos;
  if n <> 0 then raise exception 'FALLO: anon pudo leer % fila(s) de turnos (debería ser 0 — RLS activado en esta revisión)', n; end if;
  raise notice 'OK (anon) - select en turnos devuelve 0 filas aunque hay datos cargados';
end $$;

do $$
declare n int;
begin
  select count(*) into n from efectivos;
  if n <> 0 then raise exception 'FALLO: anon pudo leer % fila(s) de efectivos (debería ser 0 — RLS activado en esta revisión)', n; end if;
  raise notice 'OK (anon) - select en efectivos devuelve 0 filas aunque hay datos cargados (incluida la columna password, ya no legible con esta clave)';
end $$;

-- Igual que con disponibilidad/configuracion: un insert también tiene que
-- rechazarse, no solo "ver 0 filas".
do $$
begin
  begin
    insert into turnos (legajo, dia, turno, sector, mes, anio) values ('999996', 1, 'd', 'Guardia', 1, 2026);
    raise exception 'FALLO: anon pudo insertar en turnos (debería haberlo rechazado la política RLS)';
  exception when insufficient_privilege or others then
    raise notice 'OK (anon) - insert en turnos queda rechazado por la política RLS';
  end;
end $$;

do $$
begin
  begin
    insert into efectivos (legajo, nombre, lugar) values ('999995', 'Prueba Anon', 'HIGA');
    raise exception 'FALLO: anon pudo insertar en efectivos (debería haberlo rechazado la política RLS)';
  exception when insufficient_privilege or others then
    raise notice 'OK (anon) - insert en efectivos queda rechazado por la política RLS';
  end;
end $$;

-- Punto 1 de la revisión: "Verificá también permisos de funciones SQL y
-- rutas alternativas" — un select/insert bloqueado por RLS no alcanza si
-- igual se puede invocar la función de base de datos directo por RPC con
-- la clave anon, pasando por encima de cualquier endpoint y de su
-- verificación de sesión. Cada llamada de abajo debe rechazarse por falta
-- de privilegio (42501 / insufficient_privilege de Postgres), no solo
-- fallar por otra razón (si fallara por un error de validación en vez de
-- por permisos, significaría que SÍ pudo ejecutar la función).
do $$
declare v_fallo boolean := false; v_sqlstate text;
begin
  begin
    perform fn_guardar_disponibilidad_efectivo('999999', 'HIGA', 1, 2026, '{}'::jsonb, '{}'::jsonb);
  exception when others then
    v_fallo := true; v_sqlstate := sqlstate;
  end;
  if not v_fallo then raise exception 'FALLO: anon pudo ejecutar fn_guardar_disponibilidad_efectivo por RPC directo'; end if;
  if v_sqlstate <> '42501' then raise exception 'FALLO: esperaba que el rechazo fuera por falta de privilegio (42501), llegó sqlstate=%', v_sqlstate; end if;
  raise notice 'OK (anon) - fn_guardar_disponibilidad_efectivo no se puede invocar por RPC directo (EXECUTE revocado)';
end $$;

do $$
declare v_fallo boolean := false; v_sqlstate text;
begin
  begin
    perform fn_guardar_disponibilidad_admin('999999', 'HIGA', 1, 2026, '{}'::jsonb, 'X', null, '{}'::jsonb, '[]'::jsonb);
  exception when others then
    v_fallo := true; v_sqlstate := sqlstate;
  end;
  if not v_fallo then raise exception 'FALLO: anon pudo ejecutar fn_guardar_disponibilidad_admin por RPC directo'; end if;
  if v_sqlstate <> '42501' then raise exception 'FALLO: esperaba 42501, llegó sqlstate=%', v_sqlstate; end if;
  raise notice 'OK (anon) - fn_guardar_disponibilidad_admin no se puede invocar por RPC directo (EXECUTE revocado)';
end $$;

do $$
declare v_fallo boolean := false; v_sqlstate text;
begin
  begin
    perform fn_publicar_guardias('HIGA', 1, 2026, array['Guardia'], 'X', 0, 'hash-cualquiera');
  exception when others then
    v_fallo := true; v_sqlstate := sqlstate;
  end;
  if not v_fallo then raise exception 'FALLO: anon pudo ejecutar fn_publicar_guardias por RPC directo'; end if;
  if v_sqlstate <> '42501' then raise exception 'FALLO: esperaba 42501, llegó sqlstate=%', v_sqlstate; end if;
  raise notice 'OK (anon) - fn_publicar_guardias no se puede invocar por RPC directo (EXECUTE revocado)';
end $$;

do $$
declare v_fallo boolean := false; v_sqlstate text;
begin
  begin
    perform fn_turnos_borrador_insertar('HIGA', 1, 2026, '[]'::jsonb);
  exception when others then
    v_fallo := true; v_sqlstate := sqlstate;
  end;
  if not v_fallo then raise exception 'FALLO: anon pudo ejecutar fn_turnos_borrador_insertar por RPC directo'; end if;
  if v_sqlstate <> '42501' then raise exception 'FALLO: esperaba 42501, llegó sqlstate=%', v_sqlstate; end if;
  raise notice 'OK (anon) - fn_turnos_borrador_insertar no se puede invocar por RPC directo (EXECUTE revocado) — cierra la ruta alternativa a la escritura de turnos sin pasar por endpoints';
end $$;

reset role;

-- ----------------------------------------------------------------------------
-- 3) Como service_role (BYPASSRLS, como service_role en Supabase):
--    las tablas cerradas tienen que seguir siendo legibles y escribibles
--    de forma normal — confirma que las políticas no rompen a los
--    endpoints del servidor, que usan la service role key.
-- ----------------------------------------------------------------------------
set role service_role;

do $$
declare n int;
begin
  select count(*) into n from disponibilidad;
  if n = 0 then raise exception 'FALLO: service_role no pudo leer disponibilidad (BYPASSRLS debería dejarla ver todo)'; end if;
  raise notice 'OK (service_role) - select en disponibilidad sigue viendo todas las filas (% filas)', n;
end $$;

do $$
begin
  insert into configuracion (lugar, dia) values ('ZZZ_PRUEBA_SERVICE_ROLE', 9);
  delete from configuracion where lugar = 'ZZZ_PRUEBA_SERVICE_ROLE';
  raise notice 'OK (service_role) - insert/delete en configuracion funciona con normalidad';
end $$;

do $$
declare n int;
begin
  select count(*) into n from turnos;
  if n = 0 then raise exception 'FALLO: service_role no pudo leer turnos (BYPASSRLS debería dejarla ver todo) — esto rompería pages/api/admin-turnos.js y todo lo que lee el borrador'; end if;
  raise notice 'OK (service_role) - select en turnos sigue viendo todas las filas (% filas) — los endpoints del servidor no se rompen con RLS activado', n;
end $$;

do $$
declare n int;
begin
  select count(*) into n from efectivos;
  if n = 0 then raise exception 'FALLO: service_role no pudo leer efectivos (BYPASSRLS debería dejarla ver todo)'; end if;
  raise notice 'OK (service_role) - select en efectivos sigue viendo todas las filas (% filas), password incluida (la expone el endpoint autenticado, a propósito — ver pages/api/admin-efectivos.js)', n;
end $$;

-- Las funciones SÍ deben seguir siendo invocables por service_role (los
-- endpoints del servidor dependen de esto) — confirma que el revoke de
-- EXECUTE de la sección 2 no se pasó de largo y rompió también al rol que
-- sí debe poder llamarlas.
do $$
declare v_version int;
begin
  perform fn_guardar_disponibilidad_efectivo('999998', 'HIGA', 1, 2099, '{}'::jsonb, '{}'::jsonb);
  raise notice 'OK (service_role) - fn_guardar_disponibilidad_efectivo sigue siendo invocable (EXECUTE otorgado a service_role)';
end $$;

reset role;

-- ----------------------------------------------------------------------------
-- 4) Punto 2 de la revisión: "Corregí las políticas RLS para que una
--    política permisiva preexistente no anule el bloqueo". Las políticas
--    PERMISSIVE para el mismo rol/comando se combinan con OR — así que una
--    política permisiva using(true) ya existente (de un parche previo, de
--    otra migración, de algo cargado a mano en el SQL Editor de Supabase)
--    puede dejar sin efecto por completo a "bloquear_anon_*", que también
--    es permisiva. Esta prueba simula exactamente ese escenario — crea una
--    política permisiva previa con using(true) ANTES de reaplicar el
--    bloqueo — y comprueba que el acceso público siga rechazado. Si
--    "bloquear_anon_*" fuera permisiva, esta prueba fallaría (anon vería
--    las filas), demostrando el problema; con la política como RESTRICTIVE
--    (como queda después de esta revisión), el acceso sigue denegado sin
--    importar cuántas políticas permisivas haya.
-- ----------------------------------------------------------------------------
create policy "zzz_permisiva_preexistente_disponibilidad" on disponibilidad
  for all
  to anon
  using (true)
  with check (true);

set role anon;
do $$
declare n int;
begin
  select count(*) into n from disponibilidad;
  if n <> 0 then
    raise exception 'FALLO: con una política permisiva preexistente (using(true)) además del bloqueo, anon pudo leer % fila(s) de disponibilidad — el bloqueo NO es restrictivo y una política permisiva cualquiera lo anula', n;
  end if;
  raise notice 'OK (anon) - con una política permisiva preexistente (using(true)) ADEMÁS del bloqueo, disponibilidad sigue en 0 filas: el bloqueo es RESTRICTIVE y no se puede anular agregando otra política permisiva';
end $$;

do $$
declare v_fallo boolean := false;
begin
  begin
    insert into disponibilidad (legajo, dia, turno, mes, anio, lugar) values ('999997', 1, 'd', 1, 2026, 'HIGA');
  exception when others then
    v_fallo := true;
  end;
  if not v_fallo then raise exception 'FALLO: con la política permisiva preexistente, anon pudo insertar en disponibilidad'; end if;
  raise notice 'OK (anon) - el insert también sigue rechazado con la política permisiva preexistente agregada (with check (false) restrictiva no se anula)';
end $$;
reset role;

drop policy "zzz_permisiva_preexistente_disponibilidad" on disponibilidad;

-- ----------------------------------------------------------------------------
-- Limpieza: se deja esta base de prueba exactamente como estaba antes de
-- este archivo (políticas, RLS y roles incluidos), para poder volver a
-- correr 04_rls.sql (u otras pruebas que no esperan RLS activado) tantas
-- veces como haga falta sin acumular estado.
-- ----------------------------------------------------------------------------
drop policy if exists "bloquear_anon_publicaciones" on publicaciones;
drop policy if exists "bloquear_anon_turnos_publicados" on turnos_publicados;
drop policy if exists "bloquear_anon_disponibilidad_auditoria" on disponibilidad_auditoria;
drop policy if exists "bloquear_anon_disponibilidad" on disponibilidad;
drop policy if exists "bloquear_anon_configuracion" on configuracion;
drop policy if exists "bloquear_anon_turnos" on turnos;
drop policy if exists "bloquear_anon_efectivos" on efectivos;

alter table publicaciones disable row level security;
alter table turnos_publicados disable row level security;
alter table disponibilidad_auditoria disable row level security;
alter table disponibilidad disable row level security;
alter table configuracion disable row level security;
alter table turnos disable row level security;
alter table efectivos disable row level security;

revoke all on all tables in schema public from service_role;
revoke all on all sequences in schema public from service_role;
revoke all on all functions in schema public from service_role;
revoke all on disponibilidad, configuracion, publicaciones, turnos_publicados,
  disponibilidad_auditoria, turnos, efectivos from anon;
drop role anon;
drop role service_role;

do $$ begin raise notice '================ TODAS LAS PRUEBAS DE RLS (04_rls.sql) PASARON ================'; end $$;
