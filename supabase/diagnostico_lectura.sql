-- ============================================================================
-- POLAD — Diagnóstico de SOLO LECTURA del esquema y las políticas actuales
-- ============================================================================
-- Para qué sirve: punto 1 de la revisión pide no asumir que las tablas ya
-- están protegidas, y pide consultas de solo lectura si hace falta conocer
-- el esquema o las políticas reales antes de proponer cambios. Este
-- archivo NO modifica nada — ninguna sentencia de acá escribe, crea,
-- borra ni altera datos ni estructuras. Es seguro correrlo en el SQL
-- Editor de Supabase, en el proyecto real, en cualquier momento.
--
-- Cómo usarlo: pegar cada bloque (separados por el comentario "--- #N")
-- en el SQL Editor de Supabase y correrlo. Guardar el resultado de cada
-- uno — esa información es la que hace falta para saber qué políticas
-- existen hoy en turnos/efectivos/disponibilidad/configuracion y las
-- tablas nuevas, antes de aplicar supabase/migrations/0002_rls_propuesta.sql.
-- ============================================================================

--- #1: ¿RLS está activado o desactivado en cada tabla de public?
select
  c.relname as tabla,
  c.relrowsecurity as rls_activado,
  c.relforcerowsecurity as rls_forzado_para_el_dueno
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
order by c.relname;

--- #2: ¿Qué políticas existen hoy, en qué tabla, para qué rol y qué permiten?
select
  schemaname, tablename, policyname, permissive, roles, cmd,
  qual as condicion_using,
  with_check as condicion_with_check
from pg_policies
where schemaname = 'public'
order by tablename, policyname;

--- #3: ¿Qué columnas tiene cada tabla relevante hoy en la base real? (para
--- comparar con el esquema ficticio reconstruido en tests/pg/00_esquema_base_ficticio.sql,
--- y confirmar que las migraciones nuevas asumen las columnas correctas)
select table_name, column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name in ('efectivos','turnos','disponibilidad','configuracion',
                      'asistencia','planilla_manual','firmas',
                      'publicaciones','turnos_publicados','disponibilidad_auditoria')
order by table_name, ordinal_position;

--- #4: ¿Qué privilegios de grant tiene el rol anon (y authenticated) sobre
--- cada tabla? (RLS y GRANT son capas distintas: un select/insert/update
--- denegado por GRANT nunca llega a evaluar las políticas RLS; conviene
--- ver ambas cosas antes de asumir que "RLS activado" ya es protección
--- completa, o que "RLS desactivado" significa necesariamente acceso total
--- si el GRANT ya lo impide)
select grantee, table_name, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and grantee in ('anon', 'authenticated', 'service_role')
order by table_name, grantee, privilege_type;

--- #5: ¿Existen ya las tablas/funciones nuevas de esta etapa en esta base?
--- (para saber si supabase/migrations/0001_borrador_publicacion.sql ya se
--- aplicó alguna vez en este proyecto, antes de volver a aplicarlo)
select 'tabla' as tipo, table_name as nombre
from information_schema.tables
where table_schema = 'public'
  and table_name in ('publicaciones','turnos_publicados','disponibilidad_auditoria')
union all
select 'funcion' as tipo, routine_name as nombre
from information_schema.routines
where routine_schema = 'public'
  and routine_name in (
    'fn_publicar_guardias','fn_guardar_disponibilidad_admin',
    'fn_guardar_disponibilidad_efectivo','fn_hash_borrador_turnos',
    'fn_validar_scope','fn_turnos_permitidos','fn_validar_dias_disponibilidad'
  );
