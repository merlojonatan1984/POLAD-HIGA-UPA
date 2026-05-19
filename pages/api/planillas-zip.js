import ExcelJS from 'exceljs'
import JSZip from 'jszip'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']

export default async function handler(req, res) {
  const { mes, anio, lugar } = req.query
  const MES = parseInt(mes), ANIO = parseInt(anio)
  const LUGAR = lugar || 'HIGA'
  const NOMBRE_MES_SOLO = MESES[MES-1]
  const NOMBRE_MES = NOMBRE_MES_SOLO + ' ' + ANIO

  // Traer asistencias del lugar indicado
  const { data: asistencias } = await supabase
    .from('asistencia')
    .select('*')
    .eq('mes', MES).eq('anio', ANIO).eq('lugar', LUGAR)

  if (!asistencias || asistencias.length === 0) {
    return res.status(200).json({ error: 'No hay asistencias confirmadas para ' + LUGAR + ' en ' + NOMBRE_MES })
  }

  // Legajos únicos con asistencia
  const legajos = [...new Set(asistencias.map(a => a.legajo))]

  // Traer efectivos
  const { data: efectivos } = await supabase
    .from('efectivos')
    .select('*')
    .in('legajo', legajos)

  // Traer planilla manual del lugar
  const { data: manual } = await supabase
    .from('planilla_manual')
    .select('*')
    .eq('mes', MES).eq('anio', ANIO).eq('lugar', LUGAR)

  const zip = new JSZip()
  const carpeta = zip.folder('Planillas_' + NOMBRE_MES.replace(' ', '_'))

  for (const ef of (efectivos || [])) {
    try {
      // Asistencias de este efectivo
      const asistEf = asistencias.filter(a => a.legajo === ef.legajo)
      const manualEf = (manual || []).filter(m => m.legajo === ef.legajo)

      // Construir mapa de guardias por día
      const gdsMap = {}
      asistEf.forEach(a => {
        const horario = a.turno === 'd' ? '08:00 a 20:00' : '20:00 a 08:00'
        const manualEntry = manualEf.find(m => parseInt(m.dia) === a.dia && m.horario === horario)
        const horas = manualEntry ? parseInt(manualEntry.horas) : 12
        if (!gdsMap[a.dia]) gdsMap[a.dia] = []
        if (!gdsMap[a.dia].find(g => g.horario === horario)) {
          gdsMap[a.dia].push({ horario, horas })
        }
      })

      const totalHoras = Object.values(gdsMap).flat().reduce((s, g) => s + g.horas, 0)
      const total90 = Math.round(totalHoras * 0.9)

      // Generar Excel simple
      const wb = new ExcelJS.Workbook()
      const ws = wb.addWorksheet('PLANILLA')

      ws.getColumn(1).width = 12
      ws.getColumn(2).width = 22
      ws.getColumn(3).width = 14
      ws.getColumn(4).width = 11
      ws.getColumn(5).width = 22
      ws.getColumn(6).width = 12
      ws.getColumn(7).width = 13

      const navy = 'FF1a3a6b'
      const white = 'FFFFFFFF'
      const black = 'FF111111'
      const gray = 'FFf0f0f0'

      const setCell = (coord, val, bold, fill, color) => {
        const c = ws.getCell(coord)
        c.value = val
        c.font = { name: 'Arial', size: 9, bold: !!bold, color: { argb: color || black } }
        if (fill) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } }
        c.alignment = { horizontal: 'center', vertical: 'middle' }
        c.border = { top:{style:'thin'}, bottom:{style:'thin'}, left:{style:'thin'}, right:{style:'thin'} }
      }

      // Encabezado
      ws.mergeCells('A1:G1')
      setCell('A1', 'POLICIA ADICIONAL — MINISTERIO DE SEGURIDAD', true, navy, white)
      ws.getRow(1).height = 22

      ws.mergeCells('A2:G2')
      setCell('A2', 'PLANILLA DE CUMPLIMIENTO SERVICIO DE POLICIA ADICIONAL', true, navy, white)
      ws.getRow(2).height = 18

      // Datos del efectivo
      ws.getRow(3).height = 16
      setCell('A3', 'Nombre:', true, gray)
      ws.mergeCells('B3:D3'); setCell('B3', ef.nombre, true)
      setCell('E3', 'Sucursal:', true, gray)
      ws.mergeCells('F3:G3'); setCell('F3', LUGAR, true)

      ws.getRow(4).height = 16
      setCell('A4', 'Legajo:', true, gray)
      ws.mergeCells('B4:D4'); setCell('B4', ef.legajo)
      setCell('E4', 'Mes/Año:', true, gray)
      ws.mergeCells('F4:G4'); setCell('F4', NOMBRE_MES_SOLO.toUpperCase() + ' ' + ANIO)

      ws.getRow(5).height = 16
      setCell('A5', 'Jerarquía:', true, gray)
      ws.mergeCells('B5:D5'); setCell('B5', ef.jerarquia || '')
      setCell('E5', 'DNI:', true, gray)
      ws.mergeCells('F5:G5'); setCell('F5', ef.dni || '')

      // Headers tabla
      ws.getRow(6).height = 18
      ;['DÍA','HORARIO','HORAS','DÍA','HORARIO','HORAS'].forEach((h, i) => {
        if (i === 3) ws.mergeCells('D6:D6')
        const cols = ['A','B','C','D','E','F']
        // G queda para posibles extras
        setCell(cols[i] + '6', h, true, navy, white)
      })
      setCell('G6', '', true, navy, white)

      // Filas de datos — columna izq días 1-16, columna der días 17-31
      for (let i = 0; i < 16; i++) {
        const dia1 = i + 1
        const dia2 = i + 17
        const fila = 7 + i
        ws.getRow(fila).height = 16

        const gs1 = gdsMap[dia1] || []
        const gs2 = gdsMap[dia2] || []

        setCell('A' + fila, dia1, true, 'FFf5f5f5')
        setCell('B' + fila, gs1[0] ? gs1[0].horario : '')
        setCell('C' + fila, gs1[0] ? gs1[0].horas : '')

        if (dia2 <= 31) {
          setCell('D' + fila, dia2, true, 'FFf5f5f5')
          setCell('E' + fila, gs2[0] ? gs2[0].horario : '')
          setCell('F' + fila, gs2[0] ? gs2[0].horas : '')
          setCell('G' + fila, '')
        } else {
          ;['D','E','F','G'].forEach(c => setCell(c + fila, ''))
        }
      }

      // Totales
      const filaTotal = 23
      ws.getRow(filaTotal).height = 20
      ws.mergeCells('A' + filaTotal + ':E' + filaTotal)
      setCell('A' + filaTotal, 'TOTAL HORAS CUMPLIDAS EN EL MES', true, navy, white)
      ws.mergeCells('F' + filaTotal + ':G' + filaTotal)
      setCell('F' + filaTotal, totalHoras, true, navy, white)

      const filaTot90 = 24
      ws.getRow(filaTot90).height = 20
      ws.mergeCells('A' + filaTot90 + ':E' + filaTot90)
      setCell('A' + filaTot90, 'TOTAL 90%', true, navy, white)
      ws.mergeCells('F' + filaTot90 + ':G' + filaTot90)
      setCell('F' + filaTot90, total90, true, navy, white)

      // Declaración
      ws.getRow(25).height = 30
      ws.mergeCells('A25:G25')
      const cDecl = ws.getCell('A25')
      cDecl.value = 'Declaro de conformidad, haber prestado ' + totalHoras + ' horas de servicio de Policia Adicional, en el destino que figura la presente planilla.'
      cDecl.font = { name: 'Arial', size: 8 }
      cDecl.alignment = { wrapText: true, vertical: 'middle' }
      cDecl.border = { top:{style:'thin'}, bottom:{style:'thin'}, left:{style:'thin'}, right:{style:'thin'} }

      const buffer = await wb.xlsx.writeBuffer()
      const nombre = ef.nombre.replace(/,/g, '').replace(/\s+/g, '_').substring(0, 25)
      carpeta.file(nombre + '_' + ef.legajo + '.xlsx', Buffer.from(buffer))

    } catch (err) {
      console.error('Error generando planilla para', ef.legajo, err.message)
    }
  }

  const zipBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
  res.setHeader('Content-Type', 'application/zip')
  res.setHeader('Content-Disposition', 'attachment; filename="Planillas_' + LUGAR + '_' + NOMBRE_MES.replace(' ', '_') + '.zip"')
  res.send(zipBuffer)
}
