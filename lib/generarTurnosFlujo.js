// lib/generarTurnosFlujo.js
//
// Punto 1 de esta ronda de revisión ("Detener la regeneración si falla la
// lectura de disponibilidad"): antes, pages/admin.js (generarTurnos) hacía
//
//   const { data: dispFresh } = await fetch(`/api/admin-disponibilidad?...`).then(r => r.json())
//
// sin comprobar nunca `response.ok`, sin capturar un error de red o de
// parseo de JSON, y sin validar que el cuerpo tuviera la forma esperada
// ({ data: [...] }). Cualquiera de esos fallos (por ejemplo, un 500 del
// servidor) deja `dispFresh` en `undefined` — y como el código seguía con
// `(dispFresh || []).forEach(...)`, un ERROR de lectura quedaba
// indistinguible de "no hay ninguna disponibilidad cargada todavía" (un
// resultado perfectamente válido). El algoritmo de asignación corría igual,
// con el mapa de disponibilidad vacío, producía 0 asignaciones, y el código
// terminaba llamando a `reemplazar_scope` con `turnos: []` — pudiendo
// vaciar un borrador anterior real sin que hubiera pasado nada con la
// disponibilidad en sí.
//
// Esta función extrae la ORQUESTACIÓN de generarTurnos() (leer
// disponibilidad con manejo de errores real, decidir si corresponde correr
// el algoritmo y guardar su resultado, o abortar) a una función pura, sin
// React ni JSX, para poder probarla con un test real de JavaScript (no solo
// SQL) que mockee `fetch` — ver tests/node/02_generar_turnos_flujo.js. El
// cálculo de candidatos en sí (el algoritmo de asignación, que esta ronda
// NO debe tocar) se recibe como parámetro (`calcularAsignaciones`): esta
// función nunca lo modifica, nunca lo reimplementa, y nunca decide qué
// turnos asignar — solo decide SI corresponde llamarlo con la disponibilidad
// leída, y SI corresponde guardar su resultado.
//
// Devuelve siempre un objeto { ok, ... }:
//   - { ok: true, nuevos }                                    — se guardó.
//   - { ok: false, motivo }                                   — se abortó
//     por un error de lectura (HTTP, red, JSON o estructura) o por un error
//     al guardar. Nunca se llamó a `reemplazarScope` en el primer caso.
//   - { ok: false, motivo, vacioConBorradorPrevio: true,
//       cantidadBorradorAnterior }                             — la lectura
//     fue válida (incluso si vino vacía) y el algoritmo corrió, pero dio 0
//     asignaciones mientras ya existía un borrador con contenido: no se
//     llamó a `reemplazarScope`, para no vaciarlo automáticamente.
async function ejecutarGeneracionDeTurnos({
  fetchFn,
  mes,
  anio,
  lugar,
  habiaBorrador,
  cantidadBorradorAnterior,
  calcularAsignaciones,
  reemplazarScope,
}) {
  // 1) Leer disponibilidad fresca. Cualquier error —HTTP, de red, de JSON,
  //    o de estructura del cuerpo— aborta ACÁ, antes de calcular o escribir
  //    absolutamente nada.
  let dispFresh
  try {
    let res
    try {
      res = await fetchFn(`/api/admin-disponibilidad?mes=${mes}&anio=${anio}&lugar=${lugar}`)
    } catch (eRed) {
      return { ok: false, motivo: 'error de red leyendo disponibilidad: ' + eRed.message }
    }

    if (!res.ok) {
      let detalle = ''
      try {
        const cuerpoError = await res.json()
        detalle = cuerpoError?.error || ''
      } catch {
        // El cuerpo de un error HTTP no siempre es JSON (puede ser un 502
        // de un proxy, por ejemplo) — eso no debe tirar una excepción sin
        // manejar, simplemente no hay detalle adicional que mostrar.
      }
      return { ok: false, motivo: `la consulta de disponibilidad respondió ${res.status}${detalle ? ': ' + detalle : ''}` }
    }

    let body
    try {
      body = await res.json()
    } catch (eJson) {
      return { ok: false, motivo: 'la respuesta de disponibilidad no es JSON válido: ' + eJson.message }
    }

    if (!body || !Array.isArray(body.data)) {
      return { ok: false, motivo: 'la consulta de disponibilidad no devolvió el formato esperado ({ data: [...] })' }
    }

    dispFresh = body.data
  } catch (eInesperado) {
    // Red de seguridad final: cualquier otra excepción inesperada en este
    // paso también aborta antes de tocar el borrador.
    return { ok: false, motivo: 'error inesperado leyendo disponibilidad: ' + eInesperado.message }
  }

  // 2) Disponibilidad leída con éxito — incluso si vino vacía: un array
  //    vacío es un resultado VÁLIDO ("todavía nadie cargó disponibilidad"),
  //    muy distinto de un error de lectura. Recién acá corre el algoritmo,
  //    sin tocarlo.
  const nuevos = calcularAsignaciones(dispFresh)

  // 3) Si el resultado válido da 0 asignaciones y YA existía un borrador
  //    con contenido para este scope, no lo vaciamos automáticamente.
  if (nuevos.length === 0 && habiaBorrador) {
    return {
      ok: false,
      vacioConBorradorPrevio: true,
      cantidadBorradorAnterior,
      motivo: `el cálculo no generó ninguna asignación con la disponibilidad actual, pero ya había ${cantidadBorradorAnterior} guardia(s) cargada(s)`,
    }
  }

  // 4) Recién ahora —lectura válida, y (resultado no vacío, o resultado
  //    vacío pero sin borrador previo que proteger)— se reemplaza el scope.
  let resultado
  try {
    resultado = await reemplazarScope(nuevos)
  } catch (eGuardado) {
    return { ok: false, motivo: 'error de red guardando: ' + eGuardado.message }
  }
  if (resultado?.error) {
    return { ok: false, motivo: 'error al guardar: ' + resultado.error }
  }
  return { ok: true, nuevos }
}

module.exports = { ejecutarGeneracionDeTurnos }
