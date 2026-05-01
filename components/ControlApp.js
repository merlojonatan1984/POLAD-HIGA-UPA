import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../lib/supabase'

const MES = new Date().getMonth() + 1
const ANIO = new Date().getFullYear()
const DIAS_MES = new Date(ANIO, MES, 0).getDate()
const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
const NOMBRE_MES = MESES[MES-1] + ' ' + ANIO
const NOMBRE_MES_SOLO = MESES[MES-1]
const SECTORES = ['Salud Mental','Giratoria','Llaves','Guardia','Estacionamiento','UPA']
const SEC_COLORS = { 'Salud Mental':'#378ADD','Giratoria':'#1D9E75','Llaves':'#EF9F27','Guardia':'#D4537E','Estacionamiento':'#7F77DD','UPA':'#D85A30' }
const LUGARES = ['HIGA','UPA','MODULAR']

export default function ControlApp() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [lugar, setLugar] = useState('HIGA')
  const [diaActual, setDiaActual] = useState(new Date().getDate())
  const [efectivos, setEfectivos] = useState([])
  const [turnos, setTurnos] = useState([])
  const [asistencia, setAsistencia] = useState({})
  const [firmas, setFirmas] = useState({})
  const [planillaEf, setPlanillaEf] = useState(null)
  const [subiendoFirma, setSubiendoFirma] = useState(null)
  const [msg, setMsg] = useState(null)
  const firmaRef = useRef()
  const [legajoFirma, setLegajoFirma] = useState(null)
  const [preview, setPreview] = useState(null)
  const [previewKey, setPreviewKey] = useState(0)

  useEffect(() => {
    const u = localStorage.getItem('polad_user')
    if (!u) { router.push('/'); return }
    const parsed = JSON.parse(u)
    if (!parsed.es_admin) { router.push('/efectivo'); return }
    cargarDatos('HIGA')
  }, [])

  async function cargarDatos(lg) {
    setLoading(true)
    const [{ data: efs }, { data: turns }, { data: asist }, { data: firmasData }] = await Promise.all([
      supabase.from('efectivos').select('*').eq('es_admin', false).order('nombre'),
      supabase.from('turnos').select('*').eq('mes', MES).eq('anio', ANIO),
      supabase.from('asistencia').select('*').eq('mes', MES).eq('anio', ANIO),
      supabase.from('firmas').select('*').eq('mes', MES).eq('anio', ANIO)
    ])
    setEfectivos(efs || [])
    setTurnos(turns || [])
    const asistMap = {}
    ;(asist || []).forEach(a => { asistMap[`${a.legajo}-${a.dia}-${a.turno}`] = a })
    setAsistencia(asistMap)
    const firmasMap = {}
    ;(firmasData || []).forEach(f => { firmasMap[f.legajo] = f })
    setFirmas(firmasMap)
    setLoading(false)
  }

  async function togglePresente(legajo, dia, turno, sector) {
    const key = `${legajo}-${dia}-${turno}`
    const existe = asistencia[key]
    if (existe) {
      await supabase.from('asistencia').delete().eq('id', existe.id)
      const nuevo = { ...asistencia }
      delete nuevo[key]
      setAsistencia(nuevo)
    } else {
      const { data } = await supabase.from('asistencia').insert([{
        legajo, mes: MES, anio: ANIO, dia, turno, sector, lugar,
        presente: true, confirmado_at: new Date().toISOString()
      }]).select().single()
      if (data) setAsistencia(prev => ({ ...prev, [key]: data }))
    }
  }

  async function subirFirma(legajo, file) {
    setSubiendoFirma(legajo)
    const reader = new FileReader()
    reader.onload = async (e) => {
      const base64 = e.target.result
      const existeFirma = firmas[legajo]
      if (existeFirma) {
        await supabase.from('firmas').update({ firma_url: base64 }).eq('id', existeFirma.id)
      } else {
        await supabase.from('firmas').insert([{ legajo, mes: MES, anio: ANIO, firma_url: base64 }])
      }
      setFirmas(prev => ({ ...prev, [legajo]: { ...prev[legajo], firma_url: base64 } }))
      setSubiendoFirma(null)
      setMsg('Firma guardada correctamente.')
      setTimeout(() => setMsg(null), 2500)
    }
    reader.readAsDataURL(file)
  }

  function imprimirPlanilla(ef) {
    const turnosEf = turnos.filter(t => t.legajo === ef.legajo).sort((a,b) => a.dia - b.dia)
    const firma = firmas[ef.legajo]?.firma_url || ''

    const filas = buildFilas(ef, asistencia)

    const totalHoras = filas.reduce((sum, f) => sum + (parseInt(f.horas) || 0) + (f.extra ? parseInt(f.extra.horas) || 0 : 0), 0)
    const total90 = Math.round(totalHoras * 0.9)

    const win = window.open('', '_blank')
    win.document.write(`<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Planilla ${ef.nombre}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:Arial,sans-serif;font-size:10px;padding:12mm;color:#000}
h2{font-size:13px;text-align:center;margin-bottom:3px}
h3{font-size:11px;text-align:center;margin-bottom:8px}
.field{border-bottom:1px solid #000;padding:2px 0;margin-bottom:4px}
.field label{font-size:8px;color:#555;display:block}
.field span{font-size:10px;font-weight:bold}
.row4{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:6px}
.row2{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:6px}
table{width:100%;border-collapse:collapse;margin-bottom:8px}
th{background:#333;color:#fff;padding:4px;font-size:9px;text-align:center;border:1px solid #000}
td{border:1px solid #000;padding:3px 5px;font-size:9px;text-align:center;height:18px}
td.dia{font-weight:bold;background:#f5f5f5}
td.ok{background:#e8f5e9}
.decl{font-size:9px;margin-bottom:14px;line-height:1.5}
.firmas{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:8px}
.firma-box{text-align:center}
.firma-img{width:100%;max-width:400px;max-height:180px;margin-bottom:4px;object-fit:contain}
.firma-line{border-top:1px solid #000;padding-top:3px;font-size:9px}
@media print{body{padding:8mm}}
</style></head><body>
<h2>POLICIA ADICIONAL — MINISTERIO DE SEGURIDAD</h2>
<h3>PLANILLA DE CUMPLIMIENTO SERVICIO DE POLICÍA ADICIONAL</h3>
<div class="row2">
  <div>
    <div class="field"><label>Servicio POLAD</label><span>POLAD</span></div>
    <div class="field"><label>Destino</label><span>Ministerio de Salud - Pcia de Bs As</span></div>
  </div>
  <div>
    <div class="field"><label>Sucursal</label><span>${lugar}</span></div>
    <div class="field"><label>Localidad</label><span>Mar del Plata</span></div>
  </div>
</div>
<div class="row4">
  <div class="field"><label>Apellido y Nombre</label><span>${ef.nombre}</span></div>
  <div class="field"><label>Mes / Año</label><span>${NOMBRE_MES_SOLO.toUpperCase()} ${ANIO}</span></div>
  <div class="field"><label>Jerarquía</label><span>${ef.jerarquia || ''}</span></div>
  <div class="field"><label>Categoría</label><span>1°</span></div>
</div>
<div class="row4">
  <div class="field"><label>Legajo</label><span>${ef.legajo}</span></div>
  <div class="field"><label>N° Documento</label><span>${ef.dni || ''}</span></div>
  <div class="field"></div><div class="field"></div>
</div>
<table>
  <thead><tr><th>DÍA</th><th>HORARIO</th><th>HORAS</th><th>DÍA</th><th>HORARIO</th><th>HORAS</th></tr></thead>
  <tbody>
    ${Array.from({length:16},(_,i)=>{
      const f1=filas[i]||{}; const f2=filas[i+16]||{}
      return `<tr>
        <td class="dia">${f1.dia||''}</td>
        <td class="${f1.confirmado?'ok':''}">${f1.horario||''}</td>
        <td class="${f1.confirmado?'ok':''}">${f1.horas||''}</td>
        <td class="dia">${f2.dia||''}</td>
        <td class="${f2.confirmado?'ok':''}">${f2.horario||''}</td>
        <td class="${f2.confirmado?'ok':''}">${f2.horas||''}</td>
      </tr>`}).join('')}
    <tr><td colspan="3" style="text-align:right;font-weight:bold">TOTAL HORAS CUMPLIDAS</td><td colspan="3" style="font-weight:bold;font-size:12px">${totalHoras}</td></tr>
    <tr><td colspan="3" style="text-align:right;font-weight:bold">TOTAL 90%</td><td colspan="3" style="font-weight:bold;font-size:12px">${total90}</td></tr>
  </tbody>
</table>
<div class="decl">Declaro de conformidad, haber prestado <strong>${totalHoras}</strong> horas de servicio de Policía Adicional, en el destino que figura en la presente planilla.</div>
<div class="firmas">
  <div class="firma-box">
    ${firma?`<img src="${firma}" class="firma-img" />`:'<div style="height:50px"></div>'}
    <div class="firma-line">FIRMA EFECTIVO — ${ef.nombre}</div>
  </div>
  <div class="firma-box">
    <div style="height:50px"></div>
    <div class="firma-line">FIRMA ENCARGADO — Crio. Paulo Corbela</div>
  </div>
</div>
</body></html>`)
    win.document.close()
    setTimeout(() => win.print(), 500)
  }

  if (loading) return <div className="loading">Cargando...</div>

  const nombreEf = leg => { const e = efectivos.find(x => x.legajo === leg); return e ? e.nombre : leg }
  const datosEf = leg => efectivos.find(x => x.legajo === leg)

  // Turnos del día actual organizados por sector y turno
  const turnosHoy = turnos.filter(t => t.dia === diaActual)

  function buildFilas(ef, asistMap) {
    const asistRef = asistMap || asistencia
    const turnosEf = turnos.filter(t => t.legajo === ef.legajo).sort((a,b) => a.dia - b.dia)
    // Build base rows
    const rows = {}
    Array.from({ length: DIAS_MES }, (_, i) => i + 1).forEach(dia => {
      rows[dia] = { dia, horario: '', horas: '', confirmado: false, extra: null }
    })
    
    Array.from({ length: DIAS_MES }, (_, i) => i + 1).forEach(dia => {
      const tDia = turnosEf.find(t => t.dia === dia && t.turno === 'd')
      const tNoche = turnosEf.find(t => t.dia === dia && t.turno === 'n')
      const pDia = asistRef[`${ef.legajo}-${dia}-d`]
      const pNoche = asistRef[`${ef.legajo}-${dia}-n`]
      
      if (pDia) {
        // Turno día: 08:00-20:00 = 12 hs todo en el mismo día
        rows[dia].horario = '08:00 a 20:00'
        rows[dia].horas = '12'
        rows[dia].confirmado = true
      } else if (tDia) {
        rows[dia].horario = '08:00 a 20:00'
        rows[dia].horas = ''
      }
      
      if (pNoche) {
        // Turno noche: 20:00-24:00 = 4 hs en este día, 00:00-08:00 = 8 hs en el siguiente
        if (rows[dia].horario) {
          // Ya tiene turno día, agregar noche como extra
          rows[dia].extra = { horario: '20:00 a 24:00', horas: '4' }
        } else {
          rows[dia].horario = '20:00 a 24:00'
          rows[dia].horas = '4'
          rows[dia].confirmado = true
        }
        // Agregar 8 hs al día siguiente
        const diaSig = dia + 1
        if (diaSig <= DIAS_MES) {
          if (!rows[diaSig].horario) {
            rows[diaSig].horario = '00:00 a 08:00'
            rows[diaSig].horas = '8'
            rows[diaSig].confirmado = true
          } else {
            rows[diaSig].extra = { horario: '00:00 a 08:00', horas: '8' }
          }
        }
      } else if (tNoche && !pNoche) {
        if (!rows[dia].horario) {
          rows[dia].horario = '20:00 a 24:00'
          rows[dia].horas = ''
        }
      }
    })
    
    return Array.from({ length: DIAS_MES }, (_, i) => rows[i + 1])
  }

  return (
    <div>
      {preview && (() => { const _k = previewKey;
        const ef = preview
        const firma = firmas[ef.legajo]?.firma_url || ''
        const filas = buildFilas(ef)
        const totalHoras = filas.reduce((sum, f) => sum + (parseInt(f.horas) || 0) + (f.extra ? parseInt(f.extra.horas) || 0 : 0), 0)
        const total90 = Math.round(totalHoras * 0.9)
        return (
          <div style={{ position:'fixed',inset:0,background:'rgba(0,0,0,0.8)',zIndex:100,overflowY:'auto',padding:'20px' }}>
            <div style={{ maxWidth:760,margin:'0 auto',background:'#fff',borderRadius:8,overflow:'hidden' }}>
              {/* Toolbar */}
              <div style={{ background:'#1a1d27',padding:'12px 16px',display:'flex',justifyContent:'space-between',alignItems:'center' }}>
                <span style={{ color:'#e8eaf0',fontWeight:500,fontSize:14 }}>Previsualización — {ef.nombre}</span>
                <div style={{ display:'flex',gap:8 }}>
                  <button className="btn btn-sm" style={{ background:'rgba(200,168,75,0.15)',color:'#c8a84b',border:'0.5px solid rgba(200,168,75,0.4)' }}
                    onClick={() => imprimirPlanilla(ef)}>🖨 Imprimir</button>
                  <button className="btn btn-sm" onClick={() => setPreview(null)}>Cerrar</button>
                </div>
              </div>
              {/* Planilla preview */}
              <div style={{ padding:'20px',fontFamily:'Arial,sans-serif',fontSize:11,color:'#000' }}>
                <h2 style={{ fontSize:14,textAlign:'center',marginBottom:4 }}>POLICIA ADICIONAL — MINISTERIO DE SEGURIDAD</h2>
                <h3 style={{ fontSize:12,textAlign:'center',marginBottom:12 }}>PLANILLA DE CUMPLIMIENTO SERVICIO DE POLICÍA ADICIONAL</h3>
                
                <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:8 }}>
                  <div>
                    <div style={{ borderBottom:'1px solid #000',marginBottom:4,paddingBottom:2 }}>
                      <div style={{ fontSize:9,color:'#555' }}>Servicio POLAD</div>
                      <div style={{ fontWeight:'bold' }}>POLAD</div>
                    </div>
                    <div style={{ borderBottom:'1px solid #000',marginBottom:4,paddingBottom:2 }}>
                      <div style={{ fontSize:9,color:'#555' }}>Destino</div>
                      <div style={{ fontWeight:'bold' }}>Ministerio de Salud - Pcia de Bs As</div>
                    </div>
                  </div>
                  <div>
                    <div style={{ borderBottom:'1px solid #000',marginBottom:4,paddingBottom:2 }}>
                      <div style={{ fontSize:9,color:'#555' }}>Sucursal</div>
                      <div style={{ fontWeight:'bold' }}>{lugar}</div>
                    </div>
                    <div style={{ borderBottom:'1px solid #000',marginBottom:4,paddingBottom:2 }}>
                      <div style={{ fontSize:9,color:'#555' }}>Localidad</div>
                      <div style={{ fontWeight:'bold' }}>Mar del Plata</div>
                    </div>
                  </div>
                </div>

                <div style={{ display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:8,marginBottom:6 }}>
                  {[['Apellido y Nombre',ef.nombre],['Mes / Año',`${NOMBRE_MES_SOLO.toUpperCase()} ${ANIO}`],['Jerarquía',ef.jerarquia||''],['Categoría','1°']].map(([k,v])=>(
                    <div key={k} style={{ borderBottom:'1px solid #000',paddingBottom:2 }}>
                      <div style={{ fontSize:9,color:'#555' }}>{k}</div>
                      <div style={{ fontWeight:'bold',fontSize:11 }}>{v}</div>
                    </div>
                  ))}
                </div>
                <div style={{ display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:8,marginBottom:12 }}>
                  {[['Legajo',ef.legajo],['N° Documento',ef.dni||''],['',''],['','']].map(([k,v],i)=>(
                    <div key={i} style={{ borderBottom:'1px solid #000',paddingBottom:2 }}>
                      <div style={{ fontSize:9,color:'#555' }}>{k}</div>
                      <div style={{ fontWeight:'bold',fontSize:11 }}>{v}</div>
                    </div>
                  ))}
                </div>

                <table style={{ width:'100%',borderCollapse:'collapse',marginBottom:10 }}>
                  <thead>
                    <tr>
                      <th style={{ background:'#333',color:'#fff',padding:'4px',fontSize:10,border:'1px solid #000',textAlign:'center' }}>DÍA</th>
                      <th style={{ background:'#333',color:'#fff',padding:'4px',fontSize:10,border:'1px solid #000',textAlign:'center' }}>HORARIO</th>
                      <th style={{ background:'#333',color:'#fff',padding:'4px',fontSize:10,border:'1px solid #000',textAlign:'center' }}>HORAS</th>
                      <th style={{ background:'#333',color:'#fff',padding:'4px',fontSize:10,border:'1px solid #000',textAlign:'center' }}>DÍA</th>
                      <th style={{ background:'#333',color:'#fff',padding:'4px',fontSize:10,border:'1px solid #000',textAlign:'center' }}>HORARIO</th>
                      <th style={{ background:'#333',color:'#fff',padding:'4px',fontSize:10,border:'1px solid #000',textAlign:'center' }}>HORAS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Array.from({length:16},(_,i)=>{
                      const f1=filas[i]||{}; const f2=filas[i+16]||{}
                      return (
                        <tr key={`${i}-a`}>
                          <td style={{ border:'1px solid #000',padding:'3px 5px',textAlign:'center',fontWeight:'bold',background:'#f5f5f5',fontSize:10 }}>{f1.dia||''}</td>
                          <td style={{ border:'1px solid #000',padding:'3px 5px',textAlign:'center',background:f1.confirmado?'#e8f5e9':'',fontSize:10 }}>{f1.horario||''}</td>
                          <td style={{ border:'1px solid #000',padding:'3px 5px',textAlign:'center',background:f1.confirmado?'#e8f5e9':'',fontSize:10 }}>{f1.horas||''}</td>
                          <td style={{ border:'1px solid #000',padding:'3px 5px',textAlign:'center',fontWeight:'bold',background:'#f5f5f5',fontSize:10 }}>{f2.dia||''}</td>
                          <td style={{ border:'1px solid #000',padding:'3px 5px',textAlign:'center',background:f2.confirmado?'#e8f5e9':'',fontSize:10 }}>{f2.horario||''}</td>
                          <td style={{ border:'1px solid #000',padding:'3px 5px',textAlign:'center',background:f2.confirmado?'#e8f5e9':'',fontSize:10 }}>{f2.horas||''}</td>
                        </tr>
                        {f1.extra && <tr key={`${i}-b`}>
                          <td style={{ border:'1px solid #000',padding:'3px 5px',textAlign:'center',fontWeight:'bold',background:'#f5f5f5',fontSize:10 }}></td>
                          <td style={{ border:'1px solid #000',padding:'3px 5px',textAlign:'center',background:'#e8f5e9',fontSize:10 }}>{f1.extra.horario}</td>
                          <td style={{ border:'1px solid #000',padding:'3px 5px',textAlign:'center',background:'#e8f5e9',fontSize:10 }}>{f1.extra.horas}</td>
                          <td colSpan={3} style={{ border:'1px solid #000' }}></td>
                        </tr>}
                      )
                    })}
                    <tr>
                      <td colSpan={3} style={{ border:'1px solid #000',padding:'4px',textAlign:'right',fontWeight:'bold',fontSize:10 }}>TOTAL HORAS CUMPLIDAS EN EL MES</td>
                      <td colSpan={3} style={{ border:'1px solid #000',padding:'4px',textAlign:'center',fontWeight:'bold',fontSize:14 }}>{totalHoras}</td>
                    </tr>
                    <tr>
                      <td colSpan={3} style={{ border:'1px solid #000',padding:'4px',textAlign:'right',fontWeight:'bold',fontSize:10 }}>TOTAL 90%</td>
                      <td colSpan={3} style={{ border:'1px solid #000',padding:'4px',textAlign:'center',fontWeight:'bold',fontSize:14 }}>{total90}</td>
                    </tr>
                  </tbody>
                </table>

                <div style={{ fontSize:10,marginBottom:16,lineHeight:1.6 }}>
                  Declaro de conformidad, haber prestado <strong>{totalHoras}</strong> horas de servicio de Policía Adicional, en el destino que figura en la presente planilla.
                </div>

                <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:30 }}>
                  <div style={{ textAlign:'center' }}>
                    {firma
                      ? <img src={firma} style={{ width:'100%',maxWidth:400,maxHeight:180,marginBottom:6,objectFit:'contain' }} alt="firma" />
                      : <div style={{ height:60,display:'flex',alignItems:'center',justifyContent:'center',marginBottom:6 }}>
                          <button className="btn btn-sm" style={{ fontSize:11,color:'#c8a84b',border:'0.5px solid rgba(200,168,75,0.4)' }}
                            onClick={() => { setLegajoFirma(ef.legajo); firmaRef.current.click() }}>
                            + Subir firma
                          </button>
                        </div>
                    }
                    <div style={{ borderTop:'1px solid #000',paddingTop:4,fontSize:10 }}>FIRMA EFECTIVO — {ef.nombre}</div>
                  </div>
                  <div style={{ textAlign:'center' }}>
                    <div style={{ height:firma?80:60,marginBottom:6 }}></div>
                    <div style={{ borderTop:'1px solid #000',paddingTop:4,fontSize:10 }}>FIRMA ENCARGADO — Crio. Paulo Corbela</div>
                  </div>
                </div>

                {!firma && (
                  <div style={{ marginTop:12,padding:'8px 12px',background:'#FFF3E0',borderRadius:6,fontSize:11,color:'#E65100' }}>
                    ⚠ No hay firma cargada para este efectivo. Subí la firma antes de imprimir.
                  </div>
                )}
              </div>
            </div>
          </div>
        )
      })()}

      <div className="topbar">
        <div style={{ display:'flex',alignItems:'center',gap:10 }}>
          <span style={{ fontSize:15,fontWeight:500 }}>Control de Asistencia</span>
          <span style={{ background:'rgba(200,168,75,0.15)',color:'#c8a84b',fontSize:11,padding:'2px 8px',borderRadius:3,fontWeight:500 }}>{NOMBRE_MES}</span>
        </div>
        <div style={{ display:'flex',gap:6,alignItems:'center' }}>
          {LUGARES.map(lg => (
            <button key={lg} className="btn btn-sm"
              style={{ fontWeight:lugar===lg?600:400,background:lugar===lg?'rgba(200,168,75,0.15)':'transparent',color:lugar===lg?'#c8a84b':'#8b90a0',border:lugar===lg?'0.5px solid rgba(200,168,75,0.6)':'0.5px solid rgba(255,255,255,0.1)' }}
              onClick={() => { setLugar(lg); cargarDatos(lg) }}>{lg}</button>
          ))}
          <button className="btn btn-sm" onClick={() => router.push('/admin')} style={{ color:'#8b90a0' }}>← Admin</button>
        </div>
      </div>

      <div style={{ padding:16 }}>
        {msg && <div className="alert alert-ok" style={{ marginBottom:12 }}>{msg}</div>}

        {/* Selector de día */}
        <div style={{ display:'flex',alignItems:'center',gap:8,marginBottom:16,flexWrap:'wrap' }}>
          <span style={{ fontSize:12,color:'var(--text-muted)' }}>Día:</span>
          <div style={{ display:'flex',gap:3,flexWrap:'wrap' }}>
            {Array.from({ length: DIAS_MES }, (_, i) => i+1).map(d => (
              <button key={d} className="btn btn-sm"
                style={{ minWidth:30,padding:'4px 6px',fontSize:11,
                  background:d===diaActual?'rgba(200,168,75,0.15)':'transparent',
                  color:d===diaActual?'#c8a84b':'var(--text-muted)',
                  border:d===diaActual?'0.5px solid rgba(200,168,75,0.6)':'0.5px solid rgba(255,255,255,0.1)' }}
                onClick={() => setDiaActual(d)}>{d}</button>
            ))}
          </div>
        </div>

        <h3 style={{ fontSize:14,fontWeight:500,marginBottom:14,color:'var(--text)' }}>
          Día {diaActual} — {NOMBRE_MES} — Puestos a cubrir
        </h3>

        {/* Vista por sector/puesto */}
        <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:20 }}>
          {SECTORES.map(sector => {
            const tDia = turnosHoy.filter(t => t.turno==='d' && t.sector===sector)
            const tNoche = turnosHoy.filter(t => t.turno==='n' && t.sector===sector)
            if (!tDia.length && !tNoche.length) return null

            return (
              <div key={sector} style={{ background:'var(--surface)',border:'0.5px solid var(--border)',borderRadius:10,overflow:'hidden' }}>
                <div style={{ padding:'8px 12px',background:'var(--surface2)',borderBottom:'0.5px solid var(--border)',display:'flex',alignItems:'center',gap:6 }}>
                  <span className="dot" style={{ background:SEC_COLORS[sector] }}></span>
                  <span style={{ fontSize:12,fontWeight:500 }}>{sector}</span>
                </div>
                <div style={{ padding:10 }}>
                  {[['d','TURNO DÍA 08-20','#EF9F27',tDia],['n','TURNO NOCHE 20-08','#85B7EB',tNoche]].map(([turno,label,color,lista]) => (
                    lista.length > 0 && (
                      <div key={turno} style={{ marginBottom:turno==='d'&&tNoche.length>0?10:0,paddingBottom:turno==='d'&&tNoche.length>0?10:0,borderBottom:turno==='d'&&tNoche.length>0?'0.5px solid var(--border)':'' }}>
                        <div style={{ fontSize:10,color,fontWeight:500,marginBottom:6 }}>{label}</div>
                        {lista.map(t => {
                          const key = `${t.legajo}-${diaActual}-${turno}`
                          const presente = !!asistencia[key]
                          const ef = datosEf(t.legajo)
                          return (
                            <div key={t.legajo} style={{ display:'flex',alignItems:'center',justifyContent:'space-between',padding:'6px 8px',background:presente?'rgba(29,158,117,0.1)':'var(--surface2)',borderRadius:7,marginBottom:4,border:`0.5px solid ${presente?'rgba(29,158,117,0.4)':'var(--border)'}` }}>
                              <div>
                                <div style={{ fontSize:12,fontWeight:500,color:'var(--text)' }}>{nombreEf(t.legajo)}</div>
                                <div style={{ fontSize:10,color:'var(--text-muted)' }}>Leg. {t.legajo} {ef?.jerarquia ? '· '+ef.jerarquia : ''}</div>
                              </div>
                              <div style={{ display:'flex',gap:6,alignItems:'center' }}>
                                {presente && (
                                  <button className="btn btn-sm" style={{ fontSize:10,padding:'2px 8px',color:'#c8a84b',border:'0.5px solid rgba(200,168,75,0.3)' }}
                                    onClick={() => { setLegajoFirma(t.legajo); firmaRef.current.click() }}>
                                    {firmas[t.legajo] ? '✓ Firma' : '+ Firma'}
                                  </button>
                                )}
                                <button
                                  onClick={() => togglePresente(t.legajo, diaActual, turno, sector)}
                                  style={{ padding:'5px 12px',borderRadius:6,border:'none',cursor:'pointer',fontSize:12,fontWeight:500,background:presente?'#1D9E75':'rgba(255,255,255,0.08)',color:presente?'#fff':'#8b90a0',minWidth:90 }}>
                                  {presente ? '✓ Presente' : 'Marcar presente'}
                                </button>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )
                  ))}
                </div>
              </div>
            )
          })}
        </div>

        {turnosHoy.length === 0 && (
          <div className="alert alert-warn">No hay guardias asignadas para el día {diaActual}. Generá el cronograma desde el panel admin.</div>
        )}

        {/* Input de firma oculto */}
        <input ref={firmaRef} type="file" accept="image/*" style={{ display:'none' }}
          onChange={e => { if (e.target.files[0] && legajoFirma) subirFirma(legajoFirma, e.target.files[0]) }} />

        {/* Planillas individuales */}
        <div style={{ borderTop:'0.5px solid var(--border)',paddingTop:16,marginTop:4 }}>
          <h3 style={{ fontSize:13,fontWeight:500,marginBottom:12,color:'var(--text)' }}>Planillas individuales — imprimir</h3>
          <div style={{ display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(240px,1fr))',gap:8 }}>
            {efectivos.map(ef => {
              const turnosEf = turnos.filter(t => t.legajo === ef.legajo)
              if (!turnosEf.length) return null
              const confirmados = turnosEf.filter(t => asistencia[`${ef.legajo}-${t.dia}-${t.turno}`]).length
              const tieneFirma = !!firmas[ef.legajo]?.firma_url
              const pct = turnosEf.length ? Math.round(confirmados/turnosEf.length*100) : 0
              const color = pct>=100?'#1D9E75':pct>=50?'#EF9F27':'#8b90a0'
              return (
                <div key={ef.legajo} style={{ background:'var(--surface)',border:'0.5px solid var(--border)',borderRadius:8,padding:'10px 12px' }}>
                  <div style={{ fontSize:12,fontWeight:500,marginBottom:2 }}>{ef.nombre}</div>
                  <div style={{ fontSize:10,color:'var(--text-muted)',marginBottom:6 }}>Leg. {ef.legajo} · {confirmados*12} hs confirmadas</div>
                  <div className="hbar" style={{ width:'100%',marginBottom:8 }}>
                    <div className="hfill" style={{ width:`${pct}%`,background:color }}></div>
                  </div>
                  <div style={{ display:'flex',gap:6 }}>
                    <button className="btn btn-sm" style={{ flex:1,justifyContent:'center',fontSize:10,background:'rgba(200,168,75,0.1)',color:'#c8a84b',border:'0.5px solid rgba(200,168,75,0.3)' }}
                      onClick={() => { setLegajoFirma(ef.legajo); firmaRef.current.click() }}>
                      {tieneFirma ? '✓ Firma' : '+ Firma'}
                    </button>
                    <button className="btn btn-sm" style={{ flex:1,justifyContent:'center',fontSize:10,background:'rgba(55,138,221,0.15)',color:'#378ADD',border:'0.5px solid rgba(55,138,221,0.4)' }}
                      onClick={() => { setPreview(ef); setPreviewKey(k => k+1) }}>
                      👁 Previsualizar
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
