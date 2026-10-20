-- ============================================================================
-- Pruebas EJECUTADAS contra un PostgreSQL 16 real (no simulado), con el
-- esquema ficticio de 00_esquema_base_ficticio.sql y los datos de
-- 01_seed_ficticio.sql ya cargados. Cada bloque imprime "OK - <nombre>" si
-- pasa, o aborta con una excepción (RAISE EXCEPTION) con el detalle si falla
-- — así un fallo se nota de inmediato y no sigue corriendo pruebas sobre un
-- estado que ya no es el esperado.
--
-- Ejecutar: psql -f 02_pruebas_basicas.sql (ver tests/pg/README.md)
-- ============================================================================

\set ON_ERROR_STOP on

-- ----------------------------------------------------------------------------
-- 1) Validación: día fuera de rango, turno no permitido, lugar inválido.
-- ----------------------------------------------------------------------------
do $$
begin
  begin
    perform fn_guardar_disponibilidad_admin('100001','HIGA',11,2026, '{"32":"d"}'::jsonb, 'ADMIN1', null, '{}'::jsonb, '[]'::jsonb);
    raise exception 'FALLO: debería haber rechazado el día 32 de noviembre (no existe)';
  exception when others then
    if sqlerrm <> 'dia_invalido' then raise exception 'FALLO: esperaba dia_invalido, llegó: %', sqlerrm; end if;
  end;
  raise notice 'OK - rechaza un día que no existe en el mes';
end $$;

do $$
begin
  begin
    perform fn_guardar_disponibilidad_admin('100001','HIGA',11,2026, '{"5":"x"}'::jsonb, 'ADMIN1', null, '{}'::jsonb, '[]'::jsonb);
    raise exception 'FALLO: debería haber rechazado el turno "x"';
  exception when others then
    if sqlerrm <> 'turno_invalido' then raise exception 'FALLO: esperaba turno_invalido, llegó: %', sqlerrm; end if;
  end;
  raise notice 'OK - rechaza un turno no permitido para el lugar';
end $$;

do $$
begin
  begin
    perform fn_guardar_disponibilidad_admin('100001','MODULAR',11,2026, '{"5":"d"}'::jsonb, 'ADMIN1', null, '{}'::jsonb, '[]'::jsonb);
    raise exception 'FALLO: debería haber rechazado el turno "d" en MODULAR (ahí es m/t/n)';
  exception when others then
    if sqlerrm <> 'turno_invalido' then raise exception 'FALLO: esperaba turno_invalido, llegó: %', sqlerrm; end if;
  end;
  raise notice 'OK - distingue los turnos permitidos por lugar (MODULAR vs HIGA/UPA)';
end $$;

do $$
begin
  begin
    perform fn_guardar_disponibilidad_admin('100001','NEUQUEN',11,2026, '{"5":"d"}'::jsonb, 'ADMIN1', null, '{}'::jsonb, '[]'::jsonb);
    raise exception 'FALLO: debería haber rechazado un lugar inexistente';
  exception when others then
    if sqlerrm <> 'lugar_invalido' then raise exception 'FALLO: esperaba lugar_invalido, llegó: %', sqlerrm; end if;
  end;
  raise notice 'OK - rechaza un lugar que no es HIGA/UPA/MODULAR';
end $$;

-- ----------------------------------------------------------------------------
-- 2) Guardado administrativo: camino feliz, atómico.
-- ----------------------------------------------------------------------------
do $$
declare
  v_antes jsonb;
begin
  select coalesce(jsonb_object_agg(dia::text, turno), '{}'::jsonb) into v_antes
    from disponibilidad where legajo='100002' and lugar='HIGA' and mes=11 and anio=2026;
  if v_antes <> '{}'::jsonb then raise exception 'FALLO: precondición rota, ya había disponibilidad cargada'; end if;

  perform fn_guardar_disponibilidad_admin('100002','HIGA',11,2026, '{"10":"d","11":"dn"}'::jsonb, 'ADMIN1', 'carga de prueba', '{}'::jsonb, '[]'::jsonb);

  if (select count(*) from disponibilidad where legajo='100002' and lugar='HIGA' and mes=11 and anio=2026) <> 2 then
    raise exception 'FALLO: no quedaron las 2 filas esperadas';
  end if;
  if (select count(*) from disponibilidad_auditoria where legajo='100002' and lugar='HIGA' and mes=11 and anio=2026) <> 1 then
    raise exception 'FALLO: no quedó registrada la auditoría';
  end if;
  raise notice 'OK - guardado administrativo feliz: disponibilidad + auditoría quedan juntas';
end $$;

-- ----------------------------------------------------------------------------
-- 3) Conservación de datos ante fallo: si la auditoría falla, TODO se
--    revierte (incluido el delete+insert de disponibilidad que ya se había
--    hecho antes, dentro de la misma función).
-- ----------------------------------------------------------------------------
alter table disponibilidad_auditoria add constraint chk_forzar_fallo_prueba check (modificado_por_legajo <> 'FORZAR_FALLO_PRUEBA');

do $$
declare
  v_antes jsonb;
  v_despues jsonb;
  v_fallo boolean := false;
begin
  select coalesce(jsonb_object_agg(dia::text, turno), '{}'::jsonb) into v_antes
    from disponibilidad where legajo='100002' and lugar='HIGA' and mes=11 and anio=2026;

  begin
    perform fn_guardar_disponibilidad_admin('100002','HIGA',11,2026, '{"20":"n"}'::jsonb, 'FORZAR_FALLO_PRUEBA', null, v_antes, '[]'::jsonb);
  exception when others then
    v_fallo := true;
  end;
  if not v_fallo then raise exception 'FALLO: la prueba no forzó el error esperado'; end if;

  select coalesce(jsonb_object_agg(dia::text, turno), '{}'::jsonb) into v_despues
    from disponibilidad where legajo='100002' and lugar='HIGA' and mes=11 and anio=2026;

  if v_despues <> v_antes then
    raise exception 'FALLO: la disponibilidad cambió a pesar de que la auditoría falló (quedó: %, esperaba: %)', v_despues, v_antes;
  end if;
  if (select count(*) from disponibilidad_auditoria where modificado_por_legajo='FORZAR_FALLO_PRUEBA') <> 0 then
    raise exception 'FALLO: quedó una fila de auditoría de un guardado que debía revertirse entero';
  end if;
  raise notice 'OK - si la auditoría falla, se revierte TODO (disponibilidad incluida), no queda nada a medias';
end $$;

alter table disponibilidad_auditoria drop constraint chk_forzar_fallo_prueba;

-- ----------------------------------------------------------------------------
-- 4) Concurrencia optimista: rechaza si lo guardado ahora no coincide con
--    lo que el administrador vio al abrir el formulario — incluido el caso
--    en que antes no había ninguna fila cargada.
-- ----------------------------------------------------------------------------
do $$
declare v_fallo boolean := false; v_mensaje text;
begin
  -- 100003 (UPA) no tiene disponibilidad cargada: dias_antes_esperado={} es correcto.
  perform fn_guardar_disponibilidad_admin('100003','UPA',11,2026, '{"1":"d"}'::jsonb, 'ADMIN1', null, '{}'::jsonb, '[]'::jsonb);
  raise notice 'OK - admite dias_antes_esperado={} cuando de verdad no había nada cargado';
exception when others then
  raise exception 'FALLO inesperado en caso sin disponibilidad previa: %', sqlerrm;
end $$;

do $$
declare v_fallo boolean := false; v_mensaje text;
begin
  -- Ahora SÍ hay algo cargado (lo de arriba). Si alguien manda dias_antes_esperado={}
  -- otra vez (como si no supiera que ya cambió), debe rechazar.
  begin
    perform fn_guardar_disponibilidad_admin('100003','UPA',11,2026, '{"2":"n"}'::jsonb, 'ADMIN1', null, '{}'::jsonb, '[]'::jsonb);
  exception when others then
    v_fallo := true; v_mensaje := sqlerrm;
  end;
  if not v_fallo then raise exception 'FALLO: debería haber rechazado por concurrencia (otro ya había cargado algo)'; end if;
  if v_mensaje <> 'disponibilidad_desactualizada' then raise exception 'FALLO: mensaje inesperado: %', v_mensaje; end if;
  raise notice 'OK - rechaza con disponibilidad_desactualizada cuando el estado real ya no coincide con lo esperado, incluso partiendo de "nada cargado"';
end $$;

-- ----------------------------------------------------------------------------
-- 5) Publicación: camino feliz, el resumen y las guardias publicadas
--    corresponden a la misma versión. Punto 4 de la revisión: ya no se
--    manda p_resumen/p_efectivos_afectados desde afuera — la función los
--    calcula y los devuelve ella misma, así que acá se verifica que lo que
--    devuelve sea correcto (no solo que no explote).
-- ----------------------------------------------------------------------------
do $$
declare
  v_hash text;
  v_pub_id bigint;
  v_version int;
  v_resumen jsonb;
  v_efectivos jsonb;
begin
  v_hash := fn_hash_borrador_turnos(11, 2026, array['Salud Mental','Giratoria','Llaves','Guardia','Estacionamiento','Rondin Externo']);

  select publicacion_id, version, resumen, efectivos_afectados into v_pub_id, v_version, v_resumen, v_efectivos
    from fn_publicar_guardias('HIGA', 11, 2026, array['Salud Mental','Giratoria','Llaves','Guardia','Estacionamiento','Rondin Externo'], 'ADMIN1', 0, v_hash);

  if v_version <> 1 then raise exception 'FALLO: esperaba version=1, llegó %', v_version; end if;
  if (select count(*) from turnos_publicados where publicacion_id = v_pub_id) <> 3 then
    raise exception 'FALLO: esperaba 3 turnos publicados (los 3 del seed para HIGA/11/2026)';
  end if;
  if (select count(*) from publicaciones where lugar='HIGA' and mes=11 and anio=2026 and vigente) <> 1 then
    raise exception 'FALLO: debía quedar exactamente una publicación vigente';
  end if;
  -- Primera publicación: no había vigente antes, así que "hay_cambios" debe
  -- ser true (todo es nuevo) y version_anterior debe ser null.
  if (v_resumen->>'hay_cambios')::boolean is not true then
    raise exception 'FALLO: la primera publicación debía tener hay_cambios=true, resumen=%', v_resumen;
  end if;
  if v_resumen->'version_anterior' is distinct from 'null'::jsonb then
    raise exception 'FALLO: la primera publicación no debía tener version_anterior, resumen=%', v_resumen;
  end if;
  if jsonb_array_length(v_efectivos) <> 2 then  -- 100001 y 100002 tienen turnos en el seed
    raise exception 'FALLO: esperaba 2 efectivos afectados (todos nuevos) en la primera publicación, llegó %', v_efectivos;
  end if;
  if exists (select 1 from jsonb_array_elements(v_efectivos) e where e->>'tipo_cambio' <> 'nuevo') then
    raise exception 'FALLO: en la primera publicación todos los efectivos afectados debían ser tipo_cambio=nuevo, llegó %', v_efectivos;
  end if;
  raise notice 'OK - publicación feliz: versión 1, 3 turnos publicados bajo la misma publicacion_id, resumen y efectivos_afectados calculados y devueltos correctamente';
end $$;

-- ----------------------------------------------------------------------------
-- 6) Publicar con version_base vieja (alguien ya publicó, o doble clic) se
--    rechaza — no se crea una segunda publicación encima.
-- ----------------------------------------------------------------------------
do $$
declare v_fallo boolean := false; v_mensaje text; v_hash text;
begin
  v_hash := fn_hash_borrador_turnos(11, 2026, array['Salud Mental','Giratoria','Llaves','Guardia','Estacionamiento','Rondin Externo']);
  begin
    perform fn_publicar_guardias('HIGA', 11, 2026, array['Salud Mental','Giratoria','Llaves','Guardia','Estacionamiento','Rondin Externo'], 'ADMIN1', 0, v_hash);
  exception when others then
    v_fallo := true; v_mensaje := sqlerrm;
  end;
  if not v_fallo then raise exception 'FALLO: debía rechazar (version_base=0 ya no es la vigente, que ahora es 1)'; end if;
  if v_mensaje <> 'publicacion_desactualizada' then raise exception 'FALLO: mensaje inesperado: %', v_mensaje; end if;
  if (select count(*) from publicaciones where lugar='HIGA' and mes=11 and anio=2026) <> 1 then
    raise exception 'FALLO: no debía haberse creado una segunda publicación';
  end if;
  raise notice 'OK - version_base desactualizada (doble clic / reintento / otra publicación) se rechaza, no duplica';
end $$;

-- ----------------------------------------------------------------------------
-- 7) Publicar con el borrador cambiado desde el preview se rechaza, aunque
--    la version_base sí sea la vigente.
-- ----------------------------------------------------------------------------
do $$
declare v_fallo boolean := false; v_mensaje text; v_hash_viejo text;
begin
  v_hash_viejo := fn_hash_borrador_turnos(11, 2026, array['Salud Mental','Giratoria','Llaves','Guardia','Estacionamiento','Rondin Externo']);

  insert into turnos (legajo, dia, turno, sector, mes, anio) values ('100002', 7, 'n', 'Llaves', 11, 2026);

  begin
    perform fn_publicar_guardias('HIGA', 11, 2026, array['Salud Mental','Giratoria','Llaves','Guardia','Estacionamiento','Rondin Externo'], 'ADMIN1', 1, v_hash_viejo);
  exception when others then
    v_fallo := true; v_mensaje := sqlerrm;
  end;
  if not v_fallo then raise exception 'FALLO: debía rechazar por borrador_desactualizado'; end if;
  if v_mensaje <> 'borrador_desactualizado' then raise exception 'FALLO: mensaje inesperado: %', v_mensaje; end if;
  raise notice 'OK - el borrador cambiado desde el preview se detecta y se rechaza (borrador_desactualizado)';
end $$;

-- ----------------------------------------------------------------------------
-- 8) Modificar el borrador después de publicar NO altera lo ya publicado
--    (asistencia/planillas referencian turnos_publicados, no turnos).
-- ----------------------------------------------------------------------------
do $$
declare v_antes_count int; v_despues_count int;
begin
  select count(*) into v_antes_count from turnos_publicados where lugar='HIGA' and mes=11 and anio=2026;
  delete from turnos where legajo='100001' and mes=11 and anio=2026; -- se borra del BORRADOR
  select count(*) into v_despues_count from turnos_publicados where lugar='HIGA' and mes=11 and anio=2026;
  if v_antes_count <> v_despues_count then
    raise exception 'FALLO: borrar del borrador alteró lo ya publicado (antes=%, después=%)', v_antes_count, v_despues_count;
  end if;
  raise notice 'OK - editar/borrar el borrador después de publicar no toca turnos_publicados';
end $$;

-- ----------------------------------------------------------------------------
-- 9) Conservación real de asistencia y planilla_manual: no alcanza con ver
--    que turnos_publicados no cambia de tamaño (test 8) — hay que tocar de
--    verdad filas de asistencia/planilla_manual, editar el borrador y
--    publicar una versión nueva encima, y confirmar que esas filas
--    específicas (mismo id, mismos valores) siguen exactamente iguales.
--    Punto 6 de la revisión: "Una edición de borrador no debe alterar
--    guardias comunicadas ni asistencias registradas... No reasignes
--    asistencias automáticamente."
-- ----------------------------------------------------------------------------
do $$
declare
  v_asistencia_id bigint;
  v_planilla_id bigint;
  v_asistencia_antes record;
  v_planilla_antes record;
  v_hash text;
  v_version_vigente int;
  v_resumen jsonb;
  v_efectivos jsonb;
begin
  -- Esta guardia (100002, día 5, turno d, Llaves) es la que test 5 publicó
  -- como parte de la versión 1 — se simula que ya se le registró presencia
  -- y una planilla manual, como pasaría en el uso real.
  insert into asistencia (legajo, mes, anio, dia, turno, sector, lugar, presente, confirmado_at)
    values ('100002', 11, 2026, 5, 'd', 'Llaves', 'HIGA', true, now())
    returning id into v_asistencia_id;
  insert into planilla_manual (legajo, mes, anio, dia, horario, horas, sector, lugar)
    values ('100002', 11, 2026, 5, '08:00 a 20:00', 12, 'Llaves', 'HIGA')
    returning id into v_planilla_id;

  select * into v_asistencia_antes from asistencia where id = v_asistencia_id;
  select * into v_planilla_antes from planilla_manual where id = v_planilla_id;

  -- Se edita el BORRADOR: se le borra a 100002 justo esa guardia del día 5
  -- (como si el administrador la hubiera reasignado a otra persona) y se
  -- publica una versión nueva encima de la vigente.
  delete from turnos where legajo = '100002' and dia = 5 and turno = 'd' and sector = 'Llaves' and mes = 11 and anio = 2026;

  select version into v_version_vigente from publicaciones where lugar = 'HIGA' and mes = 11 and anio = 2026 and vigente;
  v_hash := fn_hash_borrador_turnos(11, 2026, array['Salud Mental','Giratoria','Llaves','Guardia','Estacionamiento','Rondin Externo']);
  select resumen, efectivos_afectados into v_resumen, v_efectivos
    from fn_publicar_guardias('HIGA', 11, 2026, array['Salud Mental','Giratoria','Llaves','Guardia','Estacionamiento','Rondin Externo'], 'ADMIN1', v_version_vigente, v_hash);

  if (select version from publicaciones where lugar='HIGA' and mes=11 and anio=2026 and vigente) <> v_version_vigente + 1 then
    raise exception 'FALLO: no se publicó la versión nueva esperada tras editar el borrador';
  end if;
  -- Punto 4: 100001 ya no tiene ninguna fila en el borrador (test 8 le
  -- borró todo) -> debe aparecer como 'eliminado' en efectivos_afectados
  -- respecto de la versión anterior. hay_cambios debe ser true. Si esto
  -- saliera vacío, sería exactamente el bug original (comparar contra la
  -- publicación que se acaba de crear en vez de la que estaba vigente
  -- antes de este publish).
  if not exists (select 1 from jsonb_array_elements(v_efectivos) e where e->>'legajo' = '100001' and e->>'tipo_cambio' = 'eliminado') then
    raise exception 'FALLO: 100001 debía figurar como eliminado en efectivos_afectados (test 8 le borró todo el borrador), llegó %', v_efectivos;
  end if;
  if (v_resumen->>'hay_cambios')::boolean is not true then
    raise exception 'FALLO: hay_cambios debía ser true tras el cambio real en el borrador, resumen=%', v_resumen;
  end if;
  if (v_resumen->>'version_anterior')::int <> v_version_vigente then
    raise exception 'FALLO: version_anterior en el resumen debía ser % (la que estaba vigente antes de este publish), llegó %', v_version_vigente, v_resumen->>'version_anterior';
  end if;

  -- La asistencia y la planilla manual de 100002 tienen que seguir EXACTAMENTE
  -- iguales: mismo id, mismos valores — nada las tocó ni las borró, aunque la
  -- guardia que las originó ya no esté ni en el borrador ni en la versión
  -- publicada más nueva.
  if not exists (select 1 from asistencia where id = v_asistencia_id
                   and legajo = v_asistencia_antes.legajo and dia = v_asistencia_antes.dia
                   and turno = v_asistencia_antes.turno and sector = v_asistencia_antes.sector
                   and lugar = v_asistencia_antes.lugar and presente = v_asistencia_antes.presente
                   and confirmado_at = v_asistencia_antes.confirmado_at) then
    raise exception 'FALLO: la fila de asistencia de 100002 cambió o se borró al editar el borrador y republicar';
  end if;
  if not exists (select 1 from planilla_manual where id = v_planilla_id
                   and legajo = v_planilla_antes.legajo and dia = v_planilla_antes.dia
                   and horario = v_planilla_antes.horario and horas = v_planilla_antes.horas
                   and sector = v_planilla_antes.sector and lugar = v_planilla_antes.lugar) then
    raise exception 'FALLO: la fila de planilla_manual de 100002 cambió o se borró al editar el borrador y republicar';
  end if;

  raise notice 'OK - asistencia y planilla_manual ya registradas no se alteran ni se borran al editar el borrador y publicar una versión nueva';
end $$;

-- ----------------------------------------------------------------------------
-- 10) Punto 1/5 de la revisión: las nuevas funciones fn_turnos_borrador_*
--     (las que reemplazan la escritura directa a "turnos" con la clave
--     anon) validan sectores por lugar y toman el lock compartido con la
--     publicación (fn_lock_turnos_borrador) — camino feliz + rechazo de
--     sector ajeno.
-- ----------------------------------------------------------------------------
do $$
declare v_insertados int;
begin
  v_insertados := fn_turnos_borrador_insertar('MODULAR', 3, 2027,
    '[{"legajo":"100001","dia":1,"turno":"m","sector":"Modular"},{"legajo":"100002","dia":2,"turno":"t","sector":"Modular"}]'::jsonb);
  if v_insertados <> 2 then raise exception 'FALLO: esperaba insertar 2 turnos de borrador, llegó %', v_insertados; end if;
  if (select count(*) from turnos where mes=3 and anio=2027 and sector='Modular') <> 2 then
    raise exception 'FALLO: no quedaron las 2 filas insertadas por fn_turnos_borrador_insertar';
  end if;
  raise notice 'OK - fn_turnos_borrador_insertar: inserta en lote, bajo el lock compartido con la publicación';
end $$;

do $$
declare v_fallo boolean := false; v_mensaje text;
begin
  begin
    perform fn_turnos_borrador_insertar('MODULAR', 3, 2027,
      '[{"legajo":"100003","dia":4,"turno":"m","sector":"Llaves"}]'::jsonb);  -- "Llaves" es de HIGA, no de MODULAR
  exception when others then
    v_fallo := true; v_mensaje := sqlerrm;
  end;
  if not v_fallo then raise exception 'FALLO: debía rechazar un sector que no pertenece a MODULAR'; end if;
  if v_mensaje <> 'sector_invalido' then raise exception 'FALLO: mensaje inesperado: %', v_mensaje; end if;
  raise notice 'OK - fn_turnos_borrador_insertar rechaza sectores que no pertenecen al lugar (sector_invalido)';
end $$;

do $$
declare v_id bigint; v_fallo boolean := false; v_mensaje text;
begin
  select id into v_id from turnos where mes=3 and anio=2027 and sector='Modular' and legajo='100001';

  -- Camino feliz: editar esa fila desde el lugar correcto.
  perform fn_turnos_borrador_actualizar_uno('MODULAR', 3, 2027, v_id, '100001', 't', 'Modular');
  if (select turno from turnos where id = v_id) <> 't' then
    raise exception 'FALLO: fn_turnos_borrador_actualizar_uno no aplicó el cambio esperado';
  end if;
  raise notice 'OK - fn_turnos_borrador_actualizar_uno: edición feliz dentro del mismo lugar';

  -- Intento de "tamperizar" la fila de MODULAR pasando p_lugar='UPA' (el id
  -- es válido, pero el sector actual de la fila -"Modular"- no pertenece a
  -- UPA) — tiene que rechazarse, no editarse a ciegas.
  begin
    perform fn_turnos_borrador_actualizar_uno('UPA', 3, 2027, v_id, '999999', 'd', 'UPA');
  exception when others then
    v_fallo := true; v_mensaje := sqlerrm;
  end;
  if not v_fallo then raise exception 'FALLO: debía rechazar editar una fila de MODULAR haciéndose pasar por UPA'; end if;
  if v_mensaje <> 'sector_invalido' then raise exception 'FALLO: mensaje inesperado: %', v_mensaje; end if;
  if (select legajo from turnos where id = v_id) <> '100001' then
    raise exception 'FALLO: la fila se modificó a pesar de que el intento debía rechazarse';
  end if;
  raise notice 'OK - fn_turnos_borrador_actualizar_uno rechaza editar una fila de otro lugar aunque el id sea válido (no se puede tamperizar pasando un p_lugar distinto)';

  -- Mismo control en fn_turnos_borrador_borrar_uno.
  v_fallo := false;
  begin
    perform fn_turnos_borrador_borrar_uno('UPA', 3, 2027, v_id);
  exception when others then
    v_fallo := true; v_mensaje := sqlerrm;
  end;
  if not v_fallo then raise exception 'FALLO: debía rechazar borrar una fila de MODULAR haciéndose pasar por UPA'; end if;
  if v_mensaje <> 'sector_invalido' then raise exception 'FALLO: mensaje inesperado: %', v_mensaje; end if;
  if not exists (select 1 from turnos where id = v_id) then
    raise exception 'FALLO: la fila se borró a pesar de que el intento debía rechazarse';
  end if;
  raise notice 'OK - fn_turnos_borrador_borrar_uno rechaza borrar una fila de otro lugar aunque el id sea válido';

  -- Camino feliz de borrar_uno, desde el lugar correcto.
  perform fn_turnos_borrador_borrar_uno('MODULAR', 3, 2027, v_id);
  if exists (select 1 from turnos where id = v_id) then
    raise exception 'FALLO: fn_turnos_borrador_borrar_uno no borró la fila esperada';
  end if;
  raise notice 'OK - fn_turnos_borrador_borrar_uno: borrado feliz dentro del mismo lugar';
end $$;

do $$
declare v_borrados int;
begin
  v_borrados := fn_turnos_borrador_borrar_scope('MODULAR', 3, 2027, array['Modular']);
  if v_borrados <> 1 then raise exception 'FALLO: esperaba borrar 1 fila restante (la de 100002), llegó %', v_borrados; end if;
  if (select count(*) from turnos where mes=3 and anio=2027) <> 0 then
    raise exception 'FALLO: no quedó vacío el borrador de MODULAR 3/2027 tras fn_turnos_borrador_borrar_scope';
  end if;
  raise notice 'OK - fn_turnos_borrador_borrar_scope borra todo el scope pedido, bajo el mismo lock';
end $$;

do $$
declare v_renombrados int;
begin
  -- Punto 3 de ESTA ronda: fn_turnos_borrador_renombrar_legajo ahora exige
  -- p_lugar y se acota a él — un legajo de prueba con filas en DOS lugares
  -- distintos (Llaves=HIGA, Modular=MODULAR) a la vez, para confirmar que
  -- renombrar "con p_lugar='HIGA'" SOLO toca la fila de HIGA y deja
  -- intacta la de MODULAR (antes, con la firma vieja de 2 parámetros, esto
  -- renombraba las DOS sin distinción de lugar — justo lo que el punto 3
  -- pide corregir: "respetá el alcance autorizado del administrador").
  insert into turnos (legajo, dia, turno, sector, mes, anio) values
    ('900777', 10, 'd', 'Llaves', 11, 2026),
    ('900777', 1, 'm', 'Modular', 3, 2027);

  v_renombrados := fn_turnos_borrador_renombrar_legajo('HIGA', '900777', '900777-B');
  if v_renombrados <> 1 then raise exception 'FALLO: esperaba renombrar 1 fila (solo la de HIGA), llegó %', v_renombrados; end if;
  if (select count(*) from turnos where legajo='900777') <> 1 then
    raise exception 'FALLO: la fila de MODULAR (otro lugar) no debía tocarse';
  end if;
  if (select sector from turnos where legajo='900777') <> 'Modular' then
    raise exception 'FALLO: la fila que quedó con el legajo viejo no es la de MODULAR';
  end if;
  if (select count(*) from turnos where legajo='900777-B') <> 1 then
    raise exception 'FALLO: no quedó la fila de HIGA con el legajo nuevo';
  end if;
  if (select sector from turnos where legajo='900777-B') <> 'Llaves' then
    raise exception 'FALLO: la fila renombrada no es la de HIGA (Llaves)';
  end if;
  raise notice 'OK - fn_turnos_borrador_renombrar_legajo se acota a p_lugar: renombra solo las filas de ESE lugar, deja intactas las de otro lugar del mismo legajo';

  -- Ahora sí, renombrar también la fila de MODULAR, para dejar el legajo
  -- viejo completamente libre antes de limpiar.
  v_renombrados := fn_turnos_borrador_renombrar_legajo('MODULAR', '900777', '900777-B');
  if v_renombrados <> 1 then raise exception 'FALLO: esperaba renombrar la fila restante de MODULAR, llegó %', v_renombrados; end if;

  delete from turnos where legajo = '900777-B';  -- limpieza, no afecta pruebas siguientes
end $$;

-- ----------------------------------------------------------------------------
-- 10b) Punto 1 de ESTA ronda: fn_resumen_publicacion devuelve, de un mismo
--      cálculo, la versión vigente real, el hash real del borrador (igual
--      al que calcula fn_hash_borrador_turnos por separado) y un resumen
--      consistente con eso.
-- ----------------------------------------------------------------------------
do $$
declare
  v_version_base int; v_hash text; v_resumen jsonb; v_efectivos jsonb;
  v_hash_independiente text;
begin
  insert into turnos (legajo, dia, turno, sector, mes, anio) values
    ('900778', 1, 'd', 'UPA', 8, 2027),
    ('900779', 2, 'n', 'UPA', 8, 2027);

  select r.version_base, r.hash_borrador, r.resumen, r.efectivos_afectados
    into v_version_base, v_hash, v_resumen, v_efectivos
    from fn_resumen_publicacion('UPA', 8, 2027, array['UPA']) r;

  v_hash_independiente := fn_hash_borrador_turnos(8, 2027, array['UPA']);
  if v_hash <> v_hash_independiente then
    raise exception 'FALLO: el hash de fn_resumen_publicacion no coincide con fn_hash_borrador_turnos calculado por separado';
  end if;
  if v_version_base <> 0 then
    raise exception 'FALLO: esperaba version_base=0 (sin publicación previa para UPA 8/2027), llegó %', v_version_base;
  end if;
  if (v_resumen->>'total_turnos_actuales')::int <> 2 then
    raise exception 'FALLO: resumen.total_turnos_actuales esperaba 2, llegó %', v_resumen->>'total_turnos_actuales';
  end if;
  if jsonb_array_length(v_efectivos) <> 2 then
    raise exception 'FALLO: esperaba 2 efectivos afectados (nuevos), llegó %', jsonb_array_length(v_efectivos);
  end if;
  raise notice 'OK - fn_resumen_publicacion: version_base/hash_borrador/resumen/efectivos_afectados salen de un mismo cálculo consistente (mismo hash que fn_hash_borrador_turnos por separado)';

  delete from turnos where legajo in ('900778', '900779');
end $$;

-- ----------------------------------------------------------------------------
-- 10c) Punto 2 de ESTA ronda: fn_turnos_borrador_reemplazar_scope. Camino
--      feliz y, sobre todo, que una validación fallida NO borre nada del
--      borrador anterior (nunca queda un hueco vacío a mitad de camino).
-- ----------------------------------------------------------------------------
do $$
declare v_insertados int; v_fallo boolean := false; v_mensaje text;
begin
  insert into turnos (legajo, dia, turno, sector, mes, anio) values
    ('900780', 1, 'm', 'Modular', 9, 2027),
    ('900781', 2, 't', 'Modular', 9, 2027);

  -- Camino feliz: reemplaza el scope completo por un lote nuevo distinto,
  -- en una sola llamada.
  v_insertados := fn_turnos_borrador_reemplazar_scope('MODULAR', 9, 2027, array['Modular'],
    '[{"legajo":"900782","dia":3,"turno":"n","sector":"Modular"}]'::jsonb);
  if v_insertados <> 1 then raise exception 'FALLO: esperaba insertar 1 fila nueva, llegó %', v_insertados; end if;
  if (select count(*) from turnos where mes=9 and anio=2027 and sector='Modular') <> 1 then
    raise exception 'FALLO: el reemplazo no dejó exactamente 1 fila (la nueva)';
  end if;
  if not exists (select 1 from turnos where legajo='900782' and mes=9 and anio=2027) then
    raise exception 'FALLO: no quedó la fila nueva tras el reemplazo';
  end if;
  raise notice 'OK - fn_turnos_borrador_reemplazar_scope: reemplazo feliz (borra el scope anterior e inserta el lote nuevo en una sola transacción)';

  -- Ahora el caso crítico de este punto: el lote nuevo trae un sector que
  -- NO pertenece a MODULAR ("Llaves" es de HIGA). Tiene que rechazarse SIN
  -- borrar nada — el borrador anterior (la fila de 900782) debe seguir
  -- exactamente igual, nunca a medias ni vacío.
  begin
    perform fn_turnos_borrador_reemplazar_scope('MODULAR', 9, 2027, array['Modular'],
      '[{"legajo":"900783","dia":4,"turno":"m","sector":"Llaves"}]'::jsonb);
  exception when others then
    v_fallo := true; v_mensaje := sqlerrm;
  end;
  if not v_fallo then raise exception 'FALLO: debía rechazar un lote nuevo con un sector que no pertenece al lugar'; end if;
  if v_mensaje <> 'sector_invalido' then raise exception 'FALLO: mensaje inesperado: %', v_mensaje; end if;
  if (select count(*) from turnos where mes=9 and anio=2027 and sector='Modular') <> 1 then
    raise exception 'FALLO: el borrador anterior NO quedó intacto tras el intento de reemplazo inválido (se borró algo que no debía borrarse)';
  end if;
  if not exists (select 1 from turnos where legajo='900782' and mes=9 and anio=2027) then
    raise exception 'FALLO: la fila anterior (900782) desapareció a pesar de que el reemplazo debía rechazarse antes de borrar nada';
  end if;
  raise notice 'OK - fn_turnos_borrador_reemplazar_scope: si el lote nuevo es inválido, se rechaza SIN borrar nada — el borrador anterior queda completo, nunca a medias ni vacío';

  delete from turnos where mes=9 and anio=2027 and sector='Modular';
end $$;

-- ----------------------------------------------------------------------------
-- 10d) Punto 3 de ESTA ronda: fn_admin_guardar_efectivo. Camino feliz
--      (renombra efectivo + sus turnos del borrador juntos) y, sobre todo,
--      que un fallo (legajo duplicado) revierta las DOS partes — nunca
--      queda el efectivo con el legajo nuevo y sus turnos con el viejo.
-- ----------------------------------------------------------------------------
do $$
declare
  v_id_a bigint; v_id_b bigint; v_turnos_renombrados int;
  v_fallo boolean := false; v_mensaje text;
begin
  insert into efectivos (legajo, nombre, lugar, es_admin) values ('900784', 'Prueba A', 'HIGA', false) returning id into v_id_a;
  insert into efectivos (legajo, nombre, lugar, es_admin) values ('900785', 'Prueba B', 'HIGA', false) returning id into v_id_b;
  insert into turnos (legajo, dia, turno, sector, mes, anio) values
    ('900784', 5, 'd', 'Giratoria', 10, 2027);

  -- Camino feliz: cambiar el legajo de "Prueba A" de 900784 a 900786 (libre).
  select r.turnos_renombrados into v_turnos_renombrados
    from fn_admin_guardar_efectivo('HIGA', v_id_a, '900786', 'Prueba A', 'Enfermero', 'a@x.com', 'Sin asignar', '', null, null, null, null) r;
  if v_turnos_renombrados <> 1 then raise exception 'FALLO: esperaba 1 turno renombrado junto con el efectivo, llegó %', v_turnos_renombrados; end if;
  if (select legajo from efectivos where id = v_id_a) <> '900786' then
    raise exception 'FALLO: el efectivo no quedó con el legajo nuevo';
  end if;
  if not exists (select 1 from turnos where legajo = '900786' and mes=10 and anio=2027) then
    raise exception 'FALLO: el turno no se renombró junto con el efectivo';
  end if;
  if exists (select 1 from turnos where legajo = '900784') then
    raise exception 'FALLO: quedó un turno huérfano con el legajo viejo';
  end if;
  raise notice 'OK - fn_admin_guardar_efectivo: camino feliz, el efectivo y sus turnos del borrador se renombran juntos, en la misma transacción';

  -- Caso crítico: intentar renombrar "Prueba A" (legajo 900786) a 900785,
  -- que YA existe (es "Prueba B") — tiene que rechazar por legajo
  -- duplicado, y NINGUNA de las dos partes debe quedar modificada: ni el
  -- efectivo (debe seguir en 900786), ni sus turnos (deben seguir en
  -- 900786, no haber pasado por 900785 ni quedar en un estado intermedio).
  insert into turnos (legajo, dia, turno, sector, mes, anio) values
    ('900786', 6, 'n', 'Giratoria', 10, 2027);  -- un segundo turno para este efectivo, bajo el legajo ya renombrado

  begin
    perform fn_admin_guardar_efectivo('HIGA', v_id_a, '900785', 'Prueba A', 'Enfermero', 'a@x.com', 'Sin asignar', '', null, null, null, null);
  exception when others then
    v_fallo := true; v_mensaje := sqlerrm;
  end;
  if not v_fallo then raise exception 'FALLO: debía rechazar un legajo que ya existe (legajo_duplicado)'; end if;
  if v_mensaje <> 'legajo_duplicado' then raise exception 'FALLO: mensaje inesperado: %', v_mensaje; end if;
  if (select legajo from efectivos where id = v_id_a) <> '900786' then
    raise exception 'FALLO: el efectivo quedó modificado (legajo cambiado) a pesar de que la operación debía rechazarse por completo';
  end if;
  if (select count(*) from turnos where legajo = '900786') <> 2 then
    raise exception 'FALLO: los turnos del efectivo quedaron en un estado distinto al original (se perdió o se modificó alguno) tras un intento que debía revertirse por completo';
  end if;
  if exists (select 1 from turnos where legajo = '900785' and dia in (5,6) and mes=10 and anio=2027) then
    raise exception 'FALLO: algún turno llegó a renombrarse a 900785 a pesar de que el update del efectivo (la otra mitad) tenía que fallar y revertir todo';
  end if;
  raise notice 'OK - fn_admin_guardar_efectivo: si falla por legajo duplicado, revierte TODO (ni el efectivo ni sus turnos quedan modificados) — nunca una parte modificada y la otra no';

  delete from turnos where legajo in ('900786', '900784', '900785');
  delete from efectivos where id in (v_id_a, v_id_b);
end $$;

-- ----------------------------------------------------------------------------
-- 10e) Punto 2 de la ronda siguiente ("Completar la coherencia del cambio
--      de legajo"): fn_admin_guardar_efectivo ahora también renombra
--      disponibilidad/asistencia/planilla_manual (acotadas a p_lugar) y,
--      cuando es inequívoco, firmas. Caso AMBIGUO primero: el mismo legajo
--      existe en dos lugares (900790 en HIGA y en MODULAR, dos personas
--      distintas) — las relaciones con columna lugar se renombran solo del
--      lado de HIGA; firmas (sin columna lugar) NO se toca, porque no hay
--      forma de saber a cuál de los dos pertenece.
-- ----------------------------------------------------------------------------
do $$
declare
  v_id_higa bigint; v_id_modular bigint;
begin
  insert into efectivos (legajo, nombre, lugar, es_admin) values ('900790', 'Prueba HIGA', 'HIGA', false) returning id into v_id_higa;
  insert into efectivos (legajo, nombre, lugar, es_admin) values ('900790', 'Prueba MODULAR', 'MODULAR', false) returning id into v_id_modular;

  insert into disponibilidad (legajo, dia, turno, mes, anio, lugar) values ('900790', 1, 'd', 11, 2026, 'HIGA'), ('900790', 1, 'm', 11, 2026, 'MODULAR');
  insert into asistencia (legajo, mes, anio, dia, turno, lugar) values ('900790', 11, 2026, 1, 'd', 'HIGA'), ('900790', 11, 2026, 1, 'm', 'MODULAR');
  insert into planilla_manual (legajo, mes, anio, dia, horario, horas, lugar) values ('900790', 11, 2026, 1, '08-20', 12, 'HIGA'), ('900790', 11, 2026, 1, '06-14', 8, 'MODULAR');
  insert into firmas (legajo, mes, anio, firma_url) values ('900790', 11, 2026, 'data:x');

  perform fn_admin_guardar_efectivo('HIGA', v_id_higa, '900791', 'Prueba HIGA', 'Enfermero', '', 'Sin asignar', '', null, null, null, null);

  if not exists (select 1 from disponibilidad where legajo='900791' and lugar='HIGA') then
    raise exception 'FALLO: disponibilidad de HIGA no se renombró';
  end if;
  if not exists (select 1 from disponibilidad where legajo='900790' and lugar='MODULAR') then
    raise exception 'FALLO: disponibilidad de MODULAR (otra persona, mismo legajo viejo) quedó afectada o desapareció';
  end if;
  if not exists (select 1 from asistencia where legajo='900791' and lugar='HIGA') or exists (select 1 from asistencia where legajo='900791' and lugar='MODULAR') then
    raise exception 'FALLO: asistencia no se renombró acotada correctamente a HIGA';
  end if;
  if not exists (select 1 from asistencia where legajo='900790' and lugar='MODULAR') then
    raise exception 'FALLO: asistencia de MODULAR quedó afectada';
  end if;
  if not exists (select 1 from planilla_manual where legajo='900791' and lugar='HIGA') then
    raise exception 'FALLO: planilla_manual no se renombró en HIGA';
  end if;
  if not exists (select 1 from planilla_manual where legajo='900790' and lugar='MODULAR') then
    raise exception 'FALLO: planilla_manual de MODULAR quedó afectada';
  end if;
  -- firmas: AMBIGUO (900790 seguía existiendo en MODULAR en el momento del
  -- renombrado) — no debe haberse tocado.
  if not exists (select 1 from firmas where legajo='900790') or exists (select 1 from firmas where legajo='900791') then
    raise exception 'FALLO: firmas se renombró a pesar de ser un caso ambiguo (legajo viejo compartido entre dos lugares) — no debía adivinar';
  end if;
  raise notice 'OK - fn_admin_guardar_efectivo: disponibilidad/asistencia/planilla_manual se renombran acotadas a p_lugar, sin afectar la misma relación de otra persona que comparte legajo en otro lugar; firmas NO se toca cuando el caso es ambiguo';

  delete from disponibilidad where legajo in ('900790','900791');
  delete from asistencia where legajo in ('900790','900791');
  delete from planilla_manual where legajo in ('900790','900791');
  delete from firmas where legajo in ('900790','900791');
  delete from efectivos where id in (v_id_higa, v_id_modular);
end $$;

-- ----------------------------------------------------------------------------
-- 10f) Mismo punto: caso INEQUÍVOCO (el legajo viejo es único en toda la
--      base, el nuevo no le pertenece a nadie más) — firmas SÍ se renombra.
-- ----------------------------------------------------------------------------
do $$
declare v_id bigint; v_firmas_renombradas int; v_omitidas boolean;
begin
  insert into efectivos (legajo, nombre, lugar, es_admin) values ('900793', 'Prueba C', 'HIGA', false) returning id into v_id;
  insert into firmas (legajo, mes, anio, firma_url) values ('900793', 11, 2026, 'data:y');

  select r.firmas_renombradas, r.firmas_omitidas_por_ambiguedad into v_firmas_renombradas, v_omitidas
    from fn_admin_guardar_efectivo('HIGA', v_id, '900794', 'Prueba C', 'Enfermero', '', 'Sin asignar', '', null, null, null, null) r;

  if v_omitidas then raise exception 'FALLO: se omitió firmas en un caso sin ninguna ambigüedad real'; end if;
  if v_firmas_renombradas <> 1 then raise exception 'FALLO: esperaba 1 fila de firmas renombrada, llegó %', v_firmas_renombradas; end if;
  if not exists (select 1 from firmas where legajo='900794') then raise exception 'FALLO: la firma no quedó con el legajo nuevo'; end if;
  if exists (select 1 from firmas where legajo='900793') then raise exception 'FALLO: quedó una firma huérfana con el legajo viejo'; end if;
  raise notice 'OK - fn_admin_guardar_efectivo: cuando el legajo viejo es único y el nuevo está libre en toda la base, firmas SÍ se renombra (no es un "nunca", solo el caso ambiguo se omite)';

  delete from firmas where legajo in ('900793','900794');
  delete from efectivos where id = v_id;
end $$;

-- ----------------------------------------------------------------------------
-- 10g) Mismo punto: si fn_admin_guardar_efectivo falla (legajo duplicado),
--      disponibilidad/asistencia/planilla_manual/firmas tienen que quedar
--      TAN intactas como el efectivo y los turnos — ninguna relación a
--      medio renombrar.
-- ----------------------------------------------------------------------------
do $$
declare
  v_id_a bigint; v_fallo boolean := false;
begin
  insert into efectivos (legajo, nombre, lugar, es_admin) values ('900795', 'Prueba D', 'HIGA', false) returning id into v_id_a;
  insert into efectivos (legajo, nombre, lugar, es_admin) values ('900796', 'Prueba E', 'HIGA', false); -- el legajo "nuevo" que ya existe
  insert into disponibilidad (legajo, dia, turno, mes, anio, lugar) values ('900795', 2, 'n', 11, 2026, 'HIGA');
  insert into asistencia (legajo, mes, anio, dia, turno, lugar) values ('900795', 11, 2026, 2, 'n', 'HIGA');
  insert into planilla_manual (legajo, mes, anio, dia, horario, horas, lugar) values ('900795', 11, 2026, 2, '20-08', 12, 'HIGA');
  insert into firmas (legajo, mes, anio, firma_url) values ('900795', 11, 2026, 'data:z');

  begin
    perform fn_admin_guardar_efectivo('HIGA', v_id_a, '900796', 'Prueba D', 'Enfermero', '', 'Sin asignar', '', null, null, null, null);
  exception when others then
    v_fallo := true;
  end;
  if not v_fallo then raise exception 'FALLO: debía rechazar por legajo duplicado'; end if;

  if not exists (select 1 from disponibilidad where legajo='900795' and lugar='HIGA') then
    raise exception 'FALLO: disponibilidad quedó renombrada a pesar de que la operación completa debía revertirse';
  end if;
  if not exists (select 1 from asistencia where legajo='900795' and lugar='HIGA') then
    raise exception 'FALLO: asistencia quedó renombrada a pesar de que la operación completa debía revertirse';
  end if;
  if not exists (select 1 from planilla_manual where legajo='900795' and lugar='HIGA') then
    raise exception 'FALLO: planilla_manual quedó renombrada a pesar de que la operación completa debía revertirse';
  end if;
  if not exists (select 1 from firmas where legajo='900795') then
    raise exception 'FALLO: firmas quedó renombrada a pesar de que la operación completa debía revertirse';
  end if;
  raise notice 'OK - fn_admin_guardar_efectivo: si la operación falla (legajo duplicado), disponibilidad/asistencia/planilla_manual/firmas quedan TAN intactas como el efectivo y los turnos — ninguna relación a medio renombrar';

  delete from disponibilidad where legajo='900795';
  delete from asistencia where legajo='900795';
  delete from planilla_manual where legajo='900795';
  delete from firmas where legajo='900795';
  delete from efectivos where legajo in ('900795','900796') and lugar='HIGA';
end $$;

-- ----------------------------------------------------------------------------
-- 11) Punto 3 de la revisión, a nivel función: fn_guardar_disponibilidad_
--     efectivo también exige p_dias_antes_esperado (no se puede omitir el
--     control de concurrencia desde ESTE camino tampoco, no solo desde el
--     administrativo).
-- ----------------------------------------------------------------------------
do $$
declare v_fallo boolean := false; v_mensaje text;
begin
  begin
    perform fn_guardar_disponibilidad_efectivo('100003', 'UPA', 11, 2026, '{"3":"d"}'::jsonb, null);
  exception when others then
    v_fallo := true; v_mensaje := sqlerrm;
  end;
  if not v_fallo then raise exception 'FALLO: debía rechazar dias_antes_esperado=null'; end if;
  if v_mensaje <> 'dias_antes_esperado_obligatorio' then raise exception 'FALLO: mensaje inesperado: %', v_mensaje; end if;
  raise notice 'OK - fn_guardar_disponibilidad_efectivo también exige dias_antes_esperado, no se puede omitir desde este camino';
end $$;

do $$ begin raise notice '=== TODAS LAS PRUEBAS BÁSICAS (SQL, PostgreSQL real) PASARON ==='; end $$;
