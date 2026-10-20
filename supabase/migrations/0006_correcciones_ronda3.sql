-- ============================================================================
-- POLAD — 0006: tercera ronda de correcciones, sobre los 3 errores que
-- quedaron reportados después de revisar la entrega de 0005 (puesto fijo en
-- 24hs/pareja, reporte de objetivo, confirmación de WhatsApp). Migración
-- ADITIVA — no modifica ningún dato existente. Donde el COMPORTAMIENTO de
-- una función de 0005 cambia sin cambiar su firma, se usa `create or
-- replace function` (0005 queda intacto en el historial, esta es la
-- versión vigente). Donde la firma necesita un parámetro nuevo
-- (fn_whatsapp_marcar_abierto y fn_whatsapp_confirmar_envio, que ahora
-- reciben el fingerprint del contenido preparado por el cliente), se hace
-- `drop function` de la firma anterior y `create function` de la nueva —
-- mismo criterio que ya documentó 0005 para sus propios cambios de firma.
--
-- Alcance: ÚNICAMENTE los 3 errores de esta ronda. No se tocó
-- fn_guardar_puesto_fijo, fn_guardar_objetivo, fn_desactivar_objetivo,
-- fn_admin_guardar_efectivo, fn_publicar_guardias (se la deja intacta y
-- envuelta, no se edita), ni las tablas/RLS de 0001-0005. El punto 1
-- (puesto fijo en 24hs/pareja) y el punto 2 (reporte de objetivo) de esta
-- ronda son 100% JavaScript (lib/asignacionRapidaFlujo.js + pages/admin.js)
-- — no requieren ningún cambio de SQL, por eso este archivo solo cubre el
-- punto 3 (confirmación de WhatsApp).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- ERROR 3: "Confirmación de WhatsApp"
--
-- El enlace de wa.me se construye en el NAVEGADOR, con los turnos que el
-- navegador tiene cargados en ese momento (turnosPublicadosPorLegajo). Pero
-- `fn_whatsapp_marcar_abierto` (0005) fotografiaba el fingerprint VIGENTE
-- del SERVIDOR al momento de abrir, sin recibir ninguna identificación del
-- contenido que el navegador efectivamente estaba a punto de enviar. Si la
-- pantalla estaba desactualizada (alguien publicó guardias nuevas después
-- de que el navegador cargó las suyas, pero antes de que el administrador
-- hiciera click en "Enviar por WhatsApp"), el mensaje REAL enviado era
-- VIEJO, pero el servidor registraba como "abierto" el fingerprint NUEVO
-- (porque es lo único que conocía) — exactamente "registrar el contenido
-- nuevo como comunicado mediante un mensaje viejo".
--
-- Corrección: tanto "abrir" como "confirmar" ahora reciben, además de
-- legajo/lugar/mes/año, el fingerprint del contenido que el NAVEGADOR
-- preparó (mismo algoritmo que fingerprint_turnos — ver la función
-- fingerprintTurnos agregada en pages/admin.js). Si ese fingerprint no
-- coincide con el fingerprint_turnos VIGENTE del servidor, la operación se
-- RECHAZA (nunca se registra nada) y se le pide al administrador recargar
-- la pantalla antes de reintentar — "actualizá el mensaje antes de abrirlo
-- o rechazá la apertura y pedí recargarlo", tal como se pidió. Esto vincula
-- tanto la apertura como la confirmación al contenido EXACTO del mensaje
-- preparado, nunca solo al que el servidor tenía guardado de antes.
--
-- Además, ambas funciones ahora toman el lock de la fila (FOR UPDATE) ANTES
-- de decidir nada, y fn_whatsapp_sincronizar_tras_publicar (que corre
-- dentro de la misma transacción que la publicación, ver
-- fn_publicar_guardias_y_sincronizar_whatsapp de 0005) hace lo mismo al leer
-- la fila que va a escribir. Así, una publicación simultánea y una
-- confirmación sobre el mismo efectivo/lugar/mes/año quedan SERIALIZADAS
-- por Postgres: la que llega segunda ve los datos ya escritos por la
-- primera, nunca una lectura a medio camino. Sin este lock, era posible
-- que "confirmar" LEYERA el estado todavía sin cambios justo antes de que
-- una publicación lo modificara, y ESCRIBIERA "confirmado" después de que
-- la publicación ya había resetado el aviso — dejando confirmado un
-- contenido que ya no es el vigente. Esto es exactamente "coordinar la
-- validación y escritura de la confirmación con la publicación/
-- sincronización para evitar que una publicación simultánea deje
-- confirmado un contenido distinto".
-- ----------------------------------------------------------------------------

drop function if exists fn_whatsapp_marcar_abierto(text, text, int, int, text);

create function fn_whatsapp_marcar_abierto(
  p_legajo text,
  p_lugar text,
  p_mes int,
  p_anio int,
  p_fingerprint_cliente text,
  p_actor_legajo text
)
returns whatsapp_avisos
language plpgsql
as $$
declare
  v_fila whatsapp_avisos;
begin
  -- Lock de fila antes de decidir nada (ver nota de coordinación arriba).
  select * into v_fila
    from whatsapp_avisos
   where legajo = p_legajo and lugar = p_lugar and mes = p_mes and anio = p_anio
   for update;

  if v_fila.id is null then
    raise exception using errcode = 'P0001', message = 'no_existe_aviso';
  end if;

  -- Si ya estaba confirmado, abrir de nuevo no cambia nada (mismo
  -- comportamiento que ya tenía esta función en 0005) — no hace falta
  -- validar contenido para un no-op que no va a escribir nada.
  if v_fila.estado = 'confirmado' then
    return v_fila;
  end if;

  if p_fingerprint_cliente is distinct from v_fila.fingerprint_turnos then
    raise exception using
      errcode = 'P0001',
      message = 'contenido_desactualizado',
      detail = 'El mensaje que se preparó en la pantalla no coincide con el cronograma publicado vigente — recargá la pantalla (las guardias publicadas cambiaron) antes de abrir el mensaje de WhatsApp.';
  end if;

  update whatsapp_avisos
     set abierto_en = now(),
         abierto_por_legajo = p_actor_legajo,
         fingerprint_en_apertura = p_fingerprint_cliente,
         actualizado_en = now()
   where id = v_fila.id
  returning * into v_fila;

  return v_fila;
end;
$$;

comment on function fn_whatsapp_marcar_abierto(text, text, int, int, text, text) is
  'Registra que se abrió el link de WhatsApp (abrir no es enviar) SOLO si el fingerprint que manda el cliente (el contenido que el navegador efectivamente preparó) coincide con el fingerprint_turnos vigente del servidor — si la pantalla está desactualizada, rechaza con "contenido_desactualizado" en vez de fotografiar a ciegas el fingerprint del servidor (eso es lo que permitía registrar contenido nuevo como comunicado mediante un mensaje viejo armado con datos viejos). No cambia nada si el aviso ya estaba confirmado.';

drop function if exists fn_whatsapp_confirmar_envio(text, text, int, int, text);

create function fn_whatsapp_confirmar_envio(
  p_legajo text,
  p_lugar text,
  p_mes int,
  p_anio int,
  p_fingerprint_cliente text,
  p_actor_legajo text
)
returns whatsapp_avisos
language plpgsql
as $$
declare
  v_fila whatsapp_avisos;
begin
  -- Lock de fila antes de decidir nada (ver nota de coordinación arriba) —
  -- esto es lo que serializa esta confirmación contra una publicación
  -- simultánea para el mismo efectivo/lugar/mes/año.
  select * into v_fila
    from whatsapp_avisos
   where legajo = p_legajo and lugar = p_lugar and mes = p_mes and anio = p_anio
   for update;

  if v_fila.id is null then
    raise exception using errcode = 'P0001', message = 'no_existe_aviso';
  end if;

  if v_fila.fingerprint_en_apertura is null or v_fila.fingerprint_en_apertura is distinct from v_fila.fingerprint_turnos then
    raise exception using
      errcode = 'P0001',
      message = 'contenido_cambio_desde_apertura',
      detail = 'El cronograma publicado para este efectivo cambió (o todavía no se abrió el mensaje con el contenido actual) desde la última vez que se abrió WhatsApp — hay que volver a abrirlo con el contenido vigente antes de poder confirmar el envío.';
  end if;

  -- Además de que lo abierto coincida con lo vigente, el contenido que la
  -- PANTALLA que confirma dice estar confirmando también tiene que
  -- coincidir con lo vigente — nunca se confirma "a ciegas" lo que el
  -- servidor tenía guardado sin que la pantalla que hace click en
  -- "Confirmar que lo envié" esté mostrando ese mismo contenido (dos
  -- pestañas con mensajes de versiones distintas, por ejemplo).
  if p_fingerprint_cliente is distinct from v_fila.fingerprint_turnos then
    raise exception using
      errcode = 'P0001',
      message = 'contenido_cambio_desde_apertura',
      detail = 'El mensaje que se está confirmando no coincide con el cronograma publicado vigente — recargá la pantalla antes de confirmar el envío.';
  end if;

  update whatsapp_avisos
     set estado = 'confirmado', confirmado_en = now(), confirmado_por_legajo = p_actor_legajo, actualizado_en = now()
   where id = v_fila.id
  returning * into v_fila;

  return v_fila;
end;
$$;

comment on function fn_whatsapp_confirmar_envio(text, text, int, int, text, text) is
  'Confirma el envío SOLO si (a) lo último que se abrió (fingerprint_en_apertura) coincide con el contenido publicado vigente (fingerprint_turnos) y (b) el fingerprint que manda el cliente (lo que la pantalla que confirma está mostrando) también coincide con lo vigente — toma el lock de la fila antes de validar nada, para quedar serializada contra una publicación simultánea. Si cualquiera de las dos condiciones falla, rechaza con "contenido_cambio_desde_apertura" en vez de confirmar un cronograma desactualizado o distinto del que la pantalla muestra.';

-- fn_whatsapp_sincronizar_tras_publicar: misma firma que 0005 (text, int,
-- int) — se reemplaza en el lugar. Único cambio: el SELECT de la fila
-- existente ahora toma su lock (FOR UPDATE) antes de decidir si hubo
-- cambio real, para quedar coordinada con fn_whatsapp_confirmar_envio y
-- fn_whatsapp_marcar_abierto (ver nota de coordinación arriba). El resto de
-- la lógica (comparar contra lo YA GUARDADO, universo de legajos por
-- unión, etc.) es exactamente la de 0005, sin cambios.
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

    -- Corrección de esta ronda: FOR UPDATE — ver nota de coordinación en
    -- el encabezado de este archivo.
    select * into v_fila_actual
      from whatsapp_avisos
     where legajo = r.legajo and lugar = p_lugar and mes = p_mes and anio = p_anio
     for update;
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
      update whatsapp_avisos
         set publicacion_id = v_nueva_id, actualizado_en = now()
       where legajo = r.legajo and lugar = p_lugar and mes = p_mes and anio = p_anio;
    end if;
  end loop;

  return v_cambiados;
end;
$$;

comment on function fn_whatsapp_sincronizar_tras_publicar(text, int, int) is
  'Llamar después de cada publicación exitosa (ver fn_publicar_guardias_y_sincronizar_whatsapp). Compara el fingerprint nuevo contra el YA GUARDADO en whatsapp_avisos (no contra la publicación anterior), tomando el lock de cada fila antes de decidir (coordinación con confirmar/abrir): resetea a pendiente SOLO los efectivos cuyo contenido realmente cambió respecto de lo último sincronizado (incluye quedar en cero guardias), y es un no-op para quien no cambió.';

-- ----------------------------------------------------------------------------
-- Protección de las dos funciones con firma nueva — mismo criterio que
-- 0005 (EXECUTE revocado de PUBLIC/anon/authenticated, otorgado solo a
-- service_role). Al ser objetos NUEVOS (firma distinta a la de 0005),
-- Postgres les da el EXECUTE por defecto a PUBLIC otra vez — hay que
-- revocarlo de nuevo para estas dos firmas específicamente.
-- fn_whatsapp_sincronizar_tras_publicar no cambió de firma: conserva los
-- permisos que ya le dio 0005 (create or replace sobre el mismo objeto).
-- ----------------------------------------------------------------------------

do $$
declare v_fn text;
begin
  foreach v_fn in array array[
    'fn_whatsapp_marcar_abierto(text,text,int,int,text,text)',
    'fn_whatsapp_confirmar_envio(text,text,int,int,text,text)'
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

-- Nota (igual que en 0002/0005): en una base de prueba sin los roles
-- anon/authenticated/service_role los revoke/grant de arriba están detrás
-- de "if exists" para no fallar por un rol inexistente. Contra el proyecto
-- Supabase real, los tres roles siempre existen.
-- ============================================================================
