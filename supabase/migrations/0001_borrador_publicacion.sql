-- ============================================================================
-- POLAD — Migración 0001: separar carga/borrador/publicación de guardias
-- ============================================================================
-- Estado: PREPARADA, NO APLICADA a ninguna base real. Probada contra un
-- PostgreSQL 16 real, local y descartable, con datos ficticios (ver
-- tests/pg/README.md en esta entrega) — no contra el proyecto de Supabase.
--
-- Revisión 2 de este archivo: corrige dos problemas de la primera versión
-- que una revisión posterior detectó y que NO estaban realmente resueltos
-- a pesar de lo que decía la entrega anterior:
--   1) La comprobación de "¿cambió esto desde que lo leí?" (concurrencia
--      optimista) se hacía en el código de Node, leyendo el estado y
--      recién después llamando a esta función — quedaba una ventana de
--      carrera entre esa lectura y la escritura. Ahora la comprobación se
--      hace DENTRO de esta misma función, bajo un lock, en la misma
--      transacción que escribe.
--   2) No había nada que impidiera que un doble clic (o un reintento tras
--      un corte de red) publicara dos veces. Ahora, publicar exige pasar
--      la versión vigente que el administrador revisó antes de confirmar
--      (version_base) y el hash del borrador que vio (hash_borrador); si
--      cualquiera de los dos ya no coincide con el estado actual —porque
--      alguien publicó mientras tanto, porque el borrador cambió, o porque
--      es un reintento de una publicación que ya se hizo— la función
--      rechaza explícitamente en vez de publicar de nuevo o pisar algo que
--      el administrador no llegó a revisar.
--
-- Revisión 3 (esta ronda — "cerrar la etapa para pasar a prueba en entorno
-- aislado"), tres funciones nuevas/corregidas, todas sobre el mismo
-- problema de fondo: una operación que se veía atómica en SQL dejaba de
-- serlo en la práctica porque el estado se leía/escribía en más de un paso,
-- sin coordinar esos pasos con el resto de las escrituras del borrador:
--   3) fn_resumen_publicacion (nueva): el preview de publicación (resumen +
--      versión vigente + hash) se calculaba con varias consultas separadas
--      desde Node, sin ningún lock — el borrador podía cambiar a mitad de
--      camino y el hash devuelto podía no corresponder al resumen mostrado.
--      Ahora es una sola función SQL, bajo el mismo lock que el borrador,
--      y fn_publicar_guardias la reutiliza en vez de duplicar el cálculo.
--   4) fn_turnos_borrador_reemplazar_scope (nueva): "regenerar turnos"
--      borraba el scope y recién después insertaba el lote nuevo, como dos
--      pedidos HTTP separados — el scope quedaba vacío, de verdad, entre
--      ambos, publicable por cualquier otra sesión. Ahora es una sola
--      función (un solo lock, una sola transacción): si algo falla, el
--      borrador anterior queda intacto, nunca a medias.
--   5) fn_turnos_borrador_renombrar_legajo (corregida) y
--      fn_admin_guardar_efectivo (nueva): el renombrado de un legajo no
--      coordinaba con fn_lock_turnos_borrador (lock distinto) ni respetaba
--      el lugar de la sesión (renombraba en TODOS los lugares). Ahora se
--      acota a p_lugar y toma los locks de scope afectados en orden
--      consistente; y la edición del efectivo + el renombrado de sus
--      turnos pasan a ser una sola transacción (antes eran dos pedidos
--      HTTP separados, con el segundo pedido para turnos corriendo con los
--      errores ignorados a propósito).
--
-- Este archivo sigue siendo 100% ADITIVO: crea tablas y funciones nuevas.
-- No modifica, no borra ni renombra ninguna tabla, columna o fila existente
-- (efectivos, turnos, disponibilidad, asistencia, configuracion, firmas,
-- planilla_manual quedan intactas en su forma actual; disponibilidad solo
-- gana columnas nuevas, todas opcionales).
--
-- Cómo aplicarla (cuando el administrador de la base lo decida, fuera de
-- este trabajo): pegar este archivo completo en el SQL Editor de Supabase
-- del proyecto, revisarlo, y ejecutarlo. Probarlo primero en un proyecto
-- Supabase de prueba con datos ficticios, nunca directo en el proyecto real.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Auditoría de cambios de disponibilidad hechos por un administrador
--    (carga "fuera de término" sin reabrir la inscripción general).
-- ----------------------------------------------------------------------------
create table if not exists disponibilidad_auditoria (
  id                    bigserial primary key,
  legajo                text not null,
  lugar                 text not null,
  mes                   int not null,
  anio                  int not null,
  modificado_por_legajo text not null,          -- legajo del administrador que hizo el cambio
  modificado_en         timestamptz not null default now(),
  dias_antes            jsonb not null default '{}'::jsonb,   -- snapshot { "5": "d", "6": "dn", ... }
  dias_despues          jsonb not null default '{}'::jsonb,
  motivo                text,
  advertencias          jsonb not null default '[]'::jsonb,   -- conflictos detectados con guardias ya asignadas
  origen                text not null default 'admin_fuera_de_termino'
);

create index if not exists idx_disp_auditoria_scope
  on disponibilidad_auditoria (lugar, mes, anio, legajo);

comment on table disponibilidad_auditoria is
  'Registro de quién, cuándo y qué modificó cuando un administrador carga o corrige la disponibilidad de un efectivo fuera de la ventana de inscripción. Nunca se borra ni se sobrescribe: cada cambio agrega una fila nueva. Se escribe en la MISMA transacción que el cambio de disponibilidad (ver fn_guardar_disponibilidad_admin): si la auditoría falla, la disponibilidad tampoco se guarda.';

-- ----------------------------------------------------------------------------
-- 2) Columnas nuevas (nullable) en disponibilidad para saber quién cargó
--    cada fila y por qué vía, sin romper nada de lo existente.
-- ----------------------------------------------------------------------------
alter table disponibilidad add column if not exists cargado_por_legajo text;
alter table disponibilidad add column if not exists cargado_en timestamptz;
alter table disponibilidad add column if not exists origen text default 'efectivo';

comment on column disponibilidad.cargado_por_legajo is
  'Legajo de quien escribió esta fila: el propio efectivo, o el legajo del administrador si fue una carga fuera de término.';
comment on column disponibilidad.origen is
  E'\'efectivo\' (carga normal dentro de la ventana) o \'admin_fuera_de_termino\' (cargada/corregida por un administrador).';

-- ----------------------------------------------------------------------------
-- 3) Publicaciones: un registro por cada vez que un admin publica las
--    guardias de un lugar+mes+año. Versionado, nunca se borra ni se pisa.
-- ----------------------------------------------------------------------------
create table if not exists publicaciones (
  id                    bigserial primary key,
  lugar                 text not null,
  mes                   int not null,
  anio                  int not null,
  version               int not null,
  publicado_por_legajo  text not null,
  publicado_en          timestamptz not null default now(),
  vigente               boolean not null default true,   -- true = es la versión visible para los efectivos
  hash_borrador         text not null,                    -- huella del estado de "turnos" en el momento de publicar
  resumen               jsonb not null default '{}'::jsonb,  -- conteos: total turnos, por sector, etc.
  efectivos_afectados   jsonb not null default '[]'::jsonb,  -- [{ legajo, tipo_cambio: 'nuevo'|'modificado'|'sin_cambios'|'eliminado' }]
  unique (lugar, mes, anio, version)
);

-- Garantiza que, para un mismo lugar+mes+año, haya como máximo UNA publicación
-- vigente a la vez (la última). Esto es lo que lee el efectivo.
create unique index if not exists idx_publicaciones_vigente_unica
  on publicaciones (lugar, mes, anio)
  where vigente;

create index if not exists idx_publicaciones_scope
  on publicaciones (lugar, mes, anio, version desc);

comment on table publicaciones is
  'Un registro por cada publicación de guardias (lugar+mes+año+versión). vigente=true marca la última versión, que es la que ve el efectivo. Las versiones anteriores quedan en vigente=false como historial, nunca se borran.';

-- ----------------------------------------------------------------------------
-- 4) Snapshot de los turnos publicados: la "foto" de la tabla turnos en el
--    momento de publicar. Es lo único que el efectivo puede leer para ver
--    SUS guardias. turnos (la tabla existente) sigue siendo el borrador de
--    trabajo del administrador, sin cambios de significado ni de estructura.
-- ----------------------------------------------------------------------------
create table if not exists turnos_publicados (
  id              bigserial primary key,
  publicacion_id  bigint not null references publicaciones(id) on delete cascade,
  legajo          text not null,
  dia             int not null,
  turno           text not null,
  sector          text not null,
  mes             int not null,
  anio            int not null,
  lugar           text not null,
  creado_en       timestamptz not null default now()
);

create index if not exists idx_turnos_publicados_publicacion on turnos_publicados (publicacion_id);
create index if not exists idx_turnos_publicados_legajo on turnos_publicados (lugar, mes, anio, legajo);
create index if not exists idx_turnos_publicados_vigencia on turnos_publicados (legajo, dia, mes, anio);

comment on table turnos_publicados is
  'Copia congelada de los turnos de una publicación concreta. Nunca se actualiza en el lugar: una nueva publicación crea filas nuevas bajo un publicacion_id nuevo. Usa las mismas columnas naturales (legajo, dia, turno, sector, mes, anio, lugar) que la tabla turnos, para no romper los vínculos existentes con asistencia/planillas, que relacionan por estas columnas y no por un id numérico. El webhook de WhatsApp (confirmación de presencia) y el mensaje manual de WhatsApp del panel deben leer de aquí, nunca de turnos.';

-- ----------------------------------------------------------------------------
-- 5) Validaciones compartidas (lugar/mes/año/turno/día real del mes), para
--    no duplicar la misma lógica en cada función y para que la validación
--    exista también del lado de la base, no solo en el código de Node.
-- ----------------------------------------------------------------------------
create or replace function fn_validar_scope(p_lugar text, p_mes int, p_anio int)
returns void
language plpgsql
immutable
as $$
begin
  if p_lugar is null or p_lugar not in ('HIGA', 'UPA', 'MODULAR') then
    raise exception using errcode = 'P0001', message = 'lugar_invalido', detail = coalesce(p_lugar, '(null)');
  end if;
  if p_mes is null or p_mes < 1 or p_mes > 12 then
    raise exception using errcode = 'P0001', message = 'mes_invalido', detail = coalesce(p_mes::text, '(null)');
  end if;
  if p_anio is null or p_anio < 2000 or p_anio > 2100 then
    raise exception using errcode = 'P0001', message = 'anio_invalido', detail = coalesce(p_anio::text, '(null)');
  end if;
end;
$$;

-- Turnos permitidos por lugar: HIGA/UPA son día/noche (y su combinación);
-- MODULAR es mañana/tarde/noche (y combinaciones). Coincide con
-- TURNOS_CONFIG_MAP de components/EfectivoApp.js.
create or replace function fn_turnos_permitidos(p_lugar text)
returns text[]
language sql
immutable
as $$
  select case
    when p_lugar = 'MODULAR' then array['m','t','n','mt','mn','tn','mtn']
    else array['d','n','dn']
  end;
$$;

-- Valida que cada entrada de un mapa { "dia": "turno" } tenga un día real
-- para ese mes/año y un turno permitido para ese lugar. Lanza excepción en
-- la primera que no cumpla.
create or replace function fn_validar_dias_disponibilidad(p_dias jsonb, p_lugar text, p_mes int, p_anio int)
returns void
language plpgsql
immutable
as $$
declare
  v_dia text;
  v_turno text;
  v_ultimo_dia int;
  v_permitidos text[];
begin
  v_ultimo_dia := extract(day from (date_trunc('month', make_date(p_anio, p_mes, 1)) + interval '1 month - 1 day'))::int;
  v_permitidos := fn_turnos_permitidos(p_lugar);
  for v_dia, v_turno in select * from jsonb_each_text(p_dias)
  loop
    if v_dia !~ '^[0-9]+$' or v_dia::int < 1 or v_dia::int > v_ultimo_dia then
      raise exception using errcode = 'P0001', message = 'dia_invalido', detail = format('dia=%s mes=%s anio=%s ultimo_dia_del_mes=%s', v_dia, p_mes, p_anio, v_ultimo_dia);
    end if;
    if v_turno is null or v_turno = '' or not (v_turno = any(v_permitidos)) then
      raise exception using errcode = 'P0001', message = 'turno_invalido', detail = format('turno=%s lugar=%s permitidos=%s', v_turno, p_lugar, v_permitidos);
    end if;
  end loop;
end;
$$;

comment on function fn_validar_scope is 'Valida lugar (HIGA/UPA/MODULAR), mes (1-12) y año (2000-2100). Lanza excepción con message en {lugar_invalido, mes_invalido, anio_invalido} si algo no es válido.';
comment on function fn_validar_dias_disponibilidad is 'Valida que cada día de un mapa {dia: turno} exista realmente en ese mes/año y que el turno sea uno de los permitidos para ese lugar.';

-- Qué sectores pertenecen a cada lugar — mismo mapeo que SECTORES_POR_LUGAR
-- en pages/admin.js / pages/api/publicar-guardias.js. Se usa para que un
-- administrador de un lugar no pueda, por error o a propósito, operar sobre
-- sectores de otro lugar a través de los endpoints nuevos de turnos.
create or replace function fn_sectores_de_lugar(p_lugar text)
returns text[]
language sql
immutable
as $$
  select case p_lugar
    when 'HIGA' then array['Salud Mental','Giratoria','Llaves','Guardia','Estacionamiento','Rondin Externo']
    when 'UPA' then array['UPA']
    when 'MODULAR' then array['Modular']
    else array[]::text[]
  end;
$$;

-- Valida que cada sector de p_sectores pertenezca de verdad a p_lugar.
-- Lanza sector_invalido si alguno no corresponde.
create or replace function fn_validar_sectores_de_lugar(p_lugar text, p_sectores text[])
returns void
language plpgsql
immutable
as $$
declare
  v_permitidos text[];
  v_sector text;
begin
  v_permitidos := fn_sectores_de_lugar(p_lugar);
  if p_sectores is null then return; end if;
  foreach v_sector in array p_sectores loop
    if not (v_sector = any(v_permitidos)) then
      raise exception using errcode = 'P0001', message = 'sector_invalido',
        detail = format('sector=%s no pertenece a lugar=%s (permitidos=%s)', v_sector, p_lugar, v_permitidos);
    end if;
  end loop;
end;
$$;

-- ----------------------------------------------------------------------------
-- 6) Huella del estado actual de "turnos" (el borrador) para un
--    lugar+mes+año. La usan tanto el preview (GET /api/publicar-guardias)
--    como la publicación (POST), para poder comparar exactamente lo mismo
--    sin duplicar la fórmula en JavaScript y en SQL por separado.
-- ----------------------------------------------------------------------------
create or replace function fn_hash_borrador_turnos(p_mes int, p_anio int, p_sectores text[])
returns text
language sql
stable
as $$
  select md5(coalesce(
    string_agg(legajo || '|' || dia || '|' || turno || '|' || sector, ',' order by legajo, dia, turno, sector),
    ''
  ))
  from turnos
  where mes = p_mes and anio = p_anio and sector = any(p_sectores);
$$;

comment on function fn_hash_borrador_turnos is
  'Huella estable del contenido actual de turnos (el borrador) para un mes/año/conjunto de sectores. Si el borrador cambia, esta huella cambia. Se usa para detectar, dentro de la transacción de publicar, si el borrador que el administrador revisó sigue siendo el actual.';

-- ----------------------------------------------------------------------------
-- 7) Función transaccional: publicar guardias de forma atómica, con
--    re-verificación dentro de la misma transacción y protección contra
--    publicaciones duplicadas (doble clic / reintento).
--
--    p_version_base: la versión que estaba vigente (0 si no había ninguna)
--      cuando el administrador vio el resumen que está confirmando.
--    p_hash_borrador: la huella de fn_hash_borrador_turnos que el
--      administrador vio en ese mismo momento.
--
--    Si CUALQUIERA de los dos ya no coincide con el estado actual en el
--    momento de publicar, no se publica nada y se informa con un mensaje
--    explícito para que el administrador vuelva a revisar.
-- ----------------------------------------------------------------------------
-- Clave de lock COMPARTIDA para coordinar, por lugar+mes+año, la
-- publicación con las escrituras al borrador (turnos). Punto 5 de la
-- revisión: antes el lock de publicar solo serializaba publicaciones
-- ENTRE SÍ — no coordinaba nada con una edición del borrador que llegara
-- justo entre que fn_publicar_guardias comprobaba el hash y copiaba las
-- filas a turnos_publicados (una ventana de carrera real, aunque corta).
-- Ahora TODA escritura al borrador para ese lugar/mes/año (ver las
-- funciones fn_turnos_borrador_* más abajo) toma este mismo lock antes de
-- escribir, así que mientras una publicación esté en curso, ninguna
-- edición del borrador para ese mismo scope puede intercalarse — espera a
-- que la publicación termine su transacción, y recién entonces escribe
-- sobre el estado ya publicado.
create or replace function fn_lock_turnos_borrador(p_lugar text, p_mes int, p_anio int)
returns void
language plpgsql
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('turnos:' || p_lugar || ':' || p_mes || ':' || p_anio, 0));
end;
$$;

-- ----------------------------------------------------------------------------
-- 6b) Resumen de publicación: versión vigente, hash del borrador y el diff
--     (resumen + efectivos afectados), todo calculado de UN MISMO estado
--     consistente. Punto 1 de esta ronda de revisión: antes,
--     pages/api/publicar-guardias.js (calcularDiff) hacía esto con VARIAS
--     consultas Supabase separadas desde Node — leía turnos, después la
--     publicación vigente, después turnos_publicados, y recién al final
--     pedía el hash con una llamada RPC aparte. Entre la primera lectura y
--     la del hash, el borrador podía cambiar (otra escritura, sin ningún
--     lock de por medio desde el lado de Node) — el administrador podía
--     terminar viendo un resumen calculado sobre un estado, pero con un
--     hash de un estado DISTINTO, posterior. Como luego el hash es
--     exactamente lo que fn_publicar_guardias vuelve a comprobar al
--     confirmar, ese hash "adelantado" podía describir un borrador que el
--     resumen mostrado nunca llegó a reflejar.
--
--     Ahora todo esto es UNA sola función SQL, que toma el mismo lock que
--     fn_publicar_guardias y las escrituras del borrador
--     (fn_lock_turnos_borrador) ANTES de leer nada: mientras se calcula el
--     resumen, ninguna escritura del borrador para ese lugar/mes/año puede
--     intercalarse (espera a que esta función termine su transacción), así
--     que versión vigente, hash y resumen salen siempre del mismo estado.
--     fn_publicar_guardias (más abajo) llama a ESTA MISMA función para su
--     propio cálculo — una sola fórmula, no dos que puedan desincronizarse.
-- ----------------------------------------------------------------------------
create or replace function fn_resumen_publicacion(
  p_lugar text,
  p_mes int,
  p_anio int,
  p_sectores text[]
)
returns table (version_base int, hash_borrador text, resumen jsonb, efectivos_afectados jsonb)
language plpgsql
as $$
declare
  v_vigente_id bigint;
  v_vigente_version int;
  v_vigente_publicado_en timestamptz;
  v_hash_actual text;
  v_total_actual int;
  v_total_previo int;
  v_efectivos_afectados jsonb;
  v_resumen jsonb;
begin
  perform fn_validar_scope(p_lugar, p_mes, p_anio);
  if p_sectores is null or array_length(p_sectores, 1) is null then
    raise exception using errcode = 'P0001', message = 'sectores_invalidos';
  end if;

  -- Mismo lock que toman fn_publicar_guardias y las escrituras del borrador
  -- — ver el comentario de arriba y el de fn_lock_turnos_borrador. Esto es
  -- lo que coordina el preview con las escrituras del borrador (punto 1):
  -- mientras este resumen se calcula, nada puede escribir el borrador de
  -- este lugar/mes/año, y viceversa.
  perform fn_lock_turnos_borrador(p_lugar, p_mes, p_anio);

  -- Calificado con el nombre de la tabla: esta función devuelve una
  -- columna de salida que también se llama "version_base"/"hash_borrador",
  -- y "version"/"publicacion_id" chocan con columnas reales de
  -- publicaciones/turnos_publicados — sin calificar, Postgres no sabe a
  -- cuál se refiere ("column reference is ambiguous").
  select publicaciones.id, publicaciones.version, publicaciones.publicado_en
    into v_vigente_id, v_vigente_version, v_vigente_publicado_en
    from publicaciones
   where lugar = p_lugar and mes = p_mes and anio = p_anio and vigente = true;

  v_hash_actual := fn_hash_borrador_turnos(p_mes, p_anio, p_sectores);

  with actual as (
    select legajo,
           string_agg(legajo || '|' || dia || '|' || turno || '|' || sector, ',' order by dia, turno, sector) as firma
      from turnos
     where mes = p_mes and anio = p_anio and sector = any(p_sectores)
     group by legajo
  ),
  previo as (
    select legajo,
           string_agg(legajo || '|' || dia || '|' || turno || '|' || sector, ',' order by dia, turno, sector) as firma
      from turnos_publicados
     where turnos_publicados.publicacion_id = v_vigente_id  -- null si no hay vigente -> 0 filas, correcto
     group by legajo
  ),
  diff as (
    select coalesce(a.legajo, p.legajo) as legajo,
           case when p.legajo is null then 'nuevo'
                when a.legajo is null then 'eliminado'
                else 'modificado' end as tipo_cambio
      from actual a
      full outer join previo p on a.legajo = p.legajo
     where coalesce(a.firma, '') is distinct from coalesce(p.firma, '')
  )
  select coalesce(jsonb_agg(jsonb_build_object('legajo', legajo, 'tipo_cambio', tipo_cambio)), '[]'::jsonb)
    into v_efectivos_afectados
    from diff;

  select count(*) into v_total_actual from turnos where mes = p_mes and anio = p_anio and sector = any(p_sectores);
  select count(*) into v_total_previo from turnos_publicados where turnos_publicados.publicacion_id = v_vigente_id;

  v_resumen := jsonb_build_object(
    'version_anterior', v_vigente_version,
    'publicado_anteriormente_en', v_vigente_publicado_en,
    'total_turnos_actuales', v_total_actual,
    'total_turnos_version_anterior', v_total_previo,
    'hay_cambios', (jsonb_array_length(v_efectivos_afectados) > 0) or (v_vigente_id is null)
  );

  return query select coalesce(v_vigente_version, 0), v_hash_actual, v_resumen, v_efectivos_afectados;
end;
$$;

comment on function fn_resumen_publicacion is
  'Calcula, de un mismo estado consistente y bajo el lock compartido con el borrador (fn_lock_turnos_borrador), la versión vigente, el hash del borrador y el resumen/diff de una publicación. La usan tanto el preview (GET /api/publicar-guardias) como fn_publicar_guardias, para que nunca haya dos cálculos que puedan desincronizarse por una escritura intercalada del borrador.';

create or replace function fn_publicar_guardias(
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
declare
  v_version int;
  v_publicacion_id bigint;
  v_vigente_id bigint;
  v_version_vigente int;
  v_hash_actual text;
  v_resumen jsonb;
  v_efectivos_afectados jsonb;
begin
  -- fn_resumen_publicacion ya valida scope/sectores y toma
  -- fn_lock_turnos_borrador (el lock se mantiene durante TODA esta
  -- transacción, no solo durante esa llamada) — con eso, versión vigente,
  -- hash y resumen/diff se calculan de un mismo estado consistente, con la
  -- MISMA fórmula que usa el preview (punto 1 de esta ronda: antes había
  -- código duplicado, en Node y en SQL, que calculaba lo mismo de dos
  -- formas distintas).
  select r.version_base, r.hash_borrador, r.resumen, r.efectivos_afectados
    into v_version_vigente, v_hash_actual, v_resumen, v_efectivos_afectados
    from fn_resumen_publicacion(p_lugar, p_mes, p_anio, p_sectores) r;

  -- Re-verificación: si la versión vigente ya no es la que el administrador
  -- revisó (alguien publicó mientras tanto, o esto es un reintento de una
  -- publicación que ya ocurrió), o si el borrador cambió desde que se
  -- mostró el resumen, se rechaza — nunca se publica "a ciegas" ni se
  -- publica dos veces lo mismo. Como el hash/versión que se comparan acá
  -- son los mismos que vio el preview (misma función, mismo lock), esto
  -- también cubre "al confirmar, se publica EXACTAMENTE el estado
  -- revisado, o se rechaza por desactualización" — nunca algo intermedio.
  if v_version_vigente <> coalesce(p_version_base, 0) then
    raise exception using
      errcode = 'P0001',
      message = 'publicacion_desactualizada',
      detail = format('version_vigente_actual=%s version_revisada=%s', v_version_vigente, coalesce(p_version_base, 0));
  end if;

  if v_hash_actual <> coalesce(p_hash_borrador, '') then
    raise exception using
      errcode = 'P0001',
      message = 'borrador_desactualizado',
      detail = 'El borrador (tabla turnos) cambió desde que se generó el resumen que se está confirmando.';
  end if;

  -- Calificado con el nombre de la tabla: esta función devuelve una columna
  -- que también se llama "publicacion_id" (RETURNS TABLE) — sin calificar,
  -- Postgres no sabe si se refiere a esa salida o a la columna de la tabla.
  select publicaciones.id into v_vigente_id
    from publicaciones
   where lugar = p_lugar and mes = p_mes and anio = p_anio and vigente = true;

  v_version := v_version_vigente + 1;

  if v_vigente_id is not null then
    update publicaciones set vigente = false where id = v_vigente_id;
  end if;

  insert into publicaciones (lugar, mes, anio, version, publicado_por_legajo, hash_borrador, resumen, efectivos_afectados, vigente)
  values (p_lugar, p_mes, p_anio, v_version, p_publicado_por_legajo, v_hash_actual, v_resumen, v_efectivos_afectados, true)
  returning id into v_publicacion_id;

  insert into turnos_publicados (publicacion_id, legajo, dia, turno, sector, mes, anio, lugar)
  select v_publicacion_id, t.legajo, t.dia, t.turno, t.sector, t.mes, t.anio, p_lugar
    from turnos t
   where t.mes = p_mes and t.anio = p_anio and t.sector = any(p_sectores);

  return query select v_publicacion_id, v_version, v_resumen, v_efectivos_afectados;
end;
$$;

comment on function fn_publicar_guardias is
  'Publica de forma atómica (todo o nada) el estado actual de turnos como una nueva versión visible para los efectivos. Usa fn_resumen_publicacion (que toma fn_lock_turnos_borrador antes de leer nada) para obtener versión vigente/hash/resumen de un mismo estado consistente, con la misma fórmula que ve el preview. Re-verifica que ese estado siga siendo el que el administrador revisó antes de confirmar; si no, rechaza con publicacion_desactualizada o borrador_desactualizado — nunca publica algo distinto de lo revisado. Esto mismo evita que un doble clic o un reintento generen una publicación duplicada. No borra ni modifica la tabla turnos.';

-- ----------------------------------------------------------------------------
-- 7b) Escrituras al BORRADOR (turnos), con el mismo lock que usa
--     fn_publicar_guardias para ese lugar+mes+año (fn_lock_turnos_borrador).
--     Punto 1 y 5 de la revisión: estas funciones son las que, junto con
--     pages/api/admin-turnos.js, reemplazan los ~20 puntos de admin.js que
--     escribían la tabla turnos directo con la clave anon pública — y,
--     tomando el mismo lock que la publicación, cierran la ventana de
--     carrera entre editar el borrador y publicar (ver el comentario de
--     fn_lock_turnos_borrador más arriba).
-- ----------------------------------------------------------------------------

-- Inserta un lote de turnos del borrador. p_turnos es un array jsonb de
-- objetos {legajo, dia, turno, sector} — SIN id (lo genera la tabla).
create or replace function fn_turnos_borrador_insertar(
  p_lugar text,
  p_mes int,
  p_anio int,
  p_turnos jsonb
)
returns int  -- cantidad de filas insertadas
language plpgsql
as $$
declare
  v_sectores text[];
  v_count int;
begin
  perform fn_validar_scope(p_lugar, p_mes, p_anio);
  if p_turnos is null or jsonb_typeof(p_turnos) <> 'array' then
    raise exception using errcode = 'P0001', message = 'turnos_invalidos', detail = 'p_turnos debe ser un array jsonb';
  end if;

  select array_agg(distinct x.sector) into v_sectores
    from jsonb_to_recordset(p_turnos) as x(legajo text, dia int, turno text, sector text);
  perform fn_validar_sectores_de_lugar(p_lugar, v_sectores);

  perform fn_lock_turnos_borrador(p_lugar, p_mes, p_anio);

  insert into turnos (legajo, dia, turno, sector, mes, anio)
  select x.legajo, x.dia, x.turno, x.sector, p_mes, p_anio
    from jsonb_to_recordset(p_turnos) as x(legajo text, dia int, turno text, sector text);

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function fn_turnos_borrador_insertar is
  'Inserta un lote de turnos en el borrador (tabla turnos), validando que todos los sectores pertenezcan a p_lugar, bajo el lock compartido con la publicación de ese lugar/mes/año (fn_lock_turnos_borrador).';

-- Punto 2 de esta ronda: reemplaza TODO el borrador de un scope (lugar +
-- mes/año + sectores) por un lote nuevo, en una ÚNICA transacción, bajo el
-- mismo lock que fn_publicar_guardias. Antes, pages/admin.js regeneraba
-- turnos llamando a fn_turnos_borrador_borrar_scope y después a
-- fn_turnos_borrador_insertar como DOS pedidos HTTP separados — cada uno es
-- su propia transacción, que toma el lock y lo libera al terminar. Entre
-- esos dos pedidos, el lock queda libre y el scope queda VACÍO: cualquier
-- otra sesión (otra pestaña, otro administrador, o la propia publicación)
-- podía tomar el lock en ese instante y, por ejemplo, publicar un estado
-- vacío como si fuera una versión legítima — o, si el segundo pedido
-- (insertar) fallaba por la razón que fuera, el borrador quedaba vacío a
-- mitad de camino, sin ninguna forma de volver atrás.
--
-- Esta función valida el lote nuevo ANTES de tocar nada (si p_turnos trae
-- un sector que no es de p_lugar, se rechaza con el borrador anterior
-- intacto, sin haber tomado siquiera el lock todavía) y, recién después,
-- toma el lock UNA sola vez para todo el borrado+inserción: si cualquier
-- parte falla, Postgres revierte TODO (es una sola función = una sola
-- transacción) y el borrador anterior queda exactamente como estaba — nunca
-- a medias, nunca vacío de forma visible para otra sesión.
create or replace function fn_turnos_borrador_reemplazar_scope(
  p_lugar text,
  p_mes int,
  p_anio int,
  p_sectores text[],
  p_turnos jsonb
)
returns int  -- cantidad de filas insertadas (el nuevo lote)
language plpgsql
as $$
declare
  v_sectores_nuevos text[];
  v_count int;
begin
  perform fn_validar_scope(p_lugar, p_mes, p_anio);
  if p_sectores is null or array_length(p_sectores, 1) is null then
    raise exception using errcode = 'P0001', message = 'sectores_invalidos';
  end if;
  perform fn_validar_sectores_de_lugar(p_lugar, p_sectores);

  if p_turnos is null or jsonb_typeof(p_turnos) <> 'array' then
    raise exception using errcode = 'P0001', message = 'turnos_invalidos', detail = 'p_turnos debe ser un array jsonb';
  end if;

  -- Validar el CONTENIDO del lote nuevo antes de borrar nada (todavía no se
  -- tomó el lock): si alguno de los sectores que trae p_turnos no pertenece
  -- a p_lugar, se rechaza acá, con el borrador anterior sin tocar.
  if jsonb_array_length(p_turnos) > 0 then
    select array_agg(distinct x.sector) into v_sectores_nuevos
      from jsonb_to_recordset(p_turnos) as x(legajo text, dia int, turno text, sector text);
    perform fn_validar_sectores_de_lugar(p_lugar, v_sectores_nuevos);
  end if;

  -- Un solo lock para todo el reemplazo: ninguna otra sesión puede ver (ni
  -- publicar) un estado intermedio entre el borrado y la inserción.
  perform fn_lock_turnos_borrador(p_lugar, p_mes, p_anio);

  delete from turnos where mes = p_mes and anio = p_anio and sector = any(p_sectores);

  insert into turnos (legajo, dia, turno, sector, mes, anio)
  select x.legajo, x.dia, x.turno, x.sector, p_mes, p_anio
    from jsonb_to_recordset(p_turnos) as x(legajo text, dia int, turno text, sector text);

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function fn_turnos_borrador_reemplazar_scope is
  'Reemplaza TODO el borrador de un lugar/mes/año/sectores por un lote nuevo (p_turnos), en una sola transacción bajo el lock compartido con la publicación (fn_lock_turnos_borrador). Valida el lote nuevo antes de borrar nada. Si algo falla, Postgres revierte todo — el borrador anterior queda intacto, nunca a medias ni vacío de forma visible para otra sesión. Reemplaza al patrón borrar_scope+insertar como dos pedidos separados (que sí dejaba un hueco vacío real entre ambos).';

-- Borra todos los turnos del borrador de un lugar+mes+año+sectores (se usa
-- para "regenerar desde cero" y para "borrar todas las guardias del mes").
create or replace function fn_turnos_borrador_borrar_scope(
  p_lugar text,
  p_mes int,
  p_anio int,
  p_sectores text[]
)
returns int  -- cantidad de filas borradas
language plpgsql
as $$
declare
  v_count int;
begin
  perform fn_validar_scope(p_lugar, p_mes, p_anio);
  if p_sectores is null or array_length(p_sectores, 1) is null then
    raise exception using errcode = 'P0001', message = 'sectores_invalidos';
  end if;
  perform fn_validar_sectores_de_lugar(p_lugar, p_sectores);

  perform fn_lock_turnos_borrador(p_lugar, p_mes, p_anio);

  delete from turnos where mes = p_mes and anio = p_anio and sector = any(p_sectores);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function fn_turnos_borrador_borrar_scope is
  'Borra todos los turnos del borrador para un lugar/mes/año/sectores, bajo el lock compartido con la publicación de ese lugar/mes/año.';

-- Actualiza UN turno del borrador por id (edición manual).
create or replace function fn_turnos_borrador_actualizar_uno(
  p_lugar text,
  p_mes int,
  p_anio int,
  p_id bigint,
  p_legajo text,
  p_turno text,
  p_sector text
)
returns void
language plpgsql
as $$
declare
  v_fila turnos;
begin
  perform fn_validar_scope(p_lugar, p_mes, p_anio);
  perform fn_validar_sectores_de_lugar(p_lugar, array[p_sector]);

  perform fn_lock_turnos_borrador(p_lugar, p_mes, p_anio);

  select * into v_fila from turnos where id = p_id and mes = p_mes and anio = p_anio;
  if v_fila.id is null then
    raise exception using errcode = 'P0001', message = 'turno_no_encontrado', detail = format('id=%s mes=%s anio=%s', p_id, p_mes, p_anio);
  end if;
  -- El sector ACTUAL de la fila también tiene que pertenecer a p_lugar —
  -- si no, un admin de otro lugar podría editar a ciegas una fila que no
  -- es suya (pasándole el id correcto pero mintiendo p_lugar).
  perform fn_validar_sectores_de_lugar(p_lugar, array[v_fila.sector]);

  update turnos set legajo = p_legajo, turno = p_turno, sector = p_sector where id = p_id;
end;
$$;

comment on function fn_turnos_borrador_actualizar_uno is
  'Actualiza un turno del borrador por id (edición manual), validando que la fila (su sector actual y el nuevo) pertenezca a p_lugar y que exista para ese mes/año, bajo el lock compartido con la publicación.';

-- Borra UN turno del borrador por id.
create or replace function fn_turnos_borrador_borrar_uno(
  p_lugar text,
  p_mes int,
  p_anio int,
  p_id bigint
)
returns void
language plpgsql
as $$
declare
  v_fila turnos;
begin
  perform fn_validar_scope(p_lugar, p_mes, p_anio);
  perform fn_lock_turnos_borrador(p_lugar, p_mes, p_anio);

  select * into v_fila from turnos where id = p_id and mes = p_mes and anio = p_anio;
  if v_fila.id is null then
    raise exception using errcode = 'P0001', message = 'turno_no_encontrado', detail = format('id=%s mes=%s anio=%s', p_id, p_mes, p_anio);
  end if;
  perform fn_validar_sectores_de_lugar(p_lugar, array[v_fila.sector]);

  delete from turnos where id = p_id;
end;
$$;

comment on function fn_turnos_borrador_borrar_uno is
  'Borra un turno del borrador por id, validando que pertenezca a p_lugar/mes/año, bajo el lock compartido con la publicación.';

-- Renombra un legajo en sus turnos del borrador, ACOTADO a p_lugar.
--
-- Punto 3 de esta ronda de revisión: esta función tenía dos problemas
-- reales. Primero, renombraba el legajo en TODOS sus turnos sin importar el
-- lugar — un administrador de UPA podía, sin darse cuenta, renombrar
-- también turnos de HIGA de ese mismo legajo, aunque su sesión solo esté
-- autorizada sobre UPA. Ahora se acota explícitamente a p_lugar (el lugar
-- de la SESIÓN que llama, nunca uno que mande el cliente — ver
-- pages/api/admin-turnos.js): solo toca turnos cuyo sector pertenezca a ese
-- lugar; si el legajo tiene turnos en otro lugar, esos quedan sin tocar,
-- porque esta sesión no está autorizada sobre ellos.
--
-- Segundo, usaba solo un lock propio por legajo
-- (turnos_rename_legajo:<legajo>), SIN coordinar con
-- fn_lock_turnos_borrador — el mismo lock que toman fn_publicar_guardias y
-- el resto de las escrituras del borrador. Eso dejaba una ventana real: una
-- publicación en curso para ese lugar/mes/año podía leer el hash del
-- borrador, y que el renombrado modificara esas mismas filas (cambiando el
-- legajo) ANTES de que la publicación copiara los datos a
-- turnos_publicados, sin que ninguno de los dos lo notara — la publicación
-- terminaría copiando datos que ya no coinciden con el hash que acaba de
-- verificar. Ahora, para cada mes/año distinto en el que el legajo tiene
-- turnos EN p_lugar, se toma fn_lock_turnos_borrador antes de escribir nada
-- — la misma coordinación que ya tienen fn_turnos_borrador_insertar/
-- borrar_scope/actualizar_uno/borrar_uno y fn_publicar_guardias.
--
-- Orden de los locks (para evitar interbloqueos): primero el lock propio
-- por legajo (viejo) — así dos renombrados simultáneos del MISMO legajo no
-- se pisan —, y recién después los locks de scope, SIEMPRE en orden
-- ascendente por (año, mes). Si dos renombrados afectan conjuntos de
-- períodos que se superponen, ambos los piden en el mismo orden relativo,
-- así que nunca pueden quedar esperándose en círculo (A espera el período
-- que B ya tiene, mientras B espera el que A ya tiene).
create or replace function fn_turnos_borrador_renombrar_legajo(
  p_lugar text,
  p_legajo_viejo text,
  p_legajo_nuevo text
)
returns int
language plpgsql
as $$
declare
  v_count int;
  v_scope record;
begin
  if p_legajo_viejo is null or p_legajo_viejo = '' or p_legajo_nuevo is null or p_legajo_nuevo = '' then
    raise exception using errcode = 'P0001', message = 'legajo_invalido';
  end if;
  if p_lugar is null or p_lugar = '' then
    raise exception using errcode = 'P0001', message = 'lugar_invalido';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('turnos_rename_legajo:' || p_legajo_viejo, 0));

  for v_scope in
    select distinct t.anio, t.mes
      from turnos t
     where t.legajo = p_legajo_viejo
       and t.sector = any(fn_sectores_de_lugar(p_lugar))
     order by t.anio, t.mes
  loop
    perform fn_lock_turnos_borrador(p_lugar, v_scope.mes, v_scope.anio);
  end loop;

  update turnos set legajo = p_legajo_nuevo
   where legajo = p_legajo_viejo
     and sector = any(fn_sectores_de_lugar(p_lugar));

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function fn_turnos_borrador_renombrar_legajo is
  'Renombra un legajo en los turnos del borrador de p_lugar ÚNICAMENTE (nunca de otro lugar, aunque el legajo tenga filas ahí — respeta el alcance autorizado de la sesión que llama). Toma, en orden consistente (lock por legajo primero, después los de scope en orden ascendente por año/mes), el mismo fn_lock_turnos_borrador que usan la publicación y el resto de las escrituras del borrador, para cada mes/año afectado — así queda coordinado con una publicación o edición concurrente de esos mismos períodos, y dos renombrados simultáneos que afecten períodos superpuestos nunca se interbloquean.';

-- Punto 3 de esta ronda: edición de un efectivo + renombrado de sus turnos
-- del borrador como UNA sola operación atómica. Antes, pages/admin.js
-- (handleGuardarPersonal) hacía esto como DOS pedidos HTTP separados —
-- primero POST /api/admin-turnos (renombrar_legajo), con los ERRORES
-- IGNORADOS a propósito (`.catch(() => {})`), y recién después POST
-- /api/admin-efectivos (guardar), que es el que de verdad cambia el legajo
-- en la fila de efectivos. Si el renombrado de turnos fallaba por lo que
-- fuera, el código seguía igual y renombraba el efectivo — exactamente el
-- caso que pide evitar esta ronda: una parte modificada (el efectivo, con
-- el legajo nuevo) y otra sin modificar (sus turnos, todavía con el legajo
-- viejo) — turnos huérfanos del legajo que ya no existe como tal.
--
-- Punto 2 de la ronda siguiente ("Completar la coherencia del cambio de
-- legajo"): antes de llamar a este endpoint, pages/admin.js
-- (handleGuardarPersonal) todavía hacía, por su cuenta, CUATRO escrituras
-- más —separadas, con la clave anon o por otro endpoint propio, y SIN
-- ninguna relación con esta transacción— para renombrar el legajo en
-- `disponibilidad`, `asistencia`, `planilla_manual` y `firmas`. Si esta
-- función fallaba después (por ejemplo, legajo duplicado), esas cuatro
-- escrituras ya habían ocurrido igual: no había ninguna forma de
-- revertirlas. Esta función ahora también renombra esas cuatro relaciones,
-- EN LA MISMA TRANSACCIÓN que el efectivo y sus turnos — así que si
-- cualquier parte falla, Postgres revierte TODO, sin excepción.
--
-- `disponibilidad`, `asistencia` y `planilla_manual` tienen columna
-- `lugar` propia: se renombran acotadas a `p_lugar`, igual que los turnos
-- (fn_turnos_borrador_renombrar_legajo) — nunca una fila de otro lugar,
-- aunque comparta el mismo legajo.
--
-- `firmas` es distinta: no tiene columna `lugar` NI `sector` de la que
-- derivarlo (a diferencia de `turnos`) — no hay ninguna forma de saber, a
-- partir de una fila de `firmas`, a qué lugar pertenece. Si el legajo
-- viejo o el legajo nuevo pudieran corresponder a MÁS DE UN efectivo en
-- total (el mismo legajo existiendo en otro lugar, el caso real que ya
-- modela 01_seed_ficticio.sql), renombrar `firmas` filtrando solo por
-- legajo arriesgaría mezclar la firma de dos personas distintas. Esta
-- función NO ADIVINA en ese caso: comprueba, antes de tocar nada, que el
-- legajo viejo sea único entre TODOS los efectivos (de cualquier lugar) y
-- que el legajo nuevo no le pertenezca ya a otro efectivo distinto: solo
-- si las dos condiciones se cumplen, renombra `firmas`. Si no se cumplen,
-- deja `firmas` sin tocar y lo informa explícitamente en el resultado
-- (`firmas_omitidas_por_ambiguedad = true`) en vez de arriesgar un cambio
-- global incorrecto — el llamador (pages/api/admin-efectivos.js) traslada
-- ese aviso al administrador.
--
-- El `select ... for update` inicial (en vez de un `select` simple) toma
-- un lock de fila real sobre ESTE efectivo: dos ediciones concurrentes del
-- mismo `p_id` (por ejemplo, dos pestañas del mismo administrador, o dos
-- administradores) se serializan en ese punto. Sin esto, la segunda
-- transacción podía leer el legajo "viejo" de una foto desactualizada
-- (de antes de que la primera edición commiteara) y terminar renombrando
-- turnos/relaciones buscando un legajo que ya no existía más como tal —
-- dejando turnos bajo un legajo intermedio, ni el original ni el final.
-- Con el lock de fila, la segunda edición espera a que la primera termine
-- y recién ahí relee el legajo YA actualizado por la primera, encadenando
-- correctamente viejo→intermedio→nuevo sin perder nada en el medio.
create or replace function fn_admin_guardar_efectivo(
  p_lugar text,
  p_id bigint,
  p_legajo text,
  p_nombre text,
  p_tipo text,
  p_email text,
  p_sector text,
  p_telefono text,
  p_notas text,
  p_dni text,
  p_jerarquia text,
  p_password text
)
returns table (
  id bigint,
  legajo text,
  turnos_renombrados int,
  disponibilidad_renombrada int,
  asistencia_renombrada int,
  planilla_manual_renombrada int,
  firmas_renombradas int,
  firmas_omitidas_por_ambiguedad boolean
)
language plpgsql
as $$
declare
  v_legajo_viejo text;
  v_turnos_renombrados int := 0;
  v_disponibilidad_renombrada int := 0;
  v_asistencia_renombrada int := 0;
  v_planilla_manual_renombrada int := 0;
  v_firmas_renombradas int := 0;
  v_firmas_omitidas boolean := false;
  v_colisiones_legajo_viejo int;
  v_colisiones_legajo_nuevo int;
begin
  if p_id is null or p_legajo is null or p_legajo = '' or p_nombre is null or p_nombre = '' then
    raise exception using errcode = 'P0001', message = 'datos_invalidos', detail = 'Faltan id/legajo/nombre';
  end if;
  if p_lugar is null or p_lugar = '' then
    raise exception using errcode = 'P0001', message = 'lugar_invalido';
  end if;

  -- La fila tiene que YA pertenecer al lugar de la sesión — un
  -- administrador de un lugar no puede editar (ni renombrar el legajo de)
  -- una fila de otro lugar adivinando un id. `for update`: ver nota de
  -- concurrencia arriba.
  select efectivos.legajo into v_legajo_viejo
    from efectivos
   where efectivos.id = p_id and efectivos.lugar = p_lugar
   for update;

  if v_legajo_viejo is null then
    raise exception using errcode = 'P0001', message = 'efectivo_no_encontrado',
      detail = format('id=%s no existe en lugar=%s (o no pertenece a ese lugar)', p_id, p_lugar);
  end if;

  if v_legajo_viejo is distinct from p_legajo then
    v_turnos_renombrados := fn_turnos_borrador_renombrar_legajo(p_lugar, v_legajo_viejo, p_legajo);

    -- disponibilidad/asistencia/planilla_manual: tienen columna `lugar`
    -- propia, se acotan igual que los turnos — nunca una fila de otro
    -- lugar, aunque el legajo coincida.
    update disponibilidad set legajo = p_legajo
     where disponibilidad.legajo = v_legajo_viejo and disponibilidad.lugar = p_lugar;
    get diagnostics v_disponibilidad_renombrada = row_count;

    update asistencia set legajo = p_legajo
     where asistencia.legajo = v_legajo_viejo and asistencia.lugar = p_lugar;
    get diagnostics v_asistencia_renombrada = row_count;

    update planilla_manual set legajo = p_legajo
     where planilla_manual.legajo = v_legajo_viejo and planilla_manual.lugar = p_lugar;
    get diagnostics v_planilla_manual_renombrada = row_count;

    -- firmas: SIN columna lugar ni sector — ver la nota completa arriba.
    -- Solo se renombra si el legajo viejo es único entre TODOS los
    -- efectivos (ningún otro, de ningún lugar, comparte ese legajo ahora
    -- mismo) y el legajo nuevo no le pertenece ya a otro efectivo
    -- distinto. Si cualquiera de las dos cosas no se cumple, se omite sin
    -- tocar nada y se informa en el resultado.
    select count(*) into v_colisiones_legajo_viejo
      from efectivos where efectivos.legajo = v_legajo_viejo;
    select count(*) into v_colisiones_legajo_nuevo
      from efectivos where efectivos.legajo = p_legajo and efectivos.id <> p_id;

    if v_colisiones_legajo_viejo = 1 and v_colisiones_legajo_nuevo = 0 then
      update firmas set legajo = p_legajo where firmas.legajo = v_legajo_viejo;
      get diagnostics v_firmas_renombradas = row_count;
    else
      v_firmas_omitidas := true;
    end if;
  end if;

  begin
    update efectivos set
      legajo = p_legajo, nombre = p_nombre, tipo = p_tipo,
      email = coalesce(p_email, ''), sector = coalesce(p_sector, 'Sin asignar'),
      telefono = coalesce(p_telefono, ''), notas = p_notas,
      dni = p_dni, jerarquia = p_jerarquia, password = p_password
    where efectivos.id = p_id and efectivos.lugar = p_lugar;
  exception when unique_violation then
    raise exception using errcode = 'P0001', message = 'legajo_duplicado',
      detail = format('Ya existe otro efectivo con el legajo %s', p_legajo);
  end;

  return query select
    p_id, p_legajo, v_turnos_renombrados,
    v_disponibilidad_renombrada, v_asistencia_renombrada, v_planilla_manual_renombrada,
    v_firmas_renombradas, v_firmas_omitidas;
end;
$$;

comment on function fn_admin_guardar_efectivo is
  'Guarda la edición de un efectivo y, si el legajo cambia, renombra EN LA MISMA TRANSACCIÓN sus turnos del borrador, disponibilidad, asistencia y planilla_manual (todos acotados a p_lugar) y, cuando es inequívoco (legajo viejo único y legajo nuevo libre entre TODOS los efectivos), también firmas (que no tiene columna lugar). Si cualquier parte falla, Postgres revierte todo. El select inicial usa FOR UPDATE para serializar ediciones concurrentes del mismo id y no dejar nunca turnos/relaciones bajo un legajo intermedio.';

-- ----------------------------------------------------------------------------
-- 8) Función transaccional: guardar disponibilidad cargada por un admin
--    fuera de término, con auditoría y control de concurrencia, todo
--    dentro de la misma transacción.
--
--    p_dias_antes_esperado: el mapa { "dia": "turno" } (o {} si no había
--      nada cargado) que el administrador vio al abrir el formulario.
--    Si lo que hay guardado AHORA (comprobado bajo un lock, en el momento
--    de guardar) no coincide con eso, se rechaza: no se sobrescribe en
--    silencio un cambio hecho por otra persona mientras tanto — incluyendo
--    el caso en que antes no había ninguna fila cargada.
-- ----------------------------------------------------------------------------
-- Clave de lock COMPARTIDA entre fn_guardar_disponibilidad_admin y
-- fn_guardar_disponibilidad_efectivo: antes cada función usaba su propio
-- prefijo ('fn_guardar_disponibilidad_admin:...' en una, nada en la otra —
-- la de efectivo no tomaba ningún lock), así que hasheaban a identificadores
-- de advisory lock DISTINTOS y nunca se bloqueaban entre sí. Un admin y un
-- efectivo guardando la disponibilidad del mismo legajo/lugar/mes/año al
-- mismo tiempo no se coordinaban: podían leer el mismo estado "antes" y
-- pisarse en silencio. Con esta función, ambas toman EXACTAMENTE el mismo
-- lock para el mismo recurso, así que de verdad se serializan entre sí,
-- sin importar cuál de las dos rutas se usó.
create or replace function fn_lock_disponibilidad(p_legajo text, p_lugar text, p_mes int, p_anio int)
returns void
language plpgsql
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('disponibilidad:' || p_legajo || ':' || p_lugar || ':' || p_mes || ':' || p_anio, 0));
end;
$$;

create or replace function fn_guardar_disponibilidad_admin(
  p_legajo text,
  p_lugar text,
  p_mes int,
  p_anio int,
  p_dias jsonb,                  -- { "5": "d", "6": "dn" }
  p_modificado_por_legajo text,
  p_motivo text,
  p_dias_antes_esperado jsonb,
  p_advertencias jsonb
)
returns bigint  -- id de la fila de auditoría creada
language plpgsql
as $$
declare
  v_auditoria_id bigint;
  v_dia text;
  v_turno text;
  v_dias_actuales jsonb;
begin
  perform fn_validar_scope(p_lugar, p_mes, p_anio);
  perform fn_validar_dias_disponibilidad(p_dias, p_lugar, p_mes, p_anio);
  if p_legajo is null or p_legajo = '' then
    raise exception using errcode = 'P0001', message = 'legajo_invalido';
  end if;
  -- El valor esperado de "lo que había antes" es OBLIGATORIO: no existe una
  -- forma de omitir el control de concurrencia pasando null. Antes, un
  -- p_dias_antes_esperado = null se interpretaba como "no comprobar nada" —
  -- eso dejaba la puerta abierta a un guardado que pisara en silencio lo que
  -- había, bastaba con no mandar ese campo. Ahora, si falta, se rechaza acá
  -- mismo (defensa en profundidad: aunque el endpoint de Node también lo
  -- exija, la función de base no confía en que siempre se vaya a llamar
  -- desde ahí).
  if p_dias_antes_esperado is null then
    raise exception using errcode = 'P0001', message = 'dias_antes_esperado_obligatorio',
      detail = 'Hay que mandar explícitamente lo que se vio al abrir el formulario (o {} si no había nada cargado) — no se puede guardar sin ese control de concurrencia.';
  end if;

  -- Serializa, por efectivo+lugar+mes+año, cualquier guardado concurrente
  -- — de este mismo endpoint O del guardado propio del efectivo (ver
  -- fn_lock_disponibilidad) — sobre el mismo recurso. Cierra la ventana de
  -- carrera entre leer el estado actual y escribir: el lock se toma ANTES
  -- de leer, así que lo que se lee ya no puede cambiar bajo nuestros pies
  -- antes de comparar y escribir.
  perform fn_lock_disponibilidad(p_legajo, p_lugar, p_mes, p_anio);

  select coalesce(jsonb_object_agg(dia::text, turno), '{}'::jsonb) into v_dias_actuales
    from disponibilidad
   where legajo = p_legajo and lugar = p_lugar and mes = p_mes and anio = p_anio;

  if v_dias_actuales <> p_dias_antes_esperado then
    raise exception using
      errcode = 'P0001',
      message = 'disponibilidad_desactualizada',
      detail = v_dias_actuales::text;
  end if;

  delete from disponibilidad
   where legajo = p_legajo and lugar = p_lugar and mes = p_mes and anio = p_anio;

  for v_dia, v_turno in select * from jsonb_each_text(p_dias)
  loop
    insert into disponibilidad (legajo, dia, turno, mes, anio, lugar, cargado_por_legajo, cargado_en, origen)
    values (p_legajo, v_dia::int, v_turno, p_mes, p_anio, p_lugar, p_modificado_por_legajo, now(), 'admin_fuera_de_termino');
  end loop;

  insert into disponibilidad_auditoria
    (legajo, lugar, mes, anio, modificado_por_legajo, dias_antes, dias_despues, motivo, advertencias, origen)
  values
    (p_legajo, p_lugar, p_mes, p_anio, p_modificado_por_legajo, v_dias_actuales, p_dias, p_motivo, p_advertencias, 'admin_fuera_de_termino')
  returning id into v_auditoria_id;

  -- Si el insert de arriba fallara (por ejemplo, por un problema de
  -- conexión a mitad de la función), PostgreSQL deshace TODO lo que esta
  -- función hizo en esta transacción — el delete y los insert de
  -- disponibilidad de más arriba incluidos. No puede quedar la
  -- disponibilidad nueva guardada sin su auditoría, ni a medias.
  return v_auditoria_id;
end;
$$;

comment on function fn_guardar_disponibilidad_admin is
  'Reemplaza de forma atómica la disponibilidad de UN efectivo/lugar/mes/año y deja registro de auditoría en la misma transacción. Valida días reales del mes y turnos permitidos para el lugar. p_dias_antes_esperado es OBLIGATORIO (no se puede pasar null para omitir el control). Comprueba, bajo el lock compartido fn_lock_disponibilidad y dentro de la misma transacción, que nadie modificó la disponibilidad desde que el administrador la vio (incluyendo cuando no había ninguna fila todavía) — ni otro administrador NI el propio efectivo guardando al mismo tiempo; si cambió, rechaza con disponibilidad_desactualizada. Si cualquier paso falla, no se guarda nada (ni la disponibilidad ni la auditoría quedan a medias). Nunca toca la tabla turnos.';

-- ----------------------------------------------------------------------------
-- 9) Función transaccional: guardar la disponibilidad del PROPIO efectivo
--    (dentro de la ventana de inscripción). También atómica — antes el
--    endpoint hacía un delete y un insert como dos pasos separados desde
--    Node; ahora es una sola función de base de datos.
-- ----------------------------------------------------------------------------
create or replace function fn_guardar_disponibilidad_efectivo(
  p_legajo text,
  p_lugar text,
  p_mes int,
  p_anio int,
  p_dias jsonb,
  p_dias_antes_esperado jsonb
)
returns void
language plpgsql
as $$
declare
  v_dia text;
  v_turno text;
  v_dias_actuales jsonb;
begin
  perform fn_validar_scope(p_lugar, p_mes, p_anio);
  perform fn_validar_dias_disponibilidad(p_dias, p_lugar, p_mes, p_anio);
  if p_legajo is null or p_legajo = '' then
    raise exception using errcode = 'P0001', message = 'legajo_invalido';
  end if;
  -- Punto 3 de la revisión: esta función no tenía NINGÚN control de
  -- concurrencia (ni lock, ni comprobación de versión esperada) — dos
  -- guardados del propio efectivo al mismo tiempo (dos pestañas, un
  -- doble envío) o un guardado del efectivo compitiendo con uno
  -- administrativo sobre el mismo recurso podían pisarse en silencio.
  -- Ahora exige, igual que fn_guardar_disponibilidad_admin, el mapa
  -- {dia:turno} (o {} si no había nada) que el cliente vio al cargar la
  -- pantalla, y lo comprueba bajo el MISMO lock compartido
  -- (fn_lock_disponibilidad) — así una carga admin y una del propio
  -- efectivo sobre el mismo legajo/lugar/mes/año se serializan entre sí
  -- de verdad, no solo cada una contra sí misma.
  if p_dias_antes_esperado is null then
    raise exception using errcode = 'P0001', message = 'dias_antes_esperado_obligatorio',
      detail = 'Hay que mandar explícitamente lo que se vio al abrir el formulario (o {} si no había nada cargado) — no se puede guardar sin ese control de concurrencia.';
  end if;

  perform fn_lock_disponibilidad(p_legajo, p_lugar, p_mes, p_anio);

  select coalesce(jsonb_object_agg(dia::text, turno), '{}'::jsonb) into v_dias_actuales
    from disponibilidad
   where legajo = p_legajo and lugar = p_lugar and mes = p_mes and anio = p_anio;

  if v_dias_actuales <> p_dias_antes_esperado then
    raise exception using
      errcode = 'P0001',
      message = 'disponibilidad_desactualizada',
      detail = v_dias_actuales::text;
  end if;

  delete from disponibilidad
   where legajo = p_legajo and lugar = p_lugar and mes = p_mes and anio = p_anio;

  for v_dia, v_turno in select * from jsonb_each_text(p_dias)
  loop
    insert into disponibilidad (legajo, dia, turno, mes, anio, lugar, cargado_por_legajo, cargado_en, origen)
    values (p_legajo, v_dia::int, v_turno, p_mes, p_anio, p_lugar, p_legajo, now(), 'efectivo');
  end loop;
end;
$$;

comment on function fn_guardar_disponibilidad_efectivo is
  'Reemplaza de forma atómica la disponibilidad que un efectivo carga de sí mismo. Valida días reales del mes y turnos permitidos. p_dias_antes_esperado es OBLIGATORIO (no se puede pasar null para omitir el control) y se comprueba bajo el MISMO lock (fn_lock_disponibilidad) que usa fn_guardar_disponibilidad_admin para el mismo recurso, así que una carga del propio efectivo y una carga administrativa sobre el mismo legajo/lugar/mes/año se serializan entre sí, no solo cada ruta contra sí misma. Si el insert de alguna fila falla, PostgreSQL deshace también el delete de más arriba: nunca queda sin disponibilidad guardada por un error a mitad de camino. La verificación de si la ventana de inscripción está abierta se hace antes de llamar a esta función (pages/api/guardar-disponibilidad.js), en hora de Argentina — ver lib/tiempoArgentina.js.';

-- ============================================================================
-- Fin de la migración 0001.
-- ============================================================================
