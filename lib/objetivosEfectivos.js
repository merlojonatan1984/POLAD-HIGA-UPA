// lib/objetivosEfectivos.js
//
// Lógica PURA (sin red, sin React, sin Supabase) para el punto "Objetivos
// individuales configurables" de esta ronda. Se extrae a un módulo aparte,
// igual que ya se hizo con lib/generarTurnosFlujo.js, para poder probarla
// con un test real de Node (tests/node/03_objetivos_efectivos.js) sin tener
// que montar pages/admin.js completo. pages/admin.js (cargarRapida /
// procesarRapida) importa estas funciones; el algoritmo de asignación en sí
// (a quién le toca qué día/turno/sector) NO se reimplementa acá — estas
// funciones solo resuelven "cuál es la meta en guardias" y "qué turnos
// corresponden según el turno configurado", nunca inventan disponibilidad
// ni deciden asignaciones.

// Convierte el objetivo configurado (tipo 'horas' o 'guardias') a una
// cantidad de GUARDIAS — la unidad que ya maneja procesarRapida — usando la
// duración real del turno en ese lugar (12 en HIGA/UPA, 8 en MODULAR).
// Redondea hacia ABAJO a propósito: nunca se "inventa" una guardia parcial
// de más solo para acercarse a un número de horas que no es múltiplo
// exacto de la duración del turno.
function objetivoEnGuardias(objetivoConfigurado, horasTurno) {
  if (!objetivoConfigurado || !horasTurno) return null
  const { tipo, cantidad } = objetivoConfigurado
  const n = Number(cantidad)
  if (!Number.isFinite(n) || n < 0) return null
  if (tipo === 'guardias') return Math.floor(n)
  if (tipo === 'horas') return Math.floor(n / horasTurno)
  return null
}

// Un objetivo configurado explícitamente (efectivo_objetivo) tiene SIEMPRE
// prioridad sobre el objetivo "derivado" que procesarRapida ya calculaba
// antes de este punto (igual a la cantidad de guardias del mes anterior).
// Si no hay configuración para ese efectivo+lugar, se sigue usando el
// derivado — comportamiento anterior sin cambios.
function resolverObjetivoGuardias({ objetivoConfigurado, objetivoDerivado, horasTurno }) {
  const enGuardias = objetivoEnGuardias(objetivoConfigurado, horasTurno)
  if (enGuardias !== null) return enGuardias
  return objetivoDerivado || 0
}

// Filtra la lista de turnos del lugar (['d','n'] en HIGA/UPA, ['m','t','n']
// en MODULAR) según turno_objetivo ('dia'|'noche'|'ambos'). 'ambos' (o
// ausencia de configuración) no filtra nada — comportamiento anterior. En
// MODULAR no existe una sola franja "día": 'dia' agrupa mañana+tarde ('m' y
// 't'), porque son las dos franjas diurnas; 'noche' es únicamente 'n'.
function turnosPermitidosPorObjetivo(turnosLugar, turnoObjetivo) {
  if (!turnoObjetivo || turnoObjetivo === 'ambos') return turnosLugar
  if (turnoObjetivo === 'noche') return turnosLugar.filter(t => t === 'n')
  if (turnoObjetivo === 'dia') return turnosLugar.filter(t => t !== 'n')
  return turnosLugar
}

// Resume para la pantalla (sin forzar cruces ni inventar disponibilidad):
// cuánto se asignó realmente contra la meta ya calculada por procesarRapida,
// cuánto falta, y un motivo legible cuando no se llegó al 100% — nunca
// afirma que se cumplió si no se cumplió.
function resumenObjetivo({ asignadas, meta, motivoSiFalta }) {
  const a = Math.max(0, Number(asignadas) || 0)
  const m = Math.max(0, Number(meta) || 0)
  const pendiente = Math.max(0, m - a)
  return {
    asignadas: a,
    meta: m,
    pendiente,
    cumplido: pendiente === 0,
    motivo: pendiente > 0
      ? (motivoSiFalta || 'No hay suficiente disponibilidad cargada, o se alcanzarían restricciones vigentes (descanso de 12hs, tope de 180hs, cupo del sector, o cruce de horario con otro destino) para cubrir el resto del objetivo.')
      : null,
  }
}

module.exports = { objetivoEnGuardias, resolverObjetivoGuardias, turnosPermitidosPorObjetivo, resumenObjetivo }
