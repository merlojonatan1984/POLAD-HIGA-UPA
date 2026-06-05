import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../lib/supabase'

const SECTORES_POR_LUGAR = {
  'HIGA': ['Salud Mental','Giratoria','Llaves','Guardia','Estacionamiento'],
  'UPA': ['UPA'],
  'MODULAR': ['Modular']
}

const TURNOS_CONFIG_MAP = {
  MODULAR: [
    { key: 'm', label: 'M', nombre: 'Mañana', horario: '08:00 a 16:00', colorActivo: '#EF9F27', bgActivo: '#EF9F27', textActivo: '#1a0d00', borderActivo: '#EF9F27', borderCelda: '#BA7517', bgCelda: 'rgba(239,159,39,0.08)' },
    { key: 't', label: 'T', nombre: 'Tarde',  horario: '16:00 a 23:59', colorActivo: '#AFA9EC', bgActivo: '#7F77DD', textActivo: '#ffffff', borderActivo: '#7F77DD', borderCelda: '#7F77DD', bgCelda: 'rgba(127,119,221,0.08)' },
    { key: 'n', label: 'N', nombre: 'Noche',  horario: '23:59 a 08:00', colorActivo: '#85B7EB', bgActivo: '#378ADD', textActivo: '#ffffff', borderActivo: '#378ADD', borderCelda: '#378ADD', bgCelda: 'rgba(55,138,221,0.08)' },
  ],
  DEFAULT: [
    { key: 'd', label: 'D', nombre: 'Día',   horario: '08:00 a 20:00', colorActivo: '#EF9F27', bgActivo: '#EF9F27', textActivo: '#1a0d00', borderActivo: '#EF9F27', borderCelda: '#BA7517', bgCelda: 'rgba(239,159,39,0.08)' },
    { key: 'n', label: 'N', nombre: 'Noche', horario: '20:00 a 08:00', colorActivo: '#85B7EB', bgActivo: '#378ADD', textActivo: '#ffffff', borderActivo: '#378ADD', borderCelda: '#378ADD', bgCelda: 'rgba(55,138,221,0.08)' },
  ]
}

const COLOR_MAP = { HIGA: '#AFA9EC', UPA: '#D85A30', MODULAR: '#20A0B0' }

function detectLugar() {
  if (typeof window === 'undefined') return 'HIGA'
  const h = window.location.hostname
  if (h === 'polad-modular.vercel.app' || h.includes('polad-modular')) return 'MODULAR'
  if (h === 'polad-higa-upa.vercel.app') return 'UPA'
  return 'HIGA'
}

function getCeldaStyle(v, TURNOS_CONFIG) {
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
  const [appLugar, setAppLugar] = useState('HIGA')
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const lugar = detectLugar()
    setAppLugar(lugar)
    const checkMobile = () => setIsMobile(window.innerWidth < 600)
    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  const ES_MODULAR = appLugar === 'MODULAR'
  const TURNOS_CONFIG = ES_MODULAR ? TURNOS_CONFIG_MAP.MODULAR : TURNOS_CONFIG_MAP.DEFAULT
  const SECTORES_APP = SECTORES_POR_LUGAR[appLugar] || SECTORES_POR_LUGAR['HIGA']
  const COLOR_APP = COLOR_MAP[appLugar] || COLOR_MAP['HIGA']
  const HORAS_POR_TURNO = ES_MODULAR ? 8 : 12

  const diasMes = new Date(anio, mes, 0).getDate()
  const nombreMes = MESES_NOMBRES[mes - 1] + ' ' + anio
  const primerDia = (new Date(anio, mes - 1, 1).getDay() + 6) % 7

  useEffect(() => {
    const u = localStorage.getItem('polad_user')
    if (!u) { router.push('/'); return }
    const parsed = JSON.parse(u)
    if (parsed.es_admin) { router.push('/admin'); return }
    setUsuario(parsed)
  }, [])

  useEffect(() => {
    if (usuario && appLugar) {
      cargarDatos(usuario.legajo, mes, anio, appLugar)
    }
  }, [usuario, appLugar])

  async function cargarDatos(legajo, m, a, lugar) {
    setLoading(true)
    // Cargar ventana desde Supabase
    const now = new Date()
    const { data: cfg } = await supabase.from('configuracion').select('*').eq('lugar', lugar).eq('mes', now.getMonth()+1).eq('anio', now.getFullYear()).maybeSingle()
    if (cfg) {
      setVentana({ dia: cfg.dia?.toString()||'', horaInicio: cfg.hora_inicio||'08:00', horaFin: cfg.hora_fin||'20:00', mes: cfg.mes, anio: cfg.anio })
      // Fijar el mes y año al configurado por el admin
      if (cfg.mes) { setMes(cfg.mes); m = cfg.mes }
      if (cfg.anio) { setAnio(cfg.anio); a = cfg.anio }
    } else {
      const ventanasStr = localStorage.getItem(`polad_ventanas_${lugar}`)
      if (ventanasStr) { try { setVentana(JSON.parse(ventanasStr)) } catch(e) {} }
    }
    const sectores = SECTORES_POR_LUGAR[lugar] || SECTORES_POR_LUGAR['HIGA']
    const [{ data: disp }, { data: turns }] = await Promise.all([
      supabase.from('disponibilidad').select('dia, turno').eq('legajo', legajo).eq('mes', m).eq('anio', a).eq('lugar', lugar),
      supabase.from('turnos').select('dia, turno, sector').eq('legajo', legajo).eq('mes', m).eq('anio', a).in('sector', sectores)
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
    const h = window.location.hostname
    const lugar = h.includes('polad-modular') ? 'MODULAR' : h === 'polad-higa-upa.vercel.app' ? 'UPA' : 'HIGA'

    await supabase.from('disponibilidad').delete()
      .eq('legajo', usuario.legajo).eq('mes', mes).eq('anio', anio).eq('lugar', lugar)

    const inserts = Object.entries(disponibilidad).map(([dia, turno]) => ({
      legajo: usuario.legajo, dia: parseInt(dia), turno, mes, anio, lugar
    }))

    if (inserts.length > 0) await supabase.from('disponibilidad').insert(inserts)

    setMsg('✓ Disponibilidad guardada para ' + lugar)
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

  function turnoLabel(t) {
    const tc = TURNOS_CONFIG.find(x => x.key === t)
    return tc ? tc.horario : t
  }

  const abierta = esVentanaAbierta()
  const totalSeleccionados = Object.keys(disponibilidad).length
  const totalHoras = turnos.length * HORAS_POR_TURNO

  if (loading) return <div className="loading">Cargando...</div>

  // Tamaños adaptativos
  const cellPad = isMobile ? '5px 3px 4px' : '8px 10px 4px'
  const btnPad = isMobile ? '8px 0' : '9px 0'
  const btnFont = isMobile ? 13 : 14
  const dayFont = isMobile ? 15 : 18
  const gapCal = isMobile ? 3 : 5

  return (
    <div>
      {/* TOPBAR */}
      <div className="topbar" style={{ flexWrap: isMobile ? 'wrap' : 'nowrap', gap: isMobile ? 6 : 10, padding: isMobile ? '8px 12px' : undefined }}>
        <div style={{ display:'flex', alignItems:'center', gap: 8, flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: isMobile ? 13 : 14, fontWeight:500, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
            {usuario?.nombre?.split(',')[0]}
          </span>
          {!isMobile && <span style={{ fontSize:11, color:'var(--text-muted)' }}>Leg. {usuario?.legajo}</span>}
          <span style={{ background:`${COLOR_APP}22`, color:COLOR_APP, fontSize:11, padding:'2px 8px', borderRadius:3, fontWeight:600, border:`0.5px solid ${COLOR_APP}66`, flexShrink:0 }}>{appLugar}</span>
        </div>
        <div style={{ display:'flex', gap:6, alignItems:'center', flexShrink:0 }}>
          <div style={{ display:'flex', alignItems:'center', gap:4, background:'rgba(255,255,255,0.05)', borderRadius:6, padding:'4px 10px', border:'0.5px solid rgba(200,168,75,0.3)' }}>
            <span style={{ color:'#c8a84b', fontSize:12, fontWeight:600 }}>
              {isMobile ? MESES_NOMBRES[mes-1].substring(0,3) : MESES_NOMBRES[mes-1]} {anio}
            </span>
            <span style={{ fontSize:10, color:'var(--text-muted)', marginLeft:2 }}>🔒</span>
          </div>
          <button className="btn btn-sm" style={{ color:'#8b90a0' }} onClick={() => { localStorage.removeItem('polad_user'); router.push('/') }}>Salir</button>
        </div>
      </div>

      <div className="content" style={{ padding: isMobile ? '10px 8px' : undefined }}>
        {msg && <div className="alert alert-ok" style={{ marginBottom:14 }}>{msg}</div>}

        {!abierta && ventana?.dia && (
          <div className="alert alert-warn" style={{ marginBottom:14 }}>
            La inscripción está habilitada el día {ventana.dia} de {MESES_NOMBRES[mes-1]} de {ventana.horaInicio} a {ventana.horaFin}.
          </div>
        )}

        {/* Título + leyenda de turnos */}
        <div style={{ marginBottom: isMobile ? 10 : 16 }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems: isMobile ? 'flex-start' : 'flex-start', marginBottom: isMobile ? 10 : 16, flexWrap:'wrap', gap:8 }}>
            <div>
              <div style={{ fontSize: isMobile ? 15 : 18, fontWeight:500, color:'#ffffff', marginBottom:2 }}>
                Disponibilidad — {appLugar} · {nombreMes}
              </div>
              {!isMobile && <div style={{ fontSize:13, color:'var(--text-muted)' }}>Tocá los turnos en los que podés hacer guardia</div>}
            </div>
            {/* Leyenda de turnos — horizontal en mobile */}
            <div style={{ display:'flex', gap: isMobile ? 6 : 10, flexWrap:'wrap' }}>
              {TURNOS_CONFIG.map(tc => (
                <div key={tc.key} style={{ display:'flex', alignItems:'center', gap: isMobile ? 5 : 8, padding: isMobile ? '5px 8px' : '8px 14px', borderRadius:10, border:`1.5px solid ${tc.borderActivo}66`, background:`${tc.bgActivo}11` }}>
                  <div style={{ width: isMobile ? 24 : 32, height: isMobile ? 24 : 32, borderRadius:7, background:tc.bgActivo, border:`2px solid ${tc.borderActivo}`, display:'flex', alignItems:'center', justifyContent:'center', fontSize: isMobile ? 12 : 15, fontWeight:700, color:tc.textActivo }}>{tc.label}</div>
                  <div>
                    <div style={{ fontSize: isMobile ? 11 : 13, fontWeight:500, color:tc.colorActivo }}>{tc.nombre}</div>
                    {!isMobile && <div style={{ fontSize:11, color:'var(--text-muted)' }}>{tc.horario}</div>}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Cabecera días semana */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)', gap: gapCal, marginBottom: gapCal }}>
            {DIAS_SEMANA.map(d => (
              <div key={d} style={{ textAlign:'center', fontSize: isMobile ? 11 : 13, fontWeight:500, color:'var(--text-muted)', padding: isMobile ? '5px 0' : '8px 0', background:'rgba(255,255,255,0.04)', borderRadius:6 }}>{d}</div>
            ))}
          </div>

          {/* Calendario */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)', gap: gapCal }}>
            {Array.from({ length: primerDia }).map((_,i) => <div key={`e-${i}`}></div>)}
            {Array.from({ length: diasMes }, (_, i) => i + 1).map(dia => {
              const v = disponibilidad[dia] || ''
              const turnosDia = turnos.filter(t => t.dia === dia)
              const celdaStyle = getCeldaStyle(v, TURNOS_CONFIG)

              return (
                <div key={dia} style={{ borderRadius: isMobile ? 7 : 10, border:celdaStyle.border, background:celdaStyle.background, overflow:'hidden', opacity:abierta?1:0.5 }}>
                  <div style={{ padding: cellPad, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                    <span style={{ fontSize: dayFont, fontWeight:700, color:'#ffffff', lineHeight:1 }}>{dia}</span>
                    {turnosDia.length > 0 && <span style={{ fontSize: isMobile ? 9 : 10, color:'#1D9E75', fontWeight:700 }}>✓</span>}
                  </div>
                  <div style={{ padding: isMobile ? '0 3px 5px' : '0 5px 7px', display:'flex', gap: isMobile ? 2 : 3 }}>
                    {TURNOS_CONFIG.map(tc => {
                      const activo = v.includes(tc.key)
                      return (
                        <button
                          key={tc.key}
                          disabled={!abierta}
                          onClick={() => abierta && toggleDia(dia, tc.key)}
                          title={`${tc.nombre} ${tc.horario}`}
                          style={{
                            flex:1, padding: btnPad, borderRadius: isMobile ? 5 : 7,
                            border: activo ? `1.5px solid ${tc.borderActivo}` : '1.5px solid rgba(255,255,255,0.1)',
                            cursor: abierta ? 'pointer' : 'default',
                            fontSize: btnFont, fontWeight:700,
                            background: activo ? tc.bgActivo : 'rgba(255,255,255,0.05)',
                            color: activo ? tc.textActivo : 'rgba(255,255,255,0.2)',
                            transition:'all 0.15s', lineHeight:1,
                            minHeight: isMobile ? 32 : 36, // área táctil mínima
                          }}>
                          {tc.label}
                        </button>
                      )
                    })}
                  </div>
                  {turnosDia.length > 0 && !isMobile && (
                    <div style={{ padding:'0 5px 5px', display:'flex', gap:2, flexWrap:'wrap' }}>
                      {turnosDia.map(t => {
                        const tc = TURNOS_CONFIG.find(x => x.key === t.turno)
                        return (
                          <span key={t.turno} style={{ fontSize:9, padding:'2px 5px', borderRadius:4, background:tc?`${tc.bgActivo}33`:'rgba(29,158,117,0.2)', color:tc?tc.colorActivo:'#1D9E75', fontWeight:700 }}>
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

        {/* Barra guardar — sticky en mobile */}
        <div style={{
          display:'flex', justifyContent:'space-between', alignItems:'center',
          marginBottom: isMobile ? 0 : 24,
          padding: isMobile ? '12px 14px' : '14px 18px',
          background: isMobile ? 'rgba(20,22,35,0.97)' : 'rgba(255,255,255,0.03)',
          borderRadius: isMobile ? 0 : 10,
          border: isMobile ? 'none' : '0.5px solid rgba(255,255,255,0.08)',
          borderTop: isMobile ? '0.5px solid rgba(255,255,255,0.1)' : undefined,
          position: isMobile ? 'sticky' : 'relative',
          bottom: isMobile ? 0 : undefined,
          zIndex: isMobile ? 10 : undefined,
          gap: 10,
        }}>
          <div style={{ fontSize: isMobile ? 13 : 14, color:'var(--text-muted)' }}>
            <span style={{ color:'#ffffff', fontWeight:700, fontSize: isMobile ? 18 : 20 }}>{totalSeleccionados}</span>
            <span style={{ marginLeft:6 }}>días</span>
          </div>
          <button
            className="btn btn-success"
            disabled={guardando || !abierta}
            onClick={guardar}
            style={{ padding: isMobile ? '12px 20px' : '11px 26px', fontSize: isMobile ? 13 : 14, fontWeight:500, flex: isMobile ? 1 : undefined }}>
            {guardando ? 'Guardando...' : isMobile ? `Guardar — ${appLugar}` : `Guardar disponibilidad — ${appLugar}`}
          </button>
        </div>

        {/* Guardias asignadas */}
        {turnos.length > 0 && (
          <div className="panel" style={{ marginTop: isMobile ? 8 : 0 }}>
            <div className="panel-header" style={{ background:`${COLOR_APP}18`, borderBottom:`0.5px solid ${COLOR_APP}33` }}>
              <h3 style={{ color:COLOR_APP, fontSize: isMobile ? 12 : 14 }}>Mis guardias — {appLugar} · {nombreMes}</h3>
              <span style={{ fontSize:11, color:'#1D9E75', fontWeight:500 }}>Total: {totalHoras} hs</span>
            </div>
            <div style={{ padding: isMobile ? 8 : 12 }}>
              <div style={{ display:'grid', gridTemplateColumns: isMobile ? 'repeat(auto-fill,minmax(150px,1fr))' : 'repeat(auto-fill,minmax(190px,1fr))', gap: isMobile ? 6 : 8 }}>
                {turnos.sort((a,b) => a.dia - b.dia || 'mtdn'.indexOf(a.turno) - 'mtdn'.indexOf(b.turno)).map(t => {
                  const tc = TURNOS_CONFIG.find(x => x.key === t.turno)
                  return (
                    <div key={`${t.dia}-${t.turno}`} style={{ display:'flex', alignItems:'center', gap:8, padding: isMobile ? '8px 10px' : '10px 12px', background:'var(--surface2)', borderRadius:8, border:`0.5px solid ${tc?.borderActivo || 'var(--border)'}44` }}>
                      <div style={{ width: isMobile ? 32 : 38, height: isMobile ? 32 : 38, borderRadius:7, background:tc?.bgActivo||'#0d2040', border:`2px solid ${tc?.borderActivo||'#378ADD'}`, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                        <span style={{ fontSize: isMobile ? 13 : 15, fontWeight:700, color:tc?.textActivo||'#fff', lineHeight:1 }}>{t.dia}</span>
                        <span style={{ fontSize:9, color:tc?.textActivo||'#fff', opacity:0.8, fontWeight:600 }}>{tc?.label||t.turno}</span>
                      </div>
                      <div>
                        <div style={{ fontSize: isMobile ? 11 : 12, fontWeight:500, color:'var(--text)' }}>{turnoLabel(t.turno)}</div>
                        <div style={{ fontSize: isMobile ? 9 : 10, color:'var(--text-muted)', marginTop:2 }}>{t.sector} · {HORAS_POR_TURNO} hs</div>
                      </div>
                    </div>
                  )
                })}
              </div>
              <div style={{ marginTop:10, paddingTop:8, borderTop:'0.5px solid var(--border)', fontSize: isMobile ? 12 : 13, color:COLOR_APP, fontWeight:500, textAlign:'right' }}>
                Total: {totalHoras} hs en {appLugar}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
