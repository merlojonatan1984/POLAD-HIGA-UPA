// tests/node/05_asignacion_rapida_flujo.js
//
// Ronda de corrección de errores reproducidos en la "Asignación rápida".
// Prueba REAL del algoritmo — no una reimplementación aparte, ni solo
// conversiones de horas a guardias: importa `lib/asignacionRapidaFlujo.js`
// (el mismo módulo que ahora importa y usa pages/admin.js en
// `procesarRapida`, ver el wrapper fino ahí) y lo ejercita con datos
// ficticios, igual patrón que tests/node/02_generar_turnos_flujo.js
// (orquestación con `fetch` mockeado) y tests/node/03_objetivos_efectivos.js
// (cálculo puro).
//
// Cubre, con un caso concreto cada uno, los 6 errores reproducidos del
// pedido de esta ronda (identificados Bug 1 a Bug 6 en los comentarios de
// lib/asignacionRapidaFlujo.js), más una serie de regresiones explícitas:
// guardias previas conservadas, repetir asignación no duplica ni supera el
// objetivo, y cruces detectados entre los tres destinos.
//
// SEGUNDA RONDA (sobre la entrega anterior): además cubre las "Falla 1"
// (puesto fijo en TODAS las fases — 24hs y pareja, no solo Fase 0/2) y
// "Falla 2" (reporte de objetivo: anteriores/nuevas/total/pendiente) con
// casos nuevos más abajo. IMPORTANTE: como el reporte cambió de forma en
// esta ronda (antes `reporte[].asignadas` y `puestoFijoReporte[].asignadas`
// eran las guardias NUEVAS de esta corrida contra el objetivo COMPLETO;
// ahora cada entrada expone `anteriores`, `nuevas`, `total` y `pendiente`
// por separado — ver el comentario de cabecera de
// lib/asignacionRapidaFlujo.js), todas las aserciones que antes leían
// `.asignadas` en esas dos listas se actualizaron a `.nuevas` (mismo
// significado: guardias agregadas en ESTA corrida), y se agregaron
// aserciones nuevas sobre `.total`/`.pendiente` donde corresponde. La
// "Falla 3" (confirmación de WhatsApp) es 100% SQL/API — ver
// tests/pg/09_correcciones_ronda3_whatsapp.sql.
//
// Corre con: node tests/node/05_asignacion_rapida_flujo.js

const { calcularAsignacionRapida, ejecutarAsignacionRapida } = require('../../lib/asignacionRapidaFlujo')

let totalOk = 0
function ok(cond, msg) {
  if (!cond) { console.error('FALLO: ' + msg); process.exit(1) }
  console.log('  ok  — ' + msg)
  totalOk++
}

// ───────────────────────── fixtures compartidos ─────────────────────────

// maxSlot: copiado literalmente del criterio de pages/admin.js para HIGA
// (Salud Mental/Llaves: 2 de día, 1 de noche; Rondin Externo: 0 de día, 2
// de noche) — el resto, 2 por turno en cualquier lugar.
function maxSlotHIGA(sector, turno) {
  const porTurno = {
    'Salud Mental':   { d: 2, n: 1 },
    'Llaves':         { d: 2, n: 1 },
    'Rondin Externo': { d: 0, n: 2 },
  }[sector]
  if (porTurno && turno in porTurno) return porTurno[turno]
  return 2
}
function maxSlotSimple() { return 2 }

const SECTORES_HIGA = ['Salud Mental', 'Giratoria', 'Llaves', 'Guardia', 'Estacionamiento', 'Rondin Externo']
const SECTORES_UPA = ['UPA']
const SECTORES_MODULAR = ['Modular']

// Disponibilidad "todos los días del mes, día y noche" para no tener que
// armar un mes entero a mano en cada caso — los casos que necesitan una
// disponibilidad acotada la arman explícitamente.
function dispTodoElMes(legajo, dias, turnos) {
  return dias.map(dia => ({ legajo, dia, turno: turnos }))
}

function turno(legajo, dia, t, sector) { return { legajo, dia, turno: t, sector } }

async function main() {
  console.log('=== Corrección de errores — Asignación rápida (algoritmo real, datos ficticios) ===')

  // =========================================================================
  // BUG 1 — "Puesto fijo con objetivo de 3 y disponibilidad de 5 días asigna
  // 5 — debe descontar guardias existentes y detenerse al alcanzar el
  // objetivo."
  // =========================================================================
  {
    // 1a) Sin guardias previas este mes: objetivo 3, disponibilidad 5 días.
    const r = calcularAsignacionRapida({
      targets: [{ legajo: '1001', objetivo: 3 }],
      legajos24hs: new Set(),
      lugar: 'HIGA', mes: 11, anio: 2026,
      sectores: SECTORES_HIGA, turnosLugar: ['d', 'n'], horasTurno: 12, maxHs: 180,
      dispAll: dispTodoElMes('1001', [1, 2, 3, 4, 5], 'dn'),
      turnosMes: [],
      reglasPuesto: [{ legajo: '1001', sector: 'Guardia', turno: null }],
      reglasObjetivo: [],
      maxSlot: maxSlotSimple,
    })
    const p = r.puestoFijoReporte[0]
    ok(p.nuevas === 3, `puesto fijo (objetivo 3, 5 días disponibles, 0 previas): asigna EXACTAMENTE 3, no 5 (asignó ${p.nuevas})`)
    ok(p.total === 3 && p.pendiente === 0, `puesto fijo: total=3 y pendiente=0 (reportó total=${p.total}, pendiente=${p.pendiente})`)
    ok(r.nuevos.length === 3, `se insertan exactamente 3 guardias nuevas (se insertaron ${r.nuevos.length})`)

    // 1b) CON guardias ya existentes este mes (2 ya cargadas en otro
    // sector): el objetivo de 3 debe descontarlas — solo deben agregarse 1
    // más desde el puesto fijo, nunca 3 de más ni 5.
    const r2 = calcularAsignacionRapida({
      targets: [{ legajo: '1001', objetivo: 3 }],
      legajos24hs: new Set(),
      lugar: 'HIGA', mes: 11, anio: 2026,
      sectores: SECTORES_HIGA, turnosLugar: ['d', 'n'], horasTurno: 12, maxHs: 180,
      dispAll: dispTodoElMes('1001', [1, 2, 3, 4, 5], 'dn'),
      turnosMes: [turno('1001', 20, 'd', 'Giratoria'), turno('1001', 21, 'd', 'Giratoria')],
      reglasPuesto: [{ legajo: '1001', sector: 'Guardia', turno: null }],
      reglasObjetivo: [],
      maxSlot: maxSlotSimple,
    })
    const p2 = r2.puestoFijoReporte[0]
    ok(p2.nuevas === 1, `puesto fijo (objetivo 3, 2 guardias YA existentes este mes): descuenta las existentes y asigna solo 1 más (asignó ${p2.nuevas})`)
    // Falla 2 ("Reporte de objetivo"): objetivo 3, 2 anteriores, 1 nueva —
    // el total tiene que dar 3 y el pendiente 0 (antes, al comparar solo
    // "nuevas" (1) contra el objetivo completo (3), el reporte decía que
    // faltaban 2 cuando en realidad ya estaba cubierto).
    ok(p2.anteriores === 2 && p2.nuevas === 1 && p2.total === 3 && p2.pendiente === 0,
      `Falla 2 — objetivo 3, 2 anteriores, 1 nueva: total debe ser 3 y pendiente 0 (reportó anteriores=${p2.anteriores}, nuevas=${p2.nuevas}, total=${p2.total}, pendiente=${p2.pendiente})`)
  }

  // =========================================================================
  // BUG 2 — "Puesto fijo con objetivo solo nocturno asigna de día — la
  // elección día/noche/ambos debe respetarse en TODAS las fases, incluidas
  // parejas y 24hs; configuraciones incompatibles deben informarse, nunca
  // ignorarse silenciosamente."
  // =========================================================================
  {
    // 2a) Puesto fijo SIN turno específico (cualquiera de los dos), pero
    // con objetivo configurado exclusivamente nocturno: debe asignar SOLO
    // de noche, nunca de día, aunque haya disponibilidad de día.
    const r = calcularAsignacionRapida({
      targets: [{ legajo: '1002', objetivo: 2 }],
      legajos24hs: new Set(),
      lugar: 'HIGA', mes: 11, anio: 2026,
      sectores: SECTORES_HIGA, turnosLugar: ['d', 'n'], horasTurno: 12, maxHs: 180,
      dispAll: dispTodoElMes('1002', [1, 2, 3], 'dn'),
      turnosMes: [],
      reglasPuesto: [{ legajo: '1002', sector: 'Guardia', turno: null }],
      reglasObjetivo: [{ legajo: '1002', tipo: 'guardias', cantidad: 2, turno_objetivo: 'noche' }],
      maxSlot: maxSlotSimple,
    })
    ok(r.nuevos.length === 2 && r.nuevos.every(n => n.turno === 'n'), `puesto fijo + objetivo "solo nocturno": asigna SOLO turnos de noche (asignó: ${JSON.stringify(r.nuevos.map(n => n.turno))})`)
    ok(r.puestoFijoReporte[0].incompatible === false, 'puesto fijo sin turno específico + objetivo nocturno: NO es una incompatibilidad (el puesto se adapta al turno configurado)')

    // 2b) Puesto fijo CON un turno específico (de día) que choca con un
    // objetivo exclusivamente nocturno: configuración incompatible — debe
    // informarse y no asignar nada desde el puesto fijo (nunca elegir uno
    // de los dos criterios por su cuenta).
    const r2 = calcularAsignacionRapida({
      targets: [{ legajo: '1003', objetivo: 2 }],
      legajos24hs: new Set(),
      lugar: 'HIGA', mes: 11, anio: 2026,
      sectores: SECTORES_HIGA, turnosLugar: ['d', 'n'], horasTurno: 12, maxHs: 180,
      dispAll: dispTodoElMes('1003', [1, 2, 3], 'dn'),
      turnosMes: [],
      reglasPuesto: [{ legajo: '1003', sector: 'Guardia', turno: 'd' }],
      reglasObjetivo: [{ legajo: '1003', tipo: 'guardias', cantidad: 2, turno_objetivo: 'noche' }],
      maxSlot: maxSlotSimple,
    })
    ok(r2.puestoFijoReporte[0].incompatible === true, 'puesto fijo de turno "d" + objetivo exclusivamente nocturno: se marca como incompatible')
    ok(r2.puestoFijoReporte[0].nuevas === 0, 'configuración incompatible de puesto fijo: no asigna NADA desde el puesto fijo')
    ok(r2.incompatibilidades.some(i => i.tipo === 'puesto_fijo' && i.legajos.includes('1003')), 'la incompatibilidad de puesto fijo queda informada explícitamente en `incompatibilidades` (nunca en silencio)')
    ok(r2.nuevos.length === 0, 'puesto fijo exclusivo + incompatible: no se asigna nada en NINGÚN otro sector tampoco (Bug 5 sigue vigente)')

    // 2c) 24hs con objetivo restringido a un solo turno: por definición
    // incompatible (una 24hs cubre TODOS los turnos del día) — se informa
    // y la fase de 24hs no asigna nada; el resto se intenta en la Fase 2
    // respetando el turno configurado.
    const r3 = calcularAsignacionRapida({
      targets: [{ legajo: '1004', objetivo: 4 }],
      legajos24hs: new Set(['1004']),
      lugar: 'HIGA', mes: 11, anio: 2026,
      sectores: SECTORES_HIGA, turnosLugar: ['d', 'n'], horasTurno: 12, maxHs: 180,
      dispAll: dispTodoElMes('1004', [1, 2, 3, 4, 5, 6], 'dn'),
      turnosMes: [],
      reglasPuesto: [],
      reglasObjetivo: [{ legajo: '1004', tipo: 'guardias', cantidad: 4, turno_objetivo: 'dia' }],
      maxSlot: maxSlotSimple,
    })
    ok(r3.incompatibilidades.some(i => i.tipo === '24hs' && i.legajos.includes('1004')), '24hs + objetivo restringido a un turno: incompatibilidad informada')
    ok(r3.nuevos.every(n => n.turno === 'd'), '24hs incompatible: el resto del objetivo se asigna en la Fase 2 respetando el turno configurado ("dia"), nunca de noche')
    ok(r3.reporte[0].total === 4 && r3.reporte[0].pendiente === 0, 'el objetivo igual se cubre completo (total=4, pendiente=0) por la Fase 2 en turnos sueltos de día (reportó total=' + r3.reporte[0].total + ', pendiente=' + r3.reporte[0].pendiente + ')')

    // 2d) Pareja cuyos dos integrantes tienen objetivos de turno
    // incompatibles entre sí (uno solo de día, el otro solo de noche): no
    // comparten ningún turno posible — se informa y no se asigna nada como
    // pareja (se deja que cada uno intente individualmente en la Fase 2).
    const r4 = calcularAsignacionRapida({
      targets: [{ legajo: '2001', objetivo: 3 }, { legajo: '2002', objetivo: 3 }],
      legajos24hs: new Set(),
      lugar: 'HIGA', mes: 11, anio: 2026,
      sectores: SECTORES_HIGA, turnosLugar: ['d', 'n'], horasTurno: 12, maxHs: 180,
      dispAll: [...dispTodoElMes('2001', [1, 2, 3, 4, 5], 'dn'), ...dispTodoElMes('2002', [1, 2, 3, 4, 5], 'dn')],
      turnosMes: [],
      reglasPuesto: [],
      reglasObjetivo: [
        { legajo: '2001', tipo: 'guardias', cantidad: 3, turno_objetivo: 'dia' },
        { legajo: '2002', tipo: 'guardias', cantidad: 3, turno_objetivo: 'noche' },
      ],
      especiales: [{ tipo: 'pareja', legajo1: '2001', legajo2: '2002' }],
      maxSlot: maxSlotSimple,
    })
    ok(r4.incompatibilidades.some(i => i.tipo === 'pareja' && i.legajos.includes('2001') && i.legajos.includes('2002')), 'pareja con objetivos de turno incompatibles entre sí: incompatibilidad informada')
    // Nunca deben quedar asignados juntos en el mismo turno (no hay intersección posible).
    const juntos = r4.nuevos.filter(n => n.legajo === '2001').some(nA =>
      r4.nuevos.some(nB => nB.legajo === '2002' && nB.dia === nA.dia && nB.turno === nA.turno && nB.sector === nA.sector))
    ok(!juntos, 'pareja incompatible: nunca se los asigna juntos en el mismo turno (se ignoró la incompatibilidad en silencio si esto fallara)')
  }

  // =========================================================================
  // BUG 3 — "Modalidad 24hs con objetivo de 4 turnos y 4 ya asignados agrega
  // otros 4 — si el objetivo ya está cubierto, no debe agregar ninguno."
  // =========================================================================
  {
    const r = calcularAsignacionRapida({
      targets: [{ legajo: '1005', objetivo: 4 }],
      legajos24hs: new Set(['1005']),
      lugar: 'HIGA', mes: 11, anio: 2026,
      sectores: SECTORES_HIGA, turnosLugar: ['d', 'n'], horasTurno: 12, maxHs: 180,
      dispAll: dispTodoElMes('1005', [1, 2, 3, 4, 5, 6, 7, 8], 'dn'),
      // Ya tiene 4 turnos cargados este mes (2 días de 24hs: d+n cada uno).
      turnosMes: [
        turno('1005', 1, 'd', 'Guardia'), turno('1005', 1, 'n', 'Guardia'),
        turno('1005', 3, 'd', 'Guardia'), turno('1005', 3, 'n', 'Guardia'),
      ],
      reglasPuesto: [],
      reglasObjetivo: [],
      maxSlot: maxSlotSimple,
    })
    ok(r.nuevos.length === 0, `24hs con objetivo ya cubierto (4 de 4): no agrega NINGÚN turno nuevo (agregó ${r.nuevos.length})`)
    // `reporte[].nuevas` es la cantidad de guardias NUEVAS agregadas en ESTA
    // corrida (0, no se agregó ninguna de más) — `anteriores` (4, las ya
    // cargadas) y `total` (4) confirman que el objetivo sigue cubierto sin
    // haberlo superado, y `pendiente` da 0.
    ok(r.reporte[0].nuevas === 0, `el reporte muestra 0 guardias NUEVAS agregadas en esta corrida (reportó ${r.reporte[0].nuevas})`)
    ok(r.reporte[0].anteriores === 4 && r.reporte[0].total === 4 && r.reporte[0].pendiente === 0,
      `reporte: anteriores=4, total=4, pendiente=0 (reportó anteriores=${r.reporte[0].anteriores}, total=${r.reporte[0].total}, pendiente=${r.reporte[0].pendiente})`)
  }

  // =========================================================================
  // BUG 4 — "Un efectivo con Rondín Externo nocturno en HIGA recibe una
  // guardia superpuesta en UPA — incluir Rondín Externo en la consulta
  // cruzada de HIGA; NO agregarlo a UPA."
  // =========================================================================
  {
    // El efectivo ya tiene, en HIGA, una guardia de "Rondin Externo" de
    // noche el día 10. Se intenta asignarle, procesando UPA, una guardia
    // esa misma noche (horario superpuesto real).
    const r = calcularAsignacionRapida({
      targets: [{ legajo: '3001', objetivo: 1 }],
      legajos24hs: new Set(),
      lugar: 'UPA', mes: 11, anio: 2026,
      sectores: SECTORES_UPA, turnosLugar: ['d', 'n'], horasTurno: 12, maxHs: 180,
      // Disponible SOLO de noche ese día — así la única franja candidata es
      // justamente la que se superpone con el Rondín Externo de HIGA; si el
      // algoritmo tuviera otra franja libre (de día) la tomaría sin
      // problema (no hay cruce real), así que se acota a propósito para
      // que la única opción posible sea la que debe bloquearse.
      dispAll: dispTodoElMes('3001', [10], 'n'),
      turnosMes: [],
      reglasPuesto: [],
      reglasObjetivo: [],
      // Esto es lo que hace el orquestador (ejecutarAsignacionRapida) al
      // pedir scope=todas acotado a los legajos de la corrida — acá se
      // pasa directo para no depender de la red.
      turnosOtrosLugares: [turno('3001', 10, 'n', 'Rondin Externo')],
      maxSlot: maxSlotSimple,
    })
    ok(r.nuevos.length === 0, 'Rondín Externo nocturno en HIGA bloquea una guardia superpuesta de noche en UPA el mismo día (antes NO se detectaba — Bug 4)')
    ok(r.conflictos.some(c => c.legajo === '3001' && c.lugarOrigen === 'HIGA'), 'el conflicto cruzado HIGA→UPA por Rondín Externo queda registrado en `conflictos`')

    // Confirma, además, que "Rondin Externo" sigue sin ser parte de los
    // sectores de UPA: una lectura normal de disponibilidad para UPA solo
    // puede generar turnos en el sector "UPA".
    const r2 = calcularAsignacionRapida({
      targets: [{ legajo: '3002', objetivo: 1 }],
      legajos24hs: new Set(),
      lugar: 'UPA', mes: 11, anio: 2026,
      sectores: SECTORES_UPA, turnosLugar: ['d', 'n'], horasTurno: 12, maxHs: 180,
      dispAll: dispTodoElMes('3002', [10], 'dn'),
      turnosMes: [],
      reglasPuesto: [],
      reglasObjetivo: [],
      maxSlot: maxSlotSimple,
    })
    ok(r2.nuevos.every(n => n.sector === 'UPA'), '"Rondin Externo" sigue sin ser parte de los sectores de UPA (exclusivo de HIGA) — todo turno nuevo en UPA cae en el sector "UPA"')
  }

  // =========================================================================
  // BUG 5 — "El puesto fijo funciona como preferencia y luego permite
  // asignar en otros sectores — debe mantenerse el puesto configurado; si
  // no alcanza disponibilidad/cupo, dejar pendiente e informar, NUNCA
  // completar automáticamente en otro puesto."
  // =========================================================================
  {
    // El puesto fijo es "Rondin Externo" de noche (cupo 2 por noche — con
    // un solo efectivo pidiendo, el cupo no es la restricción). Se limita
    // la disponibilidad a propósito a 2 noches en total, para forzar que,
    // de los 5 del objetivo, solo se puedan cubrir 2 desde el puesto fijo.
    const r = calcularAsignacionRapida({
      targets: [{ legajo: '4001', objetivo: 5 }],
      legajos24hs: new Set(),
      lugar: 'HIGA', mes: 11, anio: 2026,
      sectores: SECTORES_HIGA, turnosLugar: ['d', 'n'], horasTurno: 12, maxHs: 180,
      dispAll: dispTodoElMes('4001', [1, 2], 'n'), // solo 2 noches disponibles en total
      turnosMes: [],
      reglasPuesto: [{ legajo: '4001', sector: 'Rondin Externo', turno: 'n' }],
      reglasObjetivo: [],
      maxSlot: maxSlotHIGA,
    })
    ok(r.puestoFijoReporte[0].nuevas === 2, `puesto fijo con disponibilidad limitada a 2 noches (objetivo 5): cubre solo 2 desde el puesto fijo (cubrió ${r.puestoFijoReporte[0].nuevas})`)
    ok(r.nuevos.length === 2, `NO se completan los 3 restantes en ningún otro sector — total insertado 2 (se insertaron ${r.nuevos.length})`)
    ok(r.nuevos.every(n => n.sector === 'Rondin Externo'), 'todo lo insertado es en el puesto fijo configurado, nunca en otro sector')
    const rep = r.reporte.find(x => x.legajo === '4001')
    ok(rep.nuevas === 2 && rep.total === 2 && rep.pendiente === 3, `el reporte informa 2 nuevas, total 2 y 3 PENDIENTES (nunca "completado" en otro lado) — reportó nuevas=${rep.nuevas}, total=${rep.total}, pendiente=${rep.pendiente}`)
    ok(!rep.detalle.cumplido, 'el reporte nunca marca "cumplido" cuando quedó pendiente por el puesto fijo')
  }

  // =========================================================================
  // SEGUNDA RONDA — Falla 1: "PUESTO FIJO EN TODAS LAS FASES". Se reprodujo
  // que un efectivo con Estacionamiento fijo, marcado para 24hs, recibía
  // parte de la guardia en "Guardia"; y que, asociado a una pareja, recibía
  // "Guardia" cuando Estacionamiento estaba ocupado — en ambos casos sin
  // informar incompatibilidad. El puesto fijo no debe ignorarse por estar
  // marcado para 24hs o pareja: o se cumple en el sector configurado, o
  // queda pendiente e informado — nunca cambia de sector en silencio.
  // =========================================================================
  {
    // 1a) Puesto fijo + 24hs, SIN turno específico: el día en que el puesto
    // fijo no tiene cupo (ocupado por otros dos efectivos) debe quedar SIN
    // asignar — nunca completarse en "Guardia", que ese mismo día tiene
    // cupo libre de sobra. El otro día, con cupo libre, sí se cubre entero
    // en el puesto fijo.
    const rA = calcularAsignacionRapida({
      targets: [{ legajo: '9001', objetivo: 2 }], // 1 día de 24hs
      legajos24hs: new Set(['9001']),
      lugar: 'HIGA', mes: 11, anio: 2026,
      sectores: SECTORES_HIGA, turnosLugar: ['d', 'n'], horasTurno: 12, maxHs: 180,
      dispAll: dispTodoElMes('9001', [1, 2], 'dn'),
      // Día 1: "Estacionamiento" ya está a tope (2/2) en ambos turnos,
      // ocupado por otros dos efectivos — "Guardia" sigue con cupo libre
      // ese mismo día, que es justo la tentación del bug reproducido.
      turnosMes: [
        turno('9101', 1, 'd', 'Estacionamiento'), turno('9102', 1, 'd', 'Estacionamiento'),
        turno('9101', 1, 'n', 'Estacionamiento'), turno('9102', 1, 'n', 'Estacionamiento'),
      ],
      reglasPuesto: [{ legajo: '9001', sector: 'Estacionamiento', turno: null }],
      reglasObjetivo: [],
      maxSlot: maxSlotSimple,
    })
    ok(rA.nuevos.every(n => n.sector === 'Estacionamiento'), `Falla 1a — puesto fijo + 24hs: TODO lo asignado cae en el puesto fijo "Estacionamiento", nunca en "Guardia" (sectores usados: ${JSON.stringify([...new Set(rA.nuevos.map(n => n.sector))])})`)
    ok(!rA.nuevos.some(n => n.dia === 1), 'Falla 1a — puesto fijo + 24hs: el día sin cupo en el puesto fijo (día 1) queda SIN asignar, nunca se completa en "Guardia"')
    ok(rA.nuevos.length === 2 && rA.nuevos.every(n => n.dia === 2), `Falla 1a — con el día 1 bloqueado, la 24hs se cubre completa en el día 2 (se asignaron ${rA.nuevos.length} turnos, días: ${JSON.stringify(rA.nuevos.map(n => n.dia))})`)

    // 1b) Mismo caso pero SIN ningún día con cupo disponible: el efectivo
    // debe quedar con el objetivo PENDIENTE (nunca completado en otro
    // sector), y el reporte debe informar el motivo.
    const rB = calcularAsignacionRapida({
      targets: [{ legajo: '9002', objetivo: 4 }], // 2 días de 24hs
      legajos24hs: new Set(['9002']),
      lugar: 'HIGA', mes: 11, anio: 2026,
      sectores: SECTORES_HIGA, turnosLugar: ['d', 'n'], horasTurno: 12, maxHs: 180,
      dispAll: dispTodoElMes('9002', [1], 'dn'), // un solo día disponible
      turnosMes: [
        turno('9101', 1, 'd', 'Estacionamiento'), turno('9102', 1, 'd', 'Estacionamiento'),
        turno('9101', 1, 'n', 'Estacionamiento'), turno('9102', 1, 'n', 'Estacionamiento'),
      ],
      reglasPuesto: [{ legajo: '9002', sector: 'Estacionamiento', turno: null }],
      reglasObjetivo: [],
      maxSlot: maxSlotSimple,
    })
    ok(rB.nuevos.length === 0, `Falla 1b — puesto fijo + 24hs sin ningún día con cupo libre: no se asigna NADA (ni ahí ni en otro sector) — se asignaron ${rB.nuevos.length}`)
    const repB = rB.reporte.find(x => x.legajo === '9002')
    ok(repB.pendiente === 4 && repB.total === 0, `Falla 1b — queda PENDIENTE el objetivo completo (4), nunca completado en otro puesto (reportó pendiente=${repB.pendiente}, total=${repB.total})`)
    ok(repB.detalle.motivo && /puesto fijo/i.test(repB.detalle.motivo), 'Falla 1b — el reporte informa el motivo (puesto fijo sin cupo), nunca en silencio')

    // 1c) Puesto fijo CON turno específico + 24hs: por definición
    // incompatible (24hs cubre ambos turnos, el puesto fijo solo uno) — se
    // informa y no se asigna ninguna 24hs desde ese puesto.
    const rC = calcularAsignacionRapida({
      targets: [{ legajo: '9003', objetivo: 2 }],
      legajos24hs: new Set(['9003']),
      lugar: 'HIGA', mes: 11, anio: 2026,
      sectores: SECTORES_HIGA, turnosLugar: ['d', 'n'], horasTurno: 12, maxHs: 180,
      dispAll: dispTodoElMes('9003', [1, 2], 'dn'),
      turnosMes: [],
      reglasPuesto: [{ legajo: '9003', sector: 'Estacionamiento', turno: 'n' }],
      reglasObjetivo: [],
      maxSlot: maxSlotSimple,
    })
    ok(rC.incompatibilidades.some(i => i.tipo === 'puesto_fijo_24hs' && i.legajos.includes('9003')), 'Falla 1c — puesto fijo de turno específico + 24hs: incompatibilidad informada explícitamente')
    ok(rC.nuevos.length === 0, 'Falla 1c — configuración incompatible: no se asigna NADA, ni en el puesto fijo ni en otro sector')

    // 1d) Puesto fijo + PAREJA: el puesto fijo está totalmente ocupado (sin
    // ningún cupo, ni individual ni de a dos) — el efectivo con puesto fijo
    // debe quedar PENDIENTE, nunca recibir "Guardia" (ni individualmente ni
    // como pareja).
    const rD = calcularAsignacionRapida({
      targets: [{ legajo: 'A001', objetivo: 2 }, { legajo: 'B001', objetivo: 2 }],
      legajos24hs: new Set(),
      lugar: 'HIGA', mes: 11, anio: 2026,
      sectores: SECTORES_HIGA, turnosLugar: ['d', 'n'], horasTurno: 12, maxHs: 180,
      dispAll: [...dispTodoElMes('A001', [1, 2], 'n'), ...dispTodoElMes('B001', [1, 2], 'n')],
      // "Estacionamiento" turno noche a tope (2/2) los dos únicos días
      // disponibles — ni A001 solo, ni la pareja, tienen cupo ahí.
      turnosMes: [
        turno('9101', 1, 'n', 'Estacionamiento'), turno('9102', 1, 'n', 'Estacionamiento'),
        turno('9101', 2, 'n', 'Estacionamiento'), turno('9102', 2, 'n', 'Estacionamiento'),
      ],
      reglasPuesto: [{ legajo: 'A001', sector: 'Estacionamiento', turno: 'n' }],
      reglasObjetivo: [],
      especiales: [{ tipo: 'pareja', legajo1: 'A001', legajo2: 'B001' }],
      maxSlot: maxSlotSimple,
    })
    ok(!rD.nuevos.some(n => n.legajo === 'A001'), 'Falla 1d — puesto fijo + pareja con el puesto totalmente ocupado: A001 no recibe NINGUNA guardia (nunca "Guardia" en su lugar)')
    const repD = rD.reporte.find(x => x.legajo === 'A001')
    ok(repD.total === 0 && repD.pendiente === 2, `Falla 1d — A001 queda con el objetivo PENDIENTE (2), informado (reportó total=${repD.total}, pendiente=${repD.pendiente})`)
    ok(repD.detalle.motivo && /puesto fijo/i.test(repD.detalle.motivo), 'Falla 1d — el motivo (puesto fijo sin cupo) queda informado, nunca en silencio')

    // 1e) Los dos integrantes de una pareja con puesto fijo en sectores
    // DISTINTOS: imposible asignarlos juntos en un único sector —
    // incompatibilidad informada, y nunca se los asigna juntos en el mismo
    // turno (cada uno conserva su propio puesto fijo individual).
    const rE = calcularAsignacionRapida({
      targets: [{ legajo: 'A002', objetivo: 2 }, { legajo: 'B002', objetivo: 2 }],
      legajos24hs: new Set(),
      lugar: 'HIGA', mes: 11, anio: 2026,
      sectores: SECTORES_HIGA, turnosLugar: ['d', 'n'], horasTurno: 12, maxHs: 180,
      dispAll: [...dispTodoElMes('A002', [1, 2, 3], 'dn'), ...dispTodoElMes('B002', [1, 2, 3], 'dn')],
      turnosMes: [],
      reglasPuesto: [
        { legajo: 'A002', sector: 'Estacionamiento', turno: null },
        { legajo: 'B002', sector: 'Guardia', turno: null },
      ],
      reglasObjetivo: [],
      especiales: [{ tipo: 'pareja', legajo1: 'A002', legajo2: 'B002' }],
      maxSlot: maxSlotSimple,
    })
    ok(rE.incompatibilidades.some(i => i.tipo === 'pareja_puesto_fijo' && i.legajos.includes('A002') && i.legajos.includes('B002')), 'Falla 1e — pareja con puestos fijos en sectores distintos: incompatibilidad informada')
    const juntosE = rE.nuevos.filter(n => n.legajo === 'A002').some(nA =>
      rE.nuevos.some(nB => nB.legajo === 'B002' && nB.dia === nA.dia && nB.turno === nA.turno && nB.sector === nA.sector))
    ok(!juntosE, 'Falla 1e — nunca se los asigna juntos en el mismo turno/sector (cada uno conserva su puesto fijo individual)')
    ok(rE.nuevos.filter(n => n.legajo === 'A002').every(n => n.sector === 'Estacionamiento'), 'Falla 1e — A002 sigue asignándose SOLO en su propio puesto fijo (Estacionamiento)')
    ok(rE.nuevos.filter(n => n.legajo === 'B002').every(n => n.sector === 'Guardia'), 'Falla 1e — B002 sigue asignándose SOLO en su propio puesto fijo (Guardia)')
  }

  // =========================================================================
  // BUG 6 — "Si falla la consulta de guardias existentes, disponibilidad,
  // reglas u otros destinos, debe detenerse la asignación ANTES de
  // escribir — nunca tratar un error como lista vacía."
  // =========================================================================
  {
    function fetchFnQueFalla(urlQueFalla, status) {
      return async (url) => {
        if (url.includes(urlQueFalla)) return { ok: false, status, json: async () => ({ error: 'boom' }) }
        if (url.includes('admin-disponibilidad')) return { ok: true, status: 200, json: async () => ({ data: [] }) }
        if (url.includes('admin-reglas-puesto')) return { ok: true, status: 200, json: async () => ({ reglas: [] }) }
        if (url.includes('admin-reglas-objetivo')) return { ok: true, status: 200, json: async () => ({ objetivos: [] }) }
        if (url.includes('scope=todas')) return { ok: true, status: 200, json: async () => ({ turnos: [] }) }
        if (url.includes('admin-turnos')) return { ok: true, status: 200, json: async () => ({ turnos: [] }) }
        throw new Error('URL inesperada en la prueba: ' + url)
      }
    }

    const casos = [
      ['admin-disponibilidad', 'disponibilidad'],
      ['admin-reglas-puesto', 'reglas de puesto'],
      ['admin-reglas-objetivo', 'reglas de objetivo'],
    ]
    for (const [urlQueFalla, nombre] of casos) {
      let insertLlamado = false
      const resultado = await ejecutarAsignacionRapida({
        fetchFn: fetchFnQueFalla(urlQueFalla, 500),
        mes: 11, anio: 2026, lugar: 'HIGA',
        sectores: SECTORES_HIGA, turnosLugar: ['d', 'n'], horasTurno: 12, maxHs: 180,
        targets: [{ legajo: '5001', objetivo: 3 }],
        legajos24hs: new Set(),
        maxSlot: maxSlotHIGA,
        insertarFn: async () => { insertLlamado = true; return { error: null } },
      })
      ok(resultado.ok === false, `un error de ${nombre} se reporta como fallo (ok:false), nunca como "no hay nada configurado"`)
      ok(!insertLlamado, `un error de ${nombre} NUNCA llega a intentar guardar ninguna guardia nueva`)
    }

    // La consulta de "otros destinos" (scope=todas) — antes ni siquiera
    // tenía manejo de error. Ahora también debe abortar antes de escribir.
    {
      let insertLlamado = false
      const resultado = await ejecutarAsignacionRapida({
        fetchFn: fetchFnQueFalla('scope=todas', 500),
        mes: 11, anio: 2026, lugar: 'HIGA',
        sectores: SECTORES_HIGA, turnosLugar: ['d', 'n'], horasTurno: 12, maxHs: 180,
        targets: [{ legajo: '5001', objetivo: 3 }],
        legajos24hs: new Set(),
        maxSlot: maxSlotHIGA,
        insertarFn: async () => { insertLlamado = true; return { error: null } },
      })
      ok(resultado.ok === false, 'un error consultando los turnos de los otros destinos se reporta como fallo')
      ok(!insertLlamado, 'un error consultando los otros destinos NUNCA llega a intentar guardar nada')
    }

    // Camino feliz de la orquestación completa (todas las lecturas OK):
    // confirma que, sin ningún error, SÍ llega a guardar.
    {
      let insertRecibido = null
      const fetchFeliz = async (url) => {
        if (url.includes('admin-disponibilidad')) return { ok: true, status: 200, json: async () => ({ data: dispTodoElMes('5002', [1, 2, 3], 'dn') }) }
        if (url.includes('admin-reglas-puesto')) return { ok: true, status: 200, json: async () => ({ reglas: [] }) }
        if (url.includes('admin-reglas-objetivo')) return { ok: true, status: 200, json: async () => ({ objetivos: [] }) }
        if (url.includes('scope=todas')) return { ok: true, status: 200, json: async () => ({ turnos: [] }) }
        if (url.includes('admin-turnos')) return { ok: true, status: 200, json: async () => ({ turnos: [] }) }
        throw new Error('URL inesperada: ' + url)
      }
      const resultado = await ejecutarAsignacionRapida({
        fetchFn: fetchFeliz,
        mes: 11, anio: 2026, lugar: 'HIGA',
        sectores: SECTORES_HIGA, turnosLugar: ['d', 'n'], horasTurno: 12, maxHs: 180,
        targets: [{ legajo: '5002', objetivo: 2 }],
        legajos24hs: new Set(),
        maxSlot: maxSlotHIGA,
        insertarFn: async (nuevos) => { insertRecibido = nuevos; return { error: null } },
      })
      ok(resultado.ok === true, 'camino feliz (todas las lecturas OK): la orquestación termina en ok:true')
      ok(insertRecibido && insertRecibido.length === 2, `camino feliz: SÍ llega a guardar (se intentó guardar ${insertRecibido ? insertRecibido.length : 'nada'}, esperaba 2)`)
    }
  }

  // =========================================================================
  // REGRESIONES explícitas pedidas para cerrar esta entrega.
  // =========================================================================

  // "Guardias previas conservadas": una guardia ya cargada este mes en un
  // sector distinto al puesto fijo nunca se toca ni se duplica, y cuenta
  // contra el objetivo.
  {
    const r = calcularAsignacionRapida({
      targets: [{ legajo: '6001', objetivo: 4 }],
      legajos24hs: new Set(),
      lugar: 'HIGA', mes: 11, anio: 2026,
      sectores: SECTORES_HIGA, turnosLugar: ['d', 'n'], horasTurno: 12, maxHs: 180,
      dispAll: dispTodoElMes('6001', [5, 6, 7, 8, 9, 10], 'dn'),
      turnosMes: [turno('6001', 1, 'd', 'Giratoria')],
      reglasPuesto: [],
      reglasObjetivo: [],
      maxSlot: maxSlotSimple,
    })
    ok(!r.nuevos.some(n => n.dia === 1), 'la guardia previa (día 1) nunca se vuelve a insertar ni se toca')
    // La guardia previa cuenta CONTRA el objetivo (resta del cupo a cubrir
    // en esta corrida): con 1 previa y objetivo 4, esta corrida agrega
    // exactamente 3 nuevas (nunca 4, que sería ignorar la previa y
    // duplicar cupo).
    ok(r.nuevos.length === 3, `la guardia previa descuenta del objetivo: esta corrida agrega exactamente 3 nuevas, no 4 (agregó ${r.nuevos.length})`)
    ok(r.reporte[0].nuevas === 3, `el reporte de esta corrida muestra 3 guardias nuevas agregadas (reportó ${r.reporte[0].nuevas})`)
    // Falla 2: anteriores (1) + nuevas (3) = total (4) = objetivo → pendiente 0.
    ok(r.reporte[0].anteriores === 1 && r.reporte[0].total === 4 && r.reporte[0].pendiente === 0,
      `Falla 2 — anteriores=1, total=4, pendiente=0 (reportó anteriores=${r.reporte[0].anteriores}, total=${r.reporte[0].total}, pendiente=${r.reporte[0].pendiente})`)
  }

  // "Repetir asignación no duplica ni supera objetivo": simular una segunda
  // corrida pasando como `turnosMes` el resultado (ya guardado) de la
  // primera — no debe agregar nada más.
  {
    const primera = calcularAsignacionRapida({
      targets: [{ legajo: '6002', objetivo: 3 }],
      legajos24hs: new Set(),
      lugar: 'HIGA', mes: 11, anio: 2026,
      sectores: SECTORES_HIGA, turnosLugar: ['d', 'n'], horasTurno: 12, maxHs: 180,
      dispAll: dispTodoElMes('6002', [1, 2, 3, 4, 5], 'dn'),
      turnosMes: [],
      reglasPuesto: [],
      reglasObjetivo: [],
      maxSlot: maxSlotSimple,
    })
    ok(primera.nuevos.length === 3, 'primera corrida: asigna las 3 del objetivo')
    const turnosMesSegunda = primera.nuevos.map(n => ({ legajo: n.legajo, dia: n.dia, turno: n.turno, sector: n.sector }))
    const segunda = calcularAsignacionRapida({
      targets: [{ legajo: '6002', objetivo: 3 }],
      legajos24hs: new Set(),
      lugar: 'HIGA', mes: 11, anio: 2026,
      sectores: SECTORES_HIGA, turnosLugar: ['d', 'n'], horasTurno: 12, maxHs: 180,
      dispAll: dispTodoElMes('6002', [1, 2, 3, 4, 5], 'dn'),
      turnosMes: turnosMesSegunda,
      reglasPuesto: [],
      reglasObjetivo: [],
      maxSlot: maxSlotSimple,
    })
    ok(segunda.nuevos.length === 0, `repetir "Asignar" con el objetivo ya cubierto: NO agrega nada de más (agregó ${segunda.nuevos.length})`)
    ok(segunda.reporte[0].nuevas === 0, 'repetir "Asignar": esta segunda corrida no agrega ninguna guardia nueva (0), nunca de más — el objetivo nunca se supera')
    ok(segunda.reporte[0].anteriores === 3 && segunda.reporte[0].total === 3 && segunda.reporte[0].pendiente === 0,
      `Falla 2 — repetir "Asignar": anteriores=3 (lo ya guardado), total=3, pendiente=0 (reportó anteriores=${segunda.reporte[0].anteriores}, total=${segunda.reporte[0].total}, pendiente=${segunda.reporte[0].pendiente})`)
  }

  // Cruce detectado también entre MODULAR y HIGA (no solo HIGA/UPA, Bug 4
  // probó HIGA→UPA; esto confirma que el chequeo cruzado sigue funcionando
  // con el tercer destino).
  {
    const r = calcularAsignacionRapida({
      targets: [{ legajo: '7001', objetivo: 1 }],
      legajos24hs: new Set(),
      lugar: 'MODULAR', mes: 11, anio: 2026,
      sectores: SECTORES_MODULAR, turnosLugar: ['m', 't', 'n'], horasTurno: 8, maxHs: 180,
      dispAll: dispTodoElMes('7001', [15], 'mtn'),
      turnosMes: [],
      reglasPuesto: [],
      reglasObjetivo: [],
      // Turno noche de HIGA (Guardia) el día 15, que se superpone con la
      // franja nocturna real de MODULAR (23:59 día 15 -> 08:00 día 16).
      turnosOtrosLugares: [turno('7001', 15, 'n', 'Guardia')],
      maxSlot: maxSlotSimple,
    })
    ok(r.conflictos.some(c => c.lugarOrigen === 'HIGA'), 'cruce MODULAR↔HIGA detectado y registrado en `conflictos`')
  }

  // "Demás pedidos ya incorporados siguen funcionando": un camino feliz
  // simple, sin ninguna regla especial, sigue repartiendo normalmente hasta
  // el objetivo, respetando el cupo por sector/turno (maxSlot) y el
  // descanso de 12hs entre turno noche→día.
  {
    const r = calcularAsignacionRapida({
      targets: [{ legajo: '8001', objetivo: 3 }],
      legajos24hs: new Set(),
      lugar: 'HIGA', mes: 11, anio: 2026,
      sectores: SECTORES_HIGA, turnosLugar: ['d', 'n'], horasTurno: 12, maxHs: 180,
      dispAll: dispTodoElMes('8001', [1, 2, 3, 4, 5, 6, 7], 'dn'),
      turnosMes: [],
      reglasPuesto: [],
      reglasObjetivo: [],
      maxSlot: maxSlotSimple,
    })
    ok(r.reporte[0].nuevas === 3 && r.reporte[0].total === 3 && r.reporte[0].pendiente === 0 && r.reporte[0].detalle.cumplido, 'camino feliz sin reglas especiales: sigue cubriendo el objetivo con normalidad (comportamiento preexistente, sin cambios)')
    // Nunca dos turnos el mismo día para el mismo efectivo.
    const porDia = {}
    r.nuevos.forEach(n => { porDia[n.dia] = (porDia[n.dia] || 0) + 1 })
    ok(Object.values(porDia).every(c => c === 1), 'nunca asigna dos turnos el mismo día al mismo efectivo (regresión de descanso)')
  }

  console.log('')
  console.log(`Todas las pruebas (${totalOk}) de corrección de la Asignación rápida pasaron.`)
}

main().catch(err => { console.error('Error ejecutando pruebas de asignación rápida:', err); process.exit(1) })
