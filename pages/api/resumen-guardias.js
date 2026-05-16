import ExcelJS from 'exceljs'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()
  const { mes, anio } = req.query
  if (!mes || !anio) return res.status(400).json({ error: 'Faltan parámetros' })
  const MES = parseInt(mes)
  const ANIO = parseInt(anio)
  const NOMBRE_MES = MESES[MES - 1] + ' ' + ANIO

  const [{ data: efectivos }, { data: turnos }] = await Promise.all([
    supabase.from('efectivos').select('legajo, nombre, tipo, jerarquia').eq('es_admin', false).order('nombre'),
    supabase.from('turnos').select('legajo, turno').eq('mes', MES).eq('anio', ANIO)
  ])

  const conteo = {}
  ;(turnos || []).forEach(t => {
    if (!conteo[t.legajo]) conteo[t.legajo] = { total: 0, dia: 0, noche: 0 }
    conteo[t.legajo].total++
    if (t.turno === 'd') conteo[t.legajo].dia++
    else conteo[t.legajo].noche++
  })

  const conTurnos = (efectivos || []).filter(e => (conteo[e.legajo]?.total || 0) > 0)
  const sinTurnos = (efectivos || []).filter(e => (conteo[e.legajo]?.total || 0) === 0)

  const NAVY='FF1a3a6b', WHITE='FFFFFFFF', BLACK='FF111111', RED='FF8b4040'

  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet(`Guardias ${NOMBRE_MES}`)
  ws.pageSetup = { orientation:'portrait', paperSize:9, fitToPage:true, fitToWidth:1, fitToHeight:0,
    margins:{left:0.5,right:0.5,top:0.5,bottom:0.5,header:0,footer:0} }
  ws.getColumn(1).width=6; ws.getColumn(2).width=42; ws.getColumn(3).width=12
  ws.getColumn(4).width=20; ws.getColumn(5).width=11; ws.getColumn(6).width=9
  ws.getColumn(7).width=9; ws.getColumn(8).width=9

  const b = (s='thin') => ({top:{style:s},bottom:{style:s},left:{style:s},right:{style:s}})
  const a = (h='center') => ({horizontal:h,vertical:'middle'})
  const f = (argb) => ({type:'pattern',pattern:'solid',fgColor:{argb}})

  ws.mergeCells('A1:H1'); ws.getRow(1).height=22
  Object.assign(ws.getCell('A1'), {value:'POLICIA ADICIONAL · MINISTERIO DE SEGURIDAD · MAR DEL PLATA',
    font:{name:'Arial',bold:true,size:9,color:{argb:WHITE}}, fill:f(NAVY), alignment:a(), border:b('medium')})

  ws.mergeCells('A2:H2'); ws.getRow(2).height=28
  Object.assign(ws.getCell('A2'), {value:`RESUMEN DE GUARDIAS DESIGNADAS — ${NOMBRE_MES.toUpperCase()}`,
    font:{name:'Arial',bold:true,size:13,color:{argb:NAVY}}, fill:f('FFf5f8ff'), alignment:a(), border:b()})

  ws.mergeCells('A3:H3'); ws.getRow(3).height=16
  Object.assign(ws.getCell('A3'), {value:`Efectivos con guardias: ${conTurnos.length}   ·   Sin guardias: ${sinTurnos.length}`,
    font:{name:'Arial',size:9,color:{argb:'FF444444'}}, fill:f('FFfafafa'), alignment:a(), border:b()})

  ws.getRow(4).height=20
  ;['N°','Apellido y Nombre','Legajo','Jerarquía','Guardias','Día','Noche','Horas'].forEach((h,i) => {
    const c=ws.getCell(4,i+1)
    c.value=h; c.font={name:'Arial',bold:true,size:9,color:{argb:WHITE}}
    c.fill=f(NAVY); c.alignment=a(i===1?'left':'center'); c.border=b()
  })

  let totalG=0,totalD=0,totalN=0
  conTurnos.forEach((ef,idx) => {
    const c=conteo[ef.legajo]||{total:0,dia:0,noche:0}
    totalG+=c.total; totalD+=c.dia; totalN+=c.noche
    const row=5+idx; const bg=idx%2===0?'FFffffff':'FFf0f4f8'
    ws.getRow(row).height=17
    ;[idx+1,ef.nombre,ef.legajo,ef.jerarquia||'—',c.total,c.dia,c.noche,c.total*12].forEach((v,i) => {
      const cell=ws.getCell(row,i+1)
      cell.value=v; cell.fill=f(bg); cell.alignment=a(i===1?'left':'center'); cell.border=b('thin')
      cell.font={name:'Arial',size:9,bold:i>=4,color:{argb:i===4?NAVY:BLACK}}
    })
  })

  const ft=5+conTurnos.length; ws.getRow(ft).height=20
  ;['','TOTAL GENERAL','','',totalG,totalD,totalN,totalG*12].forEach((v,i) => {
    const cell=ws.getCell(ft,i+1)
    cell.value=v; cell.font={name:'Arial',bold:true,size:10,color:{argb:WHITE}}
    cell.fill=f(NAVY); cell.alignment=a(i===1?'left':'center'); cell.border=b('medium')
  })

  if (sinTurnos.length > 0) {
    const ws2=wb.addWorksheet('Sin guardias')
    ws2.getColumn(1).width=6; ws2.getColumn(2).width=42; ws2.getColumn(3).width=12; ws2.getColumn(4).width=16
    ws2.mergeCells('A1:D1'); ws2.getRow(1).height=22
    Object.assign(ws2.getCell('A1'), {value:`SIN GUARDIAS ASIGNADAS — ${NOMBRE_MES.toUpperCase()}`,
      font:{name:'Arial',bold:true,size:11,color:{argb:WHITE}}, fill:f(RED), alignment:a(), border:b('medium')})
    ws2.getRow(2).height=18
    ;['N°','Apellido y Nombre','Legajo','Escalafón'].forEach((h,i) => {
      const c=ws2.getCell(2,i+1)
      c.value=h; c.font={name:'Arial',bold:true,size:9,color:{argb:WHITE}}
      c.fill=f(RED); c.alignment=a(i===1?'left':'center'); c.border=b()
    })
    sinTurnos.forEach((ef,idx) => {
      const row=3+idx; const bg=idx%2===0?'FFfff5f5':'FFffe8e8'
      ws2.getRow(row).height=16
      ;[idx+1,ef.nombre,ef.legajo,ef.tipo||''].forEach((v,i) => {
        const cell=ws2.getCell(row,i+1)
        cell.value=v; cell.fill=f(bg); cell.alignment=a(i===1?'left':'center'); cell.border=b('thin')
        cell.font={name:'Arial',size:9,color:{argb:'FF444444'}}
      })
    })
  }

  const buffer=await wb.xlsx.writeBuffer()
  res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition',`attachment; filename="Resumen_Guardias_${NOMBRE_MES.replace(' ','_')}.xlsx"`)
  res.send(Buffer.from(buffer))
}
