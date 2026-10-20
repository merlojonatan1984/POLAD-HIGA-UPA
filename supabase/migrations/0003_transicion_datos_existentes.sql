-- ============================================================================
-- POLAD — 0003: transición de los turnos ya existentes al nuevo esquema
-- ============================================================================
-- Estado: PREPARADA, NO EJECUTADA. Requiere que primero se hayan aplicado
-- 0001_borrador_publicacion.sql (y, si se decide, 0002_rls_propuesta.sql),
-- y que se hayan probado en un entorno aislado antes de tocar la base real
-- (ver el punto 8 de esta revisión y RESUMEN_CORRECCION.md).
--
-- REVISIÓN de este archivo — qué cambió y por qué:
--   1) La versión anterior llamaba a fn_publicar_guardias con una firma
--      vieja (9 parámetros, incluía p_resumen/p_efectivos_afectados). La
--      firma ACTUAL (ver 0001_borrador_publicacion.sql) tiene 7 parámetros
--      — (lugar, mes, anio, sectores, publicado_por_legajo, version_base,
--      hash_borrador) — y calcula resumen/efectivos_afectados ella misma.
--      Este archivo se actualizó para llamarla así.
--   2) Punto 7 de esta revisión: "La transición debe permitir seleccionar
--      expresamente los períodos ya comunicados, sin publicar
--      automáticamente meses en preparación." La versión anterior tenía un
--      "CAMINO A" que publicaba TODO período con turnos cargados, sin
--      distinguir uno ya comunicado de un mes todavía en armado — eso es
--      exactamente lo que este punto pide evitar. Se eliminó ese camino.
--      Lo que queda es UN solo mecanismo: una lista explícita de períodos
--      (lugar, mes, año) que se completa a mano, abajo, después de mirar
--      el diagnóstico del paso 0 — nada se publica que no esté en esa
--      lista.
--
-- EL PROBLEMA QUE RESUELVE ESTE ARCHIVO:
-- Con el esquema nuevo, un efectivo solo ve guardias que estén en
-- turnos_publicados (bajo una publicación vigente). Hoy, ANTES de este
-- cambio, un efectivo ve sus turnos apenas se cargan (no existe el concepto
-- de "borrador"). Si no se hace nada, el día que se active el código nuevo,
-- todos los turnos ya cargados "desaparecerían" de la vista del efectivo
-- hasta que un administrador los publique a mano — lo cual puede ser
-- correcto para algunos períodos (ej. un mes futuro que todavía se está
-- armando) pero incorrecto para otros (ej. un mes ya comunicado, que los
-- efectivos ya venían viendo con normalidad).
--
-- PASO 0 — DIAGNÓSTICO (ejecutar esto primero, es de solo lectura):
-- ----------------------------------------------------------------------------
select
  case
    when t.sector in ('UPA') then 'UPA'
    when t.sector in ('Modular') then 'MODULAR'
    else 'HIGA'
  end                               as lugar,
  t.mes,
  t.anio,
  count(*)                          as cantidad_turnos,
  count(distinct t.legajo)          as efectivos_distintos,
  min(t.dia)                        as primer_dia,
  max(t.dia)                        as ultimo_dia
from turnos t
group by 1, t.mes, t.anio
order by t.anio, t.mes, lugar;

-- Mirá el resultado de esa consulta junto con la tabla "configuracion"
-- (ventanas de inscripción) para decidir, período por período, si:
--   (a) ya fue comunicado a los efectivos (ya lo venían viendo con el
--       esquema viejo) y conviene publicarlo tal cual está hoy, o
--   (b) todavía se está armando / es un mes futuro / nunca se terminó de
--       comunicar, y debe quedar como borrador sin publicar — para que un
--       administrador lo revise y publique cuando esté listo, con el
--       panel normal.
--
-- NOTA: se usa un CASE sobre t.sector (igual que SECTORES_POR_LUGAR en el
-- código) para derivar el lugar, en vez de una columna "lugar" en turnos —
-- confirmado contra tests/pg/00_esquema_base_ficticio.sql y el código de
-- pages/admin.js que la tabla turnos no tiene esa columna.

-- ----------------------------------------------------------------------------
-- PASO 1 — completar a mano, con los períodos que de verdad se decidió
-- publicar (ver el diagnóstico de arriba). Un período que NO se liste acá
-- queda sin publicar — sigue como borrador, exactamente igual que si fuera
-- un mes nuevo en preparación. No hay ningún camino en este archivo que
-- publique algo que no esté explícitamente en esta lista.
-- ----------------------------------------------------------------------------
-- Descomentar y completar con los períodos reales antes de ejecutar esta
-- sección. Ejemplo (borrar antes de usar en serio):
--   insert into pg_temp.periodos_a_publicar (lugar, mes, anio) values
--     ('HIGA', 10, 2026),
--     ('UPA', 10, 2026);
--
-- create temporary table periodos_a_publicar (lugar text, mes int, anio int);
-- -- (SIN "on commit drop": cada statement de este script corre en su propia
-- -- transacción autocommit por defecto en psql, así que "on commit drop"
-- -- borraría la tabla temporal apenas termina el create — ANTES de poder
-- -- insertar nada. Sin esa cláusula, la tabla dura toda la sesión de psql,
-- -- que es exactamente lo que hace falta para este script de un solo uso;
-- -- se borra sola al cerrar la sesión.)
--
-- insert into periodos_a_publicar (lugar, mes, anio) values
--   -- ('HIGA', 10, 2026),
--   -- ('UPA', 10, 2026),
--   -- ('MODULAR', 10, 2026)
-- ;
--
-- do $$
-- declare
--   r record;
--   v_sectores text[];
--   v_hash text;
--   v_resultado record;
-- begin
--   for r in select * from periodos_a_publicar loop
--     v_sectores := case r.lugar
--       when 'HIGA' then array['Salud Mental','Giratoria','Llaves','Guardia','Estacionamiento','Rondin Externo']
--       when 'UPA' then array['UPA']
--       when 'MODULAR' then array['Modular']
--       else null
--     end;
--     if v_sectores is null then
--       raise exception 'lugar_invalido en periodos_a_publicar: %', r.lugar;
--     end if;
--
--     -- El hash se calcula ACÁ MISMO, justo antes de publicar, con la
--     -- firma actual del borrador — fn_publicar_guardias lo vuelve a
--     -- comprobar dentro de la transacción (ver 0001), así que tiene que
--     -- coincidir con lo que haya en turnos en este momento, no con un
--     -- valor viejo copiado de otro lado.
--     v_hash := fn_hash_borrador_turnos(r.mes, r.anio, v_sectores);
--
--     -- version_base = 0 porque, por definición, un período que está en
--     -- esta transición todavía no tiene ninguna publicación previa — si
--     -- ya tuviera una, fn_publicar_guardias la va a rechazar con
--     -- publicacion_desactualizada (0 <> version_vigente_actual), que es
--     -- exactamente la protección correcta: evita duplicar una
--     -- publicación que, por la razón que sea, ya exista para ese período.
--     select * into v_resultado from fn_publicar_guardias(
--       r.lugar, r.mes, r.anio, v_sectores, 'migracion_inicial', 0, v_hash
--     );
--     raise notice 'Publicado % %/% como versión % (publicacion_id=%)',
--       r.lugar, r.mes, r.anio, v_resultado.version, v_resultado.publicacion_id;
--   end loop;
-- end $$;

-- ----------------------------------------------------------------------------
-- Verificado contra polad_test (ver tests/pg/): con una base recién armada
-- (sin publicaciones previas), listar un período en periodos_a_publicar y
-- correr el bloque del PASO 1 publica correctamente la versión 1 de ese
-- período, con todos sus turnos copiados a turnos_publicados; si ese
-- período ya tenía una publicación vigente, fn_publicar_guardias rechaza
-- con publicacion_desactualizada en vez de duplicarla — confirmado con los
-- dos casos reales, no solo asumido.
--
-- Lo que este archivo NUNCA hace, por diseño:
--   - No borra ni modifica ninguna fila de turnos.
--   - No borra ni modifica disponibilidad, asistencia, firmas ni
--     planilla_manual.
--   - No inventa datos: solo copia lo que ya existe en turnos hacia
--     turnos_publicados, tal cual está, para los períodos EXPLÍCITAMENTE
--     listados en periodos_a_publicar.
--   - No publica ningún período que no haya sido listado a mano en el
--     PASO 1 — en particular, nunca publica automáticamente un mes
--     todavía en preparación.
--   - No se ejecuta solo: alguien con acceso a la base debe completar la
--     lista de períodos y descomentar el bloque del PASO 1 a propósito.
-- ============================================================================
