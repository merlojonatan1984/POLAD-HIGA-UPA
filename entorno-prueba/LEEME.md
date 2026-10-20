# Entorno de prueba — HIGA, UPA y MODULAR

Esto prepara la última versión entregada del proyecto para probarla a mano,
en una base de datos de **prueba**, separada y compartida entre los tres
destinos, con efectivos ficticios. **En ningún paso se toca ni se modifica
la base real de producción**, no se hace ningún `deploy`, y mientras se
sigan estos pasos no se envía ningún mensaje real por WhatsApp (los
teléfonos cargados son ficticios y no corresponden a ninguna línea real).

## Qué significa "los tres destinos" acá

El mismo código de `pages/admin.js` (y del resto de las pantallas) sirve a
HIGA, UPA o MODULAR según el valor de la variable de entorno
`NEXT_PUBLIC_LUGAR` con la que se lo arranca — no es una elección que se
haga dentro de la pantalla. En producción, eso se resuelve solo porque hay
tres sitios desplegados por separado (cada uno con su propia variable). Para
probar los tres a la vez en un entorno separado, hay que levantar **tres
procesos** del mismo código (en tres puertos distintos), cada uno con su
`NEXT_PUBLIC_LUGAR` — pero los tres leyendo y escribiendo la **misma** base
de datos de prueba (así es como, por ejemplo, se puede probar de verdad que
una guardia nocturna de "Rondín Externo" en HIGA bloquea una guardia
superpuesta en UPA).

## Paso 0 — lo que yo no puedo hacer por vos, y el paso concreto a seguir

No tengo forma de crear una cuenta o un proyecto en un servicio externo
(Supabase) en tu nombre, ni de instalar/ejecutar nada en tu computadora
directamente. Por eso esta preparación llega hasta dejar todo listo
(esquema, datos ficticios, plantillas de configuración e instrucciones
exactas) para que lo corras vos mismo, en tu computadora.

Tenés dos caminos igual de válidos para la base de prueba. Los dos cumplen
"no toca la base real" y "no se envían mensajes reales" — elegí el que te
resulte más cómodo. El resto de esta guía (Pasos 1 a 5) es **idéntico** en
ambos casos; solo cambia de dónde salen los tres valores
(`NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` /
`SUPABASE_SERVICE_ROLE_KEY`) que vas a pegar en el Paso 3, y cómo pegás el
SQL del Paso 1.

### Opción A — con una cuenta en supabase.com (la nube)

No corre nada en tu PC más que las tres instancias de Next.js; la base
vive en la nube, en un proyecto de prueba tuyo.

1. Entrá a [supabase.com](https://supabase.com) y creá una cuenta (o entrá
   con la que ya tengas) y un proyecto nuevo — ponele un nombre que lo
   identifique como prueba, por ejemplo `polad-prueba`. Elegí cualquier
   contraseña de base de datos (anotala, la vas a necesitar si usás
   `psql`).
2. Cuando el proyecto esté listo, en **Settings → API** vas a encontrar:
   - **Project URL** (`https://xxxxx.supabase.co`)
   - **anon public** key
   - **service_role** key (⚠️ secreta, no la compartas)
3. En **Settings → Database → Connection string** vas a encontrar la
   cadena de conexión de Postgres (solo si querés correr el SQL del Paso 1
   con `psql`; si no, podés pegar cada archivo directamente en el **SQL
   Editor** de Supabase, que es más simple y no requiere instalar nada).

### Opción B — 100% local con Docker, sin cuenta en la nube

Si preferís no crear ninguna cuenta externa, podés correr tu propia base
de Supabase **en tu PC**, con la [CLI de Supabase](https://supabase.com/docs/guides/local-development)
y Docker. Nada sale de tu computadora; no hace falta ningún registro en
supabase.com.

Requisitos: tener [Docker Desktop](https://www.docker.com/products/docker-desktop/)
instalado y corriendo, y la [CLI de Supabase](https://supabase.com/docs/guides/cli/getting-started)
instalada (por ejemplo `npm install -g supabase`, o seguí las instrucciones
de esa página para tu sistema).

1. En la carpeta del proyecto (la primera de las tres copias que vas a
   hacer en el Paso 3 — ver más abajo, alcanza con hacerlo en una sola),
   corré una sola vez:
   ```bash
   supabase init
   supabase start
   ```
   La primera vez `supabase start` descarga las imágenes de Docker, así
   que puede tardar varios minutos. Dejalo corriendo — no lo apagues
   mientras estés probando el sistema (si alguna vez lo apagás, con
   `supabase start` de nuevo lo volvés a levantar; no vuelve a correr el
   SQL de los Pasos 1 y 2 por su cuenta).
2. Cuando termine, imprime en la terminal (y lo podés volver a ver en
   cualquier momento con `supabase status`) algo como:
   ```
   API URL: http://127.0.0.1:54321
   anon key: eyJ...
   service_role key: eyJ...
   DB URL: postgresql://postgres:postgres@127.0.0.1:54322/postgres
   Studio URL: http://127.0.0.1:54323
   ```
   Usá exactamente esos valores (los que te imprime TU `supabase start`,
   no copies los de este ejemplo — cambian según la versión de la CLI):
   `API URL` → `NEXT_PUBLIC_SUPABASE_URL`, `anon key` →
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `service_role key` →
   `SUPABASE_SERVICE_ROLE_KEY` en el Paso 3.
3. Para cargar el SQL del Paso 1 tenés dos formas igual de válidas: abrir
   `Studio URL` (`http://127.0.0.1:54323`) en el navegador, que trae su
   propio **SQL Editor** (igual que el de la nube, pero local), o correr
   cada archivo con `psql "<DB URL>" -f archivo.sql` usando la `DB URL`
   de arriba.

⚠️ **Importante — no uses `supabase db reset`** en este entorno. Ese
comando aplica automáticamente, en orden, **todos** los archivos de
`supabase/migrations/`, incluyendo `0002_rls_propuesta.sql` y
`0003_transicion_datos_existentes.sql`, que el Paso 1 omite a propósito
(0003 asume una base real con datos para migrar, que acá no existe, y
fallaría). Cargá el SQL siempre a mano, archivo por archivo y en el orden
exacto del Paso 1.

(Si en algún momento querés que yo mismo ejecute estos pasos — cualquiera
de las dos opciones — en tu computadora en vez de hacerlos vos a mano,
puedo hacerlo si vinculás esta sesión a tu computadora — ahora mismo
intenté y no está vinculada.)

## Paso 1 — crear el esquema de la base de prueba

Con el proyecto de Supabase de prueba ya creado (Opción A o B del Paso 0),
pegá y ejecutá, **en este orden exacto**, cada uno de estos archivos en el
**SQL Editor** de ese proyecto — el de la nube si elegiste la Opción A, o
el de `http://127.0.0.1:54323` si elegiste la Opción B (nunca en el
proyecto real):

1. `tests/pg/00_esquema_base_ficticio.sql` — crea las tablas base
   (`efectivos`, `turnos`, `disponibilidad`, `configuracion`, `asistencia`,
   `planilla_manual`, `firmas`). Es una reconstrucción por lectura del
   código, no un volcado de la base real (nunca tuvimos acceso a ella) —
   alcanza y sobra para probar las pantallas.
2. `entorno-prueba/01_tabla_efectivos_especiales_ficticia.sql` — crea
   `efectivos_especiales` (24hs/parejas), la única tabla que usa
   "Asignación rápida" y que tampoco está en ninguna migración del
   proyecto (se asume preexistente en la base real).
3. `supabase/migrations/0001_borrador_publicacion.sql`
4. `supabase/migrations/0004_reglas_individuales_y_avisos.sql`
5. `supabase/migrations/0005_correcciones_ronda_bugs.sql`
6. `supabase/migrations/0006_correcciones_ronda3.sql`

**Se omiten a propósito** (no hace falta correrlos para esta prueba):

- `0002_rls_propuesta.sql`: agrega políticas de seguridad (RLS) que la
  app no necesita para funcionar — los endpoints del servidor usan la
  `service_role key`, que siempre pasa por encima de RLS. Si en algún
  momento también querés probar específicamente los permisos/RLS, se
  puede correr aparte, pero no es necesario para abrir las pantallas.
- `0003_transicion_datos_existentes.sql`: es un script de una sola vez
  para migrar datos YA EXISTENTES de la base real al esquema nuevo — en
  una base de prueba recién creada no hay nada que migrar.

Ya probé este mismo orden (pasos 1 a 6) contra un PostgreSQL 16 real en
este entorno antes de entregarlo: se aplica sin errores de punta a punta.

## Paso 2 — cargar los datos ficticios de los tres destinos

Con el esquema ya creado, pegá y ejecutá `entorno-prueba/02_seed_tres_destinos.sql`
en el mismo SQL Editor (de la nube o local, según la opción elegida en el
Paso 0). Carga:

- Un administrador de prueba (legajo `ADMIN1`) con acceso a los **tres**
  destinos a la vez.
- Dos efectivos de prueba por destino (ver tabla de credenciales abajo).
- La ventana de disponibilidad **abierta para hoy** en los tres destinos
  (así se puede entrar como efectivo y cargar disponibilidad sin tener que
  configurar nada más primero).
- Un caso de "24hs" en HIGA y un caso de "pareja" en UPA, ya armados, para
  poder probar "Asignación rápida" directamente.

Ya corrí este seed contra una base de prueba real después de aplicar los
6 pasos anteriores: se carga sin errores (10 efectivos, 3 filas de
`configuracion` abiertas para hoy, 2 filas de `efectivos_especiales`).

Si alguna vez recreás la base de prueba desde cero, volvé a correr este
mismo archivo — vuelve a abrir la ventana de disponibilidad para "hoy" (la
fecha se calcula sola, no queda una fecha vieja pegada).

## Paso 3 — configurar las tres instancias locales

En tu computadora, con el proyecto ya descargado/clonado:

```bash
npm install   # una sola vez
```

Copiá cada plantilla de `entorno-prueba/.env.ejemplo.HIGA` /
`.env.ejemplo.UPA` / `.env.ejemplo.MODULAR` y completá los tres datos que
te dio Supabase en el Paso 0 (son los **mismos** en las tres plantillas:
Project URL, anon key, service_role key) — son plantillas, no tienen
ninguna clave real cargada.

Si elegiste la **Opción A** (la nube), esos tres valores son el **Project
URL**, la **anon public key** y la **service_role key** de
Settings → API. Si elegiste la **Opción B** (local con Docker), son el
**API URL**, la **anon key** y la **service_role key** que imprimió
`supabase start` (o `supabase status`) — típicamente
`NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321` en vez de una URL
`https://xxxxx.supabase.co`. En ambos casos van exactamente iguales en
las tres copias/plantillas, porque las tres instancias comparten la misma
base.

Como el proyecto solo lee un archivo `.env.local` a la vez, para correr las
tres instancias **al mismo tiempo** necesitás tres carpetas con una copia
del proyecto cada una (la más simple: cloná/copiá la carpeta del proyecto
tres veces — `polad-higa/`, `polad-upa/`, `polad-modular/` — y en cada una
dejá como `.env.local` la plantilla correspondiente a ese destino). Las
tres copias apuntan a la MISMA base de Supabase de prueba, así que
comparten los mismos datos.

## Paso 4 — levantar las tres instancias

En tres terminales distintas, una por carpeta:

```bash
# en polad-higa/
npm run dev -- -p 3001

# en polad-upa/
npm run dev -- -p 3002

# en polad-modular/
npm run dev -- -p 3003
```

## Paso 5 — abrir los tres destinos

- **HIGA**: http://localhost:3001
- **UPA**: http://localhost:3002
- **MODULAR**: http://localhost:3003

⚠️ **Importante**: abrí cada una en una ventana de incógnito distinta (o en
tres navegadores distintos — Chrome, Firefox, el navegador en modo
incógnito, etc.), **no** las tres pestañas normales de un mismo navegador.
Esto es porque las cookies de sesión de este proyecto se identifican por
nombre de dominio (`localhost`) sin importar el puerto — si entrás como
administrador en una y después abrís otra pestaña normal (no incógnita)
contra otro puerto, el navegador puede mandar la cookie de la primera sesión
también ahí, y vas a ver una combinación confusa (la pantalla de un destino
pero datos de otro). Usando tres ventanas de incógnito (o tres navegadores)
cada sesión queda completamente separada.

## Credenciales de acceso

**Como administrador** (en cualquiera de los tres destinos, con el mismo
legajo):

- Legajo: `ADMIN1`
- Contraseña: la que pusiste en `ADMIN_PASSWORD` en los tres `.env.local`
  (la plantilla trae `clave-admin-de-prueba` como sugerencia).

**Como efectivo de prueba** (clave inicial = el propio número de legajo,
tal como ya indica la pantalla de ingreso):

| Destino  | Legajo   | Contraseña |
|----------|----------|------------|
| HIGA     | `910001` | `910001`   |
| HIGA     | `910002` | `910002`   |
| UPA      | `920001` | `920001`   |
| UPA      | `920002` | `920002`   |
| MODULAR  | `930001` | `930001`   |
| MODULAR  | `930002` | `930002`   |

Todos estos legajos y nombres están marcados "(FICTICIO)" en la base — son
datos de prueba, no corresponden a ninguna persona real.

## Qué NO hace falta para esta prueba

- Las variables `WHATSAPP_VERIFY_TOKEN`/`WHATSAPP_ACCESS_TOKEN`/
  `WHATSAPP_PHONE_NUMBER_ID`/`ADMIN_WHATSAPP_NUMBER` (webhook real de
  Meta/WhatsApp) — el link "Enviar guardias por WhatsApp" sigue
  funcionando igual sin esto (es un link `wa.me` común), solo no vas a
  tener respuestas automáticas entrantes. Los teléfonos ficticios cargados
  en el Paso 2 no corresponden a ninguna línea real, así que aunque se
  llegue a hacer clic en ese link no hay a quién pueda llegarle un mensaje.
- El bucket de Storage `planillas` (para subir/descargar planillas en
  PDF/imagen) — solo hace falta si además querés probar esa pantalla en
  particular (`carga-planillas.js`); no es necesario para probar
  disponibilidad, asignación, publicación o el seguimiento de WhatsApp.

## Qué no se tocó para armar esto

No se modificó ningún archivo de `pages/`, `lib/` ni `components/`, ninguna
migración de `supabase/migrations/`, ni ninguna prueba automática de
`tests/`. Todo lo nuevo de esta entrega vive en esta misma carpeta
(`entorno-prueba/`).
