import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
// Ya no importa el cliente de Supabase: todo lo que este componente
// necesita (disponibilidad propia, guardias publicadas, ventana de
// inscripción, cambio de clave) pasa ahora por endpoints propios del
// servidor (pages/api/...), nunca directo con la clave anon.

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
  // Punto 1 de esta ronda ("Ingreso correcto por destino"): mismo motivo
  // y mismo orden que pages/admin.js — ver el comentario completo en
  // pages/index.js.
  try { if (process.env.NEXT_PUBLIC_LUGAR && ['HIGA', 'UPA', 'MODULAR'].includes(process.env.NEXT_PUBLIC_LUGAR)) return process.env.NEXT_PUBLIC_LUGAR } catch (e) {}
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
  // Punto 3 de la revisión: snapshot de lo que el servidor devolvió la
  // última vez que se cargó/guardó, para poder mandarlo como
  // dias_antes_esperado al guardar — `disponibilidad` en cambio va
  // cambiando con cada click del efectivo, así que no sirve como "lo que
  // vi al abrir la pantalla".
  const [disponibilidadOriginal, setDisponibilidadOriginal] = useState({})
  const [guardando, setGuardando] = useState(false)
  const [msg, setMsg] = useState(null)
  const [ventana, setVentana] = useState(null)
  const [turnos, setTurnos] = useState([])
  const [publicacion, setPublicacion] = useState({ publicado: false })
  const [loading, setLoading] = useState(true)
  const [appLugar, setAppLugar] = useState('HIGA')
  const [isMobile, setIsMobile] = useState(false)
  const [modalClave, setModalClave] = useState(false)
  const [claveActual, setClaveActual] = useState('')
  const [claveNueva, setClaveNueva] = useState('')
  const [claveConfirm, setClaveConfirm] = useState('')
  const [msgClave, setMsgClave] = useState(null)
  const [guardandoClave, setGuardandoClave] = useState(false)

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
    // Ventana de inscripción: por un endpoint propio con sesión (no directo
    // a Supabase con la clave anon) — ver pages/api/configuracion.js. Esto
    // es lo que permite que la tabla configuracion ya no sea legible/
    // escribible con la clave pública.
    const now = new Date()
    const { cfg } = await fetch(`/api/configuracion?lugar=${encodeURIComponent(lugar)}`).then(r => r.json()).catch(() => ({ cfg: null }))
    if (cfg) {
      setVentana({ dia: cfg.dia?.toString()||'', horaInicio: cfg.hora_inicio||'08:00', horaFin: cfg.hora_fin||'20:00', mes: cfg.mes, anio: cfg.anio, mesApertura: cfg.mes_apertura, anioApertura: cfg.anio_apertura })
      // Fijar el mes y año al configurado por el admin
      if (cfg.mes) { setMes(cfg.mes); m = cfg.mes }
      if (cfg.anio) { setAnio(cfg.anio); a = cfg.anio }
    } else {
      const ventanasStr = localStorage.getItem(`polad_ventanas_${lugar}`)
      if (ventanasStr) { try { setVentana(JSON.parse(ventanasStr)) } catch(e) {} }
    }
    // La disponibilidad propia y las guardias se leen ahora por endpoints
    // propios del servidor, identificando al efectivo por su sesión (cookie
    // firmada), no por el legajo que tengamos en el estado del navegador.
    // En particular, las guardias ya NO salen de la tabla turnos (el
    // borrador de trabajo del administrador): salen de /api/mis-guardias,
    // que solo devuelve la última versión PUBLICADA de las guardias de
    // este efectivo. Si todavía no se publicó nada para este mes, el
    // efectivo ve un aviso en vez de ver turnos del borrador.
    const [dispResp, guardiasResp] = await Promise.all([
      fetch(`/api/guardar-disponibilidad?mes=${m}&anio=${a}`).then(r => r.json()).catch(() => ({ dias: {} })),
      fetch(`/api/mis-guardias?mes=${m}&anio=${a}`).then(r => r.json()).catch(() => ({ publicado: false, turnos: [] })),
    ])
    setDisponibilidad(dispResp.dias || {})
    setDisponibilidadOriginal(dispResp.dias || {})
    setTurnos(guardiasResp.turnos || [])
    setPublicacion(guardiasResp.publicado
      ? { publicado: true, version: guardiasResp.version, publicado_en: guardiasResp.publicado_en }
      : { publicado: false })
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

  async function cambiarClave() {
    if (!claveNueva || claveNueva.length < 4) { setMsgClave('La clave debe tener al menos 4 caracteres.'); return }
    if (claveNueva !== claveConfirm) { setMsgClave('Las claves no coinciden.'); return }
    setGuardandoClave(true)
    // La clave actual ahora se verifica del lado del servidor (nunca acá:
    // el navegador ya no tiene la clave guardada para comparar, y aunque la
    // tuviera, esa comparación en el cliente no autoriza nada por sí sola).
    // Ver pages/api/cambiar-clave.js.
    try {
      const resp = await fetch('/api/cambiar-clave', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clave_actual: claveActual, clave_nueva: claveNueva }),
      })
      const body = await resp.json()
      if (!resp.ok) { setMsgClave(body.error || 'No se pudo cambiar la clave.'); setGuardandoClave(false); return }
    } catch (e) {
      setMsgClave('Error de conexión.'); setGuardandoClave(false); return
    }
    setMsgClave('✓ Clave actualizada correctamente.')
    setClaveActual(''); setClaveNueva(''); setClaveConfirm('')
    setGuardandoClave(false)
    setTimeout(() => { setModalClave(false); setMsgClave(null) }, 2000)
  }

  async function guardar() {
    if (!usuario) return
    if (Object.keys(disponibilidad).length === 0) {
      if (!confirm('No seleccionaste ningún día. ¿Confirmar disponibilidad vacía?')) return
    }
    setGuardando(true)
    setMsg(null)

    // El guardado ahora pasa por el servidor (/api/guardar-disponibilidad),
    // que vuelve a verificar ahí la ventana de inscripción antes de guardar
    // (aunque el botón ya esté deshabilitado acá, no hay que confiar solo
    // en eso). El lugar y el legajo los determina el servidor a partir de
    // la sesión, no de lo que mande el navegador.
    try {
      const resp = await fetch('/api/guardar-disponibilidad', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // dias_antes_esperado: la foto de disponibilidad que esta pantalla
        // cargó (o guardó) la última vez — el servidor la compara, dentro
        // de la misma transacción y bajo un lock, contra lo que haya de
        // verdad guardado ahora. Es obligatoria: sin ella el servidor
        // rechaza el guardado en vez de pisar algo a ciegas.
        body: JSON.stringify({ mes, anio, dias: disponibilidad, dias_antes_esperado: disponibilidadOriginal }),
      })
      const body = await resp.json()
      if (!resp.ok) {
        if (body.conflicto) {
          // Otra carga (propia en otra pestaña, o una corrección
          // administrativa) cambió esto mientras se editaba. No se guardó
          // nada — se refleja el estado real para no seguir editando sobre
          // una base que ya no existe.
          setDisponibilidad(body.dias_actuales || {})
          setDisponibilidadOriginal(body.dias_actuales || {})
          setMsg('✗ ' + (body.error || 'Tu disponibilidad cambió desde que abriste esta pantalla. Se actualizó con el estado real — revisá antes de guardar de nuevo.'))
        } else {
          setMsg('✗ ' + (body.error || 'No se pudo guardar.'))
        }
      } else {
        setDisponibilidadOriginal(disponibilidad)
        setMsg('✓ Disponibilidad guardada para ' + appLugar)
      }
    } catch (e) {
      setMsg('✗ Error de conexión. No se guardó — reintentá.')
    }
    setTimeout(() => setMsg(null), 4000)
    setGuardando(false)
  }

  function esVentanaAbierta() {
    if (!ventana || !ventana.dia) return true
    const ahora = new Date()
    const diaV = parseInt(ventana.dia)
    const mesAp = ventana.mesApertura || (ahora.getMonth() + 1)
    const anioAp = ventana.anioApertura || ahora.getFullYear()
    const [hIni, mIni] = (ventana.horaInicio || '00:00').split(':').map(Number)
    const [hFin, mFin] = (ventana.horaFin || '23:59').split(':').map(Number)
    const inicio = new Date(anioAp, mesAp - 1, diaV, hIni, mIni)
    const fin = new Date(anioAp, mesAp - 1, diaV, hFin, mFin)
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
      {modalClave && (
        <div style={{ position:'fixed',inset:0,background:'rgba(0,0,0,0.7)',zIndex:100,display:'flex',alignItems:'center',justifyContent:'center',padding:20 }}>
          <div style={{ background:'#13151f',borderRadius:12,border:'0.5px solid rgba(200,168,75,0.3)',width:'100%',maxWidth:360,overflow:'hidden' }}>
            <div style={{ padding:'14px 16px',borderBottom:'0.5px solid rgba(255,255,255,0.08)',display:'flex',justifyContent:'space-between',alignItems:'center',background:'rgba(200,168,75,0.06)' }}>
              <span style={{ fontSize:14,fontWeight:500,color:'#c8a84b' }}>🔑 Cambiar contraseña</span>
              <button className="btn btn-sm" onClick={() => { setModalClave(false); setMsgClave(null); setClaveActual(''); setClaveNueva(''); setClaveConfirm('') }}>Cerrar</button>
            </div>
            <div style={{ padding:16 }}>
              {msgClave && <div className={`alert ${msgClave.startsWith('✓') ? 'alert-ok' : 'alert-err'}`} style={{ marginBottom:12 }}>{msgClave}</div>}
              <div style={{ marginBottom:12 }}>
                <label style={{ fontSize:12,color:'var(--text-muted)',display:'block',marginBottom:5 }}>Clave actual</label>
                <input type="password" placeholder="Tu clave actual" value={claveActual} onChange={e => setClaveActual(e.target.value)}
                  style={{ width:'100%',padding:'10px 12px',border:'0.5px solid rgba(255,255,255,0.12)',borderRadius:8,fontSize:14,background:'#1e2130',color:'#e8eaf0',boxSizing:'border-box',outline:'none' }} />
                <p style={{ fontSize:10,color:'var(--text-muted)',marginTop:4 }}>Si nunca la cambiaste, ingresá tu número de legajo</p>
              </div>
              <div style={{ marginBottom:12 }}>
                <label style={{ fontSize:12,color:'var(--text-muted)',display:'block',marginBottom:5 }}>Nueva clave</label>
                <input type="password" placeholder="Mínimo 4 caracteres" value={claveNueva} onChange={e => setClaveNueva(e.target.value)}
                  style={{ width:'100%',padding:'10px 12px',border:'0.5px solid rgba(255,255,255,0.12)',borderRadius:8,fontSize:14,background:'#1e2130',color:'#e8eaf0',boxSizing:'border-box',outline:'none' }} />
              </div>
              <div style={{ marginBottom:16 }}>
                <label style={{ fontSize:12,color:'var(--text-muted)',display:'block',marginBottom:5 }}>Confirmar nueva clave</label>
                <input type="password" placeholder="Repetí la nueva clave" value={claveConfirm} onChange={e => setClaveConfirm(e.target.value)}
                  style={{ width:'100%',padding:'10px 12px',border:'0.5px solid rgba(255,255,255,0.12)',borderRadius:8,fontSize:14,background:'#1e2130',color:'#e8eaf0',boxSizing:'border-box',outline:'none' }} />
              </div>
              <button disabled={guardandoClave} onClick={cambiarClave}
                style={{ width:'100%',padding:'11px',borderRadius:8,border:'1px solid rgba(200,168,75,0.4)',background:'rgba(200,168,75,0.15)',color:'#c8a84b',fontSize:13,fontWeight:600,cursor:guardandoClave?'not-allowed':'pointer' }}>
                {guardandoClave ? 'Guardando...' : 'Cambiar clave'}
              </button>
            </div>
          </div>
        </div>
      )}

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
          <button className="btn btn-sm" style={{ color:'#c8a84b', border:'0.5px solid rgba(200,168,75,0.3)' }} onClick={() => setModalClave(true)}>🔑</button>
          <button className="btn btn-sm" style={{ color:'#8b90a0' }} onClick={() => { localStorage.removeItem('polad_user'); router.push('/') }}>Salir</button>
        </div>
      </div>

      <div className="content" style={{ padding: isMobile ? '10px 8px' : undefined }}>
        {msg && <div className={`alert ${msg.startsWith('✓') ? 'alert-ok' : 'alert-err'}`} style={{ marginBottom:14 }}>{msg}</div>}

        {!abierta && ventana?.dia && (
          <div className="alert alert-warn" style={{ marginBottom:14 }}>
            La carga/edición de disponibilidad está habilitada el día {ventana.dia} de {MESES_NOMBRES[mes-1]} de {ventana.horaInicio} a {ventana.horaFin}. Podés seguir consultando tu disponibilidad y tus guardias publicadas en cualquier momento.
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

        {/* Estado de publicación — si todavía no se publicó nada para este
            mes, se avisa explícitamente en vez de no mostrar nada (y nunca
            se muestra un borrador: turnos acá siempre viene de la última
            versión publicada, o viene vacío). */}
        {!publicacion.publicado && (
          <div className="alert alert-warn" style={{ marginBottom:14 }}>
            Las guardias de este mes todavía no fueron publicadas.
          </div>
        )}

        {/* Guardias asignadas */}
        {publicacion.publicado && turnos.length > 0 && (
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
