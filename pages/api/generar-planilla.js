import ExcelJS from 'exceljs'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

function S(style) { return style ? { style } : { style: 'thin' } }
function B(top, bot, left, right) {
  return { top: S(top), bottom: S(bot), left: S(left), right: S(right) }
}
function F(rgb) {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + rgb } }
}
function font(bold = false, size = 10, name = 'Arial') {
  return { name, bold, size }
}
function aln(h = 'center', v = 'middle', wrap = false) {
  return { horizontal: h, vertical: v, wrapText: wrap }
}

function setCell(ws, coord, opts = {}) {
  const cell = ws.getCell(coord)
  if (opts.value !== undefined) cell.value = opts.value
  if (opts.font)      cell.font      = opts.font
  if (opts.alignment) cell.alignment = opts.alignment
  if (opts.border)    cell.border    = opts.border
  if (opts.fill)      cell.fill      = opts.fill
  return cell
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()

  const { legajo, mes, anio, lugar } = req.query
  if (!legajo || !mes || !anio) return res.status(400).json({ error: 'Faltan parámetros' })

  const MES  = parseInt(mes)
  const ANIO = parseInt(anio)
  const DIAS_MES = new Date(ANIO, MES, 0).getDate()
  const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
  const NOMBRE_MES_SOLO = MESES[MES - 1]
  const NOMBRE_MES = NOMBRE_MES_SOLO + ' ' + ANIO

  // Cargar datos del efectivo
  const { data: ef } = await supabase.from('efectivos').select('*').eq('legajo', legajo).single()
  if (!ef) return res.status(404).json({ error: 'Efectivo no encontrado' })

  // Cargar turnos y asistencia del mes
  const lugarFiltro = lugar || ef.lugar || 'HIGA'
  const [{ data: turnosData }, { data: asistData }, { data: manualData }, { data: firmaData }] = await Promise.all([
    supabase.from('turnos').select('*').eq('legajo', legajo).eq('mes', MES).eq('anio', ANIO).order('dia'),
    supabase.from('asistencia').select('*').eq('legajo', legajo).eq('mes', MES).eq('anio', ANIO).eq('lugar', lugarFiltro),
    supabase.from('planilla_manual').select('*').eq('legajo', legajo).eq('mes', MES).eq('anio', ANIO).eq('lugar', lugarFiltro),
    supabase.from('firmas').select('*').eq('legajo', legajo).eq('mes', MES).eq('anio', ANIO).single()
  ])

  // Construir mapa de guardias por dia
  const turnosMap = {}
  ;(turnosData || []).forEach(t => {
    if (!turnosMap[t.dia]) turnosMap[t.dia] = []
    turnosMap[t.dia].push(t)
  })

  const asistMap = {}
  ;(asistData || []).forEach(a => { asistMap[`${a.dia}-${a.turno}`] = a })

  const manualMap = {}
  ;(manualData || []).forEach(m => { manualMap[`${m.dia}-${m.horario}`] = m })

  // Construir filas de la planilla
  const filas = [] // { dia, horario, horas }
  for (let dia = 1; dia <= DIAS_MES; dia++) {
    const ts = turnosMap[dia] || []
    const manualDia = Object.values(manualMap).filter(m => parseInt(m.dia) === dia)

    if (ts.length === 0 && manualDia.length === 0) {
      filas.push({ dia, horario: '', horas: '' })
    } else {
      ts.forEach(t => {
        const presente = asistMap[`${dia}-${t.turno}`]
        const horario = t.turno === 'd' ? '08:00 a 20:00' : '20:00 a 08:00'
        const manualEntry = manualMap[`${dia}-${horario}`]
        const horas = presente ? (manualEntry ? parseInt(manualEntry.horas) : 12) : ''
        filas.push({ dia, horario: presente ? horario : '', horas })
      })
      manualDia.forEach(m => {
        const yaExiste = ts.find(t => (t.turno === 'd' ? '08:00 a 20:00' : '20:00 a 08:00') === m.horario)
        if (!yaExiste) filas.push({ dia: parseInt(m.dia), horario: m.horario, horas: m.horas || '' })
      })
    }
  }

  // Calcular total
  const totalHoras = filas.reduce((s, f) => s + (parseInt(f.horas) || 0), 0)
  const total90 = Math.round(totalHoras * 0.9)

  // Dividir en 2 columnas: izq (días 1-16), der (días 17-31+totales)
  const col1 = filas.filter((_, i) => i < 16)
  const col2 = filas.filter((_, i) => i >= 16)

  // ── GENERAR EXCEL ────────────────────────────────────────────────────
  const wb = new ExcelJS.Workbook()
  wb.creator = 'POLAD HIGA UPA'
  const ws = wb.addWorksheet('PLANILLA INDIVIDUAL')

  ws.pageSetup = {
    orientation: 'portrait',
    paperSize: 9,
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 1,
    margins: { left: 0.3, right: 0.3, top: 0.5, bottom: 0.5, header: 0.1, footer: 0.1 }
  }

  // Anchos exactos del original
  ws.getColumn(1).width = 11.85   // A
  ws.getColumn(2).width = 20.71   // B
  ws.getColumn(3).width = 13.71   // C
  ws.getColumn(4).width = 10.71   // D
  ws.getColumn(5).width = 20.71   // E
  ws.getColumn(6).width = 11.85   // F
  ws.getColumn(7).width = 12.57   // G

  // Altos exactos del original
  const rowHeights = {
    1:18.6, 2:18.6, 3:18.6, 4:18.6, 5:25.15, 6:18.6, 7:25.15,
    8:18.6, 9:25.9, 10:18.6, 28:4.9, 29:16.15, 30:16.15,
    31:16.15, 32:16.15, 33:16.15, 34:18.6, 35:18.6, 36:18.6, 39:18.6
  }
  for (let r = 11; r <= 27; r++) rowHeights[r] = 25.15
  Object.entries(rowHeights).forEach(([r, h]) => { ws.getRow(parseInt(r)).height = h })

  // FILA 1
  ws.mergeCells('A1:G1')
  setCell(ws, 'A1', { value: 'POLICIA ADICIONAL', font: font(false, 10), alignment: aln() })

  // FILA 2
  ws.mergeCells('A2:G2')
  setCell(ws, 'A2', { value: 'MINISTERIO DE SEGURIDAD', font: font(false, 10), alignment: aln() })

  // FILA 3
  ws.mergeCells('A3:G3')
  setCell(ws, 'A3', {
    value: 'PLANILLA DE CUMPLIMIENTO SERVICIO DE POLICIA ADICIONAL',
    font: font(true, 14), alignment: aln(),
    border: B('medium', 'double', 'medium', 'thin')
  })

  // FILA 4
  ws.mergeCells('A4:C4')
  setCell(ws, 'A4', { value: 'Servicio Polad', font: font(true, 11), alignment: aln(), border: B(null, 'medium', 'medium', 'thin') })
  ws.mergeCells('D4:G4')
  setCell(ws, 'D4', { value: 'Destino / domicilio del servicio', font: font(true, 11), alignment: aln(), border: B(null, 'medium', null, 'medium') })

  // FILA 5
  ws.mergeCells('A5:C5')
  setCell(ws, 'A5', { value: 'Ministerio de Salud - Pcia de Bs As', font: font(true, 11), alignment: aln(), border: B(null, 'double', 'medium', 'thin') })
  ws.mergeCells('D5:G5')
  setCell(ws, 'D5', { value: '', font: font(true, 11), border: B(null, 'double', null, 'medium') })

  // FILA 6
  ws.mergeCells('A6:C6')
  setCell(ws, 'A6', { value: 'Apellido y Nombre', font: font(true, 11), alignment: aln(), border: B(null, 'medium', 'medium', 'thin') })
  ws.mergeCells('D6:E6')
  setCell(ws, 'D6', { value: 'Sucursal', font: font(true, 11), alignment: aln(), border: B(null, 'medium', 'medium', 'thin') })
  ws.mergeCells('F6:G6')
  setCell(ws, 'F6', { value: 'Localidad', font: font(true, 11), alignment: aln(), border: B(null, null, 'medium', 'thin') })

  // FILA 7 — datos
  ws.mergeCells('A7:C7')
  setCell(ws, 'A7', { value: ef.nombre, font: font(true, 11), alignment: aln(), border: B(null, 'double', 'medium', 'thin') })
  ws.mergeCells('D7:E7')
  setCell(ws, 'D7', { value: lugarFiltro, font: font(true, 11), alignment: aln(), border: B(null, 'double', 'medium', 'thin') })
  ws.mergeCells('F7:G7')
  setCell(ws, 'F7', { value: 'Mar del Plata', font: font(true, 11), alignment: aln(), border: B('medium', 'double', 'medium', 'thin') })

  // FILA 8 — labels
  setCell(ws, 'A8', { value: 'Categoria', font: font(true, 11), alignment: aln(), border: B(null, null, 'medium', 'medium') })
  setCell(ws, 'B8', { value: 'Mes/Año', font: font(true, 11), alignment: aln(), border: B(null, null, 'medium', 'medium') })
  setCell(ws, 'C8', { value: 'Jerarquia', font: font(true, 11), alignment: aln() })
  ws.mergeCells('D8:E8')
  setCell(ws, 'D8', { value: 'Legajo', font: font(true, 11), alignment: aln(), border: B(null, 'medium', 'medium', 'thin') })
  ws.mergeCells('F8:G8')
  setCell(ws, 'F8', { value: 'N° Documento', font: font(true, 11), alignment: aln(), border: B(null, null, 'medium', 'thin') })

  // FILA 9 — datos
  setCell(ws, 'A9', { value: '1°', font: font(true, 11), alignment: aln(), border: B('medium', 'double', 'medium', 'medium') })
  setCell(ws, 'B9', { value: `${NOMBRE_MES_SOLO.toUpperCase()} ${ANIO}`, font: font(true, 11), alignment: aln(), border: B('medium', 'double', 'medium', 'medium') })
  setCell(ws, 'C9', { value: ef.jerarquia || '', font: font(true, 11), alignment: aln(), border: B('medium', 'double', null, null) })
  ws.mergeCells('D9:E9')
  setCell(ws, 'D9', { value: ef.legajo, font: font(true, 12), alignment: aln(), border: B('medium', 'double', 'medium', 'thin') })
  ws.mergeCells('F9:G9')
  setCell(ws, 'F9', { value: ef.dni || '', font: font(true, 12), alignment: aln(), border: B('medium', 'double', 'medium', 'thin') })

  // FILA 10 — headers tabla
  setCell(ws, 'A10', { value: 'DIA', font: font(true, 10), alignment: aln(), border: B(null, 'medium', 'medium', 'medium') })
  setCell(ws, 'B10', { value: 'HORARIO', font: font(true, 10), alignment: aln(), border: B(null, 'medium', 'medium', 'thin') })
  setCell(ws, 'C10', { value: 'HORAS', font: font(true, 10), alignment: aln(), border: B(null, 'medium', 'thin', null) })
  setCell(ws, 'D10', { value: 'DIA', font: font(true, 10), alignment: aln(), border: B(null, 'medium', 'medium', 'medium') })
  ws.mergeCells('E10:F10')
  setCell(ws, 'E10', { value: 'HORARIO', font: font(true, 10), alignment: aln(), border: B(null, 'medium', null, 'thin') })
  setCell(ws, 'G10', { value: 'HORAS', font: font(true, 10), alignment: aln(), border: B(null, 'medium', 'thin', 'medium') })

  // FILAS DE DATOS 11-26
  for (let i = 0; i <= 15; i++) {
    const fila = 11 + i
    const f1 = col1[i] || { dia: '', horario: '', horas: '' }
    const f2 = col2[i] || { dia: '', horario: '', horas: '' }
    const isFirst = i === 0
    const isLast  = i === 15
    const topS = isFirst ? null : 'thin'
    const botS = isLast ? 'medium' : 'thin'
    const topSD = i === 0 ? 'medium' : 'thin'

    setCell(ws, `A${fila}`, { value: f1.dia || '', font: font(false, 11), alignment: aln(), border: B(topS, botS, 'medium', 'medium') })
    setCell(ws, `B${fila}`, { value: f1.horario || '', font: font(false, 10), alignment: aln(), border: B(topS, botS, 'medium', 'thin') })
    setCell(ws, `C${fila}`, { value: f1.horas || '', font: font(false, 10), alignment: aln(), border: B(topS, botS, 'thin', null) })
    setCell(ws, `D${fila}`, { value: f2.dia || '', font: font(false, 11), alignment: aln(), border: B(topSD, botS, 'medium', 'medium') })
    ws.mergeCells(`E${fila}:F${fila}`)
    setCell(ws, `E${fila}`, { value: f2.horario || '', font: font(false, 10), alignment: aln(), border: B(topSD, botS, null, 'thin') })
    setCell(ws, `G${fila}`, { value: f2.horas || '', font: font(false, 10), alignment: aln(), border: B(topSD, botS, 'thin', 'medium') })
  }

  // TOTALES fila 26 col der
  ws.mergeCells('D26:F26')
  setCell(ws, 'D26', { value: 'TOTAL DE HORAS CUMPLIDAS EN EL MES', font: font(true, 10), alignment: aln('center', 'middle', true), border: B('medium', 'medium', 'medium', 'thin') })
  setCell(ws, 'G26', { value: totalHoras || '', font: font(true, 10), alignment: aln(), border: B('medium', 'medium', 'thin', 'medium') })

  ws.mergeCells('D27:F27')
  setCell(ws, 'D27', { value: 'TOTAL 90 %', font: font(true, 10), alignment: aln(), border: B('medium', 'medium', 'medium', 'thin') })
  setCell(ws, 'G27', { value: total90 || '', font: font(true, 10), alignment: aln(), border: B('medium', 'medium', 'thin', 'medium') })

  // DECLARACIÓN
  ws.mergeCells('A29:G30')
  setCell(ws, 'A29', {
    value: `Declaro de conformidad, haber prestado ${totalHoras || '...'} horas de servicio de Policia Adicional, en el destino que figura la presente planilla.`,
    font: font(false, 10), alignment: aln('left', 'middle', true),
    border: B('thin', null, 'thin', 'thin')
  })

  // FIRMAS
  ws.mergeCells('A35:C36')
  setCell(ws, 'A35', { value: 'FIRMA EFECTIVO', font: font(false, 10), alignment: aln(), border: B('dotted', null, null, null) })
  ws.mergeCells('E35:G36')
  setCell(ws, 'E35', { value: 'FIRMA ENCARGADO', font: font(false, 10), alignment: aln(), border: B('dotted', null, null, null) })

  // Si hay firma del efectivo como base64, insertarla
  const firmaUrl = firmaData?.firma_url || ef.firma_url
  if (firmaUrl && firmaUrl.startsWith('data:image')) {
    try {
      const base64 = firmaUrl.split(',')[1]
      const ext = firmaUrl.includes('png') ? 'png' : 'jpeg'
      const imgId = wb.addImage({ base64, extension: ext })
      ws.addImage(imgId, { tl: { col: 0, row: 31 }, br: { col: 3, row: 35 } })
    } catch(e) { /* sin firma */ }
  }

  const buffer = await wb.xlsx.writeBuffer()
  const filename = `Planilla_${ef.nombre.replace(/,/g,'').replace(/\s+/g,'_')}_${NOMBRE_MES_SOLO}${ANIO}.xlsx`

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
  res.send(Buffer.from(buffer))
}
