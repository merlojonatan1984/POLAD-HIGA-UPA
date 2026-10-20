# POLAD — Tercera ronda de corrección (sobre la entrega anterior, 0005)

Alcance de esta ronda, tal como se pidió: corregir ÚNICAMENTE las 3 fallas
que quedaron reportadas después de revisar la entrega anterior (0005 +
`RESUMEN_CORRECCION_ERRORES.md`). No se abrió ninguna función nueva, no se
amplió el proyecto, no se hizo otra auditoría general, no se tocó Supabase
real, no se hizo deploy ni `git push`, y no se modificó ni bloqueó la
edición de legajos. Se trabajó sobre la última copia del proyecto.

## 0) Qué se ejecutó realmente en este entorno, y qué quedó pendiente

Se corrieron, contra un PostgreSQL 16 real y contra la lógica real de
JavaScript (nunca una reimplementación aparte ni solo conversiones de horas
a guardias), **en esta sesión, de punta a punta sobre una base recién
creada**:

- **63 verificaciones** en `tests/node/05_asignacion_rapida_flujo.js`
  (algoritmo real de asignación — las 43 de la ronda anterior más 20 nuevas
  de esta ronda: Falla 1 y Falla 2).
- Las **126 verificaciones** de los demás archivos `tests/node/*.js`
  (`01_tiempo_argentina.js`: 14, `02_generar_turnos_flujo.js`: 22,
  `03_objetivos_efectivos.js`: 19, `04_planilla_sin_cubrir_tramado.js`: 8) —
  regresión completa, sin tocar nada de esos módulos esta ronda.
- **9 pruebas SQL nuevas** sobre la Falla 3 ("Confirmación de WhatsApp"):
  6 en `tests/pg/09_correcciones_ronda3.sql` (secuenciales, contenido
  desactualizado al abrir, dos pestañas con versiones distintas) + 3 en
  `tests/pg/10_correcciones_ronda3_concurrencia.js` (concurrencia REAL, dos
  conexiones de PostgreSQL simultáneas — confirmar mientras se publica).
- Las **23 pruebas** de `tests/pg/08_correcciones_ronda_bugs.sql` (ronda
  anterior) re-corridas tal cual contra la base con 0006 ya aplicada, para
  confirmar que las firmas nuevas de `fn_whatsapp_marcar_abierto`/
  `fn_whatsapp_confirmar_envio` no rompieron nada de lo que ya probaban.
- Las **más de 150 pruebas** de `02_pruebas_basicas.sql`,
  `03_concurrencia.js`, `04_rls.sql`, `05_reglas_individuales_y_avisos.sql`,
  `06_resumen_horas_cruzadas.sql` y `07_admin_multidestino.js` (rondas
  anteriores) — regresión completa, sin tocar nada de esos módulos esta
  ronda.
- `next build` (con variables de entorno dummy, nunca contra Supabase real)
  después de cada cambio en `pages/admin.js` — confirma que compila; nunca
  se trató esto como prueba funcional.

Cada bloque se corrió DESPUÉS de recrear `polad_test` desde cero y aplicar
`00_esquema_base_ficticio.sql` + `0001` + `01_seed_ficticio.sql` + `0004` +
`0005` + `0006` en orden, exactamente como describe `tests/README.md`
(actualizado en esta ronda). Todo pasó en limpio, sin editar ninguna
aserción para que "pasara" — donde una prueba falló al escribirla (ver
sección 5), se corrigió el código, nunca la prueba.

**Lo que NO se pudo ejecutar, y por qué** (igual que en las rondas
anteriores — este entorno no tiene un servidor Next.js corriendo ni acceso
a ningún proyecto Supabase real):

- Ninguna llamada HTTP real a `/api/whatsapp-avisos`, `/api/publicar-guardias`,
  `/api/admin-reglas-puesto` ni `/api/admin-reglas-objetivo` — se verificaron
  por revisión de código línea por línea más `next build`, y las funciones
  SQL que esos endpoints invocan por `supabase.rpc(...)` se probaron
  directamente contra PostgreSQL real (arriba).
- Ninguna apertura real de `pages/admin.js` en un navegador — se verificó
  por revisión de código línea por línea (fue en esa revisión que se
  encontró el bug de `confirmarAviso` sin `fpActualEf`, ver sección 2).
- Ningún mensaje real de WhatsApp — el mecanismo de envío sigue siendo el
  mismo link `wa.me` de siempre, nunca hubo ni hay una API de WhatsApp/Meta
  real involucrada.
- Ninguna base de datos real de Supabase — se usó, como en las rondas
  anteriores, un PostgreSQL 16 local con datos 100% ficticios.

## 1) Falla 1 — "Puesto fijo en todas las fases"

**Error reproducido**: un efectivo con "Estacionamiento" fijo, marcado para
24 horas, recibía parte de la guardia en "Guardia"; asociado a una pareja,
recibía "Guardia" cuando "Estacionamiento" estaba ocupado. En ambos casos
sin informar ninguna incompatibilidad — el puesto fijo funcionaba como una
simple preferencia que se abandonaba en silencio apenas no alcanzaba.

**Corrección** (`lib/asignacionRapidaFlujo.js`, Fase 1 —24hs— y Fase 1.5
—parejas—): el puesto fijo ahora es SIEMPRE exclusivo cuando está
configurado, sin excepción por modalidad 24hs o pareja:

- 24hs + puesto fijo sin turno específico: la guardia de 24hs se cubre
  ENTERA en el sector configurado; si ese sector no tiene cupo para ambos
  turnos ese día, el día queda SIN asignar (nunca se reparte en otro
  sector con cupo libre).
- 24hs + puesto fijo CON turno específico: incompatible por definición (la
  24hs cubre ambos turnos, el puesto fijo solo uno) — se informa en
  `incompatibilidades` y no se asigna ninguna 24hs desde ese puesto.
- Pareja con uno (o ambos) de sus integrantes en puesto fijo: la pareja
  queda confinada al sector configurado; si no hay cupo para los dos juntos
  ahí, ese día/turno queda sin asignar para la pareja (nunca "Guardia" en
  su lugar).
- Pareja con los DOS integrantes en puestos fijos de sectores DISTINTOS:
  imposible asignarlos juntos en un único sector — incompatibilidad
  informada en `incompatibilidades`, nunca se los asigna juntos (cada uno
  conserva su propio puesto fijo individual de la Fase 0).
- La exclusividad de la Fase 2 (que ya existía desde la ronda anterior
  para quien NO estaba marcado 24hs) ahora aplica siempre que haya puesto
  fijo configurado, sin la excepción `&& !legajos24hs.has(legajo)` que
  dejaba pasar a la Fase 2 general a cualquier efectivo con 24hs + puesto
  fijo — exactamente la causa del bug reproducido (la 24hs no alcanzaba a
  cubrir todo el día en "Estacionamiento" y la Fase 2, sin saber que ese
  efectivo tenía puesto fijo, completaba el resto en "Guardia").

**Prueba ejecutada y resultado**: `tests/node/05_asignacion_rapida_flujo.js`,
sección "SEGUNDA RONDA — Falla 1" (5 casos, 15 aserciones, **PASARON**
contra el algoritmo real):

- 1a) puesto fijo + 24hs, un día sin cupo en el puesto fijo: el día queda
  sin asignar, el otro día (con cupo) se cubre entero en "Estacionamiento"
  — nunca aparece "Guardia" entre los sectores usados.
- 1b) mismo caso pero sin NINGÚN día con cupo libre: el objetivo queda
  100% pendiente e informado (motivo: "puesto fijo configurado... no se
  completa automáticamente en otro sector"), 0 guardias asignadas en
  cualquier sector.
- 1c) puesto fijo con turno específico + 24hs: incompatibilidad informada,
  0 guardias asignadas.
- 1d) puesto fijo + pareja con el puesto totalmente ocupado: el efectivo
  con puesto fijo no recibe ninguna guardia (ni individual ni como
  pareja), objetivo pendiente e informado.
- 1e) pareja con puestos fijos en sectores distintos: incompatibilidad
  informada, nunca asignados juntos, cada uno sigue asignándose solo en su
  propio puesto fijo.

## 2) Falla 2 — "Reporte de objetivo"

**Error reproducido**: objetivo 3, dos guardias existentes y una nueva
asignada en la corrida — la asignación era correcta, pero el reporte decía
que faltaban 2 (comparaba solo las guardias NUEVAS de la corrida contra el
objetivo completo, ignorando las que ya existían).

**Corrección** (`lib/asignacionRapidaFlujo.js`): cada entrada de `reporte`
y de `puestoFijoReporte` ahora expone por separado `anteriores` (las que ya
existían antes de esta corrida), `nuevas` (las agregadas en esta corrida),
`total` (`anteriores + nuevas`) y `pendiente` (siempre `objetivo - total`,
nunca contra solo las nuevas). `pages/admin.js` (`asignarUnoRapida`,
`asignarTodosRapida`, `mensajePuestoFijo`) se actualizó para mostrar estos
cuatro valores en los mensajes de pantalla, en vez del `asignadas`/
`pendiente` viejo que comparaba contra el objetivo completo.

**Prueba ejecutada y resultado**: el caso reproducido EXACTO (objetivo 3,
2 anteriores, 1 nueva) se agregó como aserción explícita dentro del test de
Bug 1 de la ronda anterior (que ya tenía ese escenario armado) —
**PASÓ**: `anteriores=2, nuevas=1, total=3, pendiente=0`. Además se
agregaron/corrigieron aserciones de `anteriores`/`total`/`pendiente` en
los demás casos y regresiones de `tests/node/05_asignacion_rapida_flujo.js`
que ya existían (puesto fijo simple, 24hs con objetivo ya cubierto, puesto
fijo con disponibilidad insuficiente, "guardias previas conservadas",
"repetir asignación no duplica") — las 63 aserciones del archivo
**PASARON**.

## 3) Falla 3 — "Confirmación de WhatsApp"

**Error reproducido**: el link de WhatsApp se construye en el NAVEGADOR,
con los turnos que el navegador tiene cargados en ese momento — pero
"abrir" registraba el fingerprint VIGENTE del SERVIDOR, sin recibir ninguna
identificación del contenido que el navegador efectivamente estaba a punto
de enviar. Si la pantalla estaba desactualizada, el mensaje REAL enviado
era viejo, pero el servidor registraba como "abierto" el fingerprint nuevo
— "registrar el contenido nuevo como comunicado mediante un mensaje viejo".

**Corrección** (`supabase/migrations/0006_correcciones_ronda3.sql` +
`pages/api/whatsapp-avisos.js` + `pages/admin.js`):

- Tanto "abrir" (`fn_whatsapp_marcar_abierto`) como "confirmar"
  (`fn_whatsapp_confirmar_envio`) ahora reciben, además de
  legajo/lugar/mes/año, el fingerprint del contenido que el NAVEGADOR
  preparó (`fingerprintTurnos()`, agregada en `pages/admin.js`, mismo
  algoritmo que usa el servidor). Si no coincide con el `fingerprint_turnos`
  vigente, la operación se RECHAZA (`contenido_desactualizado` al abrir) —
  nunca se registra nada a ciegas; el administrador tiene que recargar la
  pantalla de Personal antes de reintentar.
- "Confirmar" exige ADEMÁS que el fingerprint del cliente coincida con lo
  vigente (no solo que lo abierto coincida con lo vigente) —
  `contenido_cambio_desde_apertura` si cualquiera de las dos condiciones
  falla. Esto cubre el caso "dos pestañas con mensajes de versiones
  distintas": una pestaña puede tener abierto el contenido vigente, pero si
  OTRA pestaña con contenido viejo intenta confirmar, se rechaza igual.
- Ambas funciones (y `fn_whatsapp_sincronizar_tras_publicar`, que corre
  dentro de la misma transacción que la publicación) toman el lock de la
  fila (`FOR UPDATE`) ANTES de decidir nada — una confirmación y una
  publicación simultáneas sobre el mismo efectivo quedan SERIALIZADAS por
  PostgreSQL: la que llega segunda ve los datos ya escritos por la primera,
  nunca una lectura a medio camino.
- `pages/api/whatsapp-avisos.js` exige el nuevo campo `fingerprint_cliente`
  en el body de "abrir"/"confirmar" (400 si falta) y traduce los nuevos
  motivos de rechazo a mensajes legibles para el administrador.

**Bug propio encontrado y corregido durante esta misma revisión**: al
revisar `pages/admin.js` línea por línea para verificar que el fingerprint
del cliente se mandara en TODOS los lugares donde se llama a `abrirAviso`/
`confirmarAviso`, se encontró que el botón "confirmar envío" del aviso ⏳
("WhatsApp abierto — falta confirmar el envío") llamaba a
`confirmarAviso(e.legajo)` SIN el segundo argumento (`fpActualEf`) — ese
botón específico habría fallado SIEMPRE con "Falta fingerprint_cliente"
(400), porque el servidor ahora exige ese campo como string. Se corrigió
pasando `fpActualEf` también en esa llamada. El otro botón de confirmar (en
la tarjeta principal) ya lo hacía bien. Esto no estaba entre los 3 errores
reportados, pero es consecuencia directa de la corrección de la Falla 3, así
que se corrigió en el mismo lugar.

**Prueba ejecutada y resultado**:

- `tests/pg/09_correcciones_ronda3.sql` (6 aserciones, secuenciales,
  PostgreSQL real) — **PASÓ**: abrir con el fingerprint de una pantalla
  desactualizada se rechaza sin registrar nada; recargar y abrir con el
  contenido vigente funciona con normalidad; confirmar desde una pestaña
  con el fingerprint viejo se rechaza aunque otra pestaña ya tenga una
  apertura vigente y reciente; la pestaña con el contenido vigente confirma
  sin problema.
- `tests/pg/10_correcciones_ronda3_concurrencia.js` (3 aserciones, DOS
  conexiones de PostgreSQL reales y simultáneas — no una simulación, mismo
  patrón que `03_concurrencia.js`) — **PASÓ**: mientras una sesión publica
  y sincroniza el contenido de un efectivo dentro de una transacción
  todavía sin COMMIT, otra sesión que intenta confirmar el envío de ESE
  MISMO efectivo queda bloqueada por el lock de fila (se confirmó que no
  se resuelve antes de tiempo); al liberarse el lock, ve el estado YA
  sincronizado y se rechaza (`contenido_cambio_desde_apertura`); el estado
  final queda coherente (`pendiente`, con el fingerprint de la publicación
  nueva) — nunca "confirmado" con el contenido viejo.
- `tests/pg/08_correcciones_ronda_bugs.sql` (23 aserciones de la ronda
  anterior, re-corridas contra la base con 0006 ya aplicada) — **PASARON**
  sin cambios de comportamiento; la sección de ese archivo que vuelve a
  aplicar 0005 para crear las políticas RLS "to anon" sigue funcionando
  igual (0006 no tocó RLS, solo las dos funciones de WhatsApp con firma
  nueva).

## 4) Qué se conservó sin tocar (verificado, no solo asumido)

Se re-corrió, en esta misma sesión, TODA la batería de pruebas de las tres
rondas anteriores contra una base recreada desde cero con 0001→0006
aplicadas en orden:

- `tests/pg/02_pruebas_basicas.sql` (30), `04_rls.sql` (22),
  `05_reglas_individuales_y_avisos.sql` (12),
  `06_resumen_horas_cruzadas.sql` (5), `08_correcciones_ronda_bugs.sql`
  (23): **PASARON**.
- `tests/pg/03_concurrencia.js` (14, dos conexiones reales) y
  `07_admin_multidestino.js` (7, Node + `pg` real): **PASARON**.
- `tests/node/01_tiempo_argentina.js` (14), `02_generar_turnos_flujo.js`
  (22), `03_objetivos_efectivos.js` (19), `04_planilla_sin_cubrir_tramado.js`
  (8): **PASARON**.
- `next build` con variables dummy: compiló sin errores (ver advertencia
  no relacionada de la fuente de Google Fonts, igual que en rondas
  anteriores — no hay red hacia `fonts.googleapis.com` en este entorno, no
  afecta la compilación).

No se tocó `fn_admin_guardar_efectivo`, `fn_publicar_guardias` (se sigue
envolviendo, nunca editando), `fn_guardar_puesto_fijo`,
`fn_guardar_objetivo`, `fn_desactivar_objetivo`, ninguna de las migraciones
0001-0005, ni ninguna de las pruebas de rondas anteriores (solo se las
re-corrió, sin modificarlas, salvo el archivo de asignación rápida que ya
estaba previsto extender).

## 5) Archivos tocados en esta ronda

**Nuevos**:

- `supabase/migrations/0006_correcciones_ronda3.sql` — Falla 3 (SQL).
- `tests/pg/09_correcciones_ronda3.sql` — 6 pruebas SQL secuenciales,
  Falla 3.
- `tests/pg/10_correcciones_ronda3_concurrencia.js` — 3 pruebas de
  concurrencia real (dos conexiones PostgreSQL), Falla 3.
- `RESUMEN_CORRECCION_RONDA3.md` — este informe.

**Modificados**:

- `lib/asignacionRapidaFlujo.js` — Falla 1 (Fases 1 y 1.5) y Falla 2
  (forma del reporte).
- `pages/admin.js` — mensajes de pantalla actualizados a
  anteriores/nuevas/total/pendiente (Falla 2); `fingerprintTurnos()`,
  `abrirAviso`/`confirmarAviso` mandan el fingerprint del cliente, y se
  corrigió el botón de confirmar del aviso ⏳ que no lo mandaba (Falla 3,
  bug propio encontrado en esta revisión).
- `pages/api/whatsapp-avisos.js` — exige `fingerprint_cliente`, traduce
  los nuevos motivos de rechazo (Falla 3).
- `tests/node/05_asignacion_rapida_flujo.js` — 20 aserciones nuevas
  (Falla 1 y Falla 2) + todas las aserciones existentes que leían
  `.asignadas` actualizadas a la forma nueva del reporte
  (`anteriores`/`nuevas`/`total`/`pendiente`).
- `tests/README.md` — migración 0006 y archivos 09/10 agregados a la
  secuencia de setup, descripciones actualizadas.

**No se tocó**: ninguna otra función SQL, ninguna otra migración, ninguna
otra pantalla ni endpoint, ningún dato de legajos.
