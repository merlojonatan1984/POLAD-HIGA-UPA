import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../lib/supabase'

function _detectLugar() {
  // Intentar leer variable de entorno (inlineada por Next.js en build time)
  try { if (process.env.NEXT_PUBLIC_LUGAR && ['HIGA','UPA','MODULAR'].includes(process.env.NEXT_PUBLIC_LUGAR)) return process.env.NEXT_PUBLIC_LUGAR } catch(e) {}
  if (typeof window === 'undefined') return 'HIGA'
  const h = window.location.hostname
  if (h === 'polad-modular.vercel.app' || h.includes('polad-modular')) return 'MODULAR'
  if (h === 'polad-higa-upa.vercel.app' || h.includes('polad-upa')) return 'UPA'
  return 'HIGA'
}
// APP_LUGAR se recalcula en cliente via useEffect — ver hook useLugar en AdminApp
const APP_LUGAR = _detectLugar()
const SECTORES_POR_LUGAR = {
  'HIGA': ['Salud Mental', 'Giratoria', 'Llaves', 'Guardia', 'Estacionamiento'],
  'UPA': ['UPA'],
  'MODULAR': ['Modular']
}
const SECTORES_APP = SECTORES_POR_LUGAR[APP_LUGAR] || SECTORES_POR_LUGAR['HIGA']
const ES_MODULAR = APP_LUGAR === 'MODULAR'
const TURNOS_LUGAR = ES_MODULAR ? ['m', 't', 'n'] : ['d', 'n']
const HORAS_TURNO = ES_MODULAR ? 8 : 12
const MAX_POR_SLOT = ES_MODULAR ? 3 : 2
const TURNOS_INFO = ES_MODULAR
  ? [
      { key: 'm', label: 'Mañana 08-16', color: '#EF9F27', bg: 'rgba(239,159,39,0.15)', horario: '08:00 a 16:00' },
      { key: 't', label: 'Tarde 16-24',  color: '#AFA9EC', bg: 'rgba(127,119,221,0.15)', horario: '16:00 a 24:00' },
      { key: 'n', label: 'Noche 00-08',  color: '#85B7EB', bg: 'rgba(55,138,221,0.15)', horario: '00:00 a 08:00' },
    ]
  : [
      { key: 'd', label: 'Día 08-20',    color: '#EF9F27', bg: 'rgba(239,159,39,0.15)', horario: '08:00 a 20:00' },
      { key: 'n', label: 'Noche 20-08',  color: '#85B7EB', bg: 'rgba(55,138,221,0.15)', horario: '20:00 a 08:00' },
    ]

const SEC_COLORS = { 'Salud Mental': '#378ADD', 'Giratoria': '#1D9E75', 'Llaves': '#EF9F27', 'Guardia': '#D4537E', 'Estacionamiento': '#7F77DD', 'UPA': '#D85A30', 'Modular': '#20A0B0' }
const MES_ACTUAL = new Date().getMonth() + 1
const ANIO_ACTUAL = new Date().getFullYear()
const MESES_NOMBRES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
const VISTAS = ['resumen', 'personal', 'disponibilidad', 'turnos', 'edicion', 'config', 'planillas', 'descarga']
const LABELS = { resumen: 'Resumen', personal: 'Personal', disponibilidad: 'Disponibilidad', turnos: 'Guardias', edicion: 'Edición manual', config: 'Configuración', planillas: 'Planillas', descarga: '⬇ Planilla Guardia' }

const COLOR_APP = APP_LUGAR === 'HIGA' ? '#AFA9EC' : APP_LUGAR === 'UPA' ? '#D85A30' : '#20A0B0'
const BG_APP   = APP_LUGAR === 'HIGA' ? 'rgba(42,37,96,0.5)' : APP_LUGAR === 'UPA' ? 'rgba(80,30,10,0.5)' : 'rgba(10,50,60,0.5)'

function ModalTurno({ turno, efectivos, horasAsig, onClose, onGuardar, onEliminar, onAgregar, diasMes, mes, anio, turnosDelDia }) {
  const esNuevo = !turno.id
  const [legajoSel, setLegajoSel] = useState(turno.legajo || '')
  const [turnoSel, setTurnoSel] = useState(turno.turno || TURNOS_LUGAR[0])
  const [sectorSel, setSectorSel] = useState(turno.sector || SECTORES_APP[0])
  const [diaSel, setDiaSel] = useState(turno.dia || 1)
  const [guardando, setGuardando] = useState(false)
  const [confirmElim, setConfirmElim] = useState(false)

  const efSel = efectivos.find(e => e.legajo === legajoSel)
  const hs = horasAsig[legajoSel] || 0
  const colorHs = hs >= 180 ? '#E24B4A' : hs >= 150 ? '#EF9F27' : '#1D9E75'

  async function handleGuardar() {
    if (!legajoSel) return
    setGuardando(true)
    if (esNuevo) await onAgregar({ legajo: legajoSel, mes, anio, dia: diaSel, turno: turnoSel, sector: sectorSel })
    else await onGuardar({ ...turno, legajo: legajoSel, turno: turnoSel, sector: sectorSel })
    setGuardando(false)
  }

  return (
    <div style={{ position:'fixed',inset:0,background:'rgba(0,0,0,0.6)',zIndex:50,display:'flex',alignItems:'center',justifyContent:'center',padding:20 }}>
      <div style={{ background:'#13151f',borderRadius:12,border:'0.5px solid rgba(255,255,255,0.1)',width:'100%',maxWidth:440,overflow:'hidden' }}>
        <div style={{ padding:'14px 16px',borderBottom:'0.5px solid rgba(255,255,255,0.08)',display:'flex',justifyContent:'space-between',alignItems:'center',background:'#1a1d27' }}>
          <h3 style={{ fontSize:14,fontWeight:500,color:'#e8eaf0' }}>{esNuevo ? 'Agregar turno manual' : 'Editar turno'}</h3>
          <button className="btn btn-sm" onClick={onClose}>Cerrar</button>
        </div>
        <div style={{ padding:16 }}>
          {esNuevo && (
            <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:14 }}>
              <div>
                <label>Día del mes</label>
                <select value={diaSel} onChange={e => setDiaSel(parseInt(e.target.value))}>
                  {Array.from({length:diasMes},(_,i) => <option key={i+1} value={i+1}>Día {i+1}</option>)}
                </select>
              </div>
              <div>
                <label>Sector</label>
                <select value={sectorSel} onChange={e => setSectorSel(e.target.value)}>
                  {SECTORES_APP.map(s => <option key={s}>{s}</option>)}
                </select>
              </div>
            </div>
          )}
          {!esNuevo && (
            <div style={{ background:'#1a1d27',borderRadius:8,padding:'8px 12px',marginBottom:14,fontSize:12,color:'#8b90a0' }}>
              Día {turno.dia} · {turno.sector}
            </div>
          )}
          <div style={{ marginBottom:14 }}>
            <label>Turno</label>
            <div style={{ display:'flex',gap:8,flexWrap:'wrap' }}>
              {TURNOS_INFO.map(ti => (
                <button key={ti.key} className="btn" style={{ flex:1,justifyContent:'center',background:turnoSel===ti.key?ti.bg:'transparent',color:turnoSel===ti.key?ti.color:'#8b90a0',borderColor:turnoSel===ti.key?ti.color:'rgba(255,255,255,0.1)' }} onClick={() => setTurnoSel(ti.key)}>{ti.label}</button>
              ))}
            </div>
          </div>
          <div style={{ marginBottom:14 }}>
            <label>Efectivo</label>
            <select value={legajoSel} onChange={e => setLegajoSel(e.target.value)}>
              <option value="">— Seleccionar efectivo —</option>
              {efectivos.map(e => {
                const h = horasAsig[e.legajo] || 0
                const tope = h >= 180
                const yaAsignado = esNuevo && turnosDelDia ? turnosDelDia.some(t => t.legajo === e.legajo && t.turno === turnoSel) : false
                const disabled = tope || yaAsignado
                return <option key={e.legajo} value={e.legajo} disabled={disabled}>
                  {tope ? '⛔ TOPE — ' : yaAsignado ? '✓ Ya asignado — ' : ''}{e.legajo ? `[${e.legajo}] ` : ''}{e.nombre} — {h} hs
                </option>
              })}
            </select>
          </div>
          {efSel && (
            <div style={{ background:'#1a1d27',borderRadius:8,padding:'10px 12px',fontSize:12 }}>
              <div style={{ display:'flex',justifyContent:'space-between' }}>
                <span style={{ color:'#e8eaf0',fontWeight:500 }}>{efSel.nombre}</span>
                <span style={{ color:colorHs,fontWeight:500 }}>{hs} hs / 180</span>
              </div>
              {hs >= 180 && <div style={{ color:'#F09595',fontSize:11,marginTop:4 }}>Este efectivo alcanzó el tope de horas.</div>}
            </div>
          )}
        </div>
        <div style={{ padding:'12px 16px',borderTop:'0.5px solid rgba(255,255,255,0.06)',display:'flex',justifyContent:'space-between' }}>
          <div>
            {!esNuevo && !confirmElim && <button className="btn btn-sm" style={{ color:'#F09595',borderColor:'rgba(240,149,149,0.3)' }} onClick={() => setConfirmElim(true)}>Eliminar</button>}
            {!esNuevo && confirmElim && (
              <div style={{ display:'flex',gap:6,alignItems:'center' }}>
                <span style={{ fontSize:12,color:'#F09595' }}>¿Confirmar?</span>
                <button className="btn btn-sm" style={{ background:'#E24B4A',color:'#fff',border:'none' }} onClick={() => onEliminar(turno)}>Sí</button>
                <button className="btn btn-sm" onClick={() => setConfirmElim(false)}>No</button>
              </div>
            )}
          </div>
          <div style={{ display:'flex',gap:8 }}>
            <button className="btn btn-sm" onClick={onClose}>Cancelar</button>
            <button className="btn btn-sm" disabled={!legajoSel||guardando} style={{ background:'rgba(200,168,75,0.15)',color:'#c8a84b',border:'0.5px solid rgba(200,168,75,0.4)' }} onClick={handleGuardar}>
              {guardando ? 'Guardando...' : esNuevo ? 'Agregar' : 'Guardar'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function ModalPersonal({ datos, onClose, onGuardar, onEliminar, guardando, msg }) {
  const [form, setForm] = useState({ ...datos, lugar: datos.lugar || APP_LUGAR })
  const esNuevo = !datos.id
  return (
    <div style={{ position:'fixed',inset:0,background:'rgba(0,0,0,0.6)',zIndex:50,display:'flex',alignItems:'center',justifyContent:'center',padding:20 }}>
      <div style={{ background:'#13151f',borderRadius:12,border:'0.5px solid rgba(200,168,75,0.2)',width:'100%',maxWidth:560,maxHeight:'90vh',display:'flex',flexDirection:'column',overflow:'hidden' }}>
        <div style={{ padding:'14px 16px',borderBottom:'0.5px solid rgba(200,168,75,0.15)',display:'flex',justifyContent:'space-between',alignItems:'center',background:'rgba(200,168,75,0.06)' }}>
          <h3 style={{ fontSize:14,fontWeight:500,color:'#c8a84b' }}>{esNuevo ? 'Dar de alta efectivo' : 'Editar efectivo'}</h3>
          <button className="btn btn-sm" onClick={onClose}>Cerrar</button>
        </div>
        <div style={{ padding:16,overflowY:'auto',flex:1 }}>
          {msg && <div className={`alert ${msg.startsWith('Error') ? 'alert-err' : 'alert-ok'}`} style={{ marginBottom:12 }}>{msg}</div>}
          <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:4 }}>
            <div>
              <label>Legajo</label>
              <input type="text" placeholder="Ej: 71234" value={form.legajo||''} onChange={e => setForm({...form,legajo:e.target.value})} style={{ width:'100%',padding:'7px 10px',border:'0.5px solid rgba(255,255,255,0.12)',borderRadius:8,fontSize:13,background:'#1e2130',color:'#e8eaf0',outline:'none' }} />
              {!esNuevo && <p style={{ fontSize:10,color:'#EF9F27',marginTop:3 }}>⚠ Cambia la clave de acceso</p>}
            </div>
            <div>
              <label>DNI</label>
              <input type="text" placeholder="Ej: 39282445" value={form.dni||''} onChange={e => setForm({...form,dni:e.target.value})} style={{ width:'100%',padding:'7px 10px',border:'0.5px solid rgba(255,255,255,0.12)',borderRadius:8,fontSize:13,background:'#1e2130',color:'#e8eaf0',outline:'none' }} />
            </div>
          </div>
          <div style={{ marginBottom:8 }}>
            <label>Apellido y nombre</label>
            <input type="text" placeholder="Ej: GARCÍA, MARCOS" value={form.nombre||''} onChange={e => setForm({...form,nombre:e.target.value.toUpperCase()})} style={{ width:'100%',padding:'7px 10px',border:'0.5px solid rgba(255,255,255,0.12)',borderRadius:8,fontSize:13,background:'#1e2130',color:'#e8eaf0',outline:'none' }} />
          </div>
          <div style={{ marginBottom:8 }}>
            <label>Jerarquía</label>
            <input type="text" placeholder="Ej: SARGENTO (E.G.)" value={form.jerarquia||''} onChange={e => setForm({...form,jerarquia:e.target.value.toUpperCase()})} style={{ width:'100%',padding:'7px 10px',border:'0.5px solid rgba(255,255,255,0.12)',borderRadius:8,fontSize:13,background:'#1e2130',color:'#e8eaf0',outline:'none' }} />
          </div>
          <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:8 }}>
            <div>
              <label>Email</label>
              <input type="email" placeholder="ejemplo@gmail.com" value={form.email||''} onChange={e => setForm({...form,email:e.target.value})} style={{ width:'100%',padding:'7px 10px',border:'0.5px solid rgba(255,255,255,0.12)',borderRadius:8,fontSize:13,background:'#1e2130',color:'#e8eaf0',outline:'none' }} />
            </div>
            <div>
              <label>Teléfono (WhatsApp)</label>
              <input type="tel" placeholder="Ej: 2235123456" value={form.telefono||''} onChange={e => setForm({...form,telefono:e.target.value})} style={{ width:'100%',padding:'7px 10px',border:'0.5px solid rgba(255,255,255,0.12)',borderRadius:8,fontSize:13,background:'#1e2130',color:'#e8eaf0',outline:'none' }} />
            </div>
          </div>
          <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:8 }}>
            <div>
              <label>Lugar / Destino</label>
              <input value={APP_LUGAR} disabled style={{ width:'100%',padding:'7px 10px',border:'0.5px solid rgba(255,255,255,0.08)',borderRadius:8,fontSize:13,background:'#161820',color:COLOR_APP,outline:'none' }} />
            </div>
            <div>
              <label>Escalafón</label>
              <select value={form.tipo||'Uniformado'} onChange={e => setForm({...form,tipo:e.target.value})} style={{ width:'100%',padding:'7px 10px',border:'0.5px solid rgba(255,255,255,0.12)',borderRadius:8,fontSize:13,background:'#1e2130',color:'#e8eaf0',outline:'none' }}>
                <option>Uniformado</option><option>Serv. General</option><option>Destacamento</option>
              </select>
            </div>
          </div>
          <div style={{ marginBottom:4 }}>
            <label>📝 Nota / Recordatorio</label>
            <textarea value={form.notas||''} onChange={e => setForm({...form,notas:e.target.value})} rows={2} style={{ width:'100%',padding:'7px 10px',border:'0.5px solid rgba(255,255,255,0.12)',borderRadius:8,fontSize:12,background:'#1e2130',color:'#e8eaf0',outline:'none',resize:'none' }} />
          </div>
        </div>
        <div style={{ padding:'12px 16px',borderTop:'0.5px solid rgba(255,255,255,0.06)',display:'flex',justifyContent:'space-between' }}>
          <div>
            {!esNuevo && <button className="btn btn-sm" style={{ color:'#F09595',borderColor:'rgba(240,149,149,0.3)' }} onClick={() => { if(confirm('¿Eliminar este efectivo?')) onEliminar(form) }}>Eliminar</button>}
          </div>
          <div style={{ display:'flex',gap:8 }}>
            <button className="btn btn-sm" onClick={onClose}>Cancelar</button>
            <button className="btn btn-sm" disabled={guardando||!form.legajo||!form.nombre} style={{ background:'rgba(200,168,75,0.15)',color:'#c8a84b',border:'0.5px solid rgba(200,168,75,0.4)' }} onClick={() => onGuardar({...form, lugar: APP_LUGAR})}>
              {guardando ? 'Guardando...' : esNuevo ? 'Dar de alta' : 'Guardar'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function AdminApp() {
  const router = useRouter()
  const [mesSeleccionado, setMesSeleccionado] = useState(MES_ACTUAL)
  const [anioSeleccionado, setAnioSeleccionado] = useState(ANIO_ACTUAL)
  const MES = mesSeleccionado
  const ANIO = anioSeleccionado
  const DIAS_MES = new Date(ANIO, MES, 0).getDate()
  const NOMBRE_MES = MESES_NOMBRES[MES-1] + ' ' + ANIO
  const NOMBRE_MES_SOLO = MESES_NOMBRES[MES-1]
  const [vista, setVista] = useState('resumen')
  const [efectivos, setEfectivos] = useState([])
  const [disponibilidad, setDisponibilidad] = useState({})
  const [turnos, setTurnos] = useState({})
  const [horasAsig, setHorasAsig] = useState({})
  const [loading, setLoading] = useState(true)
  const [generando, setGenerando] = useState(false)
  const [msgGen, setMsgGen] = useState(null)
  const [modalTurno, setModalTurno] = useState(null)
  const [modalPersonal, setModalPersonal] = useState(null)
  const [guardandoPersonal, setGuardandoPersonal] = useState(false)
  const [msgPersonal, setMsgPersonal] = useState(null)
  const [efDetalle, setEfectivoDetalle] = useState(null)
  const [filtroDia, setFiltroDia] = useState(1)
  const [config, setConfig] = useState({ totalHoras: 2400, pctUniformados: 60, pctGeneral: 40 })
  const [ventanas, setVentanas] = useState({ dia: '', horaInicio: '08:00', horaFin: '20:00' })
  const [ventanasGuardadas, setVentanasGuardadas] = useState(false)
  const [configGuardada, setConfigGuardada] = useState(false)
  const [planillaEf, setPlanillaEf] = useState(null)
  const [planillaManual, setPlanillaManual] = useState({})
  const [firmas, setFirmas] = useState({})
  const [cargandoPlanilla, setCargandoPlanilla] = useState(false)
  const [filasCache, setFilasCache] = useState([])
  const [manualDia, setManualDia] = useState(1)
  const [manualHorario, setManualHorario] = useState('')
  const [manualHoras, setManualHoras] = useState('')
  const [descargando, setDescargando] = useState(null)
  const [dispDelDia, setDispDelDia] = useState({ dia: null, data: [] })
  const [modalAsignar, setModalAsignar] = useState(null)
  const [efDisponibles, setEfDisponibles] = useState([])
  const [asignando, setAsignando] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [lugarDetectado, setLugarDetectado] = useState(APP_LUGAR)

  useEffect(() => {
    // Redetectar lugar en el cliente para asegurar valor correcto
    const lugar = _detectLugar()
    setLugarDetectado(lugar)
    setMounted(true)
    const u = localStorage.getItem('polad_user')
    if (!u) { router.push('/'); return }
    const parsed = JSON.parse(u)
    if (!parsed.es_admin) { router.push('/efectivo'); return }
    const v = localStorage.getItem(`polad_ventanas_${lugar}`)
    if (v) try { setVentanas(JSON.parse(v)) } catch(e) {}
    // Cargar datos con el lugar detectado en cliente
    setTimeout(() => cargarTodo(lugar), 0)
  }, [])

  useEffect(() => { if (mounted) cargarTodo(lugarDetectado) }, [mesSeleccionado, anioSeleccionado, mounted, lugarDetectado])

  useEffect(() => {
    if (!mounted) return
    async function cargarDispDia() {
      const { data } = await supabase.from('disponibilidad').select('legajo, dia, turno').eq('mes', MES).eq('anio', ANIO).eq('dia', filtroDia).eq('lugar', lugarDetectado)
      setDispDelDia({ dia: filtroDia, data: data || [] })
    }
    cargarDispDia()
  }, [filtroDia, mesSeleccionado, anioSeleccionado, mounted])

  async function cargarTodo(lugar) {
    const L = lugar || lugarDetectado || APP_LUGAR
    const sectores = SECTORES_POR_LUGAR[L] || SECTORES_POR_LUGAR['HIGA']
    setLoading(true)
    const [{ data: efs }, { data: disp }, { data: turns }] = await Promise.all([
      supabase.from('efectivos').select('*').eq('es_admin', false).eq('lugar', L).order('nombre'),
      supabase.from('disponibilidad').select('*').eq('mes', MES).eq('anio', ANIO).eq('lugar', L),
      supabase.from('turnos').select('*').eq('mes', MES).eq('anio', ANIO).in('sector', sectores)
    ])
    setEfectivos(efs || [])
    const dispMap = {}
    ;(disp || []).forEach(d => {
      if (!dispMap[d.legajo]) dispMap[d.legajo] = {}
      dispMap[d.legajo][d.dia] = { turno: d.turno }
    })
    setDisponibilidad(dispMap)
    const turnosMap = {}; const hsMap = {}
    ;(turns || []).forEach(t => {
      if (!turnosMap[t.legajo]) turnosMap[t.legajo] = []
      turnosMap[t.legajo].push(t)
      hsMap[t.legajo] = (hsMap[t.legajo] || 0) + HORAS_TURNO
    })
    setTurnos(turnosMap)
    setHorasAsig(hsMap)
    setLoading(false)
  }

  async function generarTurnos() {
    setGenerando(true); setMsgGen(null)
    await supabase.from('turnos').delete().eq('mes', MES).eq('anio', ANIO).in('sector', SECTORES_APP)
    const uniformados = efectivos.filter(e => e.tipo === 'Uniformado')
    const servGeneral = efectivos.filter(e => e.tipo === 'Serv. General')
    const hsU = Math.round(config.totalHoras * config.pctUniformados / 100)
    const hsG = Math.round(config.totalHoras * config.pctGeneral / 100)
    const maxU = uniformados.length ? Math.min(180, Math.round(hsU / uniformados.length)) : 180
    const maxG = servGeneral.length ? Math.min(180, Math.round(hsG / servGeneral.length)) : 180
    const pool = efectivos.map(e => ({ ...e, hs: 0, maxHs: e.tipo === 'Uniformado' ? maxU : maxG }))
    const nuevos = []
    for (let dia = 1; dia <= DIAS_MES; dia++) {
      for (const turno of TURNOS_LUGAR) {
        for (const sector of SECTORES_APP) {
          const candidatos = pool.filter(e => {
            const diaEntry = (disponibilidad[e.legajo] || {})[dia]
            const avail = diaEntry ? (diaEntry.turno || '') : ''
            return avail && avail.includes(turno) && e.hs < e.maxHs
          }).sort((a, b) => a.hs - b.hs)
          candidatos.slice(0, MAX_POR_SLOT).forEach(e => { e.hs += HORAS_TURNO; nuevos.push({ legajo: e.legajo, mes: MES, anio: ANIO, dia, turno, sector }) })
        }
      }
    }
    for (let i = 0; i < nuevos.length; i += 500) await supabase.from('turnos').insert(nuevos.slice(i, i + 500))
    setMsgGen(`Se generaron ${nuevos.length} asignaciones.`)
    await cargarTodo(); setGenerando(false)
  }

  async function asignarGuardiasAuto(legajo, cantidad, tipoTurno) {
    setAsignando(true)
    const [{ data: dispData }, { data: turnosEfData }, { data: turnosTodos }] = await Promise.all([
      supabase.from('disponibilidad').select('dia, turno').eq('legajo', legajo).eq('mes', MES).eq('anio', ANIO).eq('lugar', lugarDetectado),
      supabase.from('turnos').select('dia, turno, sector').eq('legajo', legajo).eq('mes', MES).eq('anio', ANIO).in('sector', SECTORES_APP),
      supabase.from('turnos').select('dia, turno, sector').eq('mes', MES).eq('anio', ANIO).in('sector', SECTORES_APP)
    ])
    const ocupacion = {}
    ;(turnosTodos || []).forEach(t => { const k = t.dia + '-' + t.turno + '-' + t.sector; ocupacion[k] = (ocupacion[k] || 0) + 1 })

    // Construir sets de ya asignados por turno
    const yaAsignadosPorTurno = {}
    TURNOS_LUGAR.forEach(tk => { yaAsignadosPorTurno[tk] = new Set((turnosEfData || []).filter(t => t.turno === tk).map(t => parseInt(t.dia))) })

    const diasDisp = [...new Set((dispData || []).filter(d => {
      const diaNum = parseInt(d.dia)
      if (TURNOS_LUGAR.includes(tipoTurno)) return d.turno && d.turno.includes(tipoTurno) && !(yaAsignadosPorTurno[tipoTurno]||new Set()).has(diaNum)
      if (tipoTurno === 'mixto' || tipoTurno === 'dn') return d.turno !== '' && TURNOS_LUGAR.some(tk => !(yaAsignadosPorTurno[tk]||new Set()).has(diaNum))
      if (tipoTurno === 'doble') return d.turno && TURNOS_LUGAR.every(tk => d.turno.includes(tk) && !(yaAsignadosPorTurno[tk]||new Set()).has(diaNum))
      return false
    }).map(d => parseInt(d.dia)))]

    if (diasDisp.length === 0) { alert('Sin días disponibles para asignar.'); setAsignando(false); return }
    const diasSeleccionados = [...diasDisp].sort(() => Math.random() - 0.5).slice(0, Math.min(cantidad, diasDisp.length))
    const nuevos = []

    for (const dia of diasSeleccionados) {
      if (tipoTurno === 'doble' || tipoTurno === 'mixto') {
        TURNOS_LUGAR.forEach(tk => {
          const ya = yaAsignadosPorTurno[tk] || new Set()
          if (!ya.has(dia)) {
            const s = SECTORES_APP.find(s => (ocupacion[dia+'-'+tk+'-'+s] || 0) < MAX_POR_SLOT)
            if (s) { nuevos.push({ legajo, mes: MES, anio: ANIO, dia, turno: tk, sector: s }); ocupacion[dia+'-'+tk+'-'+s]=(ocupacion[dia+'-'+tk+'-'+s]||0)+1; ya.add(dia) }
          }
        })
      } else if (tipoTurno === 'dn') {
        const counts = TURNOS_LUGAR.map(tk => nuevos.filter(n=>n.turno===tk).length)
        const t = TURNOS_LUGAR[counts.indexOf(Math.min(...counts))]
        const ya = yaAsignadosPorTurno[t] || new Set()
        if (!ya.has(dia)) {
          const s = SECTORES_APP.find(s => (ocupacion[dia+'-'+t+'-'+s] || 0) < MAX_POR_SLOT)
          if (s) { nuevos.push({ legajo, mes: MES, anio: ANIO, dia, turno: t, sector: s }); ocupacion[dia+'-'+t+'-'+s]=(ocupacion[dia+'-'+t+'-'+s]||0)+1; ya.add(dia) }
        }
      } else {
        const ya = yaAsignadosPorTurno[tipoTurno] || new Set()
        if (!ya.has(dia)) {
          const s = SECTORES_APP.find(s => (ocupacion[dia+'-'+tipoTurno+'-'+s] || 0) < MAX_POR_SLOT)
          if (s) { nuevos.push({ legajo, mes: MES, anio: ANIO, dia, turno: tipoTurno, sector: s }); ocupacion[dia+'-'+tipoTurno+'-'+s]=(ocupacion[dia+'-'+tipoTurno+'-'+s]||0)+1; ya.add(dia) }
        }
      }
    }

    if (nuevos.length === 0) { alert('No hay sectores disponibles.'); setAsignando(false); return }
    for (let i = 0; i < nuevos.length; i += 100) await supabase.from('turnos').insert(nuevos.slice(i, i + 100))
    setModalAsignar(null); setAsignando(false)
    await cargarTodo()
    const nombre = efectivos.find(e=>e.legajo===legajo)?.nombre?.split(',')[0] || legajo
    alert(`✓ Se asignaron ${nuevos.length} guardias a ${nombre}.`)
  }

  async function descargarPlanilla(turno) {
    try {
      const url = `/api/generar-planilla?lugar=${lugarDetectado}&turno=${turno}&mes=${MES}&anio=${ANIO}`
      const res = await fetch(url)
      if (!res.ok) throw new Error('Error al generar')
      const blob = await res.blob(); const a = document.createElement('a')
      a.href = URL.createObjectURL(blob); a.download = `${APP_LUGAR}_${turno}_${NOMBRE_MES}.xlsx`; a.click(); URL.revokeObjectURL(a.href)
    } catch(e) { alert('Error: ' + e.message) }
  }

  async function handleGuardarEdicion(t) { await supabase.from('turnos').update({ legajo: t.legajo, turno: t.turno, sector: t.sector }).eq('id', t.id); setModalTurno(null); await cargarTodo() }
  async function handleEliminarTurno(t) { await supabase.from('turnos').delete().eq('id', t.id); setModalTurno(null); await cargarTodo() }
  async function handleAgregarTurno(n) { await supabase.from('turnos').insert([n]); setModalTurno(null); await cargarTodo() }

  async function handleGuardarPersonal(datos) {
    setGuardandoPersonal(true)
    if (datos.id) {
      const efOriginal = efectivos.find(e => e.id === datos.id); const legajoViejo = efOriginal?.legajo
      if (legajoViejo && legajoViejo !== datos.legajo) {
        await Promise.all([
          supabase.from('disponibilidad').update({ legajo: datos.legajo }).eq('legajo', legajoViejo),
          supabase.from('turnos').update({ legajo: datos.legajo }).eq('legajo', legajoViejo),
          supabase.from('asistencia').update({ legajo: datos.legajo }).eq('legajo', legajoViejo),
          supabase.from('planilla_manual').update({ legajo: datos.legajo }).eq('legajo', legajoViejo),
          supabase.from('firmas').update({ legajo: datos.legajo }).eq('legajo', legajoViejo),
        ])
      }
      await supabase.from('efectivos').update({ legajo: datos.legajo, nombre: datos.nombre, tipo: datos.tipo, email: datos.email || '', sector: datos.sector || 'Sin asignar', telefono: datos.telefono || '', notas: datos.notas || null, dni: datos.dni || null, jerarquia: datos.jerarquia || null, lugar: APP_LUGAR }).eq('id', datos.id)
      setMsgPersonal('Efectivo actualizado.')
    } else {
      const { error } = await supabase.from('efectivos').insert([{ legajo: datos.legajo, nombre: datos.nombre, tipo: datos.tipo, email: datos.email || '', sector: 'Sin asignar', es_admin: false, telefono: datos.telefono || '', lugar: APP_LUGAR }])
      if (error) { setMsgPersonal('Error: ' + (error.message.includes('duplicate') ? 'ese legajo ya existe.' : error.message)); setGuardandoPersonal(false); return }
      setMsgPersonal('Efectivo dado de alta. Clave inicial: ' + datos.legajo)
    }
    setGuardandoPersonal(false); await cargarTodo()
  }
  async function handleEliminarPersonal(ef) { await supabase.from('efectivos').delete().eq('id', ef.id); setModalPersonal(null); await cargarTodo() }

  async function cargarPlanillaEf(ef) {
    setCargandoPlanilla(true)
    const [{ data: manual }, { data: firmasData }, { data: asist }] = await Promise.all([
      supabase.from('planilla_manual').select('*').eq('legajo', ef.legajo).eq('mes', MES).eq('anio', ANIO).eq('lugar', lugarDetectado),
      supabase.from('firmas').select('*').eq('legajo', ef.legajo).eq('mes', MES).eq('anio', ANIO),
      supabase.from('asistencia').select('*').eq('legajo', ef.legajo).eq('mes', MES).eq('anio', ANIO).eq('lugar', lugarDetectado)
    ])
    const manualMap = {}
    ;(manual || []).forEach(m => { manualMap[`${m.dia}-${m.horario}`] = m })
    setPlanillaManual(manualMap)
    let firmaObj = firmasData && firmasData[0] ? firmasData[0] : null
    if (!firmaObj?.firma_url && ef.firma_url) {
      const { data: newFirma } = await supabase.from('firmas').insert([{ legajo: ef.legajo, mes: MES, anio: ANIO, firma_url: ef.firma_url }]).select().single()
      firmaObj = newFirma || { firma_url: ef.firma_url }
    }
    setFirmas(prev => ({ ...prev, [ef.legajo]: firmaObj }))
    setPlanillaEf({ ...ef, asistencia: asist || [] })
    setCargandoPlanilla(false)
  }

  useEffect(() => {
    if (planillaEf) {
      const turnosEf = (turnos[planillaEf.legajo] || []).filter(t => SECTORES_APP.includes(t.sector)).sort((a,b) => a.dia - b.dia)
      const asist = planillaEf.asistencia || []
      const asistMap = {}
      asist.filter(a => turnosEf.some(t => t.dia === a.dia && t.turno === a.turno))
           .forEach(a => { asistMap[`${a.dia}-${a.turno}`] = a })
      const filas = Array.from({ length: DIAS_MES }, (_, i) => i + 1).map(dia => {
        const entradas = []
        TURNOS_INFO.forEach(ti => {
          const tEf = turnosEf.find(t => t.dia === dia && t.turno === ti.key)
          const pres = asistMap[`${dia}-${ti.key}`]
          const manualEntry = Object.values(planillaManual).find(m => parseInt(m.dia) === dia && m.horario === ti.horario)
          if (pres) entradas.push({ horario: ti.horario, horas: manualEntry ? parseInt(manualEntry.horas) : HORAS_TURNO, confirmado: true, manual: false, sector: tEf?.sector })
          else if (tEf) entradas.push({ horario: ti.horario, horas: HORAS_TURNO, confirmado: false, manual: false, sector: tEf?.sector })
        })
        Object.values(planillaManual).forEach(m => {
          if (parseInt(m.dia) === dia) {
            const yaExiste = entradas.find(e => e.horario === m.horario)
            if (!yaExiste) entradas.push({ horario: m.horario, horas: parseInt(m.horas) || 0, confirmado: false, manual: true, id: m.id })
            else { const entry = entradas.find(e => e.horario === m.horario); if (entry && !entry.confirmado && parseInt(m.horas) > 0) { entry.horas = parseInt(m.horas); entry.manual = true } }
          }
        })
        entradas.sort((a,b) => a.horario.localeCompare(b.horario))
        return { dia, entradas }
      })
      setFilasCache(filas)
    }
  }, [planillaEf, planillaManual, turnos])

  async function guardarHoraManual(legajo, dia, horario, horas, sector) {
    const key = `${dia}-${horario}`; const existe = planillaManual[key]
    if (horas === '' || horas === 0) {
      if (existe) { await supabase.from('planilla_manual').delete().eq('id', existe.id); const nuevo = { ...planillaManual }; delete nuevo[key]; setPlanillaManual(nuevo) }
      return
    }
    if (existe) await supabase.from('planilla_manual').update({ horas: parseInt(horas), sector }).eq('id', existe.id)
    else await supabase.from('planilla_manual').insert([{ legajo, mes: MES, anio: ANIO, dia: parseInt(dia), horario, horas: parseInt(horas), sector: sector || '', lugar: lugarDetectado }])
    const { data: fresh } = await supabase.from('planilla_manual').select('*').eq('legajo', legajo).eq('mes', MES).eq('anio', ANIO).eq('lugar', lugarDetectado)
    const newMap = {}; ;(fresh || []).forEach(m => { newMap[`${m.dia}-${m.horario}`] = m }); setPlanillaManual(newMap)
  }

  async function subirFirmaAdmin(legajo, file) {
    const reader = new FileReader()
    reader.onload = async (e) => {
      const base64 = e.target.result
      await supabase.from('efectivos').update({ firma_url: base64 }).eq('legajo', legajo)
      const existeFirma = firmas[legajo]
      if (existeFirma) await supabase.from('firmas').update({ firma_url: base64 }).eq('id', existeFirma.id)
      else await supabase.from('firmas').insert([{ legajo, mes: MES, anio: ANIO, firma_url: base64 }])
      setFirmas(prev => ({ ...prev, [legajo]: { ...prev[legajo], firma_url: base64 } }))
      setEfectivos(prev => prev.map(e => e.legajo === legajo ? { ...e, firma_url: base64 } : e))
    }
    reader.readAsDataURL(file)
  }

  async function eliminarFirmaAdmin(legajo) {
    await supabase.from('efectivos').update({ firma_url: null }).eq('legajo', legajo)
    const existeFirma = firmas[legajo]
    if (existeFirma) await supabase.from('firmas').update({ firma_url: null }).eq('id', existeFirma.id)
    setFirmas(prev => ({ ...prev, [legajo]: { ...prev[legajo], firma_url: null } }))
    setEfectivos(prev => prev.map(e => e.legajo === legajo ? { ...e, firma_url: null } : e))
  }

  if (!mounted || loading) return <div className="loading">Cargando...</div>

  const todosLosTurnos = Object.values(turnos).flat()
  const hayTurnos = todosLosTurnos.length > 0
  const cargaron = efectivos.filter(e => disponibilidad[e.legajo] && Object.keys(disponibilidad[e.legajo]).length > 0).length
  const nombreCompleto = leg => { const e = efectivos.find(x => x.legajo === leg); return e ? e.nombre : leg }
  const nombreCorto = leg => nombreCompleto(leg).split(',')[0]

  return (
    <div>
      {modalTurno && <ModalTurno turno={modalTurno} efectivos={efectivos} horasAsig={horasAsig} onClose={() => setModalTurno(null)} onGuardar={handleGuardarEdicion} onEliminar={handleEliminarTurno} onAgregar={handleAgregarTurno} diasMes={DIAS_MES} mes={MES} anio={ANIO} turnosDelDia={todosLosTurnos.filter(t => t.dia === (modalTurno.dia || filtroDia))} />}

      {modalAsignar && (
        <div style={{ position:'fixed',inset:0,background:'rgba(0,0,0,0.6)',zIndex:50,display:'flex',alignItems:'center',justifyContent:'center',padding:20 }}>
          <div style={{ background:'#13151f',borderRadius:12,border:`0.5px solid ${COLOR_APP}44`,width:'100%',maxWidth:440,overflow:'hidden' }}>
            <div style={{ padding:'14px 16px',borderBottom:`0.5px solid ${COLOR_APP}33`,display:'flex',justifyContent:'space-between',alignItems:'center',background:BG_APP }}>
              <h3 style={{ fontSize:14,fontWeight:500,color:COLOR_APP }}>⚡ Asignar guardias — {APP_LUGAR}</h3>
              <button className="btn btn-sm" onClick={() => setModalAsignar(null)}>Cerrar</button>
            </div>
            <div style={{ padding:16 }}>
              <div style={{ marginBottom:14 }}>
                <label style={{ fontSize:12,color:'var(--text-muted)',marginBottom:6,display:'block' }}>Efectivo</label>
                <select value={modalAsignar.legajo||''} onChange={e => setModalAsignar(prev => ({...prev,legajo:e.target.value}))} style={{ width:'100%',padding:'9px 11px',border:'0.5px solid rgba(255,255,255,0.12)',borderRadius:8,fontSize:13,background:'#1e2130',color:'#e8eaf0',outline:'none' }}>
                  <option value="">— Seleccionar efectivo —</option>
                  {efDisponibles.map(e => <option key={e.legajo} value={e.legajo}>{e.nombre} (Leg. {e.legajo})</option>)}
                </select>
              </div>
              <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:14 }}>
                <div>
                  <label style={{ fontSize:12,color:'var(--text-muted)',marginBottom:6,display:'block' }}>Cantidad de guardias</label>
                  <input type="number" min="1" max="31" value={modalAsignar.cantidad||''} onChange={e => setModalAsignar(prev => ({...prev,cantidad:parseInt(e.target.value)||''}))} placeholder="Ej: 9" style={{ width:'100%',padding:'9px 11px',border:'0.5px solid rgba(255,255,255,0.12)',borderRadius:8,fontSize:14,background:'#1e2130',color:'#e8eaf0',outline:'none',textAlign:'center' }} />
                </div>
                <div>
                  <label style={{ fontSize:12,color:'var(--text-muted)',marginBottom:6,display:'block' }}>Tipo de turno</label>
                  <select value={modalAsignar.tipoTurno||TURNOS_LUGAR[0]} onChange={e => setModalAsignar(prev => ({...prev,tipoTurno:e.target.value}))} style={{ width:'100%',padding:'9px 11px',border:'0.5px solid rgba(255,255,255,0.12)',borderRadius:8,fontSize:13,background:'#1e2130',color:'#e8eaf0',outline:'none' }}>
                    {TURNOS_INFO.map(ti => <option key={ti.key} value={ti.key}>{ti.label}</option>)}
                    <option value="mixto">Mixto alternado</option>
                    <option value="doble">Todos los turnos del día</option>
                  </select>
                </div>
              </div>
            </div>
            <div style={{ padding:'12px 16px',borderTop:'0.5px solid rgba(255,255,255,0.06)',display:'flex',justifyContent:'flex-end',gap:8 }}>
              <button className="btn btn-sm" onClick={() => setModalAsignar(null)}>Cancelar</button>
              <button className="btn btn-sm" disabled={!modalAsignar.legajo || !modalAsignar.cantidad || asignando} style={{ background:'rgba(200,168,75,0.15)',color:'#c8a84b',border:'0.5px solid rgba(200,168,75,0.4)' }} onClick={() => asignarGuardiasAuto(modalAsignar.legajo, modalAsignar.cantidad, modalAsignar.tipoTurno || TURNOS_LUGAR[0])}>
                {asignando ? 'Asignando...' : `⚡ Asignar ${modalAsignar.cantidad||0} guardias`}
              </button>
            </div>
          </div>
        </div>
      )}

      {modalPersonal && <ModalPersonal datos={modalPersonal} onClose={() => { setModalPersonal(null); setMsgPersonal(null) }} onGuardar={handleGuardarPersonal} onEliminar={handleEliminarPersonal} guardando={guardandoPersonal} msg={msgPersonal} />}

      <div className="topbar">
        <div style={{ display:'flex',alignItems:'center',gap:10 }}>
          <span style={{ fontSize:15,fontWeight:500 }}>Panel Admin — POLAD</span>
          <span style={{ background:BG_APP,color:COLOR_APP,fontSize:11,padding:'2px 8px',borderRadius:3,fontWeight:600,border:`0.5px solid ${COLOR_APP}66` }}>{APP_LUGAR}</span>
        </div>
        <div style={{ display:'flex',gap:6,flexWrap:'wrap' }}>
          {VISTAS.map(v => (
            <button key={v} className="btn btn-sm" style={{ fontWeight:vista===v?600:400,background:vista===v?'rgba(200,168,75,0.15)':'transparent',color:vista===v?'#c8a84b':'#8b90a0',border:vista===v?'0.5px solid rgba(200,168,75,0.6)':'0.5px solid rgba(255,255,255,0.1)' }} onClick={() => setVista(v)}>{LABELS[v]}</button>
          ))}
          <div style={{ display:'flex',alignItems:'center',gap:4,background:'rgba(255,255,255,0.05)',borderRadius:6,padding:'2px 6px',border:'0.5px solid rgba(255,255,255,0.1)' }}>
            <select value={mesSeleccionado} onChange={e => { setMesSeleccionado(parseInt(e.target.value)); setPlanillaEf(null) }} style={{ background:'transparent',border:'none',color:'#c8a84b',fontSize:12,fontWeight:500,outline:'none',cursor:'pointer' }}>
              {MESES_NOMBRES.map((m,i) => <option key={i+1} value={i+1} style={{ background:'#1a1d27' }}>{m}</option>)}
            </select>
            <select value={anioSeleccionado} onChange={e => { setAnioSeleccionado(parseInt(e.target.value)); setPlanillaEf(null) }} style={{ background:'transparent',border:'none',color:'#c8a84b',fontSize:12,fontWeight:500,outline:'none',cursor:'pointer' }}>
              {[ANIO_ACTUAL, ANIO_ACTUAL+1].map(a => <option key={a} value={a} style={{ background:'#1a1d27' }}>{a}</option>)}
            </select>
          </div>
          <button className="btn btn-sm" style={{ background:'rgba(200,168,75,0.15)',color:'#c8a84b',border:'0.5px solid rgba(200,168,75,0.4)' }} onClick={() => router.push('/control')}>Control asistencia</button>
          <button className="btn btn-sm" style={{ color:'#8b90a0' }} onClick={() => { localStorage.removeItem('polad_user'); router.push('/') }}>Salir</button>
        </div>
      </div>

      <div className="content">
        <div style={{ display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:10,marginBottom:16 }}>
          <div className="metric"><div className="metric-label">Efectivos en {APP_LUGAR}</div><div className="metric-val">{efectivos.length}</div><div className="metric-sub">en el sistema</div></div>
          <div className="metric"><div className="metric-label">Cargaron disponib.</div><div className="metric-val">{cargaron}</div><div className="metric-sub">de {efectivos.length}</div></div>
          <div className="metric"><div className="metric-label">Turnos asignados</div><div className="metric-val">{todosLosTurnos.length}</div><div className="metric-sub">{NOMBRE_MES}</div></div>
          <div className="metric"><div className="metric-label">Estado</div><div className="metric-val" style={{ fontSize:13,marginTop:4,color:hayTurnos?'#1D9E75':'#8b90a0' }}>{hayTurnos?'Generado':'Sin generar'}</div><div className="metric-sub">{NOMBRE_MES}</div></div>
        </div>

        <div style={{ display:'flex',justifyContent:'flex-end',marginBottom:12 }}>
          <button className="btn btn-sm" style={{ background:'rgba(200,168,75,0.15)',color:'#c8a84b',border:'0.5px solid rgba(200,168,75,0.4)',display:'flex',alignItems:'center',gap:6 }}
            onClick={async () => {
              const url = `/api/resumen-guardias?mes=${MES}&anio=${ANIO}&lugar=${lugarDetectado}`
              const res = await fetch(url); if (!res.ok) { alert('Error'); return }
              const blob = await res.blob(); const a = document.createElement('a')
              a.href = URL.createObjectURL(blob); a.download = `Resumen_${APP_LUGAR}_${NOMBRE_MES.replace(' ','_')}.xlsx`; a.click(); URL.revokeObjectURL(a.href)
            }}>📄 Descargar resumen</button>
        </div>

        {vista === 'resumen' && (() => {
          const uniformados = efectivos.filter(e => e.tipo === 'Uniformado')
          const servGeneral = efectivos.filter(e => e.tipo === 'Serv. General')
          const destacamento = efectivos.filter(e => e.tipo === 'Destacamento')
          const renderGrupo = lista => lista.map(e => {
            const dias = Object.keys(disponibilidad[e.legajo] || {}).length
            const hs = horasAsig[e.legajo] || 0
            const pct = Math.round(hs / 180 * 100)
            const color = pct >= 100 ? '#E24B4A' : pct >= 80 ? '#EF9F27' : '#1D9E75'
            return (
              <div key={e.legajo} style={{ border:'0.5px solid var(--border)',borderRadius:8,padding:'10px 12px',background:'var(--surface2)' }}>
                <div style={{ display:'flex',justifyContent:'space-between' }}>
                  <div>
                    <div style={{ fontSize:12,fontWeight:500 }}>{e.nombre}</div>
                    <div style={{ fontSize:10,color:'var(--text-muted)',marginTop:2 }}>Leg. {e.legajo}</div>
                  </div>
                  <div style={{ textAlign:'right' }}>
                    <div style={{ fontSize:16,fontWeight:500,color }}>{hs}</div>
                    <div style={{ fontSize:9,color:COLOR_APP }}>{APP_LUGAR}</div>
                  </div>
                </div>
                {hs > 0 && <div style={{ display:'flex',gap:4,marginTop:3 }}><span style={{ fontSize:9,padding:'1px 5px',borderRadius:3,background:`${COLOR_APP}22`,color:COLOR_APP,border:`0.5px solid ${COLOR_APP}44` }}>{APP_LUGAR} {hs}hs</span></div>}
                <div style={{ marginTop:6,fontSize:11,color:dias>0?'#1D9E75':'#EF9F27' }}>{dias>0?`${dias} días cargados`:'Sin disponibilidad'}</div>
                <div className="hbar" style={{ width:'100%',marginTop:4 }}><div className="hfill" style={{ width:`${Math.min(pct,100)}%`,background:color }}></div></div>
              </div>
            )
          })
          return (
            <div>
              <div className="panel" style={{ marginBottom:16 }}>
                <div className="panel-header" style={{ background:BG_APP }}><h3 style={{ color:COLOR_APP }}>Uniformados — {uniformados.length} efectivos</h3></div>
                <div style={{ padding:14,display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(210px,1fr))',gap:8 }}>{renderGrupo(uniformados)}</div>
              </div>
              <div className="panel">
                <div className="panel-header" style={{ background:'rgba(13,51,40,0.5)' }}><h3 style={{ color:'#5DCAA5' }}>Servicio General — {servGeneral.length} efectivos</h3></div>
                <div style={{ padding:14,display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(210px,1fr))',gap:8 }}>{renderGrupo(servGeneral)}</div>
              </div>
              {destacamento.length > 0 && (
                <div className="panel" style={{ marginTop:16 }}>
                  <div className="panel-header" style={{ background:'rgba(80,70,0,0.4)' }}><h3 style={{ color:'#F5C518' }}>Destacamento — {destacamento.length} efectivos</h3></div>
                  <div style={{ padding:14,display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(210px,1fr))',gap:8 }}>{renderGrupo(destacamento)}</div>
                </div>
              )}
            </div>
          )
        })()}

        {vista === 'personal' && (() => {
          const uniformados = efectivos.filter(e => e.tipo === 'Uniformado')
          const servGeneral = efectivos.filter(e => e.tipo === 'Serv. General')
          const destacamento = efectivos.filter(e => e.tipo === 'Destacamento')
          const renderFichas = lista => lista.map(e => {
            const hs = horasAsig[e.legajo] || 0
            const pct = Math.round(hs / 180 * 100)
            const color = pct >= 100 ? '#E24B4A' : pct >= 80 ? '#EF9F27' : '#1D9E75'
            const turnosEf = turnos[e.legajo] || []
            const iniciales = e.nombre.split(',').map(p => p.trim()[0]).join('').toUpperCase().slice(0, 2)
            return (
              <div key={e.legajo} className="card" style={{ padding:0,overflow:'hidden',cursor:'pointer' }} onClick={() => { setMsgPersonal(null); setModalPersonal({ ...e }) }}>
                <div style={{ padding:'12px 14px',borderBottom:'0.5px solid rgba(255,255,255,0.06)',display:'flex',alignItems:'center',gap:12 }}>
                  <div style={{ width:40,height:40,borderRadius:'50%',background:'rgba(200,168,75,0.15)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:13,fontWeight:500,color:'#c8a84b',flexShrink:0 }}>{iniciales}</div>
                  <div style={{ flex:1,minWidth:0 }}>
                    <div style={{ fontWeight:500,fontSize:12,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',display:'flex',alignItems:'center',gap:5 }}>
                      {e.nombre}{e.notas && <span title={e.notas} style={{ fontSize:13,cursor:'help' }}>📝</span>}
                    </div>
                    <div style={{ fontSize:10,color:'var(--text-muted)',marginTop:2 }}>Leg. {e.legajo} · {e.jerarquia || e.tipo}</div>
                  </div>
                  <div style={{ textAlign:'right',flexShrink:0 }}>
                    <div style={{ fontSize:18,fontWeight:500,color,lineHeight:1 }}>{hs}</div>
                    <div style={{ fontSize:9,color:COLOR_APP }}>{APP_LUGAR}</div>
                  </div>
                </div>
                <div style={{ height:4,background:'rgba(255,255,255,0.05)',overflow:'hidden' }}>
                  <div style={{ height:'100%',width:`${Math.min(pct,100)}%`,background:color }}></div>
                </div>
                <div style={{ padding:'10px 14px' }}>
                  <div style={{ display:'grid',gridTemplateColumns:`repeat(${TURNOS_INFO.length},1fr)`,gap:6,marginBottom:10 }}>
                    {TURNOS_INFO.map(ti => {
                      const count = turnosEf.filter(t => t.turno === ti.key).length
                      return (
                        <div key={ti.key} style={{ background:`${ti.color}18`,borderRadius:6,padding:'6px 8px',border:`0.5px solid ${ti.color}33` }}>
                          <div style={{ fontSize:8,color:ti.color,marginBottom:1 }}>{ti.label.split(' ')[0]}</div>
                          <div style={{ fontSize:16,fontWeight:500,color:ti.color }}>{count}</div>
                          <div style={{ fontSize:9,color:'var(--text-muted)' }}>{count * HORAS_TURNO} hs</div>
                        </div>
                      )
                    })}
                    {turnosEf.length === 0 && <div style={{ gridColumn:'1/-1',fontSize:11,color:'var(--text-hint)',fontStyle:'italic' }}>Sin guardias asignadas</div>}
                  </div>
                  {e.telefono && turnosEf.length > 0 && (
                    <a href={(() => {
                      const tel = '549' + e.telefono.replace(/\D/g,'')
                      const jerarquia = e.jerarquia ? e.jerarquia + ' ' : ''
                      const nombreFormateado = e.nombre.split(',').map(p => p.trim()).reverse().join(' ')
                      const ts = [...turnosEf].sort((a,b) => a.dia - b.dia)
                      const subtotal = ts.length * HORAS_TURNO
                      const lineas = ts.map(t => { const ti = TURNOS_INFO.find(x=>x.key===t.turno); return `   %E2%80%A2 D%C3%ADa ${t.dia} %E2%80%94 ${encodeURIComponent(ti?.horario||t.turno)} hs %E2%80%94 ${encodeURIComponent(t.sector)}` }).join('%0A')
                      const msg = `Estimado%2Fa ${encodeURIComponent(jerarquia + nombreFormateado)}%3A%0A%0ASe le comunica el cronograma POLAD *${APP_LUGAR}* para *${encodeURIComponent(NOMBRE_MES.toUpperCase())}*%3A%0A%0A${lineas}%0A%0A%E2%9C%85 *Total: ${subtotal} hs*%0A%0A_Crio. Paulo Corbela_%0A_POLAD %C2%B7 ${APP_LUGAR} %C2%B7 Mar del Plata_`
                      return `https://wa.me/${tel}?text=${msg}`
                    })()} target="_blank" rel="noopener noreferrer" onClick={ev=>ev.stopPropagation()}
                    style={{ display:'flex',alignItems:'center',justifyContent:'center',gap:6,padding:'6px 10px',borderRadius:6,border:'0.5px solid rgba(37,211,102,0.4)',background:'rgba(37,211,102,0.08)',color:'#25D366',fontSize:11,fontWeight:500,textDecoration:'none' }}>
                      <span>📱</span> Enviar guardias por WhatsApp
                    </a>
                  )}
                </div>
              </div>
            )
          })
          return (
            <div>
              <div style={{ display:'flex',justifyContent:'flex-end',marginBottom:12 }}>
                <button className="btn btn-sm" style={{ background:'rgba(200,168,75,0.15)',color:'#c8a84b',border:'0.5px solid rgba(200,168,75,0.4)' }} onClick={() => { setMsgPersonal(null); setModalPersonal({ legajo:'',nombre:'',tipo:'Uniformado',email:'',sector:'Sin asignar',lugar:APP_LUGAR }) }}>+ Dar de alta efectivo</button>
              </div>
              <div className="panel" style={{ marginBottom:16 }}>
                <div className="panel-header" style={{ background:BG_APP }}><h3 style={{ color:COLOR_APP }}>Uniformados — {uniformados.length} efectivos</h3></div>
                <div style={{ padding:14,display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))',gap:10 }}>{renderFichas(uniformados)}</div>
              </div>
              <div className="panel">
                <div className="panel-header" style={{ background:'rgba(13,51,40,0.5)' }}><h3 style={{ color:'#5DCAA5' }}>Servicio General — {servGeneral.length} efectivos</h3></div>
                <div style={{ padding:14,display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))',gap:10 }}>{renderFichas(servGeneral)}</div>
              </div>
              {destacamento.length > 0 && (
                <div className="panel" style={{ marginTop:16 }}>
                  <div className="panel-header" style={{ background:'rgba(80,70,0,0.4)' }}><h3 style={{ color:'#F5C518' }}>Destacamento — {destacamento.length} efectivos</h3></div>
                  <div style={{ padding:14,display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))',gap:10 }}>{renderFichas(destacamento)}</div>
                </div>
              )}
            </div>
          )
        })()}

        {vista === 'disponibilidad' && (
          <div>
            <div className="panel">
              <div className="panel-header">
                <h3>Disponibilidad cargada — {APP_LUGAR} · {NOMBRE_MES}</h3>
                <span style={{ fontSize:11, color:'var(--text-muted)' }}>
                  {efectivos.filter(e => Object.keys(disponibilidad[e.legajo]||{}).length > 0).length} de {efectivos.length} cargaron
                </span>
              </div>
              <div style={{ padding:14 }}>
                <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(220px,1fr))', gap:8 }}>
                  {efectivos.map(e => {
                    const dias = disponibilidad[e.legajo] || {}
                    const cantDias = Object.keys(dias).length
                    const cargo = cantDias > 0
                    const seleccionado = efDetalle === e.legajo
                    // Contar por turno
                    const conteosTurno = {}
                    TURNOS_LUGAR.forEach(tk => { conteosTurno[tk] = Object.values(dias).filter(d => d.turno && d.turno.includes(tk)).length })
                    return (
                      <div key={e.legajo}>
                        <div
                          onClick={() => setEfectivoDetalle(seleccionado ? null : e.legajo)}
                          style={{
                            padding:'10px 12px',
                            borderRadius: seleccionado ? '8px 8px 0 0' : 8,
                            border: seleccionado ? '0.5px solid #c8a84b' : `0.5px solid ${cargo ? 'rgba(29,158,117,0.4)' : 'rgba(255,255,255,0.08)'}`,
                            background: seleccionado ? 'rgba(200,168,75,0.1)' : cargo ? 'rgba(29,158,117,0.06)' : 'var(--surface2)',
                            cursor:'pointer',
                            display:'flex', justifyContent:'space-between', alignItems:'center',
                          }}
                        >
                          <div>
                            <div style={{ fontSize:12, fontWeight:500, color: cargo ? 'var(--text)' : 'var(--text-muted)' }}>{e.nombre}</div>
                            <div style={{ fontSize:10, color:'var(--text-muted)', marginTop:2 }}>Leg. {e.legajo}</div>
                          </div>
                          <div style={{ textAlign:'right', flexShrink:0, marginLeft:8 }}>
                            {cargo ? (
                              <div style={{ display:'flex', gap:4, alignItems:'center', flexWrap:'wrap' }}>
                                {TURNOS_INFO.map(ti => conteosTurno[ti.key] > 0 && (
                                  <span key={ti.key} style={{ fontSize:10, padding:'1px 6px', borderRadius:3, background:`${ti.bg}`, color:ti.color, border:`0.5px solid ${ti.color}44` }}>{ti.key.toUpperCase()}:{conteosTurno[ti.key]}</span>
                                ))}
                              </div>
                            ) : (
                              <span style={{ fontSize:10, color:'#E24B4A' }}>Sin cargar</span>
                            )}
                          </div>
                        </div>
                        {seleccionado && cargo && (
                          <div style={{ border:'0.5px solid #c8a84b', borderTop:'none', borderRadius:'0 0 8px 8px', padding:'10px 12px', background:'rgba(200,168,75,0.05)' }}>
                            <div style={{ fontSize:10, color:'#c8a84b', marginBottom:8, fontWeight:500 }}>{cantDias} días cargados</div>
                            <div style={{ display:'flex', flexWrap:'wrap', gap:4 }}>
                              {Array.from({ length: DIAS_MES }, (_, i) => i + 1).map(dia => {
                                const entry = dias[dia]
                                if (!entry) return (
                                  <span key={dia} style={{ display:'inline-flex', alignItems:'center', justifyContent:'center', width:28, height:28, borderRadius:4, background:'var(--surface2)', fontSize:10, color:'var(--text-hint)', border:'0.5px solid rgba(255,255,255,0.05)' }}>{dia}</span>
                                )
                                const v = entry.turno
                                const allTurnos = v && v.length >= TURNOS_LUGAR.length
                                const bg = allTurnos ? 'rgba(29,158,117,0.2)' : (() => { const ti = TURNOS_INFO.find(x => v && v.includes(x.key)); return ti ? ti.bg : 'rgba(133,183,235,0.2)' })()
                                const color = allTurnos ? '#5DCAA5' : (() => { const ti = TURNOS_INFO.find(x => v && v.includes(x.key)); return ti ? ti.color : '#85B7EB' })()
                                const label = allTurnos ? 'A' : v ? v.toUpperCase() : '?'
                                return (
                                  <span key={dia} style={{ display:'inline-flex', flexDirection:'column', alignItems:'center', justifyContent:'center', width:28, height:32, borderRadius:4, background:bg, fontSize:9, color, border:`0.5px solid ${color}55`, fontWeight:600 }}>
                                    <span style={{ fontSize:8, fontWeight:400, opacity:0.8 }}>{dia}</span>
                                    <span>{label}</span>
                                  </span>
                                )
                              })}
                            </div>
                            <div style={{ marginTop:8, fontSize:10, color:'var(--text-muted)', display:'flex', gap:12, flexWrap:'wrap' }}>
                              {TURNOS_INFO.map(ti => <span key={ti.key} style={{ color:ti.color }}>{ti.key.toUpperCase()} = {ti.label.split(' ')[0]}</span>)}
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          </div>
        )}

        {vista === 'turnos' && (
          <div>
            {msgGen && <div className="alert alert-ok">{msgGen}</div>}
            {!hayTurnos && !msgGen && <div className="alert alert-warn">{cargaron} de {efectivos.length} efectivos cargaron disponibilidad.</div>}
            <div style={{ textAlign:'center',padding:'20px 0 16px' }}>
              <button className="btn btn-success" onClick={generarTurnos} disabled={generando}>{generando?'Generando...':hayTurnos?'Regenerar turnos':'Generar turnos automáticamente'}</button>
              <p style={{ fontSize:11,color:'var(--text-muted)',marginTop:6 }}>Solo genera turnos para {APP_LUGAR}</p>
            </div>
            {hayTurnos && (
              <div className="panel">
                <div className="panel-header"><h3>Cronograma {APP_LUGAR} — {NOMBRE_MES}</h3></div>
                <div style={{ overflowX:'auto' }}>
                  <table style={{ tableLayout:'fixed',width:'max-content',minWidth:'100%' }}>
                    <thead>
                      <tr>
                        <th style={{ width:130 }}>Sector</th>
                        {Array.from({ length:DIAS_MES },(_,i) => <th key={i} style={{ width:76,textAlign:'center',padding:'8px 3px' }}>{i+1}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {SECTORES_APP.map(sector => (
                        <tr key={sector}>
                          <td><span style={{ display:'inline-flex',alignItems:'center',gap:4,fontSize:11 }}><span className="dot" style={{ background:SEC_COLORS[sector] }}></span>{sector}</span></td>
                          {Array.from({ length:DIAS_MES },(_,i) => {
                            const dia = i+1
                            return <td key={i} style={{ padding:'3px',fontSize:10,verticalAlign:'top' }}>
                              {TURNOS_INFO.map(ti => {
                                const list = todosLosTurnos.filter(t=>t.dia===dia&&t.turno===ti.key&&t.sector===sector)
                                return <div key={ti.key} style={{ color:ti.color,marginBottom:1 }}>{list.map(t=>nombreCorto(t.legajo)).join(', ')||'—'}</div>
                              })}
                            </td>
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {vista === 'edicion' && (
          <div>
            <div style={{ display:'flex',alignItems:'center',gap:8,marginBottom:16,flexWrap:'wrap' }}>
              <span style={{ fontSize:12,color:'var(--text-muted)' }}>Día:</span>
              <div style={{ display:'flex',gap:3,flexWrap:'wrap' }}>
                {Array.from({ length:DIAS_MES },(_,i) => i+1).map(d => (
                  <button key={d} className="btn btn-sm" style={{ minWidth:32,padding:'4px 6px',fontSize:11,background:d===filtroDia?'rgba(200,168,75,0.15)':'transparent',color:d===filtroDia?'#c8a84b':'var(--text-muted)',border:d===filtroDia?'0.5px solid rgba(200,168,75,0.6)':'0.5px solid rgba(255,255,255,0.1)' }} onClick={() => setFiltroDia(d)}>{d}</button>
                ))}
              </div>
            </div>
            <div style={{ marginBottom:12,display:'flex',justifyContent:'space-between',alignItems:'center' }}>
              <h3 style={{ fontSize:14,fontWeight:500 }}>Día {filtroDia} — {NOMBRE_MES} — {APP_LUGAR}</h3>
              <div style={{ display:'flex',gap:8 }}>
                <button className="btn btn-primary btn-sm" onClick={() => setModalTurno({ dia:filtroDia,sector:SECTORES_APP[0],turno:TURNOS_LUGAR[0],legajo:'' })}>+ Agregar turno</button>
              </div>
            </div>
            <div style={{ display:'grid',gridTemplateColumns:'1fr 240px',gap:12 }}>
              <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,alignContent:'start' }}>
                {SECTORES_APP.map(sector => {
                  return (
                    <div key={sector} style={{ background:'var(--surface)',border:'0.5px solid var(--border)',borderRadius:10,overflow:'hidden' }}>
                      <div style={{ padding:'8px 12px',background:'var(--surface2)',borderBottom:'0.5px solid var(--border)',display:'flex',alignItems:'center',gap:6 }}>
                        <span className="dot" style={{ background:SEC_COLORS[sector] }}></span>
                        <span style={{ fontSize:12,fontWeight:500 }}>{sector}</span>
                      </div>
                      <div style={{ padding:10 }}>
                        {TURNOS_INFO.map((ti, idx) => {
                          const list = todosLosTurnos.filter(t=>t.dia===filtroDia&&t.turno===ti.key&&t.sector===sector)
                          return (
                            <div key={ti.key} style={{ marginBottom:idx<TURNOS_INFO.length-1?8:0,paddingBottom:idx<TURNOS_INFO.length-1?8:0,borderBottom:idx<TURNOS_INFO.length-1?'0.5px solid var(--border)':'' }}>
                              <div style={{ fontSize:10,color:ti.color,fontWeight:500,marginBottom:5 }}>{ti.label.toUpperCase()}</div>
                              {list.length===0 && <div style={{ display:'flex',alignItems:'center',gap:6 }}><span style={{ fontSize:11,color:'var(--text-hint)',fontStyle:'italic' }}>Sin cubrir</span><button className="btn btn-sm" style={{ fontSize:10,padding:'2px 8px',color:ti.color,borderColor:`${ti.color}66` }} onClick={() => setModalTurno({ dia:filtroDia,sector,turno:ti.key,legajo:'' })}>+ Asignar</button></div>}
                              {list.map(item => (
                                <div key={item.id} style={{ display:'flex',alignItems:'center',justifyContent:'space-between',padding:'4px 8px',background:ti.bg,borderRadius:6,marginBottom:3 }}>
                                  <span style={{ fontSize:12,fontWeight:500 }}>{nombreCompleto(item.legajo)}</span>
                                  <div style={{ display:'flex',gap:4 }}>
                                    <button className="btn btn-sm" style={{ fontSize:10,padding:'2px 6px' }} onClick={() => setModalTurno(item)}>Cambiar</button>
                                    <button className="btn btn-sm" style={{ fontSize:10,padding:'2px 6px',color:'#F09595',borderColor:'rgba(240,149,149,0.3)' }} onClick={() => handleEliminarTurno(item)}>✕</button>
                                  </div>
                                </div>
                              ))}
                              {list.length>0&&list.length<MAX_POR_SLOT && <button className="btn btn-sm" style={{ fontSize:10,padding:'2px 8px',marginTop:3,color:ti.color,borderColor:`${ti.color}55` }} onClick={() => setModalTurno({ dia:filtroDia,sector,turno:ti.key,legajo:'' })}>+ Agregar</button>}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
              <div style={{ background:'var(--surface)',border:'0.5px solid var(--border)',borderRadius:10,overflow:'hidden',height:'fit-content',position:'sticky',top:16 }}>
                <div style={{ padding:'10px 14px',background:'var(--surface2)',borderBottom:'0.5px solid var(--border)' }}>
                  <div style={{ fontSize:13,fontWeight:500,marginBottom:2 }}>Disponibles — Día {filtroDia}</div>
                </div>
                {(() => {
                  const dispDatos = dispDelDia.dia === filtroDia ? dispDelDia.data : []
                  const dispDia = dispDatos.map(d => { const ef = efectivos.find(e => e.legajo===d.legajo); if (!ef) return null; return { ...ef, disp:d.turno, hs:horasAsig[ef.legajo]||0 } }).filter(Boolean)

                  return (
                    <div>
                      {TURNOS_INFO.map(ti => {
                        const yaAsignados = new Set(todosLosTurnos.filter(t => t.dia===filtroDia&&t.turno===ti.key).map(t => t.legajo))
                        const ocupSlots = {}
                        todosLosTurnos.filter(t => t.dia===filtroDia&&t.turno===ti.key).forEach(t => { ocupSlots[t.sector]=(ocupSlots[t.sector]||0)+1 })
                        const hayLugar = SECTORES_APP.some(s => (ocupSlots[s]||0) < MAX_POR_SLOT)
                        const dispTurno = dispDia.filter(e => e.disp && e.disp.includes(ti.key) && !yaAsignados.has(e.legajo) && e.hs<180 && hayLugar)
                        return (
                          <div key={ti.key} style={{ padding:'8px 12px 4px' }}>
                            <div style={{ fontSize:10,fontWeight:500,color:ti.color,marginBottom:6,paddingBottom:4,borderBottom:'0.5px solid var(--border)' }}>{ti.label} — {dispTurno.length}</div>
                            {dispTurno.length===0?<div style={{ fontSize:11,color:'var(--text-hint)',fontStyle:'italic',paddingBottom:6 }}>Sin disponibilidad</div>:dispTurno.map(e => {
                              const pct = Math.round(e.hs/180*100)
                              const colorHs = pct>=100?'#E24B4A':pct>=80?'#EF9F27':'#1D9E75'
                              return (
                                <div key={e.legajo} style={{ display:'flex',alignItems:'center',justifyContent:'space-between',padding:'6px 0',borderBottom:'0.5px solid var(--border)',cursor:'pointer' }} onClick={() => setModalTurno({ dia:filtroDia,sector:SECTORES_APP[0],turno:ti.key,legajo:e.legajo })}>
                                  <div style={{ flex:1,minWidth:0 }}>
                                    <div style={{ fontSize:11,fontWeight:500,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' }}>{e.nombre.split(',')[0]}</div>
                                    <div style={{ fontSize:9,color:colorHs,marginTop:2 }}>{e.hs} hs</div>
                                  </div>
                                  <span style={{ fontSize:10,padding:'1px 6px',borderRadius:3,background:ti.bg,color:ti.color,flexShrink:0,marginLeft:6 }}>{ti.key.toUpperCase()}</span>
                                </div>
                              )
                            })}
                          </div>
                        )
                      })}
                      <div style={{ padding:'8px 12px',borderTop:'0.5px solid var(--border)' }}>
                        <button className="btn btn-sm" style={{ width:'100%',justifyContent:'center',fontSize:11,background:'rgba(200,168,75,0.1)',color:'#c8a84b',border:'0.5px solid rgba(200,168,75,0.3)' }}
                          onClick={async () => {
                            const { data } = await supabase.from('disponibilidad').select('legajo').eq('mes',MES).eq('anio',ANIO).eq('lugar',lugarDetectado)
                            const legajos = new Set((data||[]).map(d=>d.legajo))
                            setEfDisponibles(efectivos.filter(e=>legajos.has(e.legajo)))
                            setModalAsignar({ legajo:'', cantidad:'', tipoTurno:TURNOS_LUGAR[0] })
                          }}>⚡ Asignar guardias rápido</button>
                      </div>
                    </div>
                  )
                })()}
              </div>
            </div>
          </div>
        )}

        {vista === 'config' && (() => {
          const uniformados = efectivos.filter(e => e.tipo === 'Uniformado')
          const servGeneral = efectivos.filter(e => e.tipo === 'Serv. General')
          const hsU = Math.round(config.totalHoras * config.pctUniformados / 100)
          const hsG = Math.round(config.totalHoras * config.pctGeneral / 100)
          const maxU = uniformados.length ? Math.min(180, Math.round(hsU / uniformados.length)) : 0
          const maxG = servGeneral.length ? Math.min(180, Math.round(hsG / servGeneral.length)) : 0
          return (
            <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:16 }}>
              <div className="panel">
                <div className="panel-header"><h3>Horas otorgadas — {APP_LUGAR}</h3></div>
                <div style={{ padding:16 }}>
                  <div style={{ marginBottom:16 }}>
                    <label style={{ fontSize:12,color:'var(--text-muted)',marginBottom:6,display:'block' }}>Total de horas del mes</label>
                    <input type="number" value={config.totalHoras} min="0" onChange={e => setConfig({...config,totalHoras:parseInt(e.target.value)||0})} style={{ width:'100%',padding:'10px 12px',border:`0.5px solid ${COLOR_APP}66`,borderRadius:8,fontSize:18,fontWeight:500,background:'#1e2130',color:COLOR_APP,outline:'none',textAlign:'center' }} />
                  </div>
                  <div style={{ marginBottom:12 }}>
                    <label style={{ fontSize:12,color:'#AFA9EC',marginBottom:6,display:'block' }}>% Uniformados — {config.pctUniformados}%</label>
                    <input type="range" min="0" max="100" value={config.pctUniformados} onChange={e => { const v=parseInt(e.target.value); setConfig({...config,pctUniformados:v,pctGeneral:100-v}) }} style={{ width:'100%',accentColor:'#AFA9EC' }} />
                  </div>
                  <div style={{ marginBottom:16 }}>
                    <label style={{ fontSize:12,color:'#5DCAA5',marginBottom:6,display:'block' }}>% Serv. General — {config.pctGeneral}%</label>
                    <input type="range" min="0" max="100" value={config.pctGeneral} onChange={e => { const v=parseInt(e.target.value); setConfig({...config,pctGeneral:v,pctUniformados:100-v}) }} style={{ width:'100%',accentColor:'#5DCAA5' }} />
                  </div>
                  <div style={{ marginBottom:16,background:'rgba(255,255,255,0.03)',borderRadius:8,padding:12,border:'0.5px solid rgba(255,255,255,0.08)' }}>
                    <div style={{ fontSize:12,fontWeight:500,marginBottom:8,color:COLOR_APP }}>Ventana de inscripción — {APP_LUGAR}</div>
                    <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8 }}>
                      <div>
                        <label style={{ fontSize:11,color:'var(--text-muted)',display:'block',marginBottom:4 }}>Día</label>
                        <input type="number" min="1" max="31" placeholder="Ej: 20" value={ventanas.dia} onChange={e => setVentanas(prev => ({...prev,dia:e.target.value}))} style={{ width:'100%',padding:'7px 10px',border:'0.5px solid rgba(255,255,255,0.12)',borderRadius:6,fontSize:13,background:'#1e2130',color:'#e8eaf0',outline:'none' }} />
                      </div>
                      <div>
                        <label style={{ fontSize:11,color:'var(--text-muted)',display:'block',marginBottom:4 }}>Hora inicio</label>
                        <input type="time" value={ventanas.horaInicio} onChange={e => setVentanas(prev => ({...prev,horaInicio:e.target.value}))} style={{ width:'100%',padding:'7px 10px',border:'0.5px solid rgba(255,255,255,0.12)',borderRadius:6,fontSize:13,background:'#1e2130',color:'#e8eaf0',outline:'none' }} />
                      </div>
                      <div>
                        <label style={{ fontSize:11,color:'var(--text-muted)',display:'block',marginBottom:4 }}>Hora fin</label>
                        <input type="time" value={ventanas.horaFin} onChange={e => setVentanas(prev => ({...prev,horaFin:e.target.value}))} style={{ width:'100%',padding:'7px 10px',border:'0.5px solid rgba(255,255,255,0.12)',borderRadius:6,fontSize:13,background:'#1e2130',color:'#e8eaf0',outline:'none' }} />
                      </div>
                    </div>
                    <div style={{ marginTop:8,fontSize:10,color:'var(--text-muted)' }}>{ventanas.dia?`Inscripción el día ${ventanas.dia} de ${NOMBRE_MES_SOLO} de ${ventanas.horaInicio} a ${ventanas.horaFin}`:'Sin ventana — inscripción bloqueada'}</div>
                  </div>
                  <button className="btn" style={{ width:'100%',justifyContent:'center',background:'rgba(200,168,75,0.15)',color:'#c8a84b',border:'0.5px solid rgba(200,168,75,0.4)' }} onClick={() => { localStorage.setItem(`polad_ventanas_${APP_LUGAR}`, JSON.stringify(ventanas)); setVentanasGuardadas(true); setTimeout(()=>setVentanasGuardadas(false),2500) }}>Guardar configuración</button>
                  {ventanasGuardadas && <div className="alert alert-ok" style={{ marginTop:10,textAlign:'center' }}>Configuración guardada.</div>}
                </div>
              </div>
              <div className="panel">
                <div className="panel-header"><h3>Distribución estimada</h3></div>
                <div style={{ padding:16 }}>
                  <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:10 }}>
                    <div style={{ background:'rgba(42,37,96,0.4)',borderRadius:8,padding:'12px',border:'0.5px solid rgba(175,169,236,0.2)' }}>
                      <div style={{ fontSize:10,color:'#AFA9EC',marginBottom:4 }}>UNIFORMADOS</div>
                      <div style={{ fontSize:20,fontWeight:500,color:'#AFA9EC' }}>{hsU} hs</div>
                      <div style={{ fontSize:11,color:'var(--text-muted)',marginTop:2 }}>{uniformados.length} efectivos</div>
                      <div style={{ fontSize:11,color:'#AFA9EC',marginTop:4,fontWeight:500 }}>Hasta {maxU} hs c/u</div>
                    </div>
                    <div style={{ background:'rgba(13,51,40,0.4)',borderRadius:8,padding:'12px',border:'0.5px solid rgba(93,202,165,0.2)' }}>
                      <div style={{ fontSize:10,color:'#5DCAA5',marginBottom:4 }}>SERV. GENERAL</div>
                      <div style={{ fontSize:20,fontWeight:500,color:'#5DCAA5' }}>{hsG} hs</div>
                      <div style={{ fontSize:11,color:'var(--text-muted)',marginTop:2 }}>{servGeneral.length} efectivos</div>
                      <div style={{ fontSize:11,color:'#5DCAA5',marginTop:4,fontWeight:500 }}>Hasta {maxG} hs c/u</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )
        })()}

        {vista === 'planillas' && (() => {
          const NOMBRE_MES_P = MESES_NOMBRES[MES-1] + ' ' + ANIO
          return (
            <div>
              {!planillaEf ? (
                <div>
                  <div style={{ display:'flex',justifyContent:'flex-end',marginBottom:10 }}>
                    <button className="btn btn-sm" style={{ background:'rgba(29,158,117,0.15)',color:'#1D9E75',border:'0.5px solid rgba(29,158,117,0.4)',display:'flex',alignItems:'center',gap:6 }}
                      onClick={async () => {
                        try {
                          if (!window.JSZip) { await new Promise((res,rej) => { const s=document.createElement('script'); s.src='https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'; s.onload=res; s.onerror=rej; document.head.appendChild(s) }) }
                          const { data: asist } = await supabase.from('asistencia').select('legajo').eq('mes',MES).eq('anio',ANIO).eq('lugar',lugarDetectado)
                          if (!asist||asist.length===0) { alert('No hay asistencias confirmadas para ' + lugarDetectado); return }
                          const legajosConAsist = [...new Set(asist.map(a=>a.legajo))]
                          const efConAsist = efectivos.filter(e=>legajosConAsist.includes(e.legajo))
                          if (efConAsist.length===0) { alert('No hay efectivos con asistencia confirmada'); return }
                          const zip = new window.JSZip(); const carpeta = zip.folder('Planillas_'+NOMBRE_MES.replace(' ','_')); let generadas = 0
                          for (const ef of efConAsist) {
                            try {
                              const url = '/api/planilla-efectivo?legajo='+ef.legajo+'&mes='+MES+'&anio='+ANIO+'&lugar='+lugarDetectado
                              const resp = await fetch(url); if (!resp.ok) continue
                              const blob = await resp.blob(); const arrBuf = await blob.arrayBuffer()
                              carpeta.file(ef.nombre.replace(/,/g,'').replace(/\s+/g,'_').substring(0,25)+'_'+ef.legajo+'.xlsx', arrBuf); generadas++
                            } catch(e) { console.error('Error', ef.legajo, e) }
                          }
                          if (generadas===0) { alert('No se pudieron generar las planillas'); return }
                          const zipBlob = await zip.generateAsync({ type:'blob',compression:'DEFLATE' })
                          const a = document.createElement('a'); a.href=URL.createObjectURL(zipBlob); a.download='Planillas_'+APP_LUGAR+'_'+NOMBRE_MES.replace(' ','_')+'.zip'; a.click(); URL.revokeObjectURL(a.href)
                          alert('✓ ZIP generado con ' + generadas + ' planillas')
                        } catch(e) { alert('Error: ' + e.message) }
                      }}>📦 Descargar todas (ZIP)</button>
                  </div>
                  <p style={{ fontSize:12,color:'var(--text-muted)',marginBottom:14 }}>Planillas de {APP_LUGAR} — {NOMBRE_MES}</p>
                  <div style={{ display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(250px,1fr))',gap:10 }}>
                    {efectivos.map(ef => {
                      const hs = horasAsig[ef.legajo] || 0
                      return (
                        <div key={ef.legajo} style={{ background:'var(--surface)',border:'0.5px solid var(--border)',borderRadius:10,padding:'12px 14px',cursor:'pointer' }} onClick={() => cargarPlanillaEf(ef)}>
                          <div style={{ fontSize:12,fontWeight:500,marginBottom:2 }}>{ef.nombre}</div>
                          <div style={{ fontSize:10,color:'var(--text-muted)',marginBottom:6 }}>Leg. {ef.legajo} · {ef.jerarquia||ef.tipo}</div>
                          <div style={{ display:'flex',justifyContent:'space-between',alignItems:'center' }}>
                            <span style={{ fontSize:11,color:COLOR_APP,fontWeight:500 }}>{APP_LUGAR}: {hs} hs</span>
                            <span style={{ display:'inline-flex',alignItems:'center',gap:4,fontSize:10 }}>
                              <span style={{ width:8,height:8,borderRadius:'50%',background:ef.firma_url?'#1D9E75':'#E24B4A',display:'inline-block' }}></span>
                              <span style={{ color:ef.firma_url?'#1D9E75':'#E24B4A' }}>{ef.firma_url?'Firma ✓':'Sin firma'}</span>
                            </span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ) : cargandoPlanilla ? (
                <div className="loading">Cargando planilla...</div>
              ) : (() => {
                const ef = planillaEf
                const firma = firmas[ef.legajo]?.firma_url || ''
                const filas = filasCache
                const totalHoras = filas.reduce((sum,f) => sum + f.entradas.reduce((s,e) => s+(e.horas||0),0),0)
                return (
                  <div>
                    <div style={{ display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14 }}>
                      <div style={{ display:'flex',alignItems:'center',gap:10 }}>
                        <button className="btn btn-sm" onClick={() => setPlanillaEf(null)}>← Volver</button>
                        <span style={{ fontSize:14,fontWeight:500 }}>{ef.nombre}</span>
                        <span style={{ fontSize:11,color:'var(--text-muted)' }}>Leg. {ef.legajo} · {NOMBRE_MES_P} · {APP_LUGAR}</span>
                      </div>
                      <button className="btn btn-sm" style={{ background:'rgba(29,158,117,0.15)',color:'#1D9E75',border:'0.5px solid rgba(29,158,117,0.4)' }}
                        onClick={async () => {
                          const url = `/api/planilla-efectivo?legajo=${ef.legajo}&mes=${MES}&anio=${ANIO}&lugar=${lugarDetectado}`
                          const res = await fetch(url); if (!res.ok) { alert('Error'); return }
                          const blob = await res.blob(); const a = document.createElement('a')
                          a.href = URL.createObjectURL(blob); a.download = `Planilla_${ef.nombre.replace(/,/g,'').replace(/\s+/g,'_')}_${APP_LUGAR}_${NOMBRE_MES}.xlsx`; a.click(); URL.revokeObjectURL(a.href)
                        }}>⬇ Planilla Excel</button>
                    </div>
                    <div style={{ display:'grid',gridTemplateColumns:'1fr 320px',gap:16 }}>
                      <div className="panel">
                        <div className="panel-header">
                          <h3>Guardias — {APP_LUGAR} · {NOMBRE_MES_P}</h3>
                          <span style={{ fontSize:11,color:'#1D9E75',fontWeight:500 }}>Total: {totalHoras} hs</span>
                        </div>
                        <div style={{ overflowX:'auto' }}>
                          <table>
                            <thead><tr><th style={{ width:50 }}>Día</th><th>Horario</th><th style={{ width:80 }}>Horas</th><th style={{ width:120 }}>Sector</th><th style={{ width:80 }}>Estado</th></tr></thead>
                            <tbody>
                              {filas.map(f => {
                                if (f.entradas.length===0) return (
                                  <tr key={f.dia} style={{ opacity:0.4 }}>
                                    <td style={{ textAlign:'center',fontWeight:500,background:'var(--surface2)' }}>{f.dia}</td>
                                    <td colSpan={4} style={{ fontSize:10,color:'var(--text-hint)' }}>Sin guardia</td>
                                  </tr>
                                )
                                return f.entradas.map((e,i) => (
                                  <tr key={`${f.dia}-${i}`} style={{ background:e.confirmado?'rgba(29,158,117,0.08)':e.manual?'rgba(200,168,75,0.06)':'' }}>
                                    <td style={{ textAlign:'center',fontWeight:500,background:'var(--surface2)',borderTop:i===0?'2px solid var(--border2)':'' }}>{i===0?f.dia:''}</td>
                                    <td style={{ color:e.horario.startsWith('08')?'#EF9F27':e.horario.startsWith('16')?'#AFA9EC':'#85B7EB',fontWeight:500 }}>{e.horario}</td>
                                    <td><input type="number" min="0" max="12" defaultValue={e.horas||''} style={{ width:'100%',padding:'3px 6px',border:'0.5px solid var(--border)',borderRadius:4,background:'var(--surface2)',color:'var(--text)',fontSize:12,textAlign:'center' }} onBlur={ev => guardarHoraManual(ef.legajo,f.dia,e.horario,ev.target.value,e.sector)} /></td>
                                    <td style={{ fontSize:11,color:'var(--text-muted)' }}>{e.sector||'—'}</td>
                                    <td style={{ textAlign:'center' }}>
                                      <div style={{ display:'flex',gap:4,alignItems:'center',justifyContent:'center' }}>
                                        {e.confirmado?<span style={{ fontSize:10,color:'#1D9E75',fontWeight:500 }}>✓ Presente</span>:e.manual?<span style={{ fontSize:10,color:'#c8a84b' }}>Manual</span>:<span style={{ fontSize:10,color:'var(--text-hint)' }}>Asignado</span>}
                                        {e.manual && <button style={{ background:'none',border:'none',cursor:'pointer',color:'#F09595',fontSize:12,padding:'0 2px' }} onClick={() => guardarHoraManual(ef.legajo,f.dia,e.horario,'','')}>✕</button>}
                                      </div>
                                    </td>
                                  </tr>
                                ))
                              })}
                              <tr style={{ background:'rgba(200,168,75,0.04)' }}>
                                <td colSpan={5} style={{ padding:'8px 12px' }}>
                                  <div style={{ display:'flex',gap:8,alignItems:'center',flexWrap:'wrap' }}>
                                    <span style={{ fontSize:11,color:'var(--text-muted)' }}>Agregar horas manual:</span>
                                    <select value={manualDia} onChange={e => setManualDia(parseInt(e.target.value))} style={{ padding:'4px 8px',fontSize:11,background:'var(--surface2)',color:'var(--text)',border:'0.5px solid var(--border)',borderRadius:4 }}>
                                      {Array.from({length:DIAS_MES},(_,i)=><option key={i+1} value={i+1}>Día {i+1}</option>)}
                                    </select>
                                    <div style={{ display:'flex',alignItems:'center',gap:4 }}>
                                      <input type="time" value={manualHorario} onChange={e => setManualHorario(e.target.value)} style={{ padding:'4px 6px',fontSize:11,background:'var(--surface2)',color:'var(--text)',border:'0.5px solid var(--border)',borderRadius:4 }} />
                                      <span style={{ fontSize:11,color:'var(--text-muted)' }}>a</span>
                                      <input type="time" value={manualHoras} onChange={e => setManualHoras(e.target.value)} style={{ padding:'4px 6px',fontSize:11,background:'var(--surface2)',color:'var(--text)',border:'0.5px solid var(--border)',borderRadius:4 }} />
                                    </div>
                                    <button className="btn btn-sm" style={{ fontSize:11,background:'rgba(200,168,75,0.15)',color:'#c8a84b',border:'0.5px solid rgba(200,168,75,0.4)' }}
                                      onClick={async () => {
                                        if (!manualHorario||!manualHoras) return
                                        const [h1,m1]=manualHorario.split(':').map(Number); const [h2,m2]=manualHoras.split(':').map(Number)
                                        let diff=(h2*60+m2)-(h1*60+m1); if(diff<=0) diff+=24*60
                                        await guardarHoraManual(ef.legajo,manualDia,`${manualHorario} a ${manualHoras}`,Math.round(diff/60),'')
                                        setManualHorario(''); setManualHoras(''); await cargarPlanillaEf(ef)
                                      }}>+ Agregar</button>
                                  </div>
                                </td>
                              </tr>
                            </tbody>
                          </table>
                        </div>
                      </div>
                      <div>
                        <div className="panel" style={{ marginBottom:12 }}>
                          <div className="panel-header"><h3>Datos del efectivo</h3></div>
                          <div style={{ padding:12 }}>
                            {[['Nombre',ef.nombre],['Legajo',ef.legajo],['DNI',ef.dni||'—'],['Jerarquía',ef.jerarquia||'—'],['Tipo',ef.tipo]].map(([k,v])=>(
                              <div key={k} style={{ display:'flex',justifyContent:'space-between',padding:'5px 0',borderBottom:'0.5px solid var(--border)',fontSize:12 }}>
                                <span style={{ color:'var(--text-muted)' }}>{k}</span><span style={{ fontWeight:500 }}>{v}</span>
                              </div>
                            ))}
                          </div>
                          {ef.notas && <div style={{ margin:'8px 12px',padding:'8px 10px',background:'rgba(200,168,75,0.08)',borderRadius:6,border:'0.5px solid rgba(200,168,75,0.3)' }}><div style={{ fontSize:10,color:'#c8a84b',fontWeight:500,marginBottom:3 }}>📝 Nota</div><div style={{ fontSize:11,color:'var(--text)',lineHeight:1.4 }}>{ef.notas}</div></div>}
                        </div>
                        <div className="panel">
                          <div className="panel-header"><h3>Firma del efectivo</h3></div>
                          <div style={{ padding:12 }}>
                            {firma ? (
                              <div>
                                <img src={firma} style={{ width:'100%',maxHeight:100,objectFit:'contain',marginBottom:8,background:'white',borderRadius:4,padding:4 }} alt="firma" />
                                <div style={{ display:'flex',gap:6,marginTop:4 }}>
                                  <button className="btn btn-sm" style={{ flex:1,justifyContent:'center',fontSize:11 }} onClick={() => { const inp=document.createElement('input'); inp.type='file'; inp.accept='image/*'; inp.onchange=e=>{ if(e.target.files[0]) subirFirmaAdmin(ef.legajo,e.target.files[0]) }; inp.click() }}>Cambiar</button>
                                  <button className="btn btn-sm" style={{ flex:1,justifyContent:'center',fontSize:11,color:'#F09595',borderColor:'rgba(240,149,149,0.3)' }} onClick={() => { if(confirm('¿Eliminar la firma?')) eliminarFirmaAdmin(ef.legajo) }}>Eliminar</button>
                                </div>
                              </div>
                            ) : (
                              <div>
                                <div style={{ height:60,display:'flex',alignItems:'center',justifyContent:'center',marginBottom:8,border:'0.5px dashed var(--border)',borderRadius:6 }}><span style={{ fontSize:11,color:'var(--text-hint)' }}>Sin firma</span></div>
                                <button className="btn btn-sm" style={{ width:'100%',justifyContent:'center',fontSize:11,background:'rgba(200,168,75,0.1)',color:'#c8a84b',border:'0.5px solid rgba(200,168,75,0.3)' }} onClick={() => { const inp=document.createElement('input'); inp.type='file'; inp.accept='image/*'; inp.onchange=e=>{ if(e.target.files[0]) subirFirmaAdmin(ef.legajo,e.target.files[0]) }; inp.click() }}>+ Subir firma</button>
                              </div>
                            )}
                          </div>
                        </div>
                        <div style={{ marginTop:10,padding:'10px 12px',background:'var(--surface2)',borderRadius:8 }}>
                          <div style={{ fontSize:11,color:'var(--text-muted)',marginBottom:4 }}>Total horas — {APP_LUGAR}</div>
                          <div style={{ fontSize:28,fontWeight:600,color:'#1D9E75' }}>{totalHoras} hs</div>
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })()}
            </div>
          )
        })()}

        {vista === 'descarga' && (() => {
          const handleDescargar = async (turno, key) => { setDescargando(key); try { await descargarPlanilla(turno) } catch(e) { alert('Error') }; setDescargando(null) }
          return (
            <div>
              <div style={{ marginBottom:20 }}>
                <h3 style={{ fontSize:15,fontWeight:500,marginBottom:6 }}>Planilla de guardia — {APP_LUGAR}</h3>
                <p style={{ fontSize:12,color:'var(--text-muted)' }}>Descargá las planillas de {NOMBRE_MES}</p>
              </div>
              <div style={{ display:'grid',gridTemplateColumns:`repeat(${TURNOS_INFO.length},1fr)`,gap:16,maxWidth:600 }}>
                {TURNOS_INFO.map(ti => (
                  <button key={ti.key} disabled={!!descargando} style={{ display:'flex',alignItems:'center',gap:10,padding:'16px',borderRadius:10,border:`0.5px solid ${ti.color}55`,background:descargando===ti.key?`${ti.color}22`:`${ti.color}11`,color:ti.color,cursor:descargando?'wait':'pointer',fontSize:13,fontWeight:500,opacity:descargando&&descargando!==ti.key?0.5:1 }} onClick={()=>handleDescargar(ti.key,ti.key)}>
                    <span style={{ fontSize:20 }}>{descargando===ti.key?'⏳':'⬇'}</span>
                    <div style={{ textAlign:'left' }}>
                      <div>⬇ {ti.label}</div>
                      <div style={{ fontSize:10,opacity:0.7,marginTop:2 }}>{descargando===ti.key?'Generando...':`${APP_LUGAR}_${ti.key}_${NOMBRE_MES}.xlsx`}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )
        })()}

      </div>
    </div>
  )
}
