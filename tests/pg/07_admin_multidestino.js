// tests/pg/07_admin_multidestino.js
//
// Punto 10 de esta ronda ("Funcionamiento de los tres destinos"): "Verificar
// ingreso de efectivos y administradores autorizados en HIGA/UPA/Modular,
// incluyendo administradores multi-destino."
//
// Lo que esta prueba encontró (y corrigió, ver pages/api/auth-login.js):
// un administrador multi-destino se representa, en el modelo de datos real
// (unique(legajo, lugar) en efectivos — ver 00_esquema_base_ficticio.sql),
// con VARIAS filas es_admin=true, mismo legajo, una por lugar. ANTES, la
// consulta de auth-login.js usaba `.maybeSingle()`, que en PostgREST/
// Supabase lanza un error si encuentra MÁS DE UNA fila — con un
// administrador multi-destino real, el login quedaba roto con un error de
// servidor, nunca con un login exitoso en ningún destino. Se corrigió para
// traer el array completo y resolver la fila correcta según el destino de
// la request (lugarDetectadoPorRequest), el mismo criterio que ya usa el
// camino de efectivo normal — unificando el criterio de destino también
// para administradores.
//
// Esta prueba no llama al endpoint HTTP (no hay servidor Next.js
// corriendo en este entorno) — verifica, contra datos REALES insertados en
// PostgreSQL, que esa resolución (copiada literalmente del archivo) elige
// la fila correcta en cada escenario, incluido el caso multi-destino real
// que antes rompía con `.maybeSingle()`.
//
// Requiere: la base polad_test ya creada, con 00_esquema_base_ficticio.sql
// ya aplicado (no depende de 0001 ni de 01_seed_ficticio.sql — usa sus
// propios legajos 900201/900202/900203 para no pisar otras pruebas).
// Variable de entorno PGPASSWORD=postgres_test_local (o ajustar CONN abajo).
//
// Corre con: node 07_admin_multidestino.js

const { Client } = require('pg')

const CONN = {
  host: 'localhost', port: 5432, user: 'postgres',
  password: process.env.PGPASSWORD || 'postgres_test_local',
  database: 'polad_test',
}

let fallos = 0
function ok(nombre) { console.log('  ok  —', nombre) }
function fail(nombre, detalle) { fallos++; console.log('  FALLO —', nombre, detalle ? '(' + detalle + ')' : '') }

// Copiado literalmente de la resolución agregada en pages/api/auth-login.js
// (sección "1) ¿Es un legajo de administrador?") — no es una
// reimplementación aparte, es la misma lógica que corre en el endpoint.
function resolverAdmin(admins, lugarDetectadoPorRequest) {
  let admin = null
  let errorAcceso = null
  if (admins && admins.length === 1) {
    admin = admins[0]
  } else if (admins && admins.length > 1) {
    admin = admins.find(a => a.lugar === lugarDetectadoPorRequest) || null
    if (!admin) {
      errorAcceso = `Este legajo de administrador no tiene acceso configurado en ${lugarDetectadoPorRequest}.`
    }
  }
  return { admin, errorAcceso }
}

async function main() {
  console.log('=== Ingreso de administradores multi-destino (Punto 10, PostgreSQL real) ===')
  const c = new Client(CONN)
  await c.connect()
  try {
    await c.query(`delete from efectivos where legajo in ('900201','900202','900203')`)

    // ── Caso multi-destino real: mismo legajo, administrador en HIGA y
    //    UPA, pero NO en MODULAR (multi-destino parcial, el caso más
    //    realista: no todos los administradores tienen acceso a los tres).
    await c.query(
      `insert into efectivos (legajo, nombre, lugar, es_admin) values
         ('900201', 'Admin Multidestino', 'HIGA', true),
         ('900201', 'Admin Multidestino', 'UPA',  true)`
    )
    const { rows: filasMulti } = await c.query(
      `select legajo, lugar, es_admin from efectivos where legajo = $1 and es_admin = true`,
      ['900201']
    )
    if (filasMulti.length !== 2) {
      fail('precondición: el modelo de datos permite 2 filas es_admin=true con el mismo legajo en lugares distintos (unique(legajo,lugar), no unique(legajo))',
        `se insertaron/leyeron ${filasMulti.length} filas, esperaba 2 — esto es justamente lo que antes de esta corrección hacía fallar auth-login.js con .maybeSingle()`)
    } else {
      ok('precondición: el modelo de datos real permite un administrador multi-destino como 2 (o 3) filas es_admin=true, mismo legajo, distinto lugar — esto es exactamente lo que .maybeSingle() no podía manejar')
    }

    {
      const { admin, errorAcceso } = resolverAdmin(filasMulti, 'HIGA')
      if (!admin || admin.lugar !== 'HIGA' || errorAcceso) {
        fail('administrador multi-destino, acceso desde HIGA debe resolver a la fila de HIGA', JSON.stringify({ admin, errorAcceso }))
      } else {
        ok('administrador multi-destino (HIGA+UPA): accediendo desde HIGA, resuelve a la fila de HIGA — antes esto directamente rompía el login con un error de servidor')
      }
    }
    {
      const { admin, errorAcceso } = resolverAdmin(filasMulti, 'UPA')
      if (!admin || admin.lugar !== 'UPA' || errorAcceso) {
        fail('administrador multi-destino, acceso desde UPA debe resolver a la fila de UPA', JSON.stringify({ admin, errorAcceso }))
      } else {
        ok('administrador multi-destino (HIGA+UPA): accediendo desde UPA, resuelve a la fila de UPA (NUNCA la de HIGA — no hay mezcla entre destinos)')
      }
    }
    {
      const { admin, errorAcceso } = resolverAdmin(filasMulti, 'MODULAR')
      if (admin || !errorAcceso) {
        fail('administrador multi-destino SIN acceso a MODULAR: debe rechazarse con un mensaje claro, nunca loguear en un lugar al que esa fila no pertenece ni adivinar', JSON.stringify({ admin, errorAcceso }))
      } else {
        ok('administrador multi-destino (HIGA+UPA, SIN MODULAR): accediendo desde MODULAR, se rechaza con un mensaje claro ("no tiene acceso configurado en MODULAR") — nunca inventa acceso ni deja pasar silenciosamente')
      }
    }

    // ── Caso multi-destino COMPLETO: HIGA + UPA + MODULAR, mismo legajo.
    await c.query(`insert into efectivos (legajo, nombre, lugar, es_admin) values ('900201', 'Admin Multidestino', 'MODULAR', true)`)
    const { rows: filasMultiCompleto } = await c.query(
      `select legajo, lugar, es_admin from efectivos where legajo = $1 and es_admin = true`,
      ['900201']
    )
    if (filasMultiCompleto.length !== 3) {
      fail('administrador con acceso a los 3 destinos debe quedar representado como 3 filas', `se leyeron ${filasMultiCompleto.length}`)
    } else {
      let okTodos = true
      for (const lg of ['HIGA', 'UPA', 'MODULAR']) {
        const { admin, errorAcceso } = resolverAdmin(filasMultiCompleto, lg)
        if (!admin || admin.lugar !== lg || errorAcceso) { okTodos = false; fail(`administrador con acceso a los 3 destinos, acceso desde ${lg} debe resolver a la fila de ${lg}`, JSON.stringify({ admin, errorAcceso })) }
      }
      if (okTodos) ok('administrador con acceso a los 3 destinos (HIGA+UPA+MODULAR): accediendo desde cada uno de los tres, resuelve siempre a la fila de ESE lugar — ninguno queda sin poder entrar y ninguno entra "mezclado" al lugar equivocado')
    }

    // ── Caso normal (compatibilidad): un único lugar, como todos los
    //    administradores existentes hasta ahora — el comportamiento previo
    //    se preserva exactamente, sin exigir que el lugar detectado
    //    coincida con nada.
    await c.query(`delete from efectivos where legajo = '900202'`)
    await c.query(`insert into efectivos (legajo, nombre, lugar, es_admin) values ('900202', 'Admin Un Solo Lugar', 'HIGA', true)`)
    const { rows: filaUnica } = await c.query(`select legajo, lugar, es_admin from efectivos where legajo = $1 and es_admin = true`, ['900202'])
    let okCompat = true
    for (const lgDetectado of ['HIGA', 'UPA', 'MODULAR']) {
      const { admin, errorAcceso } = resolverAdmin(filaUnica, lgDetectado)
      if (!admin || admin.lugar !== 'HIGA' || errorAcceso) { okCompat = false; fail(`administrador de un solo lugar (caso normal, compatibilidad): detectando "${lgDetectado}" debía seguir resolviendo a su única fila (HIGA) sin exigir coincidencia`, JSON.stringify({ admin, errorAcceso })) }
    }
    if (okCompat) ok('compatibilidad: un administrador de un solo lugar (el caso normal, el único que existía hasta ahora) sigue logueando con normalidad sin importar qué lugar detectó la request — el comportamiento previo no cambió para nadie')

    // ── Caso 0 filas: legajo que no es administrador en ningún lado.
    const { admin: adminVacio, errorAcceso: errorVacio } = resolverAdmin([], 'HIGA')
    if (adminVacio || errorVacio) {
      fail('legajo sin ninguna fila es_admin=true: no debe resolver a ningún admin ni devolver un error de acceso (debe seguir el camino de efectivo normal)', JSON.stringify({ adminVacio, errorVacio }))
    } else {
      ok('un legajo sin ninguna fila es_admin=true no resuelve a ningún administrador (ni error, ni admin) — el código sigue al camino de efectivo normal, sin cambios')
    }
  } finally {
    await c.query(`delete from efectivos where legajo in ('900201','900202','900203')`).catch(() => {})
    await c.end()
  }

  console.log('')
  if (fallos > 0) {
    console.log(fallos + ' prueba(s) de administrador multi-destino FALLARON')
    process.exit(1)
  }
  console.log('Todas las pruebas de ingreso de administrador multi-destino (Punto 10) pasaron.')
}

main().catch(err => { console.error('Error ejecutando pruebas de administrador multi-destino:', err); process.exit(1) })
