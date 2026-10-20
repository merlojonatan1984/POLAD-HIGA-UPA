# POLAD — Informe breve (corrección de generarTurnos, coherencia de legajo, estructura de despliegue y entorno aislado)

Fecha: 2026-10-19/20. Continúa sobre `POLAD-HIGA-UPA_corregido_20261019_v2.zip`. No se tocó Supabase real, no hubo `git push` ni deploy, no se cambió el algoritmo de asignación ni se agregó funcionalidad nueva. El historial de git (427+ commits) y los respaldos existentes se conservan.

Este informe distingue siempre, para cada punto: **prueba ejecutada** (SQL real o JavaScript real, con resultado), **revisión de código** (sin ejecución), y **pendiente** (con el motivo concreto). Ninguna revisión de código ni `next build` se presenta como prueba de HTTP o de pantalla.

---

## 1) Detener la regeneración si falla la lectura de disponibilidad — corregido y probado

**Problema:** en `generarTurnos()` (`pages/admin.js`), `const { data: dispFresh } = await fetch(...).then(r => r.json())` no comprobaba `response.ok`, ni un error de red, ni la forma del cuerpo. Un 500 (o cualquier fallo) dejaba `dispFresh` en `undefined`, indistinguible de "no hay disponibilidad cargada" — el algoritmo seguía con un mapa vacío, daba 0 asignaciones, y terminaba llamando a `reemplazar_scope` con `turnos: []`, pudiendo vaciar un borrador real.

**Corrección:** la orquestación (leer disponibilidad con manejo real de errores, decidir si corresponde correr el algoritmo y guardar, o abortar) se extrajo a `lib/generarTurnosFlujo.js` (`ejecutarGeneracionDeTurnos`), sin tocar el algoritmo de asignación en sí (se le pasa como callback, carácter por carácter igual que antes). Ahora:

- Un error HTTP, de red, de JSON o de estructura detiene la operación **antes de cualquier escritura** (nunca se llega a llamar a `reemplazar_scope`), se muestra el error, y se restablece el botón (`setGenerando(false)`).
- Una lectura válida con disponibilidad realmente vacía (array vacío) sigue de largo con normalidad — no es un error.
- Si el resultado válido da 0 asignaciones y YA había un borrador cargado, no se lo vacía automáticamente: se conserva completo y se le muestra al administrador qué pasó (con una alerta explícita), dejando la opción de borrar guardias explícitamente aparte si de verdad lo quiere.

**Archivos:** `lib/generarTurnosFlujo.js` (nuevo), `pages/admin.js` (`generarTurnos()` reescrita para usarlo; algoritmo sin cambios).

**Prueba ejecutada — JavaScript real, no SQL (pedido explícitamente):** `tests/node/02_generar_turnos_flujo.js`, 22/22 OK. Mockea `fetch` y ejercita el módulo real que usa `pages/admin.js`. Confirma, entre otros casos, el exacto reportado: un 500 de `/api/admin-disponibilidad` nunca llega a llamar a `reemplazar_scope` ni a correr el algoritmo.

**Revisión de código:** `pages/admin.js` usa el módulo correctamente (confirmado leyendo el diff). `next build` compila sin errores.

**Pendiente:** ejecutar esto en un navegador real contra un servidor corriendo (ver sección 4, impedimento de entorno).

---

## 2) Completar la coherencia del cambio de legajo — corregido y probado

**Problema:** en `handleGuardarPersonal()`, ANTES de llamar a `fn_admin_guardar_efectivo` (que renombra efectivo + turnos en una transacción), el código disparaba por su cuenta, en paralelo, cuatro escrituras más: un POST a `/api/admin-disponibilidad` (`rename_legajo`, sin filtrar por lugar) y tres updates directos con la clave anon (`asistencia`, `planilla_manual`, `firmas`, también sin filtrar por lugar). Si la llamada principal fallaba después (legajo duplicado, por ejemplo), esas cuatro escrituras ya habían ocurrido — una parte modificada, la otra no.

**Corrección:** `fn_admin_guardar_efectivo` (SQL, migración 0001) ahora también renombra, **en la misma transacción**, `disponibilidad`, `asistencia` y `planilla_manual` — las tres tienen columna `lugar` propia, así que se acotan a `p_lugar` exactamente igual que los turnos: nunca una fila de otro lugar, aunque el legajo coincida (el mismo legajo puede ser dos personas distintas en lugares distintos — ver `01_seed_ficticio.sql`).

`firmas` es un caso distinto: no tiene columna `lugar` ni `sector` de la que derivarlo — no hay ninguna forma de saber a qué lugar pertenece una fila de `firmas`. Siguiendo la instrucción explícita de no adivinar ni hacer cambios globales: la función comprueba, antes de tocar nada, que el legajo viejo sea único entre **todos** los efectivos (de cualquier lugar) y que el legajo nuevo no le pertenezca ya a otro efectivo distinto. Solo si las dos condiciones se cumplen renombra `firmas`; si no, la deja intacta y lo informa explícitamente (`firmas_omitidas_por_ambiguedad: true`), que `pages/admin.js` muestra al administrador en vez de pasarlo en silencio.

`pages/admin.js` (`handleGuardarPersonal`) ya no hace esas cuatro escrituras por su cuenta — llama una sola vez a `/api/admin-efectivos`. `pages/api/admin-disponibilidad.js` (`rename_legajo`) quedó sin uso desde esta pantalla (se corrigió igual, acotándola a `sesion.lugar`, por si algo más la llegara a usar).

Además, el `select` inicial de `fn_admin_guardar_efectivo` pasó a usar `for update`: sin esto, dos ediciones concurrentes del mismo efectivo podían dejar turnos/relaciones bajo un legajo intermedio (la segunda transacción leía una foto vieja del legajo). Con el lock de fila, la segunda edición espera a que la primera termine y relee el legajo ya actualizado.

**Archivos:** `supabase/migrations/0001_borrador_publicacion.sql` (`fn_admin_guardar_efectivo` extendida), `pages/api/admin-efectivos.js` (devuelve los contadores nuevos), `pages/admin.js` (`handleGuardarPersonal` simplificada), `pages/api/admin-disponibilidad.js` (`rename_legajo` acotado a `sesion.lugar`, aunque ya no se llama desde la pantalla).

**Pruebas ejecutadas — SQL real contra PostgreSQL 16:**

- `tests/pg/02_pruebas_basicas.sql`, 30/30 OK (+3 respecto a la entrega anterior): caso ambiguo (mismo legajo en HIGA y MODULAR) — las relaciones con columna `lugar` se renombran solo del lado correcto, `firmas` NO se toca; caso inequívoco — `firmas` SÍ se renombra; **falla del guardado principal (legajo duplicado): ninguna de las cinco relaciones queda modificada**, exactamente lo pedido.
- **Cambio exitoso, todas las relaciones coherentes:** cubierto en el caso inequívoco de arriba (turnos ya se probaba en la ronda anterior).
- **Mismo legajo en otro lugar, intacto:** cubierto en el caso ambiguo de arriba.
- **Dos ediciones concurrentes del mismo efectivo, sin legajo intermedio** (dos conexiones PostgreSQL reales, simultáneas): `tests/pg/03_concurrencia.js`, nueva prueba `pruebaDosEdicionesConcurrentesDelMismoEfectivo`, 14/14 OK en el archivo. Confirma que el efectivo y las cuatro relaciones (turnos, disponibilidad, asistencia, planilla_manual) terminan consistentes con el legajo final — nunca repartidas entre el legajo viejo, uno intermedio y el nuevo.

**Revisión de código:** `admin-efectivos.js`, `admin.js` y `admin-disponibilidad.js`, verificados por revisión línea por línea. `next build` compila sin errores.

**Pendiente:** ejecutar esto en un navegador real contra un servidor corriendo (sección 4).

---

## 3) Estructura de despliegue (Vercel/Supabase) — verificado con lo disponible, sin cambiar nada

No tengo acceso a los paneles de Vercel ni de Supabase desde este entorno, así que no puedo confirmarlo de forma directa. Lo que encontré, revisando el código (no es una suposición):

- `pages/api/limpiar-mes-prueba.js` dice explícitamente: "funciona igual desde cualquiera de los 3 sitios, porque comparten la misma base de datos" — y su lógica (borra datos de los 3 lugares con una sola llamada, sin ningún filtro de lugar) solo puede funcionar así si es cierto.
- `pages/api/admin-disponibilidad-override.js` documenta un caso real ya observado: "ocurre: HIGA, UPA y MODULAR comparten la misma base".
- La tabla `turnos` no tiene columna `lugar` — el lugar se deriva del nombre del sector (`fn_sectores_de_lugar`), lo que solo tiene sentido si las tres sedes escriben en la misma tabla.
- Los tres dominios (`polad-modular.vercel.app`, `polad-higa-upa.vercel.app`, y un tercero) con ese patrón de subdominio — Vercel asigna un único `.vercel.app` por **proyecto** — indican 3 proyectos de Vercel separados, cada uno con sus propias variables de entorno.

**Conclusión (con la confianza que da la evidencia de código, no una confirmación directa):** 3 proyectos de Vercel separados, las 3 configuradas para apuntar al mismo proyecto Supabase. No cambié nada de esta organización. Lo que falta para confirmarlo al 100%: acceso al panel de Vercel (comparar `NEXT_PUBLIC_SUPABASE_URL` entre los 3 proyectos) o al panel de Supabase, o que alguien con acceso lo confirme directamente.

Esto importa para las instrucciones de la sección 4: el entorno aislado se armó para reflejar esta misma estructura (3 "sitios" contra una sola base de prueba), no una distinta.

---

## 4) Recorrido funcional en entorno aislado — instrucciones autosuficientes (no ejecutado en este entorno)

**No se pudo ejecutar en este entorno** — mismo impedimento de siempre, comprobado de nuevo en esta ronda: no hay Docker corriendo (ni el daemon), no hay CLI de Supabase, y el acceso de red saliente está restringido (una conexión a `api.supabase.com` se rechazó explícitamente). No hay forma de tener un servidor Next.js real hablando con una API de Supabase real desde acá. Levantar `next dev` con variables falsas y pegarle con `curl` no demostraría nada más que `next build` — por eso no se hizo ese simulacro, siguiendo la instrucción de no presentarlo como prueba funcional.

Estas son las instrucciones completas para correrlo en un entorno aislado real (nunca producción):

### 4.1 — Crear el proyecto de prueba

1. Crear un proyecto Supabase nuevo y gratuito, **exclusivo para esta prueba** (nunca el real).
2. En el SQL Editor de ese proyecto, ejecutar en este orden:
   - `tests/pg/00_esquema_base_ficticio.sql` — crea las tablas base (`efectivos`, `turnos`, `disponibilidad`, `configuracion`, `asistencia`, `planilla_manual`, `firmas`) con las columnas que el código realmente usa. Es una reconstrucción por inspección del código, no un dump real — en un proyecto Supabase nuevo y vacío hace de esquema base.
   - `supabase/migrations/0001_borrador_publicacion.sql` — aditiva, agrega las funciones y tablas nuevas (`publicaciones`, `turnos_publicados`, `disponibilidad_auditoria`, y todas las `fn_*`).
   - `supabase/migrations/0002_rls_propuesta.sql` — activa RLS restrictiva (bloquea `anon`, permite `service_role`) y revoca `EXECUTE` de `anon`/`authenticated` sobre las funciones de esta etapa. (`0003_transicion_datos_existentes.sql` NO corresponde acá: es solo para migrar publicaciones de datos ya existentes en producción.)
   - `tests/pg/01_seed_ficticio.sql` — datos 100% ficticios (incluye, a propósito, el mismo legajo en dos lugares distintos, para poder probar el punto 4 de la ronda anterior y el punto 2 de esta).
3. **Storage** — crear un bucket llamado `planillas`:
   - Marcarlo como **público para lectura** (o agregar una política `select` para `anon`/`public`) — la descarga de planillas tiene que funcionar sin login.
   - **No** agregar ninguna política de `insert`/`update`/`delete` para `anon` ni `authenticated` — todas las subidas/borrados de este proyecto pasan por endpoints con `service_role` (`crear-url-planilla.js` + URL firmada, `admin-efectivos.js` para el borrado), nunca directo desde el navegador. Esta es la validación de Storage que seguía pendiente del informe anterior: confirmar, en el panel de Supabase (Storage → planillas → Policies), que efectivamente NO hay ninguna política que permita `insert`/`update`/`delete` a `anon`, y que la service role (que no tiene políticas, las ignora) sigue pudiendo escribir — subir una planilla desde el panel admin y confirmar que aparece en Storage; después, con las herramientas de desarrollador del navegador, confirmar que la clave anon (visible en el bundle público) no alcanza para subir ni borrar un archivo ahí directamente (por ejemplo, probando la misma operación por `fetch` con esa clave desde la consola y confirmando que Supabase la rechaza).
4. Variables de entorno (archivo `.env.local`, uno por cada instancia local — ver 4.2): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (las tres del proyecto de prueba recién creado — nunca las del proyecto real), `ADMIN_PASSWORD` (cualquier valor de prueba), `AUTH_SESSION_SECRET` (cualquier string de 16+ caracteres).

### 4.2 — Simular los 3 sitios localmente, contra la misma base de prueba

No hace falta desplegar a Vercel para este recorrido. El código ya tiene una salida pensada para esto: `_detectLugar()` (en `pages/admin.js`, `pages/index.js`, `pages/login-admin.js`, `components/ControlApp.js`, `components/EfectivoApp.js`) revisa primero `process.env.NEXT_PUBLIC_LUGAR` antes de mirar el hostname. Con eso alcanza para correr los "3 sitios" en 3 puertos locales distintos, los tres contra el mismo proyecto Supabase de prueba — igual que, según la sección 3, funcionan los 3 sitios reales:

```bash
npm install

# Terminal 1 — simula HIGA
NEXT_PUBLIC_LUGAR=HIGA NEXT_PUBLIC_SUPABASE_URL=... NEXT_PUBLIC_SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=... ADMIN_PASSWORD=... AUTH_SESSION_SECRET=... npx next dev -p 3001

# Terminal 2 — simula UPA
NEXT_PUBLIC_LUGAR=UPA NEXT_PUBLIC_SUPABASE_URL=... NEXT_PUBLIC_SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=... ADMIN_PASSWORD=... AUTH_SESSION_SECRET=... npx next dev -p 3002

# Terminal 3 — simula MODULAR
NEXT_PUBLIC_LUGAR=MODULAR NEXT_PUBLIC_SUPABASE_URL=... NEXT_PUBLIC_SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=... ADMIN_PASSWORD=... AUTH_SESSION_SECRET=... npx next dev -p 3003
```

(Los `...` son los valores del proyecto de prueba del paso 4.1 — iguales en las tres terminales, salvo `NEXT_PUBLIC_LUGAR`.)

### 4.3 — El recorrido de 9 pasos (con datos ficticios, con las dos correcciones de esta ronda incluidas)

Con los 3 sitios arriba, de a un paso por vez, confirmando en pantalla lo que corresponde:

1. Abrir `localhost:3001` (HIGA) sin loguearse — confirmar que la carga pública de disponibilidad está cerrada (fuera de la ventana configurada en `configuracion`).
2. Loguearse como administrador en `localhost:3001`, cargar la disponibilidad de un efectivo "fuera de término" sin reabrir la inscripción general — confirmar que queda guardada y auditada (`disponibilidad_auditoria`).
3. Con otro efectivo (no administrador), confirmar que sigue sin poder cargar disponibilidad fuera de término.
4. Como administrador, usar "Generar turnos" (regenerar guardias). **Incluir la prueba de la corrección del punto 1:** cortar momentáneamente la conexión al proyecto Supabase de prueba (o apagar esa terminal) antes de tocar "Generar turnos", confirmar que aparece un error claro y que el borrador anterior (si había) sigue intacto; reconectar y repetir con normalidad.
5. Como efectivo (no administrador), confirmar que NO ve el borrador recién generado.
6. Como administrador, abrir la vista previa de publicación, revisarla, y publicar.
7. Como efectivo, confirmar que ve ÚNICAMENTE las guardias publicadas (no el borrador).
8. Como administrador, modificar el borrador (por ejemplo, un turno puntual) — confirmar que lo publicado NO cambia hasta una nueva publicación.
9. Confirmar que "Control" y la generación de planillas siguen reflejando la versión publicada, no el borrador modificado en el paso 8.

**Verificación adicional de esta ronda (punto 2):** en la pantalla de personal, editar el legajo de un efectivo que tenga disponibilidad/asistencia/planilla manual/firma cargadas — confirmar que las cuatro relaciones quedan con el legajo nuevo. Repetir con un legajo que también exista en otro de los 3 sitios (mismo legajo, otra persona) — confirmar que esa otra persona no se ve afectada, y que la pantalla avisa si la firma no se pudo renombrar por ambigüedad.

Si algún paso no se puede ejecutar en el entorno donde se corra esto, hay que indicar el impedimento concreto (igual que se hizo acá) — no asumir que pasó.

---

## 5) WhatsApp — pendiente, a la espera de la aclaración del punto 7

Se recibió, en paralelo, un pedido de corrección sobre los avisos de WhatsApp (estado de aviso por efectivo+establecimiento+mes+año, no solo legajo; no marcar otros lugares al enviar uno; vincular el aviso a la versión publicada; no perder el estado por cambios de otros efectivos; distinguir "se abrió WhatsApp" de "el administrador confirmó el envío"; un envío fallido no debe quedar como enviado; no convertir en voz pasiva los registros antiguos sin poder identificarlos). El mensaje llegó cortado en el punto 7, así que no se avanzó con ninguna implementación todavía para no adivinar una decisión de migración/esquema — queda pendiente de la aclaración.

---

## 6) Archivos modificados en esta ronda

`lib/generarTurnosFlujo.js` (nuevo), `pages/admin.js`, `pages/api/admin-efectivos.js`, `pages/api/admin-disponibilidad.js`, `supabase/migrations/0001_borrador_publicacion.sql`, `tests/pg/02_pruebas_basicas.sql`, `tests/pg/03_concurrencia.js`, `tests/node/02_generar_turnos_flujo.js` (nuevo), `tests/README.md`.

## 7) Resultado de pruebas de esta ronda

| Archivo | Pruebas | Resultado | Tipo |
|---|---|---|---|
| `tests/pg/02_pruebas_basicas.sql` | 30 | 30/30 OK | Función SQL real |
| `tests/pg/03_concurrencia.js` | 14 | 14/14 OK | Función SQL, 2 conexiones reales simultáneas |
| `tests/pg/04_rls.sql` | 22 | 22/22 OK | Función SQL / políticas RLS, roles reales |
| `tests/node/01_tiempo_argentina.js` | 14 | 14/14 OK | JavaScript puro |
| `tests/node/02_generar_turnos_flujo.js` (nuevo) | 22 | 22/22 OK | JavaScript real (fetch mockeado), no SQL |

**Total: 102 aserciones automáticas, 102/102 pasaron.** `next build` compila sin errores con los cambios de esta ronda.

**No ejecutado, con el motivo:** ninguna llamada HTTP real ni apertura de pantalla en navegador — este entorno no tiene servidor Next.js corriendo ni acceso a ningún proyecto Supabase (sección 4). Las instrucciones de la sección 4 son autosuficientes para que esto se corra en un entorno aislado real.
