// lib/tiempoArgentina.js
//
// La ventana de inscripción se define con fechas/horas pensadas en hora de
// Argentina (America/Argentina/Buenos_Aires, UTC-3 todo el año, sin horario
// de verano). El servidor (Vercel) corre en UTC. Si se compara "ahora" tal
// cual lo da `new Date()` contra esas horas sin convertir, la ventana queda
// corrida 3 horas — puede abrirse o cerrarse en el momento equivocado.
//
// Este archivo calcula la hora de pared en Argentina de forma explícita,
// usando Intl.DateTimeFormat con timeZone fijo (soportado nativamente por
// Node, no depende de en qué zona horaria esté configurado el proceso ni
// de ninguna librería externa).

const TZ = 'America/Argentina/Buenos_Aires'

// { anio, mes (1-12), dia, hora, minuto, segundo } — hora de pared en
// Argentina correspondiente a este instante, sin importar la zona horaria
// del servidor.
function ahoraEnArgentina() {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(new Date())
  const obj = {}
  for (const p of partes) obj[p.type] = p.value
  // Intl puede devolver "24" para la medianoche con hour12:false; normalizamos a 0.
  const hora = obj.hour === '24' ? 0 : parseInt(obj.hour, 10)
  return {
    anio: parseInt(obj.year, 10),
    mes: parseInt(obj.month, 10),
    dia: parseInt(obj.day, 10),
    hora,
    minuto: parseInt(obj.minute, 10),
    segundo: parseInt(obj.second, 10),
  }
}

function minutosDelDia({ hora, minuto, segundo }) {
  return hora * 60 + minuto + segundo / 60
}

function compararFecha(a, b) {
  if (a.anio !== b.anio) return a.anio - b.anio
  if (a.mes !== b.mes) return a.mes - b.mes
  return a.dia - b.dia
}

// cfg: fila de la tabla configuracion ({ dia, hora_inicio, hora_fin, mes_apertura, anio_apertura, ... }).
//
// Devuelve true SOLO si estamos, en hora de Argentina, dentro del día y el
// rango horario configurados. Si la configuración falta o está incompleta,
// devuelve false (CERRADA) — antes de este cambio devolvía true (abierta)
// cuando no había configuración, lo que podía habilitar cargas por
// accidente en un período que nadie llegó a configurar todavía. Cerrar por
// defecto es la opción segura: un administrador que de verdad quiera dejar
// cargar tiene que configurar la ventana explícitamente, y mientras tanto
// sigue existiendo la carga administrativa fuera de término para casos
// puntuales.
function estaVentanaAbierta(cfg, ahora = ahoraEnArgentina()) {
  if (!cfg || !cfg.dia || !cfg.hora_inicio || !cfg.hora_fin) return false

  const diaV = parseInt(cfg.dia, 10)
  if (!Number.isInteger(diaV) || diaV < 1 || diaV > 31) return false

  const mesAp = cfg.mes_apertura || ahora.mes
  const anioAp = cfg.anio_apertura || ahora.anio

  const fechaVentana = { anio: anioAp, mes: mesAp, dia: diaV }
  if (compararFecha(ahora, fechaVentana) !== 0) return false

  const [hIni, mIni] = String(cfg.hora_inicio).split(':').map(Number)
  const [hFin, mFin] = String(cfg.hora_fin).split(':').map(Number)
  if (!Number.isFinite(hIni) || !Number.isFinite(hFin)) return false

  const minutosAhora = minutosDelDia(ahora)
  const minutosIni = hIni * 60 + (mIni || 0)
  const minutosFin = hFin * 60 + (mFin || 0)
  return minutosAhora >= minutosIni && minutosAhora <= minutosFin
}

module.exports = { TZ, ahoraEnArgentina, estaVentanaAbierta, minutosDelDia, compararFecha }
