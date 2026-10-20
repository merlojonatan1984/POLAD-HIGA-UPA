-- supabase/migrations/0004_reglas_individuales_y_avisos.sql
--
-- Migración ADITIVA para la ronda de pedidos "COMPLETAR EN UNA SOLA
-- ENTREGA" (sexo, puesto fijo configurable, objetivos individuales
-- configurables, seguimiento persistente de avisos de WhatsApp).
--
-- No modifica NINGUNA tabla, función ni columna de 0001_borrador_publicacion.sql
-- más allá de agregar la columna `sexo` a `efectivos` (alter table add
-- column if not exists — no toca las columnas existentes ni
-- fn_admin_guardar_efectivo, que queda exactamente como está: ese pedido
-- quedó explícitamente fuera de esta ronda ("no modifiques ni bloquees la
-- edición de legajos")). Todo lo demás son tablas y funciones NUEVAS.
--
-- Pensada para poder aplicarse sola, en cualquier orden después de 0001,
-- 0002 y 0003 (usa "if not exists" / "create or replace" en todo). No hace
-- ningún cambio sobre datos existentes, no borra nada.

-- ----------------------------------------------------------------------------
-- PUNTO 1: identificación por sexo (femenino / masculino / sin informar)
-- ----------------------------------------------------------------------------
-- No se infiere por el nombre: queda en 'sin_informar' hasta que alguien lo
-- cargue explícitamente desde la ficha del efectivo (pages/api/admin-efectivos.js,
-- acción 'set_sexo' — separada de fn_admin_guardar_efectivo a propósito, para
-- no tocar esa función). No se usa en ningún punto del algoritmo de
-- asignación (ni en calcularAsignaciones ni en procesarRapida) — ver
-- pages/admin.js: no hay ninguna lectura de 'sexo' ahí fuera de mostrarlo y
-- filtrarlo en la pantalla de Personal.
alter table efectivos add column if not exists sexo text;
update efectivos set sexo = 'sin_informar' where sexo is null;
alter table efectivos alter column sexo set not null;
alter table efectivos alter column sexo set default 'sin_informar';
alter table efectivos drop constraint if exists efectivos_sexo_check;
alter table efectivos add constraint efectivos_sexo_check check (sexo in ('femenino', 'masculino', 'sin_informar'));

comment on column efectivos.sexo is
  'Autoinformado/cargado por administración. Nunca inferido por el nombre. No introduce restricciones de asignación por sí solo (ver pages/admin.js, procesarRapida): es solo dato de ficha + filtro.';

-- ----------------------------------------------------------------------------
-- PUNTO 2: puestos específicos configurables por efectivo (no hardcodeados)
-- ----------------------------------------------------------------------------
-- Reemplaza lo que en el pedido se describe como "Guillermo Solís:
-- Estacionamiento de HIGA" etc. — en vez de una excepción por nombre escrita
-- en el código (que es exactamente lo que el pedido pide evitar: "deben ser
-- editables, no estar escritas como excepciones fijas por nombre"), es una
-- fila editable por admin, seleccionando al efectivo de su registro
-- existente (por legajo+lugar). `turno` null = aplica a cualquier turno del
-- lugar; si se especifica (ej. 'd'/'n'/'m'/'t'), el puesto fijo solo rige
-- para ese turno.
create table if not exists efectivo_puesto_fijo (
  id                     bigserial primary key,
  legajo                 text not null,
  lugar                  text not null,
  sector                 text not null,
  turno                  text,
  activo                 boolean not null default true,
  creado_por_legajo      text not null,
  creado_en              timestamptz not null default now(),
  actualizado_por_legajo text,
  actualizado_en         timestamptz not null default now()
);

-- A lo sumo UN puesto fijo activo por efectivo+lugar (si se quiere cambiar
-- el puesto, se desactiva el anterior y se crea uno nuevo — así queda
-- historial de qué puesto tuvo cada uno, nunca se pierde por un update ciego).
create unique index if not exists idx_puesto_fijo_activo_unico
  on efectivo_puesto_fijo (legajo, lugar)
  where activo;

create index if not exists idx_puesto_fijo_lugar on efectivo_puesto_fijo (lugar, activo);

comment on table efectivo_puesto_fijo is
  'Configuración editable (admin) de puesto preferente por efectivo+lugar. Se gestiona desde pages/api/admin-reglas-puesto.js y se consulta en procesarRapida (pages/admin.js) antes de la asignación general — nunca fuerza un puesto si no hay disponibilidad/cupo real para ese día/turno: en ese caso se informa como "no se pudo cumplir", no se inventa ni se cruza con otra restricción vigente.';

-- ----------------------------------------------------------------------------
-- PUNTO 3: objetivos individuales configurables (horas o guardias, con
-- turno día/noche/ambos)
-- ----------------------------------------------------------------------------
-- "Objetivo mensual" = el objetivo vigente para ese efectivo+lugar, que se
-- aplica a cualquier mes/año que se procese de ahora en más (igual que hoy
-- "Coronel: 3 en HIGA y 3 en UPA" no es un dato de un mes puntual sino una
-- regla que rige mes a mes hasta que se cambie). Cambiarlo (ej. 3→2) no
-- reescribe meses ya cargados — solo cambia lo que procesarRapida usa de ahí
-- en adelante. Queda historial completo de cada alta/edición/baja en
-- efectivo_objetivo_historial, nunca se pierde el valor anterior.
create table if not exists efectivo_objetivo (
  id                     bigserial primary key,
  legajo                 text not null,
  lugar                  text not null,
  tipo                   text not null check (tipo in ('horas', 'guardias')),
  cantidad               numeric not null check (cantidad >= 0),
  turno_objetivo         text not null default 'ambos' check (turno_objetivo in ('dia', 'noche', 'ambos')),
  activo                 boolean not null default true,
  creado_por_legajo      text not null,
  creado_en              timestamptz not null default now(),
  actualizado_por_legajo text,
  actualizado_en         timestamptz not null default now()
);

create unique index if not exists idx_objetivo_activo_unico
  on efectivo_objetivo (legajo, lugar)
  where activo;

create table if not exists efectivo_objetivo_historial (
  id                     bigserial primary key,
  legajo                 text not null,
  lugar                  text not null,
  tipo                   text,
  cantidad               numeric,
  turno_objetivo         text,
  accion                 text not null check (accion in ('crear', 'editar', 'desactivar')),
  modificado_por_legajo  text not null,
  modificado_en          timestamptz not null default now()
);

comment on table efectivo_objetivo is
  'Objetivo mensual vigente (horas o cantidad de guardias) por efectivo+lugar, con turno dia/noche/ambos. pages/admin.js (cargarRapida/procesarRapida) lo usa para calcular "meta" en vez de derivarla del mes anterior cuando existe una fila activa para ese legajo+lugar. No fuerza cruces ni inventa disponibilidad: si no se alcanza, se reporta asignado/pendiente/motivo (ver lib/objetivosEfectivos.js).';

-- ----------------------------------------------------------------------------
-- PUNTO 9: seguimiento persistente de avisos de WhatsApp (independiente por
-- efectivo + destino + mes + año, vinculado a la versión publicada)
-- ----------------------------------------------------------------------------
-- Reemplaza el Map en localStorage (admin.js: notificados/marcarNotificado)
-- que es por navegador, no por servidor, y no distinguía destino del
-- contenido publicado. El mecanismo de ENVÍO en sí (el link wa.me) no
-- cambia — esta tabla solo registra el SEGUIMIENTO de la confirmación.
create table if not exists whatsapp_avisos (
  id                      bigserial primary key,
  legajo                  text not null,
  lugar                   text not null,
  mes                     int not null,
  anio                    int not null,
  publicacion_id          bigint references publicaciones(id),
  fingerprint_turnos      text not null default '',
  estado                  text not null default 'pendiente' check (estado in ('pendiente', 'confirmado')),
  abierto_en              timestamptz,
  abierto_por_legajo      text,
  confirmado_en           timestamptz,
  confirmado_por_legajo   text,
  actualizado_en          timestamptz not null default now(),
  unique (legajo, lugar, mes, anio)
);

create index if not exists idx_whatsapp_avisos_scope on whatsapp_avisos (lugar, mes, anio);

comment on table whatsapp_avisos is
  'Estado de aviso por efectivo+lugar+mes+año, vinculado a publicacion_id (turnos_publicados — NUNCA al borrador). "abierto_*" = se hizo click en el link de WhatsApp (abrir no es enviar). "estado=confirmado" = el administrador confirmó EXPRESAMENTE que lo envió (acción separada, ver pages/api/whatsapp-avisos.js). fn_whatsapp_sincronizar_tras_publicar vuelve a pendiente el aviso de un efectivo puntual cuando SU fingerprint de turnos publicados cambió respecto de la publicación anterior; si no cambió, conserva estado=confirmado intacto.';

create table if not exists whatsapp_avisos_historial (
  id              bigserial primary key,
  legajo          text not null,
  lugar           text not null,
  mes             int not null,
  anio            int not null,
  publicacion_id  bigint,
  estado_anterior text,
  motivo          text not null,
  registrado_en   timestamptz not null default now()
);

comment on table whatsapp_avisos_historial is
  'Historial de transiciones de whatsapp_avisos (nunca se borra ni se sobreescribe). Sirve como antecedente informativo únicamente — nunca se reinterpreta como confirmación vigente; lo vigente es siempre la fila actual de whatsapp_avisos.';

-- Sincroniza whatsapp_avisos tras una publicación nueva de (p_lugar, p_mes,
-- p_anio). Se llama DESPUÉS de que fn_publicar_guardias ya confirmó la
-- publicación (desde pages/api/publicar-guardias.js) — no se integra dentro
-- de fn_publicar_guardias para no modificarla (esa función no está en la
-- lista de "congeladas" de esta ronda, pero tocar una función tan sensible
-- para un agregado que puede vivir perfectamente separado no es necesario:
-- menor superficie de cambio).
--
-- Compara, PARA CADA EFECTIVO por separado, el "fingerprint" (lista
-- ordenada día-turno-sector) de sus turnos en la publicación nueva contra
-- el de la publicación inmediatamente anterior del mismo lugar/mes/año:
--   - Si cambió (o el efectivo no tenía publicación anterior): el aviso de
--     ESE efectivo vuelve a 'pendiente' (si estaba confirmado, se archiva a
--     whatsapp_avisos_historial antes de resetear — nunca se pierde el
--     dato, solo deja de ser la confirmación vigente).
--   - Si no cambió: se conserva el estado (confirmado o pendiente) tal cual
--     estaba — publicar los cambios de OTRO efectivo nunca lo toca.
create or replace function fn_whatsapp_sincronizar_tras_publicar(
  p_lugar text,
  p_mes int,
  p_anio int
)
returns int -- cantidad de efectivos cuyo aviso volvió a pendiente por cambio real
language plpgsql
as $$
declare
  v_nueva_id bigint;
  v_nueva_version int;
  v_anterior_id bigint;
  r record;
  v_fp_nueva text;
  v_fp_anterior text;
  v_estado_previo text;
  v_pubid_previo bigint;
  v_existia boolean;
  v_cambiados int := 0;
begin
  -- Lock propio (no el de fn_lock_turnos_borrador, que ya se liberó al
  -- terminar la transacción de publicación) para que dos llamadas
  -- concurrentes a esta función para el mismo scope no se intercalen.
  perform pg_advisory_xact_lock(hashtext('whatsapp_sync:' || p_lugar || ':' || p_mes || ':' || p_anio));

  select id, version into v_nueva_id, v_nueva_version
    from publicaciones
   where lugar = p_lugar and mes = p_mes and anio = p_anio and vigente = true;

  if v_nueva_id is null then
    -- No hay publicación vigente para este scope (no debería pasar si se
    -- llama justo después de un publicar exitoso) — no hay nada para
    -- sincronizar, no es un error.
    return 0;
  end if;

  select id into v_anterior_id
    from publicaciones
   where lugar = p_lugar and mes = p_mes and anio = p_anio and version = v_nueva_version - 1;

  for r in (
    select legajo from turnos_publicados where publicacion_id = v_nueva_id
    union
    select legajo from turnos_publicados where publicacion_id = v_anterior_id
  ) loop
    select coalesce(string_agg(dia::text || '-' || turno || '-' || sector, ',' order by dia, turno, sector), '')
      into v_fp_nueva
      from turnos_publicados
     where publicacion_id = v_nueva_id and legajo = r.legajo;

    if v_anterior_id is null then
      -- Primera publicación de este scope: no hay "anterior" con qué
      -- comparar — se trata como cambio (nunca se asume confirmado de
      -- entrada para un efectivo que no tiene antecedente identificable).
      v_fp_anterior := null;
    else
      select coalesce(string_agg(dia::text || '-' || turno || '-' || sector, ',' order by dia, turno, sector), '')
        into v_fp_anterior
        from turnos_publicados
       where publicacion_id = v_anterior_id and legajo = r.legajo;
    end if;

    select estado, publicacion_id into v_estado_previo, v_pubid_previo
      from whatsapp_avisos
     where legajo = r.legajo and lugar = p_lugar and mes = p_mes and anio = p_anio;
    v_existia := found;

    if v_fp_anterior is null or v_fp_nueva <> v_fp_anterior then
      if v_existia and v_estado_previo = 'confirmado' then
        insert into whatsapp_avisos_historial (legajo, lugar, mes, anio, publicacion_id, estado_anterior, motivo)
        values (r.legajo, p_lugar, p_mes, p_anio, v_pubid_previo, v_estado_previo, 'reset_por_cambio_de_guardias_publicadas');
      end if;

      insert into whatsapp_avisos (legajo, lugar, mes, anio, publicacion_id, fingerprint_turnos, estado, abierto_en, abierto_por_legajo, confirmado_en, confirmado_por_legajo, actualizado_en)
      values (r.legajo, p_lugar, p_mes, p_anio, v_nueva_id, v_fp_nueva, 'pendiente', null, null, null, null, now())
      on conflict (legajo, lugar, mes, anio) do update set
        publicacion_id = excluded.publicacion_id,
        fingerprint_turnos = excluded.fingerprint_turnos,
        estado = 'pendiente', abierto_en = null, abierto_por_legajo = null,
        confirmado_en = null, confirmado_por_legajo = null, actualizado_en = now();

      v_cambiados := v_cambiados + 1;
    else
      insert into whatsapp_avisos (legajo, lugar, mes, anio, publicacion_id, fingerprint_turnos, estado, actualizado_en)
      values (r.legajo, p_lugar, p_mes, p_anio, v_nueva_id, v_fp_nueva, 'pendiente', now())
      on conflict (legajo, lugar, mes, anio) do update set
        publicacion_id = excluded.publicacion_id,
        fingerprint_turnos = excluded.fingerprint_turnos,
        actualizado_en = now();
    end if;
  end loop;

  return v_cambiados;
end;
$$;

comment on function fn_whatsapp_sincronizar_tras_publicar is
  'Llamar una vez después de cada publicación exitosa (pages/api/publicar-guardias.js). Resetea a pendiente SOLO los avisos de los efectivos cuyo contenido publicado cambió; conserva la confirmación de los demás.';
