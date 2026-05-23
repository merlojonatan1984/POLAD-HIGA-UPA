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

// ── Configuración de turnos según lugar ──────────────────────────────
const ES_MODULAR = APP_LUGAR === 'MODULAR'

const TURNOS_CONFIG = ES_MODULAR
  ? [
      { key: 'm', label: 'M', fullLabel: 'Mañana 08-16',   color: '#EF9F27', bg: '#3a2a0a', bgDark: '#0d2040' },
      { key: 't', label: 'T', fullLabel: 'Tarde 16-00',    color: '#AFA9EC', bg: '#2a1a4a', bgDark: '#1a0d3a' },
      { key: 'n', label: 'N', fullLabel: 'Noche 00-08',    color: '#85B7EB', bg: '#0d2040', bgDark: '#071428' },
    ]
  : [
      { key: 'd', label: 'D', fullLabel: 'Día 08-20',      color: '#EF9F27', bg: '#3a2a0a', bgDark: '#0d2040' },
      { key: 'n', label: 'N', fullLabel: 'Noche 20-08',    color: '#85B7EB', bg: '#0d2040', bgDark: '#071428' },
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
  if (ES_MODULAR) {
    if (t === 'm') return { bg: '#3a2a0a', color: '#EF9F27' }
    if (t === 't') return { bg: '#2a1a4a', color: '#AFA9EC' }
  }
  return t === 'd' ? { bg: '#3a2a0a', color: '#EF9F27' } : { bg: '#0d2040', color: '#85B7EB' }
}

// Calcula el color de fondo del día en el calendario según los turnos seleccionados
function bgDia(v) {
  if (!v) return 'var(--surface2)'
  if (ES_MODULAR) {
    if (v.includes('m') && v.includes('t') && v.includes('n')) return '#0d1a2a'
    if (v.includes('m') && v.includes('t')) return '#2a1a0a'
    if (v.includes('m') && v.includes('n')) return '#0d1a2a'
    if (v.includes('t') && v.includes('n')) return '#1a0d3a'
    if (v === 'm') return '#3a2a0a'
    if (v === 't') return '#2a1a4a'
    if (v === 'n') return '#0d2040'
  } else {
    if (v === 'dn') return '#0d2b1a'
    if (v === 'd') return '#3a2a0a'
    if (v === 'n') return '#0d2040'
  }
  return 'var(--surface2)'
}

function bcDia(v) {
  if (!v) return 'var(--border)'
  if (ES_MODULAR) {
    if (v.includes('m') && v.includes('n')) return '#378ADD'
    if (v.includes('m')) return '#BA7517'
    if (v.includes('t')) return '#7F77DD'
    if (v === 'n') return '#378ADD'
  } else {
    if (v === 'dn') return '#1D9E75'
    if (v === 'd') return '#BA7517'
    if (v === 'n') return '#378ADD'
  }
  return 'var(--border)'
}

// ────────────────────────────────────────────────────────────────────

const MES_ACTUAL = new Date().getMonth() + 1
const ANIO_ACTUAL = new Date().getFullYear()
const MESES_NOMBRES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']

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
    if (ventanasStr) {
      try { setVentana(JSON.parse(ventanasStr)) } catch(e) {}
    }
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

  // Toggle para HIGA/UPA (2 turnos: d, n)
  function toggleDiaStandard(dia, tipo) {
    setDisponibilidad(prev => {
      const actual = prev[dia] || ''
      let nuevo
      if (tipo === 'd') {
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

  // Toggle para MODULAR (3 turnos independientes: m, t, n)
  function toggleDiaModular(dia, tipo) {
    setDisponibilidad(prev => {
      const actual = prev[dia] || ''
      const keys = actual.split('').filter(Boolean)
      const idx = keys.indexOf(tipo)
      let nuevasKeys
      if (idx >= 0) {
        nuevasKeys = keys.filter(k => k !== tipo)
      } else {
        nuevasKeys = [...keys, tipo].sort((a, b) => 'mtn'.indexOf(a) - 'mtn'.indexOf(b))
      }
      const nuevo = nuevasKeys.join('')
      if (!nuevo) { const next = { ...prev }; delete next[dia]; return next }
      return { ...prev, [dia]: nuevo }
    })
  }

  function toggleDia(dia, tipo) {
    if (ES_MODULAR) toggleDiaModular(dia, tipo)
    else toggleDiaStandard(dia, tipo)
  }

  async function guardar() {
    if (!usuario) return
    const diasSeleccionados = Object.keys(disponibilidad).length
    if (diasSeleccionados === 0) {
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

  // Calcula horas por turno (MODULAR = 8hs, HIGA/UPA = 12hs)
  const horasPorTurno = ES_MODULAR ? 8 : 12
  const totalHoras = turnos.length * horasPorTurno

  if (loading) return <div className="loading">Cargando...</div>

  return (
    <div>
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
          <div style={{ fontSize:13,fontWeight:500,marginBottom:4 }}>Disponibilidad — {APP_LUGAR} · {nombreMes}</div>
          <div style={{ fontSize:11,color:'var(--text-muted)',marginBottom:12 }}>
            {ES_MODULAR
              ? 'Tocá los turnos en que podés hacer guardia. M = Mañana (08-16) · T = Tarde (16-00) · N = Noche (00-08)'
              : 'Tocá los días en que podés hacer guardia en ' + APP_LUGAR + '. D = día (08-20) · N = noche (20-08) · A = ambos'
            }
          </div>
          <div style={{ display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:2,marginBottom:4 }}>
            {['Lu','Ma','Mi','Ju','Vi','Sá','Do'].map(d => <div key={d} style={{ textAlign:'center',fontSize:10,color:'var(--text-hint)',padding:'4px 0' }}>{d}</div>)}
          </div>
          <div style={{ display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:3 }}>
            {Array.from({ length: primerDia }).map((_,i) => <div key={`e-${i}`}></div>)}
            {Array.from({ length: diasMes }, (_, i) => i + 1).map(dia => {
              const v = disponibilidad[dia] || ''
              const turnosDia = turnos.filter(t => t.dia === dia)
              return (
                <div key={dia} style={{ border:`0.5px solid ${bcDia(v)}`,borderRadius:6,padding:'4px 3px',minHeight: ES_MODULAR ? 58 : 48,background:bgDia(v),cursor:abierta?'pointer':'not-allowed',opacity:abierta?1:0.6 }}>
                  <div style={{ fontSize:10,fontWeight:500,color:'var(--text-muted)',marginBottom:1 }}>{dia}</div>
                  <div style={{ display:'flex',gap:2,marginBottom:2 }}>
                    {TURNOS_CONFIG.map(tc => (
                      <button key={tc.key} disabled={!abierta} onClick={() => abierta && toggleDia(dia, tc.key)}
                        style={{ flex:1,padding:'2px 0',borderRadius:3,border:'none',cursor:abierta?'pointer':'default',fontSize:9,fontWeight:500,
                          background: v.includes(tc.key) ? tc.bg : 'rgba(255,255,255,0.06)',
                          color: v.includes(tc.key) ? tc.color : '#666'
                        }}>
                        {tc.label}
                      </button>
                    ))}
                  </div>
                  {turnosDia.length > 0 && turnosDia.map(t => (
                    <div key={t.turno} style={{ fontSize:7,color:turnoColor(t.turno).color,textAlign:'center',marginTop:1 }}>
                      ✓ {ES_MODULAR ? (t.turno === 'm' ? 'Mañ' : t.turno === 't' ? 'Tarde' : 'Noche') : (t.turno === 'd' ? 'Día' : 'Noche')}
                    </div>
                  ))}
                </div>
              )
            })}
          </div>
        </div>

        <div style={{ display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:20 }}>
          <div style={{ fontSize:12,color:'var(--text-muted)' }}>
            {Object.keys(disponibilidad).length} días seleccionados
          </div>
          <button className="btn btn-success" disabled={guardando || !abierta} onClick={guardar}>
            {guardando ? 'Guardando...' : `Guardar disponibilidad — ${APP_LUGAR}`}
          </button>
        </div>

        {turnos.length > 0 && (
          <div className="panel">
            <div className="panel-header" style={{ background:`${COLOR_APP}22` }}><h3 style={{ color:COLOR_APP }}>Mis guardias asignadas — {APP_LUGAR} · {nombreMes}</h3></div>
            <div style={{ padding:12 }}>
              {turnos.sort((a,b) => a.dia - b.dia || 'mtn'.indexOf(a.turno) - 'mtn'.indexOf(b.turno)).map(t => {
                const tc = turnoColor(t.turno)
                return (
                  <div key={t.id || `${t.dia}-${t.turno}`} style={{ display:'flex',justifyContent:'space-between',alignItems:'center',padding:'8px 10px',background:'var(--surface2)',borderRadius:7,marginBottom:6,border:'0.5px solid var(--border)' }}>
                    <div>
                      <span style={{ fontSize:13,fontWeight:500 }}>Día {t.dia}</span>
                      <span style={{ fontSize:11,color:'var(--text-muted)',marginLeft:8 }}>{t.sector}</span>
                    </div>
                    <span style={{ fontSize:11,fontWeight:500,padding:'2px 10px',borderRadius:4,background:tc.bg,color:tc.color }}>
                      {turnoLabel(t.turno)}
                    </span>
                  </div>
                )
              })}
              <div style={{ marginTop:8,fontSize:12,color:COLOR_APP,fontWeight:500 }}>Total: {totalHoras} hs en {APP_LUGAR}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
