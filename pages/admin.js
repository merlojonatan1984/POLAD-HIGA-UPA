import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../lib/supabase'

const SECTORES_POR_LUGAR = {
  'HIGA': ['Salud Mental', 'Giratoria', 'Llaves', 'Guardia', 'Estacionamiento'],
  'UPA': ['UPA'],
  'MODULAR': ['Modular']
}
const SECTORES = ['Salud Mental', 'Giratoria', 'Llaves', 'Guardia', 'Estacionamiento', 'UPA', 'Modular']
const SEC_COLORS = { 'Salud Mental': '#378ADD', 'Giratoria': '#1D9E75', 'Llaves': '#EF9F27', 'Guardia': '#D4537E', 'Estacionamiento': '#7F77DD', 'UPA': '#D85A30', 'Modular': '#20A0B0' }
const MES_ACTUAL = new Date().getMonth() + 1
const ANIO_ACTUAL = new Date().getFullYear()
const MESES_NOMBRES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
const VISTAS = ['resumen', 'personal', 'disponibilidad', 'turnos', 'edicion', 'config', 'planillas', 'descarga']
const LABELS = { resumen: 'Resumen', personal: 'Personal', disponibilidad: 'Disponibilidad', turnos: 'Guardias', edicion: 'Edición manual', config: 'Configuración', planillas: 'Planillas', descarga: '⬇ Planilla Guardia' }

// Sectores agrupados por lugar
const SECTORES_HIGA = ['Salud Mental', 'Giratoria', 'Llaves', 'Guardia', 'Estacionamiento']
const SECTORES_UPA = ['UPA']
const SECTORES_MODULAR = ['Modular']

function getLugarDeSector(sector) {
  if (SECTORES_HIGA.includes(sector)) return 'HIGA'
  if (SECTORES_UPA.includes(sector)) return 'UPA'
  if (SECTORES_MODULAR.includes(sector)) return 'MODULAR'
  return 'HIGA'
}

function ModalTurno({ turno, efectivos, horasAsig, onClose, onGuardar, onEliminar, onAgregar, sectores, diasMes, mes, anio, turnosDelDia }) {
  const esNuevo = !turno.id
  const [legajoSel, setLegajoSel] = useState(turno.legajo || '')
  const [turnoSel, setTurnoSel] = useState(turno.turno || 'd')
  const [sectorSel, setSectorSel] = useState(turno.sector || SECTORES[0])
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
                  {(sectores || SECTORES).map(s => <option key={s}>{s}</option>)}
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
            <div style={{ display:'flex',gap:8 }}>
              <button className="btn" style={{ flex:1,justifyContent:'center',background:turnoSel==='d'?'#3a2a0a':'transparent',color:turnoSel==='d'?'#EF9F27':'#8b90a0',borderColor:turnoSel==='d'?'#BA7517':'rgba(255,255,255,0.1)' }} onClick={() => setTurnoSel('d')}>Día 08-20</button>
              <button className="btn" style={{ flex:1,justifyContent:'center',background:turnoSel==='n'?'#0d2040':'transparent',color:turnoSel==='n'?'#85B7EB':'#8b90a0',borderColor:turnoSel==='n'?'#378ADD':'rgba(255,255,255,0.1)' }} onClick={() => setTurnoSel('n')}>Noche 20-08</button>
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
            {esNuevo && <p style={{ fontSize:10,color:'var(--text-muted)',marginTop:3 }}>Los marcados como "Ya asignado" ya tienen ese turno en este día.</p>}
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
  const [form, setForm] = useState(datos)
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
              <select value={form.lugar||'HIGA'} onChange={e => setForm({...form,lugar:e.target.value})} style={{ width:'100%',padding:'7px 10px',border:'0.5px solid rgba(255,255,255,0.12)',borderRadius:8,fontSize:13,background:'#1e2130',color:'#e8eaf0',outline:'none' }}>
                <option>HIGA</option><option>UPA</option><option>MODULAR</option>
              </select>
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
            <textarea value={form.notas||''} onChange={e => setForm({...form,notas:e.target.value})} placeholder="Ej: Puede hacer 9 guardias · Pide turno noche · etc." rows={2} style={{ width:'100%',padding:'7px 10px',border:'0.5px solid rgba(255,255,255,0.12)',borderRadius:8,fontSize:12,background:'#1e2130',color:'#e8eaf0',outline:'none',resize:'none' }} />
          </div>
        </div>
        <div style={{ padding:'12px 16px',borderTop:'0.5px solid rgba(255,255,255,0.06)',display:'flex',justifyContent:'space-between' }}>
          <div>
            {!esNuevo && <button className="btn btn-sm" style={{ color:'#F09595',borderColor:'rgba(240,149,149,0.3)' }} onClick={() => { if(confirm('¿Eliminar este efectivo?')) onEliminar(form) }}>Eliminar</button>}
          </div>
          <div style={{ display:'flex',gap:8 }}>
            <button className="btn btn-sm" onClick={onClose}>Cancelar</button>
            <button className="btn btn-sm" disabled={guardando||!form.legajo||!form.nombre} style={{ background:'rgba(200,168,75,0.15)',color:'#c8a84b',border:'0.5px solid rgba(200,168,75,0.4)' }} onClick={() => onGuardar(form)}>
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
  const [horasAsigPorLugar, setHorasAsigPorLugar] = useState({})
  const [loading, setLoading] = useState(true)
  const [generando, setGenerando] = useState(false)
  const [msgGen, setMsgGen] = useState(null)
  const [modalTurno, setModalTurno] = useState(null)
  const [modalPersonal, setModalPersonal] = useState(null)
  const [guardandoPersonal, setGuardandoPersonal] = useState(false)
  const [msgPersonal, setMsgPersonal] = useState(null)
  const [efDetalle, setEfectivoDetalle] = useState(null)
  const [filtroLugarDisp, setFiltroLugarDisp] = useState('HIGA')
  const [filtroDia, setFiltroDia] = useState(1)
  const [lugarEdicion, setLugarEdicion] = useState('HIGA')
  const [config, setConfig] = useState({ totalHoras: 2400, pctUniformados: 60, pctGeneral: 40 })
  const [ventanas, setVentanas] = useState({
    HIGA:    { dia: '', horaInicio: '08:00', horaFin: '20:00', activa: false },
    UPA:     { dia: '', horaInicio: '08:00', horaFin: '20:00', activa: false },
    MODULAR: { dia: '', horaInicio: '08:00', horaFin: '20:00', activa: false }
  })
  const [ventanasGuardadas, setVentanasGuardadas] = useState(false)
  const [configGuardada, setConfigGuardada] = useState(false)
  const [planillaEf, setPlanillaEf] = useState(null)
  const [lugarPlanilla, setLugarPlanilla] = useState('HIGA')
  const [planillaManual, setPlanillaManual] = useState({})
  const [planillaManualGlobal, setPlanillaManualGlobal] = useState({})
  const [firmas, setFirmas] = useState({})
  const [cargandoPlanilla, setCargandoPlanilla] = useState(false)
  const [filasCache, setFilasCache] = useState([])
  const [manualDia, setManualDia] = useState(1)
  const [manualHorario, setManualHorario] = useState('')
  const [manualHoras, setManualHoras] = useState('')
  const [descargando, setDescargando] = useState(null)
  const [dispDelDia, setDispDelDia] = useState({ dia: null, data: [] })
  const [modalAsignar, setModalAsignar] = useState(null)
  const [efDisponiblesLugar, setEfDisponiblesLugar] = useState([])
  const [asignando, setAsignando] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    const u = localStorage.getItem('polad_user')
    if (!u) { router.push('/'); return }
    const parsed = JSON.parse(u)
    if (!parsed.es_admin) { router.push('/efectivo'); return }
    cargarTodo()
    const v = localStorage.getItem('polad_ventanas')
    if (v) try { setVentanas(JSON.parse(v)) } catch(e) {}
  }, [])

  useEffect(() => { if (mounted) cargarTodo() }, [mesSeleccionado, anioSeleccionado])

  useEffect(() => {
    if (!mounted) return
    async function cargarDispDia() {
      const { data } = await supabase.from('disponibilidad').select('legajo, dia, turno, lugar').eq('mes', MES).eq('anio', ANIO).eq('dia', filtroDia)
      setDispDelDia({ dia: filtroDia, data: data || [] })
    }
    cargarDispDia()
  }, [filtroDia, lugarEdicion, mesSeleccionado, anioSeleccionado, mounted])

  async function cargarTodo() {
    setLoading(true)
    const [{ data: efs }, { data: disp }, { data: turns }, { data: manual }] = await Promise.all([
      supabase.from('efectivos').select('*').eq('es_admin', false).order('nombre'),
      supabase.from('disponibilidad').select('*').eq('mes', MES).eq('anio', ANIO),
      supabase.from('turnos').select('*').eq('mes', MES).eq('anio', ANIO),
      supabase.from('planilla_manual').select('*').eq('mes', MES).eq('anio', ANIO)
    ])
    setEfectivos(efs || [])

    // FIX: dispMap[legajo][dia][lugar] — estructura anidada para preservar múltiples lugares
    const dispMap = {}
    ;(disp || []).forEach(d => {
      if (!dispMap[d.legajo]) dispMap[d.legajo] = {}
      if (!dispMap[d.legajo][d.dia]) dispMap[d.legajo][d.dia] = {}
      dispMap[d.legajo][d.dia][d.lugar || 'HIGA'] = { turno: d.turno }
    })
    setDisponibilidad(dispMap)

    // Horas totales y desglosadas por lugar
    const turnosMap = {}; const hsMap = {}; const hsPorLugar = {}
    ;(turns || []).forEach(t => {
      if (!turnosMap[t.legajo]) turnosMap[t.legajo] = []
      turnosMap[t.legajo].push(t)
      hsMap[t.legajo] = (hsMap[t.legajo] || 0) + 12
      const lugar = getLugarDeSector(t.sector)
      if (!hsPorLugar[t.legajo]) hsPorLugar[t.legajo] = {}
      hsPorLugar[t.legajo][lugar] = (hsPorLugar[t.legajo][lugar] || 0) + 12
    })
    setTurnos(turnosMap)
    setHorasAsig(hsMap)
    setHorasAsigPorLugar(hsPorLugar)

    const manualGlobalMap = {}
    ;(manual || []).forEach(m => { manualGlobalMap[`${m.legajo}-${m.dia}-${m.horario}`] = m })
    setPlanillaManualGlobal(manualGlobalMap)
    setLoading(false)
  }

  async function generarTurnos() {
    setGenerando(true); setMsgGen(null)
    await supabase.from('turnos').delete().eq('mes', MES).eq('anio', ANIO)
    const uniformados = efectivos.filter(e => e.tipo === 'Uniformado')
    const servGeneral = efectivos.filter(e => e.tipo === 'Serv. General')
    const hsU = Math.round(config.totalHoras * config.pctUniformados / 100)
    const hsG = Math.round(config.totalHoras * config.pctGeneral / 100)
    const maxU = uniformados.length ? Math.min(180, Math.round(hsU / uniformados.length)) : 180
    const maxG = servGeneral.length ? Math.min(180, Math.round(hsG / servGeneral.length)) : 180
    const pool = efectivos.map(e => ({ ...e, hs: 0, maxHs: e.tipo === 'Uniformado' ? maxU : maxG }))
    const nuevos = []
    for (let dia = 1; dia <= DIAS_MES; dia++) {
      for (const turno of ['d', 'n']) {
        for (const sector of SECTORES) {
          const lugarSector = getLugarDeSector(sector)
          const candidatos = pool.filter(e => {
            const diaEntry = (disponibilidad[e.legajo] || {})[dia]
            const subEntry = diaEntry ? diaEntry[lugarSector] : null
            const avail = subEntry ? (subEntry.turno || '') : ''
            return ((turno === 'd' && (avail === 'd' || avail === 'dn')) || (turno === 'n' && (avail === 'n' || avail === 'dn'))) && e.hs < e.maxHs
          }).sort((a, b) => a.hs - b.hs)
          candidatos.slice(0, 2).forEach(e => { e.hs += 12; nuevos.push({ legajo: e.legajo, mes: MES, anio: ANIO, dia, turno, sector }) })
        }
      }
    }
    for (let i = 0; i < nuevos.length; i += 500) await supabase.from('turnos').insert(nuevos.slice(i, i + 500))
    setMsgGen(`Se generaron ${nuevos.length} asignaciones. Uniformados: hasta ${maxU} hs · Serv. General: hasta ${maxG} hs.`)
    await cargarTodo(); setGenerando(false)
  }

  async function asignarGuardiasAuto(legajo, cantidad, tipoTurno, lugar) {
    setAsignando(true)
    const [{ data: dispData }, { data: turnosEfData }, { data: turnosTodos }] = await Promise.all([
      supabase.from('disponibilidad').select('dia, turno').eq('legajo', legajo).eq('mes', MES).eq('anio', ANIO).eq('lugar', lugar),
      supabase.from('turnos').select('dia, turno, sector').eq('legajo', legajo).eq('mes', MES).eq('anio', ANIO).in('sector', SECTORES_POR_LUGAR[lugar] || SECTORES),
      supabase.from('turnos').select('dia, turno, sector').eq('mes', MES).eq('anio', ANIO)
    ])
    const sectoresLugar = SECTORES_POR_LUGAR[lugar] || SECTORES
    const ocupacion = {}
    ;(turnosTodos || []).forEach(t => {
      if (!sectoresLugar.includes(t.sector)) return
      const k = t.dia + '-' + t.turno + '-' + t.sector
      ocupacion[k] = (ocupacion[k] || 0) + 1
    })
    const yaAsignadosDia = new Set((turnosEfData || []).filter(t => t.turno === 'd').map(t => parseInt(t.dia)))
    const yaAsignadosNoche = new Set((turnosEfData || []).filter(t => t.turno === 'n').map(t => parseInt(t.dia)))
    const diasDisp = [...new Set((dispData || []).filter(d => {
      const diaNum = parseInt(d.dia)
      if (tipoTurno === 'd') return (d.turno === 'd' || d.turno === 'dn') && !yaAsignadosDia.has(diaNum)
      if (tipoTurno === 'n') return (d.turno === 'n' || d.turno === 'dn') && !yaAsignadosNoche.has(diaNum)
      if (tipoTurno === 'dn') return d.turno !== '' && (!yaAsignadosDia.has(parseInt(d.dia)) || !yaAsignadosNoche.has(parseInt(d.dia)))
      if (tipoTurno === 'doble') return d.turno === 'dn' && !yaAsignadosDia.has(diaNum) && !yaAsignadosNoche.has(diaNum)
      return false
    }).map(d => parseInt(d.dia)))]
    if (diasDisp.length === 0) { alert('Este efectivo no tiene dias disponibles en ' + lugar + ' para el turno seleccionado.'); setAsignando(false); return }
    const diasMezclados = [...diasDisp].sort(() => Math.random() - 0.5)
    const diasSeleccionados = diasMezclados.slice(0, Math.min(cantidad, diasMezclados.length))
    const nuevos = []
    for (const dia of diasSeleccionados) {
      if (tipoTurno === 'doble') {
        if (!yaAsignadosDia.has(dia)) { const s = sectoresLugar.find(s => (ocupacion[dia+'-d-'+s] || 0) < 2); if (s) { nuevos.push({ legajo, mes: MES, anio: ANIO, dia, turno: 'd', sector: s }); ocupacion[dia+'-d-'+s]=(ocupacion[dia+'-d-'+s]||0)+1; yaAsignadosDia.add(dia) } }
        if (!yaAsignadosNoche.has(dia)) { const s = sectoresLugar.find(s => (ocupacion[dia+'-n-'+s] || 0) < 2); if (s) { nuevos.push({ legajo, mes: MES, anio: ANIO, dia, turno: 'n', sector: s }); ocupacion[dia+'-n-'+s]=(ocupacion[dia+'-n-'+s]||0)+1; yaAsignadosNoche.add(dia) } }
      } else if (tipoTurno === 'dn') {
        const dC = nuevos.filter(n=>n.turno==='d').length; const nC = nuevos.filter(n=>n.turno==='n').length
        const t = dC <= nC ? 'd' : 'n'; const ya = t === 'd' ? yaAsignadosDia : yaAsignadosNoche
        if (!ya.has(dia)) { const s = sectoresLugar.find(s => (ocupacion[dia+'-'+t+'-'+s] || 0) < 2); if (s) { nuevos.push({ legajo, mes: MES, anio: ANIO, dia, turno: t, sector: s }); ocupacion[dia+'-'+t+'-'+s]=(ocupacion[dia+'-'+t+'-'+s]||0)+1; ya.add(dia) } }
      } else {
        const ya = tipoTurno === 'd' ? yaAsignadosDia : yaAsignadosNoche
        if (!ya.has(dia)) { const s = sectoresLugar.find(s => (ocupacion[dia+'-'+tipoTurno+'-'+s] || 0) < 2); if (s) { nuevos.push({ legajo, mes: MES, anio: ANIO, dia, turno: tipoTurno, sector: s }); ocupacion[dia+'-'+tipoTurno+'-'+s]=(ocupacion[dia+'-'+tipoTurno+'-'+s]||0)+1; ya.add(dia) } }
      }
    }
    if (nuevos.length === 0) { alert('No hay sectores con lugar libre para asignar guardias en ' + lugar + '.'); setAsignando(false); return }
    for (let i = 0; i < nuevos.length; i += 100) await supabase.from('turnos').insert(nuevos.slice(i, i + 100))
    setModalAsignar(null); setAsignando(false)
    await cargarTodo()
    const nombre = efectivos.find(e=>e.legajo===legajo)?.nombre?.split(',')[0] || legajo
    const asignadas = nuevos.length; const pedidas = tipoTurno === 'doble' ? cantidad * 2 : cantidad
    if (asignadas < pedidas) alert(`✓ Se asignaron ${asignadas} de ${pedidas} guardias a ${nombre}.\n⚠ ${pedidas - asignadas} no pudieron asignarse por falta de lugar disponible en esos días.`)
    else alert(`✓ Se asignaron ${asignadas} guardias a ${nombre} correctamente.`)
  }

  async function descargarPlanilla(lugar, turno) {
    try {
      const url = `/api/generar-planilla?lugar=${encodeURIComponent(lugar)}&turno=${encodeURIComponent(turno)}&mes=${MES}&anio=${ANIO}`
      const res = await fetch(url)
      if (!res.ok) throw new Error('Error al generar el archivo')
      const blob = await res.blob(); const a = document.createElement('a')
      a.href = URL.createObjectURL(blob); a.download = `${lugar}_${turno==='d'?'DIA':'NOCHE'}_${NOMBRE_MES}.xlsx`; a.click(); URL.revokeObjectURL(a.href)
    } catch(e) { alert('Error al generar: ' + e.message) }
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
      await supabase.from('efectivos').update({ legajo: datos.legajo, nombre: datos.nombre, tipo: datos.tipo, email: datos.email || '', sector: datos.sector || 'Sin asignar', telefono: datos.telefono || '', notas: datos.notas || null, dni: datos.dni || null, jerarquia: datos.jerarquia || null, lugar: datos.lugar || 'HIGA' }).eq('id', datos.id)
      setMsgPersonal('Efectivo actualizado.')
    } else {
      const { error } = await supabase.from('efectivos').insert([{ legajo: datos.legajo, nombre: datos.nombre, tipo: datos.tipo, email: datos.email || '', sector: 'Sin asignar', es_admin: false, telefono: datos.telefono || '' }])
      if (error) { setMsgPersonal('Error: ' + (error.message.includes('duplicate') ? 'ese legajo ya existe.' : error.message)); setGuardandoPersonal(false); return }
      setMsgPersonal('Efectivo dado de alta. Clave inicial: ' + datos.legajo)
    }
    setGuardandoPersonal(false); await cargarTodo()
  }
  async function handleEliminarPersonal(ef) { await supabase.from('efectivos').delete().eq('id', ef.id); setModalPersonal(null); await cargarTodo() }

  async function cargarPlanillaEf(ef, lugar) {
    setCargandoPlanilla(true)
    const lg = lugar || lugarPlanilla
    const [{ data: manual }, { data: firmasData }, { data: asist }] = await Promise.all([
      supabase.from('planilla_manual').select('*').eq('legajo', ef.legajo).eq('mes', MES).eq('anio', ANIO).eq('lugar', lg),
      supabase.from('firmas').select('*').eq('legajo', ef.legajo).eq('mes', MES).eq('anio', ANIO),
      supabase.from('asistencia').select('*').eq('legajo', ef.legajo).eq('mes', MES).eq('anio', ANIO).eq('lugar', lg)
    ])
    const manualMap = {}
    ;(manual || []).forEach(m => { manualMap[`${m.dia}-${m.horario}`] = m })
    setPlanillaManual(manualMap)
    setPlanillaManualGlobal(prev => { const next = { ...prev }; ;(manual || []).forEach(m => { next[`${m.legajo}-${m.dia}-${m.horario}`] = m }); return next })
    let firmaObj = firmasData && firmasData[0] ? firmasData[0] : null
    if (!firmaObj?.firma_url && ef.firma_url) {
      const { data: newFirma } = await supabase.from('firmas').insert([{ legajo: ef.legajo, mes: MES, anio: ANIO, firma_url: ef.firma_url }]).select().single()
      firmaObj = newFirma || { firma_url: ef.firma_url }
    }
    setFirmas(prev => ({ ...prev, [ef.legajo]: firmaObj }))
    setPlanillaEf(prev => ({ ...(prev || ef), ...ef, asistencia: asist || [] }))
    setCargandoPlanilla(false)
  }

  useEffect(() => {
    if (planillaEf) {
      const sectoresDelLugar = lugarPlanilla === 'HIGA' ? SECTORES_HIGA : lugarPlanilla === 'UPA' ? SECTORES_UPA : SECTORES_MODULAR
      const turnosEf = (turnos[planillaEf.legajo] || []).filter(t => sectoresDelLugar.includes(t.sector)).sort((a,b) => a.dia - b.dia)
      const asist = planillaEf.asistencia || []; const asistMap = {}
      asist.forEach(a => { asistMap[`${a.dia}-${a.turno}`] = a })
      const filas = Array.from({ length: DIAS_MES }, (_, i) => i + 1).map(dia => {
        const tDia = turnosEf.find(t => t.dia === dia && t.turno === 'd')
        const tNoche = turnosEf.find(t => t.dia === dia && t.turno === 'n')
        const pDia = asistMap[`${dia}-d`]; const pNoche = asistMap[`${dia}-n`]
        const entradas = []
        const manualDiaEntry = Object.values(planillaManual).find(m => parseInt(m.dia) === dia && m.horario === '08:00 a 20:00')
        const manualNocheEntry = Object.values(planillaManual).find(m => parseInt(m.dia) === dia && m.horario === '20:00 a 08:00')
        if (pDia) entradas.push({ horario: '08:00 a 20:00', horas: manualDiaEntry ? parseInt(manualDiaEntry.horas) : 12, confirmado: true, manual: false })
        else if (tDia) entradas.push({ horario: '08:00 a 20:00', horas: 0, confirmado: false, manual: false })
        if (pNoche) entradas.push({ horario: '20:00 a 08:00', horas: manualNocheEntry ? parseInt(manualNocheEntry.horas) : 12, confirmado: true, manual: false })
        else if (tNoche) entradas.push({ horario: '20:00 a 08:00', horas: 0, confirmado: false, manual: false })
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
  }, [planillaEf, planillaManual, turnos, lugarPlanilla])

  async function guardarHoraManual(legajo, dia, horario, horas, sector, lugar) {
    const key = `${dia}-${horario}`; const existe = planillaManual[key]
    if (horas === '' || horas === 0) {
      if (existe) { await supabase.from('planilla_manual').delete().eq('id', existe.id); const nuevo = { ...planillaManual }; delete nuevo[key]; setPlanillaManual(nuevo) }
      return
    }
    if (existe) await supabase.from('planilla_manual').update({ horas: parseInt(horas), sector }).eq('id', existe.id)
    else await supabase.from('planilla_manual').insert([{ legajo, mes: MES, anio: ANIO, dia: parseInt(dia), horario, horas: parseInt(horas), sector: sector || '', lugar: lugar || 'HIGA' }])
    const { data: fresh } = await supabase.from('planilla_manual').select('*').eq('legajo', legajo).eq('mes', MES).eq('anio', ANIO)
    const newMap = {}; ;(fresh || []).forEach(m => { newMap[`${m.dia}-${m.horario}`] = m }); setPlanillaManual(newMap)
    if (planillaEf) { setPlanillaManualGlobal(prev => { const next = { ...prev }; Object.keys(next).forEach(k => { if (k.startsWith(`${legajo}-`)) delete next[k] }); ;(fresh || []).forEach(m => { next[`${m.legajo}-${m.dia}-${m.horario}`] = m }); return next }) }
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

  // Componente inline para mostrar horas por lugar
  function BadgesLugar({ legajo }) {
    const porLugar = horasAsigPorLugar[legajo] || {}
    const colores = { HIGA: '#AFA9EC', UPA: '#D85A30', MODULAR: '#20A0B0' }
    return (
      <div style={{ display:'flex',gap:4,flexWrap:'wrap',marginTop:3 }}>
        {['HIGA','UPA','MODULAR'].filter(l => porLugar[l] > 0).map(l => (
          <span key={l} style={{ fontSize:9,padding:'1px 5px',borderRadius:3,background:`${colores[l]}22`,color:colores[l],border:`0.5px solid ${colores[l]}44` }}>{l} {porLugar[l]}hs</span>
        ))}
      </div>
    )
  }

  return (
    <div>
      {modalTurno && <ModalTurno turno={modalTurno} efectivos={efectivos} horasAsig={horasAsig} onClose={() => setModalTurno(null)} onGuardar={handleGuardarEdicion} onEliminar={handleEliminarTurno} onAgregar={handleAgregarTurno} sectores={SECTORES_POR_LUGAR[lugarEdicion] || SECTORES} diasMes={DIAS_MES} mes={MES} anio={ANIO} turnosDelDia={todosLosTurnos.filter(t => t.dia === (modalTurno.dia || filtroDia))} />}

      {modalAsignar && (
        <div style={{ position:'fixed',inset:0,background:'rgba(0,0,0,0.6)',zIndex:50,display:'flex',alignItems:'center',justifyContent:'center',padding:20 }}>
          <div style={{ background:'#13151f',borderRadius:12,border:'0.5px solid rgba(200,168,75,0.2)',width:'100%',maxWidth:440,overflow:'hidden' }}>
            <div style={{ padding:'14px 16px',borderBottom:'0.5px solid rgba(200,168,75,0.15)',display:'flex',justifyContent:'space-between',alignItems:'center',background:'rgba(200,168,75,0.06)' }}>
              <h3 style={{ fontSize:14,fontWeight:500,color:'#c8a84b' }}>⚡ Asignar guardias — {modalAsignar.lugar}</h3>
              <button className="btn btn-sm" onClick={() => setModalAsignar(null)}>Cerrar</button>
            </div>
            <div style={{ padding:16 }}>
              <div style={{ marginBottom:14 }}>
                <label style={{ fontSize:12,color:'var(--text-muted)',marginBottom:6,display:'block' }}>Efectivo</label>
                <select value={modalAsignar.legajo||''} onChange={e => setModalAsignar(prev => ({...prev,legajo:e.target.value}))} style={{ width:'100%',padding:'9px 11px',border:'0.5px solid rgba(255,255,255,0.12)',borderRadius:8,fontSize:13,background:'#1e2130',color:'#e8eaf0',outline:'none' }}>
                  <option value="">— Seleccionar efectivo —</option>
                  {efDisponiblesLugar.map(e => <option key={e.legajo} value={e.legajo}>{e.nombre} (Leg. {e.legajo})</option>)}
                </select>
              </div>
              <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:14 }}>
                <div>
                  <label style={{ fontSize:12,color:'var(--text-muted)',marginBottom:6,display:'block' }}>Cantidad de guardias</label>
                  <input type="number" min="1" max="31" value={modalAsignar.cantidad||''} onChange={e => setModalAsignar(prev => ({...prev,cantidad:parseInt(e.target.value)||''}))} placeholder="Ej: 9" style={{ width:'100%',padding:'9px 11px',border:'0.5px solid rgba(255,255,255,0.12)',borderRadius:8,fontSize:14,background:'#1e2130',color:'#e8eaf0',outline:'none',textAlign:'center' }} />
                </div>
                <div>
                  <label style={{ fontSize:12,color:'var(--text-muted)',marginBottom:6,display:'block' }}>Tipo de turno</label>
                  <select value={modalAsignar.tipoTurno||'d'} onChange={e => setModalAsignar(prev => ({...prev,tipoTurno:e.target.value}))} style={{ width:'100%',padding:'9px 11px',border:'0.5px solid rgba(255,255,255,0.12)',borderRadius:8,fontSize:13,background:'#1e2130',color:'#e8eaf0',outline:'none' }}>
                    <option value="d">Solo día (08-20)</option><option value="n">Solo noche (20-08)</option><option value="dn">Mixto alternado</option><option value="doble">Doble (día + noche)</option>
                  </select>
                </div>
              </div>
              {modalAsignar.legajo && (
                <div style={{ background:'rgba(200,168,75,0.06)',borderRadius:8,padding:'10px 12px',fontSize:11,color:'var(--text-muted)' }}>
                  {(() => {
                    const dispEf = disponibilidad[modalAsignar.legajo] || {}
                    const turno = modalAsignar.tipoTurno || 'd'; const lugarFiltroM = modalAsignar.lugar || 'HIGA'
                    const diasDisp = Object.entries(dispEf).filter(([dia, entry]) => {
                      const subEntry = entry ? entry[lugarFiltroM] : null
                      const v = subEntry ? (subEntry.turno || '') : ''
                      if (!subEntry) return false
                      const tipoBase = turno === 'doble' ? 'dn' : turno
                      if (tipoBase === 'd') return v === 'd' || v === 'dn'
                      if (tipoBase === 'n') return v === 'n' || v === 'dn'
                      return v !== ''
                    }).length
                    const turnosEf = turnos[modalAsignar.legajo] || []
                    const diasOcupados = turnosEf.filter(t => turno === 'dn' || t.turno === turno).length
                    return <span>Días disponibles: <strong style={{color:'#1D9E75'}}>{diasDisp}</strong> · Ya asignados: <strong style={{color:'#EF9F27'}}>{diasOcupados}</strong> · Libres: <strong style={{color:'#c8a84b'}}>{Math.max(0, diasDisp - diasOcupados)}</strong></span>
                  })()}
                </div>
              )}
            </div>
            <div style={{ padding:'12px 16px',borderTop:'0.5px solid rgba(255,255,255,0.06)',display:'flex',justifyContent:'flex-end',gap:8 }}>
              <button className="btn btn-sm" onClick={() => setModalAsignar(null)}>Cancelar</button>
              <button className="btn btn-sm" disabled={!modalAsignar.legajo || !modalAsignar.cantidad || asignando} style={{ background:'rgba(200,168,75,0.15)',color:'#c8a84b',border:'0.5px solid rgba(200,168,75,0.4)' }} onClick={() => asignarGuardiasAuto(modalAsignar.legajo, modalAsignar.cantidad, modalAsignar.tipoTurno || 'd', modalAsignar.lugar)}>
                {asignando ? 'Asignando...' : `⚡ Asignar ${modalAsignar.tipoTurno === 'doble' ? (modalAsignar.cantidad||0)*2 + ' turnos' : (modalAsignar.cantidad||0) + ' guardias'}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {modalPersonal && <ModalPersonal datos={modalPersonal} onClose={() => { setModalPersonal(null); setMsgPersonal(null) }} onGuardar={handleGuardarPersonal} onEliminar={handleEliminarPersonal} guardando={guardandoPersonal} msg={msgPersonal} />}

      <div className="topbar">
        <div style={{ display:'flex',alignItems:'center',gap:10 }}>
          <span style={{ fontSize:15,fontWeight:500 }}>Panel Admin — POLAD</span>
          <span style={{ background:'#EEEDFE',color:'#3C3489',fontSize:11,padding:'2px 8px',borderRadius:3,fontWeight:500 }}>Administrador</span>
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
          <div className="metric"><div className="metric-label">Efectivos</div><div className="metric-val">{efectivos.length}</div><div className="metric-sub">en el sistema</div></div>
          <div className="metric"><div className="metric-label">Cargaron disponib.</div><div className="metric-val">{cargaron}</div><div className="metric-sub">de {efectivos.length}</div></div>
          <div className="metric"><div className="metric-label">Turnos asignados</div><div className="metric-val">{todosLosTurnos.length}</div><div className="metric-sub">{NOMBRE_MES}</div></div>
          <div className="metric"><div className="metric-label">Estado</div><div className="metric-val" style={{ fontSize:13,marginTop:4,color:hayTurnos?'#1D9E75':'#8b90a0' }}>{hayTurnos?'Generado':'Sin generar'}</div><div className="metric-sub">{NOMBRE_MES}</div></div>
        </div>
        <div style={{ display:'flex',justifyContent:'flex-end',marginBottom:12 }}>
          <button className="btn btn-sm" style={{ background:'rgba(200,168,75,0.15)',color:'#c8a84b',border:'0.5px solid rgba(200,168,75,0.4)',display:'flex',alignItems:'center',gap:6 }}
            onClick={async () => {
              const url = `/api/resumen-guardias?mes=${MES}&anio=${ANIO}`
              const res = await fetch(url); if (!res.ok) { alert('Error al generar el PDF'); return }
              const blob = await res.blob(); const a = document.createElement('a')
              a.href = URL.createObjectURL(blob); a.download = `Resumen_Guardias_${NOMBRE_MES.replace(' ','_')}.xlsx`; a.click(); URL.revokeObjectURL(a.href)
            }}>📄 Descargar resumen de guardias</button>
        </div>

        {vista === 'resumen' && (() => {
          const uniformados = efectivos.filter(e => e.tipo === 'Uniformado')
          const servGeneral = efectivos.filter(e => e.tipo === 'Serv. General')
          const destacamento = efectivos.filter(e => e.tipo === 'Destacamento')
          const renderGrupo = lista => lista.map(e => {
            const dias = Object.keys(disponibilidad[e.legajo] || {}).length
            // FIX: mostrar horas solo del lugar del perfil
            const lugarPerfil = e.lugar || 'HIGA'
            const hs = (horasAsigPorLugar[e.legajo] || {})[lugarPerfil] || 0
            const pct = Math.round(hs / 180 * 100)
            const color = pct >= 100 ? '#E24B4A' : pct >= 80 ? '#EF9F27' : '#1D9E75'
            const coloresLugar = { HIGA: '#AFA9EC', UPA: '#D85A30', MODULAR: '#20A0B0' }
            return (
              <div key={e.legajo} style={{ border:'0.5px solid var(--border)',borderRadius:8,padding:'10px 12px',background:'var(--surface2)' }}>
                <div style={{ display:'flex',justifyContent:'space-between' }}>
                  <div>
                    <div style={{ fontSize:12,fontWeight:500 }}>{e.nombre}</div>
                    <div style={{ fontSize:10,color:'var(--text-muted)',marginTop:2 }}>Leg. {e.legajo}</div>
                    <div style={{ fontSize:10,color:'var(--text-muted)',marginTop:1,display:'flex',alignItems:'center',gap:4 }}>
                      <span className="dot" style={{ background:SEC_COLORS[e.sector]||'#666',width:6,height:6 }}></span>{e.sector}
                    </div>
                  </div>
                  <div style={{ textAlign:'right' }}>
                    <div style={{ fontSize:16,fontWeight:500,color }}>{hs}</div>
                    <div style={{ fontSize:9,color:coloresLugar[lugarPerfil]||'var(--text-hint)' }}>{lugarPerfil}</div>
                  </div>
                </div>
                {/* Solo badge del lugar del perfil */}
                {(() => { const hsL = (horasAsigPorLugar[e.legajo] || {})[lugarPerfil] || 0; const col = coloresLugar[lugarPerfil]; return hsL > 0 ? <div style={{ display:'flex',gap:4,flexWrap:'wrap',marginTop:3 }}><span style={{ fontSize:9,padding:'1px 5px',borderRadius:3,background:`${col}22`,color:col,border:`0.5px solid ${col}44` }}>{lugarPerfil} {hsL}hs</span></div> : null })()
                <div style={{ marginTop:6,fontSize:11,color:dias>0?'#1D9E75':'#EF9F27' }}>{dias>0?`${dias} días cargados`:'Sin disponibilidad'}</div>
                <div className="hbar" style={{ width:'100%',marginTop:4 }}><div className="hfill" style={{ width:`${Math.min(pct,100)}%`,background:color }}></div></div>
              </div>
            )
          })
          return (
            <div>
              <div className="panel" style={{ marginBottom:16 }}>
                <div className="panel-header" style={{ background:'rgba(42,37,96,0.5)' }}><h3 style={{ color:'#AFA9EC' }}>Uniformados — {uniformados.length} efectivos</h3></div>
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
            const lugarPerfil = e.lugar || 'HIGA'
            const hs = (horasAsigPorLugar[e.legajo] || {})[lugarPerfil] || 0
            const pct = Math.round(hs / 180 * 100)
            const color = pct >= 100 ? '#E24B4A' : pct >= 80 ? '#EF9F27' : '#1D9E75'
            const coloresLugar = { HIGA: '#AFA9EC', UPA: '#D85A30', MODULAR: '#20A0B0' }
            const colorLugar = coloresLugar[lugarPerfil] || '#AFA9EC'
            const turnosEf = turnos[e.legajo] || []
            const sectoresLugarPerfil = SECTORES_POR_LUGAR[lugarPerfil] || SECTORES_HIGA
            const turnosPerfil = turnosEf.filter(t => sectoresLugarPerfil.includes(t.sector))
            const turnosDia = turnosPerfil.filter(t => t.turno === 'd').length
            const turnosNoche = turnosPerfil.filter(t => t.turno === 'n').length
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
                    <div style={{ fontSize:9,color:colorLugar }}>{lugarPerfil}</div>
                  </div>
                </div>
                <div style={{ height:4,background:'rgba(255,255,255,0.05)',overflow:'hidden' }}>
                  <div style={{ height:'100%',width:`${Math.min(pct,100)}%`,background:color }}></div>
                </div>
                <div style={{ padding:'10px 14px' }}>
                  <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:6,marginBottom:10 }}>
                    <div style={{ background:`${colorLugar}18`,borderRadius:6,padding:'6px 8px',border:`0.5px solid ${colorLugar}33` }}>
                      <div style={{ fontSize:8,color:colorLugar,marginBottom:1 }}>{lugarPerfil} — Día</div>
                      <div style={{ fontSize:16,fontWeight:500,color:colorLugar }}>{turnosDia}</div>
                      <div style={{ fontSize:9,color:'var(--text-muted)' }}>{turnosDia * 12} hs</div>
                    </div>
                    <div style={{ background:'rgba(13,32,64,0.5)',borderRadius:6,padding:'6px 8px',border:'0.5px solid rgba(133,183,235,0.2)' }}>
                      <div style={{ fontSize:8,color:'#85B7EB',marginBottom:1 }}>{lugarPerfil} — Noche</div>
                      <div style={{ fontSize:16,fontWeight:500,color:'#85B7EB' }}>{turnosNoche}</div>
                      <div style={{ fontSize:9,color:'var(--text-muted)' }}>{turnosNoche * 12} hs</div>
                    </div>
                    {turnosPerfil.length === 0 && (
                      <div style={{ gridColumn:'1/-1',fontSize:11,color:'var(--text-hint)',fontStyle:'italic' }}>Sin guardias asignadas</div>
                    )}
                  </div>
                  {e.telefono && turnosEf.length > 0 && (
                    <a href={(() => {
                      const tel = '549' + e.telefono.replace(/\D/g,'')
                      const jerarquia = e.jerarquia ? e.jerarquia + ' ' : ''
                      const nombreFormateado = e.nombre.split(',').map(p => p.trim()).reverse().join(' ')
                      const porLugar = {}
                      turnosEf.sort((a,b) => a.dia - b.dia).forEach(t => {
                        const lugar = getLugarDeSector(t.sector)
                        if (!porLugar[lugar]) porLugar[lugar] = []
                        porLugar[lugar].push(t)
                      })
                      let bloques = ''; let totalGeneral = 0
                      ;['HIGA','UPA','MODULAR'].forEach(lugar => {
                        if (!porLugar[lugar]) return
                        const ts = porLugar[lugar]; const subtotal = ts.length * 12; totalGeneral += subtotal
                        const lineas = ts.map(t => `   %E2%80%A2 D%C3%ADa ${t.dia} %E2%80%94 ${t.turno==='d'?'08:00 a 20:00':'20:00 a 08:00'} hs %E2%80%94 ${encodeURIComponent(t.sector)}`).join('%0A')
                        bloques += `%0A%F0%9F%93%8D *${lugar}* %E2%80%94 Mar del Plata%0A${lineas}%0A   _Subtotal ${lugar}: ${subtotal} hs_%0A`
                      })
                      const msg = `Estimado%2Fa ${encodeURIComponent(jerarquia + nombreFormateado)}%3A%0A%0ASe le comunica el cronograma de servicios POLAD asignado para el mes de *${encodeURIComponent(NOMBRE_MES.toUpperCase())}*%3A%0A${bloques}%0A%E2%9C%85 *Total general: ${totalGeneral} hs*%0A%0AAnte cualquier consulta comunicarse con el referente.%0A%0A_Crio. Paulo Corbela_%0A_POLAD %C2%B7 HIGA %C2%B7 UPA %C2%B7 MODULAR_%0A_Mar del Plata_`
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
                <button className="btn btn-sm" style={{ background:'rgba(200,168,75,0.15)',color:'#c8a84b',border:'0.5px solid rgba(200,168,75,0.4)' }} onClick={() => { setMsgPersonal(null); setModalPersonal({ legajo:'',nombre:'',tipo:'Uniformado',email:'',sector:'Sin asignar' }) }}>+ Dar de alta efectivo</button>
              </div>
              <div className="panel" style={{ marginBottom:16 }}>
                <div className="panel-header" style={{ background:'rgba(42,37,96,0.5)' }}><h3 style={{ color:'#AFA9EC' }}>Uniformados — {uniformados.length} efectivos</h3></div>
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
            <div style={{ display:'flex',alignItems:'center',gap:8,marginBottom:14 }}>
              <span style={{ fontSize:12,color:'var(--text-muted)' }}>Lugar:</span>
              {['HIGA','UPA','MODULAR'].map(lg => (
                <button key={lg} className="btn btn-sm" style={{ fontWeight:filtroLugarDisp===lg?600:400,background:filtroLugarDisp===lg?'rgba(200,168,75,0.15)':'transparent',color:filtroLugarDisp===lg?'#c8a84b':'#8b90a0',border:filtroLugarDisp===lg?'0.5px solid rgba(200,168,75,0.6)':'0.5px solid rgba(255,255,255,0.1)' }}
                  onClick={() => { setFiltroLugarDisp(lg); setEfectivoDetalle(null) }}>{lg}</button>
              ))}
            </div>
            <div className="panel" style={{ marginBottom:14 }}>
              <div className="panel-header"><h3>Disponibilidad cargada — {NOMBRE_MES}</h3></div>
              <div style={{ padding:14,overflowX:'auto' }}>
                <table style={{ tableLayout:'fixed',width:'max-content',minWidth:'100%' }}>
                  <thead>
                    <tr>
                      <th style={{ width:130 }}>Efectivo</th>
                      {Array.from({ length:DIAS_MES },(_,i) => <th key={i} style={{ width:26,textAlign:'center',padding:'8px 1px' }}>{i+1}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {efectivos.map(e => (
                      <tr key={e.legajo} style={{ cursor:'pointer' }} onClick={() => setEfectivoDetalle(efDetalle===e.legajo?null:e.legajo)}>
                        <td style={{ fontSize:11,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',color:efDetalle===e.legajo?'#c8a84b':'var(--text)',fontWeight:efDetalle===e.legajo?500:400 }}>{e.nombre}</td>
                        {Array.from({ length:DIAS_MES },(_,i) => {
                          // FIX: leer nueva estructura anidada
                          const diaEntry = (disponibilidad[e.legajo] || {})[i+1]
                          const subEntry = diaEntry ? diaEntry[filtroLugarDisp] : null
                          const v = subEntry ? (subEntry.turno || '') : ''
                          if (!subEntry) return <td key={i} style={{ textAlign:'center',padding:'3px 1px' }}><span style={{ display:'inline-block',width:20,height:16,borderRadius:3,fontSize:9 }}></span></td>
                          const bg = v==='dn'?'#0d2b1a':v==='d'?'#3a2a0a':v==='n'?'#0d2040':'var(--surface2)'
                          const label = v==='dn'?'A':v==='d'?'D':v==='n'?'N':'·'
                          const color = v==='dn'?'#5DCAA5':v==='d'?'#EF9F27':v==='n'?'#85B7EB':'#444'
                          return <td key={i} style={{ textAlign:'center',padding:'3px 1px' }}><span style={{ display:'inline-block',width:20,height:16,background:bg,borderRadius:3,fontSize:9,fontWeight:500,lineHeight:'16px',color }}>{label}</span></td>
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            {efDetalle && (() => {
              const e = efectivos.find(x => x.legajo === efDetalle); if (!e) return null
              const dispTodo = disponibilidad[e.legajo] || {}
              // FIX: filtrar y mapear a { turno } para el calendario
              const disp = Object.fromEntries(
                Object.entries(dispTodo).filter(([dia, entry]) => entry && entry[filtroLugarDisp]).map(([dia, entry]) => [dia, entry[filtroLugarDisp]])
              )
              const primerDia = (new Date(ANIO, MES-1, 1).getDay() + 6) % 7
              const turnosEf = turnos[e.legajo] || []
              return (
                <div className="panel">
                  <div className="panel-header" style={{ background:'rgba(200,168,75,0.08)' }}>
                    <h3 style={{ color:'#c8a84b' }}>{e.nombre} — Leg. {e.legajo}</h3>
                    <button className="btn btn-sm" onClick={() => setEfectivoDetalle(null)}>Cerrar</button>
                  </div>
                  <div style={{ padding:14 }}>
                    <div style={{ display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:2,marginBottom:6 }}>
                      {['Lu','Ma','Mi','Ju','Vi','Sá','Do'].map(d => <div key={d} style={{ textAlign:'center',fontSize:11,color:'var(--text-muted)',padding:'4px 0' }}>{d}</div>)}
                    </div>
                    <div style={{ display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:3 }}>
                      {Array.from({ length:primerDia }).map((_,i) => <div key={`e-${i}`}></div>)}
                      {Array.from({ length:DIAS_MES },(_,i) => i+1).map(dia => {
                        const entry = disp[dia]; const v = entry ? (entry.turno || '') : ''
                        const bg = v==='dn'?'#0d2b1a':v==='d'?'#3a2a0a':v==='n'?'#0d2040':'var(--surface2)'
                        const bc = v==='dn'?'#1D9E75':v==='d'?'#BA7517':v==='n'?'#378ADD':'var(--border)'
                        const sectoresLugarDet = SECTORES_POR_LUGAR[filtroLugarDisp] || SECTORES
                        const tsDia = turnosEf.filter(t => t.dia === dia && sectoresLugarDet.includes(t.sector))
                        return (
                          <div key={dia} style={{ border:`0.5px solid ${bc}`,borderRadius:6,padding:'5px 4px',minHeight:52,background:bg,cursor:'pointer' }} onClick={() => setModalTurno({ dia, sector:SECTORES[0], turno:'d', legajo:e.legajo })}>
                            <div style={{ fontSize:11,fontWeight:500,color:'var(--text-muted)',marginBottom:2 }}>{dia}</div>
                            {v && <div style={{ fontSize:9,color:v==='dn'?'#5DCAA5':v==='d'?'#EF9F27':'#85B7EB' }}>{v==='dn'?'Ambos':v==='d'?'Día':'Noche'}</div>}
                            {tsDia.map(t => <div key={t.id} style={{ fontSize:8,background:t.turno==='d'?'#3a2a0a':'#0d2040',color:t.turno==='d'?'#EF9F27':'#85B7EB',borderRadius:2,padding:'1px 3px',marginTop:1 }}>{t.turno==='d'?'D':'N'} {t.sector.split(' ')[0]}</div>)}
                          </div>
                        )
                      })}
                    </div>
                    <div style={{ marginTop:10,fontSize:11,color:'var(--text-muted)' }}>Hacé clic en cualquier día para agregar un turno manual a este efectivo.</div>
                  </div>
                </div>
              )
            })()}
          </div>
        )}

        {vista === 'turnos' && (
          <div>
            {msgGen && <div className="alert alert-ok">{msgGen}</div>}
            {!hayTurnos && !msgGen && <div className="alert alert-warn">{cargaron} de {efectivos.length} efectivos cargaron disponibilidad.</div>}
            <div style={{ textAlign:'center',padding:'20px 0 16px' }}>
              <button className="btn btn-success" onClick={generarTurnos} disabled={generando}>{generando?'Generando...':hayTurnos?'Regenerar turnos':'Generar turnos automáticamente'}</button>
              <p style={{ fontSize:11,color:'var(--text-muted)',marginTop:6 }}>Distribuye parejo respetando disponibilidad y límites por grupo</p>
            </div>
            {hayTurnos && (
              <div className="panel">
                <div className="panel-header"><h3>Cronograma — {NOMBRE_MES}</h3></div>
                <div style={{ overflowX:'auto' }}>
                  <table style={{ tableLayout:'fixed',width:'max-content',minWidth:'100%' }}>
                    <thead>
                      <tr>
                        <th style={{ width:130 }}>Sector</th>
                        {Array.from({ length:DIAS_MES },(_,i) => <th key={i} style={{ width:76,textAlign:'center',padding:'8px 3px' }}>{i+1}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {SECTORES.map(sector => (
                        <tr key={sector}>
                          <td><span style={{ display:'inline-flex',alignItems:'center',gap:4,fontSize:11 }}><span className="dot" style={{ background:SEC_COLORS[sector] }}></span>{sector}</span></td>
                          {Array.from({ length:DIAS_MES },(_,i) => {
                            const dia = i+1
                            const tD = todosLosTurnos.filter(t=>t.dia===dia&&t.turno==='d'&&t.sector===sector)
                            const tN = todosLosTurnos.filter(t=>t.dia===dia&&t.turno==='n'&&t.sector===sector)
                            return <td key={i} style={{ padding:'3px',fontSize:10,verticalAlign:'top' }}>
                              <div style={{ color:'#EF9F27',marginBottom:1 }}>{tD.map(t=>nombreCorto(t.legajo)).join(', ')||'—'}</div>
                              <div style={{ color:'#85B7EB' }}>{tN.map(t=>nombreCorto(t.legajo)).join(', ')||'—'}</div>
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
              <h3 style={{ fontSize:14,fontWeight:500 }}>Día {filtroDia} — {NOMBRE_MES}</h3>
              <div style={{ display:'flex',gap:8,alignItems:'center' }}>
                <div style={{ display:'flex',gap:3 }}>
                  {['HIGA','UPA','MODULAR'].map(lg => (
                    <button key={lg} className="btn btn-sm" style={{ fontWeight:lugarEdicion===lg?600:400,background:lugarEdicion===lg?'rgba(200,168,75,0.15)':'transparent',color:lugarEdicion===lg?'#c8a84b':'#8b90a0',border:lugarEdicion===lg?'0.5px solid rgba(200,168,75,0.6)':'0.5px solid rgba(255,255,255,0.1)' }} onClick={() => setLugarEdicion(lg)}>{lg}</button>
                  ))}
                </div>
                <button className="btn btn-primary btn-sm" onClick={() => setModalTurno({ dia:filtroDia,sector:(SECTORES_POR_LUGAR[lugarEdicion]||SECTORES)[0],turno:'d',legajo:'' })}>+ Agregar turno</button>
              </div>
            </div>
            <div style={{ display:'grid',gridTemplateColumns:'1fr 240px',gap:12 }}>
              <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,alignContent:'start' }}>
                {(SECTORES_POR_LUGAR[lugarEdicion] || SECTORES).map(sector => {
                  const tDia = todosLosTurnos.filter(t=>t.dia===filtroDia&&t.turno==='d'&&t.sector===sector)
                  const tNoche = todosLosTurnos.filter(t=>t.dia===filtroDia&&t.turno==='n'&&t.sector===sector)
                  return (
                    <div key={sector} style={{ background:'var(--surface)',border:'0.5px solid var(--border)',borderRadius:10,overflow:'hidden' }}>
                      <div style={{ padding:'8px 12px',background:'var(--surface2)',borderBottom:'0.5px solid var(--border)',display:'flex',alignItems:'center',gap:6 }}>
                        <span className="dot" style={{ background:SEC_COLORS[sector] }}></span>
                        <span style={{ fontSize:12,fontWeight:500 }}>{sector}</span>
                      </div>
                      <div style={{ padding:10 }}>
                        {[['d','TURNO DÍA 08-20','#EF9F27','#3a2a0a',tDia],['n','TURNO NOCHE 20-08','#85B7EB','#0d2040',tNoche]].map(([t,label,color,bg,list]) => (
                          <div key={t} style={{ marginBottom:t==='d'?8:0,paddingBottom:t==='d'?8:0,borderBottom:t==='d'?'0.5px solid var(--border)':'' }}>
                            <div style={{ fontSize:10,color,fontWeight:500,marginBottom:5 }}>{label}</div>
                            {list.length===0 && (
                              <div style={{ display:'flex',alignItems:'center',gap:6 }}>
                                <span style={{ fontSize:11,color:'var(--text-hint)',fontStyle:'italic' }}>Sin cubrir</span>
                                <button className="btn btn-sm" style={{ fontSize:10,padding:'2px 8px',color,borderColor:`${color}66` }} onClick={() => setModalTurno({ dia:filtroDia,sector,turno:t,legajo:'' })}>+ Asignar</button>
                              </div>
                            )}
                            {list.map(item => (
                              <div key={item.id} style={{ display:'flex',alignItems:'center',justifyContent:'space-between',padding:'4px 8px',background:`${bg}66`,borderRadius:6,marginBottom:3 }}>
                                <span style={{ fontSize:12,fontWeight:500 }}>{nombreCompleto(item.legajo)}</span>
                                <div style={{ display:'flex',gap:4 }}>
                                  <button className="btn btn-sm" style={{ fontSize:10,padding:'2px 6px' }} onClick={() => setModalTurno(item)}>Cambiar</button>
                                  <button className="btn btn-sm" style={{ fontSize:10,padding:'2px 6px',color:'#F09595',borderColor:'rgba(240,149,149,0.3)' }} onClick={() => handleEliminarTurno(item)}>✕</button>
                                </div>
                              </div>
                            ))}
                            {list.length>0&&list.length<2 && <button className="btn btn-sm" style={{ fontSize:10,padding:'2px 8px',marginTop:3,color,borderColor:`${color}55` }} onClick={() => setModalTurno({ dia:filtroDia,sector,turno:t,legajo:'' })}>+ Agregar segundo</button>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
              <div style={{ background:'var(--surface)',border:'0.5px solid var(--border)',borderRadius:10,overflow:'hidden',height:'fit-content',position:'sticky',top:16 }}>
                <div style={{ padding:'10px 14px',background:'var(--surface2)',borderBottom:'0.5px solid var(--border)' }}>
                  <div style={{ fontSize:13,fontWeight:500,marginBottom:2 }}>Disponibles — Día {filtroDia}</div>
                  <div style={{ fontSize:11,color:'var(--text-muted)' }}>Clic para asignar rápido</div>
                </div>
                {(() => {
                  const dispDatos = dispDelDia.dia === filtroDia ? dispDelDia.data : []
                  const yaAsignadosDia = new Set(todosLosTurnos.filter(t => t.dia===filtroDia&&t.turno==='d').map(t => t.legajo))
                  const yaAsignadosNoche = new Set(todosLosTurnos.filter(t => t.dia===filtroDia&&t.turno==='n').map(t => t.legajo))
                  const sectoresLugar = SECTORES_POR_LUGAR[lugarEdicion] || SECTORES
                  const ocupDia = {}; const ocupNoche = {}
                  todosLosTurnos.filter(t => t.dia===filtroDia).forEach(t => {
                    if (t.turno==='d') ocupDia[t.sector]=(ocupDia[t.sector]||0)+1
                    else ocupNoche[t.sector]=(ocupNoche[t.sector]||0)+1
                  })
                  const hayLugarDia = sectoresLugar.some(s => (ocupDia[s]||0) < 2)
                  const hayLugarNoche = sectoresLugar.some(s => (ocupNoche[s]||0) < 2)
                  const dispFiltrada = dispDatos.filter(d => (d.lugar||'HIGA') === lugarEdicion)
                  const dispDia = dispFiltrada.map(d => { const ef = efectivos.find(e => e.legajo===d.legajo); if (!ef) return null; return { ...ef, disp:d.turno, hs:horasAsig[ef.legajo]||0 } }).filter(Boolean)
                  const dispTurnoDia = dispDia.filter(e => (e.disp==='d'||e.disp==='dn') && !yaAsignadosDia.has(e.legajo) && e.hs<180 && hayLugarDia)
                  const dispTurnoNoche = dispDia.filter(e => (e.disp==='n'||e.disp==='dn') && !yaAsignadosNoche.has(e.legajo) && e.hs<180 && hayLugarNoche)
                  const renderEf = (e, turno) => {
                    const pct = Math.round(e.hs/180*100)
                    const colorHs = pct>=100?'#E24B4A':pct>=80?'#EF9F27':'#1D9E75'
                    const badgeColor = e.disp==='dn'?{bg:'rgba(93,202,165,0.15)',color:'#1D9E75',label:'Ambos'}:e.disp==='d'?{bg:'rgba(239,159,39,0.15)',color:'#EF9F27',label:'Día'}:{bg:'rgba(133,183,235,0.15)',color:'#85B7EB',label:'Noche'}
                    return (
                      <div key={e.legajo} style={{ display:'flex',alignItems:'center',justifyContent:'space-between',padding:'6px 0',borderBottom:'0.5px solid var(--border)',cursor:'pointer' }} onClick={() => setModalTurno({ dia:filtroDia,sector:(SECTORES_POR_LUGAR[lugarEdicion]||SECTORES)[0],turno,legajo:e.legajo })}>
                        <div style={{ flex:1,minWidth:0 }}>
                          <div style={{ fontSize:11,fontWeight:500,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' }}>{e.nombre.split(',')[0]}</div>
                          <div style={{ display:'flex',alignItems:'center',gap:4,marginTop:2 }}>
                            <span style={{ fontSize:9,color:colorHs }}>{e.hs} hs</span>
                            <span style={{ fontSize:9,color:e.tipo==='Uniformado'?'#AFA9EC':e.tipo==='Destacamento'?'#F5C518':'#5DCAA5' }}>· {e.tipo==='Uniformado'?'Unif.':e.tipo==='Destacamento'?'Dest.':'S.G.'}</span>
                          </div>
                        </div>
                        <span style={{ fontSize:10,padding:'1px 6px',borderRadius:3,background:badgeColor.bg,color:badgeColor.color,flexShrink:0,marginLeft:6 }}>{badgeColor.label}</span>
                      </div>
                    )
                  }
                  return (
                    <div>
                      <div style={{ padding:'8px 12px 4px' }}>
                        <div style={{ fontSize:10,fontWeight:500,color:'#EF9F27',marginBottom:6,paddingBottom:4,borderBottom:'0.5px solid var(--border)' }}>Turno día (08-20) — {dispTurnoDia.length}</div>
                        {dispTurnoDia.length===0?<div style={{ fontSize:11,color:'var(--text-hint)',fontStyle:'italic',paddingBottom:6 }}>Sin disponibilidad</div>:dispTurnoDia.map(e=>renderEf(e,'d'))}
                      </div>
                      <div style={{ padding:'8px 12px 8px' }}>
                        <div style={{ fontSize:10,fontWeight:500,color:'#85B7EB',marginBottom:6,paddingBottom:4,borderBottom:'0.5px solid var(--border)' }}>Turno noche (20-08) — {dispTurnoNoche.length}</div>
                        {dispTurnoNoche.length===0?<div style={{ fontSize:11,color:'var(--text-hint)',fontStyle:'italic' }}>Sin disponibilidad</div>:dispTurnoNoche.map(e=>renderEf(e,'n'))}
                      </div>
                      <div style={{ padding:'8px 12px',borderTop:'0.5px solid var(--border)' }}>
                        <button className="btn btn-sm" style={{ width:'100%',justifyContent:'center',fontSize:11,background:'rgba(200,168,75,0.1)',color:'#c8a84b',border:'0.5px solid rgba(200,168,75,0.3)' }}
                          onClick={async () => {
                            setModalAsignar({ lugar:lugarEdicion })
                            const { data } = await supabase.from('disponibilidad').select('legajo').eq('mes',MES).eq('anio',ANIO).eq('lugar',lugarEdicion)
                            const legajos = new Set((data||[]).map(d=>d.legajo))
                            setEfDisponiblesLugar(efectivos.filter(e=>legajos.has(e.legajo)))
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
          const angU = (config.pctUniformados / 100) * 2 * Math.PI
          const cx=100, cy=100, r=80
          const x1 = cx + r * Math.sin(angU); const y1 = cy - r * Math.cos(angU)
          const largeArc = config.pctUniformados > 50 ? 1 : 0
          return (
            <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:16 }}>
              <div className="panel">
                <div className="panel-header"><h3>Horas otorgadas por Provincia</h3></div>
                <div style={{ padding:16 }}>
                  <div style={{ marginBottom:16 }}>
                    <label style={{ fontSize:12,color:'var(--text-muted)',marginBottom:6,display:'block' }}>Total de horas del mes</label>
                    <input type="number" value={config.totalHoras} min="0" onChange={e => setConfig({...config,totalHoras:parseInt(e.target.value)||0})} style={{ width:'100%',padding:'10px 12px',border:'0.5px solid rgba(200,168,75,0.3)',borderRadius:8,fontSize:18,fontWeight:500,background:'#1e2130',color:'#c8a84b',outline:'none',textAlign:'center' }} />
                  </div>
                  <div style={{ marginBottom:12 }}>
                    <label style={{ fontSize:12,color:'#AFA9EC',marginBottom:6,display:'block' }}>% Uniformados — {config.pctUniformados}%</label>
                    <input type="range" min="0" max="100" value={config.pctUniformados} onChange={e => { const v=parseInt(e.target.value); setConfig({...config,pctUniformados:v,pctGeneral:100-v}) }} style={{ width:'100%',accentColor:'#AFA9EC' }} />
                  </div>
                  <div style={{ marginBottom:16 }}>
                    <label style={{ fontSize:12,color:'#5DCAA5',marginBottom:6,display:'block' }}>% Serv. General — {config.pctGeneral}%</label>
                    <input type="range" min="0" max="100" value={config.pctGeneral} onChange={e => { const v=parseInt(e.target.value); setConfig({...config,pctGeneral:v,pctUniformados:100-v}) }} style={{ width:'100%',accentColor:'#5DCAA5' }} />
                  </div>
                  <button className="btn" style={{ width:'100%',justifyContent:'center',background:'rgba(200,168,75,0.15)',color:'#c8a84b',border:'0.5px solid rgba(200,168,75,0.4)' }} onClick={() => { localStorage.setItem('polad_ventanas', JSON.stringify(ventanas)); setConfigGuardada(true); setTimeout(()=>setConfigGuardada(false),2500) }}>Guardar configuración</button>
                  {configGuardada && <div className="alert alert-ok" style={{ marginTop:10,textAlign:'center' }}>Configuración guardada.</div>}
                  <div style={{ marginTop:20,borderTop:'0.5px solid rgba(255,255,255,0.08)',paddingTop:16 }}>
                    <div style={{ fontSize:13,fontWeight:500,color:'#c8a84b',marginBottom:12 }}>Ventanas de inscripción de disponibilidad</div>
                    {['HIGA','UPA','MODULAR'].map(lugar => (
                      <div key={lugar} style={{ marginBottom:14,background:'rgba(255,255,255,0.03)',borderRadius:8,padding:12,border:'0.5px solid rgba(255,255,255,0.08)' }}>
                        <div style={{ fontSize:12,fontWeight:500,marginBottom:8,color:lugar==='HIGA'?'#AFA9EC':lugar==='UPA'?'#D85A30':'#20A0B0' }}>{lugar}</div>
                        <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8 }}>
                          <div>
                            <label style={{ fontSize:11,color:'var(--text-muted)',display:'block',marginBottom:4 }}>Día de inscripción</label>
                            <input type="number" min="1" max="31" placeholder="Ej: 20" value={ventanas[lugar].dia} onChange={e => setVentanas(prev => ({...prev,[lugar]:{...prev[lugar],dia:e.target.value}}))} style={{ width:'100%',padding:'7px 10px',border:'0.5px solid rgba(255,255,255,0.12)',borderRadius:6,fontSize:13,background:'#1e2130',color:'#e8eaf0',outline:'none' }} />
                          </div>
                          <div>
                            <label style={{ fontSize:11,color:'var(--text-muted)',display:'block',marginBottom:4 }}>Hora inicio</label>
                            <input type="time" value={ventanas[lugar].horaInicio} onChange={e => setVentanas(prev => ({...prev,[lugar]:{...prev[lugar],horaInicio:e.target.value}}))} style={{ width:'100%',padding:'7px 10px',border:'0.5px solid rgba(255,255,255,0.12)',borderRadius:6,fontSize:13,background:'#1e2130',color:'#e8eaf0',outline:'none' }} />
                          </div>
                          <div>
                            <label style={{ fontSize:11,color:'var(--text-muted)',display:'block',marginBottom:4 }}>Hora fin</label>
                            <input type="time" value={ventanas[lugar].horaFin} onChange={e => setVentanas(prev => ({...prev,[lugar]:{...prev[lugar],horaFin:e.target.value}}))} style={{ width:'100%',padding:'7px 10px',border:'0.5px solid rgba(255,255,255,0.12)',borderRadius:6,fontSize:13,background:'#1e2130',color:'#e8eaf0',outline:'none' }} />
                          </div>
                        </div>
                        <div style={{ marginTop:8,fontSize:10,color:'var(--text-muted)' }}>{ventanas[lugar].dia?`Inscripción habilitada el día ${ventanas[lugar].dia} de ${NOMBRE_MES_SOLO} de ${ventanas[lugar].horaInicio} a ${ventanas[lugar].horaFin}`:'Sin ventana configurada — inscripción bloqueada'}</div>
                      </div>
                    ))}
                    <button className="btn" style={{ width:'100%',justifyContent:'center',background:'rgba(200,168,75,0.15)',color:'#c8a84b',border:'0.5px solid rgba(200,168,75,0.4)' }} onClick={() => { localStorage.setItem('polad_ventanas', JSON.stringify(ventanas)); setVentanasGuardadas(true); setTimeout(()=>setVentanasGuardadas(false),2500) }}>Guardar ventanas de inscripción</button>
                    {ventanasGuardadas && <div className="alert alert-ok" style={{ marginTop:8,textAlign:'center' }}>Ventanas guardadas.</div>}
                  </div>
                </div>
              </div>
              <div className="panel">
                <div className="panel-header"><h3>Distribución de horas</h3></div>
                <div style={{ padding:16,display:'flex',flexDirection:'column',alignItems:'center' }}>
                  <svg width="200" height="200" viewBox="0 0 200 200">
                    {config.pctUniformados===0?<circle cx={cx} cy={cy} r={r} fill="#1D4A3A"/>:config.pctUniformados===100?<circle cx={cx} cy={cy} r={r} fill="#2a2560"/>:(
                      <><path d={`M ${cx} ${cy} L ${cx} ${cy-r} A ${r} ${r} 0 ${largeArc} 1 ${x1.toFixed(2)} ${y1.toFixed(2)} Z`} fill="#3d3a8a"/><path d={`M ${cx} ${cy} L ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${1-largeArc} 1 ${cx} ${cy-r} Z`} fill="#1D4A3A"/></>
                    )}
                    <circle cx={cx} cy={cy} r={50} fill="#13151f"/>
                    <text x={cx} y={cy-8} textAnchor="middle" fill="#e8eaf0" fontSize="18" fontWeight="500">{config.totalHoras}</text>
                    <text x={cx} y={cy+10} textAnchor="middle" fill="#8b90a0" fontSize="10">hs totales</text>
                  </svg>
                  <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,width:'100%',marginTop:8 }}>
                    <div style={{ background:'rgba(42,37,96,0.4)',borderRadius:8,padding:'10px 12px',border:'0.5px solid rgba(175,169,236,0.2)' }}>
                      <div style={{ fontSize:10,color:'#AFA9EC',marginBottom:4 }}>UNIFORMADOS</div>
                      <div style={{ fontSize:20,fontWeight:500,color:'#AFA9EC' }}>{hsU} hs</div>
                      <div style={{ fontSize:11,color:'var(--text-muted)',marginTop:2 }}>{uniformados.length} efectivos</div>
                      <div style={{ fontSize:11,color:'#AFA9EC',marginTop:4,fontWeight:500 }}>Hasta {maxU} hs c/u</div>
                    </div>
                    <div style={{ background:'rgba(13,51,40,0.4)',borderRadius:8,padding:'10px 12px',border:'0.5px solid rgba(93,202,165,0.2)' }}>
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
                  <div style={{ display:'flex',alignItems:'center',gap:8,marginBottom:14 }}>
                    <span style={{ fontSize:12,color:'var(--text-muted)' }}>Lugar:</span>
                    {['HIGA','UPA','MODULAR'].map(lg => (
                      <button key={lg} className="btn btn-sm" style={{ fontWeight:lugarPlanilla===lg?600:400,background:lugarPlanilla===lg?'rgba(200,168,75,0.15)':'transparent',color:lugarPlanilla===lg?'#c8a84b':'#8b90a0',border:lugarPlanilla===lg?'0.5px solid rgba(200,168,75,0.6)':'0.5px solid rgba(255,255,255,0.1)' }} onClick={() => setLugarPlanilla(lg)}>{lg}</button>
                    ))}
                    <span style={{ fontSize:11,color:'var(--text-hint)',marginLeft:8 }}>Horas separadas por lugar</span>
                  </div>
                  <div style={{ display:'flex',justifyContent:'flex-end',marginBottom:10 }}>
                    <button className="btn btn-sm" style={{ background:'rgba(29,158,117,0.15)',color:'#1D9E75',border:'0.5px solid rgba(29,158,117,0.4)',display:'flex',alignItems:'center',gap:6 }}
                      onClick={async () => {
                        try {
                          if (!window.JSZip) { await new Promise((res,rej) => { const s=document.createElement('script'); s.src='https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'; s.onload=res; s.onerror=rej; document.head.appendChild(s) }) }
                          const { data: asist } = await supabase.from('asistencia').select('legajo').eq('mes',MES).eq('anio',ANIO).eq('lugar',lugarPlanilla)
                          if (!asist||asist.length===0) { alert('No hay asistencias confirmadas para ' + lugarPlanilla); return }
                          const legajosConAsist = [...new Set(asist.map(a=>a.legajo))]
                          const efConAsist = efectivos.filter(e=>legajosConAsist.includes(e.legajo))
                          if (efConAsist.length===0) { alert('No hay efectivos con asistencia confirmada'); return }
                          const zip = new window.JSZip(); const carpeta = zip.folder('Planillas_'+NOMBRE_MES.replace(' ','_')); let generadas = 0
                          for (const ef of efConAsist) {
                            try {
                              const url = '/api/planilla-efectivo?legajo='+ef.legajo+'&mes='+MES+'&anio='+ANIO+'&lugar='+lugarPlanilla
                              const resp = await fetch(url); if (!resp.ok) continue
                              const blob = await resp.blob(); const arrBuf = await blob.arrayBuffer()
                              carpeta.file(ef.nombre.replace(/,/g,'').replace(/\s+/g,'_').substring(0,25)+'_'+ef.legajo+'.xlsx', arrBuf); generadas++
                            } catch(e) { console.error('Error', ef.legajo, e) }
                          }
                          if (generadas===0) { alert('No se pudieron generar las planillas'); return }
                          const zipBlob = await zip.generateAsync({ type:'blob',compression:'DEFLATE' })
                          const a = document.createElement('a'); a.href=URL.createObjectURL(zipBlob); a.download='Planillas_'+lugarPlanilla+'_'+NOMBRE_MES.replace(' ','_')+'.zip'; a.click(); URL.revokeObjectURL(a.href)
                          alert('✓ ZIP generado con ' + generadas + ' planillas')
                        } catch(e) { alert('Error: ' + e.message) }
                      }}>📦 Descargar todas las planillas (ZIP)</button>
                  </div>
                  <p style={{ fontSize:12,color:'var(--text-muted)',marginBottom:14 }}>Seleccioná un efectivo para ver y editar su planilla del mes.</p>
                  <div style={{ display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(250px,1fr))',gap:10 }}>
                    {efectivos.map(ef => {
                      const turnosEf = turnos[ef.legajo] || []
                      const hsPorL = horasAsigPorLugar[ef.legajo] || {}
                      const hsLugar = hsPorL[lugarPlanilla] || 0
                      return (
                        <div key={ef.legajo} style={{ background:'var(--surface)',border:'0.5px solid var(--border)',borderRadius:10,padding:'12px 14px',cursor:'pointer' }} onClick={() => cargarPlanillaEf(ef, lugarPlanilla)}>
                          <div style={{ fontSize:12,fontWeight:500,marginBottom:2 }}>{ef.nombre}</div>
                          <div style={{ fontSize:10,color:'var(--text-muted)',marginBottom:6 }}>Leg. {ef.legajo} · {ef.jerarquia||ef.tipo}</div>
                          <div style={{ display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:4 }}>
                            <BadgesLugar legajo={ef.legajo} />
                            <span style={{ display:'inline-flex',alignItems:'center',gap:4,fontSize:10 }}>
                              <span style={{ width:8,height:8,borderRadius:'50%',background:ef.firma_url?'#1D9E75':'#E24B4A',display:'inline-block' }}></span>
                              <span style={{ color:ef.firma_url?'#1D9E75':'#E24B4A' }}>{ef.firma_url?'Firma ✓':'Sin firma'}</span>
                            </span>
                          </div>
                          <div style={{ fontSize:11,color:'#c8a84b',fontWeight:500 }}>{lugarPlanilla}: {hsLugar} hs · {turnosEf.length} guardias totales</div>
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
                const total90 = Math.round(totalHoras * 0.9)
                return (
                  <div>
                    <div style={{ display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14 }}>
                      <div style={{ display:'flex',alignItems:'center',gap:10 }}>
                        <button className="btn btn-sm" onClick={() => setPlanillaEf(null)}>← Volver</button>
                        <span style={{ fontSize:14,fontWeight:500 }}>{ef.nombre}</span>
                        <span style={{ fontSize:11,color:'var(--text-muted)' }}>Leg. {ef.legajo} · {NOMBRE_MES_P} · {lugarPlanilla}</span>
                      </div>
                      <div style={{ display:'flex',gap:8 }}>
                        <button className="btn btn-sm" style={{ background:'rgba(29,158,117,0.15)',color:'#1D9E75',border:'0.5px solid rgba(29,158,117,0.4)' }}
                          onClick={async () => {
                            const url = `/api/planilla-efectivo?legajo=${ef.legajo}&mes=${MES}&anio=${ANIO}&lugar=${lugarPlanilla}`
                            const res = await fetch(url); if (!res.ok) { alert('Error al generar la planilla'); return }
                            const blob = await res.blob(); const a = document.createElement('a')
                            a.href = URL.createObjectURL(blob); a.download = `Planilla_${ef.nombre.replace(/,/g,'').replace(/\s+/g,'_')}_${lugarPlanilla}_${NOMBRE_MES}.xlsx`; a.click(); URL.revokeObjectURL(a.href)
                          }}>⬇ Planilla Excel</button>
                      </div>
                    </div>
                    <div style={{ display:'grid',gridTemplateColumns:'1fr 320px',gap:16 }}>
                      <div className="panel">
                        <div className="panel-header">
                          <h3>Guardias — {lugarPlanilla} · {NOMBRE_MES_P}</h3>
                          <span style={{ fontSize:11,color:'#1D9E75',fontWeight:500 }}>Total: {totalHoras} hs</span>
                        </div>
                        <div style={{ overflowX:'auto' }}>
                          <table>
                            <thead>
                              <tr>
                                <th style={{ width:50 }}>Día</th><th>Horario</th><th style={{ width:80 }}>Horas</th><th style={{ width:120 }}>Sector</th><th style={{ width:80 }}>Estado</th>
                              </tr>
                            </thead>
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
                                    <td style={{ color:e.horario.startsWith('08')?'#EF9F27':'#85B7EB',fontWeight:500 }}>{e.horario}</td>
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
                                        await guardarHoraManual(ef.legajo,manualDia,`${manualHorario} a ${manualHoras}`,Math.round(diff/60),'',lugarPlanilla)
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
                            {[['Nombre',ef.nombre],['Legajo',ef.legajo],['DNI',ef.dni||'—'],['Jerarquía',ef.jerarquia||'—'],['Tipo',ef.tipo],['Sector',ef.sector||'—']].map(([k,v])=>(
                              <div key={k} style={{ display:'flex',justifyContent:'space-between',padding:'5px 0',borderBottom:'0.5px solid var(--border)',fontSize:12 }}>
                                <span style={{ color:'var(--text-muted)' }}>{k}</span><span style={{ fontWeight:500 }}>{v}</span>
                              </div>
                            ))}
                            <div style={{ marginTop:8 }}><BadgesLugar legajo={ef.legajo} /></div>
                          </div>
                          {ef.notas && (
                            <div style={{ margin:'8px 12px',padding:'8px 10px',background:'rgba(200,168,75,0.08)',borderRadius:6,border:'0.5px solid rgba(200,168,75,0.3)' }}>
                              <div style={{ fontSize:10,color:'#c8a84b',fontWeight:500,marginBottom:3 }}>📝 Nota</div>
                              <div style={{ fontSize:11,color:'var(--text)',lineHeight:1.4 }}>{ef.notas}</div>
                            </div>
                          )}
                        </div>
                        <div className="panel">
                          <div className="panel-header"><h3>Firma del efectivo</h3></div>
                          <div style={{ padding:12 }}>
                            {firma ? (
                              <div>
                                <img src={firma} style={{ width:'100%',maxHeight:100,objectFit:'contain',marginBottom:8,background:'white',borderRadius:4,padding:4 }} alt="firma" />
                                <div style={{ display:'flex',gap:6,marginTop:4 }}>
                                  <button className="btn btn-sm" style={{ flex:1,justifyContent:'center',fontSize:11 }} onClick={() => { const inp=document.createElement('input'); inp.type='file'; inp.accept='image/*'; inp.onchange=e=>{ if(e.target.files[0]) subirFirmaAdmin(ef.legajo,e.target.files[0]) }; inp.click() }}>Cambiar</button>
                                  <button className="btn btn-sm" style={{ flex:1,justifyContent:'center',fontSize:11,color:'#F09595',borderColor:'rgba(240,149,149,0.3)' }} onClick={() => { if(confirm('¿Eliminar la firma de este efectivo?')) eliminarFirmaAdmin(ef.legajo) }}>Eliminar</button>
                                </div>
                                <p style={{ fontSize:10,color:'var(--text-hint)',marginTop:6,textAlign:'center' }}>La firma queda guardada para todos los meses</p>
                              </div>
                            ) : (
                              <div>
                                <div style={{ height:60,display:'flex',alignItems:'center',justifyContent:'center',marginBottom:8,border:'0.5px dashed var(--border)',borderRadius:6 }}>
                                  <span style={{ fontSize:11,color:'var(--text-hint)' }}>Sin firma</span>
                                </div>
                                <button className="btn btn-sm" style={{ width:'100%',justifyContent:'center',fontSize:11,background:'rgba(200,168,75,0.1)',color:'#c8a84b',border:'0.5px solid rgba(200,168,75,0.3)' }} onClick={() => { const inp=document.createElement('input'); inp.type='file'; inp.accept='image/*'; inp.onchange=e=>{ if(e.target.files[0]) subirFirmaAdmin(ef.legajo,e.target.files[0]) }; inp.click() }}>+ Subir firma</button>
                              </div>
                            )}
                          </div>
                        </div>
                        <div style={{ marginTop:10,padding:'10px 12px',background:'var(--surface2)',borderRadius:8 }}>
                          <div style={{ fontSize:11,color:'var(--text-muted)',marginBottom:4 }}>Total horas — {lugarPlanilla}</div>
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
          function fmtNombre(ef) {
            const jer = ef.jerarquia || ''; const partes = ef.nombre.split(',')
            const apellido = partes[0]?.trim() || ef.nombre; const inicial = partes[1]?.trim()[0] ? partes[1].trim()[0]+'.' : ''
            return jer ? (jer+' '+apellido+' '+inicial).trim() : (apellido+' '+inicial).trim()
          }
          const handleDescargar = async (fn, key) => { setDescargando(key); try { await fn() } catch(e) { alert('Error al generar: ' + e.message) }; setDescargando(null) }
          const lugares = [
            { key:'HIGA',label:'HIGA',color:'#AFA9EC',bg:'rgba(42,37,96,0.3)',desc:'5 sectores · 2 efectivos c/u · 3 hojas por turno',botones:[{label:'⬇ Turno DÍA 08:00-20:00',k:'higa-d',fn:()=>descargarPlanilla('HIGA','d')},{label:'⬇ Turno NOCHE 20:00-08:00',k:'higa-n',fn:()=>descargarPlanilla('HIGA','n')}] },
            { key:'UPA',label:'UPA',color:'#D85A30',bg:'rgba(80,30,10,0.3)',desc:'1 sector · 2 efectivos · Mes completo en 1 hoja',botones:[{label:'⬇ Turno DÍA 08:00-20:00',k:'upa-d',fn:()=>descargarPlanilla('UPA','d')},{label:'⬇ Turno NOCHE 20:00-08:00',k:'upa-n',fn:()=>descargarPlanilla('UPA','n')}] },
            { key:'MODULAR',label:'MODULAR',color:'#20A0B0',bg:'rgba(10,50,60,0.3)',desc:'1 sector · 3 efectivos · Mes completo en 1 hoja',botones:[{label:'⬇ Turno DÍA 08:00-20:00',k:'mod-d',fn:()=>descargarPlanilla('MODULAR','d')},{label:'⬇ Turno NOCHE 20:00-08:00',k:'mod-n',fn:()=>descargarPlanilla('MODULAR','n')}] }
          ]
          return (
            <div>
              <div style={{ marginBottom:20 }}>
                <h3 style={{ fontSize:15,fontWeight:500,marginBottom:6 }}>Descarga planilla de guardia mensual</h3>
                <p style={{ fontSize:12,color:'var(--text-muted)' }}>Generá y descargá las planillas de {NOMBRE_MES} por lugar y turno.</p>
              </div>
              <div style={{ display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(300px,1fr))',gap:16 }}>
                {lugares.map(lg => (
                  <div key={lg.key} style={{ background:'var(--surface)',border:`0.5px solid ${lg.color}44`,borderRadius:12,overflow:'hidden' }}>
                    <div style={{ padding:'14px 16px',background:lg.bg,borderBottom:`0.5px solid ${lg.color}33` }}>
                      <div style={{ fontSize:16,fontWeight:600,color:lg.color,marginBottom:4 }}>{lg.label}</div>
                      <div style={{ fontSize:11,color:'var(--text-muted)' }}>{lg.desc}</div>
                    </div>
                    <div style={{ padding:14,display:'flex',flexDirection:'column',gap:8 }}>
                      {lg.botones.map(btn => (
                        <button key={btn.k} disabled={!!descargando} style={{ display:'flex',alignItems:'center',gap:10,padding:'12px 14px',borderRadius:8,border:`0.5px solid ${lg.color}55`,background:descargando===btn.k?`${lg.color}22`:`${lg.color}11`,color:lg.color,cursor:descargando?'wait':'pointer',fontSize:12,fontWeight:500,width:'100%',opacity:descargando&&descargando!==btn.k?0.5:1 }} onClick={()=>handleDescargar(btn.fn,btn.k)}>
                          <span style={{ fontSize:18 }}>{descargando===btn.k?'⏳':'⬇'}</span>
                          <div style={{ textAlign:'left' }}>
                            <div>{btn.label}</div>
                            <div style={{ fontSize:10,opacity:0.7,marginTop:2 }}>{descargando===btn.k?'Generando archivo...':`${lg.key}_${btn.k.includes('-d')?'DIA':'NOCHE'}_${NOMBRE_MES}.xlsx`}</div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )
        })()}

      </div>
    </div>
  )
}
