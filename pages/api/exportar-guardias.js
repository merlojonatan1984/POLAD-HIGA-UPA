// pages/api/exportar-guardias.js
//
// TEMPORAL — copia de resguardo de las GUARDIAS asignadas (solo para el administrador).
// Se borra del repositorio cuando ya no haga falta.
//
// SOLO LEE. No inserta, no modifica y no borra nada en ninguna tabla.
//
// Se abre desde el navegador, en cualquiera de los tres sitios, con el mismo código temporal del tablero:
//   /api/exportar-guardias?codigo=<código>&mes=11&anio=2026
//   /api/exportar-guardias?codigo=<código>&mes=12&anio=2026
//
// Descarga un Excel con las guardias (tabla turnos) del mes pedido, de HIGA, UPA y MODULAR:
//   · Control      → cuántas guardias hay por lugar y por sector
//   · Crudo        → TODAS las columnas de la tabla turnos, tal cual están en la base (sirve para restaurar)
//   · Por persona  → cuántas guardias tiene cada efectivo y en qué días

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


// Sectores de cada lugar (los mismos que usa el admin para separar HIGA / UPA / MODULAR)
const SECTORES_HIGA = ['Salud Mental', 'Giratoria', 'Llaves', 'Guardia', 'Estacionamiento', 'Rondin Externo']
function lugarDeSector(sector) {
  const s = String(sector || '')
  if (s === 'UPA') return 'UPA'
  if (s === 'Modular') return 'MODULAR'
  if (SECTORES_HIGA.includes(s)) return 'HIGA'
  return 'OTRO'
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
  const nombreDe = {}
  efectivos.forEach(e => { const k = norm(e.legajo); if (!nombreDe[k]) nombreDe[k] = e.nombre })

  // ---- Control ----
  const wsC = wb.addWorksheet('Control')
  encabezado(wsC, [['Lugar', 22], ['Guardias en la base (tabla turnos)', 34], ['Efectivos con guardias', 24]])
  const porLugar = {}
  crudo.forEach(r => { const l = lugarDeSector(r.sector); (porLugar[l] = porLugar[l] || []).push(r) })
  ;[...LUGARES, 'OTRO'].forEach(l => {
    const filas = porLugar[l] || []
    if (l === 'OTRO' && !filas.length) return
    wsC.addRow([l === 'OTRO' ? 'OTRO (sector no reconocido)' : l, filas.length, new Set(filas.map(r => norm(r.legajo))).size])
  })
  const filaTot = wsC.addRow(['TOTAL', crudo.length, new Set(crudo.map(r => norm(r.legajo))).size]); filaTot.font = { bold: true }
  wsC.addRow([])
  const filaSec = wsC.addRow(['Por sector', 'Guardias']); filaSec.font = { bold: true }
  const porSector = {}
  crudo.forEach(r => { const s = String(r.sector || '(sin sector)'); porSector[s] = (porSector[s] || 0) + 1 })
  Object.entries(porSector).sort((a, b) => b[1] - a[1]).forEach(([s, n]) => wsC.addRow([s, n]))
  wsC.addRow([])
  wsC.addRow([`Copia de las guardias de ${nombreMes} ${anio}, sacada el ${generado}.`])
  wsC.addRow(['Es una copia de lectura: no modifica nada en el sistema.'])

  // ---- Crudo ----
  const wsR = wb.addWorksheet('Crudo')
  const cols = []
  crudo.forEach(r => Object.keys(r).forEach(k => { if (!cols.includes(k)) cols.push(k) }))
  if (!cols.length) cols.push('(sin datos)')
  encabezado(wsR, cols.map(c => [c, Math.max(10, Math.min(30, c.length + 4))]))
  crudo.forEach(r => wsR.addRow(cols.map(c => r[c] === undefined ? null : (typeof r[c] === 'object' && r[c] !== null ? JSON.stringify(r[c]) : r[c]))))

  // ---- Por persona ----
  const wsP = wb.addWorksheet('Por persona')
  encabezado(wsP, [['Legajo', 12], ['Apellido y nombre', 34], ['Total de guardias', 16], ['HIGA', 8], ['UPA', 8], ['MODULAR', 10], ['Detalle (día y turno)', 90]])
  const personas = {}
  crudo.forEach(r => {
    const k = norm(r.legajo)
    if (!personas[k]) personas[k] = { legajo: String(r.legajo || '').trim(), filas: [] }
    personas[k].filas.push(r)
  })
  Object.values(personas).map(p => ({ ...p, nombre: nombreDe[norm(p.legajo)] || '(sin ficha)' }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre)).forEach(p => {
      const cuenta = l => p.filas.filter(r => lugarDeSector(r.sector) === l).length
      const det = p.filas.slice().sort((a, b) => parseInt(a.dia, 10) - parseInt(b.dia, 10)).map(r => `${r.dia}${String(r.turno || '').toUpperCase()}`).join('  ')
      wsP.addRow([p.legajo, p.nombre, p.filas.length, cuenta('HIGA'), cuenta('UPA'), cuenta('MODULAR'), det])
    })
  wsP.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 7 } }
  return wb
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
    const crudo = await leer('turnos', { mes, anio })
    const efectivos = await leer('efectivos', {})
    const generado = new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })
    const wb = construirLibro({ crudo, efectivos, mes, anio, generado })
    const buf = await wb.xlsx.writeBuffer()
    const ahora = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' }))
    const p = n => String(n).padStart(2, '0')
    const sello = `${ahora.getFullYear()}${p(ahora.getMonth() + 1)}${p(ahora.getDate())}_${p(ahora.getHours())}${p(ahora.getMinutes())}`
    const nombre = `POLAD_Guardias_${MESES_LARGO[mes - 1]}_${anio}_copia_${sello}.xlsx`
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename="${nombre}"`)
    return res.status(200).send(Buffer.from(buf))
  } catch (e) {
    console.error('[exportar-guardias]', e)
    return res.status(500).send('No se pudo armar la copia: ' + e.message)
  }
}
