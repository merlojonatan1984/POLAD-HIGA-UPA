import ExcelJS from 'exceljs'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']

const SECTORES_HIGA = ['Salud Mental', 'Giratoria', 'Llaves', 'Guardia', 'Estacionamiento']
const SECTORES_UPA = ['UPA']
const SECTORES_MODULAR = ['Modular']

function getLugarDeSector(sector) {
  if (SECTORES_HIGA.includes(sector)) return 'HIGA'
  if (SECTORES_UPA.includes(sector)) return 'UPA'
  if (SECTORES_MODULAR.includes(sector)) return 'MODULAR'
  return 'HIGA'
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()
  const { mes, anio } = req.query
  if (!mes || !anio) return res.status(400).json({ error: 'Faltan parámetros' })
  const MES = parseInt(mes)
  const ANIO = parseInt(anio)
  const NOMBRE_MES = MESES[MES - 1] + ' ' + ANIO

  const [{ data: efectivos }, { data: turnos }] = await Promise.all([
    supabase.from('efectivos').select('legajo, nombre, tipo, jerarquia').eq('es_admin', false).order('nombre'),
    // FIX: traer sector para poder separar por lugar
    supabase.from('turnos').select('legajo, turno, sector').eq('mes', MES).eq('anio', ANIO)
  ])

  // FIX: contar por lugar separado
  const conteo = {}
  ;(turnos || []).forEach(t => {
    const lugar = getLugarDeSector(t.sector)
    if (!conteo[t.legajo]) conteo[t.legajo] = {
      HIGA: { total: 0, dia: 0, noche: 0 },
      UPA:  { total: 0, dia: 0, noche: 0 },
      MODULAR: { total: 0, dia: 0, noche: 0 },
      total: 0, dia: 0, noche: 0
    }
    conteo[t.legajo][lugar].total++
    conteo[t.legajo].total++
    if (t.turno === 'd') { conteo[t.legajo][lugar].dia++; conteo[t.legajo].dia++ }
    else { conteo[t.legajo][lugar].noche++; conteo[t.legajo].noche++ }
  })

  const NAVY = 'FF1a3a6b', WHITE = 'FFFFFFFF', BLACK = 'FF111111', RED = 'FF8b4040'
  const GREEN = 'FF1a5c3a', ORANGE = 'FF7a3a10', TEAL = 'FF0a3a44'

  const wb = new ExcelJS.Workbook()

  const b = (s = 'thin') => ({ top: { style: s }, bottom: { style: s }, left: { style: s }, right: { style: s } })
  const a = (h = 'center') => ({ horizontal: h, vertical: 'middle' })
  const f = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } })

  // ── Función para crear una hoja de resumen por lugar ──
  function crearHoja(nombre, lugar, colorNavy) {
    const efectivosConTurnos = (efectivos || []).filter(e => (conteo[e.legajo]?.[lugar]?.total || 0) > 0)
    const efectivosSin = (efectivos || []).filter(e => (conteo[e.legajo]?.[lugar]?.total || 0) === 0)

    const ws = wb.addWorksheet(nombre)
    ws.pageSetup = {
      orientation: 'portrait', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0,
      margins: { left: 0.5, right: 0.5, top: 0.5, bottom: 0.5, header: 0, footer: 0 }
    }
    ws.getColumn(1).width = 6
    ws.getColumn(2).width = 42
    ws.getColumn(3).width = 12
    ws.getColumn(4).width = 20
    ws.getColumn(5).width = 11
    ws.getColumn(6).width = 9
    ws.getColumn(7).width = 9
    ws.getColumn(8).width = 9

    // Fila 1: título
    ws.mergeCells('A1:H1'); ws.getRow(1).height = 22
    Object.assign(ws.getCell('A1'), {
      value: `POLICIA ADICIONAL · MINISTERIO DE SEGURIDAD · MAR DEL PLATA — ${lugar}`,
      font: { name: 'Arial', bold: true, size: 9, color: { argb: WHITE } },
      fill: f(colorNavy), alignment: a(), border: b('medium')
    })

    // Fila 2: subtítulo
    ws.mergeCells('A2:H2'); ws.getRow(2).height = 28
    Object.assign(ws.getCell('A2'), {
      value: `RESUMEN DE GUARDIAS DESIGNADAS — ${NOMBRE_MES.toUpperCase()} — ${lugar}`,
      font: { name: 'Arial', bold: true, size: 13, color: { argb: colorNavy } },
      fill: f('FFf5f8ff'), alignment: a(), border: b()
    })

    // Fila 3: conteo
    ws.mergeCells('A3:H3'); ws.getRow(3).height = 16
    Object.assign(ws.getCell('A3'), {
      value: `Efectivos con guardias en ${lugar}: ${efectivosConTurnos.length}   ·   Sin guardias: ${efectivosSin.length}`,
      font: { name: 'Arial', size: 9, color: { argb: 'FF444444' } },
      fill: f('FFfafafa'), alignment: a(), border: b()
    })

    // Fila 4: encabezados
    ws.getRow(4).height = 20
    ;['N°', 'Apellido y Nombre', 'Legajo', 'Jerarquía', 'Guardias', 'Día', 'Noche', 'Horas'].forEach((h, i) => {
      const c = ws.getCell(4, i + 1)
      c.value = h
      c.font = { name: 'Arial', bold: true, size: 9, color: { argb: WHITE } }
      c.fill = f(colorNavy); c.alignment = a(i === 1 ? 'left' : 'center'); c.border = b()
    })

    // Filas de datos
    let totalG = 0, totalD = 0, totalN = 0
    efectivosConTurnos.forEach((ef, idx) => {
      const c = conteo[ef.legajo]?.[lugar] || { total: 0, dia: 0, noche: 0 }
      totalG += c.total; totalD += c.dia; totalN += c.noche
      const row = 5 + idx
      const bg = idx % 2 === 0 ? 'FFffffff' : 'FFf0f4f8'
      ws.getRow(row).height = 17
      ;[idx + 1, ef.nombre, ef.legajo, ef.jerarquia || '—', c.total, c.dia, c.noche, c.total * 12].forEach((v, i) => {
        const cell = ws.getCell(row, i + 1)
        cell.value = v; cell.fill = f(bg)
        cell.alignment = a(i === 1 ? 'left' : 'center'); cell.border = b('thin')
        cell.font = { name: 'Arial', size: 9, bold: i >= 4, color: { argb: i === 4 ? colorNavy : BLACK } }
      })
    })

    // Fila de total
    const ft = 5 + efectivosConTurnos.length; ws.getRow(ft).height = 20
    ;['', 'TOTAL ' + lugar, '', '', totalG, totalD, totalN, totalG * 12].forEach((v, i) => {
      const cell = ws.getCell(ft, i + 1)
      cell.value = v
      cell.font = { name: 'Arial', bold: true, size: 10, color: { argb: WHITE } }
      cell.fill = f(colorNavy); cell.alignment = a(i === 1 ? 'left' : 'center'); cell.border = b('medium')
    })

    return ws
  }

  // Crear hoja por lugar
  crearHoja('HIGA', 'HIGA', NAVY)
  crearHoja('UPA', 'UPA', 'FF7a3a10')
  crearHoja('MODULAR', 'MODULAR', 'FF0a3a44')

  // ── Hoja resumen general ──
  const wsTotal = wb.addWorksheet('TOTAL GENERAL')
  wsTotal.pageSetup = { orientation: 'portrait', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.5, right: 0.5, top: 0.5, bottom: 0.5, header: 0, footer: 0 } }
  wsTotal.getColumn(1).width = 6
  wsTotal.getColumn(2).width = 38
  wsTotal.getColumn(3).width = 12
  wsTotal.getColumn(4).width = 18
  wsTotal.getColumn(5).width = 10
  wsTotal.getColumn(6).width = 8
  wsTotal.getColumn(7).width = 8
  wsTotal.getColumn(8).width = 8
  wsTotal.getColumn(9).width = 10
  wsTotal.getColumn(10).width = 8
  wsTotal.getColumn(11).width = 8
  wsTotal.getColumn(12).width = 8
  wsTotal.getColumn(13).width = 10

  wsTotal.mergeCells('A1:M1'); wsTotal.getRow(1).height = 22
  Object.assign(wsTotal.getCell('A1'), {
    value: 'POLICIA ADICIONAL · MINISTERIO DE SEGURIDAD · MAR DEL PLATA — TOTAL GENERAL',
    font: { name: 'Arial', bold: true, size: 9, color: { argb: WHITE } },
    fill: f(NAVY), alignment: a(), border: b('medium')
  })

  wsTotal.mergeCells('A2:M2'); wsTotal.getRow(2).height = 28
  Object.assign(wsTotal.getCell('A2'), {
    value: `RESUMEN GENERAL DE GUARDIAS — ${NOMBRE_MES.toUpperCase()}`,
    font: { name: 'Arial', bold: true, size: 13, color: { argb: NAVY } },
    fill: f('FFf5f8ff'), alignment: a(), border: b()
  })

  // Encabezados con grupos por lugar
  wsTotal.getRow(3).height = 16
  const grupos = [
    { col: 5, label: 'HIGA', cols: 4, color: NAVY },
    { col: 9, label: 'UPA', cols: 4, color: 'FF7a3a10' },
  ]
  // Fila 3: nombre lugar
  wsTotal.mergeCells(3, 1, 3, 4)
  wsTotal.getCell(3, 1).value = ''
  wsTotal.mergeCells(3, 5, 3, 8)
  Object.assign(wsTotal.getCell(3, 5), { value: 'HIGA', font: { name: 'Arial', bold: true, size: 9, color: { argb: WHITE } }, fill: f(NAVY), alignment: a(), border: b() })
  wsTotal.mergeCells(3, 9, 3, 12)
  Object.assign(wsTotal.getCell(3, 9), { value: 'UPA', font: { name: 'Arial', bold: true, size: 9, color: { argb: WHITE } }, fill: f('FF7a3a10'), alignment: a(), border: b() })
  wsTotal.getCell(3, 13).value = ''
  Object.assign(wsTotal.getCell(3, 13), { value: 'MODULAR', font: { name: 'Arial', bold: true, size: 9, color: { argb: WHITE } }, fill: f('FF0a3a44'), alignment: a(), border: b() })

  // Fila 4: encabezados columnas
  wsTotal.getRow(4).height = 20
  const cols4 = ['N°', 'Apellido y Nombre', 'Legajo', 'Jerarquía', 'Guard.', 'Día', 'Noche', 'Hs', 'Guard.', 'Día', 'Noche', 'Hs', 'Hs MOD']
  cols4.forEach((h, i) => {
    const c = wsTotal.getCell(4, i + 1)
    const color = i >= 4 && i <= 7 ? NAVY : i >= 8 && i <= 11 ? 'FF7a3a10' : i === 12 ? 'FF0a3a44' : NAVY
    c.value = h; c.font = { name: 'Arial', bold: true, size: 8, color: { argb: WHITE } }
    c.fill = f(color); c.alignment = a(i === 1 ? 'left' : 'center'); c.border = b()
  })

  const efConAlgo = (efectivos || []).filter(e => (conteo[e.legajo]?.total || 0) > 0)
  let gtH = 0, gtU = 0, gtM = 0
  efConAlgo.forEach((ef, idx) => {
    const row = 5 + idx
    const bg = idx % 2 === 0 ? 'FFffffff' : 'FFf0f4f8'
    wsTotal.getRow(row).height = 17
    const cH = conteo[ef.legajo]?.HIGA || { total: 0, dia: 0, noche: 0 }
    const cU = conteo[ef.legajo]?.UPA || { total: 0, dia: 0, noche: 0 }
    const cM = conteo[ef.legajo]?.MODULAR || { total: 0, dia: 0, noche: 0 }
    gtH += cH.total; gtU += cU.total; gtM += cM.total
    const vals = [idx + 1, ef.nombre, ef.legajo, ef.jerarquia || '—', cH.total, cH.dia, cH.noche, cH.total * 12, cU.total, cU.dia, cU.noche, cU.total * 12, cM.total * 12]
    vals.forEach((v, i) => {
      const cell = wsTotal.getCell(row, i + 1)
      cell.value = v || (i < 4 ? (v === 0 ? '' : v) : 0)
      cell.fill = f(bg); cell.alignment = a(i === 1 ? 'left' : 'center'); cell.border = b('thin')
      cell.font = { name: 'Arial', size: 9, bold: i >= 4, color: { argb: BLACK } }
    })
  })

  const ftT = 5 + efConAlgo.length; wsTotal.getRow(ftT).height = 20
  const valsTotal = ['', 'TOTAL GENERAL', '', '', gtH, '', '', gtH * 12, gtU, '', '', gtU * 12, gtM * 12]
  valsTotal.forEach((v, i) => {
    const cell = wsTotal.getCell(ftT, i + 1)
    cell.value = v; cell.font = { name: 'Arial', bold: true, size: 10, color: { argb: WHITE } }
    cell.fill = f(NAVY); cell.alignment = a(i === 1 ? 'left' : 'center'); cell.border = b('medium')
  })

  // ── Hoja sin guardias ──
  const sinTurnos = (efectivos || []).filter(e => (conteo[e.legajo]?.total || 0) === 0)
  if (sinTurnos.length > 0) {
    const ws2 = wb.addWorksheet('Sin guardias')
    ws2.getColumn(1).width = 6; ws2.getColumn(2).width = 42; ws2.getColumn(3).width = 12; ws2.getColumn(4).width = 16
    ws2.mergeCells('A1:D1'); ws2.getRow(1).height = 22
    Object.assign(ws2.getCell('A1'), {
      value: `SIN GUARDIAS ASIGNADAS — ${NOMBRE_MES.toUpperCase()}`,
      font: { name: 'Arial', bold: true, size: 11, color: { argb: WHITE } },
      fill: f(RED), alignment: a(), border: b('medium')
    })
    ws2.getRow(2).height = 18
    ;['N°', 'Apellido y Nombre', 'Legajo', 'Escalafón'].forEach((h, i) => {
      const c = ws2.getCell(2, i + 1)
      c.value = h; c.font = { name: 'Arial', bold: true, size: 9, color: { argb: WHITE } }
      c.fill = f(RED); c.alignment = a(i === 1 ? 'left' : 'center'); c.border = b()
    })
    sinTurnos.forEach((ef, idx) => {
      const row = 3 + idx; const bg = idx % 2 === 0 ? 'FFfff5f5' : 'FFffe8e8'
      ws2.getRow(row).height = 16
      ;[idx + 1, ef.nombre, ef.legajo, ef.tipo || ''].forEach((v, i) => {
        const cell = ws2.getCell(row, i + 1)
        cell.value = v; cell.fill = f(bg); cell.alignment = a(i === 1 ? 'left' : 'center'); cell.border = b('thin')
        cell.font = { name: 'Arial', size: 9, color: { argb: 'FF444444' } }
      })
    })
  }

  const buffer = await wb.xlsx.writeBuffer()
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', `attachment; filename="Resumen_Guardias_${NOMBRE_MES.replace(' ', '_')}.xlsx"`)
  res.send(Buffer.from(buffer))
}
