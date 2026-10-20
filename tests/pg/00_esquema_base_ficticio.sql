-- ============================================================================
-- Esquema base FICTICIO para pruebas locales, reconstruido por inspección
-- del código (no es un dump de la base real: nunca tuvimos acceso a ella).
-- Reproduce únicamente las columnas que el código efectivamente lee o
-- escribe (confirmado por grep sobre pages/, pages/api/ y components/),
-- para poder correr contra un PostgreSQL real las funciones nuevas de
-- 0001_borrador_publicacion.sql sin tocar ningún dato real.
-- ============================================================================

create table efectivos (
  id           bigserial primary key,
  legajo       text not null,
  nombre       text not null,
  password     text,
  es_admin     boolean not null default false,
  lugar        text not null,
  tipo         text,
  jerarquia    text,
  dni          text,
  email        text,
  telefono     text,
  sector       text,
  notas        text,
  planilla_url text,
  firma_url    text,
  -- pages/api/admin-efectivos.js ya asume que hay una restricción de
  -- unicidad (detecta "duplicate" al guardar). Acotada a (legajo, lugar) y
  -- no solo a legajo: 01_seed_ficticio.sql modela a propósito el mismo
  -- legajo existiendo en DOS lugares distintos ("mismo legajo, otro lugar
  -- (comparten DB)") — cada lugar tiene su propio padrón de legajos, así
  -- que lo único que de verdad tiene que ser único es el PAR (legajo,
  -- lugar). Agregada acá para poder probar esa validación de verdad contra
  -- Postgres real (fn_admin_guardar_efectivo), no solo asumirla.
  unique (legajo, lugar)
);

create table turnos (
  id     bigserial primary key,
  legajo text not null,
  dia    int not null,
  turno  text not null,
  sector text not null,
  mes    int not null,
  anio   int not null
);

create table disponibilidad (
  id                  bigserial primary key,
  legajo              text not null,
  dia                 int not null,
  turno               text not null,
  mes                 int not null,
  anio                int not null,
  lugar               text not null,
  cargado_por_legajo  text,
  cargado_en          timestamptz,
  origen              text default 'efectivo'
);

create table configuracion (
  id             bigserial primary key,
  lugar          text not null unique,
  dia            int,
  hora_inicio    text,
  hora_fin       text,
  mes            int,
  anio           int,
  mes_apertura   int,
  anio_apertura  int
);

create table asistencia (
  id            bigserial primary key,
  legajo        text not null,
  mes           int not null,
  anio          int not null,
  dia           int not null,
  turno         text not null,
  sector        text,
  lugar         text not null,
  presente      boolean default true,
  confirmado_at timestamptz
);

create table planilla_manual (
  id      bigserial primary key,
  legajo  text not null,
  mes     int not null,
  anio    int not null,
  dia     int not null,
  horario text not null,
  horas   int not null,
  sector  text,
  lugar   text not null
);

create table firmas (
  id        bigserial primary key,
  legajo    text not null,
  mes       int not null,
  anio      int not null,
  firma_url text
);
