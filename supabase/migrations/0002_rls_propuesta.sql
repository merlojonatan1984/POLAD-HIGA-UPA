-- ============================================================================
-- POLAD — 0002: Políticas RLS — disponibilidad y privacidad en el servidor
-- ============================================================================
-- REVISIÓN 2 de este archivo — qué cambió respecto a la primera entrega y
-- por qué (punto 1 de la revisión: "la protección debe funcionar en el
-- servidor y la base de datos... no supongas que ya están protegidos"):
--
-- La primera versión de este archivo bloqueaba la clave anon SOLO en las
-- tres tablas nuevas (publicaciones, turnos_publicados,
-- disponibilidad_auditoria) y dejaba disponibilidad/configuracion
-- explícitamente pendientes, porque en ese momento varias pantallas
-- (EfectivoApp.js, admin.js) todavía las leían o escribían directo con la
-- clave anon desde el navegador — activar RLS ahí las habría roto.
--
-- En esta revisión, ese código ya se migró a endpoints propios del
-- servidor (ver pages/api/guardar-disponibilidad.js,
-- pages/api/admin-disponibilidad.js, pages/api/admin-disponibilidad-override.js,
-- pages/api/configuracion.js, pages/api/cambiar-clave.js), que verifican la
-- sesión con la cookie firmada (lib/authServer.js) y escriben con la
-- service role key. Se confirmó con una búsqueda en todo el proyecto
-- (grep de "from('disponibilidad')" y "from('configuracion')") que el
-- único llamado restante con la clave anon a esas dos tablas está en
-- components/AdminApp.js — un archivo que NINGUNA ruta de Next.js importa
-- (se confirmó con grep de "AdminApp" en pages/): es código muerto, nunca
-- se empaqueta ni se sirve al navegador, así que no es una superficie de
-- ataque real hoy. Por eso esta revisión SÍ cierra disponibilidad y
-- configuracion para la clave anon.
--
-- turnos y efectivos se cierran EN ESTA revisión (punto 1 de la corrección:
-- "no puede quedar como mejora futura") — ver la sección correspondiente
-- más abajo, con el detalle de qué se migró primero para poder hacerlo.
--
-- IMPORTANTE, sigue sin resolverse: no tuve acceso al panel de Supabase de
-- este proyecto durante esta tarea, así que no pude ejecutar nada de esto
-- contra la base real ni confirmar qué políticas existen hoy ahí. Lo que SÍ
-- se hizo esta vez: se armó una base PostgreSQL local descartable
-- (polad_test, con un esquema ficticio reconstruido por inspección de
-- código — ver tests/pg/00_esquema_base_ficticio.sql) y se probó esta
-- misma migración ahí, con roles que imitan a `anon` y a la service role
-- de Supabase, para verificar que el bloqueo (y el acceso de la service
-- role) funcionan de verdad — ver tests/pg/04_rls.sql (incluye, en esta
-- revisión, la prueba de los permisos EXECUTE de las funciones). Eso NO
-- reemplaza probarlo contra el proyecto
-- real: antes de aplicar esto en Supabase, correr primero
-- supabase/diagnostico_lectura.sql (solo lectura) en el SQL Editor del
-- proyecto, para ver qué política/estado existe hoy en cada tabla, y
-- comparar con lo que se agrega acá.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Tablas nuevas de esta etapa: solo la service role (servidor) puede leerlas
-- o escribirlas. Sin cambios respecto a la revisión anterior.
-- ----------------------------------------------------------------------------
alter table publicaciones enable row level security;
alter table turnos_publicados enable row level security;
alter table disponibilidad_auditoria enable row level security;

-- Punto 2 de la revisión: "Corregí las políticas RLS para que una política
-- permisiva preexistente no anule el bloqueo". Las políticas PERMISSIVE
-- para el mismo rol/comando se combinan entre sí con OR — si en algún
-- momento existe (hoy, o se agrega después, a mano en el SQL Editor, por
-- otro parche, etc.) OTRA política permisiva para `anon` con using(true)
-- en alguna de estas tablas, esa política sola bastaría para dejar pasar
-- el acceso sin importar que "bloquear_anon_*" también exista, porque
-- ambas son permisivas y "cualquiera de las dos permite" es la regla.
-- Con AS RESTRICTIVE, en cambio, esta política se combina con AND: para
-- que el acceso se permita, TODAS las políticas restrictivas tienen que
-- permitirlo además de alguna permisiva — así que using(false) acá
-- bloquea siempre, sin importar cuántas políticas permisivas haya al
-- lado. (Y si no existiera ninguna política permisiva para anon en la
-- tabla, el acceso ya se deniega por defecto, así que esto no cambia el
-- caso normal — solo cierra el caso en que alguien agrega una permisiva
-- de más.) Probado explícitamente en tests/pg/04_rls.sql, sección 4:
-- se crea a propósito una política permisiva previa con using(true) y se
-- confirma que el acceso público sigue rechazado.
drop policy if exists "bloquear_anon_publicaciones" on publicaciones;
create policy "bloquear_anon_publicaciones" on publicaciones
  as restrictive
  for all
  to anon
  using (false)
  with check (false);

drop policy if exists "bloquear_anon_turnos_publicados" on turnos_publicados;
create policy "bloquear_anon_turnos_publicados" on turnos_publicados
  as restrictive
  for all
  to anon
  using (false)
  with check (false);

drop policy if exists "bloquear_anon_disponibilidad_auditoria" on disponibilidad_auditoria;
create policy "bloquear_anon_disponibilidad_auditoria" on disponibilidad_auditoria
  as restrictive
  for all
  to anon
  using (false)
  with check (false);

-- ----------------------------------------------------------------------------
-- NUEVO en esta revisión: disponibilidad y configuracion. Todo el acceso
-- desde páginas que de verdad se sirven hoy pasa por endpoints propios
-- (service role, sesión verificada) — ver el detalle en el preámbulo.
-- ----------------------------------------------------------------------------
alter table disponibilidad enable row level security;
alter table configuracion enable row level security;

drop policy if exists "bloquear_anon_disponibilidad" on disponibilidad;
create policy "bloquear_anon_disponibilidad" on disponibilidad
  as restrictive
  for all
  to anon
  using (false)
  with check (false);

drop policy if exists "bloquear_anon_configuracion" on configuracion;
create policy "bloquear_anon_configuracion" on configuracion
  as restrictive
  for all
  to anon
  using (false)
  with check (false);

-- (La service_role key de Supabase ignora RLS por diseño, así que los
-- endpoints del servidor siguen funcionando exactamente igual que antes;
-- lo único que deja de funcionar es un pedido hecho directo a la REST API
-- de Supabase con la clave anon pública, sin pasar por esos endpoints.)

-- ----------------------------------------------------------------------------
-- NUEVO en esta revisión — punto 1 de la corrección: "Verificá también
-- permisos de funciones SQL y rutas alternativas". Postgres le otorga
-- EXECUTE sobre toda función nueva a PUBLIC por defecto — y en Supabase eso
-- incluye a `anon` y `authenticated`, así que cualquiera con la clave anon
-- pública podía llamar ESTAS funciones directo por RPC (POST
-- /rest/v1/rpc/fn_...), sin pasar por ningún endpoint de Next.js ni por la
-- verificación de sesión — una ruta alternativa que dejaba sin efecto todo
-- el resto de esta migración. Ahora se revoca EXECUTE de PUBLIC (que cubre
-- a anon y authenticated, salvo que se les haya otorgado aparte — por eso
-- también se revoca de esos dos roles explícitamente) y se otorga solo a
-- service_role, el rol con el que corren los endpoints del servidor (todos
-- usan SUPABASE_SERVICE_ROLE_KEY — confirmado con grep de "createClient" en
-- pages/api/*.js). Esto no rompe ningún endpoint existente: todos los que
-- llaman estas funciones por RPC ya usan esa clave.
--
-- Se listan explícitamente las firmas (y no "all functions in schema
-- public") para no revocar/otorgar por accidente sobre funciones que se
-- agreguen después sin pasar por esta misma revisión explícita.
-- ----------------------------------------------------------------------------
do $$
declare v_fn text;
begin
  foreach v_fn in array array[
    'fn_validar_scope(text,int,int)',
    'fn_turnos_permitidos(text)',
    'fn_validar_dias_disponibilidad(jsonb,text,int,int)',
    'fn_sectores_de_lugar(text)',
    'fn_validar_sectores_de_lugar(text,text[])',
    'fn_hash_borrador_turnos(int,int,text[])',
    'fn_lock_turnos_borrador(text,int,int)',
    'fn_resumen_publicacion(text,int,int,text[])',
    'fn_publicar_guardias(text,int,int,text[],text,int,text)',
    'fn_turnos_borrador_insertar(text,int,int,jsonb)',
    'fn_turnos_borrador_reemplazar_scope(text,int,int,text[],jsonb)',
    'fn_turnos_borrador_borrar_scope(text,int,int,text[])',
    'fn_turnos_borrador_actualizar_uno(text,int,int,bigint,text,text,text)',
    'fn_turnos_borrador_borrar_uno(text,int,int,bigint)',
    'fn_turnos_borrador_renombrar_legajo(text,text,text)',
    'fn_admin_guardar_efectivo(text,bigint,text,text,text,text,text,text,text,text,text,text)',
    'fn_lock_disponibilidad(text,text,int,int)',
    'fn_guardar_disponibilidad_admin(text,text,int,int,jsonb,text,text,jsonb,jsonb)',
    'fn_guardar_disponibilidad_efectivo(text,text,int,int,jsonb,jsonb)'
  ]
  loop
    execute format('revoke execute on function %s from public', v_fn);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke execute on function %s from anon', v_fn);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('revoke execute on function %s from authenticated', v_fn);
    end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', v_fn);
    end if;
  end loop;
end $$;

-- Nota: en este entorno local de prueba (polad_test) los roles anon/
-- authenticated/service_role no existen fuera de tests/pg/04_rls.sql (que
-- los crea y los destruye ella misma) — por eso los revoke/grant de arriba
-- están guardados detrás de un "if exists", para que esta migración se
-- pueda aplicar igual en una base sin esos roles (como se hizo acá, contra
-- polad_test, para probar el resto de la migración) sin fallar por un rol
-- inexistente. Contra el proyecto Supabase real, anon/authenticated/
-- service_role siempre existen, así que las tres ramas se ejecutan.

-- ----------------------------------------------------------------------------
-- NUEVO en esta revisión — turnos y efectivos. El bloqueo que faltaba en la
-- revisión anterior ("no puede quedar como mejora futura") se agrega acá,
-- ahora que lo que lo bloqueaba de verdad se resolvió:
--
--   - turnos (el borrador de guardias): admin.js tenía ~24 puntos que leían
--     o escribían esta tabla directo con la clave anon; TODOS se migraron a
--     pages/api/admin-turnos.js (sesión de administrador + las funciones
--     fn_turnos_borrador_* de este archivo, que además comparten el lock
--     con la publicación — ver más arriba). pages/control.js/
--     components/ControlApp.js (el panel de supervisión, que no tenía
--     NINGÚN login real) ahora exige la misma sesión y, además, dejó de
--     leer el borrador — lee turnos_publicados (coherente con lo
--     publicado, punto 6). Confirmado con una búsqueda de todo el proyecto
--     (no solo de memoria) que no queda ningún `supabase.from('turnos')`
--     del lado del cliente — ver tests/pg/04_rls.sql para la prueba real
--     de que, con RLS activado, anon efectivamente ya no puede leer ni
--     escribir esta tabla, y de que el rol de servicio sigue pudiendo.
--
--   - efectivos: mismo tratamiento — admin.js (incluida la gestión de
--     personal, firmas y planillas) y pages/carga-planillas.js (otro
--     hallazgo de esta ronda: tenía login real pero después leía/escribía
--     esta tabla directo con la clave anon) se migraron a
--     pages/api/admin-efectivos.js / pages/api/carga-planillas-datos.js.
--     La columna `password` en texto plano queda protegida de la clave
--     anon por esta misma política (RLS bloquea la fila entera, no solo
--     columnas sueltas) — sigue siendo un problema más de fondo (no
--     guardar contraseñas en texto plano, adoptar un esquema de
--     autenticación real) que una migración de políticas no resuelve del
--     todo, pero deja de ser accesible con la clave pública, que era la
--     exposición más directa. Esa migración más grande sigue fuera de
--     esta etapa.
--
-- Pendiente real, documentado sin resolver en esta entrega: el bucket de
-- Storage `planillas` (usado por pages/carga-planillas.js y pages/admin.js
-- para subir archivos) sigue aceptando la clave anon directo desde el
-- navegador — es un mecanismo de permisos de Supabase Storage, separado de
-- RLS sobre tablas, fuera del alcance de esta migración SQL.
-- ----------------------------------------------------------------------------
alter table turnos enable row level security;
alter table efectivos enable row level security;

drop policy if exists "bloquear_anon_turnos" on turnos;
create policy "bloquear_anon_turnos" on turnos
  as restrictive
  for all
  to anon
  using (false)
  with check (false);

drop policy if exists "bloquear_anon_efectivos" on efectivos;
create policy "bloquear_anon_efectivos" on efectivos
  as restrictive
  for all
  to anon
  using (false)
  with check (false);
-- ============================================================================
