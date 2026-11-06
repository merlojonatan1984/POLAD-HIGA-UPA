// lib/ventanaCarga.js
//
// NUEVO. Una sola regla para saber si la carga de disponibilidad está abierta,
// con el reloj del SERVIDOR y en hora de Argentina (UTC-3, sin horario de
// verano). La usan /api/guardar-disponibilidad (para aceptar o no un guardado)
// y /api/verificar-sesion (para que la pantalla del efectivo quede en negro
// cuando está cerrado). Así las dos siempre coinciden.

const OFFSET_AR_HS = 3

function ahoraArgentina(ahoraMs = Date.now()) {
  const d = new Date(ahoraMs - OFFSET_AR_HS * 3600 * 1000)
  return { mes: d.getUTCMonth() + 1, anio: d.getUTCFullYear() }
}

// Instante (ms UTC) de una fecha/hora escrita en hora de Argentina
function instanteAR(anio, mes, dia, hora, minuto) {
  return Date.UTC(anio, mes - 1, dia, hora + OFFSET_AR_HS, minuto)
}

function partesHora(txt, porDefecto) {
  const [h, m] = (txt || porDefecto).split(':').map(Number)
  return [Number.isFinite(h) ? h : 0, Number.isFinite(m) ? m : 0]
}

// cfg = fila de la tabla "configuracion" del lugar. Sin configuración o sin
// día cargado, está cerrado.
export function ventanaAbierta(cfg, ahoraMs = Date.now()) {
  if (!cfg || !cfg.dia) return false
  const hoy = ahoraArgentina(ahoraMs)
  const mesAp = cfg.mes_apertura || hoy.mes
  const anioAp = cfg.anio_apertura || hoy.anio
  const dia = parseInt(cfg.dia, 10)
  const [hIni, mIni] = partesHora(cfg.hora_inicio, '08:00')
  const [hFin, mFin] = partesHora(cfg.hora_fin, '20:00')
  const inicio = instanteAR(anioAp, mesAp, dia, hIni, mIni)
  const fin = instanteAR(anioAp, mesAp, dia, hFin, mFin)
  return ahoraMs >= inicio && ahoraMs <= fin
}
