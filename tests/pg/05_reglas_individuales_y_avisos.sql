-- tests/pg/05_reglas_individuales_y_avisos.sql
--
-- Pruebas SQL reales (PostgreSQL 16, mismo esquema que 02_pruebas_basicas.sql)
-- para lo agregado por supabase/migrations/0004_reglas_individuales_y_avisos.sql:
-- sexo (punto 1), efectivo_puesto_fijo (punto 2), efectivo_objetivo (punto 3)
-- y fn_whatsapp_sincronizar_tras_publicar (punto 9). Se corre DESPUÉS de
-- 00_esquema_base_ficticio.sql + 0001_borrador_publicacion.sql +
-- 0004_reglas_individuales_y_avisos.sql + 01_seed_ficticio.sql, en la misma
-- base que ya corrió 02_pruebas_basicas.sql — usa su propio scope
-- (lugar HIGA, mes=3, anio=2099) para no interferir con lo que esos otros
-- archivos ya dejaron escrito en HIGA/11/2026.

-- ----------------------------------------------------------------------------
-- PUNTO 1: sexo — default 'sin_informar' y constraint femenino/masculino/
-- sin_informar. No se infiere de nada: se inserta explícitamente o no.
-- ----------------------------------------------------------------------------
do $$
declare v_sexo text;
begin
  insert into efectivos (legajo, nombre, es_admin, lugar) values ('900100', 'Test, SinSexo', false, 'HIGA');
  select sexo into v_sexo from efectivos where legajo = '900100' and lugar = 'HIGA';
  if v_sexo <> 'sin_informar' then
    raise exception 'FALLO: el default de sexo debía ser sin_informar, llegó %', v_sexo;
  end if;
  raise notice 'OK - sexo: default ''sin_informar'' cuando no se especifica al insertar';
end $$;

do $$
declare v_fallo boolean := false; v_msg text;
begin
  begin
    insert into efectivos (legajo, nombre, es_admin, lugar, sexo) values ('900101', 'Test, SexoInvalido', false, 'HIGA', 'otro');
  exception when others then
    v_fallo := true; v_msg := sqlerrm;
  end;
  if not v_fallo then raise exception 'FALLO: debía rechazar un valor de sexo fuera de femenino/masculino/sin_informar'; end if;
  raise notice 'OK - sexo: la constraint rechaza valores fuera de femenino/masculino/sin_informar (mensaje: %)', v_msg;
end $$;

do $$
begin
  insert into efectivos (legajo, nombre, es_admin, lugar, sexo) values ('900102', 'Test, Femenino', false, 'HIGA', 'femenino');
  if (select sexo from efectivos where legajo = '900102' and lugar = 'HIGA') <> 'femenino' then
    raise exception 'FALLO: no se guardó el valor explícito de sexo';
  end if;
  raise notice 'OK - sexo: se guarda el valor explícito (femenino/masculino) cuando se carga';
end $$;

-- ----------------------------------------------------------------------------
-- PUNTO 2: efectivo_puesto_fijo — alta y el índice único parcial que exige
-- desactivar la regla anterior antes de poder crear una nueva activa para el
-- mismo efectivo+lugar (es justamente lo que hace pages/api/admin-reglas-puesto.js
-- en su acción 'guardar', en ese orden, antes de insertar).
-- ----------------------------------------------------------------------------
do $$
begin
  insert into efectivo_puesto_fijo (legajo, lugar, sector, turno, creado_por_legajo)
    values ('100001', 'HIGA', 'Estacionamiento', 'd', 'ADMIN1');
  if (select count(*) from efectivo_puesto_fijo where legajo = '100001' and lugar = 'HIGA' and activo) <> 1 then
    raise exception 'FALLO: debía quedar exactamente 1 puesto fijo activo para 100001/HIGA';
  end if;
  raise notice 'OK - efectivo_puesto_fijo: alta feliz (100001 -> Estacionamiento, turno d)';
end $$;

do $$
declare v_fallo boolean := false; v_msg text;
begin
  begin
    -- Sin desactivar la anterior primero: el índice único parcial debe
    -- impedir una segunda fila activa para el mismo legajo+lugar.
    insert into efectivo_puesto_fijo (legajo, lugar, sector, creado_por_legajo) values ('100001', 'HIGA', 'Guardia', 'ADMIN1');
  exception when others then
    v_fallo := true; v_msg := sqlerrm;
  end;
  if not v_fallo then raise exception 'FALLO: el índice único parcial debía impedir dos puestos fijos activos simultáneos para el mismo efectivo+lugar'; end if;
  raise notice 'OK - efectivo_puesto_fijo: idx_puesto_fijo_activo_unico impide dos reglas activas para el mismo efectivo+lugar (mensaje: %)', v_msg;
end $$;

do $$
begin
  update efectivo_puesto_fijo set activo = false where legajo = '100001' and lugar = 'HIGA' and activo;
  insert into efectivo_puesto_fijo (legajo, lugar, sector, creado_por_legajo) values ('100001', 'HIGA', 'Guardia', 'ADMIN1');
  if (select count(*) from efectivo_puesto_fijo where legajo = '100001' and lugar = 'HIGA' and activo) <> 1 then
    raise exception 'FALLO: tras desactivar la anterior, debía poder crearse una nueva activa';
  end if;
  if (select sector from efectivo_puesto_fijo where legajo = '100001' and lugar = 'HIGA' and activo) <> 'Guardia' then
    raise exception 'FALLO: la regla activa debía ser la nueva (Guardia)';
  end if;
  raise notice 'OK - efectivo_puesto_fijo: cambiar el puesto (desactivar + crear nueva) deja exactamente una activa, con historial de la anterior (activo=false, nunca borrada)';
end $$;

-- ----------------------------------------------------------------------------
-- PUNTO 3: efectivo_objetivo — alta, índice único de "activa", e historial
-- que registra cada alta/edición/baja (nunca se pierde el valor anterior).
-- ----------------------------------------------------------------------------
do $$
begin
  insert into efectivo_objetivo (legajo, lugar, tipo, cantidad, turno_objetivo, creado_por_legajo)
    values ('100001', 'HIGA', 'horas', 180, 'ambos', 'ADMIN1');
  insert into efectivo_objetivo_historial (legajo, lugar, tipo, cantidad, turno_objetivo, accion, modificado_por_legajo)
    values ('100001', 'HIGA', 'horas', 180, 'ambos', 'crear', 'ADMIN1');
  if (select count(*) from efectivo_objetivo where legajo = '100001' and lugar = 'HIGA' and activo) <> 1 then
    raise exception 'FALLO: debía quedar 1 objetivo activo';
  end if;
  raise notice 'OK - efectivo_objetivo: alta feliz (100001 -> 180 horas, ambos turnos)';
end $$;

do $$
declare v_fallo boolean := false;
begin
  begin
    insert into efectivo_objetivo (legajo, lugar, tipo, cantidad, creado_por_legajo) values ('100001', 'HIGA', 'guardias', 10, 'ADMIN1');
  exception when others then v_fallo := true;
  end;
  if not v_fallo then raise exception 'FALLO: el índice único parcial debía impedir dos objetivos activos simultáneos para el mismo efectivo+lugar'; end if;
  raise notice 'OK - efectivo_objetivo: idx_objetivo_activo_unico impide dos objetivos activos para el mismo efectivo+lugar';
end $$;

do $$
begin
  -- Coronel 3->2: editar (desactivar la anterior + crear la nueva + loguear
  -- en el historial), sin perder el rastro del valor anterior.
  update efectivo_objetivo set activo = false, actualizado_por_legajo = 'ADMIN1', actualizado_en = now()
    where legajo = '100001' and lugar = 'HIGA' and activo;
  insert into efectivo_objetivo (legajo, lugar, tipo, cantidad, turno_objetivo, creado_por_legajo)
    values ('100001', 'HIGA', 'guardias', 3, 'noche', 'ADMIN1');
  insert into efectivo_objetivo_historial (legajo, lugar, tipo, cantidad, turno_objetivo, accion, modificado_por_legajo)
    values ('100001', 'HIGA', 'guardias', 3, 'noche', 'editar', 'ADMIN1');
  if (select cantidad from efectivo_objetivo where legajo='100001' and lugar='HIGA' and activo) <> 3 then
    raise exception 'FALLO: el objetivo activo debía ser el nuevo (3 guardias)';
  end if;
  if (select count(*) from efectivo_objetivo_historial where legajo='100001' and lugar='HIGA') <> 2 then
    raise exception 'FALLO: el historial debía tener 2 filas (crear + editar), nunca se borra una anterior';
  end if;
  if (select cantidad from efectivo_objetivo_historial where legajo='100001' and lugar='HIGA' and accion='crear') <> 180 then
    raise exception 'FALLO: el historial debía conservar el valor original (180) de la fila "crear"';
  end if;
  raise notice 'OK - efectivo_objetivo: editar la cantidad (3->2 tipo Coronel) conserva el historial completo, nunca borra el valor anterior';
end $$;

-- ----------------------------------------------------------------------------
-- PUNTO 9: fn_whatsapp_sincronizar_tras_publicar — estado independiente por
-- efectivo, vinculado al contenido realmente publicado:
--   (a) primera publicación de un efectivo -> pendiente (sin antecedente).
--   (b) confirmar y publicar una NUEVA versión donde cambiaron las guardias
--       de OTRO efectivo -> el confirmado se CONSERVA intacto.
--   (c) el efectivo cuyas guardias SÍ cambiaron vuelve a 'pendiente', y la
--       confirmación anterior se archiva en whatsapp_avisos_historial (no
--       se pierde, pero deja de ser la vigente).
-- Scope propio (HIGA, mes=3, anio=2099) para no interferir con lo que
-- 02_pruebas_basicas.sql ya publicó en HIGA/11/2026.
-- ----------------------------------------------------------------------------
do $$
declare
  v_hash text; v_pub1 bigint; v_version1 int; v_pub2 bigint; v_version2 int;
  v_estado_100001 text; v_estado_100002 text;
  v_hist_count int;
begin
  insert into turnos (legajo, dia, turno, sector, mes, anio) values
    ('100001', 1, 'd', 'Guardia', 3, 2099),
    ('100002', 2, 'd', 'Llaves', 3, 2099);

  v_hash := fn_hash_borrador_turnos(3, 2099, array['Salud Mental','Giratoria','Llaves','Guardia','Estacionamiento','Rondin Externo']);
  select publicacion_id, version into v_pub1, v_version1
    from fn_publicar_guardias('HIGA', 3, 2099, array['Salud Mental','Giratoria','Llaves','Guardia','Estacionamiento','Rondin Externo'], 'ADMIN1', 0, v_hash);
  if v_version1 <> 1 then raise exception 'FALLO: esperaba version=1 en el scope de prueba propio, llegó %', v_version1; end if;

  perform fn_whatsapp_sincronizar_tras_publicar('HIGA', 3, 2099);

  if (select count(*) from whatsapp_avisos where lugar='HIGA' and mes=3 and anio=2099) <> 2 then
    raise exception 'FALLO: debían quedar 2 filas en whatsapp_avisos (100001 y 100002) tras la primera publicación';
  end if;
  if exists (select 1 from whatsapp_avisos where lugar='HIGA' and mes=3 and anio=2099 and estado <> 'pendiente') then
    raise exception 'FALLO: la primera publicación de cada efectivo debe arrancar en pendiente (sin antecedente confirmable)';
  end if;
  raise notice 'OK - fn_whatsapp_sincronizar_tras_publicar: primera publicación -> ambos efectivos quedan "pendiente" (nunca "confirmado" de entrada)';

  -- Confirmar el aviso de AMBOS (simulando la acción explícita del
  -- administrador vía pages/api/whatsapp-avisos.js, acción 'confirmar').
  update whatsapp_avisos set estado='confirmado', confirmado_en=now(), confirmado_por_legajo='ADMIN1'
    where lugar='HIGA' and mes=3 and anio=2099;

  -- Cambian SOLO las guardias de 100002 (se agrega un turno nuevo) — las de
  -- 100001 quedan exactamente iguales.
  insert into turnos (legajo, dia, turno, sector, mes, anio) values ('100002', 3, 'n', 'Guardia', 3, 2099);

  v_hash := fn_hash_borrador_turnos(3, 2099, array['Salud Mental','Giratoria','Llaves','Guardia','Estacionamiento','Rondin Externo']);
  select publicacion_id, version into v_pub2, v_version2
    from fn_publicar_guardias('HIGA', 3, 2099, array['Salud Mental','Giratoria','Llaves','Guardia','Estacionamiento','Rondin Externo'], 'ADMIN1', v_version1, v_hash);
  if v_version2 <> 2 then raise exception 'FALLO: esperaba version=2, llegó %', v_version2; end if;

  perform fn_whatsapp_sincronizar_tras_publicar('HIGA', 3, 2099);

  select estado into v_estado_100001 from whatsapp_avisos where legajo='100001' and lugar='HIGA' and mes=3 and anio=2099;
  select estado into v_estado_100002 from whatsapp_avisos where legajo='100002' and lugar='HIGA' and mes=3 and anio=2099;

  if v_estado_100001 <> 'confirmado' then
    raise exception 'FALLO: 100001 (cuyas guardias NO cambiaron) debía CONSERVAR su confirmación, quedó %', v_estado_100001;
  end if;
  if v_estado_100002 <> 'pendiente' then
    raise exception 'FALLO: 100002 (cuyas guardias SÍ cambiaron) debía volver a pendiente, quedó %', v_estado_100002;
  end if;
  raise notice 'OK - fn_whatsapp_sincronizar_tras_publicar: al republicar con cambios SOLO en 100002, 100001 conserva su confirmación intacta y 100002 vuelve a pendiente';

  select count(*) into v_hist_count from whatsapp_avisos_historial
    where legajo='100002' and lugar='HIGA' and mes=3 and anio=2099 and motivo='reset_por_cambio_de_guardias_publicadas' and estado_anterior='confirmado';
  if v_hist_count <> 1 then
    raise exception 'FALLO: debía quedar 1 fila en whatsapp_avisos_historial archivando la confirmación anterior de 100002 (nunca se pierde, solo deja de ser la vigente)';
  end if;
  if exists (select 1 from whatsapp_avisos_historial where legajo='100001' and lugar='HIGA' and mes=3 and anio=2099) then
    raise exception 'FALLO: 100001 no debía generar ninguna fila de historial (su aviso nunca se reseteó)';
  end if;
  raise notice 'OK - fn_whatsapp_sincronizar_tras_publicar: la confirmación anterior de 100002 queda archivada en whatsapp_avisos_historial (antecedente, nunca interpretado como vigente) y 100001 no genera historial (no tuvo reset)';
end $$;

do $$ begin
  raise notice '=== TODAS LAS PRUEBAS DE REGLAS INDIVIDUALES Y AVISOS DE WHATSAPP (SQL, PostgreSQL real) PASARON ===';
end $$;
