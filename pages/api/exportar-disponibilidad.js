// pages/api/exportar-disponibilidad.js
//
// TEMPORAL — copia de resguardo de la disponibilidad cargada (solo para el administrador).
// Se borra del repositorio cuando ya no haga falta.
//
// SOLO LEE. No inserta, no modifica y no borra nada en ninguna tabla.
//
// Se abre desde el navegador, en cualquiera de los tres sitios, con el mismo código temporal del tablero:
//   /api/exportar-disponibilidad?codigo=<código>                 (diciembre 2026, los tres lugares)
//   /api/exportar-disponibilidad?codigo=<código>&mes=11&anio=2026 (otro mes)
//
// Descarga un Excel con:
//   · Control      → cuántas filas hay por lugar (para chequear que la copia está completa)
//   · Crudo        → TODAS las columnas de la tabla disponibilidad, tal cual están en la base (sirve para restaurar)
//   · Detalle      → una fila por día y turno, con nombre, escalafón y sexo
//   · Por persona  → una fila por efectivo, con los días que cargó
//   · Resumen día  → cuántos hay por día y turno, por lugar
//   · Sin cargar   → efectivos que no cargaron nada

import { createClient } from '@supabase/supabase-js'
import ExcelJS from 'exceljs'
import crypto from 'crypto'

export const config = { maxDuration: 60, api: { responseLimit: false } }

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Mismo código temporal que usan prueba-disponibilidad.js y tablero-efectivos.js
const CODIGO = '4ce167bc8dcb991f446d27cf'

const LUGARES = ['HIGA', 'UPA', 'MODULAR']
const MESES_LARGO = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
const DIAS_SEM = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
const NOMBRE_TURNO = { d: 'Día', n: 'Noche', m: 'Mañana', t: 'Tarde' }

function codigoValido(c) {
  if (typeof c !== 'string' || c.length !== CODIGO.length) return false
  return crypto.timingSafeEqual(Buffer.from(c), Buffer.from(CODIGO))
}

const norm = x => (x === null || x === undefined) ? '' : String(x).trim().toUpperCase()

// Lee una tabla por páginas (Supabase entrega como máximo 1000 filas por consulta).
async function leer(tabla, filtros) {
  const PAG = 1000
  const todas = []
  for (let desde = 0; desde < 200000; desde += PAG) {
    let q = supabase.from(tabla).select('*')
    Object.entries(filtros || {}).forEach(([k, v]) => { q = q.eq(k, v) })
    const r = await q.order('id', { ascending: true }).range(desde, desde + PAG - 1)
    if (r.error) throw new Error(`No se pudo leer ${tabla}: ${r.error.message}`)
    todas.push(...(r.data || []))
    if ((r.data || []).length < PAG) break
  }
  return todas
}

function turnosDe(lugar) { return lugar === 'MODULAR' ? ['m', 't', 'n'] : ['d', 'n'] }
function textoTurno(lugar, t) {
  const s = String(t || '').toLowerCase()
  return turnosDe(lugar).filter(x => s.includes(x)).map(x => NOMBRE_TURNO[x]).join(' y ') || String(t || '')
}

function encabezado(ws, anchos) {
  ws.columns = anchos.map(([header, width]) => ({ header, width }))
  const f = ws.getRow(1)
  f.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  f.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3A5F' } }
  ws.views = [{ state: 'frozen', ySplit: 1 }]
}

function construirLibro({ crudo, efectivos, mes, anio, generado }) {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'POLAD'
  const nombreMes = MESES_LARGO[mes - 1]
  const diasMes = new Date(anio, mes, 0).getDate()

  // índice de efectivos por lugar + legajo
  const ficha = {}
  efectivos.forEach(e => { ficha[norm(e.lugar) + '|' + norm(e.legajo)] = e })

  // ---- Detalle (una fila por día y turno) ----
  const detalle = []
  crudo.forEach(r => {
    const lugar = norm(r.lugar)
    const e = ficha[lugar + '|' + norm(r.legajo)]
    const dia = parseInt(r.dia, 10)
    const f = new Date(anio, mes - 1, dia)
    detalle.push({
      lugar, legajo: String(r.legajo || '').trim(), nombre: e ? e.nombre : '(sin ficha en Personal)',
      tipo: e ? e.tipo : '', sexo: e ? e.sexo : '', dia, fecha: f, semana: DIAS_SEM[f.getDay()],
      turno: textoTurno(lugar, r.turno), turnoCrudo: String(r.turno || ''),
    })
  })
  detalle.sort((a, b) => a.lugar.localeCompare(b.lugar) || a.nombre.localeCompare(b.nombre) || a.dia - b.dia)

  // ---- Control ----
  const wsC = wb.addWorksheet('Control')
  encabezado(wsC, [['Lugar', 14], ['Filas en la base (tabla disponibilidad)', 38], ['Efectivos que cargaron', 24], ['Efectivos en Personal', 24], ['Sin cargar', 14]])
  const resumenCtl = {}
  LUGARES.forEach(lugar => {
    const filas = crudo.filter(r => norm(r.lugar) === lugar)
    const legajos = new Set(filas.map(r => norm(r.legajo)))
    const efs = efectivos.filter(e => norm(e.lugar) === lugar && e.es_admin === false)
    const cargaron = efs.filter(e => legajos.has(norm(e.legajo))).length
    resumenCtl[lugar] = { filas: filas.length, cargaron, total: efs.length }
    wsC.addRow([lugar, filas.length, cargaron, efs.length, efs.length - cargaron])
  })
  const tot = Object.values(resumenCtl).reduce((a, x) => ({ filas: a.filas + x.filas, cargaron: a.cargaron + x.cargaron, total: a.total + x.total }), { filas: 0, cargaron: 0, total: 0 })
  const filaTot = wsC.addRow(['TOTAL', tot.filas, tot.cargaron, tot.total, tot.total - tot.cargaron]); filaTot.font = { bold: true }
  wsC.addRow([])
  wsC.addRow([`Copia de la disponibilidad de ${nombreMes} ${anio}, sacada el ${generado}.`])
  wsC.addRow(['Es una copia de lectura: no modifica nada en el sistema.'])

  // ---- Crudo (todas las columnas tal cual) ----
  const wsR = wb.addWorksheet('Crudo')
  const cols = []
  crudo.forEach(r => Object.keys(r).forEach(k => { if (!cols.includes(k)) cols.push(k) }))
  if (!cols.length) cols.push('(sin datos)')
  encabezado(wsR, cols.map(c => [c, Math.max(10, Math.min(30, c.length + 4))]))
  crudo.forEach(r => wsR.addRow(cols.map(c => r[c] === undefined ? null : (typeof r[c] === 'object' && r[c] !== null ? JSON.stringify(r[c]) : r[c]))))

  // ---- Detalle ----
  const wsD = wb.addWorksheet('Detalle')
  encabezado(wsD, [['Lugar', 12], ['Legajo', 12], ['Apellido y nombre', 34], ['Escalafón', 16], ['Sexo', 12], ['Día', 6], ['Fecha', 12], ['Día de la semana', 16], ['Turno', 18], ['Turno (código)', 14]])
  detalle.forEach(d => wsD.addRow([d.lugar, d.legajo, d.nombre, d.tipo, d.sexo, d.dia, d.fecha, d.semana, d.turno, d.turnoCrudo]))
  wsD.getColumn(7).numFmt = 'dd/mm/yyyy'
  wsD.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 10 } }

  // ---- Por persona ----
  const wsP = wb.addWorksheet('Por persona')
  encabezado(wsP, [['Lugar', 12], ['Legajo', 12], ['Apellido y nombre', 34], ['Escalafón', 16], ['Sexo', 12], ['Cantidad de días', 16], ['Días cargados (D=Día N=Noche M=Mañana T=Tarde)', 70]])
  const porPersona = {}
  detalle.forEach(d => {
    const k = d.lugar + '|' + norm(d.legajo)
    if (!porPersona[k]) porPersona[k] = { d, dias: {} }
    porPersona[k].dias[d.dia] = d.turnoCrudo.toUpperCase()
  })
  Object.values(porPersona).sort((a, b) => a.d.lugar.localeCompare(b.d.lugar) || a.d.nombre.localeCompare(b.d.nombre)).forEach(p => {
    const dias = Object.keys(p.dias).map(Number).sort((a, b) => a - b)
    wsP.addRow([p.d.lugar, p.d.legajo, p.d.nombre, p.d.tipo, p.d.sexo, dias.length, dias.map(x => `${x}${p.dias[x]}`).join('  ')])
  })
  wsP.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 7 } }

  // ---- Resumen por día ----
  const wsS = wb.addWorksheet('Resumen día')
  encabezado(wsS, [['Lugar', 12], ['Día', 6], ['Fecha', 12], ['Día de la semana', 16], ['Día (D)', 10], ['Noche (N)', 10], ['Mañana (M)', 11], ['Tarde (T)', 10]])
  LUGARES.forEach(lugar => {
    const ts = turnosDe(lugar)
    for (let d = 1; d <= diasMes; d++) {
      const f = new Date(anio, mes - 1, d)
      const filas = crudo.filter(r => norm(r.lugar) === lugar && parseInt(r.dia, 10) === d)
      const cuenta = t => ts.includes(t) ? filas.filter(r => String(r.turno || '').toLowerCase().includes(t)).length : null
      wsS.addRow([lugar, d, f, DIAS_SEM[f.getDay()], cuenta('d'), cuenta('n'), cuenta('m'), cuenta('t')])
    }
  })
  wsS.getColumn(3).numFmt = 'dd/mm/yyyy'

  // ---- Sin cargar ----
  const wsN = wb.addWorksheet('Sin cargar')
  encabezado(wsN, [['Lugar', 12], ['Legajo', 12], ['Apellido y nombre', 34], ['Escalafón', 16], ['Sexo', 12], ['Teléfono', 16]])
  efectivos.filter(e => e.es_admin === false).forEach(e => {
    const lugar = norm(e.lugar)
    if (!LUGARES.includes(lugar)) return
    const cargo = crudo.some(r => norm(r.lugar) === lugar && norm(r.legajo) === norm(e.legajo))
    if (!cargo) wsN.addRow([lugar, String(e.legajo || '').trim(), e.nombre, e.tipo, e.sexo, e.telefono || ''])
  })

  return { wb, resumenCtl }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Robots-Tag', 'noindex')
  if (req.method !== 'GET') return res.status(405).send('Método no permitido')
  if (!codigoValido(String(req.query.codigo || ''))) return res.status(401).send('Código incorrecto.')

  const anio = parseInt(req.query.anio, 10) || 2026
  let mes = parseInt(req.query.mes, 10) || 12
  if (mes < 1 || mes > 12) mes = 12

  try {
    let crudo = []
    let efectivos = []
    for (const lugar of LUGARES) {
      crudo = crudo.concat(await leer('disponibilidad', { lugar, mes, anio }))
      efectivos = efectivos.concat(await leer('efectivos', { lugar }))
    }
    const generado = new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })
    const { wb } = construirLibro({ crudo, efectivos, mes, anio, generado })
    const buf = await wb.xlsx.writeBuffer()
    const ahora = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' }))
    const p = n => String(n).padStart(2, '0')
    const sello = `${ahora.getFullYear()}${p(ahora.getMonth() + 1)}${p(ahora.getDate())}_${p(ahora.getHours())}${p(ahora.getMinutes())}`
    const nombre = `POLAD_Disponibilidad_${MESES_LARGO[mes - 1]}_${anio}_copia_${sello}.xlsx`
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename="${nombre}"`)
    return res.status(200).send(Buffer.from(buf))
  } catch (e) {
    console.error('[exportar-disponibilidad]', e)
    return res.status(500).send('No se pudo armar la copia: ' + e.message)
  }
}
