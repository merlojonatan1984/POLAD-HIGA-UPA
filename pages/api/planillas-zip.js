import ExcelJS from 'exceljs'
import JSZip from 'jszip'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']

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
      return res.status(200).json({ error: 'Sin asistencias para ' + LUGAR })

    const legajos = [...new Set(asistencias.map(a => a.legajo))]
    const { data: efectivos } = await supabase.from('efectivos').select('*').in('legajo', legajos)
    const { data: manual } = await supabase.from('planilla_manual').select('*')
      .eq('mes', MES).eq('anio', ANIO).eq('lugar', LUGAR)

    const zip = new JSZip()
    const carpeta = zip.folder('Planillas_' + NOMBRE_MES.replace(' ', '_'))

    for (const ef of (efectivos || [])) {
      const asistEf = asistencias.filter(a => a.legajo === ef.legajo)
      const manualEf = (manual || []).filter(m => m.legajo === ef.legajo)

      // Mapa dia -> guardias confirmadas
      const gdsMap = {}
      asistEf.forEach(a => {
        const horario = a.turno === 'd' ? '08:00 a 20:00' : '20:00 a 08:00'
        const man = manualEf.find(m => parseInt(m.dia) === a.dia && m.horario === horario)
        const horas = man ? parseInt(man.horas) : 12
        if (!gdsMap[a.dia]) gdsMap[a.dia] = []
        if (!gdsMap[a.dia].find(g => g.h === horario))
          gdsMap[a.dia].push({ h: horario, hs: horas })
      })

      const totalHoras = Object.values(gdsMap).flat().reduce((s, g) => s + g.hs, 0)
      const total90 = Math.round(totalHoras * 0.9)

      // Excel sin mergeCells
      const wb = new ExcelJS.Workbook()
      const ws = wb.addWorksheet('Planilla')

      ws.getColumn(1).width = 5
      ws.getColumn(2).width = 20
      ws.getColumn(3).width = 10
      ws.getColumn(4).width = 5
      ws.getColumn(5).width = 20
      ws.getColumn(6).width = 10

      const N = { argb: 'FF1a3a6b' }
      const W = { argb: 'FFFFFFFF' }
      const K = { argb: 'FF111111' }
      const G = { argb: 'FFf0f0f0' }
      const bn = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } })
      const br = () => ({ top:{style:'thin'}, bottom:{style:'thin'}, left:{style:'thin'}, right:{style:'thin'} })

      const r1 = ws.addRow(['POLICIA ADICIONAL - MINISTERIO DE SEGURIDAD - MAR DEL PLATA', '', '', '', '', ''])
      r1.height = 20
      r1.getCell(1).font = { name:'Arial', bold:true, size:9, color:W }
      r1.getCell(1).fill = bn('FF1a3a6b')
      r1.getCell(1).alignment = { horizontal:'center', vertical:'middle' }
      r1.getCell(1).border = br()

      const r2 = ws.addRow(['PLANILLA DE CUMPLIMIENTO - SERVICIO DE POLICIA ADICIONAL', '', '', '', '', ''])
      r2.height = 18
      r2.getCell(1).font = { name:'Arial', bold:true, size:9, color:W }
      r2.getCell(1).fill = bn('FF1a3a6b')
      r2.getCell(1).alignment = { horizontal:'center', vertical:'middle' }
      r2.getCell(1).border = br()

      ws.addRow(['Nombre', ef.nombre, '', 'Lugar', LUGAR, ''])
      ws.addRow(['Legajo', ef.legajo, '', 'Mes', NOMBRE_MES_SOLO.toUpperCase() + ' ' + ANIO, ''])
      ws.addRow(['Jerarquia', ef.jerarquia || '', '', 'DNI', ef.dni || '', ''])

      const rh = ws.addRow(['DIA', 'HORARIO', 'HORAS', 'DIA', 'HORARIO', 'HORAS'])
      rh.height = 18
      rh.eachCell(c => {
        c.font = { name:'Arial', bold:true, size:9, color:W }
        c.fill = bn('FF1a3a6b')
        c.alignment = { horizontal:'center', vertical:'middle' }
        c.border = br()
      })

      for (let i = 0; i < 16; i++) {
        const d1 = i + 1, d2 = i + 17
        const g1 = gdsMap[d1] || []
        const g2 = gdsMap[d2] || []
        const row = ws.addRow([
          d1,
          g1[0] ? g1[0].h : '',
          g1[0] ? g1[0].hs : '',
          d2 <= 31 ? d2 : '',
          g2[0] ? g2[0].h : '',
          g2[0] ? g2[0].hs : ''
        ])
        row.height = 16
        row.eachCell(c => { c.font = { name:'Arial', size:9, color:K }; c.border = br(); c.alignment = { horizontal:'center', vertical:'middle' } })
        row.getCell(1).fill = bn('FFf5f5f5')
        row.getCell(4).fill = bn('FFf5f5f5')
      }

      const rt = ws.addRow(['TOTAL HORAS CUMPLIDAS', totalHoras, '', 'TOTAL 90%', total90, ''])
      rt.height = 20
      rt.eachCell(c => {
        c.font = { name:'Arial', bold:true, size:10, color:W }
        c.fill = bn('FF1a3a6b')
        c.border = br()
        c.alignment = { horizontal:'center', vertical:'middle' }
      })

      ws.addRow(['Declaro de conformidad, haber prestado ' + totalHoras + ' horas de servicio de Policia Adicional.'])

      const buffer = await wb.xlsx.writeBuffer()
      const nombre = ef.nombre.replace(/,/g,'').replace(/\s+/g,'_').substring(0, 25)
      carpeta.file(nombre + '_' + ef.legajo + '.xlsx', Buffer.from(buffer))
    }

    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
    res.setHeader('Content-Type', 'application/zip')
    res.setHeader('Content-Disposition', 'attachment; filename="Planillas_' + LUGAR + '_' + NOMBRE_MES.replace(' ','_') + '.zip"')
    res.send(zipBuffer)

  } catch(err) {
    res.status(500).json({ error: err.message, stack: err.stack })
  }
}
