import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../lib/supabase'

const SECTORES = ['Salud Mental', 'Giratoria', 'Llaves', 'Guardia', 'Estacionamiento', 'UPA']
const SEC_COLORS = { 'Salud Mental': '#378ADD', 'Giratoria': '#1D9E75', 'Llaves': '#EF9F27', 'Guardia': '#D4537E', 'Estacionamiento': '#7F77DD', 'UPA': '#D85A30' }
const MES = new Date().getMonth() + 1
const ANIO = new Date().getFullYear()
const DIAS_MES = new Date(ANIO, MES, 0).getDate()
const NOMBRE_MES = new Date(ANIO, MES - 1, 1).toLocaleString('es-AR', { month: 'long', year: 'numeric' })

function ModalEdicion({ turno, efectivos, horasAsig, onClose, onGuardar, onEliminar, onAgregar }) {
  const esNuevo = !turno.id
  const [legajoSel, setLegajoSel] = useState(turno.legajo || '')
  const [turnoSel, setTurnoSel] = useState(turno.turno || 'd')
  const [sectorSel, setSectorSel] = useState(turno.sector || SECTORES[0])
  const [diaSel, setDiaSel] = useState(turno.dia || 1)
  const [guardando, setGuardando] = useState(false)
  const [confirmElim, setConfirmElim] = useState(false)

  const efSel = efectivos.find(e => e.legajo === legajoSel)
  const hsActuales = horasAsig[legajoSel] || 0
  const hsFinales = esNuevo ? hsActuales + 12 : hsActuales
  const colorHs = hsFinales >= 180 ? '#A32D2D' : hsFinales >= 150 ? '#BA7517' : '#1D9E75'

  async function handleGuardar() {
    if (!legajoSel) return
    setGuardando(true)
    if (esNuevo) {
      await onAgregar({ legajo: legajoSel, mes: MES, anio: ANIO, dia: diaSel, turno: turnoSel, sector: sectorSel })
    } else {
      await onGuardar({ ...turno, legajo: legajoSel, turno: turnoSel, sector: sectorSel })
    }
    setGuardando(false)
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: '#fff', borderRadius: 12, border: '0.5px solid rgba(0,0,0,0.1)', width: '100%', maxWidth: 440, overflow: 'hidden' }}>
        <div style={{ padding: '14px 16px', borderBottom: '0.5px solid rgba(0,0,0,0.1)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f8f8f6' }}>
          <h3 style={{ fontSize: 14, fontWeight: 500 }}>{esNuevo ? 'Agregar turno manual' : 'Editar turno'}</h3>
          <button className="btn btn-sm" onClick={onClose}>Cerrar</button>
        </div>
        <div style={{ padding: 16 }}>
          {!esNuevo && (
            <div style={{ background: '#f8f8f6', borderRadius: 8, padding: '10px 12px', marginBottom: 14, fontSize: 12 }}>
              <span style={{ color: '#666' }}>Editando: </span>
              <strong>Día {turno.dia}</strong>
              <span className={`chip ${turno.turno === 'd' ? 'chip-d' : 'chip-n'}`} style={{ margin: '0 6px' }}>{turno.turno === 'd' ? '08-20' : '20-08'}</span>
              {turno.sector}
            </div>
          )}
          {esNuevo && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
              <div>
                <label>Día del mes</label>
                <select value={diaSel} onChange={e => setDiaSel(parseInt(e.target.value))}>
                  {Array.from({ length: DIAS_MES }, (_, i) => (
                    <option key={i + 1} value={i + 1}>Día {i + 1}</option>
                  ))}
                </select>
              </div>
              <div>
                <label>Sector</label>
                <select value={sectorSel} onChange={e => setSectorSel(e.target.value)}>
                  {SECTORES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
          )}
          <div style={{ marginBottom: 14 }}>
            <label>Turno</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn" style={{ flex: 1, justifyContent: 'center', background: turnoSel === 'd' ? '#FAEEDA' : '', borderColor: turnoSel === 'd' ? '#EF9F27' : '', color: turnoSel === 'd' ? '#633806' : '' }} onClick={() => setTurnoSel('d')}>
                Día 08:00 – 20:00
              </button>
              <button className="btn" style={{ flex: 1, justifyContent: 'center', background: turnoSel === 'n' ? '#E6F1FB' : '', borderColor: turnoSel === 'n' ? '#378ADD' : '', color: turnoSel === 'n' ? '#042C53' : '' }} onClick={() => setTurnoSel('n')}>
                Noche 20:00 – 08:00
              </button>
            </div>
          </div>
          <div style={{ marginBottom: 14 }}>
            <label>Efectivo asignado</label>
            <select value={legajoSel} onChange={e => setLegajoSel(e.target.value)}>
              <option value="">— Seleccionar efectivo —</option>
              {efectivos.map(e => {
                const hs = horasAsig[e.legajo] || 0
                const alerta = hs >= 180 ? ' ⚠ TOPE' : hs >= 150 ? ' ⚠ cerca límite' : ''
                return <option key={e.legajo} value={e.legajo}>{e.nombre} ({hs} hs{alerta})</option>
              })}
            </select>
          </div>
          {efSel && (
            <div style={{ background: '#f8f8f6', borderRadius: 8, padding: '10px 12px', marginBottom: 4, fontSize: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 500 }}>{efSel.nombre}</div>
                  <div style={{ color: '#666', marginTop: 2 }}>{efSel.tipo} · {efSel.sector}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 15, fontWeight: 500, color: colorHs }}>{hsFinales} hs</div>
                  <div style={{ fontSize: 10, color: '#999' }}>de 180 máx.</div>
                </div>
              </div>
              {hsFinales > 180 && (
                <div style={{ marginTop: 8, background: '#FCEBEB', color: '#791F1F', borderRadius: 6, padding: '6px 8px', fontSize: 11 }}>
                  Este efectivo superará el tope de 180 hs con esta asignación.
                </div>
              )}
            </div>
          )}
        </div>
        <div style={{ padding: '12px 16px', borderTop: '0.5px solid rgba(0,0,0,0.1)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            {!esNuevo && !confirmElim && (
              <button className="btn btn-sm" style={{ color: '#A32D2D', borderColor: '#F09595' }} onClick={() => setConfirmElim(true)}>Eliminar turno</button>
            )}
            {!esNuevo && confirmElim && (
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <span style={{ fontSize: 12, color: '#791F1F' }}>¿Confirmar?</span>
                <button className="btn btn-sm" style={{ background: '#E24B4A', color: '#fff', borderColor: '#E24B4A' }} onClick={() => onEliminar(turno)}>Sí, eliminar</button>
                <button className="btn btn-sm" onClick={() => setConfirmElim(false)}>No</button>
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-sm" onClick={onClose}>Cancelar</button>
            <button className="btn btn-primary btn-sm" onClick={handleGuardar} disabled={!legajoSel || guardando}>
              {guardando ? 'Guardando...' : esNuevo ? 'Agregar turno' : 'Guardar cambios'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function Admin() {
  const router = useRouter()
  const [user, setUser] = useState(null)
  const [vista, setVista] = useState('resumen')
  const [efectivos, setEfectivos] = useState([])
  const [disponibilidad, setDisponibilidad] = useState({})
  const [turnos, setTurnos] = useState({})
  const [horasAsig, setHorasAsig] = useState({})
  const [loading, setLoading] = useState(true)
  const [generando, setGenerando] = useState(false)
  const [msgGen, setMsgGen] = useState(null)
  const [modalTurno, setModalTurno] = useState(null)
  const [efDetalle, setEfectivoDetalle] = useState(null)
  const [filtroSector, setFiltroSector] = useState('Todos')
  const [filtroDia, setFiltroDia] = useState(0)

  useEffect(() => {
    const u = localStorage.getItem('polad_user')
    if (!u) { router.push('/'); return }
    const parsed = JSON.parse(u)
    if (!parsed.es_admin) { router.push('/efectivo'); return }
    setUser(parsed)
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
    ;(disp || []).forEach(d => {
      if (!dispMap[d.legajo]) dispMap[d.legajo] = {}
      dispMap[d.legajo][d.dia] = d.turno
    })
    setDisponibilidad(dispMap)
    const turnosMap = {}
    const hsMap = {}
    ;(turns || []).forEach(t => {
      if (!turnosMap[t.legajo]) turnosMap[t.legajo] = []
      turnosMap[t.legajo].push(t)
      hsMap[t.legajo] = (hsMap[t.legajo] || 0) + 12
    })
    setTurnos(turnosMap)
    setHorasAsig(hsMap)
    setLoading(false)
  }

  async function generarTurnos() {
    setGenerando(true)
    setMsgGen(null)
    await supabase.from('turnos').delete().eq('mes', MES).eq('anio', ANIO)
    const pool = efectivos.map(e => ({ ...e, hs: 0 }))
    const nuevos = []
    for (let dia = 1; dia <= DIAS_MES; dia++) {
      for (const turno of ['d', 'n']) {
        for (const sector of SECTORES) {
          const candidatos = pool.filter(e => {
            const avail = (disponibilidad[e.legajo] || {})[dia] || ''
            return ((turno === 'd' && (avail === 'd' || avail === 'dn')) ||
                    (turno === 'n' && (avail === 'n' || avail === 'dn'))) && e.hs < 180
          })
          candidatos.sort((a, b) => a.hs - b.hs)
          candidatos.slice(0, 2).forEach(e => {
            e.hs += 12
            nuevos.push({ legajo: e.legajo, mes: MES, anio: ANIO, dia, turno, sector })
          })
        }
      }
    }
    for (let i = 0; i < nuevos.length; i += 500) {
      await supabase.from('turnos').insert(nuevos.slice(i, i + 500))
    }
    setMsgGen(`Se generaron ${nuevos.length} asignaciones para ${NOMBRE_MES}.`)
    await cargarTodo()
    setGenerando(false)
  }

  async function handleGuardarEdicion(t) {
    await supabase.from('turnos').update({ legajo: t.legajo, turno: t.turno, sector: t.sector }).eq('id', t.id)
    setModalTurno(null)
    await cargarTodo()
  }

  async function handleEliminarTurno(t) {
    await supabase.from('turnos').delete().eq('id', t.id)
    setModalTurno(null)
    await cargarTodo()
  }

  async function handleAgregarTurno(nuevo) {
    await supabase.from('turnos').insert([nuevo])
    setModalTurno(null)
    await cargarTodo()
  }

  if (loading) return <div className="loading">Cargando panel...</div>

  const cargaron = efectivos.filter(e => disponibilidad[e.legajo] && Object.keys(disponibilidad[e.legajo]).length > 0).length
  const todosLosTurnos = Object.values(turnos).flat()
  const hayTurnos = todosLosTurnos.length > 0
  const nombreCorto = leg => { const e = efectivos.find(x => x.legajo === leg); return e ? e.nombre.split(',')[0] : leg }
  const nombreCompleto = leg => { const e = efectivos.find(x => x.legajo === leg); return e ? e.nombre : leg }

  const turnosFiltrados = todosLosTurnos
    .filter(t => (filtroSector === 'Todos' || t.sector === filtroSector) && (filtroDia === 0 || t.dia === filtroDia))
    .sort((a, b) => a.dia - b.dia || a.sector.localeCompare(b.sector) || a.turno.localeCompare(b.turno))

  const VISTAS = ['resumen', 'efectivos', 'disponibilidad', 'turnos', 'edicion']
  const LABELS = { resumen: 'Resumen', efectivos: 'Efectivos', disponibilidad: 'Disponibilidad', turnos: 'Guardias', edicion: 'Edición manual' }

  return (
    <div>
      {modalTurno && (
        <ModalEdicion turno={modalTurno} efectivos={efectivos} horasAsig={horasAsig}
          onClose={() => setModalTurno(null)} onGuardar={handleGuardarEdicion}
          onEliminar={handleEliminarTurno} onAgregar={handleAgregarTurno} />
      )}

      <div className="topbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 15, fontWeight: 500 }}>Panel Admin — POLAD</span>
          <span style={{ background: '#EEEDFE', color: '#3C3489', fontSize: 11, padding: '2px 8px', borderRadius: 3, fontWeight: 500 }}>Administrador</span>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {VISTAS.filter(v => v !== 'efectivos').map(v => (
            <button key={v} className="btn btn-sm"
              style={{ fontWeight: vista === v ? 600 : 400, background: vista === v ? 'rgba(200,168,75,0.15)' : 'transparent', color: vista === v ? '#c8a84b' : '#8b90a0', border: vista === v ? '0.5px solid rgba(200,168,75,0.6)' : '0.5px solid rgba(255,255,255,0.1)' }}
              onClick={() => setVista(v)}>
              {LABELS[v]}
            </button>
          ))}
          <button className="btn btn-sm" onClick={() => { localStorage.removeItem('polad_user'); router.push('/') }}>Salir</button>
        </div>
      </div>

      <div className="content">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 16 }}>
          <div className="metric"><div className="metric-label">Efectivos</div><div className="metric-val">{efectivos.length}</div><div className="metric-sub">en el sistema</div></div>
          <div className="metric"><div className="metric-label">Cargaron disponib.</div><div className="metric-val">{cargaron}</div><div className="metric-sub">de {efectivos.length}</div></div>
          <div className="metric"><div className="metric-label">Turnos asignados</div><div className="metric-val">{todosLosTurnos.length}</div><div className="metric-sub">{NOMBRE_MES}</div></div>
          <div className="metric"><div className="metric-label">Estado</div><div className="metric-val" style={{ fontSize: 13, marginTop: 4, color: hayTurnos ? '#1D9E75' : '#999' }}>{hayTurnos ? 'Generado' : 'Sin generar'}</div><div className="metric-sub">{NOMBRE_MES}</div></div>
        </div>

        {vista === 'resumen' && (() => {
          const uniformados = efectivos.filter(e => e.tipo === 'Uniformado')
          const servGeneral = efectivos.filter(e => e.tipo === 'Serv. General')
          const renderGrupo = (lista) => lista.map(e => {
            const dias = Object.keys(disponibilidad[e.legajo] || {}).length
            const hs = horasAsig[e.legajo] || 0
            const pct = Math.round(hs / 180 * 100)
            const color = pct >= 100 ? '#E24B4A' : pct >= 80 ? '#EF9F27' : '#1D9E75'
            return (
              <div key={e.legajo} style={{ border: '0.5px solid var(--border)', borderRadius: 8, padding: '10px 12px', background: 'var(--surface2)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text)' }}>{e.nombre}</div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>Leg. {e.legajo}</div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span className="dot" style={{ background: SEC_COLORS[e.sector], width: 6, height: 6 }}></span>{e.sector}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 16, fontWeight: 500, color }}>{hs}</div>
                    <div style={{ fontSize: 9, color: 'var(--text-hint)' }}>hs / 180</div>
                  </div>
                </div>
                <div style={{ marginTop: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 11, color: dias > 0 ? '#1D9E75' : '#EF9F27' }}>{dias > 0 ? `${dias} días cargados` : 'Sin cargar'}</span>
                </div>
                <div className="hbar" style={{ width: '100%', marginTop: 4 }}><div className="hfill" style={{ width: `${Math.min(pct, 100)}%`, background: color }}></div></div>
              </div>
            )
          })
          return (
            <div>
              <div className="panel" style={{ marginBottom: 16 }}>
                <div className="panel-header" style={{ background: 'rgba(42,37,96,0.5)', borderBottom: '0.5px solid rgba(175,169,236,0.2)' }}>
                  <h3 style={{ color: '#AFA9EC' }}>Uniformados — {uniformados.length} efectivos</h3>
                  <span style={{ fontSize: 11, color: '#AFA9EC' }}>{uniformados.filter(e => (horasAsig[e.legajo]||0) > 0).length} con horas asignadas</span>
                </div>
                <div style={{ padding: 14, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: 8 }}>
                  {renderGrupo(uniformados)}
                </div>
              </div>
              <div className="panel">
                <div className="panel-header" style={{ background: 'rgba(13,51,40,0.5)', borderBottom: '0.5px solid rgba(93,202,165,0.2)' }}>
                  <h3 style={{ color: '#5DCAA5' }}>Servicio General — {servGeneral.length} efectivos</h3>
                  <span style={{ fontSize: 11, color: '#5DCAA5' }}>{servGeneral.filter(e => (horasAsig[e.legajo]||0) > 0).length} con horas asignadas</span>
                </div>
                <div style={{ padding: 14, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: 8 }}>
                  {renderGrupo(servGeneral)}
                </div>
              </div>
            </div>
          )
        })()}

        {vista === 'efectivos' && (() => {
          const totalHs = efectivos.reduce((sum, e) => sum + (horasAsig[e.legajo] || 0), 0)
          const promedioHs = efectivos.length ? Math.round(totalHs / efectivos.length) : 0
          const enTope = efectivos.filter(e => (horasAsig[e.legajo] || 0) >= 180).length
          const sinCargar = efectivos.filter(e => !disponibilidad[e.legajo] || Object.keys(disponibilidad[e.legajo]).length === 0).length
          return (
            <div>
              {/* Resumen superior */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 16 }}>
                <div className="metric"><div className="metric-label">Total horas asignadas</div><div className="metric-val">{totalHs}</div><div className="metric-sub">entre todos los efectivos</div></div>
                <div className="metric"><div className="metric-label">Promedio por efectivo</div><div className="metric-val">{promedioHs} hs</div><div className="metric-sub">de 180 máximo</div></div>
                <div className="metric"><div className="metric-label">En tope (180 hs)</div><div className="metric-val" style={{ color: enTope > 0 ? '#A32D2D' : '#1D9E75' }}>{enTope}</div><div className="metric-sub">efectivos al límite</div></div>
                <div className="metric"><div className="metric-label">Sin disponibilidad</div><div className="metric-val" style={{ color: sinCargar > 0 ? '#BA7517' : '#1D9E75' }}>{sinCargar}</div><div className="metric-sub">aún no cargaron</div></div>
              </div>

              {/* Fichas de efectivos */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
                {efectivos.map(e => {
                  const hs = horasAsig[e.legajo] || 0
                  const pct = Math.round(hs / 180 * 100)
                  const color = pct >= 100 ? '#A32D2D' : pct >= 80 ? '#BA7517' : '#1D9E75'
                  const colorBg = pct >= 100 ? '#FCEBEB' : pct >= 80 ? '#FAEEDA' : '#EAF3DE'
                  const turnosEf = (turnos[e.legajo] || [])
                  const turnosDia = turnosEf.filter(t => t.turno === 'd').length
                  const turnosNoche = turnosEf.filter(t => t.turno === 'n').length
                  const diasDisp = Object.keys(disponibilidad[e.legajo] || {}).length
                  const iniciales = e.nombre.split(',').map(p => p.trim()[0]).join('').toUpperCase().slice(0, 2)
                  const hsRestantes = 180 - hs

                  return (
                    <div key={e.legajo} className="card" style={{ padding: 0, overflow: 'hidden' }}>
                      {/* Header de la ficha */}
                      <div style={{ padding: '12px 14px', borderBottom: '0.5px solid rgba(0,0,0,0.08)', display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div style={{ width: 42, height: 42, borderRadius: '50%', background: colorBg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 500, color, flexShrink: 0 }}>
                          {iniciales}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 500, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.nombre}</div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
                            <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#666', background: '#f5f5f3', padding: '1px 6px', borderRadius: 4 }}>Leg. {e.legajo}</span>
                            <span className={`tag ${e.tipo === 'Uniformado' ? 'tag-u' : 'tag-g'}`}>{e.tipo}</span>
                          </div>
                        </div>
                        <div style={{ textAlign: 'right', flexShrink: 0 }}>
                          <div style={{ fontSize: 20, fontWeight: 500, color, lineHeight: 1 }}>{hs}</div>
                          <div style={{ fontSize: 10, color: '#999', marginTop: 2 }}>hs / 180</div>
                        </div>
                      </div>

                      {/* Barra de horas */}
                      <div style={{ padding: '0 14px', background: '#fafaf8' }}>
                        <div style={{ height: 5, background: '#eee', overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${Math.min(pct, 100)}%`, background: color, transition: 'width .3s' }}></div>
                        </div>
                      </div>

                      {/* Cuerpo de la ficha */}
                      <div style={{ padding: '12px 14px' }}>
                        {/* Sector */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                          <span className="dot" style={{ background: SEC_COLORS[e.sector] }}></span>
                          <span style={{ fontSize: 12, color: '#444' }}>{e.sector}</span>
                        </div>

                        {/* Grilla de datos */}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                          <div style={{ background: '#FAEEDA', borderRadius: 6, padding: '8px 10px' }}>
                            <div style={{ fontSize: 10, color: '#854F0B', marginBottom: 2 }}>Turnos día (08-20)</div>
                            <div style={{ fontSize: 18, fontWeight: 500, color: '#633806' }}>{turnosDia}</div>
                            <div style={{ fontSize: 10, color: '#854F0B' }}>{turnosDia * 12} hs</div>
                          </div>
                          <div style={{ background: '#E6F1FB', borderRadius: 6, padding: '8px 10px' }}>
                            <div style={{ fontSize: 10, color: '#185FA5', marginBottom: 2 }}>Turnos noche (20-08)</div>
                            <div style={{ fontSize: 18, fontWeight: 500, color: '#042C53' }}>{turnosNoche}</div>
                            <div style={{ fontSize: 10, color: '#185FA5' }}>{turnosNoche * 12} hs</div>
                          </div>
                        </div>

                        {/* Pie de la ficha */}
                        <div style={{ marginTop: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 8, borderTop: '0.5px solid rgba(0,0,0,0.06)' }}>
                          <span style={{ fontSize: 11, color: diasDisp > 0 ? '#1D9E75' : '#BA7517' }}>
                            {diasDisp > 0 ? `${diasDisp} días disponibles cargados` : 'Sin disponibilidad'}
                          </span>
                          <span style={{ fontSize: 11, color: hsRestantes <= 0 ? '#A32D2D' : '#666' }}>
                            {hsRestantes > 0 ? `Restan ${hsRestantes} hs` : 'Tope alcanzado'}
                          </span>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })()}

        {vista === 'disponibilidad' && (() => {
          const efSelDisp = efectivos[0]?.legajo
          return (
            <div>
              <div className="panel" style={{ marginBottom: 14 }}>
                <div className="panel-header"><h3>Disponibilidad cargada — {NOMBRE_MES}</h3></div>
                <div style={{ padding: 14, overflowX: 'auto' }}>
                  <table style={{ tableLayout: 'fixed', width: 'max-content', minWidth: '100%' }}>
                    <thead>
                      <tr>
                        <th style={{ width: 130 }}>Efectivo</th>
                        {Array.from({ length: DIAS_MES }, (_, i) => (
                          <th key={i} style={{ width: 26, textAlign: 'center', padding: '8px 1px' }}>{i + 1}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {efectivos.map(e => (
                        <tr key={e.legajo} style={{ cursor: 'pointer' }} onClick={() => setEfectivoDetalle(efDetalle === e.legajo ? null : e.legajo)}>
                          <td style={{ fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: efDetalle === e.legajo ? '#c8a84b' : 'var(--text)', fontWeight: efDetalle === e.legajo ? 500 : 400 }}>{e.nombre}</td>
                          {Array.from({ length: DIAS_MES }, (_, i) => {
                            const v = (disponibilidad[e.legajo] || {})[i + 1] || ''
                            const bg = v === 'dn' ? '#0d2b1a' : v === 'd' ? '#3a2a0a' : v === 'n' ? '#0d2040' : 'var(--surface2)'
                            const label = v === 'dn' ? 'A' : v === 'd' ? 'D' : v === 'n' ? 'N' : '·'
                            const color = v === 'dn' ? '#5DCAA5' : v === 'd' ? '#EF9F27' : v === 'n' ? '#85B7EB' : '#444'
                            return (
                              <td key={i} style={{ textAlign: 'center', padding: '3px 1px' }}>
                                <span style={{ display: 'inline-block', width: 20, height: 16, background: bg, borderRadius: 3, fontSize: 9, fontWeight: 500, lineHeight: '16px', color }}>{label}</span>
                              </td>
                            )
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div style={{ marginTop: 10, display: 'flex', gap: 12, fontSize: 11, color: 'var(--text-muted)' }}>
                    <span><span style={{ background: '#0d2b1a', color: '#5DCAA5', padding: '1px 5px', borderRadius: 2 }}>A</span> Ambos</span>
                    <span><span style={{ background: '#3a2a0a', color: '#EF9F27', padding: '1px 5px', borderRadius: 2 }}>D</span> Día</span>
                    <span><span style={{ background: '#0d2040', color: '#85B7EB', padding: '1px 5px', borderRadius: 2 }}>N</span> Noche</span>
                    <span style={{ color: '#c8a84b' }}>Hacé clic en un efectivo para ver su calendario completo</span>
                  </div>
                </div>
              </div>

              {efDetalle && (() => {
                const e = efectivos.find(x => x.legajo === efDetalle)
                if (!e) return null
                const disp = disponibilidad[e.legajo] || {}
                const primerDia = (new Date(ANIO, MES - 1, 1).getDay() + 6) % 7
                const hs = horasAsig[e.legajo] || 0
                const turnosEf = (turnos[e.legajo] || [])
                return (
                  <div className="panel">
                    <div className="panel-header" style={{ background: 'rgba(200,168,75,0.08)', borderBottom: '0.5px solid rgba(200,168,75,0.2)' }}>
                      <div>
                        <h3 style={{ color: '#c8a84b' }}>{e.nombre} — Leg. {e.legajo}</h3>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{e.tipo} · {e.sector} · {hs} hs asignadas</div>
                      </div>
                      <button className="btn btn-sm" onClick={() => setEfectivoDetalle(null)} style={{ color: 'var(--text-muted)' }}>Cerrar</button>
                    </div>
                    <div style={{ padding: 14 }}>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2, marginBottom: 6 }}>
                        {['Lu','Ma','Mi','Ju','Vi','Sá','Do'].map(d => (
                          <div key={d} style={{ textAlign: 'center', fontSize: 11, color: 'var(--text-muted)', padding: '4px 0' }}>{d}</div>
                        ))}
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 3 }}>
                        {Array.from({ length: primerDia }).map((_, i) => <div key={`e-${i}`}></div>)}
                        {Array.from({ length: DIAS_MES }, (_, i) => i + 1).map(dia => {
                          const v = disp[dia] || ''
                          const turnoAsig = turnosEf.filter(t => t.dia === dia)
                          const bg = v === 'dn' ? '#0d2b1a' : v === 'd' ? '#3a2a0a' : v === 'n' ? '#0d2040' : 'var(--surface2)'
                          const borderColor = v === 'dn' ? '#1D9E75' : v === 'd' ? '#BA7517' : v === 'n' ? '#378ADD' : 'var(--border)'
                          return (
                            <div key={dia} style={{ border: `0.5px solid ${borderColor}`, borderRadius: 6, padding: '5px 4px', minHeight: 54, background: bg, cursor: 'pointer' }}
                              onClick={() => setModalTurno({ dia, sector: SECTORES[0], turno: 'd', legajo: e.legajo })}>
                              <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-muted)', marginBottom: 2 }}>{dia}</div>
                              {v && <div style={{ fontSize: 9, color: v === 'dn' ? '#5DCAA5' : v === 'd' ? '#EF9F27' : '#85B7EB', marginBottom: 2 }}>{v === 'dn' ? 'Ambos' : v === 'd' ? 'Día' : 'Noche'}</div>}
                              {turnoAsig.map(t => (
                                <div key={t.id} style={{ fontSize: 8, background: t.turno === 'd' ? '#3a2a0a' : '#0d2040', color: t.turno === 'd' ? '#EF9F27' : '#85B7EB', borderRadius: 2, padding: '1px 3px', marginTop: 1 }}>
                                  {t.turno === 'd' ? 'D' : 'N'} {t.sector.split(' ')[0]}
                                </div>
                              ))}
                              {!v && <div style={{ fontSize: 9, color: '#444', textAlign: 'center', marginTop: 4 }}>+</div>}
                            </div>
                          )
                        })}
                      </div>
                      <div style={{ marginTop: 10, fontSize: 11, color: 'var(--text-muted)' }}>
                        Hacé clic en cualquier día para agregar un turno manual a este efectivo.
                      </div>
                    </div>
                  </div>
                )
              })()}
            </div>
          )
        })()}

        {vista === 'turnos' && (
          <div>
            {msgGen && <div className="alert alert-ok">{msgGen}</div>}
            {!hayTurnos && !msgGen && <div className="alert alert-warn">{cargaron} de {efectivos.length} efectivos cargaron disponibilidad.</div>}
            <div style={{ textAlign: 'center', padding: '20px 0 16px' }}>
              <button className="btn btn-success" onClick={generarTurnos} disabled={generando}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 2v3l3-3-3-3v3a6 6 0 1 0 5.2 9l-1.4-.8A4.5 4.5 0 1 1 8 2z" fill="currentColor"/></svg>
                {generando ? 'Generando...' : hayTurnos ? 'Regenerar turnos' : 'Generar turnos automáticamente'}
              </button>
              <p style={{ fontSize: 11, color: '#666', marginTop: 6 }}>Distribuye parejo respetando disponibilidad y tope de 180 hs</p>
            </div>
            {hayTurnos && (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10, marginBottom: 16 }}>
                  {efectivos.map(e => {
                    const hs = horasAsig[e.legajo] || 0
                    const pct = Math.round(hs / 180 * 100)
                    const color = pct >= 100 ? '#A32D2D' : pct >= 80 ? '#BA7517' : '#1D9E75'
                    return (
                      <div key={e.legajo} className="card" style={{ padding: '10px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div><div style={{ fontSize: 12, fontWeight: 500 }}>{e.nombre}</div><div style={{ fontSize: 11, color: '#666' }}>{e.sector}</div></div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: 15, fontWeight: 500, color }}>{hs} hs</div>
                          <div className="hbar" style={{ width: 60 }}><div className="hfill" style={{ width: `${Math.min(pct, 100)}%`, background: color }}></div></div>
                        </div>
                      </div>
                    )
                  })}
                </div>
                <div className="panel">
                  <div className="panel-header">
                    <h3>Cronograma — {NOMBRE_MES}</h3>
                    <span style={{ fontSize: 11, color: '#666' }}>naranja = día · azul = noche</span>
                  </div>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ tableLayout: 'fixed', width: 'max-content', minWidth: '100%' }}>
                      <thead>
                        <tr>
                          <th style={{ width: 130 }}>Sector</th>
                          {Array.from({ length: DIAS_MES }, (_, i) => <th key={i} style={{ width: 76, textAlign: 'center', padding: '8px 3px' }}>{i + 1}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {SECTORES.map(sector => (
                          <tr key={sector}>
                            <td><span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11 }}><span className="dot" style={{ background: SEC_COLORS[sector] }}></span>{sector}</span></td>
                            {Array.from({ length: DIAS_MES }, (_, i) => {
                              const dia = i + 1
                              const tD = todosLosTurnos.filter(t => t.dia === dia && t.turno === 'd' && t.sector === sector)
                              const tN = todosLosTurnos.filter(t => t.dia === dia && t.turno === 'n' && t.sector === sector)
                              return (
                                <td key={i} style={{ padding: '3px', fontSize: 10, verticalAlign: 'top' }}>
                                  <div style={{ color: '#633806', marginBottom: 1 }}>{tD.map(t => nombreCorto(t.legajo)).join(', ') || '—'}</div>
                                  <div style={{ color: '#042C53' }}>{tN.map(t => nombreCorto(t.legajo)).join(', ') || '—'}</div>
                                </td>
                              )
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {vista === 'edicion' && (() => {
          const diaActual = filtroDia || 1
          return (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Día del mes:</span>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {Array.from({ length: DIAS_MES }, (_, i) => i + 1).map(d => (
                    <button key={d} className="btn btn-sm"
                      style={{ minWidth: 32, padding: '4px 6px', fontSize: 11,
                        background: d === diaActual ? 'rgba(200,168,75,0.15)' : 'transparent',
                        color: d === diaActual ? '#c8a84b' : 'var(--text-muted)',
                        border: d === diaActual ? '0.5px solid rgba(200,168,75,0.6)' : '0.5px solid rgba(255,255,255,0.1)'
                      }}
                      onClick={() => setFiltroDia(d)}>{d}</button>
                  ))}
                </div>
              </div>

              <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)' }}>Día {diaActual} — {NOMBRE_MES}</h3>
                <button className="btn btn-primary btn-sm" onClick={() => setModalTurno({ dia: diaActual, sector: SECTORES[0], turno: 'd', legajo: '' })}>
                  + Agregar turno
                </button>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                {SECTORES.map(sector => {
                  const tDia = todosLosTurnos.filter(t => t.dia === diaActual && t.turno === 'd' && t.sector === sector)
                  const tNoche = todosLosTurnos.filter(t => t.dia === diaActual && t.turno === 'n' && t.sector === sector)
                  return (
                    <div key={sector} style={{ background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
                      <div style={{ padding: '8px 12px', background: 'var(--surface2)', borderBottom: '0.5px solid var(--border)', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span className="dot" style={{ background: SEC_COLORS[sector] }}></span>
                        <span style={{ fontSize: 12, fontWeight: 500 }}>{sector}</span>
                      </div>
                      <div style={{ padding: 10 }}>
                        <div style={{ marginBottom: 8 }}>
                          <div style={{ fontSize: 10, color: '#EF9F27', fontWeight: 500, marginBottom: 5 }}>TURNO DÍA 08-20</div>
                          {tDia.length === 0 && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span style={{ fontSize: 11, color: 'var(--text-hint)', fontStyle: 'italic' }}>Sin cubrir</span>
                              <button className="btn btn-sm" style={{ fontSize: 10, padding: '2px 8px', color: '#EF9F27', borderColor: 'rgba(239,159,39,0.4)' }}
                                onClick={() => setModalTurno({ dia: diaActual, sector, turno: 'd', legajo: '' })}>+ Asignar</button>
                            </div>
                          )}
                          {tDia.map(t => (
                            <div key={t.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 8px', background: 'rgba(239,159,39,0.06)', borderRadius: 6, marginBottom: 3 }}>
                              <span style={{ fontSize: 12, fontWeight: 500 }}>{nombreCompleto(t.legajo)}</span>
                              <div style={{ display: 'flex', gap: 4 }}>
                                <button className="btn btn-sm" style={{ fontSize: 10, padding: '2px 6px' }} onClick={() => setModalTurno(t)}>Cambiar</button>
                                <button className="btn btn-sm" style={{ fontSize: 10, padding: '2px 6px', color: '#F09595', borderColor: 'rgba(240,149,149,0.3)' }} onClick={() => handleEliminarTurno(t)}>✕</button>
                              </div>
                            </div>
                          ))}
                          {tDia.length > 0 && tDia.length < 2 && (
                            <button className="btn btn-sm" style={{ fontSize: 10, padding: '2px 8px', marginTop: 3, color: '#EF9F27', borderColor: 'rgba(239,159,39,0.3)' }}
                              onClick={() => setModalTurno({ dia: diaActual, sector, turno: 'd', legajo: '' })}>+ Agregar segundo</button>
                          )}
                        </div>
                        <div style={{ borderTop: '0.5px solid var(--border)', paddingTop: 8 }}>
                          <div style={{ fontSize: 10, color: '#85B7EB', fontWeight: 500, marginBottom: 5 }}>TURNO NOCHE 20-08</div>
                          {tNoche.length === 0 && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span style={{ fontSize: 11, color: 'var(--text-hint)', fontStyle: 'italic' }}>Sin cubrir</span>
                              <button className="btn btn-sm" style={{ fontSize: 10, padding: '2px 8px', color: '#85B7EB', borderColor: 'rgba(133,183,235,0.4)' }}
                                onClick={() => setModalTurno({ dia: diaActual, sector, turno: 'n', legajo: '' })}>+ Asignar</button>
                            </div>
                          )}
                          {tNoche.map(t => (
                            <div key={t.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 8px', background: 'rgba(133,183,235,0.06)', borderRadius: 6, marginBottom: 3 }}>
                              <span style={{ fontSize: 12, fontWeight: 500 }}>{nombreCompleto(t.legajo)}</span>
                              <div style={{ display: 'flex', gap: 4 }}>
                                <button className="btn btn-sm" style={{ fontSize: 10, padding: '2px 6px' }} onClick={() => setModalTurno(t)}>Cambiar</button>
                                <button className="btn btn-sm" style={{ fontSize: 10, padding: '2px 6px', color: '#F09595', borderColor: 'rgba(240,149,149,0.3)' }} onClick={() => handleEliminarTurno(t)}>✕</button>
                              </div>
                            </div>
                          ))}
                          {tNoche.length > 0 && tNoche.length < 2 && (
                            <button className="btn btn-sm" style={{ fontSize: 10, padding: '2px 8px', marginTop: 3, color: '#85B7EB', borderColor: 'rgba(133,183,235,0.3)' }}
                              onClick={() => setModalTurno({ dia: diaActual, sector, turno: 'n', legajo: '' })}>+ Agregar segundo</button>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })()}
      </div>
    </div>
  )
}
