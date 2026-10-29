// lib/asignacionRapidaFlujo.js
//
// Ronda de corrección de errores reproducidos (ver informe de esta entrega).
// Extrae el algoritmo de "Asignación rápida" (antes 100% dentro de
// pages/admin.js, función procesarRapida) a un módulo puro + una función de
// orquestación, siguiendo EXACTAMENTE el mismo patrón ya usado y aprobado en
// este proyecto para lib/generarTurnosFlujo.js y lib/objetivosEfectivos.js:
// sin React, sin JSX, `require()`-able directo desde un test de Node real
// (tests/node/04_asignacion_rapida_flujo.js), para poder probar la LÓGICA
// REAL de asignación con los seis casos reproducidos — no una reimplementación
// aparte que pueda divergir de lo que corre pages/admin.js.
//
// IMPORTANTE — alcance de esta extracción: el orden de fases (0: puesto fijo,
// 1: 24hs, 1.5: parejas, 2: general) y el criterio de reparto dentro de cada
// fase NO se reescriben. Se corrigen únicamente los 6 errores reproducidos y
// enumerados en el pedido de esta ronda, cada uno marcado "Bug N" en el
// comentario del punto exacto donde se corrige. Todo lo demás es el mismo
// código que ya estaba, movido tal cual.
//
// Los 6 errores corregidos:
//   Bug 1 (Fase 0, puesto fijo): antes no descontaba las guardias ya
//     existentes del objetivo ni se detenía al alcanzar la meta — ahora la
//     meta de esta fase es (objetivo - guardias ya existentes este mes) y el
//     bucle se detiene al llegar a esa meta.
//   Bug 2 (Fases 0, 1 y 1.5): antes solo la Fase 2 respetaba el turno
//     configurado (día/noche/ambos); Fase 0 ignoraba turno_objetivo por
//     completo, Fase 1 (24hs) y Fase 1.5 (pareja) también. Ahora las tres
//     respetan turno_objetivo, y cuando la configuración es incompatible
//     (p.ej. puesto fijo de día con objetivo exclusivamente nocturno, o una
//     24hs —que por definición cubre TODOS los turnos del día— con un
//     objetivo restringido a un solo turno, o una pareja cuyos dos objetivos
//     no comparten ningún turno) se informa explícitamente en
//     `incompatibilidades` y NO se asigna nada de esa fase para ese caso —
//     nunca se ignora en silencio eligiendo un criterio por sobre el otro.
//   Bug 3 (Fase 1, 24hs): la meta de días en 24hs ahora también descuenta lo
//     ya asignado (mismo criterio que la Fase 1.5 de parejas, que esto ya
//     hacía bien). Si el objetivo ya está cubierto, la meta queda en 0 y no
//     se agrega ninguna 24hs de más.
//   Bug 4 (cruce HIGA/UPA): la lista de sectores de HIGA usada para el
//     chequeo cruzado de horario y el tope de 180hs ahora incluye "Rondin
//     Externo" (antes faltaba SOLO en esta lista local de procesarRapida;
//     el resto del proyecto ya lo tenía). Se mantiene, como ya era correcto,
//     que "Rondin Externo" NO forma parte de los sectores de UPA.
//   Bug 5 (Fase 2, puesto fijo): un efectivo con puesto fijo configurado
//     (y no marcado para 24hs) ya NO se completa automáticamente en el resto
//     de los sectores en la Fase 2 — si el puesto fijo no alcanzó a cubrir
//     todo el objetivo (por disponibilidad o cupo), el resto queda
//     PENDIENTE e informado en el reporte, nunca completado en otro puesto.
//   Bug 6 (orquestación, ejecutarAsignacionRapida más abajo): antes, un
//     fallo en la consulta de guardias existentes, disponibilidad, reglas de
//     puesto, reglas de objetivo u otros destinos se silenciaba con
//     `.catch(() => ({...: []}))` o ni siquiera se capturaba — un error de
//     lectura quedaba indistinguible de "no hay nada configurado todavía", y
//     el algoritmo corría igual (y podía escribir) con datos incompletos.
//     Ahora cualquiera de esas lecturas que falle (HTTP, red, JSON inválido,
//     o forma de respuesta inesperada) hace que se detenga ANTES de calcular
//     o escribir nada.
//
// ── SEGUNDA RONDA de correcciones (sobre la entrega anterior) ──
//   Falla 1 ("Puesto fijo en todas las fases"): un efectivo con puesto fijo
//     marcado para 24hs recibía parte de la guardia en OTRO sector (p.ej.
//     "Guardia" en vez de "Estacionamiento"), y lo mismo si estaba en
//     pareja y su puesto fijo estaba ocupado — en ambos casos sin informar
//     incompatibilidad. Corregido en la Fase 1 (24hs) y la Fase 1.5
//     (parejas): si el efectivo (o cualquiera de los dos integrantes de la
//     pareja) tiene puesto fijo configurado, el sector queda SIEMPRE
//     confinado al configurado — si no hay cupo ahí, ese día/turno queda
//     sin asignar (pendiente), nunca se elige otro sector en su lugar. Si
//     el puesto fijo tiene un turno específico, es incompatible con 24hs
//     (que cubre ambos turnos) y se informa en `incompatibilidades`. Si
//     los dos integrantes de una pareja tienen puestos fijos en sectores
//     distintos, también es incompatible (no pueden asignarse juntos). La
//     exclusividad de la Fase 2 (antes solo para quienes NO estaban
//     marcados 24hs) ahora aplica siempre que haya puesto fijo, sin
//     excepción por 24hs o pareja.
//   Falla 2 ("Reporte de objetivo"): el reporte comparaba las guardias
//     NUEVAS de esta corrida contra el objetivo completo, ignorando las
//     que ya existían — con objetivo 3, 2 anteriores y 1 nueva, decía que
//     faltaban 2 cuando el total ya era 3. Ahora cada entrada de `reporte`
//     y de `puestoFijoReporte` informa `anteriores`, `nuevas`, `total` y
//     `pendiente` por separado; `pendiente` se calcula siempre como
//     `objetivo - total` (nunca contra solo las nuevas).
//   Falla 3 ("Confirmación de WhatsApp"): no se corrige en este archivo —
//     ver supabase/migrations/0006_correcciones_ronda3.sql y
//     pages/api/whatsapp-avisos.js.
//
// ── TERCERA RONDA ──
//   "Fines de semana sin cubrir": "fines de semana y feriados primero"
//     (infoDiaEspecial) estaba aplicado solo en la Fase 2. Las Fases 0
//     (puesto fijo), 1 (24hs) y 1.5 (pareja) seguían recorriendo los días
//     disponibles de cada efectivo en orden cronológico puro, así que un
//     efectivo con puesto fijo o 24hs podía agotar su objetivo del mes con
//     días de semana tempranos y nunca llegar al fin de semana que también
//     había cargado como disponible — ese sábado/domingo quedaba sin cubrir
//     pese a haber gente disponible. Se agregó `conEspecialesPrimero` (ver
//     junto a la Fase 0) y se usa en las tres fases: mismo criterio que ya
//     usaba la Fase 2, solo reordena los días ya cargados, nunca agrega ni
//     saca ninguno.

const { turnosPermitidosPorObjetivo, resumenObjetivo } = require('./objetivosEfectivos')
// Pedido de esta ronda ("fines de semana y feriados primero"): Fase 2 usa
// infoDiaEspecial para saber, de los días que cada efectivo cargó como
// disponibilidad, cuáles son sábado/domingo/feriado — esos se prueban
// PRIMERO (hasta agotarlos o llegar al objetivo), recién después el resto.
// Ver el comentario junto a diasEspeciales/diasNormales más abajo.
const { infoDiaEspecial } = require('./feriadosArgentina')

// ───────────────────────── Función PURA ─────────────────────────
// Recibe TODOS los datos ya leídos (nunca hace fetch) y devuelve el mismo
// resultado que calculaba procesarRapida: qué guardias nuevas insertar, el
// reporte por efectivo, los conflictos de cruce de horario detectados, el
// detalle de puesto fijo, y las incompatibilidades de configuración
// detectadas (Bug 2) que se informan en vez de ignorarse.
function calcularAsignacionRapida({
  targets,                 // [{ legajo, objetivo }]
  legajos24hs = new Set(), // Set de legajos marcados para 24hs
  lugar,                   // 'HIGA' | 'UPA' | 'MODULAR'
  mes,
  anio,
  sectores,                // SECTORES_POR_LUGAR[lugar]
  turnosLugar,             // ['d','n'] o ['m','t','n']
  horasTurno,              // 12 (HIGA/UPA) u 8 (MODULAR)
  maxHs = 180,
  dispAll,                 // filas de admin-disponibilidad (mismo lugar/mes/año)
  turnosMes,                // filas de admin-turnos (mismo lugar/mes/año)
  reglasPuesto = [],        // filas de admin-reglas-puesto ({ legajo, sector, turno })
  reglasObjetivo = [],      // filas de admin-reglas-objetivo ({ legajo, tipo, cantidad, turno_objetivo, prioridad })
  turnosOtrosLugares = [],  // filas de turnos (scope=todas) de los OTROS dos lugares, ya filtradas a los legajos de esta corrida
  especiales = [],          // filas de efectivos_especiales (tipo '24hs' | 'pareja') de este lugar
  maxSlot,                  // función(sector, turno) -> cupo máximo
  normLegajo,                // función(x) -> legajo normalizado (si no se pasa, se usa un default equivalente)
  infoEfectivos = {},        // { [legajo]: { tipo, sexo } } de TODOS los efectivos de este lugar — usado para el balance de sexo entre Uniformados (ver más abajo)
}) {
  const normalizar = normLegajo || ((x) => (x === null || x === undefined ? '' : String(x).trim().toUpperCase()))
  const MAX_HS = maxHs

  const puestoFijoPorLegajo = {}
  ;(reglasPuesto || []).forEach(r => { puestoFijoPorLegajo[normalizar(r.legajo)] = { sector: r.sector, turno: r.turno || null } })
  const objetivoConfigPorLegajo = {}
  ;(reglasObjetivo || []).forEach(o => { objetivoConfigPorLegajo[normalizar(o.legajo)] = { tipo: o.tipo, cantidad: o.cantidad, turno_objetivo: o.turno_objetivo, prioridad: o.prioridad === true } })

  // ── Balance de sexo entre Uniformados (pedido de esta ronda) ──
  // Un Uniformado masculino y uno femenino son indispensables juntos en el
  // mismo turno — pero NUNCA a costa de dejar un turno sin cubrir: si ese
  // día/turno solo hay disponibilidad cargada de un sexo, se asigna igual
  // con lo que hay. balanceUniformadosPorDiaTurno lleva la cuenta de
  // cuántos Uniformados de cada sexo quedaron en cada día+turno (arranca
  // con lo que YA estaba asignado este mes) para que la Fase 2 — más
  // abajo, que reparte la mayoría de las guardias — priorice completar el
  // sexo que falte en cada día en vez de repartir sin mirar quién quedó al
  // lado de quién. Nunca cambia CUÁLES días están disponibles para cada
  // uno, solo el ORDEN en que se prueban — así que nunca puede dejar algo
  // sin cubrir por perseguir el balance.
  function tipoDeLegajo(legajo) { return infoEfectivos[normalizar(legajo)]?.tipo || null }
  function sexoDeLegajo(legajo) { return infoEfectivos[normalizar(legajo)]?.sexo || null }
  const balanceUniformadosPorDiaTurno = {}
  function registrarUniformado(legajo, dia, turno) {
    if (tipoDeLegajo(legajo) !== 'Uniformado') return
    const sexo = sexoDeLegajo(legajo)
    if (sexo !== 'femenino' && sexo !== 'masculino') return
    const k = dia + '-' + turno
    if (!balanceUniformadosPorDiaTurno[k]) balanceUniformadosPorDiaTurno[k] = { femenino: 0, masculino: 0 }
    balanceUniformadosPorDiaTurno[k][sexo]++
  }

  const ocupacion = {}
  const hsMap = {}
  const turnosPorLegajo = {}
  ;(turnosMes || []).forEach(t => {
    ocupacion[t.dia + '-' + t.turno + '-' + t.sector] = (ocupacion[t.dia + '-' + t.turno + '-' + t.sector] || 0) + 1
    hsMap[t.legajo] = (hsMap[t.legajo] || 0) + horasTurno
    if (!turnosPorLegajo[t.legajo]) turnosPorLegajo[t.legajo] = []
    turnosPorLegajo[t.legajo].push({ dia: parseInt(t.dia), turno: t.turno })
    registrarUniformado(t.legajo, parseInt(t.dia), t.turno)
  })

  // Bug 4: "Rondin Externo" es un sector exclusivo de HIGA y debe participar
  // del chequeo cruzado de horario y del tope de 180hs cuando el lugar que
  // se está procesando es UPA o MODULAR (para detectar que ese efectivo ya
  // tiene una guardia nocturna en HIGA ahí). NO debe agregarse a la lista de
  // sectores de UPA — es exclusivo de HIGA.
  const sectoresModular = ['Modular']
  const sectoresUPA     = ['UPA']
  const sectoresHIGA    = ['Salud Mental', 'Giratoria', 'Llaves', 'Guardia', 'Estacionamiento', 'Rondin Externo']
  const sectoresOtros   = lugar === 'MODULAR' ? [...sectoresUPA, ...sectoresHIGA]
                        : lugar === 'UPA'     ? [...sectoresModular, ...sectoresHIGA]
                        : [...sectoresModular, ...sectoresUPA]

  const turnosOtrosDetalle = (turnosOtrosLugares || []).filter(t => sectoresOtros.includes(t.sector))

  turnosOtrosDetalle.forEach(t => {
    const hsT = sectoresModular.includes(t.sector) ? 8 : 12
    hsMap[t.legajo] = (hsMap[t.legajo] || 0) + hsT
  })

  function lugarDeSector(sector) {
    if (sectoresModular.includes(sector)) return 'MODULAR'
    if (sectoresUPA.includes(sector)) return 'UPA'
    return 'HIGA'
  }

  const turnosOtrosPorLegajo = {}
  turnosOtrosDetalle.forEach(t => {
    if (!turnosOtrosPorLegajo[t.legajo]) turnosOtrosPorLegajo[t.legajo] = []
    turnosOtrosPorLegajo[t.legajo].push({ dia: parseInt(t.dia), turno: t.turno, lugarOrigen: lugarDeSector(t.sector) })
  })

  const MIN_DIA = 24 * 60
  function rangoTurno(dia, turno, lugarTurno) {
    const base = (dia - 1) * MIN_DIA
    if (lugarTurno === 'MODULAR') {
      if (turno === 'm') return [base + 8 * 60, base + 16 * 60]
      if (turno === 't') return [base + 16 * 60, base + 24 * 60]
      return [base + MIN_DIA, base + MIN_DIA + 8 * 60]
    }
    return turno === 'd' ? [base + 8 * 60, base + 20 * 60] : [base + 20 * 60, base + MIN_DIA + 8 * 60]
  }
  function seSuperponen(a, b) { return a[0] < b[1] && b[0] < a[1] }

  function conflictoOtroLugar(legajo, dia, turno) {
    const rangoCandidato = rangoTurno(dia, turno, lugar)
    for (const o of (turnosOtrosPorLegajo[legajo] || [])) {
      if (seSuperponen(rangoCandidato, rangoTurno(o.dia, o.turno, o.lugarOrigen))) return o
    }
    return null
  }

  const dispMap = {}
  ;(dispAll || []).forEach(d => {
    const k = normalizar(d.legajo)
    if (!dispMap[k]) dispMap[k] = {}
    dispMap[k][parseInt(d.dia)] = d.turno
  })

  // Corrección de esta ronda — "Reporte de objetivo": se guarda una FOTO de
  // cuántas guardias tenía cada legajo YA CARGADAS antes de que esta
  // corrida asigne nada (turnosPorLegajo en este punto todavía es
  // exactamente lo que vino de turnosMes). Antes, el reporte final
  // comparaba solo las guardias NUEVAS de esta corrida contra el objetivo
  // completo — con guardias anteriores de por medio, eso hacía ver como
  // "pendiente" algo que en realidad ya estaba cubierto (objetivo 3, 2
  // anteriores + 1 nueva = total 3, pero el reporte decía que faltaban 2).
  // Ahora el reporte distingue anteriores/nuevas/total/pendiente.
  const existentesPorLegajoInicial = {}
  Object.keys(turnosPorLegajo).forEach(leg => { existentesPorLegajoInicial[leg] = turnosPorLegajo[leg].length })
  function existentesDe(legajo) { return existentesPorLegajoInicial[legajo] || 0 }

  const nuevos = []
  const reporte = []
  const conflictos = []
  const incompatibilidades = [] // Bug 2: configuraciones incompatibles detectadas, nunca ignoradas en silencio

  function cumpleDescanso(legajo, dia, turno) {
    const prev = turnosPorLegajo[legajo] || []
    if (prev.some(a => a.dia === dia)) return false
    const conflicto = conflictoOtroLugar(legajo, dia, turno)
    if (conflicto) {
      conflictos.push({ legajo, dia, turno, lugarOrigen: conflicto.lugarOrigen, turnoOrigen: conflicto.turno, diaOrigen: conflicto.dia })
      return false
    }
    if (lugar !== 'MODULAR') {
      const ayer = prev.find(a => a.dia === dia - 1)
      if (ayer && ayer.turno === 'n' && turno === 'd') return false
      const manana = prev.find(a => a.dia === dia + 1)
      if (manana && turno === 'n' && manana.turno === 'd') return false
    }
    return true
  }

  // Corrección de esta ronda ("fines de semana sin cubrir"): "fines de
  // semana y feriados primero" estaba aplicado SOLO en la Fase 2 — las
  // Fases 0 (puesto fijo), 1 (24hs) y 1.5 (pareja) seguían recorriendo los
  // días disponibles en orden puramente cronológico. Eso podía agotar la
  // meta de un efectivo con puesto fijo o 24hs usando días de semana
  // tempranos del mes, y para cuando el bucle llegaba al fin de semana que
  // esa persona SÍ había cargado como disponible, su objetivo ya estaba
  // completo y el bucle se detenía (`break`) sin usarlo — el sábado/domingo
  // quedaba sin cubrir pese a que esa persona figuraba disponible ese turno.
  // Mismo criterio que ya usa la Fase 2: reordenar (nunca agregar ni sacar
  // días) para que los especiales se prueben primero.
  function conEspecialesPrimero(dias) {
    const especiales = dias.filter(d => infoDiaEspecial(d, mes, anio).marcar)
    const normales = dias.filter(d => !infoDiaEspecial(d, mes, anio).marcar)
    return [...especiales, ...normales]
  }

  // ===== Fase 0: puestos fijos configurados por administración =====
  // Bug 5: esta fase es la ÚNICA fuente de guardias para un efectivo con
  // puesto fijo configurado (salvo que esté marcado para 24hs). Si no
  // alcanza a cubrir todo el objetivo, el resto queda PENDIENTE — la Fase 2
  // ya no lo completa en otro sector (ver más abajo).
  const asignadasFase1 = {}
  const puestoFijoReporte = []
  for (const { legajo, objetivo } of targets) {
    const fijo = puestoFijoPorLegajo[normalizar(legajo)]
    if (!fijo || legajos24hs.has(legajo)) continue

    const turnoObjetivoCfg = objetivoConfigPorLegajo[normalizar(legajo)]?.turno_objetivo
    const turnosPermitidosCfg = turnosPermitidosPorObjetivo(turnosLugar, turnoObjetivoCfg)

    // Bug 2: si el puesto fijo tiene un turno específico, ese turno tiene
    // que ser compatible con el turno objetivo configurado. Si no lo es, es
    // una configuración incompatible — se informa y no se asigna nada desde
    // este puesto (nunca se elige uno de los dos criterios por su cuenta).
    let turnosDelFijo
    let incompatible = false
    if (fijo.turno) {
      if (turnoObjetivoCfg && turnoObjetivoCfg !== 'ambos' && !turnosPermitidosCfg.includes(fijo.turno)) {
        incompatible = true
        turnosDelFijo = []
      } else {
        turnosDelFijo = [fijo.turno]
      }
    } else {
      turnosDelFijo = turnosPermitidosCfg
    }

    const dmap = dispMap[normalizar(legajo)] || {}
    const diasCandidatos = conEspecialesPrimero(Object.keys(dmap).map(d => parseInt(d)).sort((a, b) => a - b))

    // Bug 1: la meta de esta fase descuenta las guardias YA existentes este
    // mes (turnosPorLegajo ya las contiene, cargadas desde turnosMes, antes
    // de que esta fase agregue nada) y el bucle se detiene al alcanzarla.
    const existentes = (turnosPorLegajo[legajo] || []).length
    const metaFijo = Math.max(0, objetivo - existentes)

    let asignadasFijo = 0
    if (!incompatible) {
      for (const dia of diasCandidatos) {
        if (asignadasFijo >= metaFijo) break // Bug 1: se detiene al llegar al objetivo
        if ((turnosPorLegajo[legajo] || []).some(a => a.dia === dia)) continue
        const tk = turnosDelFijo.find(t => (dmap[dia] || '').includes(t) && cumpleDescanso(legajo, dia, t))
        if (!tk) continue
        if ((hsMap[legajo] || 0) + horasTurno > MAX_HS) break
        if ((ocupacion[dia + '-' + tk + '-' + fijo.sector] || 0) >= maxSlot(fijo.sector, tk)) continue

        nuevos.push({ legajo, mes, anio, dia, turno: tk, sector: fijo.sector })
        if (!turnosPorLegajo[legajo]) turnosPorLegajo[legajo] = []
        turnosPorLegajo[legajo].push({ dia, turno: tk })
        ocupacion[dia + '-' + tk + '-' + fijo.sector] = (ocupacion[dia + '-' + tk + '-' + fijo.sector] || 0) + 1
        hsMap[legajo] = (hsMap[legajo] || 0) + horasTurno
        registrarUniformado(legajo, dia, tk)
        asignadasFijo++
      }
    }
    asignadasFase1[legajo] = (asignadasFase1[legajo] || 0) + asignadasFijo
    {
      // Corrección de esta ronda ("Reporte de objetivo"): se informan
      // anteriores/nuevas/total/pendiente por separado, nunca solo "nuevas"
      // contra el objetivo completo.
      const anterioresFijo = existentesDe(legajo)
      const totalFijo = anterioresFijo + asignadasFijo
      const pendienteFijo = Math.max(0, objetivo - totalFijo)
      puestoFijoReporte.push({ legajo, sector: fijo.sector, turno: fijo.turno, anteriores: anterioresFijo, nuevas: asignadasFijo, total: totalFijo, objetivo, pendiente: pendienteFijo, incompatible })
    }
    if (incompatible) {
      incompatibilidades.push({
        tipo: 'puesto_fijo',
        legajos: [legajo],
        motivo: `El puesto fijo de este efectivo está configurado para el turno "${fijo.turno}", pero su objetivo configurado solo permite turno "${turnoObjetivoCfg}" — configuración incompatible. No se asignó ninguna guardia desde el puesto fijo; queda pendiente e informado, nunca se completa automáticamente en otro puesto.`,
      })
    }
  }

  // ===== Fase 1: efectivos marcados para guardias de 24hs =====
  const diasBloqueados24hs = {}
  for (const { legajo, objetivo } of targets) {
    if (!legajos24hs.has(legajo)) continue

    const turnoObjetivoCfg = objetivoConfigPorLegajo[normalizar(legajo)]?.turno_objetivo
    // Bug 2: una guardia de 24hs cubre TODOS los turnos del día, por
    // definición — es incompatible con un objetivo restringido a un solo
    // turno (día o noche). Se informa y esta fase no asigna nada para este
    // efectivo (el resto, si corresponde, se intenta en la Fase 2 respetando
    // el turno configurado — igual que cuando una 24hs no completa todo el
    // día por falta de disponibilidad, comportamiento que ya existía).
    if (turnoObjetivoCfg && turnoObjetivoCfg !== 'ambos') {
      incompatibilidades.push({
        tipo: '24hs',
        legajos: [legajo],
        motivo: `Este efectivo está marcado para guardias de 24hs, pero su objetivo configurado restringe el turno a "${turnoObjetivoCfg}" — una 24hs cubre todos los turnos del día, configuración incompatible. No se asignó ninguna 24hs; el resto del objetivo se intenta en turnos sueltos respetando "${turnoObjetivoCfg}".`,
      })
      asignadasFase1[legajo] = asignadasFase1[legajo] || 0
      continue
    }

    // Corrección de esta ronda ("Puesto fijo en todas las fases"): un
    // puesto fijo con turno específico (solo día o solo noche) es, por
    // definición, incompatible con una 24hs (que cubre AMBOS turnos del
    // día) — se informa y esta fase no asigna ninguna 24hs para este
    // efectivo, igual criterio que turno_objetivo más arriba.
    const fijo = puestoFijoPorLegajo[normalizar(legajo)]
    if (fijo && fijo.turno) {
      incompatibilidades.push({
        tipo: 'puesto_fijo_24hs',
        legajos: [legajo],
        motivo: `Este efectivo tiene un puesto fijo configurado en "${fijo.sector}" para el turno "${fijo.turno}", pero está marcado para guardias de 24hs (que cubren ambos turnos del día) — configuración incompatible. No se asignó ninguna 24hs desde este puesto; el resto del objetivo queda pendiente e informado (no se completa en otro sector).`,
      })
      asignadasFase1[legajo] = asignadasFase1[legajo] || 0
      continue
    }

    const dmap = dispMap[normalizar(legajo)] || {}
    const diasCandidatos = conEspecialesPrimero(
      Object.keys(dmap).map(d => parseInt(d)).sort((a, b) => a - b)
        .filter(dia => turnosLugar.every(tk => (dmap[dia] || '').includes(tk)))
    )

    const conteoSector = {}; sectores.forEach(s => { conteoSector[s] = 0 })
    function getSector24(dia, turno) {
      const orden = [...sectores].sort((a, b) => conteoSector[a] - conteoSector[b])
      for (const s of orden) {
        if ((ocupacion[dia + '-' + turno + '-' + s] || 0) < maxSlot(s, turno)) { conteoSector[s]++; return s }
      }
      return null
    }

    if (!diasBloqueados24hs[legajo]) diasBloqueados24hs[legajo] = new Set()
    const costoDia = horasTurno * turnosLugar.length
    let diasAsignados = 0
    // Bug 3: la meta de días de 24hs descuenta lo YA asignado este mes
    // (mismo criterio que ya usaba correctamente la Fase 1.5 de parejas) —
    // si el objetivo ya está cubierto, la meta queda en 0 y no se agrega
    // ninguna 24hs de más.
    const existentes = (turnosPorLegajo[legajo] || []).length
    const objetivoRestante = Math.max(0, objetivo - existentes)
    const metaDias = Math.floor(objetivoRestante / turnosLugar.length)

    for (const dia of diasCandidatos) {
      if (diasAsignados >= metaDias) break
      if ((hsMap[legajo] || 0) + costoDia > MAX_HS) continue
      if ((turnosPorLegajo[legajo] || []).some(a => a.dia === dia)) continue
      if (diasBloqueados24hs[legajo].has(dia)) continue

      const conflicto = turnosLugar.map(tk => conflictoOtroLugar(legajo, dia, tk)).find(Boolean)
      if (conflicto) {
        conflictos.push({ legajo, dia, turno: '24hs', lugarOrigen: conflicto.lugarOrigen, turnoOrigen: conflicto.turno, diaOrigen: conflicto.dia })
        continue
      }

      // Corrección de esta ronda: si tiene puesto fijo (sin turno
      // específico, ya descartado arriba), la 24hs debe cubrirse ENTERA en
      // ese sector — nunca repartida en otro por más libre que esté. Si el
      // puesto fijo no tiene cupo para AMBOS turnos ese día, el día queda
      // sin asignar (pendiente), nunca se elige otro sector en su lugar.
      const sectoresDelDia = fijo
        ? turnosLugar.map(tk => ((ocupacion[dia + '-' + tk + '-' + fijo.sector] || 0) < maxSlot(fijo.sector, tk)) ? fijo.sector : null)
        : turnosLugar.map(tk => getSector24(dia, tk))
      if (sectoresDelDia.some(s => !s)) continue

      turnosLugar.forEach((tk, i) => {
        nuevos.push({ legajo, mes, anio, dia, turno: tk, sector: sectoresDelDia[i] })
        if (!turnosPorLegajo[legajo]) turnosPorLegajo[legajo] = []
        turnosPorLegajo[legajo].push({ dia, turno: tk })
        ocupacion[dia + '-' + tk + '-' + sectoresDelDia[i]] = (ocupacion[dia + '-' + tk + '-' + sectoresDelDia[i]] || 0) + 1
        registrarUniformado(legajo, dia, tk)
      })
      hsMap[legajo] = (hsMap[legajo] || 0) + costoDia
      diasBloqueados24hs[legajo].add(dia + 1)
      diasAsignados++
    }
    asignadasFase1[legajo] = diasAsignados * turnosLugar.length
  }

  // ===== Fase 1.5: parejas =====
  const objetivoPorLegajo = {}
  targets.forEach(t => { objetivoPorLegajo[String(t.legajo)] = { legajo: t.legajo, objetivo: t.objetivo } })
  const objetivoPareja = e => {
    const tA = objetivoPorLegajo[String(e.legajo1)], tB = objetivoPorLegajo[String(e.legajo2)]
    return (tA?.objetivo || 0) + (tB?.objetivo || 0)
  }
  const parejasActivas = (especiales || []).filter(e => e.tipo === 'pareja')
    .sort((a, b) => objetivoPareja(b) - objetivoPareja(a))
  const yaEmparejado = new Set()
  for (const pareja of parejasActivas) {
    const keyA = String(pareja.legajo1), keyB = String(pareja.legajo2)
    if (yaEmparejado.has(keyA) || yaEmparejado.has(keyB)) continue
    const tA = objetivoPorLegajo[keyA], tB = objetivoPorLegajo[keyB]
    if (!tA || !tB) continue
    const a = tA.legajo, b = tB.legajo
    if (legajos24hs.has(a) || legajos24hs.has(b)) continue
    yaEmparejado.add(keyA); yaEmparejado.add(keyB)

    // Bug 2 (ronda anterior): la pareja solo puede coincidir en un turno
    // válido para AMBOS según el objetivo configurado de cada uno.
    const turnoObjA = objetivoConfigPorLegajo[normalizar(a)]?.turno_objetivo
    const turnoObjB = objetivoConfigPorLegajo[normalizar(b)]?.turno_objetivo
    const turnosPermA = turnosPermitidosPorObjetivo(turnosLugar, turnoObjA)
    const turnosPermB = turnosPermitidosPorObjetivo(turnosLugar, turnoObjB)

    // Corrección de esta ronda ("Puesto fijo en todas las fases"): si
    // alguno de los dos integrantes tiene puesto fijo configurado, la
    // pareja NUNCA puede asignarse en un sector distinto al configurado —
    // nunca "cambiar de sector en silencio" cuando ese puesto está ocupado.
    // Si AMBOS tienen puesto fijo pero en sectores distintos, es imposible
    // asignarlos juntos en un único sector: incompatibilidad, no se asigna
    // nada como pareja (cada uno conserva su propio puesto fijo individual
    // de la Fase 0).
    const fijoA = puestoFijoPorLegajo[normalizar(a)]
    const fijoB = puestoFijoPorLegajo[normalizar(b)]
    if (fijoA && fijoB && fijoA.sector !== fijoB.sector) {
      incompatibilidades.push({
        tipo: 'pareja_puesto_fijo',
        legajos: [a, b],
        motivo: `Los dos integrantes de la pareja tienen puestos fijos configurados en sectores distintos ("${fijoA.sector}" y "${fijoB.sector}") — no pueden asignarse juntos en un único sector. No se asignó ninguna guardia como pareja (cada uno conserva su propio puesto fijo individual).`,
      })
      continue
    }
    const sectorFijoPareja = (fijoA && fijoA.sector) || (fijoB && fijoB.sector) || null

    // La intersección de turnos válidos ahora también respeta el turno del
    // puesto fijo de cualquiera de los dos (si lo tiene). Si la
    // intersección es vacía, es una configuración incompatible entre los
    // dos miembros — se informa y esta pareja no se asigna (nunca se
    // ignora en silencio eligiendo el turno/sector de uno solo de los dos).
    const turnosParejaCfg = turnosLugar.filter(tk =>
      turnosPermA.includes(tk) && turnosPermB.includes(tk) &&
      (!fijoA || !fijoA.turno || fijoA.turno === tk) &&
      (!fijoB || !fijoB.turno || fijoB.turno === tk)
    )
    if (turnosParejaCfg.length === 0) {
      incompatibilidades.push({
        tipo: 'pareja',
        legajos: [a, b],
        motivo: `La pareja no tiene ningún turno en común entre los objetivos y/o puestos fijos configurados de sus dos integrantes (uno restringido a "${turnoObjA || (fijoA && fijoA.turno ? 'puesto fijo turno ' + fijoA.turno : 'ambos')}", el otro a "${turnoObjB || (fijoB && fijoB.turno ? 'puesto fijo turno ' + fijoB.turno : 'ambos')}") — configuración incompatible. No se asignó ninguna guardia como pareja.`,
      })
      continue
    }

    const dmapA = dispMap[normalizar(a)] || {}
    const dmapB = dispMap[normalizar(b)] || {}
    const diasComunes = conEspecialesPrimero(
      Object.keys(dmapA).map(d => parseInt(d))
        .filter(d => dmapB[d])
        .sort((x, y) => x - y)
    )

    const metaPar = Math.min(
      tA.objetivo - (turnosPorLegajo[a] || []).length,
      tB.objetivo - (turnosPorLegajo[b] || []).length
    )
    if (metaPar <= 0) continue

    const conteoSectorPar = {}; sectores.forEach(s => { conteoSectorPar[s] = 0 })
    let asignadasPar = 0
    for (const dia of diasComunes) {
      if (asignadasPar >= metaPar) break
      if ((turnosPorLegajo[a] || []).some(x => x.dia === dia)) continue
      if ((turnosPorLegajo[b] || []).some(x => x.dia === dia)) continue

      const turnosComunes = turnosParejaCfg.filter(tk => (dmapA[dia] || '').includes(tk) && (dmapB[dia] || '').includes(tk))
      for (const tk of turnosComunes) {
        if (!cumpleDescanso(a, dia, tk) || !cumpleDescanso(b, dia, tk)) continue
        if ((hsMap[a] || 0) + horasTurno > MAX_HS || (hsMap[b] || 0) + horasTurno > MAX_HS) continue

        // Corrección de esta ronda: si alguno de los dos tiene puesto fijo,
        // el único sector posible es el configurado — nunca se elige otro
        // por más libre que esté. Si no hay cupo ahí, este día/turno queda
        // sin asignar (pendiente), nunca "cambia de sector en silencio".
        const sec = sectorFijoPareja
          ? ((ocupacion[dia + '-' + tk + '-' + sectorFijoPareja] || 0) + 2 <= maxSlot(sectorFijoPareja, tk) ? sectorFijoPareja : null)
          : [...sectores].sort((x, y) => conteoSectorPar[x] - conteoSectorPar[y]).find(s => (ocupacion[dia + '-' + tk + '-' + s] || 0) + 2 <= maxSlot(s, tk))
        if (!sec) continue

        ;[a, b].forEach(legajo => {
          nuevos.push({ legajo, mes, anio, dia, turno: tk, sector: sec })
          if (!turnosPorLegajo[legajo]) turnosPorLegajo[legajo] = []
          turnosPorLegajo[legajo].push({ dia, turno: tk })
          hsMap[legajo] = (hsMap[legajo] || 0) + horasTurno
          registrarUniformado(legajo, dia, tk)
        })
        ocupacion[dia + '-' + tk + '-' + sec] = (ocupacion[dia + '-' + tk + '-' + sec] || 0) + 2
        conteoSectorPar[sec]++
        asignadasPar++
        break
      }
    }
    asignadasFase1[a] = (asignadasFase1[a] || 0) + asignadasPar
    asignadasFase1[b] = (asignadasFase1[b] || 0) + asignadasPar
  }

  // ===== Fase 2: asignación normal (turno por turno) para completar lo que falte =====
  // Pedido de esta ronda ("cantidad fija"): un efectivo marcado con
  // PRIORIDAD explícita (objetivoConfigPorLegajo[...].prioridad === true —
  // SOLO el panel "CANTIDAD FIJA" de Asignación rápida la activa; migración
  // 0007) tiene que llegar a SU número antes de que el resto empiece a
  // competir por los mismos sectores/turnos — si no, puede perder el cupo
  // contra alguien con un objetivo más alto que entra antes solo por el
  // orden en que vinieron los targets. El objetivo en sí YA estaba
  // respetado sin esto (nunca se asigna de más ni de menos que lo
  // configurado, acá y en las fases anteriores) — esto solo adelanta a
  // quién le toca el cupo primero. Un objetivo configurado SIN prioridad
  // (la ficha del efectivo, o un script de datos de prueba) sigue
  // reemplazando la cantidad igual que siempre, pero NO corta la fila.
  const targetsObjetivoFijo = targets.filter(t => objetivoConfigPorLegajo[normalizar(t.legajo)]?.prioridad)
  const targetsNoFijo = targets.filter(t => !objetivoConfigPorLegajo[normalizar(t.legajo)]?.prioridad)

  // Balance de sexo entre Uniformados: dentro de los que NO tienen
  // cantidad fija, tampoco se recorre `targets` en su orden original — se
  // intercalan los Uniformados femeninos y masculinos (fem, masc, fem,
  // masc...) para que ambos sexos tengan la misma oportunidad de llegar a
  // cada día ANTES de que los cupos se llenen (si todos los masculinos se
  // procesaran primero, para cuando le toca a las femeninas muchos días ya
  // estarían completos). El resto (Serv. General, Destacamento) va
  // después, en su orden original — esto solo cambia el ORDEN de
  // procesamiento, ninguna otra regla.
  const targetsUniformadoFemenino = targetsNoFijo.filter(t => tipoDeLegajo(t.legajo) === 'Uniformado' && sexoDeLegajo(t.legajo) === 'femenino')
  const targetsUniformadoMasculino = targetsNoFijo.filter(t => tipoDeLegajo(t.legajo) === 'Uniformado' && sexoDeLegajo(t.legajo) === 'masculino')
  const targetsResto = targetsNoFijo.filter(t => !(tipoDeLegajo(t.legajo) === 'Uniformado' && (sexoDeLegajo(t.legajo) === 'femenino' || sexoDeLegajo(t.legajo) === 'masculino')))
  const targetsUniformadosIntercalados = []
  {
    const max = Math.max(targetsUniformadoFemenino.length, targetsUniformadoMasculino.length)
    for (let i = 0; i < max; i++) {
      if (targetsUniformadoFemenino[i]) targetsUniformadosIntercalados.push(targetsUniformadoFemenino[i])
      if (targetsUniformadoMasculino[i]) targetsUniformadosIntercalados.push(targetsUniformadoMasculino[i])
    }
  }
  const targetsFase2 = [...targetsObjetivoFijo, ...targetsUniformadosIntercalados, ...targetsResto]

  for (const { legajo, objetivo } of targetsFase2) {
    // Bug 5: un efectivo con puesto fijo configurado (y que no esté marcado
    // para 24hs) ya agotó su única fuente de guardias en la Fase 0. Si no
    // llegó al objetivo, queda PENDIENTE e informado — esta fase ya NO lo
    // completa en el resto de los sectores.
    // Corrección de esta ronda ("Puesto fijo en todas las fases"): la
    // exclusividad del puesto fijo (Bug 5 de la ronda anterior) ahora
    // aplica SIEMPRE que haya un puesto fijo configurado — incluida la
    // modalidad 24hs y pareja. Antes, `&& !legajos24hs.has(legajo)` dejaba
    // pasar a esta fase general (sin restricción de sector) a cualquier
    // efectivo marcado para 24hs que también tuviera puesto fijo — eso era
    // justo lo que terminaba completando en "Guardia" un puesto fijo de
    // "Estacionamiento" cuando la 24hs no alcanzaba a cubrir todo el día
    // ahí. Un efectivo en pareja con puesto fijo tampoco pasa por acá (su
    // resto, si lo hay, ya quedó pendiente e informado en la Fase 1.5).
    const tienePuestoFijoExclusivo = !!puestoFijoPorLegajo[normalizar(legajo)]
    if (tienePuestoFijoExclusivo) {
      // Corrección de esta ronda ("Reporte de objetivo"): se informan
      // anteriores/nuevas/total/pendiente por separado — nunca solo
      // "nuevas de esta corrida" contra el objetivo completo.
      const nuevas = asignadasFase1[legajo] || 0
      const anteriores = existentesDe(legajo)
      const total = anteriores + nuevas
      const pendiente = Math.max(0, objetivo - total)
      reporte.push({
        legajo, objetivo, anteriores, nuevas, total, pendiente,
        detalle: resumenObjetivo({
          asignadas: total, meta: objetivo,
          motivoSiFalta: pendiente > 0
            ? 'Tiene un puesto fijo configurado (solo, en 24hs o en pareja): el resto del objetivo no se completa automáticamente en otro sector. Falta disponibilidad y/o cupo en el puesto fijo para cubrir el resto.'
            : null,
        }),
      })
      continue
    }

    const hsActuales = hsMap[legajo] || 0
    const cupoPorTope = Math.floor((MAX_HS - hsActuales) / horasTurno)
    const meta = Math.max(0, Math.min(objetivo - (turnosPorLegajo[legajo] || []).length, cupoPorTope))

    const turnoObjetivoCfg = objetivoConfigPorLegajo[normalizar(legajo)]?.turno_objetivo
    const turnosLugarEf = turnosPermitidosPorObjetivo(turnosLugar, turnoObjetivoCfg)

    const dmap = dispMap[normalizar(legajo)] || {}
    const diasCandidatosTodos = Object.keys(dmap).map(d => parseInt(d)).sort((a, b) => a - b)
      .map(dia => ({ dia, turno: dmap[dia] }))
      .filter(({ dia, turno }) => turnosLugarEf.some(tk => turno.includes(tk)))

    // Pedido de esta ronda ("fines de semana y feriados primero"): de los
    // días que este efectivo cargó como disponibilidad, separar los que
    // son sábado/domingo/feriado (infoDiaEspecial) de los que no — más
    // abajo se cubre PRIMERO el grupo especial por completo (hasta
    // agotarlo o llegar al objetivo) y recién después, con lo que quede
    // del objetivo, se pasa al grupo normal. Siguen siendo los MISMOS días
    // disponibles de siempre, nunca se agrega ni saca ninguno — solo
    // cambia el ORDEN en que se prueban. Si un efectivo no tiene NINGÚN
    // día especial disponible, el primer grupo queda vacío y se comporta
    // exactamente igual que antes.
    const diasEspeciales = diasCandidatosTodos.filter(({ dia }) => infoDiaEspecial(dia, mes, anio).marcar)
    const diasNormales = diasCandidatosTodos.filter(({ dia }) => !infoDiaEspecial(dia, mes, anio).marcar)

    // Balance de sexo entre Uniformados: entre los días de CADA grupo (ver
    // arriba), se prueban PRIMERO los que ayudan a completar el sexo que
    // falta en ese día/turno (ya hay un Uniformado del sexo opuesto y
    // todavía ninguno de este), después los días "neutros" (sin
    // Uniformados todavía) y al final los que ya tienen este mismo sexo
    // (para no juntar 3 del mismo sexo en un turno si hay otro día
    // disponible). Es un REORDEN de los mismos días disponibles dentro de
    // cada grupo, nunca agrega ni saca ninguno ni mezcla los dos grupos —
    // así que nunca deja un turno sin cubrir por perseguir el balance, y
    // el orden "especiales primero" de arriba queda intacto. `.sort` de JS
    // es estable, así que si dos días quedan con la misma prioridad se
    // mantiene el orden original (el reparto parejo por intervalo que ya
    // hacía este algoritmo).
    const sexoEf = sexoDeLegajo(legajo)
    function ordenarPorBalanceSexo(lista) {
      if (!(tipoDeLegajo(legajo) === 'Uniformado' && (sexoEf === 'femenino' || sexoEf === 'masculino'))) return
      const opuesto = sexoEf === 'femenino' ? 'masculino' : 'femenino'
      const prioridadDia = ({ dia, turno }) => {
        let mejor = -Infinity
        turnosLugarEf.forEach(tk => {
          if (!turno.includes(tk)) return
          const cnt = balanceUniformadosPorDiaTurno[dia + '-' + tk]
          const puntos = cnt ? (cnt[opuesto] - cnt[sexoEf]) : 0
          if (puntos > mejor) mejor = puntos
        })
        return mejor
      }
      lista.sort((a, b) => prioridadDia(b) - prioridadDia(a))
    }
    ordenarPorBalanceSexo(diasEspeciales)
    ordenarPorBalanceSexo(diasNormales)

    const conteoSector = {}; sectores.forEach(s => { conteoSector[s] = 0 })
    const conteoTurnos = {}; turnosLugarEf.forEach(tk => { conteoTurnos[tk] = 0 })
    function getSector(dia, turno) {
      const orden = [...sectores].sort((a, b) => conteoSector[a] - conteoSector[b])
      for (const s of orden) {
        if ((ocupacion[dia + '-' + turno + '-' + s] || 0) < maxSlot(s, turno)) { conteoSector[s]++; return s }
      }
      return null
    }

    let asignadas = asignadasFase1[legajo] || 0
    const asignadasInicioFase2 = asignadasFase1[legajo] || 0
    // Cubre lo que falte del objetivo usando SOLO los días de `lista` —
    // mismo criterio de reparto espaciado por intervalo que antes, ahora
    // recalculado contra lo que queda pendiente en el momento de llamarla
    // (para que, al pasar del grupo especial al normal, el reparto del
    // segundo grupo se espacie según lo que realmente falta, no contra el
    // objetivo completo).
    function cubrirEnLista(lista) {
      if (lista.length === 0) return
      const faltan = meta - (asignadas - asignadasInicioFase2)
      if (faltan <= 0) return
      const intervalo = lista.length > faltan ? Math.floor(lista.length / faltan) : 1
      let idx = 0; let vueltas = 0
      while (asignadas - asignadasInicioFase2 < meta && vueltas < lista.length * 2) {
        vueltas++
        if (idx >= lista.length) idx = 0
        const { dia, turno: dispTurno } = lista[idx]
        const turnosOk = turnosLugarEf.filter(tk =>
          dispTurno.includes(tk) &&
          !(turnosPorLegajo[legajo] || []).some(a => a.dia === dia && a.turno === tk) &&
          cumpleDescanso(legajo, dia, tk)
        )
        if (turnosOk.length > 0) {
          const tk = turnosOk.sort((a, b) => conteoTurnos[a] - conteoTurnos[b])[0]
          const s = getSector(dia, tk)
          if (s) {
            nuevos.push({ legajo, mes, anio, dia, turno: tk, sector: s })
            if (!turnosPorLegajo[legajo]) turnosPorLegajo[legajo] = []
            turnosPorLegajo[legajo].push({ dia, turno: tk })
            ocupacion[dia + '-' + tk + '-' + s] = (ocupacion[dia + '-' + tk + '-' + s] || 0) + 1
            conteoTurnos[tk]++
            hsMap[legajo] = (hsMap[legajo] || 0) + horasTurno
            registrarUniformado(legajo, dia, tk)
            asignadas++
            idx += intervalo
            continue
          }
        }
        idx++
      }
    }
    cubrirEnLista(diasEspeciales)
    cubrirEnLista(diasNormales)
    // Corrección de esta ronda ("Reporte de objetivo"): `asignadas` acá es
    // el total de NUEVAS guardias de esta corrida (Fase 0/1/1.5 + esta
    // Fase 2) — se informa junto con las anteriores, el total real contra
    // el objetivo, y el pendiente (nunca "nuevas de esta corrida" sola
    // contra el objetivo completo, que es lo que hacía ver pendientes
    // guardias que ya estaban cubiertas por anteriores + nuevas).
    const nuevas = asignadas
    const anteriores = existentesDe(legajo)
    const total = anteriores + nuevas
    const pendiente = Math.max(0, objetivo - total)
    reporte.push({ legajo, objetivo, anteriores, nuevas, total, pendiente, detalle: resumenObjetivo({ asignadas: total, meta: objetivo }) })
  }

  // ===== Fase 3: fin de semana y feriado, "pase lo que pase" =====
  // Pedido explícito de esta ronda: para sábado/domingo/feriado, si
  // después de TODAS las fases de siempre (que nunca pasan del objetivo
  // configurado de cada uno) todavía queda un hueco en algún sector/turno,
  // se intenta cerrar con cualquier efectivo disponible ESE día/turno —
  // acá sí se permite pasarse del objetivo individual (el efectivo termina
  // con más guardias que su objetivo; el reporte lo informa, nunca lo
  // esconde). Los días normales NO pasan por acá: ahí el objetivo
  // configurado se sigue respetando exactamente igual que siempre.
  //
  // Lo que esta fase NUNCA relaja, ni para cerrar un hueco de fin de
  // semana:
  //   - el tope de 180hs (hsMap + horasTurno <= MAX_HS, igual que en todas
  //     las fases anteriores);
  //   - el descanso entre turnos y el cruce con otro destino
  //     (cumpleDescanso — ya bloquea el día si ayer hizo noche y esto es de
  //     día, si mañana ya tiene una guardia diurna y esto sería de noche,
  //     o si hay superposición de horario con otro lugar; también bloquea
  //     un segundo turno el mismo día, así que a quien hizo una 24hs no se
  //     le agrega nada más ese día — "si hizo 24hs no le agreguemos más",
  //     ya queda cubierto solo con esta regla);
  //   - el cupo del sector (maxSlot) — nunca se mete a nadie de más;
  //   - la exclusividad del puesto fijo: un efectivo con puesto fijo SOLO
  //     se usa acá para cerrar un hueco de SU PROPIO sector (y, si tiene
  //     turno fijo configurado, de su propio turno) — jamás de otro
  //     sector, ni siquiera como último recurso;
  //   - la cantidad configurada por administración (efectivo_objetivo:
  //     "cantidad fija" de Asignación rápida o la ficha del efectivo): quien
  //     la tenga NUNCA pasa de ese número, tampoco para cerrar un hueco de
  //     fin de semana (antes: cantidad fija 3 terminaba en 5 con dos
  //     sábados/domingos de más). El exceso de fin de semana queda solo para
  //     quien NO tiene cantidad configurada (objetivo derivado del mes de
  //     referencia).
  // Tampoco se ignora qué turno cargó cada uno como disponible: solo se
  // prueba para el turno que esa persona efectivamente marcó ese día.
  const extraFindePorLegajo = {}
  {
    const diasEspecialesDelMes = new Set()
    Object.keys(dispMap).forEach(leg => {
      Object.keys(dispMap[leg] || {}).forEach(d => {
        const dia = parseInt(d)
        if (infoDiaEspecial(dia, mes, anio).marcar) diasEspecialesDelMes.add(dia)
      })
    })
    const diasOrdenados = [...diasEspecialesDelMes].sort((a, b) => a - b)
    const legajosTargets = targets.map(t => t.legajo)

    for (const dia of diasOrdenados) {
      for (const turno of turnosLugar) {
        for (const sector of sectores) {
          const cupo = maxSlot(sector, turno)
          if (cupo <= 0) continue
          // eslint-disable-next-line no-constant-condition
          while ((ocupacion[dia + '-' + turno + '-' + sector] || 0) < cupo) {
            const candidatos = legajosTargets
              .filter(legajo => {
                const dmap = dispMap[normalizar(legajo)] || {}
                if (!(dmap[dia] || '').includes(turno)) return false
                if ((turnosPorLegajo[legajo] || []).some(a => a.dia === dia)) return false
                if ((hsMap[legajo] || 0) + horasTurno > MAX_HS) return false
                if (objetivoConfigPorLegajo[normalizar(legajo)] &&
                    (turnosPorLegajo[legajo] || []).length >= (objetivoPorLegajo[String(legajo)]?.objetivo || 0)) return false
                const fijo = puestoFijoPorLegajo[normalizar(legajo)]
                if (fijo) {
                  if (fijo.sector !== sector || (fijo.turno && fijo.turno !== turno)) return false
                  // Mismos chequeos de incompatibilidad que las Fases 0 y
                  // 1: un puesto fijo de turno específico incompatible con
                  // el turno_objetivo configurado, o un puesto fijo de
                  // turno específico combinado con 24hs, no asignan NADA
                  // en ninguna fase — tampoco acá, ni para cerrar un hueco
                  // de fin de semana.
                  if (fijo.turno && legajos24hs.has(legajo)) return false
                  const turnoObjetivoCfg = objetivoConfigPorLegajo[normalizar(legajo)]?.turno_objetivo
                  const turnosPermitidosCfg = turnosPermitidosPorObjetivo(turnosLugar, turnoObjetivoCfg)
                  if (fijo.turno && turnoObjetivoCfg && turnoObjetivoCfg !== 'ambos' && !turnosPermitidosCfg.includes(fijo.turno)) return false
                }
                return true
              })
              .sort((a, b) => {
                // Prioridad: primero quien esté MENOS pasado de su
                // objetivo (o directamente por debajo); entre empates,
                // quien tenga menos horas acumuladas en esta corrida — para
                // repartir el excedente de fin de semana lo más parejo
                // posible, nunca siempre a la misma gente.
                const tA = objetivoPorLegajo[String(a)]?.objetivo || 0
                const tB = objetivoPorLegajo[String(b)]?.objetivo || 0
                const sobreA = Math.max(0, (turnosPorLegajo[a] || []).length - tA)
                const sobreB = Math.max(0, (turnosPorLegajo[b] || []).length - tB)
                if (sobreA !== sobreB) return sobreA - sobreB
                return (hsMap[a] || 0) - (hsMap[b] || 0)
              })

            let elegido = null
            for (const legajo of candidatos) {
              if (cumpleDescanso(legajo, dia, turno)) { elegido = legajo; break }
            }
            if (!elegido) break // nadie compatible para este hueco puntual — queda sin cubrir, como antes

            nuevos.push({ legajo: elegido, mes, anio, dia, turno, sector })
            if (!turnosPorLegajo[elegido]) turnosPorLegajo[elegido] = []
            turnosPorLegajo[elegido].push({ dia, turno })
            ocupacion[dia + '-' + turno + '-' + sector] = (ocupacion[dia + '-' + turno + '-' + sector] || 0) + 1
            hsMap[elegido] = (hsMap[elegido] || 0) + horasTurno
            registrarUniformado(elegido, dia, turno)
            extraFindePorLegajo[elegido] = (extraFindePorLegajo[elegido] || 0) + 1
          }
        }
      }
    }
  }

  // Reflejar en el reporte lo que agregó la Fase 3 — si no, el reporte
  // mostraría el objetivo ya cumplido sin contar las guardias de más que
  // en realidad se agregaron para cerrar huecos de fin de semana/feriado
  // (iguales correcciones en `reporte`, donde vive TODO efectivo —
  // incluido quien tiene puesto fijo, ver la rama `tienePuestoFijoExclusivo`
  // de la Fase 2 más arriba — y en `puestoFijoReporte`, que además trae el
  // detalle de sector/turno fijo para quien lo tenga).
  Object.keys(extraFindePorLegajo).forEach(legajo => {
    const extra = extraFindePorLegajo[legajo]
    const rep = reporte.find(r => r.legajo === legajo)
    if (rep) {
      rep.nuevas += extra
      rep.total += extra
      rep.pendiente = Math.max(0, rep.objetivo - rep.total)
      rep.detalle = resumenObjetivo({ asignadas: rep.total, meta: rep.objetivo })
      rep.extraFinDeSemana = extra
    }
    const repFijo = puestoFijoReporte.find(r => r.legajo === legajo)
    if (repFijo) {
      repFijo.nuevas += extra
      repFijo.total += extra
      repFijo.pendiente = Math.max(0, repFijo.objetivo - repFijo.total)
      repFijo.extraFinDeSemana = extra
    }
  })

  return { nuevos, reporte, conflictos, puestoFijoReporte, incompatibilidades }
}

// ───────────────────── Función de orquestación ─────────────────────
// Bug 6: hace TODAS las lecturas necesarias con manejo de errores real
// (HTTP, red, JSON inválido, forma de respuesta inesperada) y se detiene
// ANTES de calcular o escribir nada si alguna falla — nunca trata un error
// de lectura como "lista vacía".
async function leerListaJSON(fetchFn, url, campo) {
  let res
  try {
    res = await fetchFn(url)
  } catch (eRed) {
    return { ok: false, motivo: `error de red consultando ${url}: ${eRed.message}` }
  }
  if (!res.ok) {
    let detalle = ''
    try {
      const cuerpoError = await res.json()
      detalle = cuerpoError?.error || ''
    } catch {
      // un error HTTP no siempre trae un cuerpo JSON (p.ej. un 502 de proxy)
    }
    return { ok: false, motivo: `la consulta a ${url} respondió ${res.status}${detalle ? ': ' + detalle : ''}` }
  }
  let body
  try {
    body = await res.json()
  } catch (eJson) {
    return { ok: false, motivo: `la respuesta de ${url} no es JSON válido: ${eJson.message}` }
  }
  if (!body || !Array.isArray(body[campo])) {
    return { ok: false, motivo: `la consulta a ${url} no devolvió el formato esperado ({ ${campo}: [...] })` }
  }
  return { ok: true, data: body[campo] }
}

async function ejecutarAsignacionRapida({
  fetchFn,
  mes,
  anio,
  lugar,
  sectores,
  turnosLugar,
  horasTurno,
  maxHs = 180,
  targets,
  legajos24hs = new Set(),
  especiales = [],
  maxSlot,
  normLegajo,
  infoEfectivos = {},
  insertarFn, // async (nuevos) => { error? } — hace el POST de inserción
}) {
  // 1) Lecturas base: disponibilidad, guardias ya cargadas este mes, reglas
  //    de puesto fijo y de objetivo. Cualquier falla acá aborta ANTES de
  //    calcular o escribir absolutamente nada (Bug 6).
  const [dispRes, turnosMesRes, reglasPuestoRes, reglasObjetivoRes] = await Promise.all([
    leerListaJSON(fetchFn, `/api/admin-disponibilidad?mes=${mes}&anio=${anio}&lugar=${lugar}`, 'data'),
    leerListaJSON(fetchFn, `/api/admin-turnos?mes=${mes}&anio=${anio}`, 'turnos'),
    leerListaJSON(fetchFn, '/api/admin-reglas-puesto', 'reglas'),
    leerListaJSON(fetchFn, '/api/admin-reglas-objetivo', 'objetivos'),
  ])
  for (const [nombre, r] of [['disponibilidad', dispRes], ['guardias del mes', turnosMesRes], ['reglas de puesto', reglasPuestoRes], ['reglas de objetivo', reglasObjetivoRes]]) {
    if (!r.ok) return { ok: false, motivo: `No se pudo leer ${nombre}: ${r.motivo}`, reporte: [], conflictos: [], puestoFijoReporte: [], incompatibilidades: [] }
  }

  // 2) Guardias de los OTROS destinos, para el chequeo cruzado de horario y
  //    el tope de 180hs — acotado a los legajos de esta corrida. Si esta
  //    consulta falla, también se aborta ANTES de escribir (Bug 6): antes no
  //    tenía ningún manejo de error y, además, un fallo silenciado acá
  //    podía dejar pasar una guardia superpuesta entre destinos sin
  //    detectarla.
  const legajosObjetivo = [...new Set((targets || []).map(t => t.legajo))].filter(Boolean)
  let turnosOtrosLugares = []
  if (legajosObjetivo.length) {
    const otrosRes = await leerListaJSON(
      fetchFn,
      `/api/admin-turnos?mes=${mes}&anio=${anio}&scope=todas&legajo=${encodeURIComponent(legajosObjetivo.join(','))}`,
      'turnos'
    )
    if (!otrosRes.ok) return { ok: false, motivo: `No se pudo leer las guardias de los otros destinos: ${otrosRes.motivo}`, reporte: [], conflictos: [], puestoFijoReporte: [], incompatibilidades: [] }
    turnosOtrosLugares = otrosRes.data
  }

  // 3) Recién con todas las lecturas válidas se corre el cálculo (que nunca
  //    hace fetch ni escribe nada por su cuenta).
  const resultado = calcularAsignacionRapida({
    targets, legajos24hs, lugar, mes, anio, sectores, turnosLugar, horasTurno, maxHs,
    dispAll: dispRes.data,
    turnosMes: turnosMesRes.data,
    reglasPuesto: reglasPuestoRes.data,
    reglasObjetivo: reglasObjetivoRes.data,
    turnosOtrosLugares,
    especiales,
    maxSlot,
    normLegajo,
    infoEfectivos,
  })

  // 4) Guardar, si hay algo para guardar.
  if (resultado.nuevos.length > 0) {
    let respuestaInsert
    try {
      respuestaInsert = await insertarFn(resultado.nuevos)
    } catch (eGuardado) {
      return { ok: false, motivo: `error de red guardando: ${eGuardado.message}`, reporte: resultado.reporte, conflictos: resultado.conflictos, puestoFijoReporte: resultado.puestoFijoReporte, incompatibilidades: resultado.incompatibilidades }
    }
    if (respuestaInsert?.error) {
      return { ok: false, motivo: `error al guardar: ${respuestaInsert.error}`, reporte: resultado.reporte, conflictos: resultado.conflictos, puestoFijoReporte: resultado.puestoFijoReporte, incompatibilidades: resultado.incompatibilidades }
    }
  }

  return { ok: true, total: resultado.nuevos.length, reporte: resultado.reporte, conflictos: resultado.conflictos, puestoFijoReporte: resultado.puestoFijoReporte, incompatibilidades: resultado.incompatibilidades }
}

module.exports = { calcularAsignacionRapida, ejecutarAsignacionRapida, leerListaJSON }
