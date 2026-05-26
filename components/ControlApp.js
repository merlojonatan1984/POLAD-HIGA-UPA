import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../lib/supabase'

function _detectLugar() {
  if (typeof window === 'undefined') return 'HIGA'
  const h = window.location.hostname
  if (h === 'polad-modular.vercel.app' || h.includes('polad-modular')) return 'MODULAR'
  if (h === 'polad-higa-upa.vercel.app' || h.includes('polad-upa')) return 'UPA'
  return 'HIGA'
}
const APP_LUGAR = _detectLugar()

const SECTORES_POR_LUGAR = {
  'HIGA': ['Salud Mental','Giratoria','Llaves','Guardia','Estacionamiento'],
  'UPA': ['UPA'],
  'MODULAR': ['Modular']
}
const SECTORES_APP = SECTORES_POR_LUGAR[APP_LUGAR] || SECTORES_POR_LUGAR['HIGA']
const ES_MODULAR = APP_LUGAR === 'MODULAR'
const HORAS_TURNO = ES_MODULAR ? 8 : 12
const TURNOS_INFO = ES_MODULAR
  ? [
      { key: 'm', label: 'Mañana 08-16', color: '#EF9F27', horario: '08:00 a 16:00' },
      { key: 't', label: 'Tarde 16-24',  color: '#AFA9EC', horario: '16:00 a 24:00' },
      { key: 'n', label: 'Noche 00-08',  color: '#85B7EB', horario: '00:00 a 08:00' },
    ]
  : [
      { key: 'd', label: 'Turno Día 08-20',   color: '#EF9F27', horario: '08:00 a 20:00' },
      { key: 'n', label: 'Turno Noche 20-08', color: '#85B7EB', horario: '20:00 a 08:00' },
    ]

const SEC_COLORS = { 'Salud Mental':'#378ADD','Giratoria':'#1D9E75','Llaves':'#EF9F27','Guardia':'#D4537E','Estacionamiento':'#7F77DD','UPA':'#D85A30','Modular':'#20A0B0' }
const COLOR_APP = APP_LUGAR === 'HIGA' ? '#AFA9EC' : APP_LUGAR === 'UPA' ? '#D85A30' : '#20A0B0'
const MES_ACTUAL = new Date().getMonth() + 1
const ANIO_ACTUAL = new Date().getFullYear()
const MESES_NOMBRES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']

export default function ControlApp() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [mesSeleccionado, setMesSeleccionado] = useState(MES_ACTUAL)
  const [anioSeleccionado, setAnioSeleccionado] = useState(ANIO_ACTUAL)
  const [diaActual, setDiaActual] = useState(new Date().getDate())
  const [efectivos, setEfectivos] = useState([])
  const [turnos, setTurnos] = useState([])
  const [asistencia, setAsistencia] = useState({})
  const [firmas, setFirmas] = useState({})
  const [subiendoFirma, setSubiendoFirma] = useState(null)
  const [msg, setMsg] = useState(null)
  const firmaRef = useRef()
  const [legajoFirma, setLegajoFirma] = useState(null)

  const MES = mesSeleccionado
  const ANIO = anioSeleccionado
  const DIAS_MES = new Date(ANIO, MES, 0).getDate()
  const NOMBRE_MES = MESES_NOMBRES[MES-1] + ' ' + ANIO

  useEffect(() => {
    const u = localStorage.getItem('polad_user')
    if (!u) { router.push('/'); return }
    const parsed = JSON.parse(u)
    if (!parsed.es_admin) { router.push('/efectivo'); return }
    cargarDatos()
  }, [])

  useEffect(() => { cargarDatos() }, [mesSeleccionado, anioSeleccionado])

  async function cargarDatos() {
    setLoading(true)
    const [{ data: efs }, { data: turns }, { data: asist }, { data: firmasData }] = await Promise.all([
      supabase.from('efectivos').select('*').eq('es_admin', false).eq('lugar', APP_LUGAR).order('nombre'),
      supabase.from('turnos').select('*').eq('mes', MES).eq('anio', ANIO).in('sector', SECTORES_APP),
      supabase.from('asistencia').select('*').eq('mes', MES).eq('anio', ANIO).eq('lugar', APP_LUGAR),
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

  async function togglePresente(legajo, dia, turnoKey, sector) {
    const key = `${legajo}-${dia}-${turnoKey}`
    const existe = asistencia[key]
    const ti = TURNOS_INFO.find(x => x.key === turnoKey)
    const horario = ti?.horario || (turnoKey === 'd' ? '08:00 a 20:00' : '20:00 a 08:00')
    const horas = HORAS_TURNO

    if (existe) {
      await supabase.from('asistencia').delete().eq('id', existe.id)
      await supabase.from('planilla_manual').delete()
        .eq('legajo', legajo).eq('mes', MES).eq('anio', ANIO)
        .eq('dia', dia).eq('horario', horario).eq('lugar', APP_LUGAR)
      const nuevo = { ...asistencia }
      delete nuevo[key]
      setAsistencia(nuevo)
      await cargarDatos()
    } else {
      const { data } = await supabase.from('asistencia').insert([{
        legajo, mes: MES, anio: ANIO, dia, turno: turnoKey, sector, lugar: APP_LUGAR,
        presente: true, confirmado_at: new Date().toISOString()
      }]).select().single()
      if (data) {
        setAsistencia(prev => ({ ...prev, [key]: data }))
        const { data: existeManual } = await supabase.from('planilla_manual')
          .select('id').eq('legajo', legajo).eq('mes', MES).eq('anio', ANIO)
          .eq('dia', dia).eq('horario', horario).eq('lugar', APP_LUGAR).maybeSingle()
        if (!existeManual) {
          await supabase.from('planilla_manual').insert([{
            legajo, mes: MES, anio: ANIO, dia, horario, horas, sector: sector || '', lugar: APP_LUGAR
          }])
        }
        await cargarDatos()
      }
    }
  }

  async function subirFirma(legajo, file) {
    setSubiendoFirma(legajo)
    const reader = new FileReader()
    reader.onload = async (e) => {
      const base64 = e.target.result
      const existeFirma = firmas[legajo]
      if (existeFirma) await supabase.from('firmas').update({ firma_url: base64 }).eq('id', existeFirma.id)
      else await supabase.from('firmas').insert([{ legajo, mes: MES, anio: ANIO, firma_url: base64 }])
      setFirmas(prev => ({ ...prev, [legajo]: { ...prev[legajo], firma_url: base64 } }))
      setSubiendoFirma(null)
      setMsg('Firma guardada.')
      setTimeout(() => setMsg(null), 2500)
    }
    reader.readAsDataURL(file)
  }

  if (loading) return <div className="loading">Cargando...</div>

  const nombreEf = leg => { const e = efectivos.find(x => x.legajo === leg); return e ? e.nombre : leg }
  const datosEf = leg => efectivos.find(x => x.legajo === leg)
  const turnosHoy = turnos.filter(t => t.dia === diaActual)

  return (
    <div>
      <div className="topbar">
        <div style={{ display:'flex',alignItems:'center',gap:10 }}>
          <span style={{ fontSize:15,fontWeight:500 }}>Control de Asistencia</span>
          <span style={{ background:`${COLOR_APP}22`,color:COLOR_APP,fontSize:11,padding:'2px 8px',borderRadius:3,fontWeight:600,border:`0.5px solid ${COLOR_APP}66` }}>{APP_LUGAR}</span>
        </div>
        <div style={{ display:'flex',gap:6,alignItems:'center',flexWrap:'wrap' }}>
          <div style={{ display:'flex',alignItems:'center',gap:4,background:'rgba(255,255,255,0.05)',borderRadius:6,padding:'2px 6px',border:'0.5px solid rgba(255,255,255,0.1)' }}>
            <select value={mesSeleccionado} onChange={e => { setMesSeleccionado(parseInt(e.target.value)); setDiaActual(1) }} style={{ background:'transparent',border:'none',color:'#c8a84b',fontSize:12,fontWeight:500,outline:'none',cursor:'pointer' }}>
              {MESES_NOMBRES.map((m,i) => <option key={i+1} value={i+1} style={{ background:'#1a1d27' }}>{m}</option>)}
            </select>
            <select value={anioSeleccionado} onChange={e => { setAnioSeleccionado(parseInt(e.target.value)); setDiaActual(1) }} style={{ background:'transparent',border:'none',color:'#c8a84b',fontSize:12,fontWeight:500,outline:'none',cursor:'pointer' }}>
              {[ANIO_ACTUAL, ANIO_ACTUAL+1].map(a => <option key={a} value={a} style={{ background:'#1a1d27' }}>{a}</option>)}
            </select>
          </div>
          <button className="btn btn-sm" onClick={() => router.push('/admin')} style={{ color:'#8b90a0' }}>← Admin</button>
        </div>
      </div>

      <div style={{ padding:16 }}>
        {msg && <div className="alert alert-ok" style={{ marginBottom:12 }}>{msg}</div>}

        <div style={{ display:'flex',alignItems:'center',gap:8,marginBottom:16,flexWrap:'wrap' }}>
          <span style={{ fontSize:12,color:'var(--text-muted)' }}>Día:</span>
          <div style={{ display:'flex',gap:3,flexWrap:'wrap' }}>
            {Array.from({ length: DIAS_MES }, (_, i) => i+1).map(d => (
              <button key={d} className="btn btn-sm" style={{ minWidth:30,padding:'4px 6px',fontSize:11,background:d===diaActual?'rgba(200,168,75,0.15)':'transparent',color:d===diaActual?'#c8a84b':'var(--text-muted)',border:d===diaActual?'0.5px solid rgba(200,168,75,0.6)':'0.5px solid rgba(255,255,255,0.1)' }} onClick={() => setDiaActual(d)}>{d}</button>
            ))}
          </div>
        </div>

        <h3 style={{ fontSize:14,fontWeight:500,marginBottom:14 }}>
          Día {diaActual} — {NOMBRE_MES} — {APP_LUGAR}
        </h3>

        <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:20 }}>
          {SECTORES_APP.map(sector => {
            const turnosSector = TURNOS_INFO.map(ti => ({
              ...ti,
              lista: turnosHoy.filter(t => t.turno === ti.key && t.sector === sector)
            })).filter(ti => ti.lista.length > 0)

            if (turnosSector.length === 0) return null

            return (
              <div key={sector} style={{ background:'var(--surface)',border:'0.5px solid var(--border)',borderRadius:10,overflow:'hidden' }}>
                <div style={{ padding:'8px 12px',background:'var(--surface2)',borderBottom:'0.5px solid var(--border)',display:'flex',alignItems:'center',gap:6 }}>
                  <span className="dot" style={{ background:SEC_COLORS[sector] }}></span>
                  <span style={{ fontSize:12,fontWeight:500 }}>{sector}</span>
                </div>
                <div style={{ padding:10 }}>
                  {turnosSector.map((ti, idx) => (
                    <div key={ti.key} style={{ marginBottom:idx<turnosSector.length-1?10:0,paddingBottom:idx<turnosSector.length-1?10:0,borderBottom:idx<turnosSector.length-1?'0.5px solid var(--border)':'none' }}>
                      <div style={{ fontSize:10,color:ti.color,fontWeight:500,marginBottom:6 }}>{ti.label.toUpperCase()} — {ti.horario}</div>
                      {ti.lista.map(t => {
                        const key = `${t.legajo}-${diaActual}-${ti.key}`
                        const presente = !!asistencia[key]
                        const ef = datosEf(t.legajo)
                        return (
                          <div key={t.legajo} style={{ display:'flex',alignItems:'center',justifyContent:'space-between',padding:'6px 8px',background:presente?'rgba(29,158,117,0.1)':'var(--surface2)',borderRadius:7,marginBottom:4,border:`0.5px solid ${presente?'rgba(29,158,117,0.4)':'var(--border)'}` }}>
                            <div>
                              <div style={{ fontSize:12,fontWeight:500 }}>{nombreEf(t.legajo)}</div>
                              <div style={{ fontSize:10,color:'var(--text-muted)' }}>Leg. {t.legajo}{ef?.jerarquia ? ' · '+ef.jerarquia : ''}</div>
                            </div>
                            <div style={{ display:'flex',gap:6,alignItems:'center' }}>
                              {presente && (
                                <button className="btn btn-sm" style={{ fontSize:10,padding:'2px 8px',color:'#c8a84b',border:'0.5px solid rgba(200,168,75,0.3)' }}
                                  onClick={ev => { ev.stopPropagation(); setLegajoFirma(t.legajo); firmaRef.current.click() }}>
                                  {firmas[t.legajo] ? '✓ Firma' : '+ Firma'}
                                </button>
                              )}
                              <button onClick={() => togglePresente(t.legajo, diaActual, ti.key, sector)}
                                style={{ padding:'5px 12px',borderRadius:6,border:'none',cursor:'pointer',fontSize:12,fontWeight:500,background:presente?'#1D9E75':'rgba(255,255,255,0.08)',color:presente?'#fff':'#8b90a0',minWidth:90 }}>
                                {presente ? '✓ Presente' : 'Marcar presente'}
                              </button>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>

        {turnosHoy.length === 0 && (
          <div className="alert alert-warn">No hay guardias asignadas para el día {diaActual} en {APP_LUGAR}.</div>
        )}

        <input ref={firmaRef} type="file" accept="image/*" style={{ display:'none' }}
          onChange={e => { if (e.target.files[0] && legajoFirma) subirFirma(legajoFirma, e.target.files[0]) }} />
      </div>
    </div>
  )
}
