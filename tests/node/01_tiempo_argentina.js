// Prueba REAL (no simulada: usa el Intl real de Node, sin mockear Date) de
// lib/tiempoArgentina.js — punto 5 y 9 de la revisión ("Usá explícitamente
// America/Argentina/Buenos_Aires... aunque el servidor esté en UTC" /
// "Horarios de Argentina con servidor en UTC").
//
// Para que esta prueba sea honesta hay que correrla con el proceso en UTC,
// que es como corre el servidor real (Vercel). Se fuerza acá arriba con
// process.env.TZ ANTES de requerir nada de Node que dependa de la zona
// horaria del proceso — pero además, para no depender de si Node ya cacheó
// algo, la forma correcta y recomendada de correr este archivo es:
//
//   TZ=UTC node tests/node/01_tiempo_argentina.js
//
// (ambas formas se usan: el env var puesto afuera, por si se corre con el
// comando de arriba, y el fallback adentro, para que igual sirva si alguien
// lo corre con un `node tests/node/01_tiempo_argentina.js` suelto).
process.env.TZ = 'UTC'

const assert = require('assert')
const { estaVentanaAbierta, ahoraEnArgentina, compararFecha } = require('../../lib/tiempoArgentina')

let okCount = 0
function ok(nombre) { okCount++; console.log(`OK - ${nombre}`) }

// ----------------------------------------------------------------------------
// 1) Con el proceso en UTC (confirmado abajo), ahoraEnArgentina() tiene que
//    devolver la hora de pared de Buenos Aires (UTC-3, sin horario de
//    verano), no la hora UTC del proceso ni la hora "local" del contenedor.
// ----------------------------------------------------------------------------
assert.strictEqual(new Date().getTimezoneOffset(), 0, 'Esta prueba necesita correr con el proceso en UTC (TZ=UTC) para ser representativa del servidor real.')
ok('el proceso de esta prueba está realmente en UTC (igual que el servidor en producción)')

{
  // Referencia independiente: tomamos "ahora" en UTC con el Date nativo (que
  // en este proceso en UTC coincide con reloj UTC) y restamos 3hs a mano,
  // SIN usar Intl ni lib/tiempoArgentina — para no validar la función contra
  // sí misma.
  const ahoraUTC = new Date()
  const esperadoMs = ahoraUTC.getTime() - 3 * 60 * 60 * 1000
  const esperado = new Date(esperadoMs)
  const real = ahoraEnArgentina()

  assert.strictEqual(real.anio, esperado.getUTCFullYear(), `año: esperado ${esperado.getUTCFullYear()}, obtenido ${real.anio}`)
  assert.strictEqual(real.mes, esperado.getUTCMonth() + 1, `mes: esperado ${esperado.getUTCMonth() + 1}, obtenido ${real.mes}`)
  assert.strictEqual(real.dia, esperado.getUTCDate(), `día: esperado ${esperado.getUTCDate()}, obtenido ${real.dia}`)
  assert.strictEqual(real.hora, esperado.getUTCHours(), `hora: esperado ${esperado.getUTCHours()}, obtenido ${real.hora}`)
  // Los minutos se comparan con 1 minuto de tolerancia por si el reloj avanzó
  // entre ambas lecturas (son dos llamadas separadas, no instantáneas).
  assert.ok(Math.abs(real.minuto - esperado.getUTCMinutes()) <= 1, `minuto: esperado ~${esperado.getUTCMinutes()}, obtenido ${real.minuto}`)
  ok('ahoraEnArgentina() está 3 horas detrás de UTC (servidor UTC, resultado Argentina) para el instante actual')
}

// ----------------------------------------------------------------------------
// 2) El caso que de verdad importa para "servidor en UTC": un instante que
//    cruza la medianoche UTC tiene que caer en el DÍA CORRECTO de Argentina
//    (un día antes), no en el día UTC. Esto se prueba con un instante FIJO
//    (no depende de "ahora"), usando la misma técnica de Intl.DateTimeFormat
//    con timeZone explícito que usa lib/tiempoArgentina.js — así se verifica
//    la técnica en sí, con un caso elegido a mano y verificable por cualquiera.
// ----------------------------------------------------------------------------
function argentinaParaInstanteFijo(fechaISO) {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(fechaISO))
  const o = {}
  for (const p of partes) o[p.type] = p.value
  return { anio: parseInt(o.year, 10), mes: parseInt(o.month, 10), dia: parseInt(o.day, 10), hora: o.hour === '24' ? 0 : parseInt(o.hour, 10), minuto: parseInt(o.minute, 10) }
}

{
  // 05/11/2026 02:30 UTC = 04/11/2026 23:30 en Argentina (UTC-3): cruza la
  // medianoche UTC hacia el día anterior en Argentina.
  const r = argentinaParaInstanteFijo('2026-11-05T02:30:00Z')
  assert.deepStrictEqual(r, { anio: 2026, mes: 11, dia: 4, hora: 23, minuto: 30 },
    `Instante fijo cruzando medianoche UTC convertido mal: ${JSON.stringify(r)}`)
  ok('un instante fijo que cruza la medianoche UTC cae en el día correcto de Argentina (un día antes)')
}
{
  // 05/11/2026 03:00 UTC = 05/11/2026 00:00 en Argentina: el mismo día UTC,
  // ya entrado en el nuevo día en Argentina también.
  const r = argentinaParaInstanteFijo('2026-11-05T03:00:00Z')
  assert.deepStrictEqual(r, { anio: 2026, mes: 11, dia: 5, hora: 0, minuto: 0 },
    `Instante fijo en el borde de la medianoche Argentina convertido mal: ${JSON.stringify(r)}`)
  ok('el borde exacto de la medianoche de Argentina (03:00 UTC) se calcula correctamente')
}

// ----------------------------------------------------------------------------
// 3) estaVentanaAbierta: cerrada por defecto si falta/está incompleta la
//    configuración (cambio deliberado de este round de correcciones — antes
//    quedaba abierta por defecto).
// ----------------------------------------------------------------------------
assert.strictEqual(estaVentanaAbierta(null), false); ok('sin configuración → cerrada (no undefined/throw, y no abierta)')
assert.strictEqual(estaVentanaAbierta({}), false); ok('configuración vacía → cerrada')
assert.strictEqual(estaVentanaAbierta({ dia: 5 }), false); ok('configuración sin horarios → cerrada')
assert.strictEqual(estaVentanaAbierta({ dia: 5, hora_inicio: '08:00' }), false); ok('configuración sin hora_fin → cerrada')

// ----------------------------------------------------------------------------
// 4) estaVentanaAbierta: bordes exactos de inicio/fin (ambos inclusive),
//    usando un `ahora` inyectado (mismo mecanismo que usan los endpoints:
//    la función acepta `ahora` para no depender del reloj real en estos
//    casos de borde).
// ----------------------------------------------------------------------------
const cfgBase = { dia: 10, hora_inicio: '08:00', hora_fin: '20:00', mes_apertura: 11, anio_apertura: 2026 }

assert.strictEqual(estaVentanaAbierta(cfgBase, { anio: 2026, mes: 11, dia: 10, hora: 8, minuto: 0, segundo: 0 }), true)
ok('ventana abierta exactamente en el minuto de inicio (08:00, inclusive)')

assert.strictEqual(estaVentanaAbierta(cfgBase, { anio: 2026, mes: 11, dia: 10, hora: 7, minuto: 59, segundo: 59 }), false)
ok('ventana cerrada un segundo antes del inicio')

assert.strictEqual(estaVentanaAbierta(cfgBase, { anio: 2026, mes: 11, dia: 10, hora: 20, minuto: 0, segundo: 0 }), true)
ok('ventana abierta exactamente en el minuto de fin (20:00, inclusive)')

assert.strictEqual(estaVentanaAbierta(cfgBase, { anio: 2026, mes: 11, dia: 10, hora: 20, minuto: 0, segundo: 1 }), false)
ok('ventana cerrada un segundo después del fin')

assert.strictEqual(estaVentanaAbierta(cfgBase, { anio: 2026, mes: 11, dia: 11, hora: 12, minuto: 0, segundo: 0 }), false)
ok('ventana cerrada en un día distinto al configurado, aunque la hora esté en rango')

// ----------------------------------------------------------------------------
// 5) mes_apertura/anio_apertura: si no se configuran, se toman del `ahora`
//    recibido (comportamiento ya existente, confirmado con esta prueba).
// ----------------------------------------------------------------------------
const cfgSinMesApertura = { dia: 10, hora_inicio: '08:00', hora_fin: '20:00' }
assert.strictEqual(estaVentanaAbierta(cfgSinMesApertura, { anio: 2026, mes: 11, dia: 10, hora: 9, minuto: 0, segundo: 0 }), true)
ok('sin mes_apertura/anio_apertura configurados, se usa el mes/año de "ahora"')

console.log(`\n================ TODAS LAS PRUEBAS DE HORARIO ARGENTINA (${okCount}) PASARON ================`)
