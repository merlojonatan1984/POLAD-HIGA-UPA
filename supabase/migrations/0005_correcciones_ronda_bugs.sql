-- ============================================================================
-- POLAD — 0005: correcciones de errores reportados sobre la entrega anterior
-- (migración 0004: sexo, puesto fijo, objetivos individuales, avisos de
-- WhatsApp). Migración ADITIVA — no modifica ningún dato existente ni
-- ninguna tabla/función de 0001/0002/0003. Donde hace falta cambiar el
-- COMPORTAMIENTO de una función de 0004 (sin cambiar su firma de entrada
-- para no romper a quien ya la llama), se usa `create or replace function`
-- en ESTE archivo — 0004 queda intacto en el historial, esta es la versión
-- vigente a partir de ahora.
--
-- Alcance: ÚNICAMENTE los errores reportados sobre la entrega de 0004. No
-- se tocó fn_admin_guardar_efectivo, fn_publicar_guardias (se la deja
-- intacta y se envuelve, no se edita — ver más abajo), ni el algoritmo de
-- asignación `calcularAsignaciones`/`generarTurnos` de pages/admin.js. No se
-- agregó ninguna función ni tabla fuera de lo necesario para cerrar estos
-- errores puntuales.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- ERROR: "Guardar los cambios de puestos y objetivos mediante transacciones.
-- Si falla la nueva regla, debe seguir activa la anterior; no dejar al
-- efectivo sin configuración."
--
-- pages/api/admin-reglas-puesto.js y admin-reglas-objetivo.js hacían
-- "desactivar la regla anterior" y "insertar la nueva" (y, en objetivo,
-- "insertar en el historial") como llamadas SEPARADAS a Supabase, una
-- después de la otra desde JavaScript. Si la ÚLTIMA fallaba (red, timeout,
-- restricción), las anteriores YA se habían confirmado — el efectivo quedaba
-- sin ninguna regla activa. Ahora todo el guardado de una regla (puesto fijo
-- u objetivo) es UNA sola función SQL, así que si cualquier paso falla,
-- Postgres revierte TODO — la regla anterior sigue activa exactamente como
-- estaba.
-- ----------------------------------------------------------------------------

create or replace function fn_guardar_puesto_fijo(
  p_legajo text,
  p_lugar text,
  p_sector text,
  p_turno text,
  p_actor_legajo text
)
returns efectivo_puesto_fijo
language plpgsql
as $$
declare
  v_fila efectivo_puesto_fijo;
begin
  update efectivo_puesto_fijo
     set activo = false, actualizado_por_legajo = p_actor_legajo, actualizado_en = now()
   where legajo = p_legajo and lugar = p_lugar and activo = true;

  insert into efectivo_puesto_fijo (legajo, lugar, sector, turno, activo, creado_por_legajo)
  values (p_legajo, p_lugar, p_sector, p_turno, true, p_actor_legajo)
  returning * into v_fila;

  return v_fila;
end;
$$;

comment on function fn_guardar_puesto_fijo(text, text, text, text, text) is
  'Desactiva la regla de puesto fijo previa (si existe) e inserta la nueva, en una sola transacción — si la inserción falla, la desactivación también se revierte: nunca queda el efectivo sin ninguna regla activa. Llamar desde pages/api/admin-reglas-puesto.js (acción "guardar") en vez de hacer los dos pasos por separado.';

create or replace function fn_guardar_objetivo(
  p_legajo text,
  p_lugar text,
  p_tipo text,
  p_cantidad numeric,
  p_turno_objetivo text,
  p_actor_legajo text
)
returns efectivo_objetivo
language plpgsql
as $$
declare
  v_previa_id bigint;
  v_accion text;
  v_fila efectivo_objetivo;
begin
  select id into v_previa_id
    from efectivo_objetivo
   where legajo = p_legajo and lugar = p_lugar and activo = true;

  v_accion := case when v_previa_id is null then 'crear' else 'editar' end;

  -- El historial se registra en la MISMA transacción que el resto: si algo
  -- más abajo falla, esta fila de historial también se revierte, para que
  -- nunca quede un registro de un cambio que en realidad no se completó.
  insert into efectivo_objetivo_historial (legajo, lugar, tipo, cantidad, turno_objetivo, accion, modificado_por_legajo)
  values (p_legajo, p_lugar, p_tipo, p_cantidad, p_turno_objetivo, v_accion, p_actor_legajo);

  if v_previa_id is not null then
    update efectivo_objetivo
       set activo = false, actualizado_por_legajo = p_actor_legajo, actualizado_en = now()
     where id = v_previa_id;
  end if;

  insert into efectivo_objetivo (legajo, lugar, tipo, cantidad, turno_objetivo, activo, creado_por_legajo)
  values (p_legajo, p_lugar, p_tipo, p_cantidad, p_turno_objetivo, true, p_actor_legajo)
  returning * into v_fila;

  return v_fila;
end;
$$;

comment on function fn_guardar_objetivo(text, text, text, numeric, text, text) is
  'Registra el historial, desactiva el objetivo previo (si existe) e inserta el nuevo, en una sola transacción — si la inserción final falla, el historial y la desactivación también se revierten: nunca queda el efectivo sin ningún objetivo activo, ni un historial que registre un cambio que no llegó a completarse. Llamar desde pages/api/admin-reglas-objetivo.js (acción "guardar").';

create or replace function fn_desactivar_objetivo(
  p_id bigint,
  p_lugar text,
  p_actor_legajo text
)
returns boolean
language plpgsql
as $$
declare
  v_fila efectivo_objetivo;
begin
  select * into v_fila from efectivo_objetivo where id = p_id and lugar = p_lugar;
  if v_fila.id is null then
    return false;
  end if;

  insert into efectivo_objetivo_historial (legajo, lugar, tipo, cantidad, turno_objetivo, accion, modificado_por_legajo)
  values (v_fila.legajo, p_lugar, v_fila.tipo, v_fila.cantidad, v_fila.turno_objetivo, 'desactivar', p_actor_legajo);

  update efectivo_objetivo
     set activo = false, actualizado_por_legajo = p_actor_legajo, actualizado_en = now()
   where id = p_id;

  return true;
end;
$$;

comment on function fn_desactivar_objetivo(bigint, text, text) is
  'Registra el historial y desactiva el objetivo, en una sola transacción. Llamar desde pages/api/admin-reglas-objetivo.js (acción "desactivar").';

-- ----------------------------------------------------------------------------
-- ERRORES DE WHATSAPP
-- ----------------------------------------------------------------------------

-- "Confirmar el envío debe referirse al contenido publicado que se preparó
-- para comunicar" / "Si las guardias cambiaron después de abrir el mensaje,
-- no permitir confirmar ese mensaje viejo como aviso del cronograma nuevo."
--
-- Se agrega una columna que guarda, en el momento de abrir el link de
-- WhatsApp, una FOTO del fingerprint de guardias que se está comunicando.
-- Confirmar el envío exige que esa foto siga coincidiendo con el fingerprint
-- ACTUAL (si cambió, hay que volver a abrir el mensaje con el contenido
-- nuevo antes de poder confirmar). Se limpia cada vez que el aviso vuelve a
-- pendiente (por una sincronización real o por "desmarcar"), así que un
-- "abrir" viejo nunca habilita un "confirmar" sobre contenido distinto.
alter table whatsapp_avisos add column if not exists fingerprint_en_apertura text;

comment on column whatsapp_avisos.fingerprint_en_apertura is
  'Fingerprint de turnos_publicados en el momento en que se hizo click en "abrir WhatsApp" por última vez. fn_whatsapp_confirmar_envio exige que coincida con fingerprint_turnos (el actual) para poder confirmar — si cambiaron las guardias desde que se abrió el mensaje, se rechaza la confirmación en vez de dejar confirmado un cronograma desactualizado. Se limpia cada vez que el aviso vuelve a pendiente.';

-- "Repetir la sincronización de una misma publicación no debe borrar una
-- confirmación válida."
--
-- La versión de 0004 comparaba el fingerprint de la publicación VIGENTE
-- contra el de la publicación ANTERIOR (version - 1) en cada llamada. Si se
-- llamaba más de una vez para la MISMA publicación vigente (reintento, o
-- quedar integrada dentro de fn_publicar_guardias_y_sincronizar_whatsapp —
-- ver más abajo, y que como cualquier función puede reintentarse), esa
-- comparación daba "cambió" otra vez, aunque nada se hubiera vuelto a
-- publicar — y si el administrador ya había re-confirmado el envío después
-- del primer reset, esa segunda pasada volvía a resetear esa confirmación
-- recién hecha, sin ningún cambio real de guardias de por medio.
--
-- Ahora se compara el fingerprint nuevo contra el de la FILA YA GUARDADA en
-- whatsapp_avisos (lo último que esta misma función sincronizó, o
-- inexistente si es la primera vez) — así, llamar esta función varias veces
-- para la misma publicación vigente, sin que nada se vuelva a publicar entre
-- medio, es un no-op a partir de la segunda vez (nunca vuelve a resetear lo
-- que ya está sincronizado, ni pisa una confirmación vigente).
--
-- De paso, esto también resuelve "permitir comunicar que se retiraron todas
-- las guardias de un efectivo": el universo de legajos a revisar ahora es
-- "los de la publicación nueva" UNIÓN "los que ya tenían una fila de aviso
-- en este lugar/mes/año" (no solo los de la publicación INMEDIATAMENTE
-- anterior) — un efectivo que queda con CERO guardias publicadas sigue
-- siendo detectado (fingerprint nuevo = '', distinto del que tenía
-- guardado), su aviso vuelve a pendiente, y pages/admin.js (ver más abajo)
-- ahora sí deja abrir/confirmar ese aviso aunque no tenga ninguna guardia
-- para listar.
create or replace function fn_whatsapp_sincronizar_tras_publicar(
  p_lugar text,
  p_mes int,
  p_anio int
)
returns int
language plpgsql
as $$
declare
  v_nueva_id bigint;
  r record;
  v_fp_nueva text;
  v_fila_actual whatsapp_avisos;
  v_existia boolean;
  v_cambiados int := 0;
begin
  perform pg_advisory_xact_lock(hashtext('whatsapp_sync:' || p_lugar || ':' || p_mes || ':' || p_anio));

  select id into v_nueva_id
    from publicaciones
   where lugar = p_lugar and mes = p_mes and anio = p_anio and vigente = true;

  if v_nueva_id is null then
    return 0;
  end if;

  for r in (
    select distinct legajo from (
      select legajo from turnos_publicados where publicacion_id = v_nueva_id
      union
      select legajo from whatsapp_avisos where lugar = p_lugar and mes = p_mes and anio = p_anio
    ) u
  ) loop
    select coalesce(string_agg(dia::text || '-' || turno || '-' || sector, ',' order by dia, turno, sector), '')
      into v_fp_nueva
      from turnos_publicados
     where publicacion_id = v_nueva_id and legajo = r.legajo;

    select * into v_fila_actual
      from whatsapp_avisos
     where legajo = r.legajo and lugar = p_lugar and mes = p_mes and anio = p_anio;
    v_existia := found;

    if (not v_existia) or (v_fila_actual.fingerprint_turnos is distinct from v_fp_nueva) then
      if v_existia and v_fila_actual.estado = 'confirmado' then
        insert into whatsapp_avisos_historial (legajo, lugar, mes, anio, publicacion_id, estado_anterior, motivo)
        values (r.legajo, p_lugar, p_mes, p_anio, v_fila_actual.publicacion_id, 'confirmado', 'reset_por_cambio_de_guardias_publicadas');
      end if;

      insert into whatsapp_avisos (legajo, lugar, mes, anio, publicacion_id, fingerprint_turnos, fingerprint_en_apertura, estado, abierto_en, abierto_por_legajo, confirmado_en, confirmado_por_legajo, actualizado_en)
      values (r.legajo, p_lugar, p_mes, p_anio, v_nueva_id, v_fp_nueva, null, 'pendiente', null, null, null, null, now())
      on conflict (legajo, lugar, mes, anio) do update set
        publicacion_id = excluded.publicacion_id,
        fingerprint_turnos = excluded.fingerprint_turnos,
        fingerprint_en_apertura = null,
        estado = 'pendiente', abierto_en = null, abierto_por_legajo = null,
        confirmado_en = null, confirmado_por_legajo = null, actualizado_en = now();

      v_cambiados := v_cambiados + 1;
    else
      -- Sin cambio real respecto de lo ya sincronizado: solo refresca la
      -- referencia a la publicación vigente — nunca toca estado,
      -- confirmado_en/por, ni fingerprint_en_apertura. Esto es lo que hace
      -- que repetir la sincronización para la misma publicación conserve
      -- una confirmación válida en vez de volver a resetearla.
      update whatsapp_avisos
         set publicacion_id = v_nueva_id, actualizado_en = now()
       where legajo = r.legajo and lugar = p_lugar and mes = p_mes and anio = p_anio;
    end if;
  end loop;

  return v_cambiados;
end;
$$;

comment on function fn_whatsapp_sincronizar_tras_publicar(text, int, int) is
  'Llamar después de cada publicación exitosa (ver fn_publicar_guardias_y_sincronizar_whatsapp). Compara el fingerprint nuevo contra el YA GUARDADO en whatsapp_avisos (no contra la publicación anterior): resetea a pendiente SOLO los efectivos cuyo contenido realmente cambió respecto de lo último sincronizado (incluye quedar en cero guardias), y es un no-op para quien no cambió — llamarla más de una vez para la misma publicación vigente nunca vuelve a resetear una confirmación válida.';

-- "Permitir comunicar que se retiraron todas las guardias de un efectivo":
-- registrar "abrir" (nueva función, atómica: deja una FOTO del fingerprint
-- actual en fingerprint_en_apertura, para la validación de "confirmar" de
-- más abajo). No cambia nada si ya estaba confirmado (mismo comportamiento
-- que tenía pages/api/whatsapp-avisos.js, ahora atómico en SQL).
create or replace function fn_whatsapp_marcar_abierto(
  p_legajo text,
  p_lugar text,
  p_mes int,
  p_anio int,
  p_actor_legajo text
)
returns whatsapp_avisos
language plpgsql
as $$
declare
  v_fila whatsapp_avisos;
begin
  update whatsapp_avisos
     set abierto_en = now(),
         abierto_por_legajo = p_actor_legajo,
         fingerprint_en_apertura = fingerprint_turnos,
         actualizado_en = now()
   where legajo = p_legajo and lugar = p_lugar and mes = p_mes and anio = p_anio
     and estado <> 'confirmado'
  returning * into v_fila;

  if v_fila.id is null then
    -- O no existe fila (nunca se publicó este período para este efectivo —
    -- el endpoint ya valida esto antes de llamar, pero se cubre igual acá
    -- por las dudas), o ya estaba confirmado (abrir de nuevo no degrada ese
    -- estado) — se devuelve la fila actual sin cambios, nunca se inventa.
    select * into v_fila
      from whatsapp_avisos
     where legajo = p_legajo and lugar = p_lugar and mes = p_mes and anio = p_anio;
  end if;

  return v_fila;
end;
$$;

comment on function fn_whatsapp_marcar_abierto(text, text, int, int, text) is
  'Registra que se abrió el link de WhatsApp (abrir no es enviar) y guarda una foto del fingerprint actual en fingerprint_en_apertura, para que fn_whatsapp_confirmar_envio pueda exigir que coincida con el contenido vigente al momento de confirmar. No cambia nada si el aviso ya estaba confirmado.';

-- "Confirmar el envío debe referirse al contenido publicado que se preparó
-- para comunicar" / "no permitir confirmar ese mensaje viejo": exige que
-- fingerprint_en_apertura (lo que se abrió) coincida con fingerprint_turnos
-- (lo que hay ahora) antes de marcar confirmado.
create or replace function fn_whatsapp_confirmar_envio(
  p_legajo text,
  p_lugar text,
  p_mes int,
  p_anio int,
  p_actor_legajo text
)
returns whatsapp_avisos
language plpgsql
as $$
declare
  v_fila whatsapp_avisos;
begin
  select * into v_fila
    from whatsapp_avisos
   where legajo = p_legajo and lugar = p_lugar and mes = p_mes and anio = p_anio;

  if v_fila.id is null then
    raise exception using errcode = 'P0001', message = 'no_existe_aviso';
  end if;

  if v_fila.fingerprint_en_apertura is null or v_fila.fingerprint_en_apertura is distinct from v_fila.fingerprint_turnos then
    raise exception using
      errcode = 'P0001',
      message = 'contenido_cambio_desde_apertura',
      detail = 'El cronograma publicado para este efectivo cambió (o todavía no se abrió el mensaje con el contenido actual) desde la última vez que se abrió WhatsApp — hay que volver a abrirlo con el contenido vigente antes de poder confirmar el envío.';
  end if;

  update whatsapp_avisos
     set estado = 'confirmado', confirmado_en = now(), confirmado_por_legajo = p_actor_legajo, actualizado_en = now()
   where id = v_fila.id
  returning * into v_fila;

  return v_fila;
end;
$$;

comment on function fn_whatsapp_confirmar_envio(text, text, int, int, text) is
  'Confirma el envío SOLO si lo último que se abrió (fingerprint_en_apertura) coincide con el contenido publicado vigente (fingerprint_turnos) — si las guardias cambiaron después de abrir el mensaje, rechaza con "contenido_cambio_desde_apertura" en vez de confirmar un cronograma desactualizado.';

-- "desmarcar", ahora atómico (historial + reset en una sola transacción, en
-- vez de dos llamadas separadas desde JavaScript).
create or replace function fn_whatsapp_desmarcar(
  p_legajo text,
  p_lugar text,
  p_mes int,
  p_anio int,
  p_actor_legajo text
)
returns whatsapp_avisos
language plpgsql
as $$
declare
  v_fila whatsapp_avisos;
begin
  select * into v_fila
    from whatsapp_avisos
   where legajo = p_legajo and lugar = p_lugar and mes = p_mes and anio = p_anio;

  if v_fila.id is null then
    raise exception using errcode = 'P0001', message = 'no_existe_aviso';
  end if;

  if v_fila.estado = 'confirmado' then
    insert into whatsapp_avisos_historial (legajo, lugar, mes, anio, publicacion_id, estado_anterior, motivo)
    values (p_legajo, p_lugar, p_mes, p_anio, v_fila.publicacion_id, 'confirmado', 'desmarcado_manual_por_administrador');
  end if;

  update whatsapp_avisos
     set estado = 'pendiente', confirmado_en = null, confirmado_por_legajo = null, actualizado_en = now()
   where id = v_fila.id
  returning * into v_fila;

  return v_fila;
end;
$$;

comment on function fn_whatsapp_desmarcar(text, text, int, int, text) is
  'Corrección manual del administrador: vuelve a pendiente un aviso confirmado por error, registrando el historial, en una sola transacción.';

-- "Coordinar publicación y actualización de avisos para que un fallo no
-- deje confirmado un cronograma desactualizado."
--
-- pages/api/publicar-guardias.js llamaba fn_publicar_guardias y, DESPUÉS,
-- por separado (nunca en la misma transacción, "a propósito" según el
-- comentario de la entrega anterior), fn_whatsapp_sincronizar_tras_publicar
-- como best-effort: si esa segunda llamada fallaba, la publicación ya
-- confirmada NO se revertía, y el administrador se quedaba con una
-- advertencia aparte en vez de una garantía real. Eso es exactamente lo que
-- puede dejar un aviso "confirmado" apuntando a un cronograma que ya
-- cambió, si la sincronización que debía resetearlo no llegó a correr.
--
-- Ahora existe una sola función que hace las dos cosas EN LA MISMA
-- transacción: si la sincronización de avisos falla por lo que sea, toda la
-- transacción (incluida la publicación) se revierte — nunca queda una
-- publicación nueva confirmada con avisos desactualizados o a medio
-- sincronizar. No se modifica fn_publicar_guardias en sí (sigue intacta,
-- function congelada de esta ronda); esta función nueva la llama y le
-- agrega la sincronización atómica alrededor.
create or replace function fn_publicar_guardias_y_sincronizar_whatsapp(
  p_lugar text,
  p_mes int,
  p_anio int,
  p_sectores text[],
  p_publicado_por_legajo text,
  p_version_base int,
  p_hash_borrador text
)
returns table (publicacion_id bigint, version int, resumen jsonb, efectivos_afectados jsonb)
language plpgsql
as $$
begin
  return query
    select * from fn_publicar_guardias(p_lugar, p_mes, p_anio, p_sectores, p_publicado_por_legajo, p_version_base, p_hash_borrador);

  -- fn_publicar_guardias ya corrió completo (y encoló su resultado para
  -- devolver) antes de esta línea. Si lo siguiente falla, Postgres revierte
  -- TODA la transacción, publicación incluida.
  perform fn_whatsapp_sincronizar_tras_publicar(p_lugar, p_mes, p_anio);
end;
$$;

comment on function fn_publicar_guardias_y_sincronizar_whatsapp(text, int, int, text[], text, int, text) is
  'Publica (fn_publicar_guardias, sin modificarla) y sincroniza los avisos de WhatsApp de ese mismo scope EN LA MISMA transacción — si la sincronización falla, la publicación también se revierte, para que nunca quede una publicación confirmada con avisos de WhatsApp desactualizados o sin sincronizar. Llamar desde pages/api/publicar-guardias.js en vez de las dos llamadas separadas que usaba la entrega anterior.';

-- ----------------------------------------------------------------------------
-- "Proteger las tablas y funciones nuevas de la migración 0004, conservando
-- el acceso mediante los endpoints autorizados."
--
-- 0004 nunca activó RLS en sus tablas nuevas ni revocó EXECUTE de sus
-- funciones — quedaban exactamente como las crea Postgres por defecto:
-- EXECUTE otorgado a PUBLIC (que en Supabase incluye a `anon`), y sin RLS
-- las tablas son legibles/escribibles con la clave anon pública sin pasar
-- por ningún endpoint. Mismo tratamiento que supabase/migrations/
-- 0002_rls_propuesta.sql le dio a las tablas de 0001: RLS activado + una
-- política RESTRICTIVE que bloquea a `anon` sin excepción (para que una
-- política permisiva agregada después no la anule — ver 0002), y EXECUTE
-- revocado de PUBLIC/anon/authenticated, otorgado solo a service_role (el
-- rol con el que corren todos los endpoints de pages/api/*.js). Nada de
-- esto cambia el comportamiento de los endpoints autorizados: todos ya usan
-- SUPABASE_SERVICE_ROLE_KEY, que ignora RLS y mantiene su EXECUTE.
-- ----------------------------------------------------------------------------

alter table efectivo_puesto_fijo enable row level security;
alter table efectivo_objetivo enable row level security;
alter table efectivo_objetivo_historial enable row level security;
alter table whatsapp_avisos enable row level security;
alter table whatsapp_avisos_historial enable row level security;

-- Corrección sobre el primer intento de este mismo archivo (encontrada
-- corriendo las pruebas de esta ronda contra la base de prueba sandbox,
-- tests/pg/00_esquema_base_ficticio.sql, que —a diferencia de un proyecto
-- Supabase real— no trae los roles `anon`/`service_role` ya creados):
-- `create policy ... to anon` falla la sentencia ENTERA con "role anon does
-- not exist" si ese rol todavía no existe en la base donde se aplica esta
-- migración. Eso es exactamente lo que le pasaba a 0004 (nunca tuvo RLS) y
-- lo que le pasaría a este archivo tal como estaba. Mismo criterio
-- defensivo que ya usa el bloque de REVOKE/GRANT de EXECUTE más abajo (y
-- que supabase/migrations/0002_rls_propuesta.sql NO necesitaba porque ese
-- archivo nunca se aplica directo contra la base sandbox — solo dentro de
-- tests/pg/04_rls.sql, después de crear esos roles a propósito): cada
-- `create policy ... to anon` queda atrás de un `if exists (select 1 from
-- pg_roles where rolname = 'anon')`. Contra el proyecto Supabase real,
-- donde `anon` siempre existe, el comportamiento es exactamente el mismo
-- de antes. Contra una base sin ese rol (como la sandbox, antes de que
-- tests/pg/04_rls.sql o tests/pg/08_correcciones_ronda_bugs.sql lo creen),
-- la migración ya no falla — las políticas quedan pendientes de crear hasta
-- que ese rol exista y esta migración se vuelva a aplicar (como ya hace
-- 08_correcciones_ronda_bugs.sql, igual que 04_rls.sql reaplica 0002).
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'drop policy if exists "bloquear_anon_efectivo_puesto_fijo" on efectivo_puesto_fijo';
    execute 'create policy "bloquear_anon_efectivo_puesto_fijo" on efectivo_puesto_fijo as restrictive for all to anon using (false) with check (false)';

    execute 'drop policy if exists "bloquear_anon_efectivo_objetivo" on efectivo_objetivo';
    execute 'create policy "bloquear_anon_efectivo_objetivo" on efectivo_objetivo as restrictive for all to anon using (false) with check (false)';

    execute 'drop policy if exists "bloquear_anon_efectivo_objetivo_historial" on efectivo_objetivo_historial';
    execute 'create policy "bloquear_anon_efectivo_objetivo_historial" on efectivo_objetivo_historial as restrictive for all to anon using (false) with check (false)';

    execute 'drop policy if exists "bloquear_anon_whatsapp_avisos" on whatsapp_avisos';
    execute 'create policy "bloquear_anon_whatsapp_avisos" on whatsapp_avisos as restrictive for all to anon using (false) with check (false)';

    execute 'drop policy if exists "bloquear_anon_whatsapp_avisos_historial" on whatsapp_avisos_historial';
    execute 'create policy "bloquear_anon_whatsapp_avisos_historial" on whatsapp_avisos_historial as restrictive for all to anon using (false) with check (false)';
  end if;
end $$;

do $$
declare v_fn text;
begin
  foreach v_fn in array array[
    'fn_whatsapp_sincronizar_tras_publicar(text,int,int)',
    'fn_whatsapp_marcar_abierto(text,text,int,int,text)',
    'fn_whatsapp_confirmar_envio(text,text,int,int,text)',
    'fn_whatsapp_desmarcar(text,text,int,int,text)',
    'fn_publicar_guardias_y_sincronizar_whatsapp(text,int,int,text[],text,int,text)',
    'fn_guardar_puesto_fijo(text,text,text,text,text)',
    'fn_guardar_objetivo(text,text,text,numeric,text,text)',
    'fn_desactivar_objetivo(bigint,text,text)'
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

-- Nota (igual que en 0002): en una base de prueba sin los roles anon/
-- authenticated/service_role (como polad_test fuera de tests/pg/04_rls.sql)
-- los revoke/grant de arriba están detrás de "if exists" para no fallar por
-- un rol inexistente. Contra el proyecto Supabase real, los tres roles
-- siempre existen.
-- ============================================================================
