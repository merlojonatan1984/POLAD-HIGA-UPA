// lib/completarDia.js
//
// Cálculo del botón "⚡ Completar día" (antes 100% dentro de pages/admin.js,
// función rellenarDiaAuto). Se extrajo con el mismo patrón que
// lib/asignacionRapidaFlujo.js: sin React, sin fetch, `require()`-able desde
// un test de Node real (tests/node/06_completar_dia.js), para probar la LÓGICA
// REAL que corre la pantalla — no una reimplementación aparte.
//
// Rellena los lugares libres de UN día con los efectivos disponibles,
// priorizando a los que tienen MENOS horas en el mes. Nunca:
//   - pasa del tope de 180hs;
//   - pasa la cantidad configurada por administración (efectivo_objetivo:
//     "cantidad fija" de Asignación rápida o la ficha del efectivo) — falla
//     reportada en UPA: "le puse tres y terminó con cuatro", porque este
//     botón completaba el día con quien tuviera menos horas aunque ya
//     hubiera llegado a su número;
//   - rompe el descanso de 12hs (HIGA/UPA);
//   - pone a alguien con puesto fijo en otro sector (o en otro turno, si lo
//     tiene configurado a turno específico).
//
// Pedido de esta ronda ("¿el de asignación por día tiene esa cualidad
// también?" — en referencia al tope de 180hs combinado entre los tres
// lugares y al cruce de horario real entre destinos, que ya respetan
// "Asignación rápida" y "Regenerar turnos" desde lib/asignacionRapidaFlujo.js):
// este cálculo miraba SOLO los turnos de este lugar — nunca se enteraba de
// guardias que el efectivo ya tenía en los otros dos destinos. Ahora recibe
// también esas guardias (`turnosOtrosLugares`, mismo parámetro y mismo
// criterio que ya usa calcularAsignacionRapida) y:
//   - suma esas horas al tope de 180hs (combinado entre los tres lugares,
//     no solo este);
//   - descarta un día/turno que se superpone en horario real con una
//     guardia ya cargada en otro destino (nunca se fuerza);
//   - informa, en el desglose de "por qué no se cubrió", cuántos candidatos
//     se descartaron puntualmente por ese cruce — nunca en silencio.

const { resolverObjetivoGuardias } = require('./objetivosEfectivos')

function calcularCompletarDia({
  dia,
  mes,
  anio,
  lugar,                 // 'HIGA' | 'UPA' | 'MODULAR'
  sectores,              // SECTORES_POR_LUGAR[lugar]
  turnosLugar,           // ['d','n'] o ['m','t','n']
  horasTurno,            // 12 (HIGA/UPA) u 8 (MODULAR)
  efectivos = [],        // [{ legajo, ... }] del lugar
  dispDia = [],          // filas de admin-disponibilidad de ESE día ({ legajo, turno })
  turnosMes = [],        // filas de admin-turnos del mes ({ legajo, dia, turno, sector })
  reglasPuesto = [],     // filas de admin-reglas-puesto ({ legajo, sector, turno })
  reglasObjetivo = [],   // filas de admin-reglas-objetivo ({ legajo, tipo, cantidad })
  turnosOtrosLugares = [], // filas de turnos (scope=todas) de los OTROS dos lugares, ya filtradas a los legajos de este lugar
  maxSlot,               // función(sector, turno) -> cupo máximo
  normLegajo = (x) => (x === null || x === undefined ? '' : String(x).trim().toUpperCase()),
}) {
  const puestoFijoPorLegajo = {}
  ;(reglasPuesto || []).forEach(r => { puestoFijoPorLegajo[normLegajo(r.legajo)] = { sector: r.sector, turno: r.turno || null } })
  const cantidadConfigPorLegajo = {}
  ;(reglasObjetivo || []).forEach(o => {
    cantidadConfigPorLegajo[normLegajo(o.legajo)] = resolverObjetivoGuardias({ objetivoConfigurado: o, objetivoDerivado: 0, horasTurno })
  })

  // Mismo criterio que lib/asignacionRapidaFlujo.js para saber a qué lugar
  // pertenece una fila de "otros destinos": la duración del turno (8hs en
  // Modular, 12hs en HIGA/UPA) y el rango horario real dependen de eso.
  const sectoresModular = ['Modular']
  const sectoresUPA = ['UPA']
  const sectoresHIGA = ['Salud Mental', 'Giratoria', 'Llaves', 'Guardia', 'Estacionamiento', 'Rondin Externo']
  function lugarDeSector(sector) {
    if (sectoresModular.includes(sector)) return 'MODULAR'
    if (sectoresUPA.includes(sector)) return 'UPA'
    return 'HIGA'
  }
  // Por si `turnosOtrosLugares` llegara sin filtrar (scope=todas trae
  // también este lugar): se queda solo con lo que NO es de los sectores
  // propios de este lugar — nunca cuenta una guardia propia como "de otro".
  const sectoresPropios = sectores || []
  const turnosOtrosDetalle = (turnosOtrosLugares || []).filter(t => !sectoresPropios.includes(t.sector))

  // Todo se indexa por legajo normalizado: así un legajo escrito distinto en
  // turnos y en efectivos (espacios, mayúsculas) no se cuenta como otra persona.
  const ocupacion = {}
  const hsMap = {}
  const turnosPorLegajo = {}
  ;(turnosMes || []).forEach(t => {
    const k = t.dia + '-' + t.turno + '-' + t.sector
    ocupacion[k] = (ocupacion[k] || 0) + 1
    const leg = normLegajo(t.legajo)
    hsMap[leg] = (hsMap[leg] || 0) + horasTurno
    if (!turnosPorLegajo[leg]) turnosPorLegajo[leg] = []
    turnosPorLegajo[leg].push({ dia: parseInt(t.dia), turno: t.turno })
  })

  // El tope de 180hs es COMBINADO entre los tres lugares (igual que ya hace
  // Asignación rápida / Regenerar turnos): se suman también las horas que
  // cada efectivo ya tiene en los otros dos destinos este mes.
  const turnosOtrosPorLegajo = {}
  turnosOtrosDetalle.forEach(t => {
    const leg = normLegajo(t.legajo)
    const hsT = lugarDeSector(t.sector) === 'MODULAR' ? 8 : 12
    hsMap[leg] = (hsMap[leg] || 0) + hsT
    if (!turnosOtrosPorLegajo[leg]) turnosOtrosPorLegajo[leg] = []
    turnosOtrosPorLegajo[leg].push({ dia: parseInt(t.dia), turno: t.turno, lugarOrigen: lugarDeSector(t.sector) })
  })

  const dispMap = {}
  ;(dispDia || []).forEach(d => { dispMap[normLegajo(d.legajo)] = d.turno || '' })

  const nuevos = []
  const nuevosPorLegajo = {}
  const faltantesPorTurno = {}

  // Cruce de horario real con otro lugar — mismo cálculo (rangos reales de
  // cada turno, según el lugar de origen) que lib/asignacionRapidaFlujo.js.
  const MIN_DIA = 24 * 60
  function rangoTurno(diaX, turno, lugarTurno) {
    const base = (diaX - 1) * MIN_DIA
    if (lugarTurno === 'MODULAR') {
      if (turno === 'm') return [base + 8 * 60, base + 16 * 60]
      if (turno === 't') return [base + 16 * 60, base + 24 * 60]
      return [base + MIN_DIA, base + MIN_DIA + 8 * 60]
    }
    return turno === 'd' ? [base + 8 * 60, base + 20 * 60] : [base + 20 * 60, base + MIN_DIA + 8 * 60]
  }
  function seSuperponen(a, b) { return a[0] < b[1] && b[0] < a[1] }
  function conflictoOtroLugar(leg, diaX, turnoX) {
    const rangoCandidato = rangoTurno(diaX, turnoX, lugar)
    return (turnosOtrosPorLegajo[leg] || []).find(o => seSuperponen(rangoCandidato, rangoTurno(o.dia, o.turno, o.lugarOrigen))) || null
  }

  // Descanso 12hs (HIGA/UPA): no D+N el mismo día, no N→D en días seguidos.
  // Separado del cruce de otro lugar para poder informar cada motivo por
  // separado en el desglose (diagnosticoTurno, más abajo).
  function cumpleDescansoPropio(leg, diaX, turnoX) {
    if (lugar === 'MODULAR') return true
    const previos = [...(turnosPorLegajo[leg] || []), ...(nuevosPorLegajo[leg] || [])]
    if (previos.some(a => a.dia === diaX && a.turno !== turnoX)) return false
    if (turnoX === 'd' && previos.some(a => a.dia === diaX - 1 && a.turno === 'n')) return false
    if (turnoX === 'n' && previos.some(a => a.dia === diaX + 1 && a.turno === 'd')) return false
    return true
  }
  function cumpleDescanso(leg, diaX, turnoX) {
    if (conflictoOtroLugar(leg, diaX, turnoX)) return false
    return cumpleDescansoPropio(leg, diaX, turnoX)
  }

  function horasDe(leg) {
    return (hsMap[leg] || 0) + ((nuevosPorLegajo[leg] || []).length * horasTurno)
  }

  function llegoASuCantidad(leg) {
    const tope = cantidadConfigPorLegajo[leg]
    if (tope === undefined) return false
    return (turnosPorLegajo[leg] || []).length + (nuevosPorLegajo[leg] || []).length >= tope
  }

  function yaTieneEseTurno(leg, turno) {
    return (turnosPorLegajo[leg] || []).some(a => a.dia === dia && a.turno === turno) ||
      (nuevosPorLegajo[leg] || []).some(a => a.dia === dia && a.turno === turno)
  }

  // Disponibles para un turno EN UN SECTOR dado. El sector es parámetro
  // porque quien tiene puesto fijo solo puede ir al suyo (bug reportado:
  // "lo puse en guardia y me lo coloca en otros sitios").
  function candidatosTurno(turno, sector) {
    return efectivos.filter(e => {
      const leg = normLegajo(e.legajo)
      if (!(dispMap[leg] || '').includes(turno)) return false
      if (yaTieneEseTurno(leg, turno)) return false
      if (horasDe(leg) >= 180) return false
      if (llegoASuCantidad(leg)) return false
      if (!cumpleDescanso(leg, dia, turno)) return false
      const fijo = puestoFijoPorLegajo[leg]
      if (fijo && (fijo.sector !== sector || (fijo.turno && fijo.turno !== turno))) return false
      return true
    }).sort((a, b) => horasDe(normLegajo(a.legajo)) - horasDe(normLegajo(b.legajo)))
  }

  // Cuando un lugar queda sin cubrir, se guarda el desglose real de por qué
  // (nadie cargó, tope, cantidad cubierta, cruce con otro lugar, descanso,
  // puesto fijo) para el cartel.
  const motivoPorTurno = {}
  function diagnosticoTurno(turno, sector) {
    const conDisp = efectivos.filter(e => (dispMap[normLegajo(e.legajo)] || '').includes(turno))
    if (conDisp.length === 0) return 'nadie cargó disponibilidad para este turno ese día'
    let yaAsignado = 0, tope = 0, cantidadCubierta = 0, cruce = 0, descanso = 0, fijoOtroSector = 0
    conDisp.forEach(e => {
      const leg = normLegajo(e.legajo)
      if (yaTieneEseTurno(leg, turno)) { yaAsignado++; return }
      if (horasDe(leg) >= 180) { tope++; return }
      if (llegoASuCantidad(leg)) { cantidadCubierta++; return }
      if (conflictoOtroLugar(leg, dia, turno)) { cruce++; return }
      if (!cumpleDescansoPropio(leg, dia, turno)) { descanso++; return }
      const fijo = puestoFijoPorLegajo[leg]
      if (fijo && (fijo.sector !== sector || (fijo.turno && fijo.turno !== turno))) { fijoOtroSector++; return }
    })
    const partes = []
    if (yaAsignado) partes.push(`${yaAsignado} ya tienen otro turno ese día`)
    if (tope) partes.push(`${tope} ya están al tope de 180hs (entre los tres lugares)`)
    if (cantidadCubierta) partes.push(`${cantidadCubierta} ya llegaron a su cantidad configurada`)
    if (cruce) partes.push(`${cruce} tienen un cruce de horario con otro lugar`)
    if (descanso) partes.push(`${descanso} no cumplen el descanso mínimo`)
    if (fijoOtroSector) partes.push(`${fijoOtroSector} tienen puesto fijo en otro sector o turno`)
    return partes.length
      ? `${conDisp.length} efectivo(s) con disponibilidad cargada, pero: ${partes.join(', ')}`
      : `hay ${conDisp.length} con disponibilidad cargada sin motivo de descarte — revisá si el sector ya está a tope de cupo`
  }

  for (const turno of turnosLugar) {
    // Lugares libres de este turno (cada sector hasta su cupo)
    const slots = []
    for (const sector of sectores) {
      const ocup = ocupacion[dia + '-' + turno + '-' + sector] || 0
      for (let k = ocup; k < maxSlot(sector, turno); k++) slots.push(sector)
    }
    for (const sector of slots) {
      const cands = candidatosTurno(turno, sector)
      if (cands.length === 0) {
        faltantesPorTurno[turno] = (faltantesPorTurno[turno] || 0) + 1
        if (!motivoPorTurno[turno]) motivoPorTurno[turno] = diagnosticoTurno(turno, sector)
        continue
      }
      const e = cands[0]
      const leg = normLegajo(e.legajo)
      nuevos.push({ legajo: e.legajo, mes, anio, dia, turno, sector })
      if (!nuevosPorLegajo[leg]) nuevosPorLegajo[leg] = []
      nuevosPorLegajo[leg].push({ dia, turno })
      ocupacion[dia + '-' + turno + '-' + sector] = (ocupacion[dia + '-' + turno + '-' + sector] || 0) + 1
    }
  }

  return { nuevos, faltantesPorTurno, motivoPorTurno }
}

// Tope para el modal "Asignar" de un efectivo puntual: recorta lo pedido
// para no pasar su cantidad configurada. En 'doble' (24hs) la cantidad son
// días, y cada día suma un turno por franja.
// Devuelve { cantidad, tope, yaTiene, ajustada } — tope null si no tiene
// cantidad configurada (no se recorta nada).
function topeCantidadPedida({ pedida, objetivoConfigurado, yaTiene, tipoTurno, turnosLugar, horasTurno }) {
  if (!objetivoConfigurado) return { cantidad: pedida, tope: null, yaTiene, ajustada: false }
  const tope = resolverObjetivoGuardias({ objetivoConfigurado, objetivoDerivado: 0, horasTurno })
  const restantes = Math.max(0, tope - yaTiene)
  const maximo = tipoTurno === 'doble' ? Math.floor(restantes / turnosLugar.length) : restantes
  const cantidad = Math.min(pedida, maximo)
  return { cantidad, tope, yaTiene, ajustada: cantidad < pedida }
}

module.exports = { calcularCompletarDia, topeCantidadPedida }
