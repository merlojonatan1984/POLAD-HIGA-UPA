-- Datos 100% ficticios, solo para estas pruebas locales.
insert into efectivos (legajo, nombre, password, es_admin, lugar) values
  ('ADMIN1', 'Admin, Uno', 'claveadmin', true, 'HIGA'),
  ('100001', 'Gomez, Juan', null, false, 'HIGA'),
  ('100002', 'Perez, Ana', 'clavepropia', false, 'HIGA'),
  ('100003', 'Lopez, Marta', null, false, 'UPA'),
  ('100001', 'Gomez, Juan', null, false, 'MODULAR');  -- mismo legajo, otro lugar (comparten DB)

insert into configuracion (lugar, dia, hora_inicio, hora_fin, mes, anio, mes_apertura, anio_apertura) values
  ('HIGA', 25, '08:00', '20:00', 11, 2026, 10, 2026),
  ('UPA', 25, '08:00', '20:00', 11, 2026, 10, 2026);
  -- MODULAR sin fila: a propósito, para probar el comportamiento "sin config = cerrada".

-- Borrador (turnos) de HIGA para noviembre 2026
insert into turnos (legajo, dia, turno, sector, mes, anio) values
  ('100001', 5, 'd', 'Guardia', 11, 2026),
  ('100001', 6, 'n', 'Guardia', 11, 2026),
  ('100002', 5, 'd', 'Llaves', 11, 2026);
