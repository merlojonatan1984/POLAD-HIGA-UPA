-- tests/pg/09_correcciones_ronda3.sql
--
-- Pruebas SQL reales (PostgreSQL 16, mismo esquema que 02/05/08) para la
-- "Falla 3" de la tercera ronda de correcciones ("Confirmación de
-- WhatsApp"), resuelta en supabase/migrations/0006_correcciones_ronda3.sql:
-- tanto "abrir" como "confirmar" ahora exigen el fingerprint del contenido
-- que el NAVEGADOR efectivamente preparó, no solo fotografiar a ciegas el
-- fingerprint vigente del servidor.
--
-- Este archivo cubre, con casos SECUENCIALES (determinísticos, sin
-- necesitar dos conexiones reales — eso se prueba aparte, ver
-- tests/pg/10_correcciones_ronda3_concurrencia.js):
--   A) "Pantalla con versión anterior, nueva publicación, y apertura del
--      mensaje": el navegador cargó el contenido de la publicación v1;
--      después se publica v2 (cambia el contenido); si el administrador
--      intenta ABRIR el mensaje sin haber recargado la pantalla (manda el
--      fingerprint de v1), la apertura se RECHAZA — nunca registra el
--      contenido nuevo como comunicado mediante un mensaje viejo.
--   B) "Dos pestañas con mensajes de versiones distintas": una pestaña
--      recargó y abrió el mensaje con el contenido vigente (v2); otra
--      pestaña, que nunca recargó, intenta CONFIRMAR directamente con el
--      fingerprint viejo (v1) que todavía tiene cargado — se rechaza,
--      aunque la fila sí tenga una apertura válida y reciente (fingerprint_
--      en_apertura = v2): el fingerprint que manda el cliente al confirmar
--      también tiene que coincidir con lo vigente, no solo lo que se abrió.
--
-- Se corre DESPUÉS de 00_esquema_base_ficticio.sql + 0001 + 01_seed_ficticio.sql
-- + 0004 + 0005 + 0006, en la misma base que ya corrieron 02/04/05/06/08 —
-- usa su propio scope (lugar UPA, mes=6, anio=2099, legajo 900401) para no
-- interferir con lo que esos otros archivos ya dejaron escrito.

\set ON_ERROR_STOP on

-- ----------------------------------------------------------------------------
-- A) Pantalla desactualizada + nueva publicación + apertura del mensaje.
-- ----------------------------------------------------------------------------
do $$
declare
  v_fp_v1 text; v_fp_v2 text;
  v_version int;
  v_fallo boolean := false; v_msg text;
  v_fila whatsapp_avisos;
begin
  -- v1: una sola guardia publicada para 900401.
  insert into turnos (legajo, dia, turno, sector, mes, anio) values ('900401', 1, 'd', 'UPA', 6, 2099);
  select version into v_version
    from fn_publicar_guardias_y_sincronizar_whatsapp('UPA', 6, 2099, array['UPA'], 'ADMIN1', 0, fn_hash_borrador_turnos(6, 2099, array['UPA']));
  if v_version <> 1 then raise exception 'FALLO: esperaba version=1, llegó %', v_version; end if;

  select fingerprint_turnos into v_fp_v1 from whatsapp_avisos where legajo='900401' and lugar='UPA' and mes=6 and anio=2099;

  -- El navegador del administrador carga la pantalla EN ESTE MOMENTO: lo
  -- que tiene en memoria para armar el link de wa.me es v_fp_v1.

  -- Antes de que el administrador llegue a hacer click en "Enviar por
  -- WhatsApp", se publica una v2 que cambia el contenido de 900401 (se le
  -- agrega una guardia) — la pantalla del administrador sigue mostrando v1,
  -- sin recargar.
  insert into turnos (legajo, dia, turno, sector, mes, anio) values ('900401', 2, 'n', 'UPA', 6, 2099);
  select version into v_version
    from fn_publicar_guardias_y_sincronizar_whatsapp('UPA', 6, 2099, array['UPA'], 'ADMIN1', 1, fn_hash_borrador_turnos(6, 2099, array['UPA']));
  if v_version <> 2 then raise exception 'FALLO: esperaba version=2, llegó %', v_version; end if;

  select fingerprint_turnos into v_fp_v2 from whatsapp_avisos where legajo='900401' and lugar='UPA' and mes=6 and anio=2099;
  if v_fp_v2 = v_fp_v1 then raise exception 'FALLO precondición: el fingerprint de v2 debía ser distinto al de v1'; end if;

  -- El administrador, con la pantalla todavía desactualizada (v1), hace
  -- click en "Enviar por WhatsApp" — el navegador manda v_fp_v1 al abrir.
  -- Tiene que RECHAZARSE (nunca fotografiar a ciegas el fingerprint vigente
  -- del servidor como si fuera lo que el navegador preparó).
  begin
    perform fn_whatsapp_marcar_abierto('900401', 'UPA', 6, 2099, v_fp_v1, 'ADMIN1');
  exception when others then
    v_fallo := true; v_msg := sqlerrm;
  end;
  if not v_fallo then raise exception 'FALLO: debía rechazar "abrir" con el fingerprint de una pantalla desactualizada (v1), estando vigente v2'; end if;
  if v_msg not ilike '%contenido_desactualizado%' then
    raise exception 'FALLO: motivo de rechazo incorrecto al abrir con pantalla desactualizada: %', v_msg;
  end if;

  select * into v_fila from whatsapp_avisos where legajo='900401' and lugar='UPA' and mes=6 and anio=2099;
  if v_fila.fingerprint_en_apertura is not null or v_fila.abierto_en is not null then
    raise exception 'FALLO: la apertura rechazada NO debía registrar nada (fingerprint_en_apertura/abierto_en debían seguir null)';
  end if;
  raise notice 'OK - fn_whatsapp_marcar_abierto: RECHAZA abrir el mensaje cuando el fingerprint que manda el navegador (pantalla vieja, v1) no coincide con el contenido publicado vigente (v2) — no registra nada, nunca "comunica contenido nuevo mediante un mensaje viejo"';

  -- El administrador recarga la pantalla de Personal (ahora su navegador
  -- tiene v2 cargado) y vuelve a intentar abrir — con el fingerprint
  -- correcto, ahora sí se registra.
  v_fallo := false;
  select * into v_fila from fn_whatsapp_marcar_abierto('900401', 'UPA', 6, 2099, v_fp_v2, 'ADMIN1');
  if v_fila.fingerprint_en_apertura is distinct from v_fp_v2 then
    raise exception 'FALLO: tras recargar con el contenido vigente (v2), fn_whatsapp_marcar_abierto debía registrar fingerprint_en_apertura=%, quedó %', v_fp_v2, v_fila.fingerprint_en_apertura;
  end if;
  raise notice 'OK - fn_whatsapp_marcar_abierto: tras recargar la pantalla (fingerprint del cliente = contenido vigente v2), la apertura se registra con normalidad';
end $$;

-- ----------------------------------------------------------------------------
-- B) Dos pestañas con mensajes de versiones distintas: una ya recargó y
-- abrió con el contenido vigente; la otra, que nunca recargó, intenta
-- confirmar directo con el fingerprint viejo que todavía tiene en memoria.
-- ----------------------------------------------------------------------------
do $$
declare
  v_fp_v1 text; v_fp_v2 text;
  v_fallo boolean := false; v_msg text;
  v_fila whatsapp_avisos;
begin
  -- Continúa el escenario de A): 900401 está "abierto" con el fingerprint
  -- vigente (v2) — fingerprint_en_apertura = v_fp_v2 = fingerprint_turnos.
  select fingerprint_turnos into v_fp_v2 from whatsapp_avisos where legajo='900401' and lugar='UPA' and mes=6 and anio=2099;

  -- v_fp_v1 (el que la "pestaña 2" todavía tiene en memoria, de ANTES de
  -- que se publicara v2) se recalcula igual que en A) para esta prueba.
  v_fp_v1 := (select string_agg(dia::text || '-' || turno || '-' || sector, ',' order by dia, turno, sector)
              from turnos_publicados
             where publicacion_id = (select id from publicaciones where lugar='UPA' and mes=6 and anio=2099 and version=1)
               and legajo='900401');

  if v_fp_v1 = v_fp_v2 then raise exception 'FALLO precondición: los dos fingerprints de esta prueba deben ser distintos'; end if;

  -- "Pestaña 2": nunca recargó, intenta CONFIRMAR directo (sin volver a
  -- abrir) mandando el fingerprint viejo (v1) que su propio navegador tiene
  -- en memoria. Aunque la fila SÍ tiene una apertura válida y vigente
  -- (fingerprint_en_apertura = v_fp_v2, de la "pestaña 1" en A), el
  -- fingerprint que ESTA pestaña manda al confirmar (v1) no coincide con lo
  -- vigente — tiene que rechazarse igual (segunda validación de
  -- fn_whatsapp_confirmar_envio, independiente de la primera).
  begin
    perform fn_whatsapp_confirmar_envio('900401', 'UPA', 6, 2099, v_fp_v1, 'ADMIN1');
  exception when others then
    v_fallo := true; v_msg := sqlerrm;
  end;
  if not v_fallo then raise exception 'FALLO: debía rechazar "confirmar" cuando el fingerprint del cliente (pestaña vieja, v1) no coincide con el vigente (v2), aunque la apertura registrada SÍ sea la vigente'; end if;
  if v_msg not ilike '%contenido_cambio_desde_apertura%' then
    raise exception 'FALLO: motivo de rechazo incorrecto (dos pestañas, fingerprint de cliente desactualizado al confirmar): %', v_msg;
  end if;

  select * into v_fila from whatsapp_avisos where legajo='900401' and lugar='UPA' and mes=6 and anio=2099;
  if v_fila.estado = 'confirmado' then
    raise exception 'FALLO: no debía quedar confirmado tras el intento de la pestaña con el contenido viejo';
  end if;
  raise notice 'OK - fn_whatsapp_confirmar_envio: rechaza confirmar si el fingerprint que manda ESTA pestaña (contenido viejo, v1) no coincide con lo vigente (v2), aunque la fila tenga una apertura reciente y válida de OTRA pestaña — nunca se confirma "a ciegas" lo que el servidor ya tenía abierto sin que la pantalla que confirma esté mostrando ese mismo contenido';

  -- "Pestaña 1" (la que sí tiene el contenido vigente cargado) confirma con
  -- normalidad.
  select * into v_fila from fn_whatsapp_confirmar_envio('900401', 'UPA', 6, 2099, v_fp_v2, 'ADMIN1');
  if v_fila.estado <> 'confirmado' then raise exception 'FALLO: la pestaña con el contenido vigente debía poder confirmar con normalidad'; end if;
  raise notice 'OK - fn_whatsapp_confirmar_envio: la pestaña con el contenido vigente (v2, igual a lo abierto y a lo publicado) confirma sin problema';
end $$;

do $$ begin
  raise notice '=== TODAS LAS PRUEBAS DE LA FALLA 3 ("Confirmación de WhatsApp", secuenciales) PASARON ===';
end $$;
