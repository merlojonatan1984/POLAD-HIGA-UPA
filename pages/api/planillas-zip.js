import ExcelJS from 'exceljs'
import JSZip from 'jszip'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
const PLANTILLA_B64 =  + b64 + 

async function generarPlanillaEf(ef, MES, ANIO, NOMBRE_MES_SOLO, LUGAR, asistEf, manualEf) {
  // Construir guardias confirmadas
  const gdsMap = {}
  asistEf.forEach(a => {
    const horario = a.turno === 'd' ? '08:00 a 20:00' : '20:00 a 08:00'
    const man = manualEf.find(m => parseInt(m.dia) === a.dia && m.horario === horario)
    const horas = man ? parseInt(man.horas) : 12
    if (!gdsMap[a.dia]) gdsMap[a.dia] = []
    if (!gdsMap[a.dia].find(g => g.horario === horario))
      gdsMap[a.dia].push({ horario, horas })
  })

  const totalHoras = Object.values(gdsMap).flat().reduce((s, g) => s + g.horas, 0)
  const total90 = Math.round(totalHoras * 0.9)

  const buffer = Buffer.from(PLANTILLA_B64, 'base64')
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buffer)
  const ws = wb.getWorksheet(1)
  if (!ws) throw new Error('No se pudo cargar la hoja')

  const sv = (coord, val) => { const c = ws.getCell(coord); if (c) c.value = val }

  sv('A7', ef.nombre)
  sv('D7', LUGAR)
  sv('B9', NOMBRE_MES_SOLO.toUpperCase() + ' ' + ANIO)
  sv('C9', ef.jerarquia || '')
  sv('D9', ef.legajo)
  sv('F9', ef.dni || '')

  for (let i = 0; i < 16; i++) {
    const dia = i + 1
    const gs = gdsMap[dia] || []
    if (gs[0]) { sv('B' + (11+i), gs[0].horario); sv('C' + (11+i), gs[0].horas) }
  }
  for (let i = 0; i < 15; i++) {
    const dia = 17 + i
    const gs = gdsMap[dia] || []
    if (gs[0]) { sv('E' + (11+i), gs[0].horario); sv('G' + (11+i), gs[0].horas) }
  }

  sv('G26', totalHoras)
  const c90 = ws.getCell('G27')
  if (c90) { c90.value = total90; c90.numFmt = '0' }
  sv('A29', 'Declaro de conformidad, haber prestado ' + totalHoras + ' horas de servicio de Policia Adicional, en el destino que figura la presente planilla.')

  return await wb.xlsx.writeBuffer()
}

export default async function handler(req, res) {
  try {
    const { mes, anio, lugar } = req.query
    const MES = parseInt(mes), ANIO = parseInt(anio)
    const LUGAR = lugar || 'HIGA'
    const NOMBRE_MES_SOLO = MESES[MES-1]
    const NOMBRE_MES = NOMBRE_MES_SOLO + ' ' + ANIO

    const { data: asistencias, error: aErr } = await supabase
      .from('asistencia').select('*')
      .eq('mes', MES).eq('anio', ANIO).eq('lugar', LUGAR)

    if (aErr) return res.status(500).json({ error: aErr.message })
    if (!asistencias || asistencias.length === 0)
      return res.status(200).json({ error: 'Sin asistencias confirmadas para ' + LUGAR + ' en ' + NOMBRE_MES })

    const legajos = [...new Set(asistencias.map(a => a.legajo))]
    const { data: efectivos } = await supabase.from('efectivos').select('*').in('legajo', legajos)
    const { data: manual } = await supabase.from('planilla_manual').select('*')
      .eq('mes', MES).eq('anio', ANIO).eq('lugar', LUGAR)

    const zip = new JSZip()
    const carpeta = zip.folder('Planillas_' + NOMBRE_MES.replace(' ', '_'))

    for (const ef of (efectivos || [])) {
      try {
        const asistEf = asistencias.filter(a => a.legajo === ef.legajo)
        const manualEf = (manual || []).filter(m => m.legajo === ef.legajo)
        const buffer = await generarPlanillaEf(ef, MES, ANIO, NOMBRE_MES_SOLO, LUGAR, asistEf, manualEf)
        const nombre = ef.nombre.replace(/,/g,'').replace(/\s+/g,'_').substring(0, 25)
        carpeta.file(nombre + '_' + ef.legajo + '.xlsx', Buffer.from(buffer))
      } catch(err) {
        console.error('Error planilla', ef.legajo, err.message)
      }
    }

    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
    res.setHeader('Content-Type', 'application/zip')
    res.setHeader('Content-Disposition', 'attachment; filename="Planillas_' + LUGAR + '_' + NOMBRE_MES.replace(' ','_') + '.zip"')
    res.send(zipBuffer)

  } catch(err) {
    res.status(500).json({ error: err.message })
  }
}
