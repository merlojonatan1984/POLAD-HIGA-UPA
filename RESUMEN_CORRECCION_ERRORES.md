# POLAD — Corrección de errores reproducidos sobre la entrega anterior

Fecha: 2026-10-20. Alcance de esta ronda, tal como se pidió: **únicamente**
los 6 errores reproducidos del algoritmo de asignación, el seguimiento de
WhatsApp, y el guardado transaccional de puesto fijo/objetivo — todos
reportados sobre la última entrega (los diez puntos, `RESUMEN_RONDA_10_PUNTOS.md`).
No se abrieron funciones nuevas, no se amplió el proyecto, no se hizo otra
auditoría general, no se tocó Supabase real, no hubo `git push` ni deploy,
y no se modificó ni bloqueó la edición de legajos. Se trabajó sobre la
última copia entregada; este informe reemplaza la entrega anterior
(`RESUMEN_RONDA_10_PUNTOS.md` sigue como antecedente histórico de esa
ronda, no se borra ni se reescribe).

Este informe distingue siempre, para cada punto: **error corregido**,
**prueba ejecutada y resultado**, y **qué no se pudo ejecutar y por qué**.
Nada se declara "terminado" por haber sido solo revisado o compilado.

## 0) Qué se ejecutó realmente en este entorno, y qué quedó pendiente

Este entorno es un contenedor aislado sin acceso a un proyecto Supabase
real, sin servidor Next.js corriendo, y sin navegador. Dentro de esas
condiciones, esta ronda sí tuvo acceso a un PostgreSQL 16 real instalable
en el propio contenedor (a diferencia de rondas anteriores en otros
entornos, donde no estaba disponible) — se usó para recrear la base
ficticia desde cero y correr **el conjunto de pruebas completo**, no solo
las nuevas de esta ronda, para confirmar que nada de lo ya entregado se
rompió:

- **Nuevas de esta ronda, contra la LÓGICA REAL** (no una reimplementación
  aparte, no solo conversiones de horas a guardias):
  - `tests/node/05_asignacion_rapida_flujo.js` — **43 verificaciones**,
    importando y ejecutando directamente `lib/asignacionRapidaFlujo.js`
    (el mismo módulo que ahora usa `pages/admin.js`), con los 6 escenarios
    reproducidos y varias regresiones, con datos 100% ficticios.
  - `tests/pg/08_correcciones_ronda_bugs.sql` — **23 verificaciones**,
    contra PostgreSQL 16 real, de las funciones SQL nuevas de
    `0005_correcciones_ronda_bugs.sql` (guardado transaccional, WhatsApp,
    RLS/EXECUTE).
- **Preexistentes, re-corridas desde cero contra la base nueva (con 0005
  aplicada) para confirmar que nada se rompió**: 30 (`02_pruebas_basicas.sql`)
  + 14 (`03_concurrencia.js`) + 22 (`04_rls.sql`) + 12
  (`05_reglas_individuales_y_avisos.sql`) + 5
  (`06_resumen_horas_cruzadas.sql`) + 7 (`07_admin_multidestino.js`) SQL/Node,
  más 14 + 22 + 19 + 8 (`01`–`04` de `tests/node/`) JavaScript puro.
  **Total: 242 verificaciones automáticas, todas ejecutadas de nuevo en
  esta entrega y confirmadas pasando** (no es un resultado heredado).
- `next build` (producción, con variables de entorno ficticias solo para
  poder compilar) se corrió después de cada tanda de cambios sobre
  `pages/admin.js` y los 4 endpoints tocados, y compiló sin errores en
  todos los casos. **Esto no es una prueba de que la pantalla o el endpoint
  funcionen** — solo de que no hay errores de sintaxis/tipos/JSX.
- **No se pudo ejecutar, en ningún punto de este informe**: ninguna llamada
  HTTP real a `/api/...` contra un servidor corriendo, ninguna apertura
  real de `pages/admin.js` en un navegador, ninguna escritura real en el
  proyecto Supabase de producción, ninguna interacción real con WhatsApp
  (el mecanismo de envío sigue siendo el mismo enlace `wa.me` de siempre).
  Se marca explícitamente como "pendiente" en cada punto donde corresponde.

## 1) Los 6 errores del algoritmo de asignación (`lib/asignacionRapidaFlujo.js`)

Se extrajo `procesarRapida` de `pages/admin.js` a un módulo puro +
orquestación (`lib/asignacionRapidaFlujo.js`), siguiendo el mismo patrón ya
usado y aprobado en este proyecto para `lib/generarTurnosFlujo.js` y
`lib/objetivosEfectivos.js` — así se pudo probar la lógica real con un test
de Node, no una reimplementación aparte que pudiera divergir de lo que
corre `pages/admin.js`. El orden de fases (puesto fijo → 24hs → parejas →
general) y el criterio de reparto dentro de cada fase **no se tocaron**;
solo se corrigió lo necesario para cada error puntual.

| # | Error reproducido | Corrección | Prueba ejecutada y resultado |
|---|---|---|---|
| 1 | Puesto fijo con objetivo 3 y disponibilidad de 5 días asignaba 5 | La fase de puesto fijo ahora descuenta las guardias YA existentes este mes y se detiene al alcanzar el objetivo | `05_asignacion_rapida_flujo.js`: con 0 previas asigna exactamente 3 (no 5); con 2 previas asigna solo 1 más — **PASÓ** |
| 2 | Puesto fijo con objetivo solo nocturno asignaba de día; turno día/noche/ambos no se respetaba en 24hs ni parejas | Las 3 fases (puesto fijo, 24hs, parejas) ahora respetan el turno configurado; una configuración incompatible (puesto fijo de turno fijo que choca con el objetivo, 24hs con objetivo de un solo turno, pareja sin turno en común) se informa en `incompatibilidades` y no se asigna nada de esa fase, nunca se ignora en silencio | `05_asignacion_rapida_flujo.js`, 7 casos (puesto fijo sin turno fijo + objetivo nocturno asigna solo de noche; puesto fijo con turno fijo incompatible se informa y no asigna; 24hs + objetivo de un turno se informa, 24hs no asigna y el resto se completa en turnos sueltos respetando el turno; pareja con objetivos de turno incompatibles se informa y no se asignan juntos) — **PASARON** |
| 3 | 24hs con objetivo 4 y 4 ya asignados agregaba otros 4 | La meta de días de 24hs ahora descuenta lo YA asignado (mismo criterio que ya usaban bien las parejas) | `05_asignacion_rapida_flujo.js`: con 4 de 4 ya cubiertos, agrega 0 — **PASÓ** |
| 4 | Rondín Externo nocturno en HIGA no se detectaba como cruce al asignar en UPA | Se agregó "Rondin Externo" a la lista de sectores de HIGA usada en el chequeo cruzado (faltaba SOLO en esa lista local de `procesarRapida`; el resto del proyecto ya la tenía) — se mantiene, como ya era correcto, que no forma parte de los sectores de UPA | `05_asignacion_rapida_flujo.js`: una guardia nocturna de Rondín Externo en HIGA bloquea una guardia superpuesta de noche en UPA el mismo día; se confirma además que "Rondin Externo" sigue sin ser sector de UPA — **PASARON** |
| 5 | Puesto fijo funcionaba como preferencia y el resto se completaba en otro sector | La fase general ya NO completa a un efectivo con puesto fijo configurado (salvo 24hs); si no alcanza, queda PENDIENTE e informado en el reporte | `05_asignacion_rapida_flujo.js`: con disponibilidad limitada a 2 de 5 días en el puesto fijo, cubre 2 y deja 3 pendientes informados, sin asignar nada en ningún otro sector — **PASÓ** |
| 6 | Un error leyendo disponibilidad/guardias/reglas/otros destinos se trataba como lista vacía y seguía escribiendo | La nueva orquestación (`ejecutarAsignacionRapida`) valida HTTP/red/JSON/forma de cada lectura y se detiene ANTES de calcular o escribir si cualquiera falla | `05_asignacion_rapida_flujo.js`: 4 casos (disponibilidad, reglas de puesto, reglas de objetivo, turnos de otros destinos — este último ni siquiera tenía manejo de error antes) fallando cada uno por separado, confirmando que nunca se llega a guardar; más el camino feliz completo — **PASARON** |

**Pendiente, no ejecutable en este entorno:** correr la pantalla real de
"Asignación rápida" en `pages/admin.js` contra un servidor Next.js vivo y
un proyecto Supabase real, con los 6 escenarios cargados a mano y
observando el resultado en la UI (incluidos los nuevos mensajes de
incompatibilidad, que ahora también se muestran en los dos botones
"Asignar" — ver `mensajeIncompatibilidades` en `pages/admin.js`).

## 2) WhatsApp (terminar de corregir el seguimiento ya incorporado)

Todo lo de WhatsApp vive en `supabase/migrations/0005_correcciones_ronda_bugs.sql`
(funciones SQL nuevas/corregidas) + `pages/api/whatsapp-avisos.js` y
`pages/api/publicar-guardias.js` (ahora llaman a esas funciones por
`supabase.rpc(...)`) + `pages/admin.js` (UI).

| Pedido | Corrección | Prueba ejecutada y resultado |
|---|---|---|
| Confirmar debe referirse al contenido publicado preparado para comunicar | `fn_whatsapp_marcar_abierto` fotografía el fingerprint vigente al abrir (`fingerprint_en_apertura`); `fn_whatsapp_confirmar_envio` exige que coincida con el fingerprint actual | `08_correcciones_ronda_bugs.sql`: abrir fotografía correctamente; confirmar sin haber abierto se rechaza — **PASÓ** |
| No permitir confirmar un mensaje viejo si las guardias cambiaron después de abrirlo | Mismo mecanismo: si se publica de nuevo con cambios para ese efectivo, el fingerprint vigente cambia y la apertura vieja queda obsoleta — confirmar se rechaza con un error explícito (`contenido_cambio_desde_apertura`), mapeado en `pages/api/whatsapp-avisos.js` a un mensaje legible | `08_correcciones_ronda_bugs.sql`: se abre, se publica un cambio real para ese efectivo, confirmar el mensaje viejo se rechaza; reabriendo con el contenido vigente, confirmar se acepta — **PASÓ** |
| Coordinar publicación y sincronización para que un fallo no deje confirmado un cronograma desactualizado | Una sola función nueva (`fn_publicar_guardias_y_sincronizar_whatsapp`) hace las dos cosas en la MISMA transacción — si la sincronización falla, la publicación también se revierte. Ya no existe el "aviso_whatsapp_sync_warning" (advertencia aparte de la ronda anterior) | `08_correcciones_ronda_bugs.sql`: se fuerza un fallo real en el paso de sincronización (quitando temporalmente la tabla de historial dentro de la misma prueba, restaurada antes de cualquier aserción) y se confirma que NINGUNA publicación nueva queda creada y el aviso no cambió; más el camino feliz — **PASARON** |
| Repetir la sincronización de una misma publicación no debe borrar una confirmación válida | `fn_whatsapp_sincronizar_tras_publicar` ahora compara contra el fingerprint YA GUARDADO en `whatsapp_avisos` (no contra la publicación anterior) — llamarla varias veces para la misma publicación vigente es un no-op a partir de la segunda vez | `08_correcciones_ronda_bugs.sql`: se confirma un aviso y se llama 3 veces más a la sincronización para la MISMA publicación vigente — la confirmación sigue intacta y no se genera historial de más — **PASÓ** |
| Permitir comunicar que se retiraron todas las guardias de un efectivo | El universo de legajos a sincronizar ahora es "los de la publicación nueva" UNIÓN "los que ya tenían una fila de aviso" (no solo los de la publicación inmediata anterior) — un efectivo que queda en 0 guardias sigue siendo detectado y vuelve a pendiente. En la UI, la tarjeta de WhatsApp ya no se oculta cuando el efectivo tiene 0 guardias publicadas (antes se condicionaba a `turnosPublicadosPorLegajo[...].length > 0`; ahora a que exista una fila de seguimiento), y el mensaje de WhatsApp dice explícitamente "no tiene guardias asignadas" en ese caso | `08_correcciones_ronda_bugs.sql`: un efectivo con una guardia confirmada que luego pierde esa única guardia (nueva publicación con 0 para él) vuelve a pendiente y queda archivada su confirmación anterior — **PASÓ**. La gating de la UI (`pages/admin.js`) y el texto del mensaje se verificaron por revisión de código + `next build`, no ejecutándose en un navegador real (pendiente, ver sección 0) |
| Mantener estados independientes por efectivo, destino, mes y año | Sin cambios de diseño (ya lo era desde la ronda anterior: `unique(legajo, lugar, mes, anio)`) — se re-confirma con las pruebas de arriba, que nunca mezclan el estado de un efectivo con el de otro | `05_reglas_individuales_y_avisos.sql` (ronda anterior) + `08_correcciones_ronda_bugs.sql` (esta ronda) — **PASÓ** |
| Conservar la distinción entre abrir y confirmar | Sin cambios de diseño — se re-confirma: abrir nunca marca confirmado | `08_correcciones_ronda_bugs.sql` — **PASÓ** |

Además, en `pages/admin.js`: `abrirAviso` ahora informa un error si la
escritura falla (antes lo silenciaba con un `catch (e) {}` vacío) y
**siempre** vuelve a leer el estado del servidor al terminar (antes se
quedaba con el estado optimista local, que podía quedar desincronizado si
la escritura fallaba); `confirmarAviso` también refresca el estado cuando
el servidor rechaza la confirmación (antes solo mostraba el error y dejaba
la pantalla con el estado viejo).

**Pendiente, no ejecutable en este entorno:** el recorrido HTTP/navegador
completo (abrir el link real de WhatsApp, confirmar desde la pantalla,
ver el banner de "cambió desde que se abrió") contra un servidor y un
proyecto Supabase reales.

## 3) Guardado transaccional de puesto fijo y objetivo

| Pedido | Corrección | Prueba ejecutada y resultado |
|---|---|---|
| Guardar los cambios de puestos y objetivos mediante transacciones; si falla la nueva regla, debe seguir activa la anterior; nunca dejar al efectivo sin configuración | `pages/api/admin-reglas-puesto.js` y `admin-reglas-objetivo.js` ya no hacen 2–4 llamadas sueltas a Supabase desde JavaScript — cada guardado es ahora UNA función SQL atómica (`fn_guardar_puesto_fijo`, `fn_guardar_objetivo`, `fn_desactivar_objetivo`) | `08_correcciones_ronda_bugs.sql`: caso feliz de las 3 funciones; y, forzando un fallo real en el último paso de inserción de cada una (una violación real de columna/constraint, mismo criterio que ya usa `02_pruebas_basicas.sql` para `fn_guardar_disponibilidad_admin`), se confirma que la regla/objetivo anterior sigue activo, exactamente la misma fila, y que el historial no queda con un registro de un cambio que nunca se completó — **PASARON** (4 pruebas) |

**Pendiente, no ejecutable en este entorno:** la llamada HTTP real a estos
dos endpoints contra un servidor y Supabase reales.

## 4) "Proteger las tablas y funciones nuevas de 0004"

0004 nunca activó RLS en sus 5 tablas nuevas (`efectivo_puesto_fijo`,
`efectivo_objetivo`, `efectivo_objetivo_historial`, `whatsapp_avisos`,
`whatsapp_avisos_historial`) ni revocó `EXECUTE` de sus funciones — quedaban
legibles/escribibles con la clave `anon` pública sin pasar por ningún
endpoint. `0005_correcciones_ronda_bugs.sql` les aplica exactamente el
mismo tratamiento que `0002_rls_propuesta.sql` le dio a las tablas de 0001
(RLS + política restrictiva que bloquea a `anon` sin excepción, `EXECUTE`
revocado de `public`/`anon`/`authenticated` y otorgado solo a
`service_role`), conservando el acceso de los endpoints autorizados (todos
usan `SUPABASE_SERVICE_ROLE_KEY`, que ignora RLS).

Nota honesta sobre un error propio, encontrado y corregido durante esta
misma ronda: la primera versión de `0005` hacía `create policy ... to
anon` sin ninguna protección — eso rompe la sentencia ENTERA con "role
anon does not exist" en cualquier base que no tenga ya creado ese rol
(como la base sandbox de estas pruebas, sin Supabase real detrás). Se
corrigió envolviendo esas 5 sentencias en el mismo criterio defensivo que
ya usaba el bloque de `EXECUTE` del propio archivo (`if exists (select 1
from pg_roles where rolname = 'anon')`) — contra el proyecto Supabase real,
donde `anon` siempre existe, el comportamiento es exactamente el mismo de
antes.

**Prueba ejecutada y resultado:** `08_correcciones_ronda_bugs.sql` crea
roles que imitan `anon` (sin `BYPASSRLS`) y `service_role` (con
`BYPASSRLS`), igual que `04_rls.sql` ya hacía para las tablas de 0001, y
confirma: `anon` lee 0 filas de las 5 tablas aunque haya datos cargados;
un `insert` directo se rechaza; invocar `fn_guardar_puesto_fijo` o
`fn_whatsapp_confirmar_envio` por RPC directo como `anon` se rechaza con
`EXECUTE` revocado (sqlstate `42501`); `service_role` sigue funcionando con
total normalidad — **PASARON** (7 pruebas).

**Pendiente, no ejecutable en este entorno:** confirmar lo mismo contra el
proyecto Supabase real (donde los roles `anon`/`service_role` ya existen
de fábrica, a diferencia de la base sandbox usada acá).

## 5) Qué se conservó sin tocar (verificado, no solo asumido)

Se re-corrió el conjunto de pruebas COMPLETO de rondas anteriores (242
verificaciones en total, contadas en la sección 0) contra una base
recreada desde cero con las migraciones 0001 + 0004 + **0005** ya
aplicadas, para confirmar que nada de lo entregado antes se rompió con
estos cambios:

- Guardado de disponibilidad, publicación, concurrencia optimista y real,
  `fn_admin_guardar_efectivo`, RLS de 0001/0002 (`02`, `03`, `04`): sin
  cambios, **siguen pasando**.
- Sexo, puesto fijo / objetivo (alta, índice único, historial) y el
  escenario completo de `fn_whatsapp_sincronizar_tras_publicar` de la
  ronda anterior (`05`): **sigue pasando exactamente igual** — la versión
  corregida de esa función (0005) conserva el comportamiento que esa
  prueba ya verificaba (reset solo de quien cambió, el otro conserva su
  confirmación) y además corrige la idempotencia y el caso de 0 guardias.
- Sumatoria de horas cruzada entre destinos (`06`): sin cambios, **sigue
  pasando**.
- Ingreso de administrador multi-destino (`07`): sin cambios, **sigue
  pasando**.
- Los módulos puros `lib/tiempoArgentina.js`, `lib/generarTurnosFlujo.js`,
  `lib/objetivosEfectivos.js` (`tests/node/01`–`03`) y la técnica de
  planilla con ExcelJS (`tests/node/04`): sin cambios, **siguen pasando**.
- `fn_publicar_guardias` (migración 0001) **no se modificó** — se la deja
  intacta y se la envuelve desde una función nueva
  (`fn_publicar_guardias_y_sincronizar_whatsapp`), tal como pedía el
  alcance de esta ronda.
- El algoritmo de asignación mantiene el mismo orden de fases y el mismo
  criterio de reparto dentro de cada fase — ningún caso ya cubierto por
  pruebas anteriores de disponibilidad/objetivos cambió de resultado.

## 6) Archivos tocados en esta ronda

- **Nuevo:** `supabase/migrations/0005_correcciones_ronda_bugs.sql`
  (aditiva — no modifica 0001/0002/0003; usa `create or replace function`
  solo para las funciones de 0004 cuyo comportamiento cambia, que quedan
  intactas en el historial de 0004).
- **Nuevo:** `lib/asignacionRapidaFlujo.js` (algoritmo de "Asignación
  rápida" extraído de `pages/admin.js`, con los 6 errores corregidos).
- **Nuevo:** `tests/node/05_asignacion_rapida_flujo.js` (43 pruebas).
- **Nuevo:** `tests/pg/08_correcciones_ronda_bugs.sql` (23 pruebas).
- **Modificado:** `pages/admin.js` — `procesarRapida` es ahora un wrapper
  fino sobre `lib/asignacionRapidaFlujo.js`; `asignarUnoRapida`/
  `asignarTodosRapida` manejan el nuevo caso de error y muestran las
  incompatibilidades detectadas; `abrirAviso`/`confirmarAviso` refrescan el
  estado también ante error; la tarjeta de WhatsApp de la vista Personal ya
  no se oculta con 0 guardias publicadas, y el mensaje de WhatsApp cubre
  ese caso.
- **Modificado:** `pages/api/admin-reglas-puesto.js`,
  `pages/api/admin-reglas-objetivo.js` — llaman a las nuevas funciones
  atómicas por `supabase.rpc(...)` en vez de los pasos sueltos de antes.
- **Modificado:** `pages/api/whatsapp-avisos.js` — `abrir`/`confirmar`/
  `desmarcar` llaman a las nuevas funciones atómicas; se mapean los nuevos
  errores (`no_existe_aviso`, `contenido_cambio_desde_apertura`) a mensajes
  legibles; el `GET` expone también el fingerprint actual y el de apertura.
- **Modificado:** `pages/api/publicar-guardias.js` — llama a
  `fn_publicar_guardias_y_sincronizar_whatsapp` en una sola transacción, en
  vez de las dos llamadas separadas de antes (se elimina el
  `aviso_whatsapp_sync_warning`, que ya no tiene sentido: un fallo ahí es
  ahora, directamente, un fallo de publicación).
- **Modificado:** `tests/README.md` — documenta 0005 y los dos archivos de
  prueba nuevos.

No se tocó: `fn_admin_guardar_efectivo`, `fn_publicar_guardias` (se la
envuelve, nunca se edita), ninguna migración 0001–0004, ni ninguna pantalla
o funcionalidad fuera de lo descripto arriba.
