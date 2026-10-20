-- tests/pg/08_correcciones_ronda_bugs.sql
--
-- Pruebas SQL reales (PostgreSQL 16, mismo esquema que 02/05) para lo
-- agregado por supabase/migrations/0005_correcciones_ronda_bugs.sql: el
-- guardado transaccional de puesto fijo y objetivo (fn_guardar_puesto_fijo,
-- fn_guardar_objetivo, fn_desactivar_objetivo), las correcciones de
-- WhatsApp (fn_whatsapp_marcar_abierto, fn_whatsapp_confirmar_envio exige
-- que el contenido no haya cambiado desde que se abrió, la sincronización
-- ahora idempotente y que detecta "guardias retiradas a cero",
-- fn_publicar_guardias_y_sincronizar_whatsapp atómica), y RLS/EXECUTE sobre
-- las tablas y funciones nuevas de 0004 (que 0004 nunca protegió).
--
-- Se corre DESPUÉS de 00_esquema_base_ficticio.sql + 0001 + 01_seed_ficticio.sql
-- + 0004 + 0005, en la misma base que ya corrieron 02/04/05/06 — usa su
-- propio scope (lugar UPA, mes=4, anio=2099, y legajos 900301+) para no
-- interferir con lo que esos otros archivos ya dejaron escrito.
--
-- NOTA sobre lo que NO se puede probar así: la llamada HTTP real a
-- pages/api/admin-reglas-puesto.js / admin-reglas-objetivo.js / whatsapp-
-- avisos.js / publicar-guardias.js (que ahora llaman a estas funciones vía
-- supabase.rpc(...) en vez de los pasos sueltos de antes) no se ejecuta
-- acá — este archivo prueba las funciones SQL que esos endpoints invocan,
-- no el endpoint HTTP en sí (ver tests/README.md, sección "Qué no cubren
-- estas pruebas").

\set ON_ERROR_STOP on

-- ----------------------------------------------------------------------------
-- 1) fn_guardar_puesto_fijo — guardado atómico. Camino feliz, y: si falla
-- (acá, una violación de NOT NULL en el paso de INSERT final, simulando
-- cualquier fallo real en ese paso), la regla ANTERIOR sigue activa
-- exactamente como estaba — nunca queda el efectivo sin ninguna.
-- ----------------------------------------------------------------------------
do $$
declare v_fila efectivo_puesto_fijo;
begin
  select * into v_fila from fn_guardar_puesto_fijo('900301', 'UPA', 'UPA', 'd', 'ADMIN1');
  if v_fila.sector <> 'UPA' or v_fila.activo <> true then
    raise exception 'FALLO: fn_guardar_puesto_fijo no devolvió la fila activa esperada';
  end if;
  if (select count(*) from efectivo_puesto_fijo where legajo='900301' and lugar='UPA' and activo) <> 1 then
    raise exception 'FALLO: debía quedar exactamente 1 puesto fijo activo';
  end if;
  raise notice 'OK - fn_guardar_puesto_fijo: alta feliz en una sola llamada atómica (antes eran 2 pasos sueltos: desactivar + insertar)';
end $$;

do $$
declare v_fallo boolean := false; v_sector_antes text; v_sector_despues text; v_id_antes bigint;
begin
  select sector, id into v_sector_antes, v_id_antes from efectivo_puesto_fijo where legajo='900301' and lugar='UPA' and activo;

  begin
    -- p_sector = null viola la columna NOT NULL en el INSERT final de la
    -- función — simula cualquier fallo real en ese último paso (red,
    -- timeout, restricción) DESPUÉS de que la función ya desactivó la
    -- regla anterior.
    perform fn_guardar_puesto_fijo('900301', 'UPA', null, 'n', 'ADMIN1');
  exception when others then
    v_fallo := true;
  end;
  if not v_fallo then raise exception 'FALLO: la prueba no forzó el error esperado en el paso de inserción'; end if;

  select sector into v_sector_despues from efectivo_puesto_fijo where legajo='900301' and lugar='UPA' and activo;
  if v_sector_despues is distinct from v_sector_antes then
    raise exception 'FALLO: la regla anterior (%) no siguió activa tras el fallo (quedó: %)', v_sector_antes, v_sector_despues;
  end if;
  if (select id from efectivo_puesto_fijo where legajo='900301' and lugar='UPA' and activo) <> v_id_antes then
    raise exception 'FALLO: debía seguir activa la MISMA fila (mismo id), no una desactivada y re-creada a medias';
  end if;
  if (select count(*) from efectivo_puesto_fijo where legajo='900301' and lugar='UPA' and activo) <> 1 then
    raise exception 'FALLO: debía quedar exactamente 1 regla activa tras el fallo (nunca 0: "nunca dejar al efectivo sin configuración")';
  end if;
  raise notice 'OK - fn_guardar_puesto_fijo: si falla el paso de inserción, la desactivación previa (ya ejecutada dentro de la misma función) también se revierte — la regla anterior sigue activa, exactamente la misma fila, nunca queda el efectivo sin ninguna';
end $$;

-- ----------------------------------------------------------------------------
-- 2) fn_guardar_objetivo — mismo criterio: feliz, y atomicidad ante fallo
-- (acá, un p_tipo inválido que viola el CHECK de la tabla en el INSERT
-- final) — el objetivo anterior sigue activo, y el historial NO queda con
-- una fila de un cambio que nunca se completó.
-- ----------------------------------------------------------------------------
do $$
declare v_fila efectivo_objetivo;
begin
  select * into v_fila from fn_guardar_objetivo('900302', 'UPA', 'guardias', 4, 'ambos', 'ADMIN1');
  if v_fila.cantidad <> 4 or v_fila.activo <> true then
    raise exception 'FALLO: fn_guardar_objetivo no devolvió la fila activa esperada';
  end if;
  if (select count(*) from efectivo_objetivo_historial where legajo='900302' and lugar='UPA' and accion='crear') <> 1 then
    raise exception 'FALLO: debía quedar 1 fila de historial (crear)';
  end if;
  raise notice 'OK - fn_guardar_objetivo: alta feliz en una sola llamada atómica (historial + objetivo activo juntos)';
end $$;

do $$
declare v_fallo boolean := false; v_cantidad_antes numeric; v_hist_count_antes int; v_hist_count_despues int;
begin
  select cantidad into v_cantidad_antes from efectivo_objetivo where legajo='900302' and lugar='UPA' and activo;
  select count(*) into v_hist_count_antes from efectivo_objetivo_historial where legajo='900302' and lugar='UPA';

  begin
    -- 'dias' no es un tipo válido (check (tipo in ('horas','guardias'))) —
    -- falla en el INSERT final, DESPUÉS de que la función ya insertó la
    -- fila de historial y desactivó la regla anterior.
    perform fn_guardar_objetivo('900302', 'UPA', 'dias', 99, 'ambos', 'ADMIN1');
  exception when others then
    v_fallo := true;
  end;
  if not v_fallo then raise exception 'FALLO: la prueba no forzó el error esperado (tipo inválido)'; end if;

  if (select cantidad from efectivo_objetivo where legajo='900302' and lugar='UPA' and activo) <> v_cantidad_antes then
    raise exception 'FALLO: el objetivo anterior (%) no siguió activo tras el fallo', v_cantidad_antes;
  end if;
  select count(*) into v_hist_count_despues from efectivo_objetivo_historial where legajo='900302' and lugar='UPA';
  if v_hist_count_despues <> v_hist_count_antes then
    raise exception 'FALLO: el historial no debía crecer — el intento fallido (incluido su insert de historial, hecho DENTRO de la misma función) tiene que revertirse entero, nunca un registro de un cambio que no se completó';
  end if;
  raise notice 'OK - fn_guardar_objetivo: si falla el paso final de inserción, TODO se revierte — el historial no queda con un registro del intento fallido, y el objetivo anterior sigue activo sin cambios';
end $$;

do $$
declare v_ok boolean;
begin
  select * into v_ok from fn_desactivar_objetivo((select id from efectivo_objetivo where legajo='900302' and lugar='UPA' and activo), 'UPA', 'ADMIN1');
  if v_ok is distinct from true then raise exception 'FALLO: fn_desactivar_objetivo debía devolver true en el caso feliz'; end if;
  if (select count(*) from efectivo_objetivo where legajo='900302' and lugar='UPA' and activo) <> 0 then
    raise exception 'FALLO: no debía quedar ningún objetivo activo para 900302/UPA tras desactivar';
  end if;
  if (select count(*) from efectivo_objetivo_historial where legajo='900302' and lugar='UPA' and accion='desactivar') <> 1 then
    raise exception 'FALLO: debía quedar 1 fila de historial (desactivar)';
  end if;
  raise notice 'OK - fn_desactivar_objetivo: feliz — desactiva y registra el historial en la misma transacción';
end $$;

do $$
declare v_ok boolean;
begin
  select * into v_ok from fn_desactivar_objetivo(999999999, 'UPA', 'ADMIN1');
  if v_ok is distinct from false then raise exception 'FALLO: con un id inexistente debía devolver false (nunca lanzar ni inventar)'; end if;
  raise notice 'OK - fn_desactivar_objetivo: id inexistente devuelve false, sin lanzar excepción ni tocar nada';
end $$;

-- ----------------------------------------------------------------------------
-- 3) WhatsApp — escenario completo en el scope propio (UPA, mes=4,
-- anio=2099): primera publicación, "abrir" fotografía el fingerprint,
-- "confirmar" exige que coincida, idempotencia de la sincronización, y
-- "guardias retiradas a cero".
-- ----------------------------------------------------------------------------
do $$
declare
  v_hash text; v_pub1 bigint; v_version1 int;
begin
  insert into turnos (legajo, dia, turno, sector, mes, anio) values
    ('900303', 1, 'd', 'UPA', 4, 2099),
    ('900304', 2, 'd', 'UPA', 4, 2099);

  v_hash := fn_hash_borrador_turnos(4, 2099, array['UPA']);
  select publicacion_id, version into v_pub1, v_version1
    from fn_publicar_guardias('UPA', 4, 2099, array['UPA'], 'ADMIN1', 0, v_hash);
  if v_version1 <> 1 then raise exception 'FALLO: esperaba version=1 en el scope propio, llegó %', v_version1; end if;

  perform fn_whatsapp_sincronizar_tras_publicar('UPA', 4, 2099);
  if (select count(*) from whatsapp_avisos where lugar='UPA' and mes=4 and anio=2099) <> 2 then
    raise exception 'FALLO: debían quedar 2 filas (900303, 900304)';
  end if;
  raise notice 'OK - escenario WhatsApp (ronda nueva): primera publicación -> 2 avisos "pendiente"';
end $$;

-- 3a) fn_whatsapp_marcar_abierto fotografía el fingerprint actual.
--
-- NOTA sobre esta ronda (ronda 3 — "Confirmación de WhatsApp"): las firmas
-- de fn_whatsapp_marcar_abierto y fn_whatsapp_confirmar_envio cambiaron en
-- supabase/migrations/0006_correcciones_ronda3.sql: ahora reciben también
-- `p_fingerprint_cliente` (el contenido que la pantalla dice estar
-- preparando/confirmando). En esta sección 3 se les sigue pasando el
-- fingerprint VIGENTE correcto en cada paso (el mismo criterio que ya
-- probaba esta sección para 0005) para no cambiar lo que ya cubría; los
-- casos NUEVOS de esta ronda (fingerprint del cliente desactualizado,
-- coordinación con una publicación simultánea) se prueban en
-- tests/pg/09_correcciones_ronda3.sql.
do $$
declare v_fila whatsapp_avisos; v_fp text;
begin
  select fingerprint_turnos into v_fp from whatsapp_avisos where legajo='900303' and lugar='UPA' and mes=4 and anio=2099;
  select * into v_fila from fn_whatsapp_marcar_abierto('900303', 'UPA', 4, 2099, v_fp, 'ADMIN1');
  if v_fila.fingerprint_en_apertura is distinct from v_fp then
    raise exception 'FALLO: fingerprint_en_apertura debía quedar igual al fingerprint_turnos actual (%), quedó %', v_fp, v_fila.fingerprint_en_apertura;
  end if;
  if v_fila.abierto_en is null then raise exception 'FALLO: abierto_en debía quedar seteado'; end if;
  raise notice 'OK - fn_whatsapp_marcar_abierto: guarda una foto del fingerprint vigente en fingerprint_en_apertura (cuando el fingerprint del cliente coincide con el vigente)';
end $$;

-- 3b) Confirmar SIN haber abierto antes (fingerprint_en_apertura null, caso
-- de 900304, que nunca se abrió) debe rechazarse — "no permitir confirmar
-- un mensaje que nunca se abrió con el contenido actual".
do $$
declare v_fallo boolean := false; v_msg text; v_fp text;
begin
  select fingerprint_turnos into v_fp from whatsapp_avisos where legajo='900304' and lugar='UPA' and mes=4 and anio=2099;
  begin
    perform fn_whatsapp_confirmar_envio('900304', 'UPA', 4, 2099, v_fp, 'ADMIN1');
  exception when others then
    v_fallo := true; v_msg := sqlerrm;
  end;
  if not v_fallo then raise exception 'FALLO: debía rechazar confirmar sin haber abierto antes el mensaje con el contenido vigente'; end if;
  if v_msg not ilike '%contenido_cambio_desde_apertura%' then
    raise exception 'FALLO: el mensaje de error debía ser contenido_cambio_desde_apertura, fue: %', v_msg;
  end if;
  raise notice 'OK - fn_whatsapp_confirmar_envio: rechaza confirmar un aviso que nunca se abrió con el contenido vigente (fingerprint_en_apertura null), aunque el fingerprint del cliente sí coincida con el vigente';
end $$;

-- 3c) Confirmar DESPUÉS de abrir, sin que nada haya cambiado, se acepta.
do $$
declare v_fila whatsapp_avisos; v_fp text;
begin
  select fingerprint_turnos into v_fp from whatsapp_avisos where legajo='900303' and lugar='UPA' and mes=4 and anio=2099;
  select * into v_fila from fn_whatsapp_confirmar_envio('900303', 'UPA', 4, 2099, v_fp, 'ADMIN1');
  if v_fila.estado <> 'confirmado' then raise exception 'FALLO: debía quedar confirmado'; end if;
  raise notice 'OK - fn_whatsapp_confirmar_envio: confirma sin problema cuando el contenido abierto y el del cliente coinciden con el vigente';
end $$;

-- 3d) El caso reportado: se abre el mensaje, LUEGO cambian las guardias
-- publicadas de ese mismo efectivo (nueva publicación), y entonces
-- confirmar ESE mensaje viejo debe rechazarse — "no permitir confirmar ese
-- mensaje viejo como aviso del cronograma nuevo".
do $$
declare v_hash text; v_version2 int; v_fallo boolean := false; v_msg text; v_fp_viejo text; v_fp_nuevo text;
begin
  select fingerprint_turnos into v_fp_viejo from whatsapp_avisos where legajo='900304' and lugar='UPA' and mes=4 and anio=2099;
  perform fn_whatsapp_marcar_abierto('900304', 'UPA', 4, 2099, v_fp_viejo, 'ADMIN1'); -- ahora sí abre, con el contenido actual (día 2)

  -- Cambian las guardias publicadas de 900304 (se agrega un turno nuevo).
  insert into turnos (legajo, dia, turno, sector, mes, anio) values ('900304', 5, 'n', 'UPA', 4, 2099);
  v_hash := fn_hash_borrador_turnos(4, 2099, array['UPA']);
  select version into v_version2 from fn_publicar_guardias('UPA', 4, 2099, array['UPA'], 'ADMIN1', 1, v_hash);
  if v_version2 <> 2 then raise exception 'FALLO: esperaba version=2, llegó %', v_version2; end if;
  perform fn_whatsapp_sincronizar_tras_publicar('UPA', 4, 2099); -- esto resetea fingerprint_en_apertura a null para 900304 (volvió a pendiente)

  -- Si por lo que sea se intentara confirmar ESE mensaje viejo (abierto
  -- antes del cambio) — se manda a propósito el fingerprint VIEJO
  -- (v_fp_viejo, lo que esa pantalla desactualizada todavía cree estar
  -- comunicando) — con fingerprint_en_apertura ya en null tras el reset,
  -- confirmar sigue rechazado — nunca se "arrastra" la apertura vieja ni
  -- el contenido viejo como si fueran del contenido nuevo.
  begin
    perform fn_whatsapp_confirmar_envio('900304', 'UPA', 4, 2099, v_fp_viejo, 'ADMIN1');
  exception when others then
    v_fallo := true; v_msg := sqlerrm;
  end;
  if not v_fallo then raise exception 'FALLO: debía rechazar confirmar el mensaje viejo (contenido cambiado desde que se abrió)'; end if;
  if v_msg not ilike '%contenido_cambio_desde_apertura%' then
    raise exception 'FALLO: motivo de rechazo incorrecto: %', v_msg;
  end if;
  raise notice 'OK - fn_whatsapp_confirmar_envio: si las guardias cambiaron después de abrir el mensaje (nueva publicación), confirmar ese mensaje viejo (con su fingerprint viejo) se rechaza — nunca queda aceptado como aviso del cronograma nuevo';

  -- Abriendo de nuevo (ahora con el contenido vigente, día 2 + día 5) sí
  -- permite confirmar.
  select fingerprint_turnos into v_fp_nuevo from whatsapp_avisos where legajo='900304' and lugar='UPA' and mes=4 and anio=2099;
  perform fn_whatsapp_marcar_abierto('900304', 'UPA', 4, 2099, v_fp_nuevo, 'ADMIN1');
  perform fn_whatsapp_confirmar_envio('900304', 'UPA', 4, 2099, v_fp_nuevo, 'ADMIN1');
  if (select estado from whatsapp_avisos where legajo='900304' and lugar='UPA' and mes=4 and anio=2099) <> 'confirmado' then
    raise exception 'FALLO: tras reabrir con el contenido vigente, confirmar debía aceptarse';
  end if;
  raise notice 'OK - fn_whatsapp_confirmar_envio: reabriendo el mensaje con el contenido vigente, confirmar se acepta con normalidad';
end $$;

-- 3e) Idempotencia: repetir fn_whatsapp_sincronizar_tras_publicar para la
-- MISMA publicación vigente (sin publicar de nuevo entre medio) NO debe
-- resetear una confirmación hecha después de la última sincronización real.
do $$
declare v_estado_antes text; v_estado_despues text; v_hist_count_antes int; v_hist_count_despues int;
begin
  select estado into v_estado_antes from whatsapp_avisos where legajo='900304' and lugar='UPA' and mes=4 and anio=2099;
  if v_estado_antes <> 'confirmado' then raise exception 'FALLO: precondición — 900304 debía estar confirmado (ver 3d)'; end if;
  select count(*) into v_hist_count_antes from whatsapp_avisos_historial where legajo='900304' and lugar='UPA' and mes=4 and anio=2099;

  -- Se llama de nuevo, para el MISMO vigente (no se publicó nada nuevo
  -- desde la última vez) — simula un reintento, o quedar integrada en
  -- fn_publicar_guardias_y_sincronizar_whatsapp (que puede llamarse más de
  -- una vez para el mismo scope sin que nada nuevo se haya publicado).
  perform fn_whatsapp_sincronizar_tras_publicar('UPA', 4, 2099);
  perform fn_whatsapp_sincronizar_tras_publicar('UPA', 4, 2099);
  perform fn_whatsapp_sincronizar_tras_publicar('UPA', 4, 2099);

  select estado into v_estado_despues from whatsapp_avisos where legajo='900304' and lugar='UPA' and mes=4 and anio=2099;
  if v_estado_despues <> 'confirmado' then
    raise exception 'FALLO: repetir la sincronización para la MISMA publicación vigente NO debía borrar la confirmación recién hecha (quedó: %)', v_estado_despues;
  end if;
  select count(*) into v_hist_count_despues from whatsapp_avisos_historial where legajo='900304' and lugar='UPA' and mes=4 and anio=2099;
  if v_hist_count_despues <> v_hist_count_antes then
    raise exception 'FALLO: repetir la sincronización sin cambios reales no debía generar historial nuevo (antes: %, después: %)', v_hist_count_antes, v_hist_count_despues;
  end if;
  raise notice 'OK - fn_whatsapp_sincronizar_tras_publicar: repetir la sincronización para la misma publicación vigente (sin publicar de nuevo) es un no-op — nunca vuelve a resetear una confirmación válida';
end $$;

-- 3f) "Permitir comunicar que se retiraron todas las guardias de un
-- efectivo": si un efectivo queda con CERO guardias en la publicación
-- nueva (tenía, y se le sacaron todas), su aviso vuelve a pendiente igual
-- que cualquier cambio real — nunca deja de aparecer en el universo de la
-- sincronización por tener 0 filas en turnos_publicados.
do $$
declare v_hash text; v_version3 int; v_estado text; v_fp text; v_fp_900303 text;
begin
  select fingerprint_turnos into v_fp_900303 from whatsapp_avisos where legajo='900303' and lugar='UPA' and mes=4 and anio=2099;
  -- Confirmar primero el aviso de 900303 (tiene 1 guardia, día 1) para
  -- probar que, al perderla, el aviso se resetea igual que cualquier otro
  -- cambio de contenido (y no queda "confirmado" apuntando a algo que ya no existe).
  perform fn_whatsapp_marcar_abierto('900303', 'UPA', 4, 2099, v_fp_900303, 'ADMIN1');
  -- (900303 ya estaba confirmado desde 3c; reabrir no lo cambia porque
  -- fn_whatsapp_marcar_abierto no toca un aviso ya confirmado — se
  -- desmarca manualmente para dejar el escenario limpio y volver a confirmarlo)
  perform fn_whatsapp_desmarcar('900303', 'UPA', 4, 2099, 'ADMIN1');
  perform fn_whatsapp_marcar_abierto('900303', 'UPA', 4, 2099, v_fp_900303, 'ADMIN1');
  perform fn_whatsapp_confirmar_envio('900303', 'UPA', 4, 2099, v_fp_900303, 'ADMIN1');

  -- Se retira la ÚNICA guardia de 900303 del borrador y se publica de nuevo.
  delete from turnos where legajo='900303' and mes=4 and anio=2099;
  v_hash := fn_hash_borrador_turnos(4, 2099, array['UPA']);
  select version into v_version3 from fn_publicar_guardias('UPA', 4, 2099, array['UPA'], 'ADMIN1', 2, v_hash);
  if v_version3 <> 3 then raise exception 'FALLO: esperaba version=3, llegó %', v_version3; end if;

  if exists (select 1 from turnos_publicados where publicacion_id = (select id from publicaciones where lugar='UPA' and mes=4 and anio=2099 and vigente) and legajo='900303') then
    raise exception 'FALLO precondición: 900303 no debía tener NINGUNA guardia en la publicación nueva';
  end if;

  perform fn_whatsapp_sincronizar_tras_publicar('UPA', 4, 2099);

  select estado, fingerprint_turnos into v_estado, v_fp from whatsapp_avisos where legajo='900303' and lugar='UPA' and mes=4 and anio=2099;
  if v_estado <> 'pendiente' then
    raise exception 'FALLO: 900303, al quedar con 0 guardias publicadas, debía volver a "pendiente" (para poder avisar justamente eso) — quedó %', v_estado;
  end if;
  if v_fp <> '' then
    raise exception 'FALLO: el fingerprint de 900303 con 0 guardias debía quedar en cadena vacía, quedó %', v_fp;
  end if;
  if not exists (select 1 from whatsapp_avisos_historial where legajo='900303' and lugar='UPA' and mes=4 and anio=2099 and motivo='reset_por_cambio_de_guardias_publicadas') then
    raise exception 'FALLO: debía archivarse la confirmación anterior de 900303 en el historial antes de resetear';
  end if;
  raise notice 'OK - "guardias retiradas a cero": un efectivo que queda sin NINGUNA guardia publicada sigue siendo detectado por la sincronización (nunca desaparece del universo a revisar) — su aviso vuelve a pendiente, listo para poder comunicar justamente que se le retiraron todas';
end $$;

-- ----------------------------------------------------------------------------
-- 4) fn_publicar_guardias_y_sincronizar_whatsapp — atomicidad real: si la
-- sincronización de avisos (parte de la MISMA transacción) falla, la
-- publicación TAMBIÉN se revierte — nunca queda una publicación nueva
-- confirmada con los avisos sin sincronizar o desactualizados.
--
-- Se fuerza el fallo quitando temporalmente whatsapp_avisos_historial (la
-- tabla que necesita el archivado de una confirmación existente dentro de
-- la sincronización) — 900304 está confirmado en este punto (ver 3d), así
-- que cambiar su contenido fuerza justo ese paso. Se restaura la tabla (y
-- su RLS/política, igual que las dejó 0005) dentro del mismo bloque, antes
-- de que la excepción se revierta sola si algo de la restauración fallara.
-- ----------------------------------------------------------------------------
do $$
declare
  v_fallo boolean := false;
  v_version_antes int;
  v_estado_900304_antes text;
begin
  select max(version) into v_version_antes from publicaciones where lugar='UPA' and mes=4 and anio=2099;
  select estado into v_estado_900304_antes from whatsapp_avisos where legajo='900304' and lugar='UPA' and mes=4 and anio=2099;

  -- Cambia el contenido de 900304 (que está confirmado) para que la
  -- próxima sincronización necesite archivar su confirmación en
  -- whatsapp_avisos_historial.
  insert into turnos (legajo, dia, turno, sector, mes, anio) values ('900304', 8, 'd', 'UPA', 4, 2099);

  execute 'drop table whatsapp_avisos_historial';
  begin
    perform fn_publicar_guardias_y_sincronizar_whatsapp('UPA', 4, 2099, array['UPA'], 'ADMIN1', 3, fn_hash_borrador_turnos(4, 2099, array['UPA']));
  exception when others then
    v_fallo := true;
  end;

  -- Restaurar la tabla (idéntica a 0004) ANTES de cualquier aserción, para
  -- que la base quede consistente sin importar el resultado de las
  -- aserciones de abajo. El RLS/política de 0005 sobre esta tabla (sección
  -- 5, más abajo) los vuelve a aplicar la propia migración al reaplicarse
  -- ahí (es idempotente) — no hace falta repetirlos acá, y el rol `anon`
  -- todavía no existe en este punto del archivo.
  execute 'create table whatsapp_avisos_historial (
    id              bigserial primary key,
    legajo          text not null,
    lugar           text not null,
    mes             int not null,
    anio            int not null,
    publicacion_id  bigint,
    estado_anterior text,
    motivo          text not null,
    registrado_en   timestamptz not null default now()
  )';

  if not v_fallo then raise exception 'FALLO: la prueba no forzó el error esperado (faltaba whatsapp_avisos_historial)'; end if;

  if (select max(version) from publicaciones where lugar='UPA' and mes=4 and anio=2099) <> v_version_antes then
    raise exception 'FALLO: la publicación NO debía crearse — quedó una versión nueva a pesar de que la sincronización falló';
  end if;
  if (select estado from whatsapp_avisos where legajo='900304' and lugar='UPA' and mes=4 and anio=2099) <> v_estado_900304_antes then
    raise exception 'FALLO: el aviso de 900304 no debía cambiar — la transacción entera (publicación + sincronización) debía revertirse junta';
  end if;
  raise notice 'OK - fn_publicar_guardias_y_sincronizar_whatsapp: si la sincronización de avisos falla, TODA la transacción se revierte (la publicación incluida) — nunca queda una publicación nueva confirmada con los avisos de WhatsApp desactualizados o sin sincronizar';
end $$;

-- Camino feliz de fn_publicar_guardias_y_sincronizar_whatsapp (sin forzar
-- ningún fallo): publica y sincroniza en una sola llamada.
do $$
declare v_pub record; v_version_antes int;
begin
  select max(version) into v_version_antes from publicaciones where lugar='UPA' and mes=4 and anio=2099;
  select * into v_pub from fn_publicar_guardias_y_sincronizar_whatsapp('UPA', 4, 2099, array['UPA'], 'ADMIN1', v_version_antes, fn_hash_borrador_turnos(4, 2099, array['UPA']));
  if v_pub.version <> v_version_antes + 1 then
    raise exception 'FALLO: esperaba version=%, llegó %', v_version_antes + 1, v_pub.version;
  end if;
  if (select count(*) from whatsapp_avisos where lugar='UPA' and mes=4 and anio=2099) = 0 then
    raise exception 'FALLO: la sincronización de avisos debía haber corrido (quedar al menos 1 fila)';
  end if;
  raise notice 'OK - fn_publicar_guardias_y_sincronizar_whatsapp: camino feliz — publica y sincroniza los avisos en una sola llamada atómica';
end $$;

-- ----------------------------------------------------------------------------
-- 5) "Proteger las tablas y funciones nuevas de 0004" — RLS real y EXECUTE
-- revocado, con roles que imitan anon/service_role (mismo patrón que
-- 04_rls.sql). Se crean y se destruyen en este mismo archivo para no
-- interferir con 04_rls.sql si se corre después.
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
  efectivo_puesto_fijo, efectivo_objetivo, efectivo_objetivo_historial,
  whatsapp_avisos, whatsapp_avisos_historial
  to anon;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;

-- Reaplicar 0005 ahora que anon/service_role YA existen: cuando se aplicó
-- antes en esta base (sin esos roles creados todavía), el bloque de
-- revoke/grant de EXECUTE se saltó cada paso por los "if exists" — recién
-- ahora puede revocar/otorgar de verdad. El resto de 0005 (create or
-- replace function, alter table enable rls, create policy) es idempotente.
\ir ../../supabase/migrations/0005_correcciones_ronda_bugs.sql

set role anon;

do $$
declare n int;
begin
  select count(*) into n from efectivo_puesto_fijo;
  if n <> 0 then raise exception 'FALLO: anon pudo leer % fila(s) de efectivo_puesto_fijo (debería ser 0)', n; end if;
  raise notice 'OK (anon) - select en efectivo_puesto_fijo devuelve 0 filas aunque hay datos cargados';
end $$;

do $$
declare n int;
begin
  select count(*) into n from efectivo_objetivo;
  if n <> 0 then raise exception 'FALLO: anon pudo leer % fila(s) de efectivo_objetivo', n; end if;
  raise notice 'OK (anon) - select en efectivo_objetivo devuelve 0 filas';
end $$;

do $$
declare n int;
begin
  select count(*) into n from whatsapp_avisos;
  if n <> 0 then raise exception 'FALLO: anon pudo leer % fila(s) de whatsapp_avisos', n; end if;
  raise notice 'OK (anon) - select en whatsapp_avisos devuelve 0 filas';
end $$;

do $$
declare v_fallo boolean := false;
begin
  begin
    insert into efectivo_puesto_fijo (legajo, lugar, sector, creado_por_legajo) values ('900999', 'UPA', 'UPA', 'anon');
  exception when others then v_fallo := true;
  end;
  if not v_fallo then raise exception 'FALLO: anon pudo insertar en efectivo_puesto_fijo'; end if;
  raise notice 'OK (anon) - insert en efectivo_puesto_fijo rechazado';
end $$;

do $$
declare v_fallo boolean := false; v_code text;
begin
  begin
    perform fn_guardar_puesto_fijo('900999', 'UPA', 'UPA', 'd', 'anon');
  exception when others then
    v_fallo := true; v_code := sqlstate;
  end;
  if not v_fallo then raise exception 'FALLO: anon pudo ejecutar fn_guardar_puesto_fijo por RPC directo'; end if;
  if v_code <> '42501' then raise exception 'FALLO: esperaba sqlstate 42501 (insufficient_privilege), llegó %', v_code; end if;
  raise notice 'OK (anon) - fn_guardar_puesto_fijo: EXECUTE revocado (42501), no se puede invocar por RPC directo';
end $$;

do $$
declare v_fallo boolean := false; v_code text;
begin
  begin
    perform fn_whatsapp_confirmar_envio('900999', 'UPA', 4, 2099, '', 'anon');
  exception when others then
    v_fallo := true; v_code := sqlstate;
  end;
  if not v_fallo then raise exception 'FALLO: anon pudo ejecutar fn_whatsapp_confirmar_envio por RPC directo'; end if;
  if v_code <> '42501' then raise exception 'FALLO: esperaba sqlstate 42501, llegó %', v_code; end if;
  raise notice 'OK (anon) - fn_whatsapp_confirmar_envio: EXECUTE revocado (42501)';
end $$;

reset role;

-- service_role (BYPASSRLS) sigue funcionando con normalidad — los
-- endpoints de pages/api/*.js (que usan SUPABASE_SERVICE_ROLE_KEY) no se
-- ven afectados por nada de esto.
set role service_role;

do $$
declare v_fila efectivo_puesto_fijo;
begin
  select * into v_fila from fn_guardar_puesto_fijo('900998', 'UPA', 'UPA', 'd', 'service_role_test');
  if v_fila.id is null then raise exception 'FALLO: service_role debía poder ejecutar fn_guardar_puesto_fijo con normalidad'; end if;
  raise notice 'OK (service_role) - fn_guardar_puesto_fijo sigue funcionando con normalidad (BYPASSRLS, EXECUTE otorgado)';
end $$;

reset role;

-- Limpieza: se deja la base exactamente como estaba antes de esta sección
-- (roles incluidos), igual que hace 04_rls.sql, para poder correr ambos
-- archivos (en cualquier orden) sin acumular estado. A diferencia de
-- 04_rls.sql (que revierte también el RLS que activa su propia migración
-- "propuesta" 0002, nunca aplicada en la cadena principal), el RLS de 0005
-- sobre estas 5 tablas es permanente y YA estaba activo desde el setup
-- principal — acá solo se deshace lo que agregó ESTA sección: las 5
-- políticas (creadas recién ahora, al reaplicar 0005 con `anon` ya
-- existente) y los roles de prueba, nunca el RLS en sí.
drop policy if exists "bloquear_anon_efectivo_puesto_fijo" on efectivo_puesto_fijo;
drop policy if exists "bloquear_anon_efectivo_objetivo" on efectivo_objetivo;
drop policy if exists "bloquear_anon_efectivo_objetivo_historial" on efectivo_objetivo_historial;
drop policy if exists "bloquear_anon_whatsapp_avisos" on whatsapp_avisos;
drop policy if exists "bloquear_anon_whatsapp_avisos_historial" on whatsapp_avisos_historial;

delete from efectivo_puesto_fijo where legajo in ('900999', '900998');
revoke all on all tables in schema public from service_role;
revoke all on all sequences in schema public from service_role;
revoke all on all functions in schema public from service_role;
revoke all on efectivo_puesto_fijo, efectivo_objetivo, efectivo_objetivo_historial, whatsapp_avisos, whatsapp_avisos_historial from anon;
drop role anon;
drop role service_role;

do $$ begin
  raise notice '=== TODAS LAS PRUEBAS DE CORRECCIÓN DE ESTA RONDA (0005, SQL, PostgreSQL real) PASARON ===';
end $$;
