import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../lib/supabase'

const SECTORES = ['Salud Mental', 'Giratoria', 'Llaves', 'Guardia', 'Estacionamiento', 'UPA']
const SEC_COLORS = { 'Salud Mental': '#378ADD', 'Giratoria': '#1D9E75', 'Llaves': '#EF9F27', 'Guardia': '#D4537E', 'Estacionamiento': '#7F77DD', 'UPA': '#D85A30' }
const MES = new Date().getMonth() + 1
const ANIO = new Date().getFullYear()
const DIAS_MES = new Date(ANIO, MES, 0).getDate()
const MESES_NOMBRES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
const NOMBRE_MES = MESES_NOMBRES[MES-1] + ' ' + ANIO
const NOMBRE_MES_SOLO = MESES_NOMBRES[MES-1]
const VISTAS = ['resumen', 'personal', 'disponibilidad', 'turnos', 'edicion', 'config', 'planillas']
const LABELS = { resumen: 'Resumen', personal: 'Personal', disponibilidad: 'Disponibilidad', turnos: 'Guardias', edicion: 'Edición manual', config: 'Configuración', planillas: 'Planillas' }



export default function AdminApp() {
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
  const [planillaEf, setPlanillaEf] = useState(null)
  const [planillaManual, setPlanillaManual] = useState({})
  const [firmas, setFirmas] = useState({})
  const [cargandoPlanilla, setCargandoPlanilla] = useState(false)
  const [filasCache, setFilasCache] = useState([])
  const [manualDia, setManualDia] = useState(1)
  const [manualHorario, setManualHorario] = useState('')
  const [manualHoras, setManualHoras] = useState('')

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

  async function cargarPlanillaEf(ef) {
    setCargandoPlanilla(true)
    const [{ data: manual }, { data: firmasData }, { data: asist }] = await Promise.all([
      supabase.from('planilla_manual').select('*').eq('legajo', ef.legajo).eq('mes', MES).eq('anio', ANIO),
      supabase.from('firmas').select('*').eq('legajo', ef.legajo).eq('mes', MES).eq('anio', ANIO),
      supabase.from('asistencia').select('*').eq('legajo', ef.legajo).eq('mes', MES).eq('anio', ANIO)
    ])
    const manualMap = {}
    ;(manual || []).forEach(m => { manualMap[`${m.dia}-${m.horario}`] = m })
    setPlanillaManual(manualMap)
    const firmaObj = firmasData && firmasData[0] ? firmasData[0] : null
    setFirmas(prev => ({ ...prev, [ef.legajo]: firmaObj }))
    setPlanillaEf(prev => ({ ...(prev || ef), ...ef, asistencia: asist || [] }))
    setCargandoPlanilla(false)
  }

  useEffect(() => {
    if (planillaEf) {
      const turnosEf = (turnos[planillaEf.legajo] || []).sort((a,b) => a.dia - b.dia)
      const asist = planillaEf.asistencia || []
      const asistMap = {}
      asist.forEach(a => { asistMap[`${a.dia}-${a.turno}`] = a })
      
      const filas = Array.from({ length: DIAS_MES }, (_, i) => i + 1).map(dia => {
        const tDia = turnosEf.find(t => t.dia === dia && t.turno === 'd')
        const tNoche = turnosEf.find(t => t.dia === dia && t.turno === 'n')
        const pDia = asistMap[`${dia}-d`]
        const pNoche = asistMap[`${dia}-n`]
        const entradas = []
        if (pDia || tDia) entradas.push({ horario: '08:00 a 20:00', horas: pDia ? 12 : 0, confirmado: !!pDia, manual: false })
        if (pNoche || tNoche) entradas.push({ horario: '20:00 a 24:00', horas: pNoche ? 4 : 0, confirmado: !!pNoche, manual: false })
        Object.values(planillaManual).forEach(m => {
          if (parseInt(m.dia) === dia) {
            const yaExiste = entradas.find(e => e.horario === m.horario)
            if (!yaExiste) entradas.push({ horario: m.horario, horas: m.horas, confirmado: false, manual: true, id: m.id })
          }
        })
        entradas.sort((a,b) => a.horario.localeCompare(b.horario))
        return { dia, entradas }
      })
      setFilasCache(filas)
    }
  }, [planillaEf, planillaManual, turnos])


  async function guardarHoraManual(legajo, dia, horario, horas, sector) {
    const key = `${dia}-${horario}`
    const existe = planillaManual[key]
    if (horas === '' || horas === 0) {
      if (existe) {
        await supabase.from('planilla_manual').delete().eq('id', existe.id)
        const nuevo = { ...planillaManual }
        delete nuevo[key]
        setPlanillaManual(nuevo)
      }
      return
    }
    if (existe) {
      await supabase.from('planilla_manual').update({ horas: parseInt(horas), sector }).eq('id', existe.id)
    } else {
      await supabase.from('planilla_manual').insert([{ legajo, mes: MES, anio: ANIO, dia: parseInt(dia), horario, horas: parseInt(horas), sector: sector || '' }])
    }
    // Reload from DB
    const { data: fresh } = await supabase.from('planilla_manual').select('*').eq('legajo', legajo).eq('mes', MES).eq('anio', ANIO)
    const newMap = {}
    ;(fresh || []).forEach(m => { newMap[`${m.dia}-${m.horario}`] = m })
    setPlanillaManual(newMap)
  }

  async function subirFirmaAdmin(legajo, file) {
    const reader = new FileReader()
    reader.onload = async (e) => {
      const base64 = e.target.result
      const existeFirma = firmas[legajo]
      if (existeFirma) {
        await supabase.from('firmas').update({ firma_url: base64 }).eq('id', existeFirma.id)
      } else {
        await supabase.from('firmas').insert([{ legajo, mes: MES, anio: ANIO, firma_url: base64 }])
      }
      setFirmas(prev => ({ ...prev, [legajo]: { ...prev[legajo], firma_url: base64 } }))
    }
    reader.readAsDataURL(file)
  }

  function buildFilasPlanilla(ef) {
    const asist = ef.asistencia || []
    const asistMap = {}
    asist.forEach(a => { asistMap[`${a.dia}-${a.turno}`] = a })
    const turnosEf = (turnos[ef.legajo] || []).sort((a,b) => a.dia - b.dia)

    return Array.from({ length: DIAS_MES }, (_, i) => i + 1).map(dia => {
      const tDia = turnosEf.find(t => t.dia === dia && t.turno === 'd')
      const tNoche = turnosEf.find(t => t.dia === dia && t.turno === 'n')
      const pDia = asistMap[`${dia}-d`]
      const pNoche = asistMap[`${dia}-n`]
      const manualDia = planillaManual[`${dia}-08:00 a 20:00`]
      const manualNoche1 = planillaManual[`${dia}-20:00 a 24:00`]
      const manualNoche2 = planillaManual[`${dia}-00:00 a 08:00`]

      const entradas = []
      if (pDia || tDia || manualDia) entradas.push({ horario: '08:00 a 20:00', horas: pDia ? 12 : manualDia ? manualDia.horas : 0, confirmado: !!pDia, manual: !!manualDia })
      if (pNoche || tNoche) {
        entradas.push({ horario: '20:00 a 24:00', horas: pNoche ? 4 : 0, confirmado: !!pNoche })
        if (pNoche && dia < DIAS_MES) {
          // Will be added to next day
        }
      }
      if (manualNoche1) entradas.push({ horario: '20:00 a 24:00', horas: manualNoche1.horas, confirmado: false, manual: true })
      if (manualNoche2) entradas.push({ horario: '00:00 a 08:00', horas: manualNoche2.horas, confirmado: false, manual: true })

      return { dia, entradas }
    })
  }

  function imprimirPlanillaAdmin(ef) {
    const firma = firmas[ef.legajo]?.firma_url || ''
    const filas = filasCache
    const totalHoras = filas.reduce((sum, f) => sum + f.entradas.reduce((s, e) => s + (e.horas || 0), 0), 0)
    const total90 = Math.round(totalHoras * 0.9)

    const flatRows = []
    filas.forEach(f => {
      if (f.entradas.length === 0) flatRows.push({ dia: f.dia, horario: '', horas: '', confirmado: false })
      else f.entradas.forEach(e => flatRows.push({ dia: f.dia, horario: e.horario, horas: e.horas || '', confirmado: e.confirmado }))
    })

    const win = window.open('', '_blank')
    const half = Math.ceil(flatRows.length / 2)
    const col1 = flatRows.slice(0, half)
    const col2 = flatRows.slice(half)

    win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Planilla ${ef.nombre}</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:Arial,sans-serif;font-size:10px;padding:12mm;color:#000}
h2{font-size:13px;text-align:center;margin-bottom:3px}h3{font-size:11px;text-align:center;margin-bottom:8px}
.field{border-bottom:1px solid #000;padding:2px 0;margin-bottom:4px}.field label{font-size:8px;color:#555;display:block}.field span{font-size:10px;font-weight:bold}
.row4{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:6px}.row2{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:6px}
table{width:100%;border-collapse:collapse;margin-bottom:8px}th{background:#333;color:#fff;padding:4px;font-size:9px;text-align:center;border:1px solid #000}
td{border:1px solid #000;padding:3px 5px;font-size:9px;text-align:center;height:18px}td.dia{font-weight:bold;background:#f5f5f5}td.ok{background:#e8f5e9}
.decl{font-size:9px;margin-bottom:14px;line-height:1.5}
.firmas{display:grid;grid-template-columns:1fr 1fr;gap:30px}.firma-box{text-align:center;display:flex;flex-direction:column;justify-content:flex-end;min-height:80px}
.firma-img{width:260px;max-height:90px;object-fit:contain;display:block;margin-bottom:4px}
.firma-line{border-top:1px solid #000;padding-top:3px;font-size:9px}
@media print{body{padding:8mm}}</style></head><body>
<h2>POLICIA ADICIONAL — MINISTERIO DE SEGURIDAD</h2>
<h3>PLANILLA DE CUMPLIMIENTO SERVICIO DE POLICÍA ADICIONAL</h3>
<div class="row2"><div>
<div class="field"><label>Servicio POLAD</label><span>POLAD</span></div>
<div class="field"><label>Destino</label><span>Ministerio de Salud - Pcia de Bs As</span></div>
</div><div>
<div class="field"><label>Sucursal</label><span>HIGA-UPA</span></div>
<div class="field"><label>Localidad</label><span>Mar del Plata</span></div>
</div></div>
<div class="row4">
<div class="field"><label>Apellido y Nombre</label><span>${ef.nombre}</span></div>
<div class="field"><label>Mes / Año</label><span>${NOMBRE_MES_SOLO.toUpperCase()} ${ANIO}</span></div>
<div class="field"><label>Jerarquía</label><span>${ef.jerarquia||''}</span></div>
<div class="field"><label>Categoría</label><span>1°</span></div>
</div>
<div class="row4">
<div class="field"><label>Legajo</label><span>${ef.legajo}</span></div>
<div class="field"><label>N° Documento</label><span>${ef.dni||''}</span></div>
<div class="field"></div><div class="field"></div>
</div>
<table><thead><tr><th>DÍA</th><th>HORARIO</th><th>HORAS</th><th>DÍA</th><th>HORARIO</th><th>HORAS</th></tr></thead>
<tbody>
${Array.from({length: Math.max(col1.length, col2.length)}, (_,i) => {
  const r1 = col1[i] || {}; const r2 = col2[i] || {}
  return `<tr>
    <td class="dia">${r1.dia||''}</td>
    <td class="${r1.confirmado?'ok':''}">${r1.horario||''}</td>
    <td class="${r1.confirmado?'ok':''}">${r1.horas||''}</td>
    <td class="dia">${r2.dia||''}</td>
    <td class="${r2.confirmado?'ok':''}">${r2.horario||''}</td>
    <td class="${r2.confirmado?'ok':''}">${r2.horas||''}</td>
  </tr>`}).join('')}
<tr><td colspan="3" style="text-align:right;font-weight:bold">TOTAL HORAS CUMPLIDAS</td><td colspan="3" style="font-weight:bold;font-size:13px">${totalHoras}</td></tr>
<tr><td colspan="3" style="text-align:right;font-weight:bold">TOTAL 90%</td><td colspan="3" style="font-weight:bold;font-size:13px">${total90}</td></tr>
</tbody></table>
<div class="decl">Declaro de conformidad, haber prestado <strong>${totalHoras}</strong> horas de servicio de Policía Adicional, en el destino que figura en la presente planilla.</div>
<div class="firmas">
<div class="firma-box">${firma?`<img src="${firma}" class="firma-img" />`:'<div style="flex:1"></div>'}
<div class="firma-line">FIRMA EFECTIVO — ${ef.nombre}</div></div>
<div class="firma-box"><div style="flex:1"></div>
<div class="firma-line">FIRMA ENCARGADO — Crio. Paulo Corbela</div></div>
</div></body></html>`)
    win.document.close()
    setTimeout(() => win.print(), 500)
  }

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

        {vista === 'planillas' && (() => {
          const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
          const NOMBRE_MES_P = MESES[MES-1] + ' ' + ANIO
          const NOMBRE_MES_SOLO = MESES[MES-1]



          const firmaInputRef = typeof document !== 'undefined' ? document.createElement('input') : null

          return (
            <div>
              {!planillaEf ? (
                <div>
                  <p style={{ fontSize:12,color:'var(--text-muted)',marginBottom:14 }}>Seleccioná un efectivo para ver y editar su planilla del mes.</p>
                  <div style={{ display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(250px,1fr))',gap:10 }}>
                    {efectivos.map(ef => {
                      const hs = horasAsig[ef.legajo] || 0
                      const turnosEf = turnos[ef.legajo] || []
                      return (
                        <div key={ef.legajo} style={{ background:'var(--surface)',border:'0.5px solid var(--border)',borderRadius:10,padding:'12px 14px',cursor:'pointer' }}
                          onClick={() => cargarPlanillaEf(ef)}>
                          <div style={{ fontSize:12,fontWeight:500,marginBottom:2 }}>{ef.nombre}</div>
                          <div style={{ fontSize:10,color:'var(--text-muted)',marginBottom:6 }}>Leg. {ef.legajo} · {ef.jerarquia||ef.tipo}</div>
                          <div style={{ display:'flex',justifyContent:'space-between',fontSize:11 }}>
                            <span style={{ color:'var(--text-muted)' }}>{turnosEf.length} guardias</span>
                            <span style={{ color: hs >= 150 ? '#EF9F27' : '#1D9E75',fontWeight:500 }}>{hs} hs</span>
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
                const totalHoras = filas.reduce((sum, f) => sum + f.entradas.reduce((s, e) => s + (e.horas || 0), 0), 0)
                const total90 = Math.round(totalHoras * 0.9)

                return (
                  <div>
                    <div style={{ display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14 }}>
                      <div style={{ display:'flex',alignItems:'center',gap:10 }}>
                        <button className="btn btn-sm" onClick={() => setPlanillaEf(null)}>← Volver</button>
                        <span style={{ fontSize:14,fontWeight:500 }}>{ef.nombre}</span>
                        <span style={{ fontSize:11,color:'var(--text-muted)' }}>Leg. {ef.legajo} · {NOMBRE_MES_P}</span>
                      </div>
                      <div style={{ display:'flex',gap:8 }}>
                        <button className="btn btn-sm" style={{ background:'rgba(200,168,75,0.15)',color:'#c8a84b',border:'0.5px solid rgba(200,168,75,0.4)' }}
                          onClick={() => imprimirPlanillaAdmin(ef)}>🖨 Imprimir</button>
                      </div>
                    </div>

                    <div style={{ display:'grid',gridTemplateColumns:'1fr 320px',gap:16 }}>
                      {/* Tabla editable */}
                      <div className="panel">
                        <div className="panel-header">
                          <h3>Guardias realizadas — {NOMBRE_MES_P}</h3>
                          <span style={{ fontSize:11,color:'#1D9E75',fontWeight:500 }}>Total: {totalHoras} hs · 90%: {total90} hs</span>
                        </div>
                        <div style={{ overflowX:'auto' }}>
                          <table>
                            <thead>
                              <tr>
                                <th style={{ width:50 }}>Día</th>
                                <th>Horario</th>
                                <th style={{ width:80 }}>Horas</th>
                                <th style={{ width:120 }}>Sector</th>
                                <th style={{ width:80 }}>Estado</th>
                              </tr>
                            </thead>
                            <tbody>
                              {filas.map(f => {
                                if (f.entradas.length === 0) return (
                                  <tr key={f.dia} style={{ opacity:0.4 }}>
                                    <td style={{ textAlign:'center',fontWeight:500,background:'var(--surface2)' }}>{f.dia}</td>
                                    <td colSpan={4} style={{ fontSize:10,color:'var(--text-hint)' }}>Sin guardia</td>
                                  </tr>
                                )
                                return f.entradas.map((e, i) => (
                                  <tr key={`${f.dia}-${i}`} style={{ background: e.confirmado ? 'rgba(29,158,117,0.08)' : e.manual ? 'rgba(200,168,75,0.06)' : '' }}>
                                    <td style={{ textAlign:'center',fontWeight:500,background:'var(--surface2)',borderTop: i===0 ? '2px solid var(--border2)' : '' }}>{i===0?f.dia:''}</td>
                                    <td style={{ color: e.horario.startsWith('08')?'#EF9F27':'#85B7EB',fontWeight:500 }}>{e.horario}</td>
                                    <td>
                                      <input type="number" min="0" max="12" defaultValue={e.horas||''}
                                        style={{ width:'100%',padding:'3px 6px',border:'0.5px solid var(--border)',borderRadius:4,background:'var(--surface2)',color:'var(--text)',fontSize:12,textAlign:'center' }}
                                        onBlur={ev => guardarHoraManual(ef.legajo, f.dia, e.horario, ev.target.value, e.sector)}
                                      />
                                    </td>
                                    <td style={{ fontSize:11,color:'var(--text-muted)' }}>{e.sector||'—'}</td>
                                    <td style={{ textAlign:'center' }}>
                                      <div style={{ display:'flex',gap:4,alignItems:'center',justifyContent:'center' }}>
                                        {e.confirmado ? <span style={{ fontSize:10,color:'#1D9E75',fontWeight:500 }}>✓ Presente</span>
                                          : e.manual ? <span style={{ fontSize:10,color:'#c8a84b' }}>Manual</span>
                                          : <span style={{ fontSize:10,color:'var(--text-hint)' }}>Asignado</span>}
                                        {e.manual && <button style={{ background:'none',border:'none',cursor:'pointer',color:'#F09595',fontSize:12,padding:'0 2px' }}
                                          onClick={() => guardarHoraManual(ef.legajo, f.dia, e.horario, '', '')}>✕</button>}
                                      </div>
                                    </td>
                                  </tr>
                                ))
                              })}
                              {/* Fila para agregar hora manual */}
                              <tr style={{ background:'rgba(200,168,75,0.04)' }}>
                                <td colSpan={5} style={{ padding:'8px 12px' }}>
                                  <div style={{ display:'flex',gap:8,alignItems:'center',flexWrap:'wrap' }}>
                                    <span style={{ fontSize:11,color:'var(--text-muted)' }}>Agregar horas manual:</span>
                                    <select value={manualDia} onChange={e => setManualDia(parseInt(e.target.value))}
                                      style={{ padding:'4px 8px',fontSize:11,background:'var(--surface2)',color:'var(--text)',border:'0.5px solid var(--border)',borderRadius:4 }}>
                                      {Array.from({length:DIAS_MES},(_,i)=><option key={i+1} value={i+1}>Día {i+1}</option>)}
                                    </select>
                                    <div style={{ display:'flex',alignItems:'center',gap:4 }}>
                                      <input type="time" value={manualHorario} onChange={e => {
                                        setManualHorario(e.target.value)
                                      }} style={{ padding:'4px 6px',fontSize:11,background:'var(--surface2)',color:'var(--text)',border:'0.5px solid var(--border)',borderRadius:4 }} />
                                      <span style={{ fontSize:11,color:'var(--text-muted)' }}>a</span>
                                      <input type="time" value={manualHoras} onChange={e => {
                                        setManualHoras(e.target.value)
                                      }} style={{ padding:'4px 6px',fontSize:11,background:'var(--surface2)',color:'var(--text)',border:'0.5px solid var(--border)',borderRadius:4 }} />
                                    </div>
                                    <button className="btn btn-sm" style={{ fontSize:11,background:'rgba(200,168,75,0.15)',color:'#c8a84b',border:'0.5px solid rgba(200,168,75,0.4)' }}
                                      onClick={async () => {
                                        if (!manualHorario || !manualHoras) return
                                        // Calculate hours difference
                                        const [h1,m1] = manualHorario.split(':').map(Number)
                                        const [h2,m2] = manualHoras.split(':').map(Number)
                                        let diff = (h2*60+m2) - (h1*60+m1)
                                        if (diff <= 0) diff += 24*60  // overnight
                                        const hsCalc = Math.round(diff/60)
                                        const horarioStr = `${manualHorario} a ${manualHoras}`
                                        await guardarHoraManual(ef.legajo, manualDia, horarioStr, hsCalc, '')
                                        setManualHorario('')
                                        setManualHoras('')
                                        await cargarPlanillaEf(ef)
                                      }}>+ Agregar</button>
                                  </div>
                                </td>
                              </tr>
                            </tbody>
                          </table>
                        </div>
                      </div>

                      {/* Panel derecho: datos + firma */}
                      <div>
                        <div className="panel" style={{ marginBottom:12 }}>
                          <div className="panel-header"><h3>Datos del efectivo</h3></div>
                          <div style={{ padding:12 }}>
                            {[['Nombre',ef.nombre],['Legajo',ef.legajo],['DNI',ef.dni||'—'],['Jerarquía',ef.jerarquia||'—'],['Tipo',ef.tipo],['Sector',ef.sector||'—']].map(([k,v])=>(
                              <div key={k} style={{ display:'flex',justifyContent:'space-between',padding:'5px 0',borderBottom:'0.5px solid var(--border)',fontSize:12 }}>
                                <span style={{ color:'var(--text-muted)' }}>{k}</span>
                                <span style={{ fontWeight:500 }}>{v}</span>
                              </div>
                            ))}
                          </div>
                        </div>

                        <div className="panel">
                          <div className="panel-header"><h3>Firma del efectivo</h3></div>
                          <div style={{ padding:12 }}>
                            {firma
                              ? <div>
                                  <img src={firma} style={{ width:'100%',maxHeight:100,objectFit:'contain',marginBottom:8,background:'white',borderRadius:4,padding:4 }} alt="firma" />
                                  <button className="btn btn-sm" style={{ width:'100%',justifyContent:'center',fontSize:11 }}
                                    onClick={() => { const inp=document.createElement('input'); inp.type='file'; inp.accept='image/*'; inp.onchange=e=>{ if(e.target.files[0]) subirFirmaAdmin(ef.legajo,e.target.files[0]) }; inp.click() }}>
                                    Cambiar firma
                                  </button>
                                </div>
                              : <div>
                                  <div style={{ height:60,display:'flex',alignItems:'center',justifyContent:'center',marginBottom:8,border:'0.5px dashed var(--border)',borderRadius:6 }}>
                                    <span style={{ fontSize:11,color:'var(--text-hint)' }}>Sin firma</span>
                                  </div>
                                  <button className="btn btn-sm" style={{ width:'100%',justifyContent:'center',fontSize:11,background:'rgba(200,168,75,0.1)',color:'#c8a84b',border:'0.5px solid rgba(200,168,75,0.3)' }}
                                    onClick={() => { const inp=document.createElement('input'); inp.type='file'; inp.accept='image/*'; inp.onchange=e=>{ if(e.target.files[0]) subirFirmaAdmin(ef.legajo,e.target.files[0]) }; inp.click() }}>
                                    + Subir firma
                                  </button>
                                </div>
                            }
                          </div>
                        </div>

                        <div style={{ marginTop:10,padding:'10px 12px',background:'var(--surface2)',borderRadius:8 }}>
                          <div style={{ fontSize:11,color:'var(--text-muted)',marginBottom:4 }}>Resumen del mes</div>
                          <div style={{ fontSize:20,fontWeight:500,color:'#1D9E75' }}>{totalHoras} hs</div>
                          <div style={{ fontSize:12,color:'var(--text-muted)' }}>90%: {total90} hs</div>
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })()}
            </div>
          )
        })()}

        {vista === 'planillas' && (() => {
          function buildFilasPlanilla(ef) {
            const asist = ef.asistencia || []
            const asistMap = {}
            asist.forEach(a => { asistMap[`${a.dia}-${a.turno}`] = a })
            const turnosEf = (turnos[ef.legajo] || []).sort((a,b) => a.dia - b.dia)

            return Array.from({ length: DIAS_MES }, (_, i) => i + 1).map(dia => {
              const tDia = turnosEf.find(t => t.dia === dia && t.turno === 'd')
              const tNoche = turnosEf.find(t => t.dia === dia && t.turno === 'n')
              const pDia = asistMap[`${dia}-d`]
              const pNoche = asistMap[`${dia}-n`]

              const entradas = []

              // Turnos del cronograma con asistencia
              if (pDia || tDia) {
                entradas.push({ horario: '08:00 a 20:00', horas: pDia ? 12 : 0, confirmado: !!pDia, manual: false })
              }
              if (pNoche || tNoche) {
                entradas.push({ horario: '20:00 a 24:00', horas: pNoche ? 4 : 0, confirmado: !!pNoche, manual: false })
              }

              // Todos los registros manuales de este día
              Object.values(planillaManual).forEach(m => {
                if (m.dia === dia) {
                  const key = `${dia}-${m.horario}`
                  // Avoid duplicating if already added from cronograma
                  const yaExiste = entradas.find(e => e.horario === m.horario)
                  if (!yaExiste) {
                    entradas.push({ horario: m.horario, horas: m.horas, confirmado: false, manual: true, id: m.id })
                  }
                }
              })

              // Sort by horario
              entradas.sort((a,b) => a.horario.localeCompare(b.horario))

              return { dia, entradas }
            })
          }



          const firmaInputRef = typeof document !== 'undefined' ? document.createElement('input') : null

          return (
            <div>
              {!planillaEf ? (
                <div>
                  <p style={{ fontSize:12,color:'var(--text-muted)',marginBottom:14 }}>Seleccioná un efectivo para ver y editar su planilla del mes.</p>
                  <div style={{ display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(250px,1fr))',gap:10 }}>
                    {efectivos.map(ef => {
                      const hs = horasAsig[ef.legajo] || 0
                      const turnosEf = turnos[ef.legajo] || []
                      return (
                        <div key={ef.legajo} style={{ background:'var(--surface)',border:'0.5px solid var(--border)',borderRadius:10,padding:'12px 14px',cursor:'pointer' }}
                          onClick={() => cargarPlanillaEf(ef)}>
                          <div style={{ fontSize:12,fontWeight:500,marginBottom:2 }}>{ef.nombre}</div>
                          <div style={{ fontSize:10,color:'var(--text-muted)',marginBottom:6 }}>Leg. {ef.legajo} · {ef.jerarquia||ef.tipo}</div>
                          <div style={{ display:'flex',justifyContent:'space-between',fontSize:11 }}>
                            <span style={{ color:'var(--text-muted)' }}>{turnosEf.length} guardias</span>
                            <span style={{ color: hs >= 150 ? '#EF9F27' : '#1D9E75',fontWeight:500 }}>{hs} hs</span>
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
                const totalHoras = filas.reduce((sum, f) => sum + f.entradas.reduce((s, e) => s + (e.horas || 0), 0), 0)
                const total90 = Math.round(totalHoras * 0.9)

                return (
                  <div>
                    <div style={{ display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14 }}>
                      <div style={{ display:'flex',alignItems:'center',gap:10 }}>
                        <button className="btn btn-sm" onClick={() => setPlanillaEf(null)}>← Volver</button>
                        <span style={{ fontSize:14,fontWeight:500 }}>{ef.nombre}</span>
                        <span style={{ fontSize:11,color:'var(--text-muted)' }}>Leg. {ef.legajo} · {NOMBRE_MES_P}</span>
                      </div>
                      <div style={{ display:'flex',gap:8 }}>
                        <button className="btn btn-sm" style={{ background:'rgba(200,168,75,0.15)',color:'#c8a84b',border:'0.5px solid rgba(200,168,75,0.4)' }}
                          onClick={() => imprimirPlanillaAdmin(ef)}>🖨 Imprimir</button>
                      </div>
                    </div>

                    <div style={{ display:'grid',gridTemplateColumns:'1fr 320px',gap:16 }}>
                      {/* Tabla editable */}
                      <div className="panel">
                        <div className="panel-header">
                          <h3>Guardias realizadas — {NOMBRE_MES_P}</h3>
                          <span style={{ fontSize:11,color:'#1D9E75',fontWeight:500 }}>Total: {totalHoras} hs · 90%: {total90} hs</span>
                        </div>
                        <div style={{ overflowX:'auto' }}>
                          <table>
                            <thead>
                              <tr>
                                <th style={{ width:50 }}>Día</th>
                                <th>Horario</th>
                                <th style={{ width:80 }}>Horas</th>
                                <th style={{ width:120 }}>Sector</th>
                                <th style={{ width:80 }}>Estado</th>
                              </tr>
                            </thead>
                            <tbody>
                              {filas.map(f => {
                                if (f.entradas.length === 0) return (
                                  <tr key={f.dia} style={{ opacity:0.4 }}>
                                    <td style={{ textAlign:'center',fontWeight:500,background:'var(--surface2)' }}>{f.dia}</td>
                                    <td colSpan={4} style={{ fontSize:10,color:'var(--text-hint)' }}>Sin guardia</td>
                                  </tr>
                                )
                                return f.entradas.map((e, i) => (
                                  <tr key={`${f.dia}-${i}`} style={{ background: e.confirmado ? 'rgba(29,158,117,0.08)' : e.manual ? 'rgba(200,168,75,0.06)' : '' }}>
                                    <td style={{ textAlign:'center',fontWeight:500,background:'var(--surface2)',borderTop: i===0 ? '2px solid var(--border2)' : '' }}>{i===0?f.dia:''}</td>
                                    <td style={{ color: e.horario.startsWith('08')?'#EF9F27':'#85B7EB',fontWeight:500 }}>{e.horario}</td>
                                    <td>
                                      <input type="number" min="0" max="12" defaultValue={e.horas||''}
                                        style={{ width:'100%',padding:'3px 6px',border:'0.5px solid var(--border)',borderRadius:4,background:'var(--surface2)',color:'var(--text)',fontSize:12,textAlign:'center' }}
                                        onBlur={ev => guardarHoraManual(ef.legajo, f.dia, e.horario, ev.target.value, e.sector)}
                                      />
                                    </td>
                                    <td style={{ fontSize:11,color:'var(--text-muted)' }}>{e.sector||'—'}</td>
                                    <td style={{ textAlign:'center' }}>
                                      <div style={{ display:'flex',gap:4,alignItems:'center',justifyContent:'center' }}>
                                        {e.confirmado ? <span style={{ fontSize:10,color:'#1D9E75',fontWeight:500 }}>✓ Presente</span>
                                          : e.manual ? <span style={{ fontSize:10,color:'#c8a84b' }}>Manual</span>
                                          : <span style={{ fontSize:10,color:'var(--text-hint)' }}>Asignado</span>}
                                        {e.manual && <button style={{ background:'none',border:'none',cursor:'pointer',color:'#F09595',fontSize:12,padding:'0 2px' }}
                                          onClick={() => guardarHoraManual(ef.legajo, f.dia, e.horario, '', '')}>✕</button>}
                                      </div>
                                    </td>
                                  </tr>
                                ))
                              })}
                              {/* Fila para agregar hora manual */}
                              <tr style={{ background:'rgba(200,168,75,0.04)' }}>
                                <td colSpan={5} style={{ padding:'8px 12px' }}>
                                  <div style={{ display:'flex',gap:8,alignItems:'center',flexWrap:'wrap' }}>
                                    <span style={{ fontSize:11,color:'var(--text-muted)' }}>Agregar horas manual:</span>
                                    <select value={manualDia} onChange={e => setManualDia(parseInt(e.target.value))}
                                      style={{ padding:'4px 8px',fontSize:11,background:'var(--surface2)',color:'var(--text)',border:'0.5px solid var(--border)',borderRadius:4 }}>
                                      {Array.from({length:DIAS_MES},(_,i)=><option key={i+1} value={i+1}>Día {i+1}</option>)}
                                    </select>
                                    <div style={{ display:'flex',alignItems:'center',gap:4 }}>
                                      <input type="time" value={manualHorario} onChange={e => {
                                        setManualHorario(e.target.value)
                                      }} style={{ padding:'4px 6px',fontSize:11,background:'var(--surface2)',color:'var(--text)',border:'0.5px solid var(--border)',borderRadius:4 }} />
                                      <span style={{ fontSize:11,color:'var(--text-muted)' }}>a</span>
                                      <input type="time" value={manualHoras} onChange={e => {
                                        setManualHoras(e.target.value)
                                      }} style={{ padding:'4px 6px',fontSize:11,background:'var(--surface2)',color:'var(--text)',border:'0.5px solid var(--border)',borderRadius:4 }} />
                                    </div>
                                    <button className="btn btn-sm" style={{ fontSize:11,background:'rgba(200,168,75,0.15)',color:'#c8a84b',border:'0.5px solid rgba(200,168,75,0.4)' }}
                                      onClick={async () => {
                                        if (!manualHorario || !manualHoras) return
                                        // Calculate hours difference
                                        const [h1,m1] = manualHorario.split(':').map(Number)
                                        const [h2,m2] = manualHoras.split(':').map(Number)
                                        let diff = (h2*60+m2) - (h1*60+m1)
                                        if (diff <= 0) diff += 24*60  // overnight
                                        const hsCalc = Math.round(diff/60)
                                        const horarioStr = `${manualHorario} a ${manualHoras}`
                                        await guardarHoraManual(ef.legajo, manualDia, horarioStr, hsCalc, '')
                                        setManualHorario('')
                                        setManualHoras('')
                                        await cargarPlanillaEf(ef)
                                      }}>+ Agregar</button>
                                  </div>
                                </td>
                              </tr>
                            </tbody>
                          </table>
                        </div>
                      </div>

                      {/* Panel derecho: datos + firma */}
                      <div>
                        <div className="panel" style={{ marginBottom:12 }}>
                          <div className="panel-header"><h3>Datos del efectivo</h3></div>
                          <div style={{ padding:12 }}>
                            {[['Nombre',ef.nombre],['Legajo',ef.legajo],['DNI',ef.dni||'—'],['Jerarquía',ef.jerarquia||'—'],['Tipo',ef.tipo],['Sector',ef.sector||'—']].map(([k,v])=>(
                              <div key={k} style={{ display:'flex',justifyContent:'space-between',padding:'5px 0',borderBottom:'0.5px solid var(--border)',fontSize:12 }}>
                                <span style={{ color:'var(--text-muted)' }}>{k}</span>
                                <span style={{ fontWeight:500 }}>{v}</span>
                              </div>
                            ))}
                          </div>
                        </div>

                        <div className="panel">
                          <div className="panel-header"><h3>Firma del efectivo</h3></div>
                          <div style={{ padding:12 }}>
                            {firma
                              ? <div>
                                  <img src={firma} style={{ width:'100%',maxHeight:100,objectFit:'contain',marginBottom:8,background:'white',borderRadius:4,padding:4 }} alt="firma" />
                                  <button className="btn btn-sm" style={{ width:'100%',justifyContent:'center',fontSize:11 }}
                                    onClick={() => { const inp=document.createElement('input'); inp.type='file'; inp.accept='image/*'; inp.onchange=e=>{ if(e.target.files[0]) subirFirmaAdmin(ef.legajo,e.target.files[0]) }; inp.click() }}>
                                    Cambiar firma
                                  </button>
                                </div>
                              : <div>
                                  <div style={{ height:60,display:'flex',alignItems:'center',justifyContent:'center',marginBottom:8,border:'0.5px dashed var(--border)',borderRadius:6 }}>
                                    <span style={{ fontSize:11,color:'var(--text-hint)' }}>Sin firma</span>
                                  </div>
                                  <button className="btn btn-sm" style={{ width:'100%',justifyContent:'center',fontSize:11,background:'rgba(200,168,75,0.1)',color:'#c8a84b',border:'0.5px solid rgba(200,168,75,0.3)' }}
                                    onClick={() => { const inp=document.createElement('input'); inp.type='file'; inp.accept='image/*'; inp.onchange=e=>{ if(e.target.files[0]) subirFirmaAdmin(ef.legajo,e.target.files[0]) }; inp.click() }}>
                                    + Subir firma
                                  </button>
                                </div>
                            }
                          </div>
                        </div>

                        <div style={{ marginTop:10,padding:'10px 12px',background:'var(--surface2)',borderRadius:8 }}>
                          <div style={{ fontSize:11,color:'var(--text-muted)',marginBottom:4 }}>Resumen del mes</div>
                          <div style={{ fontSize:20,fontWeight:500,color:'#1D9E75' }}>{totalHoras} hs</div>
                          <div style={{ fontSize:12,color:'var(--text-muted)' }}>90%: {total90} hs</div>
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })()}
            </div>
          )
        })()}



        {vista === 'planillas' && (() => {
          const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
          const NOMBRE_MES_P = MESES[MES-1] + ' ' + ANIO
          const NOMBRE_MES_SOLO = MESES[MES-1]



          const firmaInputRef = typeof document !== 'undefined' ? document.createElement('input') : null

          return (
            <div>
              {!planillaEf ? (
                <div>
                  <p style={{ fontSize:12,color:'var(--text-muted)',marginBottom:14 }}>Seleccioná un efectivo para ver y editar su planilla del mes.</p>
                  <div style={{ display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(250px,1fr))',gap:10 }}>
                    {efectivos.map(ef => {
                      const hs = horasAsig[ef.legajo] || 0
                      const turnosEf = turnos[ef.legajo] || []
                      return (
                        <div key={ef.legajo} style={{ background:'var(--surface)',border:'0.5px solid var(--border)',borderRadius:10,padding:'12px 14px',cursor:'pointer' }}
                          onClick={() => cargarPlanillaEf(ef)}>
                          <div style={{ fontSize:12,fontWeight:500,marginBottom:2 }}>{ef.nombre}</div>
                          <div style={{ fontSize:10,color:'var(--text-muted)',marginBottom:6 }}>Leg. {ef.legajo} · {ef.jerarquia||ef.tipo}</div>
                          <div style={{ display:'flex',justifyContent:'space-between',fontSize:11 }}>
                            <span style={{ color:'var(--text-muted)' }}>{turnosEf.length} guardias</span>
                            <span style={{ color: hs >= 150 ? '#EF9F27' : '#1D9E75',fontWeight:500 }}>{hs} hs</span>
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
                const totalHoras = filas.reduce((sum, f) => sum + f.entradas.reduce((s, e) => s + (e.horas || 0), 0), 0)
                const total90 = Math.round(totalHoras * 0.9)

                return (
                  <div>
                    <div style={{ display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14 }}>
                      <div style={{ display:'flex',alignItems:'center',gap:10 }}>
                        <button className="btn btn-sm" onClick={() => setPlanillaEf(null)}>← Volver</button>
                        <span style={{ fontSize:14,fontWeight:500 }}>{ef.nombre}</span>
                        <span style={{ fontSize:11,color:'var(--text-muted)' }}>Leg. {ef.legajo} · {NOMBRE_MES_P}</span>
                      </div>
                      <div style={{ display:'flex',gap:8 }}>
                        <button className="btn btn-sm" style={{ background:'rgba(200,168,75,0.15)',color:'#c8a84b',border:'0.5px solid rgba(200,168,75,0.4)' }}
                          onClick={() => imprimirPlanillaAdmin(ef)}>🖨 Imprimir</button>
                      </div>
                    </div>

                    <div style={{ display:'grid',gridTemplateColumns:'1fr 320px',gap:16 }}>
                      {/* Tabla editable */}
                      <div className="panel">
                        <div className="panel-header">
                          <h3>Guardias realizadas — {NOMBRE_MES_P}</h3>
                          <span style={{ fontSize:11,color:'#1D9E75',fontWeight:500 }}>Total: {totalHoras} hs · 90%: {total90} hs</span>
                        </div>
                        <div style={{ overflowX:'auto' }}>
                          <table>
                            <thead>
                              <tr>
                                <th style={{ width:50 }}>Día</th>
                                <th>Horario</th>
                                <th style={{ width:80 }}>Horas</th>
                                <th style={{ width:120 }}>Sector</th>
                                <th style={{ width:80 }}>Estado</th>
                              </tr>
                            </thead>
                            <tbody>
                              {filas.map(f => {
                                if (f.entradas.length === 0) return (
                                  <tr key={f.dia} style={{ opacity:0.4 }}>
                                    <td style={{ textAlign:'center',fontWeight:500,background:'var(--surface2)' }}>{f.dia}</td>
                                    <td colSpan={4} style={{ fontSize:10,color:'var(--text-hint)' }}>Sin guardia</td>
                                  </tr>
                                )
                                return f.entradas.map((e, i) => (
                                  <tr key={`${f.dia}-${i}`} style={{ background: e.confirmado ? 'rgba(29,158,117,0.08)' : e.manual ? 'rgba(200,168,75,0.06)' : '' }}>
                                    <td style={{ textAlign:'center',fontWeight:500,background:'var(--surface2)',borderTop: i===0 ? '2px solid var(--border2)' : '' }}>{i===0?f.dia:''}</td>
                                    <td style={{ color: e.horario.startsWith('08')?'#EF9F27':'#85B7EB',fontWeight:500 }}>{e.horario}</td>
                                    <td>
                                      <input type="number" min="0" max="12" defaultValue={e.horas||''}
                                        style={{ width:'100%',padding:'3px 6px',border:'0.5px solid var(--border)',borderRadius:4,background:'var(--surface2)',color:'var(--text)',fontSize:12,textAlign:'center' }}
                                        onBlur={ev => guardarHoraManual(ef.legajo, f.dia, e.horario, ev.target.value, e.sector)}
                                      />
                                    </td>
                                    <td style={{ fontSize:11,color:'var(--text-muted)' }}>{e.sector||'—'}</td>
                                    <td style={{ textAlign:'center' }}>
                                      <div style={{ display:'flex',gap:4,alignItems:'center',justifyContent:'center' }}>
                                        {e.confirmado ? <span style={{ fontSize:10,color:'#1D9E75',fontWeight:500 }}>✓ Presente</span>
                                          : e.manual ? <span style={{ fontSize:10,color:'#c8a84b' }}>Manual</span>
                                          : <span style={{ fontSize:10,color:'var(--text-hint)' }}>Asignado</span>}
                                        {e.manual && <button style={{ background:'none',border:'none',cursor:'pointer',color:'#F09595',fontSize:12,padding:'0 2px' }}
                                          onClick={() => guardarHoraManual(ef.legajo, f.dia, e.horario, '', '')}>✕</button>}
                                      </div>
                                    </td>
                                  </tr>
                                ))
                              })}
                              {/* Fila para agregar hora manual */}
                              <tr style={{ background:'rgba(200,168,75,0.04)' }}>
                                <td colSpan={5} style={{ padding:'8px 12px' }}>
                                  <div style={{ display:'flex',gap:8,alignItems:'center',flexWrap:'wrap' }}>
                                    <span style={{ fontSize:11,color:'var(--text-muted)' }}>Agregar horas manual:</span>
                                    <select value={manualDia} onChange={e => setManualDia(parseInt(e.target.value))}
                                      style={{ padding:'4px 8px',fontSize:11,background:'var(--surface2)',color:'var(--text)',border:'0.5px solid var(--border)',borderRadius:4 }}>
                                      {Array.from({length:DIAS_MES},(_,i)=><option key={i+1} value={i+1}>Día {i+1}</option>)}
                                    </select>
                                    <div style={{ display:'flex',alignItems:'center',gap:4 }}>
                                      <input type="time" value={manualHorario} onChange={e => {
                                        setManualHorario(e.target.value)
                                      }} style={{ padding:'4px 6px',fontSize:11,background:'var(--surface2)',color:'var(--text)',border:'0.5px solid var(--border)',borderRadius:4 }} />
                                      <span style={{ fontSize:11,color:'var(--text-muted)' }}>a</span>
                                      <input type="time" value={manualHoras} onChange={e => {
                                        setManualHoras(e.target.value)
                                      }} style={{ padding:'4px 6px',fontSize:11,background:'var(--surface2)',color:'var(--text)',border:'0.5px solid var(--border)',borderRadius:4 }} />
                                    </div>
                                    <button className="btn btn-sm" style={{ fontSize:11,background:'rgba(200,168,75,0.15)',color:'#c8a84b',border:'0.5px solid rgba(200,168,75,0.4)' }}
                                      onClick={async () => {
                                        if (!manualHorario || !manualHoras) return
                                        // Calculate hours difference
                                        const [h1,m1] = manualHorario.split(':').map(Number)
                                        const [h2,m2] = manualHoras.split(':').map(Number)
                                        let diff = (h2*60+m2) - (h1*60+m1)
                                        if (diff <= 0) diff += 24*60  // overnight
                                        const hsCalc = Math.round(diff/60)
                                        const horarioStr = `${manualHorario} a ${manualHoras}`
                                        await guardarHoraManual(ef.legajo, manualDia, horarioStr, hsCalc, '')
                                        setManualHorario('')
                                        setManualHoras('')
                                        await cargarPlanillaEf(ef)
                                      }}>+ Agregar</button>
                                  </div>
                                </td>
                              </tr>
                            </tbody>
                          </table>
                        </div>
                      </div>

                      {/* Panel derecho: datos + firma */}
                      <div>
                        <div className="panel" style={{ marginBottom:12 }}>
                          <div className="panel-header"><h3>Datos del efectivo</h3></div>
                          <div style={{ padding:12 }}>
                            {[['Nombre',ef.nombre],['Legajo',ef.legajo],['DNI',ef.dni||'—'],['Jerarquía',ef.jerarquia||'—'],['Tipo',ef.tipo],['Sector',ef.sector||'—']].map(([k,v])=>(
                              <div key={k} style={{ display:'flex',justifyContent:'space-between',padding:'5px 0',borderBottom:'0.5px solid var(--border)',fontSize:12 }}>
                                <span style={{ color:'var(--text-muted)' }}>{k}</span>
                                <span style={{ fontWeight:500 }}>{v}</span>
                              </div>
                            ))}
                          </div>
                        </div>

                        <div className="panel">
                          <div className="panel-header"><h3>Firma del efectivo</h3></div>
                          <div style={{ padding:12 }}>
                            {firma
                              ? <div>
                                  <img src={firma} style={{ width:'100%',maxHeight:100,objectFit:'contain',marginBottom:8,background:'white',borderRadius:4,padding:4 }} alt="firma" />
                                  <button className="btn btn-sm" style={{ width:'100%',justifyContent:'center',fontSize:11 }}
                                    onClick={() => { const inp=document.createElement('input'); inp.type='file'; inp.accept='image/*'; inp.onchange=e=>{ if(e.target.files[0]) subirFirmaAdmin(ef.legajo,e.target.files[0]) }; inp.click() }}>
                                    Cambiar firma
                                  </button>
                                </div>
                              : <div>
                                  <div style={{ height:60,display:'flex',alignItems:'center',justifyContent:'center',marginBottom:8,border:'0.5px dashed var(--border)',borderRadius:6 }}>
                                    <span style={{ fontSize:11,color:'var(--text-hint)' }}>Sin firma</span>
                                  </div>
                                  <button className="btn btn-sm" style={{ width:'100%',justifyContent:'center',fontSize:11,background:'rgba(200,168,75,0.1)',color:'#c8a84b',border:'0.5px solid rgba(200,168,75,0.3)' }}
                                    onClick={() => { const inp=document.createElement('input'); inp.type='file'; inp.accept='image/*'; inp.onchange=e=>{ if(e.target.files[0]) subirFirmaAdmin(ef.legajo,e.target.files[0]) }; inp.click() }}>
                                    + Subir firma
                                  </button>
                                </div>
                            }
                          </div>
                        </div>

                        <div style={{ marginTop:10,padding:'10px 12px',background:'var(--surface2)',borderRadius:8 }}>
                          <div style={{ fontSize:11,color:'var(--text-muted)',marginBottom:4 }}>Resumen del mes</div>
                          <div style={{ fontSize:20,fontWeight:500,color:'#1D9E75' }}>{totalHoras} hs</div>
                          <div style={{ fontSize:12,color:'var(--text-muted)' }}>90%: {total90} hs</div>
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })()}
            </div>
          )
        })()}


      </div>
    </div>
  )
}const MESES_NOMBRES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
const NOMBRE_MES_P = MESES_NOMBRES[MES-1] + ' ' + ANIO
