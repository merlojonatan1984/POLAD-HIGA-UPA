// tests/node/03_objetivos_efectivos.js
//
// Punto 3 de esta ronda ("Objetivos individuales configurables"): prueba
// REAL de JavaScript (no SQL) del módulo puro lib/objetivosEfectivos.js —
// el mismo que importa y usa pages/admin.js (cargarRapida/procesarRapida)
// para reemplazar el objetivo derivado del mes anterior cuando existe una
// configuración individual, y para restringir el turno (día/noche/ambos).
//
// Corre con: node tests/node/03_objetivos_efectivos.js

const {
  objetivoEnGuardias,
  resolverObjetivoGuardias,
  turnosPermitidosPorObjetivo,
  resumenObjetivo,
} = require('../../lib/objetivosEfectivos')

let totalOk = 0
function ok(cond, msg) {
  if (!cond) { console.error('FALLO: ' + msg); process.exit(1) }
  console.log('  ok  — ' + msg)
  totalOk++
}
function eq(a, b, msg) {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    console.error(`FALLO: ${msg}\n  esperado: ${JSON.stringify(b)}\n  obtenido: ${JSON.stringify(a)}`)
    process.exit(1)
  }
  console.log('  ok  — ' + msg)
  totalOk++
}

console.log('=== Objetivos individuales configurables (JavaScript puro, sin red) ===')

// ── objetivoEnGuardias ──────────────────────────────────────────────────
eq(objetivoEnGuardias(null, 12), null, 'objetivoEnGuardias: sin configuración devuelve null (para que el caller use el derivado del mes anterior)')
eq(objetivoEnGuardias({ tipo: 'guardias', cantidad: 6 }, 12), 6, 'objetivoEnGuardias: tipo guardias devuelve la cantidad tal cual (Coronel: 3 guardias en HIGA)')
eq(objetivoEnGuardias({ tipo: 'horas', cantidad: 180 }, 12), 15, 'objetivoEnGuardias: 180 horas en HIGA (12hs/turno) = 15 guardias (Guillermo Solís)')
eq(objetivoEnGuardias({ tipo: 'horas', cantidad: 180 }, 8), 22, 'objetivoEnGuardias: 180 horas en MODULAR (8hs/turno) = 22 guardias (floor(22.5))')
eq(objetivoEnGuardias({ tipo: 'horas', cantidad: 100 }, 12), 8, 'objetivoEnGuardias: redondea hacia ABAJO (100/12 = 8.33 -> 8), nunca inventa una guardia parcial de más')
eq(objetivoEnGuardias({ tipo: 'guardias', cantidad: -1 }, 12), null, 'objetivoEnGuardias: cantidad negativa se trata como configuración inválida (null), no se usa')
eq(objetivoEnGuardias({ tipo: 'otra_cosa', cantidad: 5 }, 12), null, 'objetivoEnGuardias: tipo desconocido devuelve null')

// ── resolverObjetivoGuardias: el configurado tiene prioridad; sin
//    configuración, se preserva el comportamiento anterior (el derivado) ──
eq(
  resolverObjetivoGuardias({ objetivoConfigurado: null, objetivoDerivado: 9, horasTurno: 12 }),
  9,
  'resolverObjetivoGuardias: sin configuración, usa el objetivo derivado del mes anterior (comportamiento anterior sin cambios)'
)
eq(
  resolverObjetivoGuardias({ objetivoConfigurado: { tipo: 'guardias', cantidad: 3 }, objetivoDerivado: 9, horasTurno: 12 }),
  3,
  'resolverObjetivoGuardias: con configuración (Coronel: 3), reemplaza al derivado (9) aunque sean distintos'
)
eq(
  resolverObjetivoGuardias({ objetivoConfigurado: { tipo: 'horas', cantidad: 180 }, objetivoDerivado: 0, horasTurno: 12 }),
  15,
  'resolverObjetivoGuardias: funciona igual aunque el derivado sea 0 (efectivo nuevo sin guardias el mes anterior, caso Guillermo Solís/Pablo Leiva)'
)

// ── turnosPermitidosPorObjetivo ──────────────────────────────────────────
eq(turnosPermitidosPorObjetivo(['d', 'n'], 'ambos'), ['d', 'n'], 'turnosPermitidosPorObjetivo: ambos no filtra nada (HIGA/UPA)')
eq(turnosPermitidosPorObjetivo(['d', 'n'], undefined), ['d', 'n'], 'turnosPermitidosPorObjetivo: sin turno_objetivo configurado, no filtra nada (comportamiento anterior)')
eq(turnosPermitidosPorObjetivo(['d', 'n'], 'noche'), ['n'], 'turnosPermitidosPorObjetivo: "noche" en HIGA/UPA deja solo el turno n')
eq(turnosPermitidosPorObjetivo(['d', 'n'], 'dia'), ['d'], 'turnosPermitidosPorObjetivo: "dia" en HIGA/UPA deja solo el turno d')
eq(turnosPermitidosPorObjetivo(['m', 't', 'n'], 'dia'), ['m', 't'], 'turnosPermitidosPorObjetivo: en MODULAR, "dia" agrupa mañana+tarde (no hay una sola franja diurna)')
eq(turnosPermitidosPorObjetivo(['m', 't', 'n'], 'noche'), ['n'], 'turnosPermitidosPorObjetivo: en MODULAR, "noche" es únicamente la franja n')

// ── resumenObjetivo: nunca fuerza nada, solo describe lo ya calculado ───
eq(
  resumenObjetivo({ asignadas: 15, meta: 15 }),
  { asignadas: 15, meta: 15, pendiente: 0, cumplido: true, motivo: null },
  'resumenObjetivo: objetivo cumplido exactamente -> pendiente=0, motivo=null'
)
{
  const r = resumenObjetivo({ asignadas: 10, meta: 15 })
  ok(r.pendiente === 5 && r.cumplido === false && typeof r.motivo === 'string' && r.motivo.length > 0,
    'resumenObjetivo: objetivo NO cumplido (10 de 15) -> pendiente=5, cumplido=false, con un motivo legible (nunca "se cumplió" cuando no se cumplió)')
}
eq(
  resumenObjetivo({ asignadas: 0, meta: 0 }),
  { asignadas: 0, meta: 0, pendiente: 0, cumplido: true, motivo: null },
  'resumenObjetivo: sin objetivo configurado (meta=0) y sin asignaciones -> cumplido (no hay nada pendiente que reportar como falta)'
)

console.log(`\n${totalOk} verificaciones pasaron. Todas las pruebas de objetivos individuales (JavaScript puro) pasaron.`)
