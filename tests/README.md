# Pruebas — disponibilidad / borrador / publicación (corrección)

Dos grupos de pruebas, según lo que verifican. Ninguna toca la base de
Supabase real: todas corren contra una base PostgreSQL local, descartable,
con datos 100% ficticios, o contra funciones puras de JavaScript sin red.

## 1) `tests/pg/` — contra un PostgreSQL 16 real (no simulado)

Requiere un PostgreSQL 16 accesible. En el entorno de esta corrección se usó
uno local:

```bash
# instalar/arrancar postgres (si no está corriendo)
sudo service postgresql start

# crear la base de prueba y el usuario (una sola vez; si ya existen, saltar)
sudo -u postgres psql -c "alter user postgres password 'postgres_test_local';"
sudo -u postgres psql -c "create database polad_test;"
```

`03_concurrencia.js` necesita la librería `pg` de Node (dos conexiones reales
y simultáneas a PostgreSQL). `tests/pg/package.json` ya la declara como
dependencia; instalarla una sola vez con:

```bash
cd tests/pg
npm install
```

Cargar el esquema ficticio + las migraciones + los datos de prueba, y correr
las pruebas, EN ESTE ORDEN (cada paso depende del anterior):

```bash
cd tests/pg

export PGPASSWORD=postgres_test_local
psql -h localhost -U postgres -d polad_test -f 00_esquema_base_ficticio.sql
psql -h localhost -U postgres -d polad_test -f ../../supabase/migrations/0001_borrador_publicacion.sql
psql -h localhost -U postgres -d polad_test -f 01_seed_ficticio.sql
# 0004 (sexo, puesto fijo, objetivos, avisos de WhatsApp — Puntos 1/2/3/9
# de la ronda de los diez puntos). Aditiva: no modifica ninguna tabla ni
# función de 0001.
psql -h localhost -U postgres -d polad_test -f ../../supabase/migrations/0004_reglas_individuales_y_avisos.sql
# 0005 (NUEVA — ronda de corrección de los 6 errores reproducidos sobre la
# entrega de 0004): guardado transaccional de puesto fijo/objetivo,
# correcciones de WhatsApp (fingerprint al abrir/confirmar, sincronización
# idempotente, guardias retiradas a cero, publicar+sincronizar atómico), y
# RLS/EXECUTE sobre las 5 tablas/funciones de 0004 (que nunca las había
# protegido). Aditiva: no modifica 0001/0002/0003, y usa `create or
# replace function` para las funciones de 0004 cuyo COMPORTAMIENTO cambia
# (0004 queda intacto en el historial).
psql -h localhost -U postgres -d polad_test -f ../../supabase/migrations/0005_correcciones_ronda_bugs.sql
# 0006 (NUEVA — tercera ronda, sobre los 3 errores que quedaron reportados
# tras revisar la entrega de 0005: puesto fijo en TODAS las fases —24hs y
# pareja—, reporte de objetivo, y confirmación de WhatsApp). Solo el punto 3
# (WhatsApp) necesitó SQL — los puntos 1 y 2 son 100% JavaScript
# (lib/asignacionRapidaFlujo.js + pages/admin.js). Aditiva: usa `create or
# replace function` donde el comportamiento cambia sin cambiar la firma
# (fn_whatsapp_sincronizar_tras_publicar), y `drop function` + `create
# function` donde la firma necesita un parámetro nuevo
# (fn_whatsapp_marcar_abierto/fn_whatsapp_confirmar_envio, que ahora reciben
# el fingerprint del contenido preparado por el cliente) — mismo criterio que
# ya documentó 0005 para sus propios cambios de firma.
psql -h localhost -U postgres -d polad_test -f ../../supabase/migrations/0006_correcciones_ronda3.sql

# 30 pruebas de corrección SQL (validación, atomicidad, concurrencia optimista,
# publicación, conservación de asistencia/planillas, fn_turnos_borrador_*,
# fn_guardar_disponibilidad_efectivo, fn_resumen_publicacion,
# fn_turnos_borrador_reemplazar_scope, fn_admin_guardar_efectivo —
# incluido el renombrado coordinado de disponibilidad/asistencia/
# planilla_manual/firmas)
psql -h localhost -U postgres -d polad_test -f 02_pruebas_basicas.sql

# 14 pruebas de concurrencia REAL (dos conexiones simultáneas de verdad,
# con la librería `pg` de Node, no simulado con mocks): disponibilidad
# admin-vs-admin, publicación doble clic, efectivo-vs-efectivo,
# efectivo-vs-administrador, publicar-vs-escribir-el-borrador, preview
# contra escritura concurrente, reemplazar_scope contra preview y contra
# publicación concurrente, renombrar_legajo contra publicación, dos
# ediciones concurrentes del mismo efectivo (sin legajo intermedio)
node 03_concurrencia.js

# 22 pruebas de RLS (Row Level Security) y permisos REALES, con roles de
# Postgres que imitan a `anon` y `service_role` de Supabase, incluyendo
# turnos/efectivos (ya cerradas), EXECUTE revocado sobre las funciones, y
# una política permisiva preexistente que NO debe anular el bloqueo. Este
# archivo aplica la migración 0002 internamente (`\ir`) después de crear
# los roles — no hace falta aplicar 0002 a mano antes.
psql -h localhost -U postgres -d polad_test -f 04_rls.sql

# NUEVAS EN ESTA RONDA (Puntos 1/2/3/9, 6, 10 — ver RESUMEN_RONDA_10_PUNTOS.md):

# 12 pruebas SQL: sexo (default + constraint), efectivo_puesto_fijo (alta +
# índice único activo + historial), efectivo_objetivo (alta + índice único
# activo + historial, caso Coronel 3→2), y el escenario completo de
# sincronización de avisos de WhatsApp tras publicar (fn_whatsapp_
# sincronizar_tras_publicar): reset independiente por efectivo según
# fingerprint de guardias publicadas.
psql -h localhost -U postgres -d polad_test -f 05_reglas_individuales_y_avisos.sql

# 5 pruebas SQL: sumatoria de horas cruzada entre los 3 destinos (borrador)
# y horas realizadas (publicado ∩ asistencia) — confirma que son columnas
# de fuentes distintas que NUNCA se suman entre sí ni duplican una guardia.
psql -h localhost -U postgres -d polad_test -f 06_resumen_horas_cruzadas.sql

# 7 pruebas (Node + pg real): ingreso de administrador MULTI-DESTINO (mismo
# legajo, varias filas es_admin=true, una por lugar) — el caso que antes
# rompía el login con `.maybeSingle()` en pages/api/auth-login.js.
node 07_admin_multidestino.js

# NUEVO EN ESTA RONDA (corrección de los 6 errores reproducidos — ver
# RESUMEN_CORRECCION_ERRORES.md): 23 pruebas SQL de lo agregado por 0005 —
# guardado transaccional de puesto fijo/objetivo (feliz + reversión
# completa si falla), WhatsApp (abrir fotografía el fingerprint, confirmar
# lo exige vigente, sincronización idempotente, guardias retiradas a
# cero), fn_publicar_guardias_y_sincronizar_whatsapp atómica (si la
# sincronización falla, la publicación también se revierte), y RLS/EXECUTE
# sobre las 5 tablas/funciones de 0004 (antes sin proteger). Crea y destruye
# sus propios roles anon/service_role (igual que 04_rls.sql) y reaplica
# 0005 con `\ir` después de crearlos, para que las políticas "to anon" (que
# 0005 deja pendientes si ese rol no existe todavía, igual que 0002) se
# terminen de crear.
psql -h localhost -U postgres -d polad_test -f 08_correcciones_ronda_bugs.sql

# NUEVO EN ESTA RONDA (tercera ronda de correcciones — Falla 3,
# "Confirmación de WhatsApp" — ver RESUMEN_CORRECCION_RONDA3.md): 6 pruebas
# SQL secuenciales de lo agregado por 0006 — abrir el mensaje con el
# fingerprint de una pantalla desactualizada se rechaza (nunca registra
# contenido nuevo como comunicado mediante un mensaje viejo); confirmar
# desde una pestaña con el contenido viejo se rechaza aunque OTRA pestaña
# ya haya abierto el mensaje vigente.
psql -h localhost -U postgres -d polad_test -f 09_correcciones_ronda3.sql

# NUEVO EN ESTA RONDA: 3 pruebas de concurrencia REAL (dos conexiones de
# PostgreSQL simultáneas, mismo patrón que 03_concurrencia.js) — confirmar
# el envío de un efectivo mientras OTRA sesión está publicando/sincronizando
# el contenido de ESE MISMO efectivo (sin haber hecho aún commit): la
# confirmación queda bloqueada por el lock de fila, nunca se intercala, y al
# desbloquearse ve el estado ya sincronizado y se rechaza — nunca queda
# confirmado un contenido distinto del que quedó publicado.
node 10_correcciones_ronda3_concurrencia.js
```

Cada bloque imprime `OK - <descripción>` (o `NOTICE: OK (rol) - ...` en
04_rls.sql) si pasa, o aborta con `FALLO: ...` si no. `03_concurrencia.js`,
`07_admin_multidestino.js` y `10_correcciones_ronda3_concurrencia.js`
terminan con una línea "Todas las pruebas ... pasaron." si todo salió bien.

Para volver a correr todo desde cero (recomendado si se edita cualquier
migración):

```bash
cd tests/pg
export PGPASSWORD=postgres_test_local
psql -h localhost -U postgres -d postgres -c "drop database if exists polad_test;"
psql -h localhost -U postgres -d postgres -c "create database polad_test;"
psql -h localhost -U postgres -d polad_test -f 00_esquema_base_ficticio.sql
psql -h localhost -U postgres -d polad_test -f ../../supabase/migrations/0001_borrador_publicacion.sql
psql -h localhost -U postgres -d polad_test -f 01_seed_ficticio.sql
psql -h localhost -U postgres -d polad_test -f ../../supabase/migrations/0004_reglas_individuales_y_avisos.sql
psql -h localhost -U postgres -d polad_test -f ../../supabase/migrations/0005_correcciones_ronda_bugs.sql
psql -h localhost -U postgres -d polad_test -f ../../supabase/migrations/0006_correcciones_ronda3.sql
psql -h localhost -U postgres -d polad_test -f 02_pruebas_basicas.sql
node 03_concurrencia.js
psql -h localhost -U postgres -d polad_test -f 04_rls.sql
psql -h localhost -U postgres -d polad_test -f 05_reglas_individuales_y_avisos.sql
psql -h localhost -U postgres -d polad_test -f 06_resumen_horas_cruzadas.sql
node 07_admin_multidestino.js
psql -h localhost -U postgres -d polad_test -f 08_correcciones_ronda_bugs.sql
psql -h localhost -U postgres -d polad_test -f 09_correcciones_ronda3.sql
node 10_correcciones_ronda3_concurrencia.js
```

`04_rls.sql` y `06_resumen_horas_cruzadas.sql` son idempotentes: dejan la
base exactamente como la encontraron (políticas, RLS y roles de prueba
incluidos, o sus propias filas de prueba borradas al empezar), así que se
pueden correr varias veces sin necesidad de recrear la base.
`05_reglas_individuales_y_avisos.sql`, `07_admin_multidestino.js`,
`08_correcciones_ronda_bugs.sql`, `09_correcciones_ronda3.sql` y
`10_correcciones_ronda3_concurrencia.js` NO son idempotentes tal como están
(no borran sus propias filas de prueba al empezar, solo al final/si fallan a
mitad de camino) — para repetirlos sin recrear toda la base, borrar antes
sus propios legajos de prueba (ver el encabezado de cada archivo) o
recrear la base desde cero como arriba.

### Qué prueba cada archivo

- **02_pruebas_basicas.sql** (30 pruebas): validación de día/turno/lugar;
  guardado administrativo atómico; reversión completa si falla la
  auditoría (simulando la falla con una restricción temporal); concurrencia
  optimista (incluso partiendo de "nada cargado"); publicación feliz;
  rechazo de `version_base` vieja (doble clic/reintento); rechazo de
  borrador cambiado desde el preview; el borrador editado después de
  publicar no toca lo publicado; asistencia y planilla_manual ya
  registradas no se alteran ni se borran al editar el borrador y publicar
  de nuevo; las cinco funciones `fn_turnos_borrador_*` (insertar en lote,
  rechazo de sector inválido, editar/borrar una fila con rechazo si el
  `lugar` no coincide con la fila real, borrar por scope, renombrar legajo
  acotado a `p_lugar`); `fn_guardar_disponibilidad_efectivo` exige
  `dias_antes_esperado` igual que la ruta administrativa, no se puede
  omitir; `fn_resumen_publicacion` (resumen/hash/versión de un mismo estado
  consistente); `fn_turnos_borrador_reemplazar_scope` (reemplazo atómico
  feliz, y rechazo sin borrar nada si el lote nuevo es inválido);
  `fn_admin_guardar_efectivo` (edición + renombrado de turnos atómicos, y
  reversión completa si hay legajo duplicado; renombrado coordinado de
  disponibilidad/asistencia/planilla_manual acotado a `p_lugar`, sin
  afectar la misma relación de otra persona que comparte legajo en otro
  lugar; firmas —sin columna lugar— se renombra solo cuando es inequívoco,
  y se omite explícitamente cuando el legajo viejo o el nuevo podrían
  pertenecer a más de un efectivo; si la operación completa falla, ninguna
  de las cinco relaciones queda a medio renombrar).
- **03_concurrencia.js** (14 pruebas, dos conexiones PostgreSQL reales y
  simultáneas, no simuladas): dos guardados de disponibilidad al mismo
  tiempo sobre el mismo efectivo/lugar/mes/año (gana uno, el otro se
  rechaza, sin mezcla); doble clic/reintento de publicación (solo una
  publicación se crea); efectivo contra efectivo partiendo de
  disponibilidad vacía; efectivo contra administrador sobre el mismo
  recurso, también partiendo de disponibilidad vacía; publicar una versión
  nueva mientras se escribe el borrador del mismo lugar/mes/año —se
  serializan bajo el lock compartido, sin rechazos espurios y sin perder el
  insert—; preview (`fn_resumen_publicacion`) contra una escritura
  concurrente del borrador (bloqueo real, el resumen refleja el estado de
  antes, y confirmar con ese preview después de la escritura se rechaza por
  desactualización); `fn_turnos_borrador_reemplazar_scope` contra un preview
  concurrente del mismo scope (sin hueco vacío intermedio visible) y contra
  una publicación real concurrente (nunca una mezcla ni un hueco vacío
  publicado); renombrar_legajo contra una publicación simultánea (el
  borrador final queda completamente renombrado, nunca a medias); dos
  ediciones concurrentes del mismo efectivo (dos legajos nuevos distintos,
  mismo id) se serializan bajo el lock de fila (`FOR UPDATE`) de
  `fn_admin_guardar_efectivo` — el efectivo y todas sus relaciones
  (turnos, disponibilidad, asistencia, planilla_manual) terminan
  consistentes con el legajo final, nunca repartidas entre el legajo
  viejo, uno intermedio y el nuevo.
- **04_rls.sql** (22 pruebas): con un rol que imita a `anon` (sin
  BYPASSRLS): disponibilidad/configuracion/publicaciones/turnos_publicados/
  disponibilidad_auditoria/**turnos**/**efectivos** quedan en 0 filas en un
  select e insert rechazado, aunque haya datos cargados (turnos/efectivos ya
  cerradas, no solo propuesto — ver
  `supabase/migrations/0002_rls_propuesta.sql`); 4 funciones representativas
  no se pueden invocar por RPC directo (`EXECUTE` revocado, sqlstate
  `42501`); una política permisiva preexistente (`using(true)`) agregada a
  propósito sobre `disponibilidad` NO anula el bloqueo restrictivo (sección
  4, el caso pedido explícitamente en la revisión); con un rol que imita a
  `service_role` (BYPASSRLS), todo sigue funcionando con normalidad,
  incluyendo turnos/efectivos. Idempotente: se puede correr varias veces sin
  recrear la base (confirmado corriéndolo dos veces seguidas).
- **05_reglas_individuales_y_avisos.sql** (12 pruebas — NUEVO en esta
  ronda, Puntos 1/2/3/9): `sexo` en `efectivos` (default `sin_informar`,
  constraint rechaza valores fuera de femenino/masculino/sin_informar,
  valor explícito se guarda tal cual); `efectivo_puesto_fijo` (alta feliz,
  el índice único parcial `idx_puesto_fijo_activo_unico` impide dos reglas
  activas para el mismo efectivo+lugar, cambiar el puesto desactiva la
  anterior y crea una nueva sin borrar el historial); `efectivo_objetivo`
  (mismo patrón — alta, índice único activo, y el caso Coronel 3→2: editar
  la cantidad conserva el historial completo, nunca borra el valor
  anterior); `fn_whatsapp_sincronizar_tras_publicar` (primera publicación
  deja a todos en "pendiente"; al republicar con cambios SOLO en un
  efectivo, el otro conserva su confirmación intacta y únicamente el que
  cambió vuelve a pendiente, con su confirmación anterior archivada en
  `whatsapp_avisos_historial`, nunca interpretada como vigente).
- **06_resumen_horas_cruzadas.sql** (5 pruebas — NUEVO en esta ronda, Punto
  6): replica la aritmética exacta de `pages/api/resumen-guardias.js` contra
  datos reales en Postgres — "Horas (3 destinos)" suma correctamente
  HIGA+UPA+MODULAR del mismo legajo/mes/año (32hs = 12+12+8 en el caso de
  prueba) sin inflar a quien solo tiene guardias en un lugar; "Horas
  realizadas" (turnos_publicados ∩ asistencia confirmada, solo de este
  lugar) es una columna de una fuente completamente distinta del borrador,
  y la misma guardia que existe en ambas fuentes (borrador y publicado+
  asistida) nunca se cuenta dos veces dentro de una misma columna ni
  contamina a la otra; sin publicación vigente, "Horas realizadas" queda en
  0 para todos, nunca inventada a partir del borrador.
- **07_admin_multidestino.js** (7 pruebas, Node + librería `pg` real — NUEVO
  en esta ronda, Punto 10): confirma, contra filas reales insertadas en
  Postgres, que un administrador MULTI-DESTINO (mismo legajo, varias filas
  `es_admin=true`, una por lugar — permitido por `unique(legajo, lugar)` en
  `efectivos`) resuelve siempre a la fila del lugar correcto accediendo
  desde HIGA/UPA/MODULAR; que si el administrador NO tiene acceso a alguno
  de los tres, el acceso desde ese lugar se rechaza con un mensaje claro en
  vez de inventar acceso; y que el caso normal (un único lugar, el único que
  existía hasta ahora) sigue funcionando exactamente igual que antes. Ver
  `RESUMEN_RONDA_10_PUNTOS.md` para el detalle del error que esto corrigió
  en `pages/api/auth-login.js` (`.maybeSingle()` rompía el login de un
  administrador multi-destino real).
- **08_correcciones_ronda_bugs.sql** (23 pruebas — NUEVO, ronda de
  corrección de los 6 errores reproducidos sobre la entrega anterior, ver
  `RESUMEN_CORRECCION_ERRORES.md`): `fn_guardar_puesto_fijo` y
  `fn_guardar_objetivo` (alta feliz en una sola llamada, y — forzando el
  fallo con una violación real en el paso de inserción final, mismo
  criterio que ya usa `02_pruebas_basicas.sql` con `fn_guardar_disponibilidad_admin`
  — que si ese paso falla se revierte TODO: la regla/objetivo anterior
  sigue activo exactamente como estaba, y el historial no queda con un
  registro de un cambio que nunca se completó); `fn_desactivar_objetivo`
  (feliz, e id inexistente devuelve `false` sin lanzar ni tocar nada);
  `fn_whatsapp_marcar_abierto` (fotografía el fingerprint vigente al
  abrir); `fn_whatsapp_confirmar_envio` (rechaza confirmar si nunca se
  abrió con el contenido actual, rechaza confirmar un mensaje abierto
  ANTES de que las guardias publicadas de ese efectivo cambiaran —el caso
  reportado—, y acepta al reabrir con el contenido vigente);
  `fn_whatsapp_sincronizar_tras_publicar` (repetir la sincronización para
  la MISMA publicación vigente, sin publicar de nuevo, es un no-op que
  nunca vuelve a resetear una confirmación recién hecha; un efectivo que
  queda con CERO guardias publicadas sigue siendo detectado —nunca
  desaparece del universo a revisar— y su aviso vuelve a pendiente, listo
  para poder comunicar justamente que se le retiraron todas);
  `fn_publicar_guardias_y_sincronizar_whatsapp` (camino feliz, y —forzando
  el fallo quitando temporalmente `whatsapp_avisos_historial` dentro de un
  bloque que la restaura antes de cualquier aserción— que si la
  sincronización de avisos falla, TODA la transacción se revierte, la
  publicación incluida: nunca queda una publicación nueva confirmada con
  avisos desactualizados); RLS real y `EXECUTE` revocado (con roles que
  imitan `anon`/`service_role`, mismo patrón que `04_rls.sql`) sobre las 5
  tablas/funciones nuevas de 0004 que nunca habían quedado protegidas.
- **09_correcciones_ronda3.sql** (6 pruebas — NUEVO, tercera ronda de
  correcciones, Falla 3 "Confirmación de WhatsApp", ver
  `RESUMEN_CORRECCION_RONDA3.md`): secuenciales, sobre lo agregado por 0006.
  Caso A ("pantalla con versión anterior, nueva publicación, apertura del
  mensaje"): se publica v1, el navegador la carga (fingerprint v1); se
  publica v2 (cambia el contenido); intentar ABRIR el mensaje todavía con el
  fingerprint de v1 se rechaza (`contenido_desactualizado`) sin registrar
  nada, y recargar con el fingerprint de v2 sí permite abrir con normalidad.
  Caso B ("dos pestañas con mensajes de versiones distintas"): una pestaña
  ya abrió el mensaje con el contenido vigente (v2); otra pestaña, que
  nunca recargó, intenta CONFIRMAR directo con el fingerprint viejo (v1) —
  se rechaza (`contenido_cambio_desde_apertura`) aunque la fila tenga una
  apertura reciente y válida de la otra pestaña (prueba específicamente la
  segunda validación de `fn_whatsapp_confirmar_envio`, independiente de la
  primera); la pestaña con el contenido vigente sí puede confirmar.
- **10_correcciones_ronda3_concurrencia.js** (3 pruebas, dos conexiones
  PostgreSQL reales y simultáneas, mismo patrón que `03_concurrencia.js` —
  NUEVO, tercera ronda, Falla 3): "confirmación simultánea con una
  publicación" real — mientras una sesión está publicando/sincronizando el
  contenido de un efectivo dentro de una transacción todavía sin COMMIT
  (sostiene el lock `FOR UPDATE` de la fila de `whatsapp_avisos` de ese
  efectivo), otra sesión intenta confirmar el envío para ESE MISMO efectivo
  con el fingerprint que tenía cargado antes de la publicación: queda
  bloqueada por el lock (nunca se intercala), y al desbloquearse (tras el
  COMMIT de la publicación) ve el estado YA sincronizado y se rechaza — el
  estado final queda coherente (`pendiente`, con el fingerprint de la
  publicación nueva), nunca "confirmado" con un contenido que ya no es el
  vigente.

## 2) `tests/node/` — pruebas puras de JavaScript (sin base de datos)

```bash
TZ=UTC node tests/node/01_tiempo_argentina.js
node tests/node/02_generar_turnos_flujo.js
node tests/node/03_objetivos_efectivos.js
node tests/node/04_planilla_sin_cubrir_tramado.js
node tests/node/05_asignacion_rapida_flujo.js
```

**Importante (01):** correr con `TZ=UTC` adelante — así es como corre el
servidor real (Vercel). Sin eso, la prueba todavía pasaría igual (la
función usa `Intl` con `timeZone` fijo, no depende de la zona horaria del
proceso), pero correrla en UTC es lo que demuestra que el servidor en UTC
no es un problema, en vez de asumirlo.

**01_tiempo_argentina.js** (14 pruebas): confirma que el proceso corre
realmente en UTC; que `ahoraEnArgentina()` devuelve la hora de pared de
Buenos Aires (UTC-3) a partir de un reloj UTC; un caso fijo que cruza la
medianoche UTC cae en el día correcto de Argentina; los bordes exactos de
apertura/cierre de la ventana (inclusive); la ventana cerrada por defecto
si falta/está incompleta la configuración; `mes_apertura`/`anio_apertura`
sin configurar toman el mes/año actual.

**02_generar_turnos_flujo.js** (22 pruebas): prueba REAL del flujo de
JavaScript de `generarTurnos()` (no SQL) — importa
`lib/generarTurnosFlujo.js` (el mismo módulo que usa `pages/admin.js`) y lo
ejercita con un `fetch` mockeado. Confirma que un error HTTP, de red, de
JSON o de estructura al leer disponibilidad DETIENE la operación antes de
llamar a `reemplazar_scope` (nunca llega a escribir nada); que una lectura
válida pero vacía (disponibilidad realmente vacía) sigue de largo con
normalidad; que un resultado válido de 0 asignaciones CON un borrador
previo no lo vacía automáticamente; y el camino feliz completo. Ver el
comentario al inicio de `lib/generarTurnosFlujo.js` para el detalle de por
qué se extrajo esta orquestación a un módulo aparte, sin React ni JSX.

**03_objetivos_efectivos.js** (19 pruebas — NUEVO en esta ronda, Punto 3):
prueba REAL de `lib/objetivosEfectivos.js` (el mismo módulo que usa
`pages/admin.js` en `cargarRapida`/`procesarRapida`): `objetivoEnGuardias`
(conversión horas→guardias según horas/turno del lugar, HIGA/UPA 12hs vs.
MODULAR 8hs, siempre redondeando hacia abajo, nunca inventando una guardia
parcial de más; `null` ante configuración inválida); `resolverObjetivoGuardias`
(el objetivo configurado siempre reemplaza al derivado del mes anterior,
incluso si el derivado es 0 — caso Guillermo Solís/Pablo Leiva, efectivos
nuevos); `turnosPermitidosPorObjetivo` (día/noche/ambos, incluida la
diferencia entre HIGA/UPA de 2 turnos y MODULAR de 3); `resumenObjetivo`
(cumplido/pendiente/motivo, nunca "cumplido" cuando no lo está).

**04_planilla_sin_cubrir_tramado.js** (8 pruebas — NUEVO en esta ronda,
Punto 5): prueba REAL de ExcelJS (sin red, sin base de datos) de las dos
técnicas de celda copiadas literalmente de
`pages/api/generar-planilla.js` — fill `darkTrellis` (tramado, "no
corresponde cubrir": Rondín Externo de día, cupo 0; el 2do espacio de Salud
Mental/Llaves de noche, cupo 1) vs. fill negro sólido + texto blanco "SIN
CUBRIR" (vacante real dentro del cupo). Escribe un `.xlsx` real, lo
RELEE con ExcelJS, y confirma que el pattern/color/texto de cada celda
persistió exactamente como se pidió. No ejercita el endpoint completo
(requiere Supabase real, no disponible en este entorno) — prueba que la
técnica de estilo exacta que usa ese endpoint es válida.

**05_asignacion_rapida_flujo.js** (63 pruebas — ronda de corrección de los
6 errores reproducidos en la "Asignación rápida" sobre la entrega de 0004
(ver `RESUMEN_CORRECCION_ERRORES.md`), MÁS la Falla 1 ("puesto fijo en
TODAS las fases") y la Falla 2 ("reporte de objetivo") de la tercera ronda
sobre la entrega de 0005 (ver `RESUMEN_CORRECCION_RONDA3.md`)): prueba REAL
del algoritmo — importa `lib/asignacionRapidaFlujo.js` (el mismo módulo que
ahora usa `pages/admin.js` en `procesarRapida`, extraído de ese archivo
exactamente con el mismo criterio que
`lib/generarTurnosFlujo.js`/`lib/objetivosEfectivos.js`) y lo ejercita con
datos ficticios, nunca con una reimplementación aparte. Cubre, cada uno con
un caso concreto: puesto fijo que descuenta guardias existentes y se
detiene al llegar al objetivo (antes asignaba de más); turno día/noche/ambos
respetado en TODAS las fases (puesto fijo, 24hs y parejas), con las
configuraciones incompatibles detectadas e informadas explícitamente en vez
de ignoradas en silencio; 24hs que no agrega nada si el objetivo ya está
cubierto; el cruce HIGA↔UPA/MODULAR por "Rondín Externo"; puesto fijo que
queda PENDIENTE e informado en vez de completarse automáticamente en otro
sector; la orquestación (`ejecutarAsignacionRapida`) deteniéndose ANTES de
escribir si falla cualquier lectura — nunca tratando ese error como "lista
vacía". Tercera ronda (Falla 1, "puesto fijo en todas las fases"): un
efectivo con puesto fijo marcado para 24hs queda confinado SIEMPRE a su
sector configurado (si no hay cupo, el día queda sin asignar — nunca se
completa en otro sector como "Guardia"; incluido el caso sin NINGÚN día con
cupo, que deja el objetivo completo pendiente e informado); puesto fijo con
turno específico + 24hs es una incompatibilidad informada; una pareja con
uno de sus integrantes en puesto fijo queda confinada a ese sector (si no
hay cupo, para ninguno de los dos — nunca "Guardia" en su lugar); dos
integrantes de una pareja con puestos fijos en sectores DISTINTOS es una
incompatibilidad informada y nunca se los asigna juntos (cada uno conserva
su propio puesto fijo individual). Tercera ronda (Falla 2, "reporte de
objetivo"): cada entrada del reporte y de `puestoFijoReporte` distingue
`anteriores`/`nuevas`/`total`/`pendiente` (antes solo existía `asignadas`,
las guardias nuevas de la corrida, comparadas contra el objetivo completo —
con objetivo 3, 2 anteriores y 1 nueva, decía que faltaban 2 cuando el total
ya era 3); se prueba el caso reproducido exacto (objetivo 3, 2 anteriores, 1
nueva → total 3, pendiente 0) y se extiende a los demás casos y regresiones
ya existentes. Además, regresiones explícitas: guardias previas conservadas
y contadas contra el objetivo, repetir "Asignar" no duplica ni supera el
objetivo, y un camino feliz sin reglas especiales sigue funcionando
exactamente igual que antes.

## 3) Qué no cubren estas pruebas (endpoints y pantallas)

`tests/pg/` prueba funciones SQL contra un PostgreSQL real;
`tests/node/*.js` prueban funciones puras de JavaScript (algunas, mockeando
`fetch`, no contra un servidor real; `04_planilla_sin_cubrir_tramado.js`
contra ExcelJS real pero sin red). No existe en este proyecto ningún test
automático de **endpoint** (una llamada HTTP real a `/api/...`) ni de
**pantalla** (abrir `admin.js`, `ControlApp.js`,
`EfectivoApp.js`, etc. en un navegador real). Esos dos niveles se
verificaron por revisión de código línea por línea más `next build`
(compilación, tipos y empaquetado) — nunca ejecutando el endpoint o la
pantalla de verdad, porque este entorno no tiene un servidor Next.js
corriendo ni acceso a ningún proyecto Supabase real. Ver
`RESUMEN_CORRECCION.md` (ronda anterior: generarTurnos, coherencia de
legajo), `RESUMEN_RONDA_10_PUNTOS.md` (ronda de los diez pedidos
funcionales), `RESUMEN_CORRECCION_ERRORES.md` (ronda de los 6 errores
reproducidos del algoritmo de asignación + WhatsApp + guardado
transaccional) y `RESUMEN_CORRECCION_RONDA3.md` (esta ronda: puesto fijo en
todas las fases, reporte de objetivo, confirmación de WhatsApp) para el
detalle punto por punto de qué se verificó en cada nivel, y para las
instrucciones completas de cómo correr ese recorrido HTTP/navegador en un
entorno aislado real. En particular, `pages/api/admin-reglas-puesto.js`,
`admin-reglas-objetivo.js`, `whatsapp-avisos.js` y `publicar-guardias.js`
llaman a las funciones de `0005_correcciones_ronda_bugs.sql`/
`0006_correcciones_ronda3.sql` vía `supabase.rpc(...)` — `08_correcciones_ronda_bugs.sql`
y `09_correcciones_ronda3.sql`/`10_correcciones_ronda3_concurrencia.js`
prueban esas funciones SQL directamente, no la llamada HTTP al endpoint en
sí. Esta ronda, además de revisar línea por línea, se encontró y corrigió
UN bug real durante esa revisión (no detectable por los tests de
`lib/asignacionRapidaFlujo.js`, que no ejercitan `pages/admin.js` en sí):
el botón "confirmar envío" del aviso ⏳ en la vista "Personal" llamaba a
`confirmarAviso(e.legajo)` sin el fingerprint del contenido vigente
(`fpActualEf`) que esta misma ronda agregó como parámetro obligatorio del
lado del servidor — ese botón específico habría fallado siempre con
"Falta fingerprint_cliente". Corregido pasando `fpActualEf` también ahí
(ver `RESUMEN_CORRECCION_RONDA3.md`).

## Qué queda simulado (no ejecutado contra una base o servidor real) y por qué

Nada de lo de `tests/pg/` ni `tests/node/` es simulado en el sentido de
"inventado" — todo corre contra un PostgreSQL real, contra la
implementación real de `lib/tiempoArgentina.js`, `lib/generarTurnosFlujo.js`
(con un `fetch` mockeado a propósito, la forma estándar de probar código
que depende de la red sin necesitar un servidor real), `lib/objetivosEfectivos.js`,
`lib/asignacionRapidaFlujo.js` (mismo criterio: `fetch` mockeado para
`ejecutarAsignacionRapida`, y los datos ya leídos pasados directo para
`calcularAsignacionRapida`, que nunca hace red), o contra ExcelJS real
(`04_planilla_sin_cubrir_tramado.js`, escribiendo y releyendo un `.xlsx`
real). Lo que NO se pudo ejecutar en esta etapa, por no tener acceso a
ello desde este entorno:

- Las pruebas de arriba contra el proyecto Supabase real (se usó una base
  local ficticia en su lugar — ver `RESUMEN_CORRECCION.md`,
  `RESUMEN_RONDA_10_PUNTOS.md` y `RESUMEN_CORRECCION_ERRORES.md`).
- Cualquier interacción real con la API de WhatsApp/Meta (el mecanismo de
  envío sigue siendo el mismo enlace `wa.me` de siempre — nunca hubo ni hay
  una API de WhatsApp real involucrada en abrir ese enlace; lo que esta
  ronda corrige es el seguimiento de abrir/confirmar/sincronizar, que sí
  está probado por SQL en `05_reglas_individuales_y_avisos.sql` y
  `08_correcciones_ronda_bugs.sql`).
- Cualquier llamada HTTP real a un endpoint (`/api/...`) o apertura de una
  pantalla (`admin.js`, `ControlApp.js`, `EfectivoApp.js`, `carga-planillas.js`)
  en un navegador real — incluidos los endpoints modificados en esta ronda
  (`admin-reglas-puesto.js`, `admin-reglas-objetivo.js`, `whatsapp-avisos.js`,
  `publicar-guardias.js`, ahora todos llamando por `supabase.rpc(...)` a
  las funciones atómicas de `0005_correcciones_ronda_bugs.sql`) y la
  pantalla de "Asignación rápida" en sí (`pages/admin.js`, que ahora delega
  el cálculo en `lib/asignacionRapidaFlujo.js` — ver más arriba) contra
  datos reales de Supabase.
