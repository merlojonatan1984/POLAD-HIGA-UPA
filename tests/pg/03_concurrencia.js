// tests/pg/03_concurrencia.js
//
// Pruebas de concurrencia REAL: dos conexiones de PostgreSQL separadas,
// disparando al mismo tiempo (Promise.all, sin esperar a que termine la
// primera antes de lanzar la segunda) contra la base de prueba local. No es
// una simulación — es el mismo PostgreSQL 16 real que corre el resto de las
// pruebas, con dos sesiones de verdad compitiendo por el mismo lock.
//
// Requiere: la base polad_test ya creada, con 00_esquema_base_ficticio.sql +
// 0001_borrador_publicacion.sql + 01_seed_ficticio.sql ya aplicados (ver
// README.md). Variable de entorno PGPASSWORD=postgres_test_local (o ajustar
// CONN abajo).

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

async function pruebaDosGuardadosSimultaneos() {
  // Escenario real: dos administradores abren el mismo formulario de
  // disponibilidad (mismo legajo/lugar/mes/año) casi al mismo tiempo. Los
  // dos ven "no hay nada cargado" (dias_antes_esperado={}) y los dos
  // intentan guardar algo distinto, a la vez.
  const a = await nuevoClient()
  const b = await nuevoClient()
  try {
    const sql = `select fn_guardar_disponibilidad_admin($1,$2,$3,$4,$5,$6,$7,$8,$9) as id`
    const paramsA = ['900001', 'HIGA', 11, 2026, JSON.stringify({ '3': 'd' }), 'ADMIN1', 'conc-A', JSON.stringify({}), JSON.stringify([])]
    const paramsB = ['900001', 'HIGA', 11, 2026, JSON.stringify({ '4': 'n' }), 'ADMIN1', 'conc-B', JSON.stringify({}), JSON.stringify([])]

    const [resA, resB] = await Promise.allSettled([
      a.query(sql, paramsA),
      b.query(sql, paramsB),
    ])

    const exitos = [resA, resB].filter(r => r.status === 'fulfilled')
    const rechazos = [resA, resB].filter(r => r.status === 'rejected')

    if (exitos.length !== 1 || rechazos.length !== 1) {
      fail('dos guardados simultáneos: exactamente uno debe ganar y el otro debe rechazarse',
        `éxitos=${exitos.length} rechazos=${rechazos.length}`)
      return
    }
    const mensajeRechazo = rechazos[0].reason.message || ''
    if (!mensajeRechazo.includes('disponibilidad_desactualizada')) {
      fail('dos guardados simultáneos: el rechazo debía ser disponibilidad_desactualizada', mensajeRechazo)
      return
    }
    ok('dos guardados simultáneos sobre el mismo efectivo/lugar/mes/año: uno gana, el otro se rechaza con un aviso claro (no se sobrescribe en silencio)')

    // Confirmar que el estado final es EXACTAMENTE el del que ganó, no una mezcla.
    const verif = await a.query(`select dia, turno from disponibilidad where legajo='900001' and lugar='HIGA' and mes=11 and anio=2026 order by dia`)
    const dias = verif.rows.map(r => `${r.dia}:${r.turno}`).join(',')
    if (dias !== '3:d' && dias !== '4:n') {
      fail('dos guardados simultáneos: el estado final no corresponde limpiamente a uno de los dos intentos', dias)
    } else {
      ok(`el estado final es el del guardado que ganó la carrera (${dias}), no una mezcla de los dos`)
    }
  } finally {
    await a.end(); await b.end()
  }
}

async function pruebaDobleClicPublicar() {
  // Escenario real: el administrador hace doble clic en "Confirmar
  // publicación" (o el navegador reintenta por un corte de red). Las dos
  // llamadas llegan con el MISMO version_base y el MISMO hash del borrador
  // que vio al revisar el resumen.
  //
  // Punto 4 de la revisión: fn_publicar_guardias ya no recibe p_resumen ni
  // p_efectivos_afectados desde afuera (los calcula ella misma) — la firma
  // actual es (lugar, mes, anio, sectores, publicado_por_legajo,
  // version_base, hash_borrador), 7 parámetros, no 9.
  const a = await nuevoClient()
  const b = await nuevoClient()
  try {
    const hashRes = await a.query(
      `select fn_hash_borrador_turnos(11, 2026, array['UPA']) as hash`
    )
    const hash = hashRes.rows[0].hash

    const sql = `select publicacion_id, version from fn_publicar_guardias($1,$2,$3,$4,$5,$6,$7)`
    const params = ['UPA', 11, 2026, ['UPA'], 'ADMIN1', 0, hash]

    const [resA, resB] = await Promise.allSettled([
      a.query(sql, params),
      b.query(sql, params),
    ])

    const exitos = [resA, resB].filter(r => r.status === 'fulfilled')
    const rechazos = [resA, resB].filter(r => r.status === 'rejected')

    if (exitos.length !== 1 || rechazos.length !== 1) {
      fail('doble clic al publicar: exactamente una de las dos llamadas debe publicar', `éxitos=${exitos.length} rechazos=${rechazos.length}`)
      return
    }
    const mensajeRechazo = rechazos[0].reason.message || ''
    if (!mensajeRechazo.includes('publicacion_desactualizada')) {
      fail('doble clic al publicar: el rechazo debía ser publicacion_desactualizada', mensajeRechazo)
      return
    }
    ok('doble clic / reintento al publicar (mismo version_base y hash en las dos llamadas): solo una publica, la otra se rechaza — no se duplica la publicación')

    const count = await a.query(`select count(*)::int as c from publicaciones where lugar='UPA' and mes=11 and anio=2026`)
    if (count.rows[0].c !== 1) {
      fail('doble clic al publicar: debía quedar exactamente una publicación para UPA/11/2026', 'quedaron ' + count.rows[0].c)
    } else {
      ok('queda exactamente una publicación (no dos) para ese lugar/mes/año después del doble clic')
    }
  } finally {
    await a.end(); await b.end()
  }
}

async function pruebaEfectivoContraEfectivo() {
  // Punto 3 de la revisión: dos guardados del PROPIO efectivo (dos
  // pestañas, o un doble envío del botón) sobre el mismo legajo/lugar/
  // mes/año, a la vez — partiendo de que NO había ninguna disponibilidad
  // cargada todavía (dias_antes_esperado={} en las dos).
  const a = await nuevoClient()
  const b = await nuevoClient()
  try {
    const sql = `select fn_guardar_disponibilidad_efectivo($1,$2,$3,$4,$5,$6) as resultado`
    const paramsA = ['900002', 'UPA', 4, 2027, JSON.stringify({ '1': 'd' }), JSON.stringify({})]
    const paramsB = ['900002', 'UPA', 4, 2027, JSON.stringify({ '2': 'n' }), JSON.stringify({})]

    const [resA, resB] = await Promise.allSettled([
      a.query(sql, paramsA),
      b.query(sql, paramsB),
    ])

    const exitos = [resA, resB].filter(r => r.status === 'fulfilled')
    const rechazos = [resA, resB].filter(r => r.status === 'rejected')

    if (exitos.length !== 1 || rechazos.length !== 1) {
      fail('efectivo contra efectivo (disponibilidad inicialmente vacía): exactamente uno debe ganar',
        `éxitos=${exitos.length} rechazos=${rechazos.length}`)
      return
    }
    const mensajeRechazo = rechazos[0].reason.message || ''
    if (!mensajeRechazo.includes('disponibilidad_desactualizada')) {
      fail('efectivo contra efectivo: el rechazo debía ser disponibilidad_desactualizada', mensajeRechazo)
      return
    }
    const verif = await a.query(`select dia, turno from disponibilidad where legajo='900002' and lugar='UPA' and mes=4 and anio=2027 order by dia`)
    const dias = verif.rows.map(r => `${r.dia}:${r.turno}`).join(',')
    if (dias !== '1:d' && dias !== '2:n') {
      fail('efectivo contra efectivo: el estado final no corresponde limpiamente a uno de los dos intentos', dias)
    } else {
      ok(`efectivo contra efectivo, partiendo de disponibilidad vacía: uno gana (${dias}), el otro se rechaza con disponibilidad_desactualizada — ninguno se pisa en silencio`)
    }
  } finally {
    await a.end(); await b.end()
  }
}

async function pruebaEfectivoContraAdministrador() {
  // Punto 3 de la revisión: un efectivo guardando su propia disponibilidad
  // (fn_guardar_disponibilidad_efectivo) y un administrador corrigiéndola
  // fuera de término (fn_guardar_disponibilidad_admin) para el MISMO
  // legajo/lugar/mes/año, a la vez. Antes cada función tenía su propio
  // (o ningún) lock, así que esta carrera no se coordinaba — ahora ambas
  // toman fn_lock_disponibilidad con la misma clave y deben serializarse
  // de verdad: una gana, la otra se rechaza por disponibilidad_desactualizada,
  // nunca las dos quedan "a medias" ni se mezclan.
  const a = await nuevoClient()
  const b = await nuevoClient()
  try {
    const sqlEfectivo = `select fn_guardar_disponibilidad_efectivo($1,$2,$3,$4,$5,$6) as resultado`
    const paramsEfectivo = ['900003', 'HIGA', 5, 2027, JSON.stringify({ '10': 'd' }), JSON.stringify({})]

    const sqlAdmin = `select fn_guardar_disponibilidad_admin($1,$2,$3,$4,$5,$6,$7,$8,$9) as id`
    const paramsAdmin = ['900003', 'HIGA', 5, 2027, JSON.stringify({ '15': 'dn' }), 'ADMIN1', 'corrección simultánea', JSON.stringify({}), JSON.stringify([])]

    const [resEfectivo, resAdmin] = await Promise.allSettled([
      a.query(sqlEfectivo, paramsEfectivo),
      b.query(sqlAdmin, paramsAdmin),
    ])

    const exitos = [resEfectivo, resAdmin].filter(r => r.status === 'fulfilled')
    const rechazos = [resEfectivo, resAdmin].filter(r => r.status === 'rejected')

    if (exitos.length !== 1 || rechazos.length !== 1) {
      fail('efectivo contra administrador (mismo legajo/lugar/mes/año, disponibilidad inicialmente vacía): exactamente uno debe ganar',
        `éxitos=${exitos.length} rechazos=${rechazos.length}`)
      return
    }
    const mensajeRechazo = rechazos[0].reason.message || ''
    if (!mensajeRechazo.includes('disponibilidad_desactualizada')) {
      fail('efectivo contra administrador: el rechazo debía ser disponibilidad_desactualizada', mensajeRechazo)
      return
    }
    const verif = await a.query(`select dia, turno from disponibilidad where legajo='900003' and lugar='HIGA' and mes=5 and anio=2027 order by dia`)
    const dias = verif.rows.map(r => `${r.dia}:${r.turno}`).join(',')
    if (dias !== '10:d' && dias !== '15:dn') {
      fail('efectivo contra administrador: el estado final no corresponde limpiamente a uno de los dos intentos', dias)
    } else {
      const ganador = dias === '10:d' ? 'el guardado del propio efectivo' : 'la corrección administrativa'
      ok(`efectivo contra administrador, mismo recurso y disponibilidad inicialmente vacía: se serializan de verdad (ganó ${ganador}, estado final ${dias}), ninguno pisa al otro en silencio`)
    }
  } finally {
    await a.end(); await b.end()
  }
}

async function pruebaPublicarContraEscrituraDeBorrador() {
  // Punto 5 de la revisión, a nivel de función SQL (todavía sin pasar por
  // un endpoint de Node — eso es tarea aparte, ver pendientes): publicar
  // (fn_publicar_guardias) y escribir el borrador (fn_turnos_borrador_
  // insertar) para el MISMO lugar/mes/año, a la vez, comparten
  // fn_lock_turnos_borrador. Si el lock de verdad los serializa, ninguna de
  // las dos llamadas debería fallar por una condición de carrera — deben
  // ejecutarse una después de la otra (nunca "a la vez" de verdad dentro
  // de la base), y el resultado final tiene que ser consistente con ESO:
  // la guardia nueva queda publicada si se insertó antes de que arrancara
  // la publicación, o si no, el borrador insertado queda ahí para la
  // próxima publicación — nunca una publicación a medias ni una pérdida
  // silenciosa del insert.
  const a = await nuevoClient()
  const b = await nuevoClient()
  try {
    const hashAntes = await a.query(`select fn_hash_borrador_turnos(6, 2027, array['Modular']) as hash`)

    const sqlPublicar = `select publicacion_id, version from fn_publicar_guardias($1,$2,$3,$4,$5,$6,$7)`
    const paramsPublicar = ['MODULAR', 6, 2027, ['Modular'], 'ADMIN1', 0, hashAntes.rows[0].hash]

    const sqlInsertar = `select fn_turnos_borrador_insertar($1,$2,$3,$4) as cantidad`
    const paramsInsertar = ['MODULAR', 6, 2027, JSON.stringify([{ legajo: '900004', dia: 1, turno: 'm', sector: 'Modular' }])]

    const [resPublicar, resInsertar] = await Promise.allSettled([
      a.query(sqlPublicar, paramsPublicar),
      b.query(sqlInsertar, paramsInsertar),
    ])

    if (resInsertar.status === 'rejected') {
      fail('publicar contra escritura de borrador: la inserción no debía fallar (solo debía esperar el lock, no rechazarse)', resInsertar.reason.message)
      return
    }
    // La publicación puede salir con publicacion_desactualizada SOLO si de
    // alguna manera corrió dos veces (no es el caso acá, version_base=0 y
    // es la primera publicación de este scope) — así que tiene que haber
    // tenido éxito.
    if (resPublicar.status === 'rejected') {
      fail('publicar contra escritura de borrador: la publicación no debía fallar', resPublicar.reason.message)
      return
    }

    // Si el insert corrió ANTES de que fn_publicar_guardias leyera "turnos",
    // la guardia nueva quedó publicada en la versión 1. Si corrió DESPUÉS
    // (el lock hizo esperar al insert hasta que la publicación terminara),
    // la guardia queda en el borrador para una futura versión 2, y la
    // versión 1 publicada no la incluye. Ambos son resultados válidos y
    // CONSISTENTES entre sí — lo que no puede pasar es que el insert se
    // haya perdido, o que la publicación haya leído un estado a medias.
    const enBorrador = await a.query(`select count(*)::int as c from turnos where legajo='900004' and mes=6 and anio=2027`)
    if (enBorrador.rows[0].c !== 1) {
      fail('publicar contra escritura de borrador: el insert del borrador se perdió', 'quedaron ' + enBorrador.rows[0].c + ' filas con legajo 900004')
      return
    }
    const pubId = resPublicar.value.rows[0].publicacion_id
    const publicado = await a.query(`select count(*)::int as c from turnos_publicados where publicacion_id=$1 and legajo='900004'`, [pubId])
    const quedoPublicada = publicado.rows[0].c === 1
    ok(`publicar y escribir el borrador al mismo tiempo, mismo lugar/mes/año, se serializan bajo fn_lock_turnos_borrador: ninguna se rechaza por carrera, el insert nunca se pierde, y el resultado es consistente (la guardia nueva ${quedoPublicada ? 'alcanzó a quedar publicada en esta misma versión' : 'quedó en el borrador para la próxima versión'}, no una publicación a medias)`)
  } finally {
    await a.end(); await b.end()
  }
}

function esperar(ms) { return new Promise(resolve => setTimeout(resolve, ms)) }

async function pruebaPreviewContraEscrituraConcurrente() {
  // Punto 1 de ESTA ronda: "Probá una modificación concurrente durante la
  // generación de la vista previa." El preview (fn_resumen_publicacion)
  // toma fn_lock_turnos_borrador ANTES de leer nada, igual que
  // fn_publicar_guardias — así que mientras el preview está "abierto"
  // (dentro de una transacción que todavía no hizo COMMIT), una escritura
  // concurrente del borrador para el MISMO lugar/mes/año tiene que
  // QUEDARSE ESPERANDO, no intercalarse. Se prueba abriendo el preview
  // dentro de un BEGIN explícito (para poder mantenerlo "vivo" mientras se
  // dispara la escritura) y confirmando que la escritura todavía no
  // terminó un rato después, hasta que el preview hace COMMIT.
  const a = await nuevoClient()
  const b = await nuevoClient()
  try {
    await a.query(`insert into turnos (legajo, dia, turno, sector, mes, anio) values ('900040', 1, 'd', 'Giratoria', 8, 2028)`)

    await a.query('BEGIN')
    const previewRes = await a.query(
      `select version_base, hash_borrador, resumen from fn_resumen_publicacion($1,$2,$3,$4)`,
      ['HIGA', 8, 2028, ['Salud Mental', 'Giratoria', 'Llaves', 'Guardia', 'Estacionamiento', 'Rondin Externo']]
    )

    const sqlInsertar = `select fn_turnos_borrador_insertar($1,$2,$3,$4) as cantidad`
    const paramsInsertar = ['HIGA', 8, 2028, JSON.stringify([{ legajo: '900041', dia: 2, turno: 'd', sector: 'Giratoria' }])]
    let bTerminoAntesDeTiempo = false
    const promesaB = b.query(sqlInsertar, paramsInsertar)
    promesaB.then(() => { bTerminoAntesDeTiempo = true }).catch(() => { bTerminoAntesDeTiempo = true })

    await esperar(300) // margen generoso: un insert trivial sin lock tardaría <<300ms
    if (bTerminoAntesDeTiempo) {
      fail('preview contra escritura concurrente: la escritura del borrador debía quedar BLOQUEADA mientras el preview sigue abierto (sin COMMIT), pero terminó antes')
      await a.query('COMMIT').catch(() => {})
      await promesaB.catch(() => {})
      return
    }
    ok('mientras el preview (fn_resumen_publicacion) está abierto, sin COMMIT, una escritura concurrente del borrador para el mismo lugar/mes/año queda bloqueada (no se intercala)')

    await a.query('COMMIT')
    await promesaB // ahora sí tiene que completarse

    const totalEnPreview = parseInt(previewRes.rows[0].resumen.total_turnos_actuales)
    if (totalEnPreview !== 1) {
      fail('preview contra escritura concurrente: el resumen del preview debía reflejar el estado ANTES de la escritura concurrente (1 turno)', 'vio ' + totalEnPreview)
    } else {
      ok('el resumen que devolvió el preview (total_turnos_actuales=1) corresponde al estado de ANTES de la escritura concurrente, no a una mezcla con lo que insertó la otra sesión')
    }

    // Y lo que de verdad importa para el punto 1: si ahora se intenta
    // confirmar la publicación con el version_base/hash_borrador que vio
    // ESE preview, tiene que rechazarse — el borrador real ya cambió (la
    // escritura de la otra sesión se sumó después) — nunca se publica algo
    // distinto de lo que el preview mostró.
    let rechazadoPorDesactualizado = false
    try {
      await a.query(
        `select publicacion_id from fn_publicar_guardias($1,$2,$3,$4,$5,$6,$7)`,
        ['HIGA', 8, 2028, ['Salud Mental', 'Giratoria', 'Llaves', 'Guardia', 'Estacionamiento', 'Rondin Externo'], 'ADMIN1',
         previewRes.rows[0].version_base, previewRes.rows[0].hash_borrador]
      )
    } catch (err) {
      rechazadoPorDesactualizado = (err.message || '').includes('borrador_desactualizado')
    }
    if (!rechazadoPorDesactualizado) {
      fail('preview contra escritura concurrente: publicar con el hash del preview viejo debía rechazarse con borrador_desactualizado')
    } else {
      ok('confirmar la publicación con el version_base/hash_borrador de ESE preview, después de la escritura concurrente, se rechaza con borrador_desactualizado — nunca se publica algo distinto de lo revisado')
    }
  } finally {
    await a.query('ROLLBACK').catch(() => {})
    await a.query(`delete from turnos where legajo in ('900040','900041') and mes=8 and anio=2028`).catch(() => {})
    await a.end(); await b.end()
  }
}

async function pruebaReemplazarScopeContraPublicacionConcurrente() {
  // Punto 2 de ESTA ronda: "no debe existir un estado intermedio vacío que
  // otra sesión pueda publicar" + "probá ... una publicación concurrente".
  //
  // Fase 1: fn_turnos_borrador_reemplazar_scope (borra 1 fila vieja e
  // inserta 2 filas nuevas, en una sola transacción) corriendo a la vez que
  // OTRA sesión calcula el resumen de publicación (fn_resumen_publicacion —
  // la misma función que usa fn_publicar_guardias para decidir qué hay).
  // Como las dos toman el mismo lock, tienen que serializarse por
  // completo: la otra sesión tiene que ver SIEMPRE el estado completo de
  // antes (1 turno) o el estado completo de después (2 turnos) — nunca 0
  // (el hueco vacío que habría entre el borrado y la inserción si fueran
  // dos pasos separados, como antes de esta corrección).
  const a = await nuevoClient()
  const b = await nuevoClient()
  try {
    await a.query(`delete from turnos where mes=10 and anio=2028 and sector='Modular'`)
    await a.query(`insert into turnos (legajo, dia, turno, sector, mes, anio) values ('900050', 1, 'm', 'Modular', 10, 2028)`)

    const sqlReemplazar = `select fn_turnos_borrador_reemplazar_scope($1,$2,$3,$4,$5) as cantidad`
    const paramsReemplazar = ['MODULAR', 10, 2028, ['Modular'],
      JSON.stringify([{ legajo: '900051', dia: 2, turno: 't', sector: 'Modular' }, { legajo: '900052', dia: 3, turno: 'n', sector: 'Modular' }])]

    const sqlResumen = `select resumen from fn_resumen_publicacion($1,$2,$3,$4)`
    const paramsResumen = ['MODULAR', 10, 2028, ['Modular']]

    const [resReemplazar, resResumen] = await Promise.allSettled([
      a.query(sqlReemplazar, paramsReemplazar),
      b.query(sqlResumen, paramsResumen),
    ])

    if (resReemplazar.status === 'rejected') {
      fail('reemplazar_scope contra resumen concurrente: el reemplazo no debía fallar', resReemplazar.reason.message)
      return
    }
    if (resResumen.status === 'rejected') {
      fail('reemplazar_scope contra resumen concurrente: el cálculo del resumen no debía fallar', resResumen.reason.message)
      return
    }
    const totalVisto = parseInt(resResumen.value.rows[0].resumen.total_turnos_actuales)
    if (totalVisto !== 1 && totalVisto !== 2) {
      fail('reemplazar_scope contra resumen concurrente: el resumen vio un estado intermedio (ni el completo de antes, ni el completo de después) — hueco vacío real', 'vio ' + totalVisto)
    } else {
      ok(`fn_turnos_borrador_reemplazar_scope contra un resumen/preview concurrente del mismo scope: se serializan bajo el lock — el resumen vio el estado completo de ${totalVisto === 1 ? 'ANTES (1 turno)' : 'DESPUÉS (2 turnos)'} del reemplazo, nunca un hueco vacío intermedio`)
    }

    // Fase 2: ahora sí, una PUBLICACIÓN real (no solo un resumen) a la vez
    // que otro reemplazo. version_base=0 porque este scope todavía no tiene
    // ninguna publicación vigente en ningún escenario de esta prueba.
    const hashPrevio = await a.query(`select fn_hash_borrador_turnos(10, 2028, array['Modular']) as hash`)
    const sqlReemplazar2 = `select fn_turnos_borrador_reemplazar_scope($1,$2,$3,$4,$5) as cantidad`
    const paramsReemplazar2 = ['MODULAR', 10, 2028, ['Modular'],
      JSON.stringify([{ legajo: '900053', dia: 4, turno: 'm', sector: 'Modular' }])]
    const sqlPublicar = `select publicacion_id from fn_publicar_guardias($1,$2,$3,$4,$5,$6,$7)`
    const paramsPublicar = ['MODULAR', 10, 2028, ['Modular'], 'ADMIN1', 0, hashPrevio.rows[0].hash]

    const [resReemplazar2, resPublicar] = await Promise.allSettled([
      a.query(sqlReemplazar2, paramsReemplazar2),
      b.query(sqlPublicar, paramsPublicar),
    ])

    if (resReemplazar2.status === 'rejected') {
      fail('reemplazar_scope contra publicación concurrente: el reemplazo no debía fallar nunca (solo la publicación puede rechazarse por desactualización)', resReemplazar2.reason.message)
      return
    }
    // La publicación puede salir bien (si corrió ANTES del segundo
    // reemplazo) o rechazarse con borrador_desactualizado (si corrió
    // DESPUÉS, porque el hash que tenía ya no es el real) — las dos son
    // resultados válidos. Cualquier OTRO error es un fallo real.
    if (resPublicar.status === 'rejected' && !(resPublicar.reason.message || '').includes('borrador_desactualizado')) {
      fail('reemplazar_scope contra publicación concurrente: la publicación falló por un motivo distinto a borrador_desactualizado', resPublicar.reason.message)
      return
    }

    const borradorFinal = await a.query(`select count(*)::int as c from turnos where mes=10 and anio=2028 and sector='Modular'`)
    if (borradorFinal.rows[0].c !== 1) {
      fail('reemplazar_scope contra publicación concurrente: el borrador final debía quedar con exactamente 1 fila (la del segundo reemplazo)', 'quedaron ' + borradorFinal.rows[0].c)
      return
    }
    if (resPublicar.status === 'fulfilled') {
      const pubId = resPublicar.value.rows[0].publicacion_id
      const publicadas = await a.query(`select count(*)::int as c from turnos_publicados where publicacion_id=$1`, [pubId])
      // Tiene que ser el conjunto COMPLETO de antes (2 filas) o el completo
      // de después (1 fila) — nunca una mezcla ni 0.
      if (publicadas.rows[0].c !== 1 && publicadas.rows[0].c !== 2) {
        fail('reemplazar_scope contra publicación concurrente: la publicación copió un conjunto que no es ni el completo de antes ni el completo de después', 'copió ' + publicadas.rows[0].c)
        return
      }
    }
    ok('fn_turnos_borrador_reemplazar_scope contra una publicación real concurrente: nunca falla por carrera, el borrador final es siempre el conjunto completo del último reemplazo (nunca a medias), y si la publicación llega a tener éxito copia siempre un conjunto completo (nunca una mezcla ni un hueco vacío)')
  } finally {
    await a.query(`delete from turnos where mes=10 and anio=2028 and sector='Modular'`).catch(() => {})
    await a.query(`delete from turnos_publicados where mes=10 and anio=2028 and lugar='MODULAR'`).catch(() => {})
    await a.query(`delete from publicaciones where lugar='MODULAR' and mes=10 and anio=2028`).catch(() => {})
    await a.end(); await b.end()
  }
}

async function pruebaRenombrarLegajoContraPublicacion() {
  // Punto 3 de ESTA ronda: "probá renombrado y publicación simultáneos".
  // Antes, fn_turnos_borrador_renombrar_legajo usaba un lock PROPIO, sin
  // relación con fn_lock_turnos_borrador — así que un renombrado y una
  // publicación del mismo lugar/mes/año no se coordinaban entre sí. Ahora
  // comparten el mismo lock (por cada mes/año afectado). Si de verdad se
  // serializan, lo que nunca puede pasar es que la publicación copie una
  // MEZCLA (algunas filas con el legajo viejo, otras ya con el nuevo) de
  // un mismo legajo que se estaba renombrando a la vez.
  const a = await nuevoClient()
  const b = await nuevoClient()
  try {
    await a.query(`delete from turnos where mes=11 and anio=2028 and sector='UPA'`)
    await a.query(`insert into turnos (legajo, dia, turno, sector, mes, anio) values
      ('900060', 1, 'd', 'UPA', 11, 2028), ('900060', 2, 'n', 'UPA', 11, 2028)`)

    const hashPrevio = await a.query(`select fn_hash_borrador_turnos(11, 2028, array['UPA']) as hash`)

    const sqlRenombrar = `select fn_turnos_borrador_renombrar_legajo($1,$2,$3) as cantidad`
    const paramsRenombrar = ['UPA', '900060', '900061']

    const sqlPublicar = `select publicacion_id from fn_publicar_guardias($1,$2,$3,$4,$5,$6,$7)`
    const paramsPublicar = ['UPA', 11, 2028, ['UPA'], 'ADMIN1', 0, hashPrevio.rows[0].hash]

    const [resRenombrar, resPublicar] = await Promise.allSettled([
      a.query(sqlRenombrar, paramsRenombrar),
      b.query(sqlPublicar, paramsPublicar),
    ])

    if (resRenombrar.status === 'rejected') {
      fail('renombrar_legajo contra publicación concurrente: el renombrado no debía fallar nunca', resRenombrar.reason.message)
      return
    }
    if (resPublicar.status === 'rejected' && !(resPublicar.reason.message || '').includes('borrador_desactualizado')) {
      fail('renombrar_legajo contra publicación concurrente: la publicación falló por un motivo distinto a borrador_desactualizado', resPublicar.reason.message)
      return
    }

    const borradorViejo = await a.query(`select count(*)::int as c from turnos where legajo='900060' and mes=11 and anio=2028`)
    const borradorNuevo = await a.query(`select count(*)::int as c from turnos where legajo='900061' and mes=11 and anio=2028`)
    if (borradorViejo.rows[0].c !== 0 || borradorNuevo.rows[0].c !== 2) {
      fail('renombrar_legajo contra publicación concurrente: el borrador final no quedó completamente renombrado (quedó a medias)',
        `viejo=${borradorViejo.rows[0].c} nuevo=${borradorNuevo.rows[0].c}`)
      return
    }

    if (resPublicar.status === 'fulfilled') {
      const pubId = resPublicar.value.rows[0].publicacion_id
      const conLegajoViejo = await a.query(`select count(*)::int as c from turnos_publicados where publicacion_id=$1 and legajo='900060'`, [pubId])
      const conLegajoNuevo = await a.query(`select count(*)::int as c from turnos_publicados where publicacion_id=$1 and legajo='900061'`, [pubId])
      // Tiene que ser TODO con el legajo viejo (si publicó antes de que
      // corriera el renombrado) o TODO con el legajo nuevo (si publicó
      // después) — nunca una fila con cada uno (eso sería la publicación
      // copiando un estado a medio renombrar).
      const mezclado = conLegajoViejo.rows[0].c > 0 && conLegajoNuevo.rows[0].c > 0
      if (mezclado) {
        fail('renombrar_legajo contra publicación concurrente: la publicación copió una MEZCLA de legajo viejo y nuevo para el mismo renombrado', `viejo=${conLegajoViejo.rows[0].c} nuevo=${conLegajoNuevo.rows[0].c}`)
        return
      }
    }
    ok('renombrar_legajo y publicar al mismo tiempo, mismo lugar/mes/año: se serializan bajo el lock compartido — el borrador final queda completamente renombrado (nunca a medias) y, si la publicación tiene éxito, copia el legajo viejo O el nuevo para las dos filas, nunca una mezcla')
  } finally {
    await a.query(`delete from turnos where mes=11 and anio=2028 and sector='UPA'`).catch(() => {})
    await a.query(`delete from turnos_publicados where mes=11 and anio=2028 and lugar='UPA'`).catch(() => {})
    await a.query(`delete from publicaciones where lugar='UPA' and mes=11 and anio=2028`).catch(() => {})
    await a.end(); await b.end()
  }
}

async function pruebaDosEdicionesConcurrentesDelMismoEfectivo() {
  // Punto 2 de la ronda siguiente ("Completar la coherencia del cambio de
  // legajo"), requisito explícito: "Dos ediciones concurrentes del mismo
  // efectivo: no deben dejar turnos o relaciones bajo un legajo
  // intermedio." Dos sesiones de administrador (o dos pestañas) editan el
  // MISMO efectivo (mismo id) al mismo tiempo, cada una con un legajo
  // nuevo distinto, las dos partiendo del mismo legajo "viejo" que vieron
  // al abrir el formulario. Sin el `for update` de fn_admin_guardar_efectivo
  // (ver supabase/migrations/0001_borrador_publicacion.sql), la segunda
  // transacción podía leer una foto vieja del legajo (de antes de que la
  // primera terminara) y renombrar turnos/relaciones buscando un legajo
  // que, para cuando de verdad corre el UPDATE, ya no existe más como tal
  // — dejando turnos repartidos entre el legajo viejo, el intermedio (el
  // que puso la primera edición) y el nuevo. Con el lock de fila, las dos
  // se serializan y cada una relee el legajo YA actualizado por la
  // anterior, así que el resultado final tiene que ser SIEMPRE consistente
  // en TODAS las relaciones (turnos, disponibilidad, asistencia,
  // planilla_manual) con el legajo final del efectivo — nunca una mezcla.
  const a = await nuevoClient()
  const b = await nuevoClient()
  try {
    const insEf = await a.query(`insert into efectivos (legajo, nombre, lugar, es_admin) values ('900065','Prueba Concurrencia','HIGA',false) returning id`)
    const id = insEf.rows[0].id

    await a.query(`insert into turnos (legajo, dia, turno, sector, mes, anio) values ('900065',10,'d','Guardia',12,2026), ('900065',11,'n','Guardia',12,2026)`)
    await a.query(`insert into disponibilidad (legajo, dia, turno, mes, anio, lugar) values ('900065',10,'d',12,2026,'HIGA')`)
    await a.query(`insert into asistencia (legajo, mes, anio, dia, turno, lugar) values ('900065',12,2026,10,'d','HIGA')`)
    await a.query(`insert into planilla_manual (legajo, mes, anio, dia, horario, horas, lugar) values ('900065',12,2026,10,'08-20',12,'HIGA')`)

    const sql = `select r.legajo from fn_admin_guardar_efectivo($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) r`
    const paramsA = ['HIGA', id, '900066', 'Prueba Concurrencia', 'Enfermero', '', 'Sin asignar', '', null, null, null, null]
    const paramsB = ['HIGA', id, '900067', 'Prueba Concurrencia', 'Enfermero', '', 'Sin asignar', '', null, null, null, null]

    const [resA, resB] = await Promise.allSettled([
      a.query(sql, paramsA),
      b.query(sql, paramsB),
    ])

    if (resA.status === 'rejected' || resB.status === 'rejected') {
      fail('dos ediciones concurrentes del mismo efectivo no debían fallar (legajos nuevos distintos, sin colisión)',
        (resA.reason || resB.reason || {}).message)
      return
    }

    const final = await a.query(`select legajo from efectivos where id=$1`, [id])
    const legajoFinal = final.rows[0].legajo
    if (!['900066', '900067'].includes(legajoFinal)) {
      fail('el legajo final del efectivo no es ninguno de los dos legajos pedidos — quedó en un valor intermedio', legajoFinal)
      return
    }

    const chequeos = [
      ['turnos', `select count(*)::int as c from turnos where legajo=$1 and mes=12 and anio=2026`],
      ['disponibilidad', `select count(*)::int as c from disponibilidad where legajo=$1 and lugar='HIGA' and mes=12 and anio=2026`],
      ['asistencia', `select count(*)::int as c from asistencia where legajo=$1 and lugar='HIGA' and mes=12 and anio=2026`],
      ['planilla_manual', `select count(*)::int as c from planilla_manual where legajo=$1 and lugar='HIGA' and mes=12 and anio=2026`],
    ]
    let huboMezcla = false
    for (const [nombreTabla, sqlCheck] of chequeos) {
      const conFinal = await a.query(sqlCheck, [legajoFinal])
      const conViejo = await a.query(sqlCheck, ['900065'])
      const otroNuevo = legajoFinal === '900066' ? '900067' : '900066'
      const conOtro = await a.query(sqlCheck, [otroNuevo])
      if (conFinal.rows[0].c === 0 || conViejo.rows[0].c !== 0 || conOtro.rows[0].c !== 0) {
        fail(`${nombreTabla} quedó repartida entre distintos legajos tras dos ediciones concurrentes (debía estar TODA bajo el legajo final)`,
          `final(${legajoFinal})=${conFinal.rows[0].c} viejo(900065)=${conViejo.rows[0].c} otro(${otroNuevo})=${conOtro.rows[0].c}`)
        huboMezcla = true
      }
    }
    if (huboMezcla) return

    ok(`dos ediciones concurrentes del mismo efectivo (dos legajos nuevos distintos): se serializan bajo el lock de fila (FOR UPDATE) de fn_admin_guardar_efectivo — el efectivo y TODAS sus relaciones (turnos, disponibilidad, asistencia, planilla_manual) terminan consistentes en el legajo final (${legajoFinal}), nunca repartidas entre el legajo viejo, el intermedio y el nuevo`)
  } finally {
    await a.query(`delete from turnos where legajo in ('900065','900066','900067')`).catch(() => {})
    await a.query(`delete from disponibilidad where legajo in ('900065','900066','900067')`).catch(() => {})
    await a.query(`delete from asistencia where legajo in ('900065','900066','900067')`).catch(() => {})
    await a.query(`delete from planilla_manual where legajo in ('900065','900066','900067')`).catch(() => {})
    await a.query(`delete from efectivos where legajo in ('900065','900066','900067') and lugar='HIGA'`).catch(() => {})
    await a.end(); await b.end()
  }
}

async function main() {
  console.log('=== Concurrencia real (dos conexiones PostgreSQL simultáneas) ===')
  await pruebaDosGuardadosSimultaneos()
  await pruebaDobleClicPublicar()
  await pruebaEfectivoContraEfectivo()
  await pruebaEfectivoContraAdministrador()
  await pruebaPublicarContraEscrituraDeBorrador()
  await pruebaPreviewContraEscrituraConcurrente()
  await pruebaReemplazarScopeContraPublicacionConcurrente()
  await pruebaRenombrarLegajoContraPublicacion()
  await pruebaDosEdicionesConcurrentesDelMismoEfectivo()
  console.log('')
  if (fallos > 0) {
    console.log(fallos + ' prueba(s) de concurrencia FALLARON')
    process.exit(1)
  }
  console.log('Todas las pruebas de concurrencia real pasaron.')
}

main().catch(err => { console.error('Error ejecutando pruebas de concurrencia:', err); process.exit(1) })
