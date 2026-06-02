import ExcelJS from 'exceljs'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']

const SECTORES_POR_LUGAR = {
  'HIGA': ['Salud Mental', 'Giratoria', 'Llaves', 'Guardia', 'Estacionamiento'],
  'UPA': ['UPA'],
  'MODULAR': ['Modular']
}

const HORAS_POR_LUGAR = { 'HIGA': 12, 'UPA': 12, 'MODULAR': 8 }

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()
  const { mes, anio, lugar } = req.query
  if (!mes || !anio) return res.status(400).json({ error: 'Faltan parámetros' })
  const MES = parseInt(mes)
  const ANIO = parseInt(anio)
  const APP_LUGAR = lugar || process.env.NEXT_PUBLIC_LUGAR || 'HIGA'
  const NOMBRE_MES = MESES[MES - 1] + ' ' + ANIO
  const SECTORES_APP = SECTORES_POR_LUGAR[APP_LUGAR] || SECTORES_POR_LUGAR['HIGA']
  const ES_MODULAR = APP_LUGAR === 'MODULAR'
  const HORAS_TURNO = HORAS_POR_LUGAR[APP_LUGAR] || 12

  const [{ data: efectivos }, { data: turnos }] = await Promise.all([
    supabase.from('efectivos').select('legajo, nombre, tipo, jerarquia').eq('es_admin', false).eq('lugar', APP_LUGAR).order('nombre'),
    supabase.from('turnos').select('legajo, turno, sector').eq('mes', MES).eq('anio', ANIO).in('sector', SECTORES_APP)
  ])

  const conteo = {}
  ;(turnos || []).forEach(t => {
    if (!conteo[t.legajo]) conteo[t.legajo] = { total: 0, t1: 0, t2: 0, t3: 0 }
    conteo[t.legajo].total++
    if (ES_MODULAR) {
      if (t.turno === 'm') conteo[t.legajo].t1++
      else if (t.turno === 't') conteo[t.legajo].t2++
      else if (t.turno === 'n') conteo[t.legajo].t3++
    } else {
      if (t.turno === 'd') conteo[t.legajo].t1++
      else conteo[t.legajo].t2++
    }
  })

  const conTurnos = (efectivos || []).filter(e => (conteo[e.legajo]?.total || 0) > 0)
  const sinTurnos = (efectivos || []).filter(e => (conteo[e.legajo]?.total || 0) === 0)

  const COLORES = {
    'HIGA':    { navy: 'FF1a3a6b', title: 'FF85B7EB' },
    'UPA':     { navy: 'FF7a3a10', title: 'FFD85A30' },
    'MODULAR': { navy: 'FF0a3a44', title: 'FF20A0B0' }
  }
  const COL = COLORES[APP_LUGAR] || COLORES['HIGA']
  const NAVY = COL.navy
  const WHITE = 'FFFFFFFF'
  const BLACK = 'FF111111'
  const RED = 'FF8b4040'

  const wb = new ExcelJS.Workbook()
  const b = (s = 'thin') => ({ top: { style: s }, bottom: { style: s }, left: { style: s }, right: { style: s } })
  const a = (h = 'center') => ({ horizontal: h, vertical: 'middle' })
  const f = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } })

  const ws = wb.addWorksheet(`Guardias ${APP_LUGAR}`)
  ws.pageSetup = { orientation: 'portrait', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.5, right: 0.5, top: 0.5, bottom: 0.5, header: 0, footer: 0 } }

  // Columnas según lugar
  const headers = ES_MODULAR
    ? ['N°', 'Apellido y Nombre', 'Legajo', 'Jerarquía', 'Guardias', 'Mañana', 'Tarde', 'Noche', 'Horas']
    : ['N°', 'Apellido y Nombre', 'Legajo', 'Jerarquía', 'Guardias', 'Día', 'Noche', 'Horas']

  const colWidths = ES_MODULAR
    ? [6, 42, 12, 20, 11, 9, 9, 9, 9]
    : [6, 42, 12, 20, 11, 9, 9, 9]

  colWidths.forEach((w, i) => { ws.getColumn(i + 1).width = w })

  const totalCols = headers.length
  const lastCol = String.fromCharCode(64 + totalCols)

  ws.mergeCells(`A1:${lastCol}1`); ws.getRow(1).height = 22
  Object.assign(ws.getCell('A1'), {
    value: `POLICIA ADICIONAL · MINISTERIO DE SEGURIDAD · MAR DEL PLATA — ${APP_LUGAR}`,
    font: { name: 'Arial', bold: true, size: 9, color: { argb: WHITE } },
    fill: f(NAVY), alignment: a(), border: b('medium')
  })

  ws.mergeCells(`A2:${lastCol}2`); ws.getRow(2).height = 28
  Object.assign(ws.getCell('A2'), {
    value: `RESUMEN DE GUARDIAS DESIGNADAS — ${APP_LUGAR} — ${NOMBRE_MES.toUpperCase()}`,
    font: { name: 'Arial', bold: true, size: 13, color: { argb: NAVY } },
    fill: f('FFf5f8ff'), alignment: a(), border: b()
  })

  ws.mergeCells(`A3:${lastCol}3`); ws.getRow(3).height = 16
  Object.assign(ws.getCell('A3'), {
    value: `Efectivos con guardias: ${conTurnos.length}   ·   Sin guardias: ${sinTurnos.length}`,
    font: { name: 'Arial', size: 9, color: { argb: 'FF444444' } },
    fill: f('FFfafafa'), alignment: a(), border: b()
  })

  ws.getRow(4).height = 20
  headers.forEach((h, i) => {
    const c = ws.getCell(4, i + 1)
    c.value = h; c.font = { name: 'Arial', bold: true, size: 9, color: { argb: WHITE } }
    c.fill = f(NAVY); c.alignment = a(i === 1 ? 'left' : 'center'); c.border = b()
  })

  let totalG = 0, totalT1 = 0, totalT2 = 0, totalT3 = 0
  conTurnos.forEach((ef, idx) => {
    const c = conteo[ef.legajo] || { total: 0, t1: 0, t2: 0, t3: 0 }
    totalG += c.total; totalT1 += c.t1; totalT2 += c.t2; totalT3 += c.t3
    const row = 5 + idx
    const bg = idx % 2 === 0 ? 'FFffffff' : 'FFf0f4f8'
    ws.getRow(row).height = 17

    const valores = ES_MODULAR
      ? [idx + 1, ef.nombre, ef.legajo, ef.jerarquia || '—', c.total, c.t1, c.t2, c.t3, c.total * HORAS_TURNO]
      : [idx + 1, ef.nombre, ef.legajo, ef.jerarquia || '—', c.total, c.t1, c.t2, c.total * HORAS_TURNO]

    valores.forEach((v, i) => {
      const cell = ws.getCell(row, i + 1)
      cell.value = v; cell.fill = f(bg)
      cell.alignment = a(i === 1 ? 'left' : 'center'); cell.border = b('thin')
      cell.font = { name: 'Arial', size: 9, bold: i >= 4, color: { argb: i === 4 ? NAVY : BLACK } }
    })
  })

  const ft = 5 + conTurnos.length; ws.getRow(ft).height = 20
  const totales = ES_MODULAR
    ? ['', `TOTAL ${APP_LUGAR}`, '', '', totalG, totalT1, totalT2, totalT3, totalG * HORAS_TURNO]
    : ['', `TOTAL ${APP_LUGAR}`, '', '', totalG, totalT1, totalT2, totalG * HORAS_TURNO]

  totales.forEach((v, i) => {
    const cell = ws.getCell(ft, i + 1)
    cell.value = v; cell.font = { name: 'Arial', bold: true, size: 10, color: { argb: WHITE } }
    cell.fill = f(NAVY); cell.alignment = a(i === 1 ? 'left' : 'center'); cell.border = b('medium')
  })

  if (sinTurnos.length > 0) {
    const ws2 = wb.addWorksheet('Sin guardias')
    ws2.getColumn(1).width = 6; ws2.getColumn(2).width = 42; ws2.getColumn(3).width = 12; ws2.getColumn(4).width = 16
    ws2.mergeCells('A1:D1'); ws2.getRow(1).height = 22
    Object.assign(ws2.getCell('A1'), {
      value: `SIN GUARDIAS ASIGNADAS — ${APP_LUGAR} — ${NOMBRE_MES.toUpperCase()}`,
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
  res.setHeader('Content-Disposition', `attachment; filename="Resumen_${APP_LUGAR}_${NOMBRE_MES.replace(' ', '_')}.xlsx"`)
  res.send(Buffer.from(buffer))
}
