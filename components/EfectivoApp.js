import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../lib/supabase'

const APP_LUGAR = process.env.NEXT_PUBLIC_LUGAR ||
  (typeof window !== 'undefined' && window.location.hostname.includes('modular') ? 'MODULAR' :
   typeof window !== 'undefined' && window.location.hostname.includes('upa') ? 'UPA' : 'HIGA')
const SECTORES_POR_LUGAR = {
  'HIGA': ['Salud Mental','Giratoria','Llaves','Guardia','Estacionamiento'],
  'UPA': ['UPA'],
  'MODULAR': ['Modular']
}
const SECTORES_APP = SECTORES_POR_LUGAR[APP_LUGAR] || SECTORES_POR_LUGAR['HIGA']
const COLOR_APP = APP_LUGAR === 'HIGA' ? '#AFA9EC' : APP_LUGAR === 'UPA' ? '#D85A30' : '#20A0B0'
const ES_MODULAR = APP_LUGAR === 'MODULAR'

const TURNOS_CONFIG = ES_MODULAR
  ? [
      { key: 'm', label: 'M', nombre: 'Mañana', horario: '08:00 a 16:00', colorActivo: '#EF9F27', bgActivo: '#EF9F27', textActivo: '#1a0d00', borderActivo: '#EF9F27', borderCelda: '#BA7517', bgCelda: 'rgba(239,159,39,0.08)' },
      { key: 't', label: 'T', nombre: 'Tarde',  horario: '16:00 a 23:59', colorActivo: '#AFA9EC', bgActivo: '#7F77DD', textActivo: '#ffffff', borderActivo: '#7F77DD', borderCelda: '#7F77DD', bgCelda: 'rgba(127,119,221,0.08)' },
      { key: 'n', label: 'N', nombre: 'Noche',  horario: '23:59 a 08:00', colorActivo: '#85B7EB', bgActivo: '#378ADD', textActivo: '#ffffff', borderActivo: '#378ADD', borderCelda: '#378ADD', bgCelda: 'rgba(55,138,221,0.08)' },
    ]
  : [
      { key: 'd', label: 'D', nombre: 'Día',   horario: '08:00 a 20:00', colorActivo: '#EF9F27', bgActivo: '#EF9F27', textActivo: '#1a0d00', borderActivo: '#EF9F27', borderCelda: '#BA7517', bgCelda: 'rgba(239,159,39,0.08)' },
      { key: 'n', label: 'N', nombre: 'Noche', horario: '20:00 a 08:00', colorActivo: '#85B7EB', bgActivo: '#378ADD', textActivo: '#ffffff', borderActivo: '#378ADD', borderCelda: '#378ADD', bgCelda: 'rgba(55,138,221,0.08)' },
    ]

function turnoLabel(t) {
  const tc = TURNOS_CONFIG.find(x => x.key === t)
  return tc ? tc.horario : t
}

function getCeldaStyle(v) {
  if (!v) return { border: '1.5px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.03)' }
  const keys = v.split('').filter(Boolean)
  if (keys.length >= TURNOS_CONFIG.length) return { border: '1.5px solid #1D9E75', background: 'rgba(29,158,117,0.08)' }
  const tc = TURNOS_CONFIG.find(x => x.key === keys[0])
  if (!tc) return { border: '1.5px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.03)' }
  return { border: `1.5px solid ${tc.borderCelda}`, background: tc.bgCelda }
}

const MES_ACTUAL = new Date().getMonth() + 1
const ANIO_ACTUAL = new Date().getFullYear()
const MESES_NOMBRES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
const DIAS_SEMANA = ['Lu','Ma','Mi','Ju','Vi','Sá','Do']
const HORAS_POR_TURNO = ES_MODULAR ? 8 : 12

export default function EfectivoApp() {
  const router = useRouter()
  const [usuario, setUsuario] = useState(null)
  const [mes, setMes] = useState(MES_ACTUAL)
  const [anio, setAnio] = useState(ANIO_ACTUAL)
  const [disponibilidad, setDisponibilidad] = useState({})
  const [guardando, setGuardando] = useState(false)
  const [msg, setMsg] = useState(null)
  const [ventana, setVentana] = useState(null)
  const [turnos, setTurnos] = useState([])
  const [loading, setLoading] = useState(true)
  const diasMes = new Date(anio, mes, 0).getDate()
  const nombreMes = MESES_NOMBRES[mes - 1] + ' ' + anio
  const primerDia = (new Date(anio, mes - 1, 1).getDay() + 6) % 7

  useEffect(() => {
    const u = localStorage.getItem('polad_user')
    if (!u) { router.push('/'); return }
    const parsed = JSON.parse(u)
    if (parsed.es_admin) { router.push('/admin'); return }
    setUsuario(parsed)
    cargarDatos(parsed.legajo, mes, anio)
  }, [])

  async function cargarDatos(legajo, m, a) {
    setLoading(true)
    const ventanasStr = localStorage.getItem(`polad_ventanas_${APP_LUGAR}`)
    if (ventanasStr) { try { setVentana(JSON.parse(ventanasStr)) } catch(e) {} }
    const [{ data: disp }, { data: turns }] = await Promise.all([
      supabase.from('disponibilidad').select('dia, turno').eq('legajo', legajo).eq('mes', m).eq('anio', a).eq('lugar', APP_LUGAR),
      supabase.from('turnos').select('dia, turno, sector').eq('legajo', legajo).eq('mes', m).eq('anio', a).in('sector', SECTORES_APP)
    ])
    const dispMap = {}
    ;(disp || []).forEach(d => { dispMap[d.dia] = d.turno })
    setDisponibilidad(dispMap)
    setTurnos(turns || [])
    setLoading(false)
  }

  function toggleDia(dia, key) {
    if (ES_MODULAR) {
      setDisponibilidad(prev => {
        const actual = prev[dia] || ''
        const keys = actual.split('').filter(Boolean)
        const idx = keys.indexOf(key)
        const nuevasKeys = idx >= 0
          ? keys.filter(k => k !== key)
          : [...keys, key].sort((a, b) => 'mtn'.indexOf(a) - 'mtn'.indexOf(b))
        const nuevo = nuevasKeys.join('')
        if (!nuevo) { const next = { ...prev }; delete next[dia]; return next }
        return { ...prev, [dia]: nuevo }
      })
    } else {
      setDisponibilidad(prev => {
        const actual = prev[dia] || ''
        let nuevo
        if (key === 'd') {
          if (actual === 'd') nuevo = ''
          else if (actual === 'n') nuevo = 'dn'
          else if (actual === 'dn') nuevo = 'n'
          else nuevo = 'd'
        } else {
          if (actual === 'n') nuevo = ''
          else if (actual === 'd') nuevo = 'dn'
          else if (actual === 'dn') nuevo = 'd'
          else nuevo = 'n'
        }
        if (nuevo === '') { const next = { ...prev }; delete next[dia]; return next }
        return { ...prev, [dia]: nuevo }
      })
    }
  }

  async function guardar() {
    if (!usuario) return
    if (Object.keys(disponibilidad).length === 0) {
      if (!confirm('No seleccionaste ningún día. ¿Confirmar disponibilidad vacía?')) return
    }
    setGuardando(true)
    await supabase.from('disponibilidad').delete().eq('legajo', usuario.legajo).eq('mes', mes).eq('anio', anio).eq('lugar', APP_LUGAR)
    const inserts = Object.entries(disponibilidad).map(([dia, turno]) => ({
      legajo: usuario.legajo, mes, anio, dia: parseInt(dia), turno, lugar: APP_LUGAR
    }))
    if (inserts.length > 0) await supabase.from('disponibilidad').insert(inserts)
    setMsg('✓ Disponibilidad guardada para ' + APP_LUGAR)
    setTimeout(() => setMsg(null), 3000)
    setGuardando(false)
  }

  function esVentanaAbierta() {
    if (!ventana || !ventana.dia) return true
    const ahora = new Date()
    const diaV = parseInt(ventana.dia)
    const [hIni, mIni] = (ventana.horaInicio || '00:00').split(':').map(Number)
    const [hFin, mFin] = (ventana.horaFin || '23:59').split(':').map(Number)
    const inicio = new Date(ahora.getFullYear(), ahora.getMonth(), diaV, hIni, mIni)
    const fin = new Date(ahora.getFullYear(), ahora.getMonth(), diaV, hFin, mFin)
    return ahora >= inicio && ahora <= fin
  }

  const abierta = esVentanaAbierta()
  const totalSeleccionados = Object.keys(disponibilidad).length
  const totalHoras = turnos.length * HORAS_POR_TURNO

  if (loading) return <div className="loading">Cargando...</div>

  return (
    <div>
      {/* TOPBAR */}
      <div className="topbar">
        <div style={{ display:'flex',alignItems:'center',gap:10 }}>
          <span style={{ fontSize:14,fontWeight:500 }}>{usuario?.nombre?.split(',')[0]}</span>
          <span style={{ fontSize:11,color:'var(--text-muted)' }}>Leg. {usuario?.legajo}</span>
          <span style={{ background:`${COLOR_APP}22`,color:COLOR_APP,fontSize:11,padding:'2px 8px',borderRadius:3,fontWeight:600,border:`0.5px solid ${COLOR_APP}66` }}>{APP_LUGAR}</span>
        </div>
        <div style={{ display:'flex',gap:6,alignItems:'center' }}>
          <div style={{ display:'flex',alignItems:'center',gap:4,background:'rgba(255,255,255,0.05)',borderRadius:6,padding:'2px 6px',border:'0.5px solid rgba(255,255,255,0.1)' }}>
            <select value={mes} onChange={e => { const m=parseInt(e.target.value); setMes(m); cargarDatos(usuario.legajo,m,anio) }} style={{ background:'transparent',border:'none',color:'#c8a84b',fontSize:12,fontWeight:500,outline:'none',cursor:'pointer' }}>
              {MESES_NOMBRES.map((m,i) => <option key={i+1} value={i+1} style={{ background:'#1a1d27' }}>{m}</option>)}
            </select>
            <select value={anio} onChange={e => { const a=parseInt(e.target.value); setAnio(a); cargarDatos(usuario.legajo,mes,a) }} style={{ background:'transparent',border:'none',color:'#c8a84b',fontSize:12,fontWeight:500,outline:'none',cursor:'pointer' }}>
              {[ANIO_ACTUAL, ANIO_ACTUAL+1].map(a => <option key={a} value={a} style={{ background:'#1a1d27' }}>{a}</option>)}
            </select>
          </div>
          <button className="btn btn-sm" style={{ color:'#8b90a0' }} onClick={() => { localStorage.removeItem('polad_user'); router.push('/') }}>Salir</button>
        </div>
      </div>

      <div className="content">
        {msg && <div className="alert alert-ok" style={{ marginBottom:14 }}>{msg}</div>}

        {!abierta && ventana?.dia && (
          <div className="alert alert-warn" style={{ marginBottom:14 }}>
            La inscripción para {APP_LUGAR} está habilitada el día {ventana.dia} de {MESES_NOMBRES[mes-1]} de {ventana.horaInicio} a {ventana.horaFin}.
          </div>
        )}

        <div style={{ marginBottom:16 }}>
          {/* TÍTULO Y LEYENDA */}
          <div style={{ display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:16,flexWrap:'wrap',gap:12 }}>
            <div>
              <div style={{ fontSize:18,fontWeight:500,color:'#ffffff',marginBottom:4 }}>
                Disponibilidad — {APP_LUGAR} · {nombreMes}
              </div>
              <div style={{ fontSize:13,color:'var(--text-muted)' }}>
                Tocá los turnos en los que podés hacer guardia
              </div>
            </div>
            {/* LEYENDA */}
            <div style={{ display:'flex',gap:10,flexWrap:'wrap' }}>
              {TURNOS_CONFIG.map(tc => (
                <div key={tc.key} style={{ display:'flex',alignItems:'center',gap:8,padding:'8px 14px',borderRadius:10,border:`1.5px solid ${tc.borderActivo}66`,background:`${tc.bgActivo}11` }}>
                  <div style={{ width:32,height:32,borderRadius:7,background:tc.bgActivo,border:`2px solid ${tc.borderActivo}`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:15,fontWeight:700,color:tc.textActivo }}>{tc.label}</div>
                  <div>
                    <div style={{ fontSize:13,fontWeight:500,color:tc.colorActivo }}>{tc.nombre}</div>
                    <div style={{ fontSize:11,color:'var(--text-muted)' }}>{tc.horario}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* CABECERA DÍAS */}
          <div style={{ display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:4,marginBottom:4 }}>
            {DIAS_SEMANA.map(d => (
              <div key={d} style={{ textAlign:'center',fontSize:13,fontWeight:500,color:'var(--text-muted)',padding:'8px 0',background:'rgba(255,255,255,0.04)',borderRadius:6 }}>{d}</div>
            ))}
          </div>

          {/* CALENDARIO */}
          <div style={{ display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:5 }}>
            {Array.from({ length: primerDia }).map((_,i) => <div key={`e-${i}`}></div>)}
            {Array.from({ length: diasMes }, (_, i) => i + 1).map(dia => {
              const v = disponibilidad[dia] || ''
              const turnosDia = turnos.filter(t => t.dia === dia)
              const celdaStyle = getCeldaStyle(v)

              return (
                <div key={dia} style={{ borderRadius:10,border:celdaStyle.border,background:celdaStyle.background,overflow:'hidden',opacity:abierta?1:0.5 }}>
                  {/* Número del día */}
                  <div style={{ padding:'8px 10px 4px',display:'flex',justifyContent:'space-between',alignItems:'center' }}>
                    <span style={{ fontSize:18,fontWeight:700,color:'#ffffff',lineHeight:1 }}>{dia}</span>
                    {turnosDia.length > 0 && <span style={{ fontSize:10,color:'#1D9E75',fontWeight:700 }}>✓</span>}
                  </div>

                  {/* Botones de turno */}
                  <div style={{ padding:'0 5px 7px',display:'flex',gap:3 }}>
                    {TURNOS_CONFIG.map(tc => {
                      const activo = v.includes(tc.key)
                      return (
                        <button
                          key={tc.key}
                          disabled={!abierta}
                          onClick={() => abierta && toggleDia(dia, tc.key)}
                          title={`${tc.nombre} ${tc.horario}`}
                          style={{
                            flex:1,
                            padding:'9px 0',
                            borderRadius:7,
                            border: activo ? `1.5px solid ${tc.borderActivo}` : '1.5px solid rgba(255,255,255,0.1)',
                            cursor: abierta ? 'pointer' : 'default',
                            fontSize:14,
                            fontWeight:700,
                            background: activo ? tc.bgActivo : 'rgba(255,255,255,0.05)',
                            color: activo ? tc.textActivo : 'rgba(255,255,255,0.2)',
                            transition:'all 0.15s',
                            lineHeight:1
                          }}>
                          {tc.label}
                        </button>
                      )
                    })}
                  </div>

                  {/* Guardia asignada */}
                  {turnosDia.length > 0 && (
                    <div style={{ padding:'0 5px 5px',display:'flex',gap:2,flexWrap:'wrap' }}>
                      {turnosDia.map(t => {
                        const tc = TURNOS_CONFIG.find(x => x.key === t.turno)
                        return (
                          <span key={t.turno} style={{ fontSize:9,padding:'2px 5px',borderRadius:4,background:tc?`${tc.bgActivo}33`:'rgba(29,158,117,0.2)',color:tc?tc.colorActivo:'#1D9E75',fontWeight:700 }}>
                            ✓ {tc?.label || t.turno}
                          </span>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* FOOTER */}
        <div style={{ display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:24,padding:'14px 18px',background:'rgba(255,255,255,0.03)',borderRadius:10,border:'0.5px solid rgba(255,255,255,0.08)' }}>
          <div style={{ fontSize:14,color:'var(--text-muted)' }}>
            <span style={{ color:'#ffffff',fontWeight:700,fontSize:20 }}>{totalSeleccionados}</span>
            <span style={{ marginLeft:6 }}>días seleccionados</span>
          </div>
          <button className="btn btn-success" disabled={guardando || !abierta} onClick={guardar} style={{ padding:'11px 26px',fontSize:14,fontWeight:500 }}>
            {guardando ? 'Guardando...' : `Guardar disponibilidad — ${APP_LUGAR}`}
          </button>
        </div>

        {/* GUARDIAS ASIGNADAS */}
        {turnos.length > 0 && (
          <div className="panel">
            <div className="panel-header" style={{ background:`${COLOR_APP}18`,borderBottom:`0.5px solid ${COLOR_APP}33` }}>
              <h3 style={{ color:COLOR_APP }}>Mis guardias asignadas — {APP_LUGAR} · {nombreMes}</h3>
              <span style={{ fontSize:11,color:'#1D9E75',fontWeight:500 }}>Total: {totalHoras} hs</span>
            </div>
            <div style={{ padding:12 }}>
              <div style={{ display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(190px,1fr))',gap:8 }}>
                {turnos.sort((a,b) => a.dia - b.dia || 'mtdn'.indexOf(a.turno) - 'mtdn'.indexOf(b.turno)).map(t => {
                  const tc = TURNOS_CONFIG.find(x => x.key === t.turno)
                  return (
                    <div key={`${t.dia}-${t.turno}`} style={{ display:'flex',alignItems:'center',gap:10,padding:'10px 12px',background:'var(--surface2)',borderRadius:8,border:`0.5px solid ${tc?.borderActivo || 'var(--border)'}44` }}>
                      <div style={{ width:38,height:38,borderRadius:7,background:tc?.bgActivo||'#0d2040',border:`2px solid ${tc?.borderActivo||'#378ADD'}`,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',flexShrink:0 }}>
                        <span style={{ fontSize:15,fontWeight:700,color:tc?.textActivo||'#fff',lineHeight:1 }}>{t.dia}</span>
                        <span style={{ fontSize:9,color:tc?.textActivo||'#fff',opacity:0.8,fontWeight:600 }}>{tc?.label||t.turno}</span>
                      </div>
                      <div>
                        <div style={{ fontSize:12,fontWeight:500,color:'var(--text)' }}>{turnoLabel(t.turno)}</div>
                        <div style={{ fontSize:10,color:'var(--text-muted)',marginTop:2 }}>{t.sector} · {HORAS_POR_TURNO} hs</div>
                      </div>
                    </div>
                  )
                })}
              </div>
              <div style={{ marginTop:12,paddingTop:10,borderTop:'0.5px solid var(--border)',fontSize:13,color:COLOR_APP,fontWeight:500,textAlign:'right' }}>
                Total: {totalHoras} hs en {APP_LUGAR}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
