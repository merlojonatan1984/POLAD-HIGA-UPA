// tests/node/02_generar_turnos_flujo.js
//
// Punto 1 de esta ronda de revisión ("Detener la regeneración si falla la
// lectura de disponibilidad"): prueba REAL del flujo de JavaScript que usa
// pages/admin.js (generarTurnos), no una prueba SQL — exactamente lo que se
// pidió ("No alcanza una prueba SQL"). Ejercita la función real exportada
// por lib/generarTurnosFlujo.js (la misma que importa y llama
// pages/admin.js) con un `fetch` mockeado, sin red, sin DOM, sin React.
//
// Corre con: node tests/node/02_generar_turnos_flujo.js

// lib/generarTurnosFlujo.js usa module.exports (CommonJS), igual que
// lib/tiempoArgentina.js — así que, igual que tests/node/01_tiempo_argentina.js,
// esta prueba lo carga con require() directo, sin levantar Next ni ningún
// transpilador.
const { ejecutarGeneracionDeTurnos } = require('../../lib/generarTurnosFlujo')

let totalOk = 0
function ok(cond, msg) {
  if (!cond) { console.error('FALLO: ' + msg); process.exit(1) }
  console.log('  ok  — ' + msg)
  totalOk++
}

function respuestaJson(status, cuerpo) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => cuerpo,
  }
}

function respuestaJsonInvalido(status) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => { throw new SyntaxError('Unexpected token < in JSON') },
  }
}

async function main() {
  console.log('=== Flujo real de generarTurnos() (mockeando fetch, sin SQL) ===')

  // ---------------------------------------------------------------------
  // 1) Lectura con error HTTP (500) — el caso exacto reportado: antes,
  //    esto terminaba llamando a reemplazar_scope con turnos: [].
  // ---------------------------------------------------------------------
  {
    let calculoLlamado = false
    let reemplazoLlamado = false
    const resultado = await ejecutarGeneracionDeTurnos({
      fetchFn: async () => respuestaJson(500, { error: 'boom interno' }),
      mes: 11, anio: 2026, lugar: 'HIGA',
      habiaBorrador: true, cantidadBorradorAnterior: 40,
      calcularAsignaciones: () => { calculoLlamado = true; return [] },
      reemplazarScope: async (turnos) => { reemplazoLlamado = true; return { ok: true } },
    })
    ok(resultado.ok === false, 'un 500 de /api/admin-disponibilidad se reporta como fallo (ok:false)')
    ok(!calculoLlamado, 'un 500 de disponibilidad NUNCA llega a correr el algoritmo de asignación')
    ok(!reemplazoLlamado, 'un 500 de disponibilidad NUNCA llega a llamar a reemplazar_scope — el caso reportado')
    ok(resultado.motivo.includes('500') && resultado.motivo.includes('boom interno'), 'el motivo del fallo incluye el status HTTP y el detalle del error')
  }

  // ---------------------------------------------------------------------
  // 2) Error de red (fetch rechaza la promesa).
  // ---------------------------------------------------------------------
  {
    let reemplazoLlamado = false
    const resultado = await ejecutarGeneracionDeTurnos({
      fetchFn: async () => { throw new Error('getaddrinfo ENOTFOUND') },
      mes: 11, anio: 2026, lugar: 'HIGA',
      habiaBorrador: true, cantidadBorradorAnterior: 40,
      calcularAsignaciones: () => { throw new Error('no debería llamarse') },
      reemplazarScope: async () => { reemplazoLlamado = true; return { ok: true } },
    })
    ok(resultado.ok === false, 'un error de red se reporta como fallo')
    ok(!reemplazoLlamado, 'un error de red NUNCA llega a llamar a reemplazar_scope')
  }

  // ---------------------------------------------------------------------
  // 3) Respuesta 200 pero con un cuerpo que no es JSON válido.
  // ---------------------------------------------------------------------
  {
    let reemplazoLlamado = false
    const resultado = await ejecutarGeneracionDeTurnos({
      fetchFn: async () => respuestaJsonInvalido(200),
      mes: 11, anio: 2026, lugar: 'HIGA',
      habiaBorrador: false, cantidadBorradorAnterior: 0,
      calcularAsignaciones: () => { throw new Error('no debería llamarse') },
      reemplazarScope: async () => { reemplazoLlamado = true; return { ok: true } },
    })
    ok(resultado.ok === false, 'un cuerpo 200 que no es JSON válido se reporta como fallo')
    ok(!reemplazoLlamado, 'un JSON inválido NUNCA llega a llamar a reemplazar_scope')
  }

  // ---------------------------------------------------------------------
  // 4) Respuesta 200, JSON válido, pero sin la forma esperada ({ data: [] }).
  // ---------------------------------------------------------------------
  {
    let reemplazoLlamado = false
    const resultado = await ejecutarGeneracionDeTurnos({
      fetchFn: async () => respuestaJson(200, { algoDistinto: true }),
      mes: 11, anio: 2026, lugar: 'HIGA',
      habiaBorrador: false, cantidadBorradorAnterior: 0,
      calcularAsignaciones: () => { throw new Error('no debería llamarse') },
      reemplazarScope: async () => { reemplazoLlamado = true; return { ok: true } },
    })
    ok(resultado.ok === false, 'un JSON válido sin el campo "data" (estructura inesperada) se reporta como fallo')
    ok(!reemplazoLlamado, 'una estructura inesperada NUNCA llega a llamar a reemplazar_scope')
  }

  // ---------------------------------------------------------------------
  // 5) Lectura válida, disponibilidad REALMENTE vacía (array vacío), SIN
  //    borrador previo — esto es un resultado válido, no un error: debe
  //    seguir de largo y guardar (0 asignaciones es lo correcto en ese
  //    caso, no hay nada que proteger).
  // ---------------------------------------------------------------------
  {
    let calculoLlamadoConData = null
    let reemplazoLlamadoCon = null
    const resultado = await ejecutarGeneracionDeTurnos({
      fetchFn: async () => respuestaJson(200, { data: [] }),
      mes: 11, anio: 2026, lugar: 'HIGA',
      habiaBorrador: false, cantidadBorradorAnterior: 0,
      calcularAsignaciones: (dispFresh) => { calculoLlamadoConData = dispFresh; return [] },
      reemplazarScope: async (turnos) => { reemplazoLlamadoCon = turnos; return { ok: true } },
    })
    ok(resultado.ok === true, 'disponibilidad vacía pero leída con éxito, sin borrador previo, se guarda con normalidad (no es un error)')
    ok(Array.isArray(calculoLlamadoConData) && calculoLlamadoConData.length === 0, 'el algoritmo recibe el array vacío real, no undefined')
    ok(Array.isArray(reemplazoLlamadoCon) && reemplazoLlamadoCon.length === 0, 'se llama a reemplazar_scope con el lote vacío real (0 asignaciones es el resultado correcto en este caso)')
  }

  // ---------------------------------------------------------------------
  // 6) Lectura válida, el algoritmo da 0 asignaciones, pero YA HABÍA un
  //    borrador con contenido — el caso pedido explícitamente: no se debe
  //    vaciar automáticamente.
  // ---------------------------------------------------------------------
  {
    let reemplazoLlamado = false
    const resultado = await ejecutarGeneracionDeTurnos({
      fetchFn: async () => respuestaJson(200, { data: [{ legajo: '900001', dia: 1, turno: 'd' }] }),
      mes: 11, anio: 2026, lugar: 'HIGA',
      habiaBorrador: true, cantidadBorradorAnterior: 55,
      calcularAsignaciones: () => [], // el algoritmo (sin tocar) decide que no hay nada para asignar
      reemplazarScope: async () => { reemplazoLlamado = true; return { ok: true } },
    })
    ok(resultado.ok === false, '0 asignaciones con un borrador previo de 55 guardias se reporta como fallo (no se guarda)')
    ok(resultado.vacioConBorradorPrevio === true, 'se marca explícitamente como "resultado vacío con borrador previo", distinto de un error de lectura')
    ok(resultado.cantidadBorradorAnterior === 55, 'se informa cuántas guardias tenía el borrador que se conservó')
    ok(!reemplazoLlamado, 'NUNCA se llama a reemplazar_scope cuando el resultado da 0 con un borrador previo — el borrador no se vacía automáticamente')
  }

  // ---------------------------------------------------------------------
  // 7) Camino feliz completo: lectura válida, el algoritmo da varias
  //    asignaciones, se guardan.
  // ---------------------------------------------------------------------
  {
    let reemplazoLlamadoCon = null
    const resultado = await ejecutarGeneracionDeTurnos({
      fetchFn: async () => respuestaJson(200, { data: [{ legajo: '900001', dia: 1, turno: 'd' }] }),
      mes: 11, anio: 2026, lugar: 'HIGA',
      habiaBorrador: true, cantidadBorradorAnterior: 55,
      calcularAsignaciones: (dispFresh) => dispFresh.map(d => ({ legajo: d.legajo, dia: d.dia, turno: d.turno, sector: 'Guardia' })),
      reemplazarScope: async (turnos) => { reemplazoLlamadoCon = turnos; return { ok: true } },
    })
    ok(resultado.ok === true, 'camino feliz: se reporta éxito')
    ok(resultado.nuevos.length === 1, 'el resultado devuelve exactamente lo que calculó el algoritmo')
    ok(Array.isArray(reemplazoLlamadoCon) && reemplazoLlamadoCon.length === 1, 'se llama a reemplazar_scope con el lote calculado')
  }

  // ---------------------------------------------------------------------
  // 8) El guardado en sí (reemplazar_scope) falla — también debe
  //    reportarse como error, sin romper nada en el proceso.
  // ---------------------------------------------------------------------
  {
    const resultado = await ejecutarGeneracionDeTurnos({
      fetchFn: async () => respuestaJson(200, { data: [{ legajo: '900001', dia: 1, turno: 'd' }] }),
      mes: 11, anio: 2026, lugar: 'HIGA',
      habiaBorrador: false, cantidadBorradorAnterior: 0,
      calcularAsignaciones: (d) => d.map(x => ({ legajo: x.legajo, dia: x.dia, turno: x.turno, sector: 'Guardia' })),
      reemplazarScope: async () => ({ error: 'sector_invalido' }),
    })
    ok(resultado.ok === false, 'si reemplazar_scope devuelve error, se reporta como fallo')
    ok(resultado.motivo.includes('sector_invalido'), 'el motivo incluye el error real devuelto por el servidor')
  }

  console.log('')
  console.log(`=== TODAS LAS PRUEBAS DEL FLUJO REAL DE generarTurnos() (${totalOk}) PASARON ===`)
}

main().catch(e => { console.error('FALLO INESPERADO:', e); process.exit(1) })
