# POLAD — Informe de esta ronda: los diez pedidos funcionales (entrega única)

Fecha: 2026-10-19. Continúa sobre la base de `RESUMEN_CORRECCION.md` (ronda
anterior: corrección de `generarTurnos()`, coherencia de legajo al editar un
efectivo, estructura de despliegue) y sobre el historial de git existente
(427+ commits, conservado íntegro — ver `patches/polad-higa-upa-historial.bundle`
dentro de este ZIP y la sección 5 de este informe). No se tocó Supabase
real, no hubo `git push` ni deploy, no se modificó ni bloqueó la edición de
legajos, y no se agregó ninguna funcionalidad fuera de los diez puntos
pedidos. Las fotos, panorámicas y notas educativas quedaron expresamente
postergadas, como se pidió.

Este informe distingue siempre, para cada punto: **prueba ejecutada** (SQL
real contra PostgreSQL 16, JavaScript real, o HTTP/navegador), **revisión de
código** (sin ejecución, incluyendo `next build`), y **pendiente** (con el
motivo concreto). Ninguna compilación ni revisión de código se presenta como
prueba funcional de un endpoint o de una pantalla.

## 0) Por qué HTTP y navegador quedan en "pendiente" para todo este informe

Este entorno de trabajo es un contenedor aislado, sin acceso a internet
hacia ningún proyecto Supabase real, sin un servidor Next.js corriendo, y
sin navegador. Por eso:

- **Sí se ejecutaron realmente** (no simuladas, no inventadas): 90 pruebas
  SQL/concurrencia contra un PostgreSQL 16 real y local (`polad_test`, datos
  100% ficticios), y 63 pruebas de JavaScript real (contra los módulos
  puros reales que usa `pages/admin.js`, o contra ExcelJS real). Total: **153
  verificaciones automáticas, todas ejecutadas de nuevo y confirmadas
  pasando en esta misma entrega** (no son un resultado heredado de una
  corrida anterior — ver el detalle de cada corrida en la sección 3).
- **No se pudo ejecutar, en ningún punto de este informe**: ninguna llamada
  HTTP real a `/api/...` contra un servidor corriendo, ninguna apertura real
  de `admin.js`/`ControlApp.js`/`EfectivoApp.js` en un navegador, ninguna
  escritura real en el proyecto Supabase de producción. Donde esto importa,
  se dice explícitamente "pendiente — no ejecutable en este entorno", nunca
  se afirma que algo "funciona" solo porque compiló o porque el código se
  revisó línea por línea.
- `next build` (producción, con variables de entorno ficticias solo para
  poder compilar) se corrió varias veces sobre el árbol final y compiló sin
  errores — confirma que no hay errores de sintaxis/JSX en ningún archivo
  tocado esta ronda (incluido `pages/admin.js`, con más de 2000 líneas
  modificadas), pero **esto no es una prueba de que la pantalla funcione**,
  solo de que compila.

## 1) Estado de los diez puntos

| # | Pedido | Implementado | Probado | Pendiente |
|---|---|---|---|---|
| 1 | Identificación por sexo | Sí | SQL (3/3) | HTTP/navegador |
| 2 | Puestos específicos por efectivo | Sí | SQL (3/3) | HTTP/navegador |
| 3 | Objetivos individuales configurables | Sí | SQL (3/3) + JS (19/19) | HTTP/navegador |
| 4 | Asignación rápida sin borrar lo existente | Sí (sobre `procesarRapida` ya no-destructiva) | Revisión de código + pruebas SQL preexistentes de la función de inserción | Prueba de extremo a extremo (correr dos veces) — requiere servidor |
| 5 | Planilla para imprimir (SIN CUBRIR / tramado) | Sí | JS real con ExcelJS (8/8) | Generación contra datos reales de Supabase + revisión visual al imprimir |
| 6 | Sumatoria de horas | Sí | SQL (5/5) | Generación contra datos reales de Supabase |
| 7 | Disponibilidad fuera de término | Ya estaba correcto (ronda anterior) | SQL preexistente (parte de 30/30) | HTTP/navegador |
| 8 | Borrador y publicación (+ watermark) | Ya estaba correcto + watermark nuevo | SQL preexistente (parte de 30/30) + revisión de código del watermark | HTTP/navegador |
| 9 | WhatsApp por destino (seguimiento) | Sí | SQL (12/12, incluido el escenario completo de reset independiente) | HTTP/navegador (abrir/confirmar desde la pantalla real) |
| 10 | Funcionamiento de los tres destinos (incluye admin multi-destino) | Sí (unificación de `NEXT_PUBLIC_LUGAR` + corrección de login multi-destino) | SQL/Node (7/7) + revisión de `buscarCruceOtroLugar` | HTTP/navegador (login real desde los 3 dominios) |

Ningún punto quedó "no implementado". Lo que queda pendiente en todos los
casos es el mismo nivel: ejecución HTTP/navegador real, imposible en este
entorno (sección 0).

---

## 2) Detalle punto por punto

### Punto 1 — Identificación por sexo

**Pedido:** registrar y visualizar femenino/masculino/sin informar, con
filtro. No inferir por nombre, no usar para restringir asignación.

**Implementado:**
- `supabase/migrations/0004_reglas_individuales_y_avisos.sql`: columna
  `efectivos.sexo` (default `sin_informar`, constraint que solo permite los
  3 valores). Aditiva — no toca ninguna columna ni función existente.
- `pages/api/admin-efectivos.js`: el alta nueva guarda `sexo` (validado,
  default `sin_informar` si no se manda); acción nueva `set_sexo` (update
  directo, deliberadamente SEPARADA de `fn_admin_guardar_efectivo`, que
  queda intacta — el pedido excluye explícitamente tocar la edición de
  legajos).
- `pages/admin.js` (`ModalPersonal`, `handleGuardarPersonal`, vista
  Personal): selector de sexo en la ficha, filtro por sexo en la lista,
  badge `· F` / `· M` en cada ficha (sin badge cuando es `sin_informar`, para
  no obligar a decidir).
- **Nunca se lee `sexo` en `calcularAsignaciones` ni en `procesarRapida`** —
  confirmado por revisión de código (ninguna referencia a `sexo` fuera de
  `ModalPersonal` y la vista Personal): no hay ninguna restricción de
  asignación por sexo, ni pedida ni agregada.

**Probado — SQL real (PostgreSQL 16):** `tests/pg/05_reglas_individuales_y_avisos.sql`,
3 pruebas: default `sin_informar`, constraint rechaza valores fuera de los 3
permitidos, valor explícito se guarda tal cual.

**Pendiente:** cargar/filtrar sexo desde la pantalla real de Personal en un
navegador — no ejecutable en este entorno.

---

### Punto 2 — Puestos específicos por efectivo

**Pedido:** configurar desde administración que un efectivo se asigne a un
puesto específico, reglas editables (no excepciones fijas por nombre en
código), seleccionando desde el registro existente, respetando
disponibilidad/cupos/restricciones, informando si no se puede cumplir.

**Implementado:**
- `efectivo_puesto_fijo` (migración 0004): `legajo`, `lugar`, `sector`,
  `turno` (nullable = cualquier turno), `activo`, con índice único parcial
  `idx_puesto_fijo_activo_unico on (legajo, lugar) where activo` — como
  mucho una regla activa por efectivo+lugar. Cambiar el puesto desactiva la
  anterior y crea una nueva (la anterior queda en la tabla, `activo=false`,
  nunca se borra — historial implícito).
- `pages/api/admin-reglas-puesto.js` (nuevo): `GET` lista las reglas activas
  del lugar de la sesión; `POST action=guardar` valida que el sector exista
  para ese lugar y que el legajo exista como efectivo de ese lugar (se
  selecciona del registro real, nunca un nombre libre); `POST
  action=desactivar`.
- `pages/admin.js` — **Fase 0** de `procesarRapida` (antes de la Fase 1
  24hs/pareja y de la Fase 2 general): a cada efectivo con puesto fijo
  configurado (y que no esté marcado para 24hs) se le intenta asignar
  primero su sector/turno específico, respetando exactamente las mismas
  reglas que el resto del algoritmo (disponibilidad cargada,
  `cumpleDescanso` — 12hs de descanso y cruce real de horario con los otros
  2 destinos —, cupo máximo del slot, tope de 180hs). Se acumula en
  `puestoFijoReporte` cuánto se pudo cubrir contra el objetivo, y
  `mensajePuestoFijo()` se lo muestra al administrador tanto en "Asignar
  uno" como en "Asignar todos" cuando no se pudo completar.
- `ModalPersonal`: panel propio "📍 Puesto fijo" (seleccionar sector/turno,
  guardar, quitar), con su propio `fetch` al nuevo endpoint — explícitamente
  NO pasa por `fn_admin_guardar_efectivo`.

**Decisión documentada (ambigüedad menor, conservando el comportamiento
actual por defecto, según lo pedido):** si el puesto fijo no alcanza para
cubrir el objetivo completo de ese efectivo (por cupo ya ocupado o
disponibilidad), el resto del objetivo se intenta cubrir en la Fase 2
general (cualquier sector), en vez de quedar permanentemente sin cubrir —
documentado en el comentario de la Fase 0 en `pages/admin.js`. Los
efectivos marcados para 24hs quedan excluidos de la Fase 0 (combinar ambos
mecanismos no fue pedido).

**Probado — SQL real:** 3 pruebas en `05_reglas_individuales_y_avisos.sql`:
alta feliz, el índice único activo impide dos reglas activas simultáneas
para el mismo efectivo+lugar, y cambiar el puesto deja exactamente una
activa con la anterior preservada como historial.

**Pendiente:** correr "Asignación rápida" de verdad contra un servidor con
datos reales y confirmar visualmente que el puesto fijo se respeta — no
ejecutable en este entorno (ver también Punto 4).

---

### Punto 3 — Objetivos individuales configurables

**Pedido:** objetivos mensuales por efectivo y destino, en horas o cantidad
de guardias, con día/noche/ambos; casos Solís/Leiva (180hs exclusivo HIGA) y
Coronel (3 HIGA + 3 UPA, editable por separado); no mostrar como asignado
hasta que haya asignaciones reales; si no se alcanza, mostrar
asignado/pendiente/motivo sin forzar cruces ni inventar disponibilidad.

**Implementado:**
- `efectivo_objetivo` (migración 0004): `legajo`, `lugar`, `tipo`
  (`horas`/`guardias`), `cantidad`, `turno_objetivo`
  (`dia`/`noche`/`ambos`, default `ambos`), `activo` + índice único parcial
  (una regla activa por efectivo+lugar) + `efectivo_objetivo_historial`
  (nunca se sobrescribe: cada alta/edición/baja queda registrada).
- `pages/api/admin-reglas-objetivo.js` (nuevo): mismo patrón que el de
  puesto fijo, pero además escribe en el historial ANTES de desactivar la
  regla anterior.
- `lib/objetivosEfectivos.js` (nuevo, módulo puro sin React/red, igual
  filosofía que `lib/generarTurnosFlujo.js`): `objetivoEnGuardias` (horas →
  guardias, redondeando siempre hacia abajo, usando las horas/turno reales
  del lugar — 12hs HIGA/UPA, 8hs MODULAR); `resolverObjetivoGuardias` (el
  configurado SIEMPRE reemplaza al derivado del mes anterior, incluso si el
  derivado es 0 — el caso de un efectivo nuevo como Solís/Leiva);
  `turnosPermitidosPorObjetivo` (filtra día/noche/ambos, con la salvedad de
  que en MODULAR "día" agrupa mañana+tarde); `resumenObjetivo`
  (asignadas/meta/pendiente/cumplido/motivo — nunca "cumplido" si no lo
  está, nunca inventa un motivo cuando sí se cumplió).
- `pages/admin.js`: `cargarRapida()` y `procesarRapida()` usan
  `resolverObjetivoGuardias`/`turnosPermitidosPorObjetivo` en vez del
  conteo crudo del mes anterior — el objetivo mostrado y usado para
  calcular cuánto falta es SIEMPRE el real (asignadas contadas de verdad en
  el borrador), nunca "el objetivo = asignado" de entrada. El reporte de
  cada efectivo incluye `detalle: resumenObjetivo(...)` con
  asignadas/pendiente/motivo.

**Probado:**
- **SQL real:** 3 pruebas en `05_reglas_individuales_y_avisos.sql` — alta
  (180hs/ambos, caso Solís), índice único activo, y el caso Coronel 3→2
  (editar conserva el historial completo).
- **JavaScript real (el mismo módulo que usa `pages/admin.js`):**
  `tests/node/03_objetivos_efectivos.js`, 19/19 — incluye explícitamente
  180hs en HIGA (12hs/turno) = 15 guardias, 180hs en MODULAR (8hs/turno) =
  22 guardias (redondeando hacia abajo, nunca de más), el caso del objetivo
  derivado en 0 (efectivo nuevo) reemplazado igual por el configurado, y
  "cumplido"/"pendiente"/"motivo" nunca contradictorios entre sí.

**Pendiente:** configurar un objetivo desde la ficha real y ver el
resumen reflejado en la pantalla — no ejecutable en este entorno.

---

### Punto 4 — Asignación rápida sin borrar lo existente

**Pedido:** conservar guardias previamente asignadas (manuales y de reglas
individuales); completar solo huecos, descontando lo asignado de los
objetivos; ejecutarla de nuevo no debe duplicar ni borrar/reemplazar
existentes; conservar los controles de superposición HIGA/UPA/MODULAR y
demás restricciones.

**Implementado:** sobre el mecanismo YA EXISTENTE y no-destructivo
`procesarRapida` (distinto del algoritmo `calcularAsignaciones`/
`generarTurnos`, que SÍ reemplaza por scope y que esta ronda no tocó —
confirmado por revisión de código que son dos caminos separados en
`pages/admin.js`). Por construcción, `procesarRapida`:
- Lee `turnosMes` (lo ya asignado, de cualquier origen: manual o de la
  nueva Fase 0 de puesto fijo) ANTES de calcular nada, y construye
  `ocupacion`/`turnosPorLegajo` a partir de eso.
- `cumpleDescanso()` rechaza un día que el efectivo YA tiene asignado en
  ese lugar (`prev.some(a => a.dia === dia)`), además de respetar el
  descanso de 12hs y el cruce real de horario con los otros dos destinos.
- El objetivo de cada efectivo (Punto 3) se compara contra lo YA asignado
  (`meta = objetivo - yaAsignadas`), así que una segunda corrida con el
  objetivo ya cumplido simplemente no encuentra nada que agregar para ese
  efectivo — nunca duplica.
- Solo inserta (`fn_turnos_borrador_insertar`, aditivo) las filas realmente
  nuevas que calculó; nunca borra ni reemplaza filas existentes (a
  diferencia de `reemplazar_scope`, que esta función no usa).
- Los controles de superposición (`conflictoOtroLugar`, que compara
  franjas horarias reales entre los 3 lugares) y el tope de 180hs se
  siguen aplicando exactamente igual, ahora también dentro de la nueva Fase
  0 de puesto fijo (no es un camino aparte sin controles).

**Probado:**
- **Revisión de código línea por línea** (no ejecución) del mecanismo
  descrito arriba, confirmando la garantía de no-duplicación/no-borrado por
  construcción.
- **SQL real preexistente**, indirectamente: `fn_turnos_borrador_insertar`
  (la función que `procesarRapida` llama para guardar) está probada en
  `tests/pg/02_pruebas_basicas.sql` (inserción en lote bajo el lock
  compartido con la publicación, rechazo de sector inválido) — confirma que
  la escritura en sí es segura y aditiva, pero esa prueba SQL no ejercita
  la decisión de "qué insertar" (eso vive en JavaScript, en `pages/admin.js`,
  no extraído a un módulo puro como `lib/objetivosEfectivos.js` o
  `lib/generarTurnosFlujo.js`).

**Pendiente — el más honesto de todo este informe:** no hay, en esta
entrega, una prueba automática que ejecute `procesarRapida()` dos veces
seguidas contra un escenario real y compare el resultado byte a byte. Para
eso haría falta un servidor Next.js corriendo (la función hace `fetch` a 4
endpoints propios) o extraer toda su lógica a un módulo puro como se hizo
con `generarTurnosFlujo.js` — no se hizo en esta ronda para no tocar más
superficie de `pages/admin.js` de la estrictamente necesaria para los
puntos pedidos. La garantía de no-duplicación queda respaldada por revisión
de código y por las pruebas SQL de la función de inserción que usa, pero
**no por una ejecución de extremo a extremo**. Se recomienda, como parte de
la verificación integral pedida, correr manualmente "Asignar todos" dos
veces seguidas contra el mismo mes/año en un entorno con servidor real y
confirmar que la cantidad de turnos no cambia en la segunda corrida (ver
sección 4, checklist).

---

### Punto 5 — Planilla para imprimir

**Pedido:** distinguir puesto que debe cubrirse pero está vacío (celda
negra, texto blanco "SIN CUBRIR") de puesto que no corresponde cubrir
(celda con tramado); en HIGA: Rondín Externo turno día no corresponde,
Salud Mental noche solo 1 efectivo, Llaves noche solo 1 efectivo; mantener
los demás cupos; verificar formato al descargar/imprimir.

**Implementado:** `pages/api/generar-planilla.js` —
`CUPO_POR_SECTOR_TURNO = { 'Salud Mental': {d:2,n:1}, 'Llaves': {d:2,n:1},
'Rondin Externo': {d:0,n:2} }` (cualquier otro sector/turno sigue en cupo 2,
sin cambios). Para cada slot: si `ei >= cupo` (supera el cupo real) →
`fillTramado()` (pattern `darkTrellis`) + "NO CORRESPONDE" (solo en el
primer slot que exceda, para no repetir el texto); si el slot está dentro
del cupo y vacío → fill negro sólido + texto blanco "SIN CUBRIR"; mismo
tratamiento aplicado también en UPA y MODULAR (antes solo tenían un fill
rojo sin texto).

**Probado — JavaScript real con ExcelJS (sin red, sin base de datos):**
`tests/node/04_planilla_sin_cubrir_tramado.js`, 8/8 — copia literal de
`cupoHIGA`/`fillTramado`/`fill` de `generar-planilla.js`, escribe un
`.xlsx` real con los 8 casos (Rondín Externo día ambos slots, Salud
Mental/Llaves noche los 2 slots, un sector de cupo normal los 2 slots),
**lo relee con ExcelJS** y confirma que el pattern, el color y el texto de
cada celda persistieron exactamente como se pidió — no solo que "no tiró
excepción al escribir".

**Pendiente:** generar la planilla completa contra datos reales de
Supabase y confirmar visualmente el resultado al imprimir/exportar — no
ejecutable en este entorno (requiere Supabase real).

---

### Punto 6 — Sumatoria de horas

**Pedido:** horas asignadas por efectivo en cada destino; total del
efectivo sumando HIGA+UPA+MODULAR del mismo mes/año; total de horas por
destino; incluir todos los sectores, calcular según duración real;
diferenciar horas asignadas de realizadas; no contar dos veces una guardia
por existir en borrador y publicación.

**Implementado:** `pages/api/resumen-guardias.js` —
- Corrección de un bug encontrado al revisar este punto: `SECTORES_POR_LUGAR.HIGA`
  no incluía `'Rondin Externo'` (sí estaba en `pages/admin.js` y en
  `generar-planilla.js`) — las guardias de ese sector quedaban totalmente
  afuera de este resumen, subcontando horas. Corregido.
- Columna nueva "Horas (3 destinos)": lee `turnos` (el borrador) del
  mes/año **sin filtrar por lugar/sector** y mapea cada sector a su lugar
  (`SECTOR_A_LUGAR`) y sus horas reales (`HORAS_POR_LUGAR`: 12 HIGA/UPA, 8
  MODULAR) — suma correcta aunque el mismo efectivo tenga guardias en los 3
  destinos.
- Columna nueva "Horas realizadas": de una fuente completamente distinta —
  `turnos_publicados` (de la publicación vigente de ESTE lugar/mes/año) ∩
  `asistencia` con `presente=true` — nunca desde el borrador. Si no hay
  publicación vigente, queda en 0 para todos en vez de inventar un valor.
- Las dos columnas nunca se suman entre sí ni con "Horas" (que sigue siendo
  asignadas de este lugar únicamente): conviven como columnas separadas, así
  que una guardia que existe en ambas fuentes (borrador Y publicado+
  asistida) nunca se cuenta dos veces dentro de una misma columna.
- Watermark "⚠ BORRADOR" agregado (ver también Punto 8): este resumen
  siempre lee el borrador, nunca lo publicado, y ahora lo dice
  explícitamente en la planilla generada.

**Probado — SQL real (PostgreSQL 16):** `tests/pg/06_resumen_horas_cruzadas.sql`,
5/5 — replica la aritmética exacta del archivo contra datos reales: un
legajo con guardias en HIGA+UPA+MODULAR el mismo mes/año suma 32hs
(12+12+8), uno con guardias en un solo lugar no se infla; la misma guardia
presente en `turnos` Y en `turnos_publicados`+`asistencia` cuenta una vez en
cada columna, nunca se mezclan ni se duplican; sin publicación vigente, las
horas realizadas quedan en 0.

**Pendiente:** generar el resumen completo contra datos reales de Supabase
— no ejecutable en este entorno.

---

### Punto 7 — Disponibilidad fuera de término

**Pedido:** admin puede cargar/corregir sin reabrir inscripción general;
efectivo sigue sujeto a horario de inscripción; errores no borran
disponibilidad anterior; conservar registro de modificaciones
administrativas.

**Hallazgo de esta ronda:** ya estaba completamente implementado en rondas
anteriores, sin cambios de código necesarios ni hechos esta vez. Verificado
por revisión de código: `pages/api/admin-disponibilidad-override.js` +
`fn_guardar_disponibilidad_admin` permiten al administrador cargar/corregir
en cualquier momento, sin depender de la ventana de inscripción (esa
ventana —`lib/tiempoArgentina.js`, `ahoraEnArgentina`/ventana
abierta/cerrada— solo se aplica al camino del efectivo, confirmado leyendo
`pages/api/guardar-disponibilidad.js`); cada escritura administrativa queda
registrada en `disponibilidad_auditoria` (nunca se sobrescribe); y la
función SQL es atómica (si falla la auditoría, revierte también la
disponibilidad — no queda a medias).

**Probado — SQL real (ya existente, no nuevo esta ronda):** cubierto dentro
de `tests/pg/02_pruebas_basicas.sql` (30/30), en particular "guardado
administrativo atómico" y "si la auditoría falla, se revierte TODO".

**Pendiente:** cargar disponibilidad fuera de término desde la pantalla
real de administración y confirmar que el efectivo sigue sin poder hacerlo
fuera de horario — no ejecutable en este entorno.

---

### Punto 8 — Borrador y publicación

**Pedido:** efectivo ingresa todo el mes sin ver guardias en preparación;
publicación independiente por destino/mes/año; modificar el borrador no
cambia lo visible hasta republicar; control y planillas coherentes con lo
publicado; un borrador impreso para revisión debe identificarse
expresamente como BORRADOR.

**Hallazgo:** igual que el Punto 7, el mecanismo de fondo (tabla `turnos`
= borrador, `publicaciones`/`turnos_publicados` = lo publicado, con
`vigente` e índice único por lugar/mes/año, y el efectivo leyendo siempre
`turnos_publicados` nunca `turnos`) ya estaba correcto de rondas
anteriores. Lo que se agregó esta ronda es el watermark explícito: tanto
`pages/api/resumen-guardias.js` (que siempre lee el borrador, a propósito,
porque es una herramienta de armado, no una planilla definitiva) como
`pages/api/generar-planilla.js`/`planilla-efectivo.js` (que ya leían lo
publicado desde la ronda anterior) ahora identifican con claridad cuál es
cuál — ver el Punto 6 para el detalle del watermark en `resumen-guardias.js`.

**Probado — SQL real (ya existente):** `tests/pg/02_pruebas_basicas.sql`
(publicación feliz, rechazo de `version_base` vieja, "editar/borrar el
borrador después de publicar no toca `turnos_publicados`", asistencia y
planilla manual ya registradas no se alteran al publicar de nuevo).

**Revisión de código (no automatizada):** el watermark en sí (una celda de
texto estático con fill ámbar) se verificó leyendo el código y con `next
build` — no tiene lógica condicional que valga la pena probar con un test
dedicado (es texto fijo), pero tampoco se ejecutó generándolo contra datos
reales.

**Pendiente:** publicar un destino sin publicar los otros dos y confirmar
en pantalla que el efectivo ve solo lo publicado de su destino — no
ejecutable en este entorno (parte del checklist de la sección 4).

---

### Punto 9 — WhatsApp por destino

**Pedido:** conservar el mecanismo actual de abrir/preparar el mensaje,
corrigiendo el seguimiento: estado independiente por efectivo+destino+
mes+año; avisar HIGA no marca UPA/MODULAR; usar solo guardias publicadas
del destino correspondiente; abrir WhatsApp no es enviar (requiere
confirmación expresa); cancelar/fallar no deja confirmado; si cambian las
guardias publicadas de ese efectivo vuelve a pendiente; si cambian solo las
de otra persona, conserva la confirmación; persistir (no depender de un
solo navegador); no convertir registros antiguos ambiguos en envíos
confirmados.

**El mecanismo de WhatsApp en sí (el enlace `wa.me` con el mensaje
precompuesto) NO se tocó** — confirmado por revisión de código: sigue
siendo el mismo `href`/`onClick` que abre WhatsApp, nunca una llamada a una
API de Meta/WhatsApp real (nunca existió tal llamada en este proyecto).

**Implementado — lo que se corrigió es el seguimiento, antes basado solo en
`localStorage` (`notificados`, un `Map` en memoria + `polad_notif_*` en el
navegador, sin persistencia real ni distinción por lugar/mes/año de forma
confiable):**
- `whatsapp_avisos` (migración 0004): `legajo`, `lugar`, `mes`, `anio`,
  `publicacion_id`, `fingerprint_turnos`, `estado`
  (`pendiente`/`confirmado`), con `unique(legajo, lugar, mes, anio)` — un
  estado por efectivo+destino+mes+año, en el servidor, no en el navegador.
- `whatsapp_avisos_historial`: archivo de cada reset (nunca se sobrescribe).
- `fn_whatsapp_sincronizar_tras_publicar(lugar, mes, anio)`: se llama desde
  `pages/api/publicar-guardias.js` después de publicar con éxito (si falla,
  se reporta como advertencia, sin deshacer la publicación ya confirmada).
  Compara, por cada efectivo con turnos en la versión nueva o en la
  anterior, un "fingerprint" (`dia-turno-sector` ordenado, concatenado) de
  sus guardias publicadas: si cambió (o no había publicación anterior) →
  resetea a `pendiente` (archivando el estado `confirmado` anterior en el
  historial); si no cambió → conserva el estado como estaba. Esto resuelve,
  por construcción, "avisar HIGA no afecta a UPA" (la función se llama con
  un solo `lugar`, nunca cruza destinos) y "cambia solo otra persona →
  conserva" (el fingerprint es por legajo, no global).
- `pages/api/whatsapp-avisos.js` (nuevo): `GET` trae el estado de todos los
  efectivos del lugar/mes/año de la sesión; `POST action=abrir` (al abrir el
  enlace, nunca marca confirmado); `POST action=confirmar` (requiere acción
  explícita del administrador); `POST action=desmarcar`. Si no existe fila
  todavía (nunca se publicó ese lugar/mes/año), devuelve un error explícito
  en vez de inventar un estado — nunca convierte "no hay dato" en "enviado".
- `pages/admin.js`: se eliminó el `Map` de `notificados` y las funciones
  basadas en `localStorage`; la tarjeta de WhatsApp de cada efectivo ahora
  usa el estado del servidor (`cargarWhatsappAvisos`), con un banner
  explícito ("Envío confirmado" verde / "WhatsApp abierto — falta
  confirmar" ámbar) y un botón separado "✓ Confirmar que lo envié" — el
  propio enlace `wa.me` solo marca "abierto", nunca "confirmado"; cancelar
  el envío en WhatsApp (o cerrar la pestaña) nunca llega a marcar
  confirmado porque esa marca depende de un clic aparte, explícito, del
  administrador.

**Probado — SQL real (PostgreSQL 16), el escenario completo pedido:**
`tests/pg/05_reglas_individuales_y_avisos.sql`, dentro de las 12 pruebas:
primera publicación → ambos efectivos "pendiente"; se confirman los dos;
se cambian las guardias publicadas de SOLO uno de los dos; se republica
(versión 2); se sincroniza; se confirma que el que NO cambió sigue
"confirmado" (con cero filas nuevas en el historial para él) y el que SÍ
cambió vuelve a "pendiente" (con su confirmación anterior archivada en el
historial, nunca interpretada como vigente).

**Pendiente:** abrir/confirmar un aviso desde la pantalla real y ver el
estado persistir entre navegadores distintos — no ejecutable en este
entorno (no se mandó ningún mensaje real ni se usaron datos reales, como se
pidió explícitamente para estas pruebas).

---

### Punto 10 — Funcionamiento de los tres destinos

**Pedido:** unificar criterio de identificación de destino entre pantalla y
servidor, conservando las tres páginas; verificar ingreso de efectivos y
administradores autorizados en HIGA/UPA/MODULAR, incluyendo administradores
multi-destino; la separación de publicaciones/avisos no debe impedir
consultar guardias de otros destinos para detectar cruces.

**Implementado (parte heredada de la ronda anterior a este informe, dentro
de esta misma entrega):** unificación de `detectLugar()` (variable
`NEXT_PUBLIC_LUGAR` primero, host después) entre cliente y servidor en los
5 puntos donde antes podían divergir: `pages/api/auth-login.js`,
`pages/index.js`, `pages/login-admin.js`, `components/ControlApp.js`,
`components/EfectivoApp.js`.

**Implementado — NUEVO en esta ronda, al verificar el ingreso de
administradores multi-destino (lo que este punto pedía expresamente
revisar):** se encontró que `pages/api/auth-login.js` buscaba al
administrador con `.maybeSingle()` — en Supabase/PostgREST, esa función
lanza un error si la consulta encuentra MÁS DE UNA fila. Como el modelo de
datos (`unique(legajo, lugar)` en `efectivos`, el mismo patrón ya usado para
un efectivo normal con el mismo legajo en lugares distintos) permite
representar a un administrador multi-destino como varias filas
`es_admin=true` con el mismo legajo, una por lugar, un administrador
multi-destino REAL habría roto su propio login con un error de servidor, en
cualquiera de los 3 destinos — nunca lograba entrar en ninguno. Se corrigió
para traer el array completo y resolver la fila correcta según el destino
detectado por la request (el mismo criterio ya unificado arriba): con una
sola fila (el caso normal, sin cambios de comportamiento), usa esa fila sin
exigir coincidencia; con varias filas, elige la del lugar detectado, o
rechaza con un mensaje claro si ese administrador no tiene acceso
configurado en ese destino específico (nunca inventa acceso).

**No modificado (confirmado por revisión, sigue funcionando):**
`buscarCruceOtroLugar` en `pages/admin.js` y el `scope=todas` de
`pages/api/admin-turnos.js` (que exige legajo explícito desde el Punto 4 de
esta ronda) siguen permitiendo consultar guardias de los otros 2 destinos
para detectar cruces reales de horario — la separación de
publicaciones/avisos de los Puntos 8 y 9 es por diseño independiente de
esto: ambos leen la tabla `turnos` (borrador, sin RLS por lugar en este
punto), nunca `turnos_publicados` ni `whatsapp_avisos`.

**Probado:**
- **Node + PostgreSQL real:** `tests/pg/07_admin_multidestino.js`, 7/7 —
  contra filas reales insertadas en Postgres: administrador con acceso a
  HIGA+UPA (sin MODULAR) resuelve correctamente desde HIGA y desde UPA, y
  se rechaza con un mensaje claro desde MODULAR; administrador con acceso a
  los 3 resuelve correctamente desde cada uno; el caso normal (un solo
  lugar, compatibilidad con todos los administradores existentes) sigue
  funcionando sin exigir nada nuevo; un legajo sin ninguna fila
  administrador no resuelve a ningún admin (sigue el camino de efectivo
  normal).
- `next build` compila sin errores con el archivo modificado.

**Pendiente:** loguearse de verdad como administrador multi-destino desde
los 3 dominios reales (o 3 instancias locales simuladas con
`NEXT_PUBLIC_LUGAR` distinto) y confirmar en el navegador — no ejecutable en
este entorno.

---

## 3) Pruebas reproducibles — resultado de esta misma entrega

Todo lo de abajo se ejecutó de nuevo, desde cero, como parte de armar este
informe (no es un resultado heredado de una corrida anterior). Ver
`tests/README.md` para los comandos exactos y el detalle de qué prueba cada
archivo.

### SQL / concurrencia (PostgreSQL 16 real, local, datos ficticios) — 90/90

| Archivo | Pruebas | Resultado |
|---|---|---|
| `tests/pg/02_pruebas_basicas.sql` (preexistente) | 30 | 30/30 OK |
| `tests/pg/03_concurrencia.js` (preexistente, Node+`pg`, 2 conexiones reales simultáneas) | 14 | 14/14 OK |
| `tests/pg/04_rls.sql` (preexistente, roles reales de Postgres) | 22 | 22/22 OK (corrido 2 veces: idempotente) |
| `tests/pg/05_reglas_individuales_y_avisos.sql` (NUEVO — Puntos 1/2/3/9) | 12 | 12/12 OK |
| `tests/pg/06_resumen_horas_cruzadas.sql` (NUEVO — Punto 6) | 5 | 5/5 OK |
| `tests/pg/07_admin_multidestino.js` (NUEVO — Punto 10, Node+`pg`) | 7 | 7/7 OK |

### JavaScript puro (sin red, sin base de datos; dos de ellos contra una librería real sin red) — 63/63

| Archivo | Pruebas | Resultado |
|---|---|---|
| `tests/node/01_tiempo_argentina.js` (preexistente) | 14 | 14/14 OK |
| `tests/node/02_generar_turnos_flujo.js` (preexistente, `fetch` mockeado) | 22 | 22/22 OK |
| `tests/node/03_objetivos_efectivos.js` (NUEVO — Punto 3) | 19 | 19/19 OK |
| `tests/node/04_planilla_sin_cubrir_tramado.js` (NUEVO — Punto 5, ExcelJS real) | 8 | 8/8 OK |

**Total: 153 verificaciones automáticas, 153/153 pasando**, en una corrida
completa desde cero (base recreada, las 4 migraciones aplicadas en orden
00→0001→seed→0004, y luego cada archivo de prueba uno por uno) justo antes
de escribir este informe.

### HTTP (llamada real a un endpoint `/api/...` contra un servidor corriendo) — 0

No ejecutado. No hay un servidor Next.js corriendo en este entorno ni
credenciales de un proyecto Supabase real. Esto incluye los 3 endpoints
nuevos de esta ronda (`admin-reglas-puesto.js`, `admin-reglas-objetivo.js`,
`whatsapp-avisos.js`) y los modificados (`publicar-guardias.js`,
`generar-planilla.js`, `resumen-guardias.js`, `admin-efectivos.js`,
`auth-login.js`).

### Navegador (abrir una pantalla real y operarla) — 0

No ejecutado, por el mismo motivo. Esto incluye toda la UI nueva de
`pages/admin.js` (paneles de puesto fijo/objetivo en `ModalPersonal`,
filtro y badge de sexo, tarjeta de WhatsApp rediseñada) y el login
multi-destino corregido.

`next build` (producción) compiló sin errores sobre el árbol final
completo, confirmando ausencia de errores de sintaxis/JSX/import en todos
los archivos tocados — no se presenta como sustituto de una prueba de
navegador.

---

## 4) Checklist de verificación integral pedido — dónde queda cubierto

| Paso del checklist pedido | Cobertura en esta entrega |
|---|---|
| Configurar sexo/puesto/objetivo | SQL: altas probadas en `05_reglas_individuales_y_avisos.sql`. Pantalla real: pendiente. |
| Cargar disponibilidad fuera de término | Ya probado por `02_pruebas_basicas.sql` (preexistente, Punto 7 sin cambios). Pantalla real: pendiente. |
| Tener guardias previas, ejecutar asignación rápida y comprobar que conserva | Revisión de código + pruebas SQL de la función de inserción (Punto 4). **No hay una ejecución de extremo a extremo** — ver la nota honesta en el Punto 4. |
| Repetirla sin duplicar | Misma limitación que arriba: garantizado por diseño (lee lo existente antes de calcular) y por revisión de código, no por una ejecución real repetida. |
| Verificar objetivos de Solís/Leiva/Coronel | Casos exactos probados en `03_objetivos_efectivos.js` (180hs HIGA/MODULAR) y en `05_reglas_individuales_y_avisos.sql` (Coronel 3→2). Con datos ficticios de prueba, no con los nombres reales (no se pidió cargarlos como datos reales). |
| Alertas de cruce entre los 3 destinos | No modificado esta ronda (confirmado por revisión); las pruebas de concurrencia/SQL preexistentes ya cubren `conflictoOtroLugar`/cruce indirectamente a nivel de datos. Prueba real en pantalla: pendiente. |
| Revisar sumatorias | `06_resumen_horas_cruzadas.sql`, 5/5. Pantalla/Excel real contra Supabase: pendiente. |
| Descargar/revisar planilla con vacantes y no-corresponde | `04_planilla_sin_cubrir_tramado.js`, 8/8 (técnica de celda real, releída). Planilla completa contra Supabase real: pendiente. |
| Publicar un destino sin publicar otros | Mecanismo preexistente (índice único por lugar/mes/año), sin cambios; prueba real en pantalla: pendiente. |
| Confirmar que efectivo ve solo lo publicado | Mecanismo preexistente sin cambios (efectivo lee `turnos_publicados`, nunca `turnos`); prueba real en pantalla: pendiente. |
| Confirmar aviso HIGA deja pendiente UPA | Probado por diseño en SQL: `fn_whatsapp_sincronizar_tras_publicar` se llama con un solo `lugar`, nunca cruza destinos (ver Punto 9). Prueba real en pantalla con 2 destinos a la vez: pendiente. |
| Modificar/republicar y comprobar nuevo aviso pendiente | Exactamente el escenario probado en `05_reglas_individuales_y_avisos.sql` (republicar v2, el que cambió vuelve a pendiente, el que no cambió conserva su confirmación). |

"No envíes mensajes reales ni uses datos reales para estas pruebas": cumplido — todos los legajos, nombres y lugares usados en las pruebas de esta entrega son ficticios (900xxx, "Prueba X"), y el mecanismo de WhatsApp nunca se invocó contra la API real (no existe tal invocación en este proyecto, ver Punto 9).

---

## 5) Instrucciones de instalación y recuperación (descriptas, no ejecutadas en este entorno)

### 5.1 Instalación / puesta en marcha de este ZIP

1. Descomprimir el ZIP en una carpeta nueva.
2. `npm install` en la raíz del proyecto (instala `next`, `react`,
   `@supabase/supabase-js`, `exceljs`, `jszip` — ver `package.json`).
3. Configurar las variables de entorno (`.env.local` o el panel de Vercel,
   según corresponda — este proyecto NO trae un `.env` con valores, por
   seguridad):
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
     `SUPABASE_SERVICE_ROLE_KEY` (del proyecto Supabase real que se vaya a
     usar).
   - `ADMIN_PASSWORD` (contraseña de administrador, compartida entre los 3
     destinos — ver `pages/api/auth-login.js`).
   - `AUTH_SESSION_SECRET` (cadena aleatoria de al menos 16 caracteres, para
     firmar las cookies de sesión — sin esto, en producción el servidor
     directamente no arranca el login; en desarrollo usa un secreto fijo
     inseguro con una advertencia en consola).
   - `NEXT_PUBLIC_LUGAR` (opcional, solo para simular HIGA/UPA/MODULAR en 3
     instancias locales de `next dev` — en los 3 dominios reales de Vercel
     NO debe estar configurada, el destino se decide por el hostname).
4. `npm run dev` (desarrollo) o `npm run build && npm run start`
   (producción local) — **no ejecutado en este entorno** (sin servidor
   Next.js disponible aquí), solo `next build` para confirmar que compila.

### 5.2 Aplicar la migración nueva (0004) sobre Supabase real

**No ejecutado contra ningún Supabase real en esta entrega.** Para
aplicarla cuando se decida:

1. Confirmar que `0001_borrador_publicacion.sql` ya está aplicado (si no,
   aplicarlo primero — y decidir, por separado, si también se aplica
   `0002_rls_propuesta.sql`; `0004` no depende de ninguno de los dos para
   funcionar, pero si no hay RLS activado, las tablas nuevas tampoco lo
   tendrán, igual que el resto de las tablas de este proyecto hoy).
2. Pegar el contenido de `supabase/migrations/0004_reglas_individuales_y_avisos.sql`
   en el SQL Editor de Supabase (o `psql` contra la base real) y ejecutarlo.
   Es 100% aditivo: usa `if not exists`/`create or replace` en todo, no
   borra ni modifica ninguna fila existente, no toca `fn_admin_guardar_efectivo`
   ni ninguna función de `0001`.
3. Verificar (`select` simple) que las tablas nuevas existen y que
   `efectivos.sexo` quedó en `'sin_informar'` para todas las filas
   existentes (la migración lo hace automáticamente antes de poner la
   columna como `not null`).

### 5.3 Recuperación / rollback de la migración 0004 (SQL descripto, no ejecutado)

Si en algún momento hiciera falta deshacer SOLO esta migración (sin tocar
nada de `0001`/`0002`/`0003`):

```sql
drop function if exists fn_whatsapp_sincronizar_tras_publicar(text, int, int);
drop table if exists whatsapp_avisos_historial;
drop table if exists whatsapp_avisos;
drop table if exists efectivo_objetivo_historial;
drop table if exists efectivo_objetivo;
drop table if exists efectivo_puesto_fijo;
alter table efectivos drop constraint if exists efectivos_sexo_check;
alter table efectivos drop column if exists sexo;
```

Esto no está en el repositorio como un archivo de migración "down" — se
documenta acá porque se pidió explícitamente no ejecutar nada, solo dejar
las instrucciones.

### 5.4 Recuperación del código (sin usar `git push`, conservando el historial)

- El historial completo de git de este proyecto (427+ commits, incluidas
  las etiquetas de respaldo `respaldo-main-antes-de-integracion` y
  `respaldo-feature-antes-de-integracion`) está incluido en este ZIP como
  `patches/polad-higa-upa-historial.bundle` (un "bundle" de git, no un
  clon completo, para no incluir el `.git` completo de ~130MB). Para
  restaurarlo en una carpeta nueva:
  ```bash
  git clone patches/polad-higa-upa-historial.bundle polad-restaurado
  cd polad-restaurado
  git checkout feature/disponibilidad-borrador-publicacion
  ```
- **Los cambios de ESTA ronda (los diez puntos) NO están commiteados** —
  quedan como archivos modificados/nuevos en el árbol de trabajo de este
  ZIP, sin tocar el historial de git, para que se puedan revisar antes de
  decidir si se confirman. `git status` dentro del ZIP (una vez
  restaurado el `.git` desde el bundle y copiados estos archivos encima, o
  trabajando directo sobre esta carpeta si ya tiene su propio `.git`)
  muestra exactamente qué cambió.
- `node_modules/` y `.next/` se excluyeron del ZIP (se recrean con `npm
  install` y `npm run build` respectivamente) para no viajar ~450MB de
  contenido reproducible.

---

## 6) Archivos nuevos/modificados en esta ronda (resumen)

**Nuevos:**
`supabase/migrations/0004_reglas_individuales_y_avisos.sql`,
`lib/objetivosEfectivos.js`,
`pages/api/admin-reglas-puesto.js`, `pages/api/admin-reglas-objetivo.js`,
`pages/api/whatsapp-avisos.js`,
`tests/pg/05_reglas_individuales_y_avisos.sql`,
`tests/pg/06_resumen_horas_cruzadas.sql`,
`tests/pg/07_admin_multidestino.js`,
`tests/node/03_objetivos_efectivos.js`,
`tests/node/04_planilla_sin_cubrir_tramado.js`,
este informe (`RESUMEN_RONDA_10_PUNTOS.md`).

**Modificados:**
`pages/admin.js` (sexo, puesto fijo, objetivos, WhatsApp — ver cada punto),
`pages/api/admin-efectivos.js` (sexo),
`pages/api/generar-planilla.js` (SIN CUBRIR/tramado),
`pages/api/resumen-guardias.js` (sumatoria de horas, bug de Rondín Externo,
watermark BORRADOR),
`pages/api/publicar-guardias.js` (llamada a la sincronización de avisos),
`pages/api/auth-login.js` (administrador multi-destino),
`tests/README.md` (documentación de todo lo anterior).

No se tocó `fn_admin_guardar_efectivo`, ningún archivo de la ronda anterior
más allá de lo ya cerrado, ni el algoritmo `calcularAsignaciones`/
`generarTurnos`.
