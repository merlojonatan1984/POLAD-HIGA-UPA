import ExcelJS from 'exceljs'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

function fmtNombre(ef) {
  let nombre = (ef.nombre || '').trim()
  let jer = (ef.jerarquia || '').trim()

  // Limpiar paréntesis de escalafón: (E.G.), (S.G.), (ADM), (CDO), etc.
  nombre = nombre.replace(/\(E\.G\.\)|\(S\.G\.\)|\(ADM\)|\(CDO\)|\(ADM\.?\)/gi, '').replace(/\s+/g, ' ').trim()
  jer = jer.replace(/\(E\.G\.\)|\(S\.G\.\)|\(ADM\)|\(CDO\)|\(ADM\.?\)/gi, '').replace(/\s+/g, ' ').trim()

  let resto = nombre
  if (!jer) {
    const m = nombre.match(/^(.+?)\s+([A-Z]+,\s*[A-Z]+.*)$/)
    if (m) { jer = m[1].trim(); resto = m[2].trim() }
  }

  const partes = resto.split(',')
  const apellido = partes[0]?.trim() || resto
  const primerNombre = (partes[1]?.trim() || '').split(/\s+/)[0] || ''

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
    .replace(/SUBINSPECTOR/i,             'SubInsp.')
    .replace(/INSPECTOR/i,                'Insp.')
  const jerAbrev = jer ? abreviar(jer) : ''
  return jerAbrev ? `${jerAbrev} ${apellido} ${primerNombre}`.trim() : `${apellido} ${primerNombre}`.trim()
}

function fill(color) { return { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + color } } }
function font(bold = false, size = 9, color = '000000') { return { name: 'Arial', bold, size, color: { argb: 'FF' + color } } }
function aln(h = 'center', wrap = false) { return { horizontal: h, vertical: 'middle', wrapText: wrap } }

const BORDE_EXT = { style: 'thin', color: { argb: 'FF999999' } }  // borde externo: gris medio
const BORDE_INT = { style: 'hair', color: { argb: 'FFCCCCCC' } }  // borde interno: gris muy claro

function borde(top, bot, left, right) {
  const s = v => v === 'medium' ? BORDE_EXT : BORDE_INT
  return { top: s(top), bottom: s(bot), left: s(left), right: s(right) }
}

// ── HIGA: layout vertical — sectores como filas ───────────────────────
async function generarHIGA(wb, gds, sectores, DIAS_MES, NOMBRE_MES) {
  const ws = wb.addWorksheet(`HIGA ${NOMBRE_MES}`)
  ws.pageSetup = {
    orientation: 'portrait', paperSize: 9, fitToPage: true, fitToWidth: 1,
    margins: { left:0.3, right:0.3, top:0.3, bottom:0.3, header:0, footer:0 }
  }
  ws.pageSetup.printTitlesRow = '1:3'

  ws.getColumn(1).width = 18.0  // SECTOR
  ws.getColumn(2).width = 19.0  // DÍA Ef.1
  ws.getColumn(3).width = 19.0  // DÍA Ef.2
  ws.getColumn(4).width = 19.0  // NOCHE Ef.1
  ws.getColumn(5).width = 19.0  // NOCHE Ef.2

  // Título
  ws.getRow(1).height = 22
  ws.mergeCells('A1:E1')
  const tit = ws.getCell('A1')
  tit.value = `POLAD · HIGA  —  ${NOMBRE_MES}`
  tit.font = { name:'Arial', bold:true, size:11, color:{argb:'FFC8A84B'} }
  tit.alignment = aln(); tit.fill = fill('1a1a2e'); tit.border = borde('medium','medium','medium','medium')

  // Header turno (fila 2)
  ws.getRow(2).height = 13
  ws.mergeCells('A2:A3')
  const hSec = ws.getCell('A2'); hSec.value = 'SECTOR'; hSec.font = font(true,8,'FFFFFF')
  hSec.alignment = aln(); hSec.fill = fill('2d2d44'); hSec.border = borde('medium','medium','medium','thin')

  ws.mergeCells('B2:C2')
  const hDia = ws.getCell('B2'); hDia.value = 'TURNO DÍA  08:00–20:00'; hDia.font = font(true,8,'FFFFFF')
  hDia.alignment = aln(); hDia.fill = fill('B8860B'); hDia.border = borde('medium','thin','thin','thin')

  ws.mergeCells('D2:E2')
  const hNoc = ws.getCell('D2'); hNoc.value = 'TURNO NOCHE  20:00–08:00'; hNoc.font = font(true,8,'FFFFFF')
  hNoc.alignment = aln(); hNoc.fill = fill('1A3A6B'); hNoc.border = borde('medium','thin','thin','medium')

  // Header ef (fila 3)
  ws.getRow(3).height = 11
  ws.getCell('A3').border = borde('thin','medium','medium','thin')
  ;[['B3','Ef.1','B8860B'],['C3','Ef.2','B8860B'],['D3','Ef.1','1A3A6B'],['E3','Ef.2','1A3A6B']].forEach(([coord,val,bg],i) => {
    const c = ws.getCell(coord); c.value = val; c.font = font(true,8,'FFFFFF')
    c.alignment = aln(); c.fill = fill(bg); c.border = borde('thin','medium','thin',i===3?'medium':'thin')
  })

  // Datos: por día, por sector
  let row = 4
  for (let dia = 1; dia <= DIAS_MES; dia++) {
    // Header del día
    ws.getRow(row).height = 15
    ws.mergeCells(`A${row}:E${row}`)
    const cDia = ws.getCell(`A${row}`)
    cDia.value = `DÍA ${dia}`
    cDia.font = font(true, 9, 'FFFFFF'); cDia.alignment = aln()
    cDia.fill = fill('2d2d44'); cDia.border = borde('medium','thin','medium','medium')
    row++

    sectores.forEach((sec, si) => {
      const isLast = si === sectores.length - 1
      ws.getRow(row).height = 22

      const cSec = ws.getCell(`A${row}`)
      cSec.value = sec; cSec.font = font(true, 8, 'FFFFFF')
      cSec.alignment = { horizontal:'left', vertical:'middle' }
      cSec.fill = fill('2d3a6b')
      cSec.border = borde('thin', isLast?'medium':'thin', 'medium', 'thin')

      const turnos = [
        { key:'d', C_EF1:'FFFBF0', C_EF2:'FFF0C0', colStart:2 },
        { key:'n', C_EF1:'EDF4FF', C_EF2:'C8DEFF', colStart:4 },
      ]
      turnos.forEach(({ key, C_EF1, C_EF2, colStart }) => {
        ;[0,1].forEach(ei => {
          const col = colStart + ei
          const nm = gds[dia]?.[key]?.[sec]?.[ei] || ''
          const c = ws.getCell(row, col)
          c.value = nm; c.font = { name:'Arial', size:8, color:{argb:'FF000000'} }
          c.alignment = aln('center', true)
          c.fill = fill(nm ? (ei===0?C_EF1:C_EF2) : 'E84040')
          c.border = borde('thin', isLast?'medium':'thin', 'thin', col===5?'medium':'thin')
        })
      })
      row++
    })
  }

  // Pie
  ws.getRow(row).height = 10
  ws.mergeCells(`A${row}:E${row}`)
  const pie = ws.getCell(`A${row}`)
  pie.value = `POLAD · HIGA · UPA · MODULAR — Mar del Plata — ${NOMBRE_MES}`
  pie.font = { name:'Arial', size:7, italic:true, color:{argb:'FF8b90a0'} }
  pie.alignment = aln(); pie.fill = fill('1a1a2e'); pie.border = borde('medium','medium','medium','medium')
}

// ── UPA: 1 fila por día, turnos lado a lado ───────────────────────────
async function generarUPA(wb, gds, DIAS_MES, NOMBRE_MES) {
  const ws = wb.addWorksheet(`UPA ${NOMBRE_MES}`)
  ws.pageSetup = {
    orientation: 'portrait', paperSize: 9, fitToPage: true, fitToWidth: 1,
    horizontalCentered: true, margins: { left:0.3, right:0.3, top:0.3, bottom:0.3, header:0, footer:0 }
  }
  ws.getColumn(1).width = 5.0
  ws.getColumn(2).width = 22.0; ws.getColumn(3).width = 22.0
  ws.getColumn(4).width = 22.0; ws.getColumn(5).width = 22.0

  ws.getRow(1).height = 24; ws.getRow(2).height = 16; ws.getRow(3).height = 13
  const altoFila = 24
  for (let r = 4; r <= 3 + DIAS_MES; r++) ws.getRow(r).height = altoFila
  const pieRow = 4 + DIAS_MES; ws.getRow(pieRow).height = 10
  ws.pageSetup.printArea = `A1:E${pieRow}`

  ws.mergeCells('A1:E1')
  const tit = ws.getCell('A1')
  tit.value = `POLAD · UPA  —  ${NOMBRE_MES}`
  tit.font = { name:'Arial', bold:true, size:10, color:{argb:'FFFF6633'} }
  tit.alignment = aln(); tit.fill = fill('1a1a2e'); tit.border = borde('medium','medium','medium','medium')

  ws.mergeCells('A2:A3')
  const hA = ws.getCell('A2'); hA.value = 'DÍA'; hA.font = font(true,9,'FFFFFF')
  hA.alignment = aln(); hA.fill = fill('2d2d44'); hA.border = borde('medium','medium','medium','thin')
  ws.getCell('A3').border = borde('thin','medium','medium','thin')

  ws.mergeCells('B2:C2')
  const hB = ws.getCell('B2'); hB.value = 'TURNO DÍA  08:00 a 20:00'; hB.font = font(true,9,'FFFFFF')
  hB.alignment = aln(); hB.fill = fill('B8860B'); hB.border = borde('medium','thin','thin','thin')

  ws.mergeCells('D2:E2')
  const hD = ws.getCell('D2'); hD.value = 'TURNO NOCHE  20:00 a 08:00'; hD.font = font(true,9,'FFFFFF')
  hD.alignment = aln(); hD.fill = fill('1A3A6B'); hD.border = borde('medium','thin','thin','medium')

  ;[['B3','Ef.1','B8860B'],['C3','Ef.2','B8860B'],['D3','Ef.1','1A3A6B'],['E3','Ef.2','1A3A6B']].forEach(([coord,val,bg],i) => {
    const c = ws.getCell(coord); c.value = val; c.font = font(true,8,'FFFFFF')
    c.alignment = aln(); c.fill = fill(bg); c.border = borde('thin','medium','thin',i===3?'medium':'thin')
  })

  const colores = [['FFFBF0','FFF0C0'],['EDF4FF','C8DEFF']]
  const keys = ['d','n']
  for (let di = 0; di < DIAS_MES; di++) {
    const dia = di+1, fila = 4+di
    const topS = di===0?'medium':'thin', botS = di===DIAS_MES-1?'medium':'thin'
    const cDia = ws.getCell(fila,1); cDia.value = dia; cDia.font = font(true,10,'FFFFFF')
    cDia.alignment = aln(); cDia.fill = fill('2d2d44'); cDia.border = borde(topS,botS,'medium','thin')
    keys.forEach((key,ki) => {
      ;[0,1].forEach(ei => {
        const nm = gds[dia]?.[key]?.[ei] || ''
        const c = ws.getCell(fila, 2+ki*2+ei); c.value = nm; c.font = font(false,8,'000000')
        c.alignment = aln('center',true); c.fill = fill(nm?colores[ki][ei]:'E84040')
        c.border = borde(topS,botS,'thin',(ki===1&&ei===1)?'medium':'thin')
      })
    })
  }

  ws.mergeCells(`A${pieRow}:E${pieRow}`)
  const pie = ws.getCell(`A${pieRow}`)
  pie.value = `POLAD · HIGA · UPA · MODULAR — Mar del Plata — ${NOMBRE_MES}`
  pie.font = { name:'Arial', size:7, italic:true, color:{argb:'FF8b90a0'} }
  pie.alignment = aln(); pie.fill = fill('1a1a2e'); pie.border = borde('medium','medium','medium','medium')
}

// ── MODULAR: 1 fila por día, 3 turnos lado a lado ─────────────────────
async function generarMODULAR(wb, gds, DIAS_MES, NOMBRE_MES) {
  const ws = wb.addWorksheet(`MODULAR ${NOMBRE_MES}`)
  ws.pageSetup = {
    orientation: 'portrait', paperSize: 9, fitToPage: true, fitToWidth: 1,
    horizontalCentered: true, margins: { left:0.3, right:0.3, top:0.3, bottom:0.3, header:0, footer:0 }
  }
  ws.getColumn(1).width = 5.0
  for (let i = 2; i <= 7; i++) ws.getColumn(i).width = 15.5

  ws.getRow(1).height = 24; ws.getRow(2).height = 16; ws.getRow(3).height = 13
  const altoFila = 24
  for (let r = 4; r <= 3 + DIAS_MES; r++) ws.getRow(r).height = altoFila
  const pieRow = 4 + DIAS_MES; ws.getRow(pieRow).height = 10
  ws.pageSetup.printArea = `A1:G${pieRow}`

  ws.mergeCells('A1:G1')
  const tit = ws.getCell('A1')
  tit.value = `POLAD · MODULAR  —  ${NOMBRE_MES}`
  tit.font = { name:'Arial', bold:true, size:10, color:{argb:'FF20A0B0'} }
  tit.alignment = aln(); tit.fill = fill('1a1a2e'); tit.border = borde('medium','medium','medium','medium')

  ws.mergeCells('A2:A3')
  const hA = ws.getCell('A2'); hA.value = 'DÍA'; hA.font = font(true,9,'FFFFFF')
  hA.alignment = aln(); hA.fill = fill('2d2d44'); hA.border = borde('medium','medium','medium','thin')
  ws.getCell('A3').border = borde('thin','medium','medium','thin')

  const turnosConf = [
    { key:'m', label:'MAÑANA  08:00–16:00',  C_HDR:'B8860B', C_EF1:'FFFBF0', C_EF2:'FFF0C0', colI:2 },
    { key:'t', label:'TARDE  16:00–23:59',   C_HDR:'5A4A8A', C_EF1:'F0EDFF', C_EF2:'E0D8FF', colI:4 },
    { key:'n', label:'NOCHE  23:59–08:00',   C_HDR:'1A3A6B', C_EF1:'EDF4FF', C_EF2:'C8DEFF', colI:6 },
  ]

  turnosConf.forEach(({ label, C_HDR, colI }, ti) => {
    const lA = ws.getColumn(colI).letter, lB = ws.getColumn(colI+1).letter
    const isLast = ti === turnosConf.length - 1
    ws.mergeCells(`${lA}2:${lB}2`)
    const c2 = ws.getCell(`${lA}2`); c2.value = label; c2.font = font(true,8,'FFFFFF')
    c2.alignment = aln(); c2.fill = fill(C_HDR); c2.border = borde('medium','thin','thin',isLast?'medium':'thin')
    ;[lA, lB].forEach((l, ei) => {
      const c3 = ws.getCell(`${l}3`); c3.value = `Ef.${ei+1}`; c3.font = font(true,8,'FFFFFF')
      c3.alignment = aln(); c3.fill = fill(C_HDR); c3.border = borde('thin','medium','thin',(isLast&&ei===1)?'medium':'thin')
    })
  })

  for (let di = 0; di < DIAS_MES; di++) {
    const dia = di+1, fila = 4+di
    const topS = di===0?'medium':'thin', botS = di===DIAS_MES-1?'medium':'thin'
    const cDia = ws.getCell(fila,1); cDia.value = dia; cDia.font = font(true,11,'FFFFFF')
    cDia.alignment = aln(); cDia.fill = fill('2d2d44'); cDia.border = borde(topS,botS,'medium','thin')
    turnosConf.forEach(({ key, C_EF1, C_EF2, colI }, ti) => {
      const isLast = ti === turnosConf.length - 1
      ;[0,1].forEach(ei => {
        const nm = gds[dia]?.[key]?.[ei] || ''
        const c = ws.getCell(fila, colI+ei); c.value = nm; c.font = font(false,7.5,'000000')
        c.alignment = aln('center',true); c.fill = fill(nm?(ei===0?C_EF1:C_EF2):'E84040')
        c.border = borde(topS,botS,'thin',(isLast&&ei===1)?'medium':'thin')
      })
    })
  }

  ws.mergeCells(`A${pieRow}:G${pieRow}`)
  const pie = ws.getCell(`A${pieRow}`)
  pie.value = `POLAD · HIGA · UPA · MODULAR — Mar del Plata — ${NOMBRE_MES}`
  pie.font = { name:'Arial', size:7, italic:true, color:{argb:'FF8b90a0'} }
  pie.alignment = aln(); pie.fill = fill('1a1a2e'); pie.border = borde('medium','medium','medium','medium')
}

// ── HANDLER ────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()
  const { lugar, mes, anio } = req.query
  if (!lugar || !mes || !anio) return res.status(400).json({ error: 'Faltan parámetros' })

  const MES = parseInt(mes), ANIO = parseInt(anio)
  const DIAS_MES = new Date(ANIO, MES, 0).getDate()
  const NOMBRE_MES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto',
    'Septiembre','Octubre','Noviembre','Diciembre'][MES-1] + ' ' + ANIO

  const { data: efectivos } = await supabase.from('efectivos').select('*').eq('es_admin', false).eq('lugar', lugar)

  const wb = new ExcelJS.Workbook()
  wb.creator = 'POLAD HIGA UPA'

  if (lugar === 'HIGA') {
    const sectores = ['Salud Mental','Giratoria','Llaves','Guardia','Estacionamiento']
    const { data: turnosData } = await supabase.from('turnos').select('*')
      .eq('mes', MES).eq('anio', ANIO).in('sector', sectores)
    const gds = {}
    for (let d = 1; d <= DIAS_MES; d++) {
      gds[d] = {}
      for (const t of ['d','n']) { gds[d][t] = {}; sectores.forEach(s => { gds[d][t][s] = [] }) }
    }
    ;(turnosData || []).forEach(t => {
      const ef = (efectivos || []).find(e => e.legajo === t.legajo)
      if (ef && gds[t.dia]?.[t.turno]?.[t.sector]) gds[t.dia][t.turno][t.sector].push(fmtNombre(ef))
    })
    await generarHIGA(wb, gds, sectores, DIAS_MES, NOMBRE_MES)

  } else if (lugar === 'UPA') {
    const { data: turnosData } = await supabase.from('turnos').select('*')
      .eq('mes', MES).eq('anio', ANIO).eq('sector', 'UPA')
    const gds = {}
    for (let d = 1; d <= DIAS_MES; d++) gds[d] = { d:[], n:[] }
    ;(turnosData || []).forEach(t => {
      const ef = (efectivos || []).find(e => e.legajo === t.legajo)
      if (ef && gds[t.dia]?.[t.turno]) gds[t.dia][t.turno].push(fmtNombre(ef))
    })
    await generarUPA(wb, gds, DIAS_MES, NOMBRE_MES)

  } else if (lugar === 'MODULAR') {
    const { data: turnosData } = await supabase.from('turnos').select('*')
      .eq('mes', MES).eq('anio', ANIO).eq('sector', 'Modular')
    const gds = {}
    for (let d = 1; d <= DIAS_MES; d++) gds[d] = { m:[], t:[], n:[] }
    ;(turnosData || []).forEach(t => {
      const ef = (efectivos || []).find(e => e.legajo === t.legajo)
      if (ef && gds[t.dia]?.[t.turno]) gds[t.dia][t.turno].push(fmtNombre(ef))
    })
    await generarMODULAR(wb, gds, DIAS_MES, NOMBRE_MES)
  }

  const buffer = await wb.xlsx.writeBuffer()
  const filename = `POLAD_${lugar}_${NOMBRE_MES.replace(' ','_')}.xlsx`
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
  res.send(Buffer.from(buffer))
}
