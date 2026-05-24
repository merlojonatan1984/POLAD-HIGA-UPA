import { createClient } from '@supabase/supabase-js'
import ExcelJS from 'exceljs'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

const PLANTILLA_B64 = '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'

// Helper: turno → horario string
function getHorario(turno, lugar) {
  if (lugar === 'MODULAR') {
    if (turno === 'm') return '08:00 a 16:00'
    if (turno === 't') return '16:00 a 23:59'
    return '23:59 a 08:00' // n
  }
  return turno === 'd' ? '08:00 a 20:00' : '20:00 a 08:00'
}

// Helper: horas por turno
function getHorasTurno(lugar) {
  return lugar === 'MODULAR' ? 8 : 12
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()

  const { legajo, mes, anio, lugar } = req.query
  if (!legajo || !mes || !anio) return res.status(400).json({ error: 'Faltan parámetros' })

  const MES  = parseInt(mes)
  const ANIO = parseInt(anio)
  const DIAS_MES = new Date(ANIO, MES, 0).getDate()
  const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
  const NOMBRE_MES = MESES[MES - 1] + ' ' + ANIO
  const LUGAR = lugar || 'HIGA'
  const HORAS_TURNO = getHorasTurno(LUGAR)

  // Cargar efectivo filtrando por lugar para evitar mezcla entre áreas
  const { data: efData } = await supabase
    .from('efectivos')
    .select('*')
    .eq('legajo', legajo)
    .eq('lugar', LUGAR)
    .maybeSingle()

  // Si no encuentra por lugar, buscar sin filtro (admin puede estar en otro lugar)
  const { data: efFallback } = !efData
    ? await supabase.from('efectivos').select('*').eq('legajo', legajo).maybeSingle()
    : { data: null }

  const ef = efData || efFallback
  if (!ef) return res.status(404).json({ error: 'Efectivo no encontrado' })

  // Cargar turnos, asistencia y planilla manual
  const [{ data: turnosData }, { data: asistData }, { data: manualData }] = await Promise.all([
    supabase.from('turnos').select('*').eq('legajo', legajo).eq('mes', MES).eq('anio', ANIO).order('dia'),
    supabase.from('asistencia').select('*').eq('legajo', legajo).eq('mes', MES).eq('anio', ANIO).eq('lugar', LUGAR),
    supabase.from('planilla_manual').select('*').eq('legajo', legajo).eq('mes', MES).eq('anio', ANIO).eq('lugar', LUGAR),
  ])

  // Mapa de asistencia confirmada
  const asistMap = {}
  ;(asistData || []).forEach(a => { asistMap[`${a.dia}-${a.turno}`] = a })

  // Construir guardias por día — solo turnos confirmados con asistencia
  const gdsMap = {}
  ;(turnosData || []).forEach(t => {
    const presente = asistMap[`${t.dia}-${t.turno}`]
    if (!presente) return
    if (!gdsMap[t.dia]) gdsMap[t.dia] = []
    const horario = getHorario(t.turno, LUGAR)
    const manualEntry = (manualData || []).find(m => parseInt(m.dia) === t.dia && m.horario === horario)
    const horas = manualEntry ? parseInt(manualEntry.horas) : HORAS_TURNO
    const yaExiste = gdsMap[t.dia].find(g => g.horario === horario)
    if (!yaExiste) gdsMap[t.dia].push({ horario, horas })
  })

  // Agregar entradas manuales confirmadas
  ;(manualData || []).forEach(m => {
    const dia = parseInt(m.dia)
    // Determinar el turno clave según el horario guardado
    let turnoKey
    if (LUGAR === 'MODULAR') {
      if (m.horario === '08:00 a 16:00') turnoKey = 'm'
      else if (m.horario === '16:00 a 23:59') turnoKey = 't'
      else turnoKey = 'n'
    } else {
      turnoKey = m.horario === '08:00 a 20:00' ? 'd' : 'n'
    }
    const presente = asistMap[`${dia}-${turnoKey}`]
    if (!presente) return
    if (!gdsMap[dia]) gdsMap[dia] = []
    const yaExiste = gdsMap[dia].find(g => g.horario === m.horario)
    if (!yaExiste) gdsMap[dia].push({ horario: m.horario, horas: parseInt(m.horas) || 0 })
  })

  // Total horas
  const totalHoras = Object.values(gdsMap).flat().reduce((s, g) => s + (g.horas || 0), 0)
  const total90 = Math.round(totalHoras * 0.9)

  // Cargar plantilla desde base64
  const buffer = Buffer.from(PLANTILLA_B64, 'base64')
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buffer)
  const ws = wb.getWorksheet('PLANILLA INDIVIDUAL')

  if (!ws) {
    // Si no existe la hoja con ese nombre, usar la primera
    const ws2 = wb.worksheets[0]
    if (!ws2) return res.status(500).json({ error: 'Plantilla inválida' })
  }

  const hoja = wb.getWorksheet('PLANILLA INDIVIDUAL') || wb.worksheets[0]

  // Rellenar datos del efectivo
  hoja.getCell('A7').value = ef.nombre
  hoja.getCell('D7').value = LUGAR
  hoja.getCell('B9').value = NOMBRE_MES.toUpperCase()
  hoja.getCell('C9').value = ef.jerarquia || ''
  hoja.getCell('D9').value = ef.legajo
  hoja.getCell('F9').value = ef.dni || ''

  // Columna izquierda: días 1-16 → filas 11-26
  for (let i = 0; i < 16; i++) {
    const dia = i + 1
    const fila = 11 + i
    const gs = gdsMap[dia] || []
    if (gs.length > 0) {
      hoja.getCell(`B${fila}`).value = gs[0].horario
      hoja.getCell(`C${fila}`).value = gs[0].horas !== null ? gs[0].horas : ''
    }
  }

  // Columna derecha: días 17-31 → filas 11-25
  for (let i = 0; i < 15; i++) {
    const dia = 17 + i
    const fila = 11 + i
    const gs = gdsMap[dia] || []
    if (gs.length > 0) {
      hoja.getCell(`E${fila}`).value = gs[0].horario
      hoja.getCell(`G${fila}`).value = gs[0].horas !== null ? gs[0].horas : ''
    }
  }

  // Totales
  hoja.getCell('G26').value = totalHoras
  const cellTotal90 = hoja.getCell('G27')
  cellTotal90.value = total90
  cellTotal90.numFmt = '0'

  // Declaración
  hoja.getCell('A29').value = `Declaro de conformidad, haber prestado ${totalHoras} horas de servicio de Policia Adicional, en el destino que figura la presente planilla.`

  // Firma del efectivo si existe
  if (ef.firma_url && ef.firma_url.startsWith('data:image')) {
    try {
      const base64Firma = ef.firma_url.split(',')[1]
      const ext = ef.firma_url.includes('png') ? 'png' : 'jpeg'
      const imgId = wb.addImage({ base64: base64Firma, extension: ext })
      hoja.addImage(imgId, { tl: { col: 0, row: 31 }, br: { col: 3, row: 35 } })
    } catch(e) { /* sin firma */ }
  }

  const outBuffer = await wb.xlsx.writeBuffer()
  const filename = `Planilla_${ef.nombre.replace(/,/g,'').replace(/\s+/g,'_')}_${LUGAR}_${NOMBRE_MES.replace(' ','_')}.xlsx`

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
  res.send(Buffer.from(outBuffer))
}
