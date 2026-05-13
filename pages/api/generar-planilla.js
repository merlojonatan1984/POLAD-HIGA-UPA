import ExcelJS from 'exceljs'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

function fmtNombre(ef) {
  const nombre = (ef.nombre || '').trim()
  let jer = (ef.jerarquia || '').trim()
  let resto = nombre

  // Extraer jerarquia del nombre si no viene en campo separado
  if (!jer) {
    const m = nombre.match(/^(.+?)\s+([A-Z]+,\s*[A-Z]+.*)$/)
    if (m) { jer = m[1].trim(); resto = m[2].trim() }
  }

  // Parsear apellido e inicial
  const partes = resto.split(',')
  const apellido = partes[0]?.trim() || resto
  const inicial = partes[1]?.trim()[0] ? partes[1].trim()[0] + '.' : ''

  // Abreviar jerarquia segun escalafon POLAD
  const abreviar = j => j
    .replace(/OFICIAL\s*SUB\s*AYUDANTE/i, 'OSA')
    .replace(/OFICIAL\s*AYUDANTE/i,       'OA')
    .replace(/SUB\s*COMISARIO/i,          'Scrio.')
    .replace(/COMISARIO/i,                'Crio.')
    .replace(/CAPITAN/i,                  'Cap.')
    .replace(/MAYOR/i,                    'May.')
    .replace(/TENIENTE/i,                 'Tte.')
    .replace(/SARGENTO/i,                 'Sgto.')
    .replace(/OFICIAL/i,                  'Ofl.')

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
async function generarHIGA(wb, turnoKey, gds, sectores, mes, anio, diasMes, nombreMes, d1, d2) {
  const turnoStr = turnoKey === 'd' ? 'TURNO DÍA  08:00 a 20:00' : 'TURNO NOCHE  20:00 a 08:00'
  const C_HDR   = turnoKey === 'd' ? 'B8860B' : '1A3A6B'
  const C_SEC   = turnoKey === 'd' ? 'FFF3CC' : 'D6E8FF'
  const C_EF1   = turnoKey === 'd' ? 'FFFBF0' : 'EDF4FF'
  const C_EF2   = turnoKey === 'd' ? 'FFF0C0' : 'C8DEFF'
  const C_VACIO = turnoKey === 'd' ? 'FAF6E8' : 'EBF2FF'
  const C_TIT   = turnoKey === 'd' ? 'C8A84B' : '85B7EB'

  // Una hoja por rango (d1-d2)
  const dias = Array.from({ length: d2 - d1 + 1 }, (_, i) => i + d1)
  const ws = wb.addWorksheet(`Días ${d1}-${d2}`)

  ws.pageSetup.orientation = 'landscape'
  ws.pageSetup.paperSize = 9
  ws.pageSetup.fitToPage = true
  ws.pageSetup.fitToWidth = 1
  ws.pageSetup.fitToHeight = 1
  ws.pageSetup.margins = { left: 0.15, right: 0.15, top: 0.2, bottom: 0.2, header: 0, footer: 0 }

  // Estructura: Col A = DIA, luego 2 cols por sector (ef1, ef2)
  // Total cols = 1 + 5*2 = 11
  // A4 landscape imprimible ~277mm
  // Col A(dia): 5u | 10 cols efectivos: (277/2.2225 - 5) / 10 = 11.9u c/u
  const COL_DIA = 4.0
  const COL_EF  = 12.0
  ws.getColumn(1).width = COL_DIA
  for (let i = 0; i < sectores.length * 2; i++) {
    ws.getColumn(2 + i).width = COL_EF
  }
  const lastColIdx = 1 + sectores.length * 2
  const lastColLetter = ws.getColumn(lastColIdx).letter

  // Altos
  // A4 landscape alto ~190mm = 538pt
  // titulo(24) + header_sec(16) + header_ef(16) + 31dias + pie(12) = 538
  // dias: (538-24-16-16-12)/31 = 15pt
  const ALTO_TIT    = 20
  const ALTO_HDR1   = 13
  const ALTO_HDR2   = 13
  const ALTO_DATO   = Math.floor((538 - ALTO_TIT - ALTO_HDR1 - ALTO_HDR2 - 10) / dias.length)
  const ALTO_PIE    = 10

  ws.getRow(1).height = ALTO_TIT
  ws.getRow(2).height = ALTO_HDR1
  ws.getRow(3).height = ALTO_HDR2
  for (let r = 4; r <= 3 + dias.length; r++) ws.getRow(r).height = ALTO_DATO
  const pieRow = 4 + dias.length
  ws.getRow(pieRow).height = ALTO_PIE
  ws.pageSetup.printArea = `A1:${lastColLetter}${pieRow}`

  // TÍTULO
  ws.mergeCells(`A1:${lastColLetter}1`)
  const tit = ws.getCell('A1')
  tit.value = `POLAD · HIGA  —  ${turnoStr}  —  ${nombreMes}  (Días ${d1} al ${d2})`
  tit.font = { name: 'Arial', bold: true, size: 9, color: { argb: 'FF' + C_TIT } }
  tit.alignment = { horizontal: 'center', vertical: 'middle' }
  tit.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1a1a2e' } }
  tit.border = { top:{style:'medium'}, bottom:{style:'medium'}, left:{style:'medium'}, right:{style:'medium'} }

  // HEADER FILA 2: sectores mergeados de a 2 columnas
  const hdrDia2 = ws.getCell('A2')
  hdrDia2.value = 'DÍA'
  hdrDia2.font = { name:'Arial', bold:true, size:8, color:{argb:'FFFFFFFF'} }
  hdrDia2.alignment = { horizontal:'center', vertical:'middle' }
  hdrDia2.fill = { type:'pattern', pattern:'solid', fgColor:{argb:'FF2d2d44'} }
  hdrDia2.border = { top:{style:'medium'}, bottom:{style:'thin'}, left:{style:'medium'}, right:{style:'medium'} }
  ws.mergeCells('A2:A3')

  sectores.forEach((sec, si) => {
    const colA = 2 + si * 2
    const colB = colA + 1
    const colLetA = ws.getColumn(colA).letter
    const colLetB = ws.getColumn(colB).letter
    const isLast = si === sectores.length - 1

    // Merge las 2 cols del sector en fila 2
    ws.mergeCells(`${colLetA}2:${colLetB}2`)
    const cSec = ws.getCell(`${colLetA}2`)
    cSec.value = sec
    cSec.font = { name:'Arial', bold:true, size:6, color:{argb:'FFFFFFFF'} }
    cSec.alignment = { horizontal:'center', vertical:'middle', wrapText:true }
    cSec.fill = { type:'pattern', pattern:'solid', fgColor:{argb:'FF'+C_HDR} }
    cSec.border = { top:{style:'medium'}, bottom:{style:'thin'}, left:{style:'thin'}, right:{style: isLast?'medium':'thin'} }

    // Fila 3: EF1 | EF2
    ;[colLetA, colLetB].forEach((col, ei) => {
      const c = ws.getCell(`${col}3`)
      c.value = ei === 0 ? 'Ef.1' : 'Ef.2'
      c.font = { name:'Arial', bold:true, size:6, color:{argb:'FFFFFFFF'} }
      c.alignment = { horizontal:'center', vertical:'middle' }
      c.fill = { type:'pattern', pattern:'solid', fgColor:{argb:'FF'+C_HDR} }
      c.border = {
        top:{style:'thin'}, bottom:{style:'medium'},
        left:{style:'thin'},
        right:{style: (isLast && ei===1) ? 'medium' : 'thin'}
      }
    })
  })

  // Fila 3 col A (ya mergeada con A2, solo bordes)
  ws.getCell('A3').border = { bottom:{style:'medium'}, left:{style:'medium'}, right:{style:'medium'} }

  // DATOS
  dias.forEach((dia, di) => {
    const fila = 4 + di
    const isFirst = di === 0
    const isLast  = di === dias.length - 1
    const topS = isFirst ? 'medium' : 'thin'
    const botS = isLast  ? 'medium' : 'thin'

    // Col A — Día
    const cDia = ws.getCell(fila, 1)
    cDia.value = dia
    cDia.font = { name:'Arial', bold:true, size:8, color:{argb:'FFFFFFFF'} }
    cDia.alignment = { horizontal:'center', vertical:'middle' }
    cDia.fill = { type:'pattern', pattern:'solid', fgColor:{argb:'FF'+C_HDR} }
    cDia.border = { top:{style:topS}, bottom:{style:botS}, left:{style:'medium'}, right:{style:'medium'} }

    // Cols efectivos por sector
    sectores.forEach((sec, si) => {
      const isLastSec = si === sectores.length - 1
      ;[0, 1].forEach(ei => {
        const col = 2 + si * 2 + ei
        const nm = gds[dia]?.[sec]?.[ei] || ''
        const c = ws.getCell(fila, col)
        c.value = nm
        c.font = { name:'Arial', size:6, color:{argb:'FF111122'} }
        c.alignment = { horizontal:'center', vertical:'middle', wrapText:true }
        c.fill = { type:'pattern', pattern:'solid', fgColor:{argb:'FF'+(nm ? (ei===0?C_EF1:C_EF2) : C_VACIO)} }
        c.border = {
          top:{style:topS}, bottom:{style:botS},
          left:{style:'thin'},
          right:{style: (isLastSec && ei===1) ? 'medium' : 'thin'}
        }
      })
    })
  })

  // PIE
  ws.mergeCells(`A${pieRow}:${lastColLetter}${pieRow}`)
  const pie = ws.getCell(`A${pieRow}`)
  pie.value = `POLAD · HIGA · UPA · MODULAR — Mar del Plata — ${nombreMes}`
  pie.font = { name:'Arial', size:6, italic:true, color:{argb:'FF8b90a0'} }
  pie.alignment = { horizontal:'center', vertical:'middle' }
  pie.fill = { type:'pattern', pattern:'solid', fgColor:{argb:'FF1a1a2e'} }
  pie.border = { top:{style:'medium'}, bottom:{style:'medium'}, left:{style:'medium'}, right:{style:'medium'} }
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
  tit.font = { name: 'Arial', bold: true, size: 9, color: { argb: 'FF' + C_TIT } }
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
      c.value = nm; c.font = font(false, 7, '111122')
      c.alignment = aln('center', true); c.fill = fill(nm ? BG[j] : C_VACIO)
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

  const { lugar, turno, mes, anio, d1, d2 } = req.query
  if (!lugar || !turno || !mes || !anio) return res.status(400).json({ error: 'Faltan parámetros' })

  const MES  = parseInt(mes)
  const ANIO = parseInt(anio)
  const DIAS_MES  = new Date(ANIO, MES, 0).getDate()
  const NOMBRE_MES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'][MES-1] + ' ' + ANIO
  // Para HIGA: rango de dias especifico
  const D1 = d1 ? parseInt(d1) : 1
  const D2 = d2 ? parseInt(d2) : DIAS_MES

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
    // Quincena 1
    await generarHIGA(wb, turno, gds, sectores, MES, ANIO, DIAS_MES, NOMBRE_MES, 1, 15)
    // Quincena 2
    await generarHIGA(wb, turno, gds, sectores, MES, ANIO, DIAS_MES, NOMBRE_MES, 16, DIAS_MES)

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
  const sufijo = lugar === 'HIGA' ? `_Dias${String(D1).padStart(2,'0')}-${String(D2).padStart(2,'0')}` : ''
  const filename = `${lugar}_${turno === 'd' ? 'DIA' : 'NOCHE'}_${NOMBRE_MES.replace(' ', '')}${sufijo}.xlsx`

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
  res.send(Buffer.from(buffer))
}
