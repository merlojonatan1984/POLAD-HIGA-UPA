import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../lib/supabase'

const APP_LUGAR = process.env.NEXT_PUBLIC_LUGAR || 'HIGA'
const SECTORES_POR_LUGAR = {
  'HIGA': ['Salud Mental','Giratoria','Llaves','Guardia','Estacionamiento'],
  'UPA': ['UPA'],
  'MODULAR': ['Modular']
}
const SECTORES_APP = SECTORES_POR_LUGAR[APP_LUGAR] || SECTORES_POR_LUGAR['HIGA']
const COLOR_APP = APP_LUGAR === 'HIGA' ? '#AFA9EC' : APP_LUGAR === 'UPA' ? '#D85A30' : '#20A0B0'

const ES_MODULAR = APP_LUGAR === 'MODULAR'

// Config de turnos según lugar
const TURNOS_CONFIG = ES_MODULAR
  ? [
      { key: 'm', label: 'M', nombre: 'Mañana', horario: '08-16', color: '#EF9F27', bg: '#3a2a0a', activeBorder: '#BA7517' },
      { key: 't', label: 'T', nombre: 'Tarde',  horario: '16-00', color: '#AFA9EC', bg: '#2a1a4a', activeBorder: '#7F77DD' },
      { key: 'n', label: 'N', nombre: 'Noche',  horario: '00-08', color: '#85B7EB', bg: '#0d2040', activeBorder: '#378ADD' },
    ]
  : [
      { key: 'd', label: 'D', nombre: 'Día',   horario: '08-20', color: '#EF9F27', bg: '#3a2a0a', activeBorder: '#BA7517' },
      { key: 'n', label: 'N', nombre: 'Noche', horario: '20-08', color: '#85B7EB', bg: '#0d2040', activeBorder: '#378ADD' },
    ]

function turnoLabel(t) {
  if (ES_MODULAR) {
    if (t === 'm') return '08:00 a 16:00'
    if (t === 't') return '16:00 a 23:59'
    if (t === 'n') return '23:59 a 08:00'
  }
  return t === 'd' ? '08:00 a 20:00' : '20:00 a 08:00'
}

function turnoColor(t) {
  const tc = TURNOS_CONFIG.find(x => x.key === t)
  return tc ? { bg: tc.bg, color: tc.color } : { bg: '#0d2040', color: '#85B7EB' }
}

const MES_ACTUAL = new Date().getMonth() + 1
const ANIO_ACTUAL = new Date().getFullYear()
const MESES_NOMBRES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
const DIAS_SEMANA = ['Lu','Ma','Mi','Ju','Vi','Sá','Do']

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
  const horasPorTurno = ES_MODULAR ? 8 : 12
  const totalHoras = turnos.length * horasPorTurno

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

        {/* TÍTULO Y LEYENDA */}
        <div style={{ marginBottom:16 }}>
          <div style={{ display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:12,flexWrap:'wrap',gap:8 }}>
            <div>
              <div style={{ fontSize:15,fontWeight:600,color:'var(--text)',marginBottom:4 }}>
                Disponibilidad — {APP_LUGAR} · {nombreMes}
              </div>
              <div style={{ fontSize:12,color:'var(--text-muted)' }}>
                Seleccioná los turnos en los que podés hacer guardia
              </div>
            </div>
            {/* LEYENDA */}
            <div style={{ display:'flex',gap:8,flexWrap:'wrap' }}>
              {TURNOS_CONFIG.map(tc => (
                <div key={tc.key} style={{ display:'flex',alignItems:'center',gap:5,padding:'5px 10px',borderRadius:6,background:`${tc.color}15`,border:`0.5px solid ${tc.color}44` }}>
                  <span style={{ width:22,height:22,borderRadius:5,background:tc.bg,border:`1.5px solid ${tc.color}`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:700,color:tc.color }}>{tc.label}</span>
                  <div>
                    <div style={{ fontSize:11,fontWeight:500,color:tc.color }}>{tc.nombre}</div>
                    <div style={{ fontSize:10,color:'var(--text-muted)' }}>{tc.horario}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* CABECERA DÍAS SEMANA */}
          <div style={{ display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:4,marginBottom:4 }}>
            {DIAS_SEMANA.map(d => (
              <div key={d} style={{ textAlign:'center',fontSize:11,fontWeight:500,color:'var(--text-muted)',padding:'6px 0',background:'rgba(255,255,255,0.03)',borderRadius:4 }}>{d}</div>
            ))}
          </div>

          {/* GRID CALENDARIO */}
          <div style={{ display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:4 }}>
            {Array.from({ length: primerDia }).map((_,i) => <div key={`e-${i}`}></div>)}
            {Array.from({ length: diasMes }, (_, i) => i + 1).map(dia => {
              const v = disponibilidad[dia] || ''
              const turnosDia = turnos.filter(t => t.dia === dia)
              const tieneAlgo = v.length > 0
              const todoSeleccionado = TURNOS_CONFIG.every(tc => v.includes(tc.key))

              return (
                <div key={dia} style={{
                  borderRadius:8,
                  border: tieneAlgo ? `1.5px solid ${todoSeleccionado ? '#1D9E75' : TURNOS_CONFIG.find(tc => v.includes(tc.key))?.activeBorder || 'var(--border)'}` : '1px solid rgba(255,255,255,0.08)',
                  background: tieneAlgo ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.02)',
                  overflow:'hidden',
                  opacity: abierta ? 1 : 0.5,
                  transition:'border-color 0.15s'
                }}>
                  {/* Número del día */}
                  <div style={{
                    padding:'6px 8px 4px',
                    display:'flex',
                    justifyContent:'space-between',
                    alignItems:'center'
                  }}>
                    <span style={{
                      fontSize:13,
                      fontWeight:600,
                      color: tieneAlgo ? 'var(--text)' : 'var(--text-muted)',
                      lineHeight:1
                    }}>{dia}</span>
                    {turnosDia.length > 0 && (
                      <span style={{ fontSize:9,color:'#1D9E75',fontWeight:600 }}>✓</span>
                    )}
                  </div>

                  {/* Botones de turno */}
                  <div style={{ padding:'0 4px 6px',display:'flex',gap:3 }}>
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
                            padding:'5px 0',
                            borderRadius:5,
                            border: activo ? `1.5px solid ${tc.activeBorder}` : '1px solid rgba(255,255,255,0.1)',
                            cursor: abierta ? 'pointer' : 'default',
                            fontSize:10,
                            fontWeight:700,
                            background: activo ? tc.bg : 'rgba(255,255,255,0.04)',
                            color: activo ? tc.color : 'rgba(255,255,255,0.2)',
                            transition:'all 0.15s',
                            lineHeight:1
                          }}>
                          {tc.label}
                        </button>
                      )
                    })}
                  </div>

                  {/* Indicador de guardia asignada */}
                  {turnosDia.length > 0 && (
                    <div style={{ padding:'0 4px 4px',display:'flex',gap:2,flexWrap:'wrap' }}>
                      {turnosDia.map(t => {
                        const tc = TURNOS_CONFIG.find(x => x.key === t.turno)
                        return (
                          <span key={t.turno} style={{
                            fontSize:8,
                            padding:'1px 4px',
                            borderRadius:3,
                            background: tc ? `${tc.color}22` : 'rgba(29,158,117,0.2)',
                            color: tc ? tc.color : '#1D9E75',
                            fontWeight:600
                          }}>✓ {tc?.label || t.turno}</span>
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
        <div style={{ display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:24,padding:'12px 16px',background:'rgba(255,255,255,0.02)',borderRadius:8,border:'0.5px solid rgba(255,255,255,0.06)' }}>
          <div style={{ fontSize:13,color:'var(--text-muted)' }}>
            <span style={{ color:'var(--text)',fontWeight:500 }}>{totalSeleccionados}</span> días seleccionados
          </div>
          <button
            className="btn btn-success"
            disabled={guardando || !abierta}
            onClick={guardar}
            style={{ padding:'10px 24px',fontSize:13,fontWeight:500 }}>
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
              <div style={{ display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(200px,1fr))',gap:8 }}>
                {turnos.sort((a,b) => a.dia - b.dia || 'mtdn'.indexOf(a.turno) - 'mtdn'.indexOf(b.turno)).map(t => {
                  const tc = TURNOS_CONFIG.find(x => x.key === t.turno)
                  return (
                    <div key={`${t.dia}-${t.turno}`} style={{
                      display:'flex',
                      alignItems:'center',
                      gap:10,
                      padding:'10px 12px',
                      background:'var(--surface2)',
                      borderRadius:8,
                      border:`0.5px solid ${tc?.activeBorder || 'var(--border)'}44`
                    }}>
                      <div style={{
                        width:36,
                        height:36,
                        borderRadius:6,
                        background: tc ? tc.bg : '#0d2040',
                        border:`1.5px solid ${tc?.activeBorder || '#378ADD'}`,
                        display:'flex',
                        flexDirection:'column',
                        alignItems:'center',
                        justifyContent:'center',
                        flexShrink:0
                      }}>
                        <span style={{ fontSize:14,fontWeight:700,color:tc?.color || '#85B7EB',lineHeight:1 }}>{t.dia}</span>
                        <span style={{ fontSize:8,color:tc?.color || '#85B7EB',opacity:0.8 }}>{tc?.label || t.turno}</span>
                      </div>
                      <div>
                        <div style={{ fontSize:12,fontWeight:500,color:'var(--text)' }}>{turnoLabel(t.turno)}</div>
                        <div style={{ fontSize:10,color:'var(--text-muted)',marginTop:2 }}>{t.sector} · {horasPorTurno} hs</div>
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
