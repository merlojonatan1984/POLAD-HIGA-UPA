import ExcelJS from 'exceljs'
import JSZip from 'jszip'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']

function B(s='thin') { return {top:{style:s},bottom:{style:s},left:{style:s},right:{style:s}} }
function F(argb) { return {type:'pattern',pattern:'solid',fgColor:{argb}} }
function A(h='center') { return {horizontal:h,vertical:'middle',wrapText:false} }

async function generarPlanilla(ef, MES, ANIO, NOMBRE_MES_SOLO, LUGAR, turnos, asistencia, manual) {
  const asistMap = {}
  ;(asistencia||[]).filter(a=>a.legajo===ef.legajo).forEach(a=>{ asistMap[a.dia+'-'+a.turno]=a })

  const gdsMap = {}
  ;(turnos||[]).filter(t=>t.legajo===ef.legajo).forEach(t=>{
    const presente = asistMap[t.dia+'-'+t.turno]
    if (!presente) return // Solo guardias confirmadas
    if (!gdsMap[t.dia]) gdsMap[t.dia]=[]
    const horario = t.turno==='d'?'08:00 a 20:00':'20:00 a 08:00'
    const manualEntry = (manual||[]).find(m=>m.legajo===ef.legajo&&parseInt(m.dia)===t.dia&&m.horario===horario)
    const horas = manualEntry?parseInt(manualEntry.horas):12
    gdsMap[t.dia].push({horario,horas,confirmado:true})
  })

  ;(manual||[]).filter(m=>m.legajo===ef.legajo).forEach(m=>{
    const dia=parseInt(m.dia)
    if (!gdsMap[dia]) gdsMap[dia]=[]
    const yaExiste=gdsMap[dia].find(g=>g.horario===m.horario)
    if (!yaExiste) gdsMap[dia].push({horario:m.horario,horas:parseInt(m.horas)||0,confirmado:false})
  })

  const totalHoras = Object.values(gdsMap).flat().reduce((s,g)=>s+(g.horas||0),0)
  const total90 = Math.round(totalHoras*0.9)

  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('PLANILLA')

  ws.pageSetup = {orientation:'portrait',paperSize:9,fitToPage:true,fitToWidth:1,fitToHeight:1,
    margins:{left:0.5,right:0.3,top:0.5,bottom:0.5,header:0.1,footer:0.1}}

  ws.getColumn(1).width=11.85; ws.getColumn(2).width=20.71; ws.getColumn(3).width=13.71
  ws.getColumn(4).width=10.71; ws.getColumn(5).width=20.71; ws.getColumn(6).width=11.85; ws.getColumn(7).width=12.57

  const sv = (coord,val,opts={}) => {
    const c=ws.getCell(coord); c.value=val
    if (opts.bold||opts.size||opts.color) c.font={name:'Arial',bold:opts.bold,size:opts.size||10,color:{argb:opts.color||'FF000000'}}
    if (opts.fill) c.fill=F(opts.fill)
    if (opts.align) c.alignment=A(opts.align)
    if (opts.border) c.border=B(opts.border)
    if (opts.wrap) c.alignment={...c.alignment,wrapText:true}
  }

  ws.getRow(1).height=14; ws.getRow(2).height=14; ws.getRow(3).height=22
  ws.getRow(4).height=14; ws.getRow(5).height=14; ws.getRow(6).height=14
  ws.getRow(7).height=22; ws.getRow(8).height=14; ws.getRow(9).height=22
  ws.getRow(10).height=16
  for (let r=11;r<=26;r++) ws.getRow(r).height=18
  ws.getRow(27).height=16; ws.getRow(28).height=14; ws.getRow(29).height=30

  ws.mergeCells('A1:G1'); sv('A1','POLICIA ADICIONAL',{align:'center'})
  ws.mergeCells('A2:G2'); sv('A2','MINISTERIO DE SEGURIDAD',{align:'center'})
  ws.mergeCells('A3:G3'); sv('A3','PLANILLA DE CUMPLIMIENTO SERVICIO DE POLICIA ADICIONAL',
    {bold:true,size:12,align:'center',border:'medium'})

  ws.mergeCells('A4:C4'); sv('A4','Servicio Polad',{bold:true,align:'center',border:'thin'})
  ws.mergeCells('D4:G4'); sv('D4','Destino / domicilio del servicio',{bold:true,align:'center',border:'thin'})
  ws.mergeCells('A5:C5'); sv('A5','Ministerio de Salud - Pcia de Bs As',{bold:true,align:'center',border:'thin'})
  ws.mergeCells('D5:G5'); sv('D5','',{border:'thin'})

  ws.mergeCells('A6:C6'); sv('A6','Apellido y Nombre',{bold:true,align:'center',border:'thin'})
  ws.mergeCells('D6:E6'); sv('D6','Sucursal',{bold:true,align:'center',border:'thin'})
  ws.mergeCells('F6:G6'); sv('F6','Localidad',{bold:true,align:'center',border:'thin'})

  ws.mergeCells('A7:C7'); sv('A7',ef.nombre,{bold:true,align:'center',border:'thin'})
  ws.mergeCells('D7:E7'); sv('D7',LUGAR,{bold:true,align:'center',border:'thin'})
  ws.mergeCells('F7:G7'); sv('F7','Mar del Plata',{bold:true,align:'center',border:'thin'})

  sv('A8','Categoria',{bold:true,align:'center',border:'thin'})
  sv('B8','Mes/Ano',{bold:true,align:'center',border:'thin'})
  sv('C8','Jerarquia',{bold:true,align:'center',border:'thin'})
  ws.mergeCells('D8:E8'); sv('D8','Legajo',{bold:true,align:'center',border:'thin'})
  ws.mergeCells('F8:G8'); sv('F8','N Documento',{bold:true,align:'center',border:'thin'})

  sv('A9','1',{bold:true,align:'center',border:'thin'})
  sv('B9',NOMBRE_MES_SOLO.toUpperCase()+' '+ANIO,{bold:true,align:'center',border:'thin'})
  sv('C9',ef.jerarquia||'',{bold:true,align:'center',border:'thin'})
  ws.mergeCells('D9:E9'); sv('D9',ef.legajo,{bold:true,size:12,align:'center',border:'thin'})
  ws.mergeCells('F9:G9'); sv('F9',ef.dni||'',{bold:true,size:12,align:'center',border:'thin'})

  ;['DIA','HORARIO','HORAS','DIA','HORARIO','HORAS'].forEach((h,i)=>{
    const coord = String.fromCharCode(65+i)+'10'
    if (i===4) { ws.mergeCells('E10:F10'); sv('E10','HORARIO',{bold:true,align:'center',border:'thin',fill:'FFDDDDDD'}); return }
    if (i===5) { sv('G10','HORAS',{bold:true,align:'center',border:'thin',fill:'FFDDDDDD'}); return }
    sv(coord,h,{bold:true,align:'center',border:'thin',fill:'FFDDDDDD'})
  })

  for (let i=0;i<16;i++) {
    const dia=i+1; const fila=11+i
    const gs=gdsMap[dia]||[]
    sv('A'+fila,dia,{bold:true,align:'center',border:'thin'})
    sv('B'+fila,gs[0]?gs[0].horario:'',{align:'center',border:'thin'})
    sv('C'+fila,gs[0]&&gs[0].horas?gs[0].horas:'',{align:'center',border:'thin'})
    const dia2=17+i; const gs2=gdsMap[dia2]||[]
    sv('D'+fila,dia2<=31?dia2:'',{bold:true,align:'center',border:'thin'})
    ws.mergeCells('E'+fila+':F'+fila)
    sv('E'+fila,gs2[0]?gs2[0].horario:'',{align:'center',border:'thin'})
    sv('G'+fila,gs2[0]&&gs2[0].horas?gs2[0].horas:'',{align:'center',border:'thin'})
  }

  ws.mergeCells('D26:F26')
  sv('D26','TOTAL DE HORAS CUMPLIDAS EN EL MES',{bold:true,align:'center',border:'thin',wrap:true})
  sv('G26',totalHoras||'',{bold:true,align:'center',border:'thin'})
  ws.mergeCells('D27:F27')
  sv('D27','TOTAL 90 %',{bold:true,align:'center',border:'thin'})
  sv('G27',total90||'',{bold:true,align:'center',border:'thin'})

  ws.mergeCells('A29:G30')
  sv('A29','Declaro de conformidad, haber prestado '+totalHoras+' horas de servicio de Policia Adicional, en el destino que figura la presente planilla.',
    {align:'left',wrap:true})

  return await wb.xlsx.writeBuffer()
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()
  const { mes, anio, lugar } = req.query
  if (!mes || !anio) return res.status(400).json({ error: 'Faltan parametros' })

  const MES=parseInt(mes), ANIO=parseInt(anio)
  const LUGAR=lugar||'HIGA'
  const NOMBRE_MES_SOLO=MESES[MES-1]
  const NOMBRE_MES=NOMBRE_MES_SOLO+' '+ANIO

  const [ef_r,t_r,a_r,m_r] = await Promise.all([
    supabase.from('efectivos').select('*').eq('es_admin',false).order('nombre'),
    supabase.from('turnos').select('*').eq('mes',MES).eq('anio',ANIO),
    supabase.from('asistencia').select('*').eq('mes',MES).eq('anio',ANIO),
    supabase.from('planilla_manual').select('*').eq('mes',MES).eq('anio',ANIO)
  ])

  const efectivos=ef_r.data||[], turnos=t_r.data||[], asistencia=a_r.data||[], manual=m_r.data||[]
  const legajosConTurnos=new Set(turnos.map(t=>t.legajo))
  const efConTurnos=efectivos.filter(e=>legajosConTurnos.has(e.legajo))

  const zip=new JSZip()
  const carpeta=zip.folder('Planillas_'+NOMBRE_MES.replace(' ','_'))

  for (const ef of efConTurnos) {
    try {
      const buffer=await generarPlanilla(ef,MES,ANIO,NOMBRE_MES_SOLO,LUGAR,turnos,asistencia,manual)
      const nombre=ef.nombre.replace(/,/g,'').replace(/\s+/g,'_').substring(0,25)
      carpeta.file(nombre+'_'+ef.legajo+'.xlsx', buffer)
    } catch(err) {
      console.error('Error planilla',ef.legajo,err.message)
    }
  }

  const zipBuffer=await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'})
  res.setHeader('Content-Type','application/zip')
  res.setHeader('Content-Disposition','attachment; filename="Planillas_'+NOMBRE_MES.replace(' ','_')+'.zip"')
  res.send(zipBuffer)
}
