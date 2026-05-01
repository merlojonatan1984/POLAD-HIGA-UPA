// v2.0 - rebuild import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../lib/supabase'

export const dynamic = 'force-dynamic'


const SECTORES = ['Salud Mental', 'Giratoria', 'Llaves', 'Guardia', 'Estacionamiento', 'UPA']
const SEC_COLORS = { 'Salud Mental': '#378ADD', 'Giratoria': '#1D9E75', 'Llaves': '#EF9F27', 'Guardia': '#D4537E', 'Estacionamiento': '#7F77DD', 'UPA': '#D85A30' }
const MES = new Date().getMonth() + 1
const ANIO = new Date().getFullYear()
const DIAS_MES = new Date(ANIO, MES, 0).getDate()
const NOMBRE_MES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'][MES-1] + ' ' + ANIO
const VISTAS = ['resumen', 'personal', 'disponibilidad', 'turnos', 'edicion', 'config']
const LABELS = { resumen: 'Resumen', personal: 'Personal', disponibilidad: 'Disponibilidad', turnos: 'Guardias', edicion: 'Edición manual', config: 'Configuración' }

function ModalTurno({ turno, efectivos, horasAsig, onClose, onGuardar, onEliminar, onAgregar }) {
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
    if (esNuevo) await onAgregar({ legajo: legajoSel, mes: MES, anio: ANIO, dia: diaSel, turno: turnoSel, sector: sectorSel })
    else await onGuardar({ ...turno, legajo: legajoSel, turno: turnoSel, sector: sectorSel })
    setGuardando(false)
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: '#13151f', borderRadius: 12, border: '0.5px solid rgba(255,255,255,0.1)', width: '100%', maxWidth: 440, overflow: 'hidden' }}>
        <div style={{ padding: '14px 16px', borderBottom: '0.5px solid rgba(255,255,255,0.08)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#1a1d27' }}>
          <h3 style={{ fontSize: 14, fontWeight: 500, color: '#e8eaf0' }}>{esNuevo ? 'Agregar turno manual' : 'Editar turno'}</h3>
          <button className="btn btn-sm" onClick={onClose}>Cerrar</button>
        </div>
        <div style={{ padding: 16 }}>
          {esNuevo && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
              <div>
                <label>Día del mes</label>
                <select value={diaSel} onChange={e => setDiaSel(parseInt(e.target.value))}>
                  {Array.from({ length: DIAS_MES }, (_, i) => <option key={i+1} value={i+1}>Día {i+1}</option>)}
                </select>
              </div>
              <div>
                <label>Sector</label>
                <select value={sectorSel} onChange={e => setSectorSel(e.target.value)}>
                  {SECTORES.map(s => <option key={s}>{s}</option>)}
                </select>
              </div>
            </div>
          )}
          {!esNuevo && (
            <div style={{ background: '#1a1d27', borderRadius: 8, padding: '8px 12px', marginBottom: 14, fontSize: 12, color: '#8b90a0' }}>
              Día {turno.dia} · {turno.sector}
            </div>
          )}
          <div style={{ marginBottom: 14 }}>
            <label>Turno</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn" style={{ flex: 1, justifyContent: 'center', background: turnoSel === 'd' ? '#3a2a0a' : 'transparent', color: turnoSel === 'd' ? '#EF9F27' : '#8b90a0', borderColor: turnoSel === 'd' ? '#BA7517' : 'rgba(255,255,255,0.1)' }} onClick={() => setTurnoSel('d')}>Día 08-20</button>
              <button className="btn" style={{ flex: 1, justifyContent: 'center', background: turnoSel === 'n' ? '#0d2040' : 'transparent', color: turnoSel === 'n' ? '#85B7EB' : '#8b90a0', borderColor: turnoSel === 'n' ? '#378ADD' : 'rgba(255,255,255,0.1)' }} onClick={() => setTurnoSel('n')}>Noche 20-08</button>
            </div>
          </div>
          <div style={{ marginBottom: 14 }}>
            <label>Efectivo</label>
            <select value={legajoSel} onChange={e => setLegajoSel(e.target.value)}>
              <option value="">— Seleccionar —</option>
              {efectivos.map(e => {
                const h = horasAsig[e.legajo] || 0
                return <option key={e.legajo} value={e.legajo}>{e.nombre} ({h} hs{h >= 180 ? ' ⚠ TOPE' : ''})</option>
              })}
            </select>
          </div>
          {efSel && (
            <div style={{ background: '#1a1d27', borderRadius: 8, padding: '10px 12px', fontSize: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#e8eaf0', fontWeight: 500 }}>{efSel.nombre}</span>
                <span style={{ color: colorHs, fontWeight: 500 }}>{hs} hs / 180</span>
              </div>
              {hs >= 180 && <div style={{ color: '#F09595', fontSize: 11, marginTop: 4 }}>Este efectivo alcanzó el tope de horas.</div>}
            </div>
          )}
        </div>
        <div style={{ padding: '12px 16px', borderTop: '0.5px solid rgba(255,255,255,0.06)', display: 'flex', justifyContent: 'space-between' }}>
          <div>
            {!esNuevo && !confirmElim && <button className="btn btn-sm" style={{ color: '#F09595', borderColor: 'rgba(240,149,149,0.3)' }} onClick={() => setConfirmElim(true)}>Eliminar</button>}
            {!esNuevo && confirmElim && (
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <span style={{ fontSize: 12, color: '#F09595' }}>¿Confirmar?</span>
                <button className="btn btn-sm" style={{ background: '#E24B4A', color: '#fff', border: 'none' }} onClick={() => onEliminar(turno)}>Sí</button>
                <button className="btn btn-sm" onClick={() => setConfirmElim(false)}>No</button>
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-sm" onClick={onClose}>Cancelar</button>
            <button className="btn btn-sm" disabled={!legajoSel || guardando} style={{ background: 'rgba(200,168,75,0.15)', color: '#c8a84b', border: '0.5px solid rgba(200,168,75,0.4)' }} onClick={handleGuardar}>
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
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: '#13151f', borderRadius: 12, border: '0.5px solid rgba(200,168,75,0.2)', width: '100%', maxWidth: 420, overflow: 'hidden' }}>
        <div style={{ padding: '14px 16px', borderBottom: '0.5px solid rgba(200,168,75,0.15)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(200,168,75,0.06)' }}>
          <h3 style={{ fontSize: 14, fontWeight: 500, color: '#c8a84b' }}>{esNuevo ? 'Dar de alta efectivo' : 'Editar efectivo'}</h3>
          <button className="btn btn-sm" onClick={onClose}>Cerrar</button>
        </div>
        <div style={{ padding: 16 }}>
          {msg && <div className={`alert ${msg.startsWith('Error') ? 'alert-err' : 'alert-ok'}`} style={{ marginBottom: 12 }}>{msg}</div>}
          <div style={{ marginBottom: 12 }}>
            <label>Legajo</label>
            <input type="text" placeholder="Ej: 71234" value={form.legajo || ''} disabled={!esNuevo}
              onChange={e => setForm({ ...form, legajo: e.target.value })}
              style={{ width: '100%', padding: '9px 11px', border: '0.5px solid rgba(255,255,255,0.12)', borderRadius: 8, fontSize: 14, background: esNuevo ? '#1e2130' : '#111', color: '#e8eaf0', outline: 'none' }} />
            {esNuevo && <p style={{ fontSize: 11, color: '#555b6e', marginTop: 4 }}>La contraseña inicial será el mismo número de legajo</p>}
          </div>
          <div style={{ marginBottom: 12 }}>
            <label>Apellido y nombre</label>
            <input type="text" placeholder="Ej: GARCÍA, MARCOS" value={form.nombre || ''}
              onChange={e => setForm({ ...form, nombre: e.target.value.toUpperCase() })}
              style={{ width: '100%', padding: '9px 11px', border: '0.5px solid rgba(255,255,255,0.12)', borderRadius: 8, fontSize: 14, background: '#1e2130', color: '#e8eaf0', outline: 'none' }} />
          </div>
          <div style={{ marginBottom: 12 }}>
            <label>Email</label>
            <input type="email" placeholder="ejemplo@gmail.com" value={form.email || ''}
              onChange={e => setForm({ ...form, email: e.target.value })}
              style={{ width: '100%', padding: '9px 11px', border: '0.5px solid rgba(255,255,255,0.12)', borderRadius: 8, fontSize: 14, background: '#1e2130', color: '#e8eaf0', outline: 'none' }} />
          </div>
          <div style={{ marginBottom: 12 }}>
            <label>Escalafón</label>
            <select value={form.tipo || 'Uniformado'} onChange={e => setForm({ ...form, tipo: e.target.value })}
              style={{ width: '100%', padding: '9px 11px', border: '0.5px solid rgba(255,255,255,0.12)', borderRadius: 8, fontSize: 14, background: '#1e2130', color: '#e8eaf0', outline: 'none' }}>
              <option>Uniformado</option>
              <option>Serv. General</option>
            </select>
          </div>
        </div>
        <div style={{ padding: '12px 16px', borderTop: '0.5px solid rgba(255,255,255,0.06)', display: 'flex', justifyContent: 'space-between' }}>
          <div>
            {!esNuevo && <button className="btn btn-sm" style={{ color: '#F09595', borderColor: 'rgba(240,149,149,0.3)' }} onClick={() => { if (confirm('¿Eliminar este efectivo?')) onEliminar(form) }}>Eliminar</button>}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-sm" onClick={onClose}>Cancelar</button>
            <button className="btn btn-sm" disabled={guardando || !form.legajo || !form.nombre}
              style={{ background: 'rgba(200,168,75,0.15)', color: '#c8a84b', border: '0.5px solid rgba(200,168,75,0.4)' }}
              onClick={() => onGuardar(form)}>
              {guardando ? 'Guardando...' : esNuevo ? 'Dar de alta' : 'Guardar'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function Admin() {
  const router = useRouter()
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
  const [filtroSector, setFiltroSector] = useState('Todos')
  const [filtroDia, setFiltroDia] = useState(1)
  const [config, setConfig] = useState({ totalHoras: 2400, pctUniformados: 60, pctGeneral: 40 })
  const [configGuardada, setConfigGuardada] = useState(false)

  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    const u = localStorage.getItem('polad_user')
    if (!u) { router.push('/'); return }
    const parsed = JSON.parse(u)
    if (!parsed.es_admin) { router.push('/efectivo'); return }
    cargarTodo()
  }, [])

  async function cargarTodo() {
    setLoading(true)
    const [{ data: efs }, { data: disp }, { data: turns }] = await Promise.all([
      supabase.from('efectivos').select('*').eq('es_admin', false).order('nombre'),
      supabase.from('disponibilidad').select('*').eq('mes', MES).eq('anio', ANIO),
      supabase.from('turnos').select('*').eq('mes', MES).eq('anio', ANIO)
    ])
    setEfectivos(efs || [])
    const dispMap = {}
    ;(disp || []).forEach(d => { if (!dispMap[d.legajo]) dispMap[d.legajo] = {}; dispMap[d.legajo][d.dia] = d.turno })
    setDisponibilidad(dispMap)
    const turnosMap = {}; const hsMap = {}
    ;(turns || []).forEach(t => { if (!turnosMap[t.legajo]) turnosMap[t.legajo] = []; turnosMap[t.legajo].push(t); hsMap[t.legajo] = (hsMap[t.legajo] || 0) + 12 })
    setTurnos(turnosMap)
    setHorasAsig(hsMap)
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
          const candidatos = pool.filter(e => {
            const avail = (disponibilidad[e.legajo] || {})[dia] || ''
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

  async function handleGuardarEdicion(t) { await supabase.from('turnos').update({ legajo: t.legajo, turno: t.turno, sector: t.sector }).eq('id', t.id); setModalTurno(null); await cargarTodo() }
  async function handleEliminarTurno(t) { await supabase.from('turnos').delete().eq('id', t.id); setModalTurno(null); await cargarTodo() }
  async function handleAgregarTurno(n) { await supabase.from('turnos').insert([n]); setModalTurno(null); await cargarTodo() }

  async function handleGuardarPersonal(datos) {
    setGuardandoPersonal(true)
    if (datos.id) {
      await supabase.from('efectivos').update({ nombre: datos.nombre, tipo: datos.tipo, email: datos.email || '', sector: datos.sector || 'Sin asignar' }).eq('id', datos.id)
      setMsgPersonal('Efectivo actualizado.')
    } else {
      const { error } = await supabase.from('efectivos').insert([{ legajo: datos.legajo, nombre: datos.nombre, tipo: datos.tipo, email: datos.email || '', sector: 'Sin asignar', es_admin: false }])
      if (error) { setMsgPersonal('Error: ' + (error.message.includes('duplicate') ? 'ese legajo ya existe.' : error.message)); setGuardandoPersonal(false); return }
      setMsgPersonal('Efectivo dado de alta. Clave inicial: ' + datos.legajo)
    }
    setGuardandoPersonal(false); await cargarTodo()
  }
  async function handleEliminarPersonal(ef) { await supabase.from('efectivos').delete().eq('id', ef.id); setModalPersonal(null); await cargarTodo() }

  if (!mounted || loading) return <div className="loading">Cargando...</div>

  const todosLosTurnos = Object.values(turnos).flat()
  const hayTurnos = todosLosTurnos.length > 0
  const cargaron = efectivos.filter(e => disponibilidad[e.legajo] && Object.keys(disponibilidad[e.legajo]).length > 0).length
  const nombreCompleto = leg => { const e = efectivos.find(x => x.legajo === leg); return e ? e.nombre : leg }
  const nombreCorto = leg => nombreCompleto(leg).split(',')[0]

  return (
    <div>
      {modalTurno && <ModalTurno turno={modalTurno} efectivos={efectivos} horasAsig={horasAsig} onClose={() => setModalTurno(null)} onGuardar={handleGuardarEdicion} onEliminar={handleEliminarTurno} onAgregar={handleAgregarTurno} />}
      {modalPersonal && <ModalPersonal datos={modalPersonal} onClose={() => { setModalPersonal(null); setMsgPersonal(null) }} onGuardar={handleGuardarPersonal} onEliminar={handleEliminarPersonal} guardando={guardandoPersonal} msg={msgPersonal} />}

      <div className="topbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 15, fontWeight: 500 }}>Panel Admin — POLAD</span>
          <span style={{ background: '#EEEDFE', color: '#3C3489', fontSize: 11, padding: '2px 8px', borderRadius: 3, fontWeight: 500 }}>Administrador</span>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {VISTAS.map(v => (
            <button key={v} className="btn btn-sm"
              style={{ fontWeight: vista === v ? 600 : 400, background: vista === v ? 'rgba(200,168,75,0.15)' : 'transparent', color: vista === v ? '#c8a84b' : '#8b90a0', border: vista === v ? '0.5px solid rgba(200,168,75,0.6)' : '0.5px solid rgba(255,255,255,0.1)' }}
              onClick={() => setVista(v)}>{LABELS[v]}</button>
          ))}
          <button className="btn btn-sm" style={{ background: 'rgba(200,168,75,0.15)', color: '#c8a84b', border: '0.5px solid rgba(200,168,75,0.4)' }} onClick={() => router.push('/control')}>Control asistencia</button>
          <button className="btn btn-sm" style={{ color: '#8b90a0' }} onClick={() => { localStorage.removeItem('polad_user'); router.push('/') }}>Salir</button>
        </div>
      </div>

      <div className="content">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: 16 }}>
          <div className="metric"><div className="metric-label">Efectivos</div><div className="metric-val">{efectivos.length}</div><div className="metric-sub">en el sistema</div></div>
          <div className="metric"><div className="metric-label">Cargaron disponib.</div><div className="metric-val">{cargaron}</div><div className="metric-sub">de {efectivos.length}</div></div>
          <div className="metric"><div className="metric-label">Turnos asignados</div><div className="metric-val">{todosLosTurnos.length}</div><div className="metric-sub">{NOMBRE_MES}</div></div>
          <div className="metric"><div className="metric-label">Estado</div><div className="metric-val" style={{ fontSize: 13, marginTop: 4, color: hayTurnos ? '#1D9E75' : '#8b90a0' }}>{hayTurnos ? 'Generado' : 'Sin generar'}</div><div className="metric-sub">{NOMBRE_MES}</div></div>
        </div>

        {vista === 'resumen' && (() => {
          const uniformados = efectivos.filter(e => e.tipo === 'Uniformado')
          const servGeneral = efectivos.filter(e => e.tipo === 'Serv. General')
          const renderGrupo = lista => lista.map(e => {
            const dias = Object.keys(disponibilidad[e.legajo] || {}).length
            const hs = horasAsig[e.legajo] || 0
            const pct = Math.round(hs / 180 * 100)
            const color = pct >= 100 ? '#E24B4A' : pct >= 80 ? '#EF9F27' : '#1D9E75'
            return (
              <div key={e.legajo} style={{ border: '0.5px solid var(--border)', borderRadius: 8, padding: '10px 12px', background: 'var(--surface2)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 500 }}>{e.nombre}</div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>Leg. {e.legajo}</div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1, display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span className="dot" style={{ background: SEC_COLORS[e.sector] || '#666', width: 6, height: 6 }}></span>{e.sector}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 16, fontWeight: 500, color }}>{hs}</div>
                    <div style={{ fontSize: 9, color: 'var(--text-hint)' }}>hs / 180</div>
                  </div>
                </div>
                <div style={{ marginTop: 6, fontSize: 11, color: dias > 0 ? '#1D9E75' : '#EF9F27' }}>{dias > 0 ? `${dias} días cargados` : 'Sin disponibilidad'}</div>
                <div className="hbar" style={{ width: '100%', marginTop: 4 }}><div className="hfill" style={{ width: `${Math.min(pct,100)}%`, background: color }}></div></div>
              </div>
            )
          })
          return (
            <div>
              <div className="panel" style={{ marginBottom: 16 }}>
                <div className="panel-header" style={{ background: 'rgba(42,37,96,0.5)' }}>
                  <h3 style={{ color: '#AFA9EC' }}>Uniformados — {uniformados.length} efectivos</h3>
                </div>
                <div style={{ padding: 14, display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(210px,1fr))', gap: 8 }}>{renderGrupo(uniformados)}</div>
              </div>
              <div className="panel">
                <div className="panel-header" style={{ background: 'rgba(13,51,40,0.5)' }}>
                  <h3 style={{ color: '#5DCAA5' }}>Servicio General — {servGeneral.length} efectivos</h3>
                </div>
                <div style={{ padding: 14, display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(210px,1fr))', gap: 8 }}>{renderGrupo(servGeneral)}</div>
              </div>
            </div>
          )
        })()}

        {vista === 'personal' && (() => {
          const uniformados = efectivos.filter(e => e.tipo === 'Uniformado')
          const servGeneral = efectivos.filter(e => e.tipo === 'Serv. General')
          const renderFichas = lista => lista.map(e => {
            const hs = horasAsig[e.legajo] || 0
            const pct = Math.round(hs / 180 * 100)
            const color = pct >= 100 ? '#E24B4A' : pct >= 80 ? '#EF9F27' : '#1D9E75'
            const turnosEf = turnos[e.legajo] || []
            const turnosDia = turnosEf.filter(t => t.turno === 'd').length
            const turnosNoche = turnosEf.filter(t => t.turno === 'n').length
            const iniciales = e.nombre.split(',').map(p => p.trim()[0]).join('').toUpperCase().slice(0, 2)
            return (
              <div key={e.legajo} className="card" style={{ padding: 0, overflow: 'hidden', cursor: 'pointer' }} onClick={() => { setMsgPersonal(null); setModalPersonal({ ...e }) }}>
                <div style={{ padding: '12px 14px', borderBottom: '0.5px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'rgba(200,168,75,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 500, color: '#c8a84b', flexShrink: 0 }}>{iniciales}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 500, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.nombre}</div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>Leg. {e.legajo} · {e.jerarquia || e.tipo}</div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontSize: 18, fontWeight: 500, color, lineHeight: 1 }}>{hs}</div>
                    <div style={{ fontSize: 9, color: 'var(--text-hint)' }}>hs / 180</div>
                  </div>
                </div>
                <div style={{ height: 4, background: 'rgba(255,255,255,0.05)', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${Math.min(pct,100)}%`, background: color }}></div>
                </div>
                <div style={{ padding: '10px 14px' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
                    <div style={{ background: '#3a2a0a', borderRadius: 6, padding: '6px 8px' }}>
                      <div style={{ fontSize: 9, color: '#EF9F27', marginBottom: 2 }}>Turnos día</div>
                      <div style={{ fontSize: 16, fontWeight: 500, color: '#EF9F27' }}>{turnosDia}</div>
                      <div style={{ fontSize: 9, color: '#854F0B' }}>{turnosDia * 12} hs</div>
                    </div>
                    <div style={{ background: '#0d2040', borderRadius: 6, padding: '6px 8px' }}>
                      <div style={{ fontSize: 9, color: '#85B7EB', marginBottom: 2 }}>Turnos noche</div>
                      <div style={{ fontSize: 16, fontWeight: 500, color: '#85B7EB' }}>{turnosNoche}</div>
                      <div style={{ fontSize: 9, color: '#185FA5' }}>{turnosNoche * 12} hs</div>
                    </div>
                  </div>
                  {e.email && turnosEf.length > 0 && (
                    <a href={(() => {
                      const lineas = turnosEf.sort((a,b)=>a.dia-b.dia).map(t=>`📅 Día ${t.dia} · ${t.turno==='d'?'Turno DÍA 08:00-20:00':'Turno NOCHE 20:00-08:00'} · ${t.sector}`).join('%0A')
                      return `mailto:${e.email}?subject=Guardias POLAD - ${NOMBRE_MES}&body=*POLAD · HIGA-UPA*%0A%0AEstimado/a ${e.nombre}%0ALegajo: ${e.legajo}%0A%0ATus guardias confirmadas para ${NOMBRE_MES}:%0A%0A${lineas}%0A%0A✅ Total: ${turnosEf.length*12} hs%0A%0APOLAD · HIGA-UPA`
                    })()} onClick={ev=>ev.stopPropagation()} style={{ display:'flex',alignItems:'center',justifyContent:'center',gap:6,padding:'6px 10px',borderRadius:6,border:'0.5px solid rgba(200,168,75,0.4)',background:'rgba(200,168,75,0.08)',color:'#c8a84b',fontSize:11,fontWeight:500,textDecoration:'none' }}>
                      ✉ Notificar por email
                    </a>
                  )}
                </div>
              </div>
            )
          })
          return (
            <div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
                <button className="btn btn-sm" style={{ background: 'rgba(200,168,75,0.15)', color: '#c8a84b', border: '0.5px solid rgba(200,168,75,0.4)' }}
                  onClick={() => { setMsgPersonal(null); setModalPersonal({ legajo: '', nombre: '', tipo: 'Uniformado', email: '', sector: 'Sin asignar' }) }}>
                  + Dar de alta efectivo
                </button>
              </div>
              <div className="panel" style={{ marginBottom: 16 }}>
                <div className="panel-header" style={{ background: 'rgba(42,37,96,0.5)' }}>
                  <h3 style={{ color: '#AFA9EC' }}>Uniformados — {uniformados.length} efectivos</h3>
                </div>
                <div style={{ padding: 14, display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))', gap: 10 }}>{renderFichas(uniformados)}</div>
              </div>
              <div className="panel">
                <div className="panel-header" style={{ background: 'rgba(13,51,40,0.5)' }}>
                  <h3 style={{ color: '#5DCAA5' }}>Servicio General — {servGeneral.length} efectivos</h3>
                </div>
                <div style={{ padding: 14, display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))', gap: 10 }}>{renderFichas(servGeneral)}</div>
              </div>
            </div>
          )
        })()}

        {vista === 'disponibilidad' && (
          <div>
            <div className="panel" style={{ marginBottom: 14 }}>
              <div className="panel-header"><h3>Disponibilidad cargada — {NOMBRE_MES}</h3></div>
              <div style={{ padding: 14, overflowX: 'auto' }}>
                <table style={{ tableLayout: 'fixed', width: 'max-content', minWidth: '100%' }}>
                  <thead>
                    <tr>
                      <th style={{ width: 130 }}>Efectivo</th>
                      {Array.from({ length: DIAS_MES }, (_, i) => <th key={i} style={{ width: 26, textAlign: 'center', padding: '8px 1px' }}>{i+1}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {efectivos.map(e => (
                      <tr key={e.legajo} style={{ cursor: 'pointer' }} onClick={() => setEfectivoDetalle(efDetalle === e.legajo ? null : e.legajo)}>
                        <td style={{ fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: efDetalle === e.legajo ? '#c8a84b' : 'var(--text)', fontWeight: efDetalle === e.legajo ? 500 : 400 }}>{e.nombre}</td>
                        {Array.from({ length: DIAS_MES }, (_, i) => {
                          const v = (disponibilidad[e.legajo] || {})[i+1] || ''
                          const bg = v==='dn'?'#0d2b1a':v==='d'?'#3a2a0a':v==='n'?'#0d2040':'var(--surface2)'
                          const label = v==='dn'?'A':v==='d'?'D':v==='n'?'N':'·'
                          const color = v==='dn'?'#5DCAA5':v==='d'?'#EF9F27':v==='n'?'#85B7EB':'#444'
                          return <td key={i} style={{ textAlign: 'center', padding: '3px 1px' }}><span style={{ display:'inline-block',width:20,height:16,background:bg,borderRadius:3,fontSize:9,fontWeight:500,lineHeight:'16px',color }}>{label}</span></td>
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            {efDetalle && (() => {
              const e = efectivos.find(x => x.legajo === efDetalle)
              if (!e) return null
              const disp = disponibilidad[e.legajo] || {}
              const primerDia = (new Date(ANIO, MES-1, 1).getDay() + 6) % 7
              const turnosEf = turnos[e.legajo] || []
              return (
                <div className="panel">
                  <div className="panel-header" style={{ background: 'rgba(200,168,75,0.08)' }}>
                    <h3 style={{ color: '#c8a84b' }}>{e.nombre} — Leg. {e.legajo}</h3>
                    <button className="btn btn-sm" onClick={() => setEfectivoDetalle(null)}>Cerrar</button>
                  </div>
                  <div style={{ padding: 14 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 2, marginBottom: 6 }}>
                      {['Lu','Ma','Mi','Ju','Vi','Sá','Do'].map(d => <div key={d} style={{ textAlign:'center',fontSize:11,color:'var(--text-muted)',padding:'4px 0' }}>{d}</div>)}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 3 }}>
                      {Array.from({ length: primerDia }).map((_,i) => <div key={`e-${i}`}></div>)}
                      {Array.from({ length: DIAS_MES }, (_, i) => i+1).map(dia => {
                        const v = disp[dia] || ''
                        const bg = v==='dn'?'#0d2b1a':v==='d'?'#3a2a0a':v==='n'?'#0d2040':'var(--surface2)'
                        const bc = v==='dn'?'#1D9E75':v==='d'?'#BA7517':v==='n'?'#378ADD':'var(--border)'
                        const tsDia = turnosEf.filter(t => t.dia === dia)
                        return (
                          <div key={dia} style={{ border:`0.5px solid ${bc}`,borderRadius:6,padding:'5px 4px',minHeight:52,background:bg,cursor:'pointer' }}
                            onClick={() => setModalTurno({ dia, sector: SECTORES[0], turno: 'd', legajo: e.legajo })}>
                            <div style={{ fontSize:11,fontWeight:500,color:'var(--text-muted)',marginBottom:2 }}>{dia}</div>
                            {v && <div style={{ fontSize:9,color:v==='dn'?'#5DCAA5':v==='d'?'#EF9F27':'#85B7EB' }}>{v==='dn'?'Ambos':v==='d'?'Día':'Noche'}</div>}
                            {tsDia.map(t => <div key={t.id} style={{ fontSize:8,background:t.turno==='d'?'#3a2a0a':'#0d2040',color:t.turno==='d'?'#EF9F27':'#85B7EB',borderRadius:2,padding:'1px 3px',marginTop:1 }}>{t.turno==='d'?'D':'N'} {t.sector.split(' ')[0]}</div>)}
                          </div>
                        )
                      })}
                    </div>
                    <div style={{ marginTop: 10, fontSize: 11, color: 'var(--text-muted)' }}>Hacé clic en cualquier día para agregar un turno manual a este efectivo.</div>
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
              <button className="btn btn-success" onClick={generarTurnos} disabled={generando}>
                {generando ? 'Generando...' : hayTurnos ? 'Regenerar turnos' : 'Generar turnos automáticamente'}
              </button>
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
                        {Array.from({ length: DIAS_MES }, (_, i) => <th key={i} style={{ width:76,textAlign:'center',padding:'8px 3px' }}>{i+1}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {SECTORES.map(sector => (
                        <tr key={sector}>
                          <td><span style={{ display:'inline-flex',alignItems:'center',gap:4,fontSize:11 }}><span className="dot" style={{ background:SEC_COLORS[sector] }}></span>{sector}</span></td>
                          {Array.from({ length: DIAS_MES }, (_, i) => {
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
                {Array.from({ length: DIAS_MES }, (_, i) => i+1).map(d => (
                  <button key={d} className="btn btn-sm"
                    style={{ minWidth:32,padding:'4px 6px',fontSize:11,background:d===filtroDia?'rgba(200,168,75,0.15)':'transparent',color:d===filtroDia?'#c8a84b':'var(--text-muted)',border:d===filtroDia?'0.5px solid rgba(200,168,75,0.6)':'0.5px solid rgba(255,255,255,0.1)' }}
                    onClick={() => setFiltroDia(d)}>{d}</button>
                ))}
              </div>
            </div>
            <div style={{ marginBottom:12,display:'flex',justifyContent:'space-between',alignItems:'center' }}>
              <h3 style={{ fontSize:14,fontWeight:500 }}>Día {filtroDia} — {NOMBRE_MES}</h3>
              <button className="btn btn-primary btn-sm" onClick={() => setModalTurno({ dia:filtroDia,sector:SECTORES[0],turno:'d',legajo:'' })}>+ Agregar turno</button>
            </div>
            <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:12 }}>
              {SECTORES.map(sector => {
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
          const x1 = cx + r * Math.sin(angU)
          const y1 = cy - r * Math.cos(angU)
          const largeArc = config.pctUniformados > 50 ? 1 : 0
          return (
            <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:16 }}>
              <div className="panel">
                <div className="panel-header"><h3>Horas otorgadas por Provincia</h3></div>
                <div style={{ padding:16 }}>
                  <div style={{ marginBottom:16 }}>
                    <label style={{ fontSize:12,color:'var(--text-muted)',marginBottom:6,display:'block' }}>Total de horas del mes</label>
                    <input type="number" value={config.totalHoras} min="0"
                      onChange={e => setConfig({...config,totalHoras:parseInt(e.target.value)||0})}
                      style={{ width:'100%',padding:'10px 12px',border:'0.5px solid rgba(200,168,75,0.3)',borderRadius:8,fontSize:18,fontWeight:500,background:'#1e2130',color:'#c8a84b',outline:'none',textAlign:'center' }} />
                  </div>
                  <div style={{ marginBottom:12 }}>
                    <label style={{ fontSize:12,color:'#AFA9EC',marginBottom:6,display:'block' }}>% Uniformados — {config.pctUniformados}%</label>
                    <input type="range" min="0" max="100" value={config.pctUniformados}
                      onChange={e => { const v=parseInt(e.target.value); setConfig({...config,pctUniformados:v,pctGeneral:100-v}) }}
                      style={{ width:'100%',accentColor:'#AFA9EC' }} />
                  </div>
                  <div style={{ marginBottom:16 }}>
                    <label style={{ fontSize:12,color:'#5DCAA5',marginBottom:6,display:'block' }}>% Serv. General — {config.pctGeneral}%</label>
                    <input type="range" min="0" max="100" value={config.pctGeneral}
                      onChange={e => { const v=parseInt(e.target.value); setConfig({...config,pctGeneral:v,pctUniformados:100-v}) }}
                      style={{ width:'100%',accentColor:'#5DCAA5' }} />
                  </div>
                  <button className="btn" style={{ width:'100%',justifyContent:'center',background:'rgba(200,168,75,0.15)',color:'#c8a84b',border:'0.5px solid rgba(200,168,75,0.4)' }}
                    onClick={() => { setConfigGuardada(true); setTimeout(()=>setConfigGuardada(false),2500) }}>
                    Guardar configuración
                  </button>
                  {configGuardada && <div className="alert alert-ok" style={{ marginTop:10,textAlign:'center' }}>Configuración guardada.</div>}
                </div>
              </div>
              <div className="panel">
                <div className="panel-header"><h3>Distribución de horas</h3></div>
                <div style={{ padding:16,display:'flex',flexDirection:'column',alignItems:'center' }}>
                  <svg width="200" height="200" viewBox="0 0 200 200">
                    {config.pctUniformados===0 ? <circle cx={cx} cy={cy} r={r} fill="#1D4A3A" /> :
                     config.pctUniformados===100 ? <circle cx={cx} cy={cy} r={r} fill="#2a2560" /> : (
                      <>
                        <path d={`M ${cx} ${cy} L ${cx} ${cy-r} A ${r} ${r} 0 ${largeArc} 1 ${x1.toFixed(2)} ${y1.toFixed(2)} Z`} fill="#3d3a8a" />
                        <path d={`M ${cx} ${cy} L ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${1-largeArc} 1 ${cx} ${cy-r} Z`} fill="#1D4A3A" />
                      </>
                    )}
                    <circle cx={cx} cy={cy} r={50} fill="#13151f" />
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
      </div>
    </div>
  )
}
