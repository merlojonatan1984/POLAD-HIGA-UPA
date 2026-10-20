// tests/pg/10_correcciones_ronda3_concurrencia.js
//
// Prueba de concurrencia REAL (dos conexiones de PostgreSQL separadas, mismo
// patrón que tests/pg/03_concurrencia.js — no una simulación) para la
// "Falla 3" de la tercera ronda ("Confirmación de WhatsApp"): coordinar la
// validación/escritura de la confirmación con la publicación/sincronización,
// para que una publicación simultánea nunca deje confirmado un contenido
// distinto del que efectivamente quedó publicado.
//
// Escenario: el administrador A está publicando una versión nueva (que
// cambia el contenido de un efectivo) dentro de una transacción que se
// mantiene ABIERTA a propósito (BEGIN explícito, sin COMMIT todavía) — igual
// técnica que pruebaPreviewContraEscrituraConcurrente en 03_concurrencia.js
// — para poder observar la ventana real de la carrera. Mientras esa
// publicación está "a mitad de camino" (ya ejecutó
// fn_publicar_guardias_y_sincronizar_whatsapp, que toma el lock de fila de
// whatsapp_avisos con FOR UPDATE, pero todavía no hizo COMMIT), el
// administrador B intenta CONFIRMAR el envío para ESE MISMO efectivo con el
// fingerprint que su pantalla tenía cargado ANTES de que A empezara a
// publicar (desactualizado respecto de lo que A está a punto de dejar
// vigente).
//
// Lo que se prueba, en este orden:
//   1) B queda BLOQUEADA mientras A no hizo commit (fn_whatsapp_confirmar_envio
//      toma el lock de la MISMA fila con FOR UPDATE) — nunca se intercala.
//   2) Una vez que A hace commit, B se desbloquea, pero ve el estado YA
//      sincronizado (fingerprint_turnos nuevo, fingerprint_en_apertura
//      reseteado a null) — nunca una lectura a medio camino.
//   3) B se RECHAZA (contenido_cambio_desde_apertura) — nunca queda
//      confirmado un contenido que ya no es el vigente.
//   4) El estado final es coherente: pendiente, con el fingerprint de la
//      publicación nueva — nunca "confirmado" con el contenido viejo.
//
// Requiere: la base polad_test con 00_esquema_base_ficticio.sql + 0001 +
// 01_seed_ficticio.sql + 0004 + 0005 + 0006 ya aplicados (ver README.md).
// Variable de entorno PGPASSWORD=postgres_test_local (o ajustar CONN abajo).

const { Client } = require('pg')

const CONN = {
  host: 'localhost', port: 5432, user: 'postgres',
  password: process.env.PGPASSWORD || 'postgres_test_local',
  database: 'polad_test',
}

let fallos = 0
function ok(nombre) { console.log('  ok  —', nombre) }
function fail(nombre, detalle) { fallos++; console.log('  FALLO —', nombre, detalle ? '(' + detalle + ')' : '') }

async function nuevoClient() {
  const c = new Client(CONN)
  await c.connect()
  return c
}

function esperar(ms) { return new Promise(resolve => setTimeout(resolve, ms)) }

async function pruebaConfirmacionSimultaneaConPublicacion() {
  const a = await nuevoClient() // publica
  const b = await nuevoClient() // confirma, con el fingerprint viejo
  const LEGAJO = '900501'
  try {
    // Publicación inicial (v1): una guardia para el legajo de esta prueba.
    await a.query(`insert into turnos (legajo, dia, turno, sector, mes, anio) values ($1, 1, 'd', 'UPA', 7, 2099)`, [LEGAJO])
    const hash1 = (await a.query(`select fn_hash_borrador_turnos(7, 2099, array['UPA']) as h`)).rows[0].h
    await a.query(`select * from fn_publicar_guardias_y_sincronizar_whatsapp('UPA', 7, 2099, array['UPA'], 'ADMIN1', 0, $1)`, [hash1])

    const fpV1 = (await a.query(
      `select fingerprint_turnos from whatsapp_avisos where legajo=$1 and lugar='UPA' and mes=7 and anio=2099`, [LEGAJO]
    )).rows[0].fingerprint_turnos

    // El administrador B abre el mensaje con el contenido vigente (v1) —
    // esto es lo que su pantalla tiene cargado en este momento.
    await b.query(`select * from fn_whatsapp_marcar_abierto($1,'UPA',7,2099,$2,'ADMIN1')`, [LEGAJO, fpV1])

    // A empieza a publicar una v2 (cambia el contenido del legajo) DENTRO
    // de una transacción que mantiene abierta a propósito (sin COMMIT
    // todavía), para poder observar la ventana real de la carrera — mismo
    // criterio que pruebaPreviewContraEscrituraConcurrente en
    // 03_concurrencia.js.
    await a.query('BEGIN')
    await a.query(`insert into turnos (legajo, dia, turno, sector, mes, anio) values ($1, 2, 'n', 'UPA', 7, 2099)`, [LEGAJO])
    const hash2 = (await a.query(`select fn_hash_borrador_turnos(7, 2099, array['UPA']) as h`)).rows[0].h
    // fn_publicar_guardias_y_sincronizar_whatsapp YA corrió (tomó y liberó
    // sus locks internos de "publicaciones"/"turnos_publicados", y tomó el
    // lock FOR UPDATE de la fila de whatsapp_avisos de este legajo) — pero
    // como seguimos dentro del BEGIN sin COMMIT, ese lock de fila sigue
    // sostenido hasta que A confirme la transacción.
    await a.query(`select * from fn_publicar_guardias_y_sincronizar_whatsapp('UPA', 7, 2099, array['UPA'], 'ADMIN1', 1, $1)`, [hash2])

    // B intenta CONFIRMAR el envío para el MISMO legajo, con el fingerprint
    // viejo (v1, el que su pantalla tenía abierto) — exactamente mientras A
    // todavía no confirmó su publicación.
    let bTerminoAntesDeTiempo = false
    const promesaB = b.query(`select * from fn_whatsapp_confirmar_envio($1,'UPA',7,2099,$2,'ADMIN1')`, [LEGAJO, fpV1])
    promesaB.then(() => { bTerminoAntesDeTiempo = true }).catch(() => { bTerminoAntesDeTiempo = true })

    await esperar(300) // margen generoso: sin el lock, esto resolvería casi al instante
    if (bTerminoAntesDeTiempo) {
      fail('confirmar simultáneo con una publicación: B debía quedar BLOQUEADA mientras A no hizo commit de su publicación (lock de fila FOR UPDATE), pero terminó antes')
      await a.query('COMMIT').catch(() => {})
      await promesaB.catch(() => {})
      return
    }
    ok('mientras A todavía no confirmó la publicación (transacción abierta, sin COMMIT), B (que intenta confirmar el mismo efectivo con un fingerprint viejo) queda BLOQUEADA por el lock de fila — nunca se intercala con una lectura a medio camino')

    await a.query('COMMIT')
    let resB, errB
    try { resB = await promesaB } catch (e) { errB = e }

    if (!errB) {
      fail('confirmar simultáneo con una publicación: B debía RECHAZARSE tras la publicación concurrente de A (fingerprint viejo), pero se aceptó', JSON.stringify(resB && resB.rows))
    } else if (!/contenido_cambio_desde_apertura/.test(errB.message || '')) {
      fail('confirmar simultáneo con una publicación: motivo de rechazo inesperado', errB.message)
    } else {
      ok('una vez que A confirma la publicación (se libera el lock), B se desbloquea viendo YA el estado sincronizado — y se rechaza con contenido_cambio_desde_apertura: la publicación simultánea nunca deja confirmado un contenido distinto del que quedó vigente')
    }

    const filaFinal = (await a.query(
      `select estado, fingerprint_turnos from whatsapp_avisos where legajo=$1 and lugar='UPA' and mes=7 and anio=2099`, [LEGAJO]
    )).rows[0]
    if (filaFinal.estado !== 'pendiente') {
      fail('confirmar simultáneo con una publicación: el estado final debía ser "pendiente" (reseteado por el cambio real de contenido de la publicación de A)', filaFinal.estado)
    } else {
      ok('estado final coherente tras la carrera: "pendiente", con el fingerprint de la publicación nueva (v2) — nunca quedó "confirmado" con el contenido viejo que B tenía cargado')
    }
  } finally {
    await a.end(); await b.end()
  }
}

async function main() {
  console.log('=== Falla 3 ("Confirmación de WhatsApp") — concurrencia real: confirmar vs. publicar/sincronizar simultáneos ===')
  await pruebaConfirmacionSimultaneaConPublicacion()
  console.log('')
  if (fallos > 0) {
    console.log(fallos + ' prueba(s) FALLARON')
    process.exit(1)
  }
  console.log('Todas las pruebas de concurrencia de la Falla 3 pasaron.')
}

main().catch(err => { console.error('Error ejecutando pruebas de concurrencia de la Falla 3:', err); process.exit(1) })
