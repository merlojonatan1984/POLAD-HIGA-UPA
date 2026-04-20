import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../lib/supabase'

const SECTORES_COLORS = {
  'Salud Mental': '#378ADD', 'Giratoria': '#1D9E75', 'Llaves': '#EF9F27',
  'Guardia': '#D4537E', 'Estacionamiento': '#7F77DD', 'UPA': '#D85A30'
}
const MES = new Date().getMonth() + 1
const ANIO = new Date().getFullYear()
const DIAS_MES = new Date(ANIO, MES, 0).getDate()
const NOMBRE_MES = new Date(ANIO, MES - 1, 1).toLocaleString('es-AR', { month: 'long' })

export default function Efectivo() {
  const router = useRouter()
  const [user, setUser] = useState(null)
  const [disponibilidad, setDisponibilidad] = useState({})
  const [turnos, setTurnos] = useState([])
  const [horasAsig, setHorasAsig] = useState(0)
  const [guardando, setGuardando] = useState(false)
  const [guardado, setGuardado] = useState(false)
  const [vistaActual, setVistaActual] = useState('disponibilidad')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const u = localStorage.getItem('polad_user')
    if (!u) { router.push('/'); return }
    const parsed = JSON.parse(u)
    if (parsed.es_admin) { router.push('/admin'); return }
    setUser(parsed)
    cargarDatos(parsed.legajo)
  }, [])

  async function cargarDatos(legajo) {
    setLoading(true)
    const [{ data: disp }, { data: turns }] = await Promise.all([
      supabase.from('disponibilidad').select('*').eq('legajo', legajo).eq('mes', MES).eq('anio', ANIO),
      supabase.from('turnos').select('*').eq('legajo', legajo).eq('mes', MES).eq('anio', ANIO).order('dia')
    ])
    const dispMap = {}
    ;(disp || []).forEach(d => { dispMap[d.dia] = d.turno })
    setDisponibilidad(dispMap)
    setTurnos(turns || [])
    setHorasAsig((turns || []).length * 12)
    setLoading(false)
  }

  function toggleDia(dia) {
    const ciclo = { '': 'd', 'd': 'n', 'n': 'dn', 'dn': '' }
    const cur = disponibilidad[dia] || ''
    const next = ciclo[cur]
    setDisponibilidad(prev => {
      const nuevo = { ...prev }
      if (next === '') delete nuevo[dia]
      else nuevo[dia] = next
      return nuevo
    })
  }

  async function guardar() {
    if (!user) return
    setGuardando(true)
    // Borrar disponibilidad anterior del mes
    await supabase.from('disponibilidad').delete()
      .eq('legajo', user.legajo).eq('mes', MES).eq('anio', ANIO)
    // Insertar nueva
    const rows = Object.entries(disponibilidad).map(([dia, turno]) => ({
      legajo: user.legajo, mes: MES, anio: ANIO, dia: parseInt(dia), turno
    }))
    if (rows.length > 0) {
      await supabase.from('disponibilidad').insert(rows)
    }
    setGuardando(false)
    setGuardado(true)
    setTimeout(() => setGuardado(false), 3000)
  }

  function primerDiaOffset() {
    return (new Date(ANIO, MES - 1, 1).getDay() + 6) % 7
  }

  if (loading) return <div className="loading">Cargando...</div>
  if (!user) return null

  const diasDisp = Object.keys(disponibilidad).length
  const pctHoras = Math.round(horasAsig / 180 * 100)
  const colorHoras = pctHoras >= 100 ? '#A32D2D' : pctHoras >= 80 ? '#BA7517' : '#1D9E75'

  return (
    <div>
      <div className="topbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#E6F1FB', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 500, color: '#185FA5' }}>
            {user.nombre.split(',')[0][0]}
          </div>
          <div>
            <span style={{ fontWeight: 500, fontSize: 15 }}>{user.nombre}</span>
            <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 8 }}>Leg. {user.legajo}</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span className={`tag ${user.tipo === 'Uniformado' ? 'tag-u' : 'tag-g'}`}>{user.tipo}</span>
          <button className="btn btn-sm" onClick={() => { localStorage.removeItem('polad_user'); router.push('/') }}>Salir</button>
        </div>
      </div>

      <div className="app-layout">
        <div className="sidebar">
          <div className="nav-sec">Mi panel</div>
          <a className={`nav-item ${vistaActual === 'disponibilidad' ? 'active' : ''}`} onClick={() => setVistaActual('disponibilidad')} style={{ cursor: 'pointer' }}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="2" y="3" width="12" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.2"/><path d="M5 1v3M11 1v3M2 7h12" stroke="currentColor" strokeWidth="1.2"/></svg>
            Mi disponibilidad
          </a>
          <a className={`nav-item ${vistaActual === 'turnos' ? 'active' : ''}`} onClick={() => setVistaActual('turnos')} style={{ cursor: 'pointer' }}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.2"/><path d="M8 5v3l2 2" stroke="currentColor" strokeWidth="1.2"/></svg>
            Mis turnos
          </a>
          <div className="nav-sec">Resumen</div>
          <div style={{ padding: '8px 14px' }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Horas asignadas</div>
            <div style={{ fontSize: 18, fontWeight: 500, color: colorHoras }}>{horasAsig} / 180</div>
            <div className="hbar" style={{ width: '100%', marginTop: 4 }}>
              <div className="hfill" style={{ width: `${pctHoras}%`, background: colorHoras }}></div>
            </div>
          </div>
          <div style={{ padding: '8px 14px' }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>Sector</div>
            <div style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 5 }}>
              <span className="dot" style={{ background: SECTORES_COLORS[user.sector] }}></span>
              {user.sector}
            </div>
          </div>
        </div>

        <div className="main-area">
          <div className="content">
            {horasAsig >= 150 && <div className="alert alert-warn">Atención: estás cerca del tope de 180 hs mensuales.</div>}
            {guardado && <div className="alert alert-ok">Disponibilidad guardada correctamente.</div>}

            {vistaActual === 'disponibilidad' && (
              <div className="panel">
                <div className="panel-header">
                  <h3>Disponibilidad — {NOMBRE_MES} {ANIO}</h3>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{diasDisp} días marcados</span>
                </div>
                <div style={{ padding: 14 }}>
                  <div style={{ display: 'flex', gap: 12, marginBottom: 12, flexWrap: 'wrap', fontSize: 11, color: 'var(--text-muted)' }}>
                    <span style={{ fontWeight: 500, color: 'var(--text)' }}>Clic para cambiar:</span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 10, height: 10, background: '#f5f5f3', border: '0.5px solid #ccc', borderRadius: 2, display: 'inline-block' }}></span> Sin marcar</span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 10, height: 10, background: '#FAEEDA', borderRadius: 2, display: 'inline-block' }}></span> Solo día (08-20)</span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 10, height: 10, background: '#E6F1FB', borderRadius: 2, display: 'inline-block' }}></span> Solo noche (20-08)</span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 10, height: 10, background: '#EAF3DE', borderRadius: 2, display: 'inline-block' }}></span> Ambos turnos</span>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 2, marginBottom: 6 }}>
                    {['Lu','Ma','Mi','Ju','Vi','Sá','Do'].map(d => (
                      <div key={d} style={{ textAlign: 'center', fontSize: 11, color: 'var(--text-muted)', padding: '4px 0' }}>{d}</div>
                    ))}
                  </div>

                  <div className="cal-grid">
                    {Array.from({ length: primerDiaOffset() }).map((_, i) => (
                      <div key={`empty-${i}`} className="day-cell empty"></div>
                    ))}
                    {Array.from({ length: DIAS_MES }, (_, i) => i + 1).map(dia => {
                      const v = disponibilidad[dia] || ''
                      const cls = v === 'd' ? 'sel-d' : v === 'n' ? 'sel-n' : v === 'dn' ? 'sel-dn' : ''
                      const label = v === 'd' ? 'Día' : v === 'n' ? 'Noche' : v === 'dn' ? 'Ambos' : ''
                      const labelColor = v === 'd' ? '#633806' : v === 'n' ? '#042C53' : v === 'dn' ? '#27500A' : ''
                      return (
                        <div key={dia} className={`day-cell ${cls}`} onClick={() => toggleDia(dia)}>
                          <div className="day-num">{dia}</div>
                          <div className="day-label" style={{ color: labelColor }}>{label}</div>
                        </div>
                      )
                    })}
                  </div>
                </div>
                <div style={{ padding: '10px 14px', borderTop: '0.5px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                  <button className="btn btn-sm" onClick={() => setDisponibilidad({})}>Limpiar todo</button>
                  <button className="btn btn-primary" onClick={guardar} disabled={guardando}>
                    {guardando ? 'Guardando...' : 'Guardar disponibilidad'}
                  </button>
                </div>
              </div>
            )}

            {vistaActual === 'turnos' && (
              <div className="panel">
                <div className="panel-header">
                  <h3>Turnos asignados — {NOMBRE_MES} {ANIO}</h3>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{turnos.length} turnos · {turnos.length * 12} hs</span>
                </div>
                <div style={{ padding: 14 }}>
                  {turnos.length === 0 ? (
                    <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>No hay turnos asignados aún. El administrador generará el cronograma.</p>
                  ) : (
                    <div>
                      {turnos.map(t => (
                        <div key={t.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 0', borderBottom: '0.5px solid var(--border)' }}>
                          <div style={{ width: 36, height: 36, borderRadius: 8, background: t.turno === 'd' ? '#FAEEDA' : '#E6F1FB', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 500, color: t.turno === 'd' ? '#633806' : '#042C53', flexShrink: 0 }}>
                            {t.dia}
                          </div>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 12, fontWeight: 500 }}>{t.sector}</div>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                              {t.turno === 'd' ? '08:00 a 20:00' : '20:00 a 08:00'}
                            </div>
                          </div>
                          <span className={`chip ${t.turno === 'd' ? 'chip-d' : 'chip-n'}`}>
                            {t.turno === 'd' ? 'Día' : 'Noche'}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
