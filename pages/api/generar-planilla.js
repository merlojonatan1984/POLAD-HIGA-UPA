import ExcelJS from 'exceljs'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

function fmtNombre(ef) {
  // Intentar usar jerarquia del campo jerarquia primero
  // Si no, parsear del nombre que viene como "SARGENTO (S.G.) APELLIDO, NOMBRE"
  const nombre = ef.nombre || ''
  let jer = ef.jerarquia || ''
  let resto = nombre

  // Si no hay jerarquia pero el nombre empieza con una jerarquia conocida, extraerla
  if (!jer) {
    const matchJer = nombre.match(/^(OFICIAL\s*\([^)]*\)|SARGENTO\s*\([^)]*\)|CABO\s*\([^)]*\)|SUBOFICIAL\s*\([^)]*\)|INSPECTOR\s*\([^)]*\)|SUBINSPECTOR\s*\([^)]*\)|COMISARIO\s*\([^)]*\)|OFICIAL|SARGENTO|CABO|SUBOFICIAL)\s+/i)
    if (matchJer) {
      jer = matchJer[0].trim()
      resto = nombre.slice(matchJer[0].length).trim()
    }
  }

  // Ahora parsear apellido e inicial del nombre
  const partes = resto.split(',')
  const apellido = partes[0]?.trim() || resto
  const inicial = partes[1]?.trim()[0] ? partes[1].trim()[0] + '.' : ''

  // Abreviar jerarquia larga
  const abreviar = (j) => j
    .replace(/SARGENTO\s*\(S\.G\.\)/i, 'Sgto.(S.G.)')
    .replace(/SARGENTO\s*1°\s*\(S\.G\.\)/i, 'Sgto.1°(S.G.)')
    .replace(/SARGENTO\s*1°/i, 'Sgto.1°')
    .replace(/SARGENTO/i, 'Sgto.')
    .replace(/OFICIAL\s*\(S\.G\.\)/i, 'Of.(S.G.)')
    .replace(/OFICIAL\s*PRINCIPAL/i, 'Of.Ppal.')
    .replace(/OFICIAL/i, 'Of.')
    .replace(/CABO\s*\(S\.G\.\)/i, 'Cabo(S.G.)')
    .replace(/CABO/i, 'Cabo')
    .replace(/SUBOFICIAL/i, 'Subof.')
    .replace(/COMISARIO\s*INSPECTOR/i, 'Crio.Insp.')
    .replace(/COMISARIO/i, 'Crio.')
    .replace(/INSPECTOR/i, 'Insp.')
    .replace(/SUBINSPECTOR/i, 'Sub.Insp.')

  const jerAbrev = jer ? abreviar(jer) : ''
  return jerAbrev ? `${jerAbrev} ${apellido} ${inicial}`.trim() : `${apellido} ${inicial}`.trim()
}

function aplicarBorde(celda, top, bot, left, right) {
  const T = s => s ? { style: s } : { style: 'thin' }
  celda.border = {
    top: T(top), bottom: T(bot), left: T(left), right: T(right)
  }
}

function fill(color) {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + color } }
}

function font(bold = false, size = 9, color = '000000') {
  return { name: 'Arial', bold, size, color: { argb: 'FF' + color } }
}

function aln(h = 'center', wrap = false) {
  return { horizontal: h, vertical: 'middle', wrapText: wrap }
}

// ── HIGA ──────────────────────────────────────────────────────────────
async function generarHIGA(wb, turnoKey, gds, sectores, mes, anio, diasMes, nombreMes) {
  const turnoStr = turnoKey === 'd' ? 'TURNO DÍA  08:00 a 20:00' : 'TURNO NOCHE  20:00 a 08:00'
  const C_HDR    = turnoKey === 'd' ? 'B8860B' : '1A3A6B'
  const C_SEC    = turnoKey === 'd' ? 'FFF3CC' : 'D6E8FF'
  const C_EF1    = turnoKey === 'd' ? 'FFFBF0' : 'EDF4FF'
  const C_EF2    = turnoKey === 'd' ? 'FFF0C0' : 'C8DEFF'
  const C_VACIO  = turnoKey === 'd' ? 'FAF6E8' : 'EBF2FF'
  const C_TIT    = turnoKey === 'd' ? 'C8A84B' : '85B7EB'

  const rangos = [[1, 10], [11, 20], [21, diasMes]]

  rangos.forEach(([d1, d2]) => {
    const dias = Array.from({ length: d2 - d1 + 1 }, (_, i) => i + d1)
    const ws = wb.addWorksheet(`Días ${d1}-${d2}`)

    ws.pageSetup = {
      orientation: 'portrait',
      paperSize: 9,
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 1,
      horizontalCentered: true,
      margins: { left: 0.15, right: 0.15, top: 0.2, bottom: 0.2, header: 0, footer: 0 }
    }

    // Anchos
    ws.getColumn(1).width = 4.5   // DIA
    ws.getColumn(2).width = 2.0   // #
    sectores.forEach((_, i) => { ws.getColumn(3 + i).width = 16.5 })

    const lastCol = 2 + sectores.length
    const lastColLetter = ws.getColumn(lastCol).letter

    // Altos
    ws.getRow(1).height = 26
    ws.getRow(2).height = 18
    for (let r = 3; r <= 2 + dias.length * 2; r++) ws.getRow(r).height = 47
    const pieRow = 3 + dias.length * 2
    ws.getRow(pieRow).height = 13

    ws.pageSetup.printArea = `A1:${lastColLetter}${pieRow}`

    // TÍTULO
    ws.mergeCells(`A1:${lastColLetter}1`)
    const tit = ws.getCell('A1')
    tit.value = `POLAD · HIGA  —  ${turnoStr}  —  ${nombreMes}  (Días ${d1} al ${d2})`
    tit.font = { name: 'Arial', bold: true, size: 11, color: { argb: 'FF' + C_TIT } }
    tit.alignment = aln('center')
    tit.fill = fill('1a1a2e')
    tit.border = { top: { style: 'medium' }, bottom: { style: 'medium' }, left: { style: 'medium' }, right: { style: 'medium' } }

    // HEADER
    const hdrDia = ws.getCell('A2')
    hdrDia.value = 'DÍA'; hdrDia.font = font(true, 9, 'FFFFFF')
    hdrDia.alignment = aln(); hdrDia.fill = fill('2d2d44')
    hdrDia.border = { top: { style: 'medium' }, bottom: { style: 'medium' }, left: { style: 'medium' }, right: { style: 'medium' } }

    const hdrNum = ws.getCell('B2')
    hdrNum.value = '#'; hdrNum.font = font(true, 8, 'FFFFFF')
    hdrNum.alignment = aln(); hdrNum.fill = fill('2d2d44')
    hdrNum.border = { top: { style: 'medium' }, bottom: { style: 'medium' }, left: { style: 'thin' }, right: { style: 'medium' } }

    sectores.forEach((sec, j) => {
      const cell = ws.getCell(2, 3 + j)
      cell.value = sec; cell.font = font(true, 8, 'FFFFFF')
      cell.alignment = aln('center', true); cell.fill = fill(C_HDR)
      const isLast = j === sectores.length - 1
      cell.border = { top: { style: 'medium' }, bottom: { style: 'medium' }, left: { style: 'thin' }, right: { style: isLast ? 'medium' : 'thin' } }
    })

    // DATOS
    let fila = 3
    dias.forEach((dia, di) => {
      const isFirstDia = di === 0
      const isLastDia  = di === dias.length - 1

      for (let en = 1; en <= 2; en++) {
        const ife = en === 1
        const ile = en === 2
        const topS = isFirstDia && ife ? 'medium' : 'thin'
        const botS = isLastDia && ile ? 'medium' : ile ? 'medium' : 'thin'
        const bgEf = ife ? C_EF1 : C_EF2

        // Col A — Día
        const cDia = ws.getCell(fila, 1)
        cDia.value = ife ? dia : ''
        cDia.font = font(true, 10, 'FFFFFF')
        cDia.alignment = aln()
        cDia.fill = fill(C_HDR)
        cDia.border = { top: { style: topS }, bottom: { style: botS }, left: { style: 'medium' }, right: { style: 'medium' } }

        // Col B — Número
        const cNum = ws.getCell(fila, 2)
        cNum.value = en
        cNum.font = font(true, 7, '888888')
        cNum.alignment = aln()
        cNum.fill = fill(C_SEC)
        cNum.border = { top: { style: topS }, bottom: { style: botS }, left: { style: 'thin' }, right: { style: 'medium' } }

        // Sectores
        sectores.forEach((sec, j) => {
          const isLastCol = j === sectores.length - 1
          const nm = gds[dia]?.[sec]?.[en - 1] || ''
          const cell = ws.getCell(fila, 3 + j)
          cell.value = nm
          cell.font = font(false, 7, '111122')
          cell.alignment = aln('center', true)
          cell.fill = fill(nm ? bgEf : C_VACIO)
          cell.border = {
            top: { style: topS }, bottom: { style: botS },
            left: { style: 'thin' }, right: { style: isLastCol ? 'medium' : 'thin' }
          }
        })
        fila++
      }
    })

    // PIE
    ws.mergeCells(`A${pieRow}:${lastColLetter}${pieRow}`)
    const pie = ws.getCell(`A${pieRow}`)
    pie.value = `POLAD · HIGA · UPA · MODULAR — Mar del Plata — ${nombreMes}`
    pie.font = { name: 'Arial', size: 7.5, italic: true, color: { argb: 'FF8b90a0' } }
    pie.alignment = aln()
    pie.fill = fill('1a1a2e')
    pie.border = { top: { style: 'medium' }, bottom: { style: 'medium' }, left: { style: 'medium' }, right: { style: 'medium' } }
  })
}

// ── UPA ───────────────────────────────────────────────────────────────
async function generarUPA(wb, turnoKey, gds, diasMes, nombreMes) {
  const turnoStr = turnoKey === 'd' ? 'TURNO DÍA  08:00 a 20:00' : 'TURNO NOCHE  20:00 a 08:00'
  const C_HDR   = turnoKey === 'd' ? 'B8860B' : '1A3A6B'
  const C_EF1   = turnoKey === 'd' ? 'FFFBF0' : 'EDF4FF'
  const C_EF2   = turnoKey === 'd' ? 'FFF0C0' : 'C8DEFF'
  const C_VACIO = turnoKey === 'd' ? 'FAF6E8' : 'EBF2FF'
  const C_TIT   = turnoKey === 'd' ? 'C8A84B' : '85B7EB'

  const ws = wb.addWorksheet(`UPA ${nombreMes}`)
  ws.pageSetup = {
    orientation: 'portrait',
    paperSize: 9,
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 1,
    horizontalCentered: true,
    margins: { left: 0.15, right: 0.15, top: 0.2, bottom: 0.2, header: 0, footer: 0 }
  }

  ws.getColumn(1).width = 5.0
  ws.getColumn(2).width = 42.5
  ws.getColumn(3).width = 42.5

  ws.getRow(1).height = 26
  ws.getRow(2).height = 22
  for (let r = 3; r <= 2 + diasMes; r++) ws.getRow(r).height = Math.floor((813 - 26 - 22 - 12) / diasMes)
  const pieRow = 3 + diasMes
  ws.getRow(pieRow).height = 12
  ws.pageSetup.printArea = `A1:C${pieRow}`

  // TÍTULO
  ws.mergeCells('A1:C1')
  const tit = ws.getCell('A1')
  tit.value = `POLAD · UPA  —  ${turnoStr}  —  ${nombreMes}  (Mes completo)`
  tit.font = { name: 'Arial', bold: true, size: 11, color: { argb: 'FF' + C_TIT } }
  tit.alignment = aln(); tit.fill = fill('1a1a2e')
  tit.border = { top: { style: 'medium' }, bottom: { style: 'medium' }, left: { style: 'medium' }, right: { style: 'medium' } }

  // HEADER
  ;[['A2', 'DÍA'], ['B2', 'EFECTIVO 1'], ['C2', 'EFECTIVO 2']].forEach(([coord, val], i) => {
    const c = ws.getCell(coord)
    c.value = val; c.font = font(true, 9, 'FFFFFF')
    c.alignment = aln(); c.fill = fill(i === 0 ? '2d2d44' : C_HDR)
    c.border = {
      top: { style: 'medium' }, bottom: { style: 'medium' },
      left: { style: i === 0 ? 'medium' : 'thin' },
      right: { style: i === 2 ? 'medium' : 'thin' }
    }
  })

  // DATOS
  for (let di = 0; di < diasMes; di++) {
    const dia = di + 1
    const fila = 3 + di
    const isFirst = di === 0
    const isLast  = di === diasMes - 1
    const topS = isFirst ? 'medium' : 'thin'
    const botS = isLast  ? 'medium' : 'thin'

    const cDia = ws.getCell(fila, 1)
    cDia.value = dia; cDia.font = font(true, 10, 'FFFFFF')
    cDia.alignment = aln(); cDia.fill = fill(C_HDR)
    cDia.border = { top: { style: topS }, bottom: { style: botS }, left: { style: 'medium' }, right: { style: 'medium' } }

    ;[0, 1].forEach(j => {
      const nm = gds[dia]?.[j] || ''
      const c = ws.getCell(fila, 2 + j)
      c.value = nm; c.font = font(false, 9, '111122')
      c.alignment = aln(); c.fill = fill(nm ? (j === 0 ? C_EF1 : C_EF2) : C_VACIO)
      c.border = { top: { style: topS }, bottom: { style: botS }, left: { style: 'thin' }, right: { style: j === 1 ? 'medium' : 'thin' } }
    })
  }

  // PIE
  ws.mergeCells(`A${pieRow}:C${pieRow}`)
  const pie = ws.getCell(`A${pieRow}`)
  pie.value = `POLAD · HIGA · UPA · MODULAR — Mar del Plata — ${nombreMes}`
  pie.font = { name: 'Arial', size: 7.5, italic: true, color: { argb: 'FF8b90a0' } }
  pie.alignment = aln(); pie.fill = fill('1a1a2e')
  pie.border = { top: { style: 'medium' }, bottom: { style: 'medium' }, left: { style: 'medium' }, right: { style: 'medium' } }
}

// ── MODULAR ───────────────────────────────────────────────────────────
async function generarMODULAR(wb, turnoKey, gds, diasMes, nombreMes) {
  const turnoStr = turnoKey === 'd' ? 'TURNO DÍA  08:00 a 20:00' : 'TURNO NOCHE  20:00 a 08:00'
  const C_HDR   = '20A0B0'
  const C_EF1   = 'FFFBF0'; const C_EF2 = 'FFF0C0'; const C_EF3 = 'E8F5E8'
  const C_VACIO = 'F5F5F5'

  const ws = wb.addWorksheet(`MODULAR ${nombreMes}`)
  ws.pageSetup = {
    orientation: 'portrait',
    paperSize: 9,
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 1,
    horizontalCentered: true,
    margins: { left: 0.15, right: 0.15, top: 0.2, bottom: 0.2, header: 0, footer: 0 }
  }

  ws.getColumn(1).width = 5.0
  ws.getColumn(2).width = 28.0
  ws.getColumn(3).width = 28.0
  ws.getColumn(4).width = 28.0

  ws.getRow(1).height = 26
  ws.getRow(2).height = 22
  for (let r = 3; r <= 2 + diasMes; r++) ws.getRow(r).height = Math.floor((813 - 26 - 22 - 12) / diasMes)
  const pieRow = 3 + diasMes
  ws.getRow(pieRow).height = 12
  ws.pageSetup.printArea = `A1:D${pieRow}`

  // TÍTULO
  ws.mergeCells('A1:D1')
  const tit = ws.getCell('A1')
  tit.value = `POLAD · MODULAR  —  ${turnoStr}  —  ${nombreMes}  (Mes completo)`
  tit.font = { name: 'Arial', bold: true, size: 11, color: { argb: 'FF5DCAA5' } }
  tit.alignment = aln(); tit.fill = fill('1a1a2e')
  tit.border = { top: { style: 'medium' }, bottom: { style: 'medium' }, left: { style: 'medium' }, right: { style: 'medium' } }

  // HEADER
  ;[['A2', 'DÍA', '2d2d44', 'medium', 'medium'],
    ['B2', 'EFECTIVO 1', C_HDR, 'thin', 'thin'],
    ['C2', 'EFECTIVO 2', C_HDR, 'thin', 'thin'],
    ['D2', 'EFECTIVO 3', C_HDR, 'thin', 'medium']
  ].forEach(([coord, val, bg, lft, rgt]) => {
    const c = ws.getCell(coord)
    c.value = val; c.font = font(true, 9, 'FFFFFF')
    c.alignment = aln(); c.fill = fill(bg)
    c.border = { top: { style: 'medium' }, bottom: { style: 'medium' }, left: { style: lft }, right: { style: rgt } }
  })

  // DATOS
  const BG = [C_EF1, C_EF2, C_EF3]
  for (let di = 0; di < diasMes; di++) {
    const dia = di + 1
    const fila = 3 + di
    const topS = di === 0 ? 'medium' : 'thin'
    const botS = di === diasMes - 1 ? 'medium' : 'thin'

    const cDia = ws.getCell(fila, 1)
    cDia.value = dia; cDia.font = font(true, 11, 'FFFFFF')
    cDia.alignment = aln(); cDia.fill = fill(C_HDR)
    cDia.border = { top: { style: topS }, bottom: { style: botS }, left: { style: 'medium' }, right: { style: 'medium' } }

    ;[0, 1, 2].forEach(j => {
      const nm = gds[dia]?.[j] || ''
      const c = ws.getCell(fila, 2 + j)
      c.value = nm; c.font = font(false, 9, '111122')
      c.alignment = aln(); c.fill = fill(nm ? BG[j] : C_VACIO)
      c.border = { top: { style: topS }, bottom: { style: botS }, left: { style: 'thin' }, right: { style: j === 2 ? 'medium' : 'thin' } }
    })
  }

  // PIE
  ws.mergeCells(`A${pieRow}:D${pieRow}`)
  const pie = ws.getCell(`A${pieRow}`)
  pie.value = `POLAD · HIGA · UPA · MODULAR — Mar del Plata — ${nombreMes}`
  pie.font = { name: 'Arial', size: 7.5, italic: true, color: { argb: 'FF8b90a0' } }
  pie.alignment = aln(); pie.fill = fill('1a1a2e')
  pie.border = { top: { style: 'medium' }, bottom: { style: 'medium' }, left: { style: 'medium' }, right: { style: 'medium' } }
}

// ── HANDLER PRINCIPAL ─────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()

  const { lugar, turno, mes, anio } = req.query
  if (!lugar || !turno || !mes || !anio) return res.status(400).json({ error: 'Faltan parámetros' })

  const MES  = parseInt(mes)
  const ANIO = parseInt(anio)
  const DIAS_MES  = new Date(ANIO, MES, 0).getDate()
  const NOMBRE_MES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'][MES-1] + ' ' + ANIO

  // Cargar efectivos
  const { data: efectivos } = await supabase.from('efectivos').select('*').eq('es_admin', false)

  const wb = new ExcelJS.Workbook()
  wb.creator = 'POLAD HIGA UPA'

  if (lugar === 'HIGA') {
    const sectores = ['Salud Mental','Giratoria','Llaves','Guardia','Estacionamiento']
    const { data: turnosData } = await supabase.from('turnos').select('*')
      .eq('mes', MES).eq('anio', ANIO).eq('turno', turno).in('sector', sectores)

    const gds = {}
    for (let d = 1; d <= DIAS_MES; d++) { gds[d] = {}; sectores.forEach(s => { gds[d][s] = [] }) }
    ;(turnosData || []).forEach(t => {
      const ef = (efectivos || []).find(e => e.legajo === t.legajo)
      if (ef && gds[t.dia]?.[t.sector]) gds[t.dia][t.sector].push(fmtNombre(ef))
    })
    await generarHIGA(wb, turno, gds, sectores, MES, ANIO, DIAS_MES, NOMBRE_MES)

  } else if (lugar === 'UPA') {
    const { data: turnosData } = await supabase.from('turnos').select('*')
      .eq('mes', MES).eq('anio', ANIO).eq('turno', turno).eq('sector', 'UPA')

    const gds = {}
    for (let d = 1; d <= DIAS_MES; d++) gds[d] = []
    ;(turnosData || []).forEach(t => {
      const ef = (efectivos || []).find(e => e.legajo === t.legajo)
      if (ef) gds[t.dia].push(fmtNombre(ef))
    })
    await generarUPA(wb, turno, gds, DIAS_MES, NOMBRE_MES)

  } else if (lugar === 'MODULAR') {
    const { data: turnosData } = await supabase.from('turnos').select('*')
      .eq('mes', MES).eq('anio', ANIO).eq('turno', turno).eq('sector', 'Modular')

    const gds = {}
    for (let d = 1; d <= DIAS_MES; d++) gds[d] = []
    ;(turnosData || []).forEach(t => {
      const ef = (efectivos || []).find(e => e.legajo === t.legajo)
      if (ef) gds[t.dia].push(fmtNombre(ef))
    })
    await generarMODULAR(wb, turno, gds, DIAS_MES, NOMBRE_MES)
  }

  const buffer = await wb.xlsx.writeBuffer()
  const filename = `${lugar}_${turno === 'd' ? 'DIA' : 'NOCHE'}_${NOMBRE_MES.replace(' ', '')}.xlsx`

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
  res.send(Buffer.from(buffer))
}
