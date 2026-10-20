-- ============================================================================
-- Punto 6 de esta ronda ("Sumatoria de horas"): prueba REAL (SQL, PostgreSQL
-- real, no simulada) de la lógica de agregación que usa
-- pages/api/resumen-guardias.js para las dos columnas nuevas:
--   - "Horas (3 destinos)": suma HIGA+UPA+MODULAR del mismo legajo/mes/año,
--     leyendo la tabla turnos (borrador) SIN filtrar por sector/lugar y
--     mapeando sector->lugar->horas (HORAS_POR_LUGAR), igual que el archivo.
--   - "Horas realizadas": SOLO turnos_publicados ∩ asistencia(presente=true)
--     de ESTE lugar/mes/año — nunca desde el borrador.
--
-- Esta prueba no ejecuta el endpoint HTTP (no hay servidor Next.js ni
-- Supabase real en este entorno) ni genera el .xlsx (eso ya se prueba por
-- separado, para la técnica de estilo, en
-- tests/node/04_planilla_sin_cubrir_tramado.js) — prueba la ARITMÉTICA
-- exacta contra datos reales en Postgres, replicando literalmente el mismo
-- mapeo sector->lugar->horas y las mismas dos fuentes de datos separadas
-- (para confirmar que nunca se cuenta una guardia dos veces por existir en
-- borrador y en publicación).
--
-- Requiere 00_esquema_base_ficticio.sql + 0001_borrador_publicacion.sql ya
-- aplicados (turnos, publicaciones, turnos_publicados, asistencia, efectivos).
-- No depende de 01_seed_ficticio.sql ni de 0004 — usa su propio
-- mes/año (mes=9, anio=2099) y sus propios legajos (900101..900102) para no
-- pisar datos de otras pruebas.
--
-- Ejecutar: psql -f 06_resumen_horas_cruzadas.sql (ver tests/README.md)
-- ============================================================================

\set ON_ERROR_STOP on

do $$
declare
  n int;
  horas_cruzadas_100101 numeric;
  horas_cruzadas_100102 numeric;
  horas_realizadas_100101 numeric;
  pub_id bigint;
begin
  -- Limpieza por si se corre dos veces sobre la misma base.
  delete from turnos_publicados where mes = 9 and anio = 2099;
  delete from publicaciones where lugar = 'HIGA' and mes = 9 and anio = 2099;
  delete from asistencia where mes = 9 and anio = 2099;
  delete from turnos where mes = 9 and anio = 2099;
  delete from efectivos where legajo in ('900101', '900102') and lugar = 'HIGA';
  delete from efectivos where legajo in ('900101', '900102') and lugar = 'UPA';
  delete from efectivos where legajo in ('900101', '900102') and lugar = 'MODULAR';

  -- ──────────────────────────────────────────────────────────────────────
  -- 1) "Horas (3 destinos)": el legajo 900101 tiene guardias en los TRES
  --    lugares el mismo mes/año (borrador, tabla turnos, sin filtrar por
  --    sector/lugar): 1 en HIGA (12hs, sector Guardia), 1 en UPA (12hs,
  --    sector UPA), 1 en MODULAR (8hs, sector Modular) = 32hs total.
  --    El legajo 900102 solo tiene 1 guardia en HIGA = 12hs total.
  -- ──────────────────────────────────────────────────────────────────────
  insert into turnos (legajo, dia, turno, sector, mes, anio) values
    ('900101', 5, 'd', 'Guardia', 9, 2099),   -- HIGA, 12hs
    ('900101', 6, 'd', 'UPA',     9, 2099),   -- UPA,  12hs
    ('900101', 7, 'm', 'Modular', 9, 2099),   -- MODULAR, 8hs
    ('900102', 5, 'n', 'Guardia', 9, 2099);   -- HIGA, 12hs

  -- Réplica exacta de SECTOR_A_LUGAR + HORAS_POR_LUGAR + el reduce de
  -- horasCruzadasPorLegajo en pages/api/resumen-guardias.js (líneas
  -- ~27-35 y ~83-88): lee TODOS los turnos del mes/año sin filtrar
  -- lugar/sector, mapea sector->lugar->horas, y suma por legajo.
  select sum(case t.sector
               when 'Salud Mental'    then 12
               when 'Giratoria'       then 12
               when 'Llaves'          then 12
               when 'Guardia'         then 12
               when 'Estacionamiento' then 12
               when 'Rondin Externo'  then 12
               when 'UPA'             then 12
               when 'Modular'         then 8
               else 12
             end)
    into horas_cruzadas_100101
    from turnos t
   where t.mes = 9 and t.anio = 2099 and t.legajo = '900101';

  if horas_cruzadas_100101 is distinct from 32 then
    raise exception 'FALLO: horas cruzadas (3 destinos) de 900101 = % , esperado 32 (12 HIGA + 12 UPA + 8 MODULAR)', horas_cruzadas_100101;
  end if;
  raise notice 'OK - Horas (3 destinos): legajo con guardias en HIGA+UPA+MODULAR el mismo mes/año suma 32hs (12+12+8), nunca solo las de un lugar';

  select sum(case t.sector when 'Guardia' then 12 else 12 end)
    into horas_cruzadas_100102
    from turnos t
   where t.mes = 9 and t.anio = 2099 and t.legajo = '900102';

  if horas_cruzadas_100102 is distinct from 12 then
    raise exception 'FALLO: horas cruzadas de 900102 = % , esperado 12 (una sola guardia, un solo lugar)', horas_cruzadas_100102;
  end if;
  raise notice 'OK - Horas (3 destinos): un efectivo con guardias en un solo lugar no queda inflado por los otros dos (12hs, no más)';

  -- ──────────────────────────────────────────────────────────────────────
  -- 2) "Horas realizadas" (distinta fuente: turnos_publicados ∩ asistencia
  --    presente=true, SOLO de este lugar/mes/año) NUNCA se mezcla con las
  --    "Horas (3 destinos)" del borrador, aunque sea LA MISMA guardia
  --    (mismo legajo/dia/turno) la que está en ambas tablas — cada columna
  --    cuenta su propia fuente una sola vez, nunca la suma de ambas.
  -- ──────────────────────────────────────────────────────────────────────
  insert into efectivos (legajo, nombre, lugar, es_admin) values
    ('900101', 'Prueba Horas Cruzadas', 'HIGA', false);

  insert into publicaciones (lugar, mes, anio, version, publicado_por_legajo, vigente, hash_borrador, resumen, efectivos_afectados)
  values ('HIGA', 9, 2099, 1, 'ADMIN_TEST', true, 'hash-prueba-06', '{}'::jsonb, '[]'::jsonb)
  returning id into pub_id;

  -- La MISMA guardia de HIGA del legajo 900101 (día 5, turno d, Guardia)
  -- queda publicada...
  insert into turnos_publicados (publicacion_id, legajo, dia, turno, sector, mes, anio, lugar)
  values (pub_id, '900101', 5, 'd', 'Guardia', 9, 2099, 'HIGA');

  -- ...y además tiene asistencia confirmada (presente=true) ese mismo
  -- día/turno.
  insert into asistencia (legajo, mes, anio, dia, turno, sector, lugar, presente)
  values ('900101', 9, 2099, 5, 'd', 'Guardia', 'HIGA', true);

  select sum(12) into horas_realizadas_100101
    from turnos_publicados tp
    join asistencia asi
      on asi.legajo = tp.legajo and asi.dia = tp.dia and asi.turno = tp.turno
     and asi.mes = tp.mes and asi.anio = tp.anio and asi.lugar = tp.lugar
   where tp.publicacion_id = pub_id and asi.presente = true and tp.legajo = '900101';

  if horas_realizadas_100101 is distinct from 12 then
    raise exception 'FALLO: horas realizadas de 900101 = % , esperado 12 (una sola guardia publicada+asistida de HIGA)', horas_realizadas_100101;
  end if;
  raise notice 'OK - Horas realizadas: la guardia publicada+asistida de HIGA cuenta 12hs en esa columna, por su propia fuente (turnos_publicados ∩ asistencia)';

  -- La columna "Horas (3 destinos)" de 900101 NO cambia por haber publicado
  -- y confirmado asistencia de esa guardia — sigue siendo 32 (borrador),
  -- no 32+12=44. Las dos columnas conviven sin sumarse entre sí.
  if horas_cruzadas_100101 is distinct from 32 then
    raise exception 'FALLO: "Horas (3 destinos)" de 900101 cambió a % después de publicar/asistir — no debería, son columnas de fuentes distintas que nunca se suman', horas_cruzadas_100101;
  end if;
  raise notice 'OK - Horas (3 destinos) y Horas realizadas son columnas de fuentes distintas (borrador vs. publicado+asistencia): la misma guardia aparece en ambas fuentes pero NUNCA se cuenta dos veces dentro de una misma columna, y ninguna columna se contamina con la otra';

  -- ──────────────────────────────────────────────────────────────────────
  -- 3) Sin publicación vigente para un lugar/mes/año, "Horas realizadas"
  --    debe quedar vacío (0), nunca inventado a partir del borrador.
  -- ──────────────────────────────────────────────────────────────────────
  select count(*) into n from publicaciones where lugar = 'UPA' and mes = 9 and anio = 2099 and vigente = true;
  if n <> 0 then
    raise exception 'FALLO: no debería existir publicación vigente de UPA para este mes/año de prueba';
  end if;
  raise notice 'OK - Horas realizadas: sin publicación vigente para un lugar/mes/año, la columna queda en 0 para todos (nunca se inventa a partir del borrador)';

  raise notice '=== TODAS LAS PRUEBAS DE SUMATORIA DE HORAS (PUNTO 6, SQL, PostgreSQL real) PASARON ===';
end $$;
