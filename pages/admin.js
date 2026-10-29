import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../lib/supabase'
import FirmaEditorModal from '../components/FirmaEditorModal'
import { ejecutarGeneracionDeTurnos } from '../lib/generarTurnosFlujo'
import { resolverObjetivoGuardias, turnosPermitidosPorObjetivo, resumenObjetivo } from '../lib/objetivosEfectivos'
import { ejecutarAsignacionRapida, calcularAsignacionRapida } from '../lib/asignacionRapidaFlujo'
import { calcularCompletarDia, topeCantidadPedida } from '../lib/completarDia'
import { infoDiaEspecial } from '../lib/feriadosArgentina'

function _detectLugar() {
  try { if (process.env.NEXT_PUBLIC_LUGAR && ['HIGA','UPA','MODULAR'].includes(process.env.NEXT_PUBLIC_LUGAR)) return process.env.NEXT_PUBLIC_LUGAR } catch(e) {}
  if (typeof window === 'undefined') return 'HIGA'
  const h = window.location.hostname
  if (h === 'polad-modular.vercel.app' || h.includes('polad-modular')) return 'MODULAR'
  if (h === 'polad-higa-upa.vercel.app') return 'UPA'
  return 'HIGA'
}
// APP_LUGAR se recalcula en cliente via useEffect — ver hook useLugar en AdminApp
const APP_LUGAR = _detectLugar()
const SECTORES_POR_LUGAR = {
  'HIGA': ['Salud Mental', 'Giratoria', 'Llaves', 'Guardia', 'Estacionamiento', 'Rondin Externo'],
  'UPA': ['UPA'],
  'MODULAR': ['Modular']
}

// Color por escalafón (Uniformado/Serv. General/Destacamento), para que se
// distingan de un vistazo en las tarjetas de Edición manual — antes los tres
// salían en el mismo gris apagado. Uniformado va dorado, a pedido.
function colorTipo(tipo) {
  if (tipo === 'Uniformado') return '#F5C518'
  if (tipo === 'Serv. General') return '#5DCAA5'
  if (tipo === 'Destacamento') return '#B98CF2'
  return 'var(--text-muted)'
}

// ── Chequeo de cruce de horario entre lugares, reutilizable tanto por
// Asignación rápida como por la edición manual de un turno individual ──
function lugarDeSectorGlobal(sector) {
  if (SECTORES_POR_LUGAR['MODULAR'].includes(sector)) return 'MODULAR'
  if (SECTORES_POR_LUGAR['UPA'].includes(sector)) return 'UPA'
  return 'HIGA'
}
const MIN_DIA_G = 24 * 60
function rangoTurnoGlobal(dia, turno, lugar) {
  const base = (dia - 1) * MIN_DIA_G
  if (lugar === 'MODULAR') {
    if (turno === 'm') return [base + 8 * 60, base + 16 * 60]
    if (turno === 't') return [base + 16 * 60, base + 24 * 60]
    return [base + MIN_DIA_G, base + MIN_DIA_G + 8 * 60] // noche real: 23:59 día X -> 08:00 día X+1
  }
  return turno === 'd' ? [base + 8 * 60, base + 20 * 60] : [base + 20 * 60, base + MIN_DIA_G + 8 * 60]
}
function seSuperponenGlobal(a, b) { return a[0] < b[1] && b[0] < a[1] }
// Normaliza un legajo para comparar entre tablas sin que un espacio de más o una
// diferencia de mayúsculas/minúsculas rompa la comparación (p.ej. "340741 " vs "340741").
function normLegajo(x) { return x === null || x === undefined ? '' : String(x).trim().toUpperCase() }
// Busca si el legajo ya tiene, en OTRO lugar, un turno que se superponga en horario real
// con el turno candidato. idExcluir sirve para no comparar un turno contra sí mismo al editar.
//
// Corrección de esta ronda ("¿el vigía sigue vigente?"): antes, si la
// consulta al servidor fallaba por CUALQUIER motivo (sesión de admin
// vencida, corte de red, error del servidor), el código la trataba
// exactamente igual que "no hay ningún cruce" — dejaba guardar en
// silencio un turno que podía superponerse con otro destino sin avisar
// nada, porque nunca llegó a comparar nada. Es el mismo problema que ya
// se había corregido para "Asignación rápida" (Bug 6 en
// lib/asignacionRapidaFlujo.js: un error de lectura nunca se trata como
// "lista vacía") pero nunca se había aplicado acá, a la edición manual.
// Ahora esta función devuelve { ok, cruce } o { ok:false, motivo } — y
// quien la llama (handleGuardarEdicion / handleAgregarTurno, más abajo)
// avisa explícitamente cuando la verificación no pudo correr, en vez de
// guardar como si estuviera todo despejado.
async function buscarCruceOtroLugar(legajo, dia, turno, lugarPropio, mes, anio, idExcluir) {
  if (!legajo) return { ok: true, cruce: null }
  // Punto 1 de la revisión: antes esto leía la tabla turnos directo con la
  // clave anon. Ahora pasa por un endpoint con sesión de administrador
  // (service role) — scope=todas porque este chequeo es deliberadamente
  // cruzado entre lugares (un mismo legajo puede tener turnos en otro
  // lugar, y hace falta verlos para detectar superposiciones de horario).
  let res
  try {
    res = await fetch(`/api/admin-turnos?mes=${mes}&anio=${anio}&legajo=${encodeURIComponent(legajo)}&scope=todas`)
  } catch (eRed) {
    return { ok: false, motivo: `error de red (${eRed.message})` }
  }
  if (!res.ok) {
    let detalle = ''
    try { const cuerpo = await res.json(); detalle = cuerpo?.error || '' } catch { /* un 401/500 no siempre trae JSON */ }
    return { ok: false, motivo: `el servidor respondió ${res.status}${detalle ? ': ' + detalle : ''} — probablemente la sesión de administrador venció` }
  }
  let body
  try {
    body = await res.json()
  } catch (eJson) {
    return { ok: false, motivo: `la respuesta no es JSON válido (${eJson.message})` }
  }
  if (!body || !Array.isArray(body.turnos)) {
    return { ok: false, motivo: 'la consulta no devolvió el formato esperado' }
  }
  const rangoCand = rangoTurnoGlobal(dia, turno, lugarPropio)
  for (const o of body.turnos) {
    if (idExcluir && o.id === idExcluir) continue
    const lugarO = lugarDeSectorGlobal(o.sector)
    if (lugarO === lugarPropio) continue
    const rangoO = rangoTurnoGlobal(parseInt(o.dia), o.turno, lugarO)
    if (seSuperponenGlobal(rangoCand, rangoO)) return { ok: true, cruce: { dia: o.dia, turno: o.turno, sector: o.sector, lugar: lugarO } }
  }
  return { ok: true, cruce: null }
}
const SECTORES_APP = SECTORES_POR_LUGAR[APP_LUGAR] || SECTORES_POR_LUGAR['HIGA']
const ES_MODULAR = APP_LUGAR === 'MODULAR'
const TURNOS_LUGAR = ES_MODULAR ? ['m', 't', 'n'] : ['d', 'n']
const HORAS_TURNO = ES_MODULAR ? 8 : 12
const MAX_POR_SLOT = ES_MODULAR ? 2 : 2
// Slots máximos por sector y turno (override del global). En HIGA:
//  - Salud Mental: 2 efectivos de día, 1 de noche
//  - Llaves: 2 efectivos de día, 1 de noche
//  - Rondin Externo: 0 de día (no se cubre ese turno), 2 de noche
const SLOTS_POR_SECTOR_TURNO = APP_LUGAR === 'HIGA' ? {
  'Salud Mental':   { d: 2, n: 1 },
  'Llaves':         { d: 2, n: 1 },
  'Rondin Externo': { d: 0, n: 2 },
} : {}
function maxSlot(sector, turno) {
  const porTurno = SLOTS_POR_SECTOR_TURNO[sector]
  if (porTurno && turno in porTurno) return porTurno[turno]
  return MAX_POR_SLOT
}
// Corrección de esta ronda ("Confirmación de WhatsApp"): calcula, EN EL
// NAVEGADOR, el mismo fingerprint que calcula el servidor
// (fn_whatsapp_sincronizar_tras_publicar, supabase/migrations/
// 0005_correcciones_ronda_bugs.sql: `string_agg(dia::text || '-' || turno
// || '-' || sector, ',' order by dia, turno, sector)`, '' si no hay
// ninguno) a partir de los turnos publicados que el navegador tiene
// cargados para un efectivo (turnosPublicadosPorLegajo[legajo]). Se manda
// este valor al abrir y al confirmar el aviso de WhatsApp (ver
// abrirAviso/confirmarAviso más abajo) para que el servidor pueda
// verificar que el contenido que la pantalla preparó es EXACTAMENTE el
// vigente — nunca fotografiar a ciegas lo que el servidor tenía guardado.
function fingerprintTurnos(ts) {
  const ordenado = [...(ts || [])].sort((a, b) => {
    if (a.dia !== b.dia) return a.dia - b.dia
    if (a.turno !== b.turno) return a.turno < b.turno ? -1 : 1
    if (a.sector !== b.sector) return a.sector < b.sector ? -1 : 1
    return 0
  })
  return ordenado.map(t => `${t.dia}-${t.turno}-${t.sector}`).join(',')
}
const TURNOS_INFO = ES_MODULAR
  ? [
      { key: 'm', label: 'Mañana 08-16', color: '#EF9F27', bg: 'rgba(239,159,39,0.15)', horario: '08:00 a 16:00' },
      { key: 't', label: 'Tarde 16-24',  color: '#AFA9EC', bg: 'rgba(127,119,221,0.15)', horario: '16:00 a 24:00' },
      { key: 'n', label: 'Noche 23:59-08',  color: '#85B7EB', bg: 'rgba(55,138,221,0.15)', horario: '23:59 a 08:00' },
    ]
  : [
      { key: 'd', label: 'Día 08-20',    color: '#EF9F27', bg: 'rgba(239,159,39,0.15)', horario: '08:00 a 20:00' },
      { key: 'n', label: 'Noche 20-08',  color: '#85B7EB', bg: 'rgba(55,138,221,0.15)', horario: '20:00 a 08:00' },
    ]

const SEC_COLORS = { 'Salud Mental': '#378ADD', 'Giratoria': '#1D9E75', 'Llaves': '#EF9F27', 'Guardia': '#D4537E', 'Estacionamiento': '#7F77DD', 'Rondin Externo': '#FF7043', 'UPA': '#D85A30', 'Modular': '#20A0B0' }
const MES_ACTUAL = new Date().getMonth() + 1
const ANIO_ACTUAL = new Date().getFullYear()
const MESES_NOMBRES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
// Pedido de esta ronda: en "Edición manual", el título arriba del detalle
// del día (que dice "Día X — Mes Año — LUGAR") pase a decir también QUÉ día
// de la semana es (ej. "Domingo 1 — ..."), solo como dato de orientación —
// los numeritos de arriba (el selector de días) quedan exactamente igual,
// solo números, sin tocar.
const DIAS_SEMANA_NOMBRES = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado']
const VISTAS = ['resumen', 'personal', 'disponibilidad', 'turnos', 'edicion', 'rapida', 'buscarLegajo', 'config', 'planillas', 'descarga']
const LABELS = { resumen: 'Resumen', personal: 'Personal', disponibilidad: 'Disponibilidad', turnos: 'Guardias', edicion: 'Edición manual', rapida: '⚡ Asignación rápida', buscarLegajo: '🔍 Buscar legajo', config: 'Configuración', planillas: 'Planillas', descarga: '⬇ Planilla Guardia' }

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
  // "Sin informar" se sacó como opción: el sexo se elige acá sí o sí, nunca
  // queda sin cargar. Si el efectivo ya tiene femenino/masculino cargado se
  // conserva; si todavía no tiene nada (alta nueva, o un registro viejo que
  // haya quedado en 'sin_informar'), arranca vacío para obligar a elegir.
  const [form, setForm] = useState({ ...datos, lugar: datos.lugar || APP_LUGAR, sexo: (datos.sexo === 'femenino' || datos.sexo === 'masculino') ? datos.sexo : '' })
  const esNuevo = !datos.id
  // Punto 2/3 de esta ronda ("Puestos específicos" / "Objetivos
  // individuales"): paneles aparte, con su propio guardado (no pasan por
  // onGuardar/fn_admin_guardar_efectivo) — ver pages/api/admin-reglas-puesto.js
  // y pages/api/admin-reglas-objetivo.js. Solo tienen sentido para un
  // efectivo que YA existe (necesitan su legajo+lugar ya guardado).
  const [puestoFijo, setPuestoFijo] = useState(null) // { id, sector, turno } | null
  const [puestoFijoForm, setPuestoFijoForm] = useState({ sector: '', turno: '' })
  const [puestoFijoMsg, setPuestoFijoMsg] = useState(null)
  const [puestoFijoGuardando, setPuestoFijoGuardando] = useState(false)
  const [objetivoCfg, setObjetivoCfg] = useState(null) // { id, tipo, cantidad, turno_objetivo } | null
  const [objetivoForm, setObjetivoForm] = useState({ tipo: 'guardias', cantidad: '', turno_objetivo: 'ambos' })
  const [objetivoMsg, setObjetivoMsg] = useState(null)
  const [objetivoGuardando, setObjetivoGuardando] = useState(false)

  useEffect(() => {
    if (esNuevo) return
    fetch(`/api/admin-reglas-puesto?legajo=${encodeURIComponent(datos.legajo)}`).then(r => r.json()).then(({ reglas }) => {
      const r = (reglas || [])[0]
      if (r) { setPuestoFijo(r); setPuestoFijoForm({ sector: r.sector, turno: r.turno || '' }) }
    }).catch(() => {})
    fetch(`/api/admin-reglas-objetivo?legajo=${encodeURIComponent(datos.legajo)}`).then(r => r.json()).then(({ objetivos }) => {
      const o = (objetivos || [])[0]
      if (o) { setObjetivoCfg(o); setObjetivoForm({ tipo: o.tipo, cantidad: String(o.cantidad), turno_objetivo: o.turno_objetivo }) }
    }).catch(() => {})
  }, [])

  async function guardarPuestoFijo() {
    if (!puestoFijoForm.sector) return setPuestoFijoMsg('Elegí un sector.')
    setPuestoFijoGuardando(true); setPuestoFijoMsg(null)
    const { ok, error, regla } = await fetch('/api/admin-reglas-puesto', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'guardar', legajo: datos.legajo, sector: puestoFijoForm.sector, turno: puestoFijoForm.turno || null }),
    }).then(r => r.json())
    setPuestoFijoGuardando(false)
    if (!ok) return setPuestoFijoMsg('Error: ' + error)
    setPuestoFijo(regla); setPuestoFijoMsg('Guardado.')
  }
  async function quitarPuestoFijo() {
    if (!puestoFijo) return
    setPuestoFijoGuardando(true); setPuestoFijoMsg(null)
    const { ok, error } = await fetch('/api/admin-reglas-puesto', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'desactivar', id: puestoFijo.id }),
    }).then(r => r.json())
    setPuestoFijoGuardando(false)
    if (!ok) return setPuestoFijoMsg('Error: ' + error)
    setPuestoFijo(null); setPuestoFijoForm({ sector: '', turno: '' }); setPuestoFijoMsg('Puesto fijo quitado.')
  }

  async function guardarObjetivo() {
    const cant = Number(objetivoForm.cantidad)
    if (!Number.isFinite(cant) || cant < 0) return setObjetivoMsg('Cantidad inválida.')
    setObjetivoGuardando(true); setObjetivoMsg(null)
    const { ok, error, objetivo } = await fetch('/api/admin-reglas-objetivo', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'guardar', legajo: datos.legajo, tipo: objetivoForm.tipo, cantidad: cant, turno_objetivo: objetivoForm.turno_objetivo }),
    }).then(r => r.json())
    setObjetivoGuardando(false)
    if (!ok) return setObjetivoMsg('Error: ' + error)
    setObjetivoCfg(objetivo); setObjetivoMsg('Guardado.')
  }
  async function quitarObjetivo() {
    if (!objetivoCfg) return
    setObjetivoGuardando(true); setObjetivoMsg(null)
    const { ok, error } = await fetch('/api/admin-reglas-objetivo', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'desactivar', id: objetivoCfg.id }),
    }).then(r => r.json())
    setObjetivoGuardando(false)
    if (!ok) return setObjetivoMsg('Error: ' + error)
    setObjetivoCfg(null); setObjetivoForm({ tipo: 'guardias', cantidad: '', turno_objetivo: 'ambos' }); setObjetivoMsg('Objetivo quitado.')
  }

  const sectoresDeEsteApp = SECTORES_POR_LUGAR[APP_LUGAR] || []
  const turnosDeEsteApp = TURNOS_INFO.map(t => t.key)
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
          {/* Punto 1 de esta ronda ("Identificación por sexo"): femenino/
              masculino. Nunca se infiere del nombre — se elige a mano acá.
              Pedido de esta ronda: "sin informar" no existe como opción,
              así que no se puede guardar el efectivo sin elegir uno de los
              dos (ver el disabled del botón "Dar de alta"/"Guardar" más
              abajo). No introduce ninguna restricción de asignación (ver
              pages/admin.js, procesarRapida: no se lee este campo en
              ningún lado del algoritmo). */}
          <div style={{ marginBottom:8 }}>
            <label>Sexo</label>
            <select value={form.sexo||''} onChange={e => setForm({...form,sexo:e.target.value})} style={{ width:'100%',padding:'7px 10px',border:`0.5px solid ${form.sexo?'rgba(255,255,255,0.12)':'rgba(220,80,80,0.5)'}`,borderRadius:8,fontSize:13,background:'#1e2130',color:'#e8eaf0',outline:'none' }}>
              <option value="" disabled>— Elegí uno —</option>
              <option value="femenino">Femenino</option>
              <option value="masculino">Masculino</option>
            </select>
          </div>
          <div style={{ marginBottom:4 }}>
            <label>📝 Nota / Recordatorio</label>
            <textarea value={form.notas||''} onChange={e => setForm({...form,notas:e.target.value})} rows={2} style={{ width:'100%',padding:'7px 10px',border:'0.5px solid rgba(255,255,255,0.12)',borderRadius:8,fontSize:12,background:'#1e2130',color:'#e8eaf0',outline:'none',resize:'none' }} />
          </div>
          {!esNuevo && (
            <div style={{ marginTop:10,padding:'10px 12px',background:'rgba(239,159,39,0.06)',borderRadius:8,border:'0.5px solid rgba(239,159,39,0.2)' }}>
              <div style={{ fontSize:11,color:'#EF9F27',fontWeight:500,marginBottom:6 }}>🔑 Contraseña del efectivo</div>
              <div style={{ display:'flex',gap:8,alignItems:'center' }}>
                <span style={{ fontSize:11,color:'var(--text-muted)',flex:1 }}>
                  {form.password ? 'Tiene clave personalizada' : 'Usa su legajo como clave'}
                </span>
                <button className="btn btn-sm" style={{ fontSize:11,color:'#EF9F27',borderColor:'rgba(239,159,39,0.3)' }}
                  onClick={() => { if(confirm('¿Resetear la clave de ' + form.nombre + '? Volverá a usar su legajo.')) setForm({...form, password: null}) }}>
                  Resetear clave
                </button>
              </div>
            </div>
          )}
          {/* Punto 2 de esta ronda: puesto específico configurable — se
              guarda aparte (pages/api/admin-reglas-puesto.js), no modifica
              fn_admin_guardar_efectivo ni el resto de la ficha. */}
          {!esNuevo && (
            <div style={{ marginTop:10,padding:'10px 12px',background:'rgba(127,119,221,0.06)',borderRadius:8,border:'0.5px solid rgba(127,119,221,0.2)' }}>
              <div style={{ fontSize:11,color:'#AFA9EC',fontWeight:500,marginBottom:6 }}>📍 Puesto fijo (opcional)</div>
              <p style={{ fontSize:10,color:'var(--text-muted)',marginTop:0,marginBottom:8 }}>Si se configura, "⚡ Asignación rápida" intenta asignarlo preferentemente a este sector/turno, respetando siempre su disponibilidad y el cupo real.</p>
              <div style={{ display:'grid',gridTemplateColumns:'2fr 1fr',gap:8,marginBottom:8 }}>
                <select value={puestoFijoForm.sector} onChange={e => setPuestoFijoForm({...puestoFijoForm,sector:e.target.value})} style={{ padding:'6px 8px',border:'0.5px solid rgba(255,255,255,0.12)',borderRadius:6,fontSize:12,background:'#1e2130',color:'#e8eaf0' }}>
                  <option value="">— Sector —</option>
                  {sectoresDeEsteApp.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <select value={puestoFijoForm.turno} onChange={e => setPuestoFijoForm({...puestoFijoForm,turno:e.target.value})} style={{ padding:'6px 8px',border:'0.5px solid rgba(255,255,255,0.12)',borderRadius:6,fontSize:12,background:'#1e2130',color:'#e8eaf0' }}>
                  <option value="">Cualquier turno</option>
                  {turnosDeEsteApp.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              {puestoFijoMsg && <div style={{ fontSize:10,color:puestoFijoMsg.startsWith('Error')?'#F09595':'#5DCAA5',marginBottom:6 }}>{puestoFijoMsg}</div>}
              <div style={{ display:'flex',gap:8 }}>
                <button className="btn btn-sm" disabled={puestoFijoGuardando} onClick={guardarPuestoFijo} style={{ fontSize:11 }}>{puestoFijo ? 'Actualizar' : 'Configurar'}</button>
                {puestoFijo && <button className="btn btn-sm" disabled={puestoFijoGuardando} onClick={quitarPuestoFijo} style={{ fontSize:11,color:'#F09595' }}>Quitar puesto fijo</button>}
              </div>
            </div>
          )}
          {/* Punto 3 de esta ronda: objetivo individual configurable — ídem,
              guardado aparte (pages/api/admin-reglas-objetivo.js). */}
          {!esNuevo && (
            <div style={{ marginTop:10,padding:'10px 12px',background:'rgba(29,158,117,0.06)',borderRadius:8,border:'0.5px solid rgba(29,158,117,0.2)' }}>
              <div style={{ fontSize:11,color:'#5DCAA5',fontWeight:500,marginBottom:6 }}>🎯 Objetivo mensual (opcional)</div>
              <p style={{ fontSize:10,color:'var(--text-muted)',marginTop:0,marginBottom:8 }}>Si se configura, reemplaza al objetivo derivado automáticamente del mes anterior en "⚡ Asignación rápida". Editar la cantidad no borra el historial anterior.</p>
              <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8,marginBottom:8 }}>
                <select value={objetivoForm.tipo} onChange={e => setObjetivoForm({...objetivoForm,tipo:e.target.value})} style={{ padding:'6px 8px',border:'0.5px solid rgba(255,255,255,0.12)',borderRadius:6,fontSize:12,background:'#1e2130',color:'#e8eaf0' }}>
                  <option value="guardias">Guardias</option>
                  <option value="horas">Horas</option>
                </select>
                <input type="number" min="0" placeholder="Cantidad" value={objetivoForm.cantidad} onChange={e => setObjetivoForm({...objetivoForm,cantidad:e.target.value})} style={{ padding:'6px 8px',border:'0.5px solid rgba(255,255,255,0.12)',borderRadius:6,fontSize:12,background:'#1e2130',color:'#e8eaf0' }} />
                <select value={objetivoForm.turno_objetivo} onChange={e => setObjetivoForm({...objetivoForm,turno_objetivo:e.target.value})} style={{ padding:'6px 8px',border:'0.5px solid rgba(255,255,255,0.12)',borderRadius:6,fontSize:12,background:'#1e2130',color:'#e8eaf0' }}>
                  <option value="ambos">Día y noche</option>
                  <option value="dia">Solo día</option>
                  <option value="noche">Solo noche</option>
                </select>
              </div>
              {objetivoMsg && <div style={{ fontSize:10,color:objetivoMsg.startsWith('Error')?'#F09595':'#5DCAA5',marginBottom:6 }}>{objetivoMsg}</div>}
              <div style={{ display:'flex',gap:8 }}>
                <button className="btn btn-sm" disabled={objetivoGuardando} onClick={guardarObjetivo} style={{ fontSize:11 }}>{objetivoCfg ? 'Actualizar' : 'Configurar'}</button>
                {objetivoCfg && <button className="btn btn-sm" disabled={objetivoGuardando} onClick={quitarObjetivo} style={{ fontSize:11,color:'#F09595' }}>Quitar objetivo</button>}
              </div>
            </div>
          )}
        </div>
        <div style={{ padding:'12px 16px',borderTop:'0.5px solid rgba(255,255,255,0.06)',display:'flex',justifyContent:'space-between' }}>
          <div>
            {!esNuevo && <button className="btn btn-sm" style={{ color:'#F09595',borderColor:'rgba(240,149,149,0.3)' }} onClick={() => { if(confirm('¿Eliminar este efectivo?')) onEliminar(form) }}>Eliminar</button>}
          </div>
          <div style={{ display:'flex',gap:8 }}>
            <button className="btn btn-sm" onClick={onClose}>Cancelar</button>
            <button className="btn btn-sm" disabled={guardando||!form.legajo||!form.nombre||!form.sexo} style={{ background:'rgba(200,168,75,0.15)',color:'#c8a84b',border:'0.5px solid rgba(200,168,75,0.4)' }} onClick={() => onGuardar({...form, lugar: APP_LUGAR})}>
              {guardando ? 'Guardando...' : esNuevo ? 'Dar de alta' : 'Guardar'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// Pedido de esta ronda ("que me seleccione por cuál efectivo estoy por
// cambiar"): cuando se suelta una tarjeta arrastrada sobre una casilla
// llena con MÁS DE UN ocupante, en vez de intercambiar a ciegas con el
// primero de la lista, se muestra esto para elegir con cuál de los
// ocupantes intercambiar (o cancelar sin hacer nada). Si la casilla llena
// tiene un solo ocupante no hace falta este paso — ver el onDrop de cada
// casilla en AdminApp.
function ModalElegirSwap({ pendiente, nombreCompleto, onElegir, onCancelar }) {
  const tiInfo = TURNOS_INFO.find(x => x.key === pendiente.turno)
  const labelTurno = tiInfo ? tiInfo.label : pendiente.turno
  return (
    <div style={{ position:'fixed',inset:0,background:'rgba(0,0,0,0.6)',zIndex:60,display:'flex',alignItems:'center',justifyContent:'center',padding:20 }}>
      <div style={{ background:'#13151f',borderRadius:12,border:'0.5px solid rgba(255,255,255,0.1)',width:'100%',maxWidth:380,overflow:'hidden' }}>
        <div style={{ padding:'14px 16px',borderBottom:'0.5px solid rgba(255,255,255,0.08)',background:'#1a1d27' }}>
          <h3 style={{ fontSize:14,fontWeight:500,color:'#e8eaf0' }}>¿Con quién intercambiar?</h3>
        </div>
        <div style={{ padding:16 }}>
          <div style={{ fontSize:12,color:'#8b90a0',marginBottom:12 }}>
            {pendiente.sector} · {labelTurno} ya tiene {pendiente.opciones.length} efectivos. Elegí a cuál reemplazar por <strong style={{ color:'#e8eaf0' }}>{nombreCompleto(pendiente.item.legajo)}</strong> — el elegido pasa al lugar que deja libre.
          </div>
          <div style={{ display:'flex',flexDirection:'column',gap:8 }}>
            {pendiente.opciones.map(op => (
              <button key={op.id} className="btn btn-sm" style={{ justifyContent:'flex-start',padding:'8px 12px' }} onClick={() => onElegir(op)}>
                {nombreCompleto(op.legajo)}
              </button>
            ))}
          </div>
        </div>
        <div style={{ padding:'12px 16px',borderTop:'0.5px solid rgba(255,255,255,0.06)',display:'flex',justifyContent:'flex-end' }}>
          <button className="btn btn-sm" onClick={onCancelar}>Cancelar</button>
        </div>
      </div>
    </div>
  )
}

export default function AdminApp() {
  const router = useRouter()
  const [mesSeleccionado, setMesSeleccionado] = useState(MES_ACTUAL)
  const [anioSeleccionado, setAnioSeleccionado] = useState(ANIO_ACTUAL)
  // Pedido de esta ronda ("candadito"): por qué "se cambiaba el mes solo" al
  // entrar y salir — mesSeleccionado/anioSeleccionado nunca se guardaban en
  // ningún lado, así que cada vez que se recargaba la página arrancaban de
  // nuevo en el mes/año REAL de hoy (MES_ACTUAL/ANIO_ACTUAL de arriba), sin
  // importar en qué mes se había estado trabajando. El candado (guardado en
  // localStorage, igual que polad_ventanas_${lugar} más abajo) hace dos
  // cosas: 1) si está activo, el mes/año con el que se entró la última vez
  // se restaura al volver a entrar (ver el useEffect de montaje), en vez de
  // "resetear" al mes de hoy; 2) mientras está activo, los selectores de
  // mes/año quedan deshabilitados, para que no se puedan tocar por error.
  const [mesBloqueado, setMesBloqueado] = useState(false)
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
  // Pedido de esta ronda ("arrastrar para cambiar de lugar"): en Edición
  // manual, mover a un efectivo asignado de un sector/turno a otro (dentro
  // del mismo día, que es lo que ya muestra esta pantalla) arrastrando su
  // tarjeta, en vez de tener que sacarlo (✕) y volver a asignarlo (+
  // Asignar) a mano — mismos dos pasos de siempre, ahora en uno.
  // arrastrandoRef = la guardia (turno) que se está arrastrando; dropHover =
  // 'sector-turno' de la casilla que está debajo del mouse en este momento
  // (solo para la marca visual de "acá se puede soltar").
  //
  // arrastrandoRef es un REF, no un useState, a propósito: dragstart y el
  // primer dragover pueden pasar en milisegundos, antes de que React
  // termine de re-renderizar después de un setState — así que un handler
  // de dragover armado con la closure VIEJA (de antes del dragstart)
  // todavía leería arrastrando=null y nunca llamaría a preventDefault(),
  // lo que el navegador muestra como "no se puede soltar acá" aunque todo
  // el resto esté bien. Un ref se actualiza al toque, sin esperar al
  // re-render, así que el dragover lo ve correcto siempre.
  const arrastrandoRef = useRef(null)
  const [dropHover, setDropHover] = useState(null)
  // Pedido de esta ronda ("que me seleccione por cuál efectivo estoy por
  // cambiar, porque se mezcla con ambos efectivos de ese turno y no me
  // advierte por qué efectivo"): si la casilla de destino tiene MÁS DE UNO
  // (el caso típico, maxSlot=2), ya no se intercambia a ciegas con el
  // primero de la lista — se abre este modal chiquito para elegir con cuál
  // de los dos (o más) intercambiar. Si la casilla llena tiene un solo
  // ocupante, no hace falta preguntar (no hay ambigüedad posible) y se
  // intercambia directo. { item, opciones, sector, turno } — ver el onDrop
  // de cada casilla, más abajo.
  const [swapPendiente, setSwapPendiente] = useState(null)
  const [modalPersonal, setModalPersonal] = useState(null)
  const [guardandoPersonal, setGuardandoPersonal] = useState(false)
  const [msgPersonal, setMsgPersonal] = useState(null)
  const [efDetalle, setEfectivoDetalle] = useState(null)
  const [filtroDia, setFiltroDia] = useState(1)
  const [config, setConfig] = useState({ totalHoras: 2400, pctUniformados: 60, pctGeneral: 40 })
  const [ventanas, setVentanas] = useState({ dia: '', horaInicio: '08:00', horaFin: '20:00', mesVentana: MES_ACTUAL, anioVentana: ANIO_ACTUAL, mesApertura: MES_ACTUAL, anioApertura: ANIO_ACTUAL })
  const [ventanasGuardadas, setVentanasGuardadas] = useState(false)
  const [configGuardada, setConfigGuardada] = useState(false)
  const [planillaEf, setPlanillaEf] = useState(null)
  const [planillaManual, setPlanillaManual] = useState({})
  // ── Carga administrativa de disponibilidad fuera de término (sin reabrir
  // la inscripción general) y publicación de guardias ──
  const [modalDispAdmin, setModalDispAdmin] = useState(null) // { legajo, nombre } | null
  const [dispAdminCargando, setDispAdminCargando] = useState(false)
  const [dispAdminDiasOriginal, setDispAdminDiasOriginal] = useState({})
  const [dispAdminDias, setDispAdminDias] = useState({})
  const [dispAdminTurnosAsignados, setDispAdminTurnosAsignados] = useState([])
  const [dispAdminMotivo, setDispAdminMotivo] = useState('')
  const [dispAdminGuardando, setDispAdminGuardando] = useState(false)
  const [dispAdminResultado, setDispAdminResultado] = useState(null)
  const [dispAdminPaso, setDispAdminPaso] = useState('editar') // 'editar' | 'confirmar'
  const [turnosPublicadosPorLegajo, setTurnosPublicadosPorLegajo] = useState({})
  const [publicacionVigenteInfo, setPublicacionVigenteInfo] = useState({ publicado: false })
  // Punto 9 de esta ronda ("WhatsApp por destino"): seguimiento persistente
  // en el servidor (pages/api/whatsapp-avisos.js) — reemplaza al Map en
  // localStorage (notificados/marcarNotificado) que era por navegador y no
  // sobrevivía un recargo/relogin en otro dispositivo. Keyed por legajo:
  // { estado: 'pendiente'|'confirmado', abierto_en, confirmado_en, ... }.
  const [whatsappAvisos, setWhatsappAvisos] = useState({})
  const [mostrarModalPublicar, setMostrarModalPublicar] = useState(false)
  const [publicarResumen, setPublicarResumen] = useState(null)
  const [publicarCargando, setPublicarCargando] = useState(false)
  const [publicarResultado, setPublicarResultado] = useState(null)
  const [firmas, setFirmas] = useState({})
  const [firmaEditando, setFirmaEditando] = useState(null) // { legajo, file } o null
  const [cargandoPlanilla, setCargandoPlanilla] = useState(false)
  const [filasCache, setFilasCache] = useState([])
  const [manualDia, setManualDia] = useState(1)
  const [manualHorario, setManualHorario] = useState('')
  const [manualHoras, setManualHoras] = useState('')
  const [descargando, setDescargando] = useState(null)
  // Pedido de esta ronda ("la planilla para imprimir no es fiel a lo que ya
  // se cargó"): esta planilla (pages/api/generar-planilla.js) a propósito
  // lee turnos_publicados, NUNCA el borrador (ver el comentario al
  // principio de ese archivo) — si el administrador cargó/modificó
  // guardias después de la última vez que publicó (o nunca publicó este
  // mes), el .xlsx sale desactualizado o vacío, sin ningún aviso en esta
  // pantalla. Se reutiliza el mismo preview que ya usa "Publicar guardias"
  // (/api/publicar-guardias GET, ver abrirPublicar) para mostrar ese
  // desajuste ACÁ, antes de descargar — nunca se cambia la fuente de datos
  // de la planilla en sí (sigue siendo, a propósito, lo publicado).
  const [previewPlanilla, setPreviewPlanilla] = useState(null)
  const [previewPlanillaCargando, setPreviewPlanillaCargando] = useState(false)
  const [dispDelDia, setDispDelDia] = useState({ dia: null, data: [] })
  const [modalAsignar, setModalAsignar] = useState(null)
  const [efDisponibles, setEfDisponibles] = useState([])
  const [asignando, setAsignando] = useState(false)
  const [rellenandoDia, setRellenandoDia] = useState(null)
  const [rapidaLista, setRapidaLista] = useState([])
  const [rapidaCargando, setRapidaCargando] = useState(false)
  const [rapidaProcesando, setRapidaProcesando] = useState(false)
  const [rapidaMsg, setRapidaMsg] = useState(null)
  const [rapidaNuevos, setRapidaNuevos] = useState([])
  // Pedido de esta ronda ("para ahorrar pasos"): quienes cargaron
  // disponibilidad este mes pero no tienen número de referencia del mes
  // anterior (tarjetas de "Sin guardias el mes anterior") antes había que
  // asignarlos a mano yendo al modal general de "Asignar guardias" y
  // buscándolos ahí — ahora cada tarjeta tiene su propio campo de
  // cantidad + tipo de turno, así se asignan sin salir de la lista.
  // { [legajo]: { cantidad, tipoTurno } } — un estado por legajo para no
  // pisarse entre tarjetas distintas.
  const [camposRapidaNuevos, setCamposRapidaNuevos] = useState({})
  const [rapida24hs, setRapida24hs] = useState(new Set())
  // Punto 1 de esta ronda ("Identificación por sexo"): filtro de la
  // pantalla de Personal — 'todos' no filtra nada (comportamiento anterior).
  const [filtroSexo, setFiltroSexo] = useState('todos')
  const [especiales, setEspeciales] = useState([])
  const [especialesModal, setEspecialesModal] = useState(true)
  const [nuevoEspecialTipo, setNuevoEspecialTipo] = useState('24hs')
  const [nuevoEspecialLeg1, setNuevoEspecialLeg1] = useState('')
  const [nuevoEspecialLeg2, setNuevoEspecialLeg2] = useState('')
  // Pedido de esta ronda ("cantidad fija"): un efectivo al que el admin le
  // fija una cantidad de guardias que Asignación rápida respeta tal cual
  // (nunca le suma ni le resta) y cubre CON PRIORIDAD, antes que el resto.
  // Reutiliza la MISMA tabla/endpoint que ya usa "Configurar objetivo" en
  // la ficha de cada efectivo (efectivo_objetivo vía /api/admin-reglas-
  // objetivo) — esto es solo una forma más rápida de cargarlo desde acá,
  // sin tener que ir a buscar al efectivo uno por uno.
  const [objetivosFijos, setObjetivosFijos] = useState([])
  const [nuevoObjetivoFijoLeg, setNuevoObjetivoFijoLeg] = useState('')
  const [nuevoObjetivoFijoCantidad, setNuevoObjetivoFijoCantidad] = useState(0)
  // Buscador para no tener que revisar un <select> con los 80+ efectivos:
  // escribiendo acá se achica la lista de opciones de abajo.
  const [filtroObjetivoFijo, setFiltroObjetivoFijo] = useState('')
  // Pedido de esta ronda ("elegir el lugar"): algunos efectivos con
  // cantidad fija SOLO hacen guardias en un sector puntual — se agrega acá
  // un sector OPCIONAL que, si se elige, reutiliza "Puestos específicos"
  // (efectivo_puesto_fijo vía /api/admin-reglas-puesto, Punto 2 de una
  // ronda anterior — Fase 0 de lib/asignacionRapidaFlujo.js ya lo respeta
  // en exclusiva) para que esas guardias se cubran SOLO en ese sector. Sin
  // sector elegido (default, "Todos los sectores") el comportamiento es
  // exactamente el de antes. puestosFijoPorLegajoFijo guarda, por legajo,
  // el puesto fijo activo — para poder mostrarlo en la lista y para que
  // "Quitar" borre los dos (objetivo + puesto fijo) juntos, ya que desde
  // este panel se piensan como una sola condición.
  const [nuevoObjetivoFijoSector, setNuevoObjetivoFijoSector] = useState('')
  const [puestosFijoPorLegajoFijo, setPuestosFijoPorLegajoFijo] = useState({})
  const [buscarLegajoInput, setBuscarLegajoInput] = useState('')
  const [buscarLegajoResultado, setBuscarLegajoResultado] = useState(null)
  const [buscarLegajoCargando, setBuscarLegajoCargando] = useState(false)
  const [buscarLegajoError, setBuscarLegajoError] = useState(null)
  const [mounted, setMounted] = useState(false)
  const [lugarDetectado, setLugarDetectado] = useState(APP_LUGAR)
  const [loginAdmin, setLoginAdmin] = useState(null) // null=verificando, false=logueado, {legajo,pass,error,loading}=mostrando form
  const adminLoggedIn = useRef(false)

  useEffect(() => {
    const lugar = _detectLugar()
    setLugarDetectado(lugar)
    setMounted(true)
    const u = localStorage.getItem('polad_user')
    if (!u) { setLoginAdmin({ legajo: '', pass: '', error: '', loading: false }); return }
    const parsed = JSON.parse(u)
    if (!parsed.es_admin) { setLoginAdmin({ legajo: '', pass: '', error: '', loading: false }); return }
    adminLoggedIn.current = true
    setLoginAdmin(false)
    // Punto 9 de esta ronda: el seguimiento de avisos de WhatsApp ya NO se
    // lee de localStorage acá — ver whatsappAvisos / cargarWhatsappAvisos
    // (persistente en el servidor, se carga cuando se entra a la pestaña
    // Personal).
    const v = localStorage.getItem(`polad_ventanas_${lugar}`)
    if (v) try { setVentanas(JSON.parse(v)) } catch(e) {}
    // Candadito de mes (ver comentario junto a mesBloqueado más arriba): si
    // había un mes/año guardado con el candado puesto, se restaura ACÁ,
    // antes de cargar nada, en vez de dejar el mes/año de hoy por default.
    const mb = localStorage.getItem(`polad_mes_bloqueado_${lugar}`)
    if (mb) {
      try {
        const { mes, anio } = JSON.parse(mb)
        if (mes >= 1 && mes <= 12 && anio >= 2000) {
          setMesSeleccionado(mes); setAnioSeleccionado(anio); setMesBloqueado(true)
        }
      } catch(e) {}
    }
    const now = new Date()
    // La configuración de ventana ahora se lee por un endpoint propio
    // (requiere sesión), no directo a Supabase con la clave anon — ver
    // pages/api/configuracion.js.
    fetch('/api/configuracion?lugar=' + encodeURIComponent(lugar)).then(r => r.json()).then(({ cfg }) => {
      if (cfg) {
        const v2 = { dia: cfg.dia?.toString()||'', horaInicio: cfg.hora_inicio||'08:00', horaFin: cfg.hora_fin||'20:00', mesVentana: cfg.mes||now.getMonth()+1, anioVentana: cfg.anio||now.getFullYear(), mesApertura: cfg.mes_apertura||now.getMonth()+1, anioApertura: cfg.anio_apertura||now.getFullYear() }
        setVentanas(v2)
        localStorage.setItem(`polad_ventanas_${lugar}`, JSON.stringify(v2))
      }
    }).catch(() => {})
    setTimeout(() => cargarTodo(lugar), 0)
  }, [])

  // Candadito de mes: al activarlo guarda el mes/año actual (el que se
  // estaba viendo en ese momento) en localStorage y deshabilita los
  // selectores; al desactivarlo solo borra lo guardado (el mes/año con el
  // que se estaba se mantiene hasta que se cambie a mano).
  function toggleBloqueoMes() {
    if (mesBloqueado) {
      localStorage.removeItem(`polad_mes_bloqueado_${lugarDetectado}`)
      setMesBloqueado(false)
    } else {
      localStorage.setItem(`polad_mes_bloqueado_${lugarDetectado}`, JSON.stringify({ mes: mesSeleccionado, anio: anioSeleccionado }))
      setMesBloqueado(true)
    }
  }

  useEffect(() => { if (mounted && adminLoggedIn.current) cargarTodo(lugarDetectado) }, [mesSeleccionado, anioSeleccionado, mounted, lugarDetectado])
  useEffect(() => {
    if (mounted && vista === 'rapida') { cargarTodo(lugarDetectado).then(() => { cargarRapida(); cargarEspeciales(); cargarObjetivosFijos() }) }
  }, [vista, mesSeleccionado, anioSeleccionado, mounted])
  // Refresca la grilla de Disponibilidad cada vez que se entra a esa pestaña, para que no
  // quede desactualizada si alguien cargó disponibilidad después de la carga inicial de la página.
  useEffect(() => { if (mounted && adminLoggedIn.current && vista === 'disponibilidad') cargarTodo(lugarDetectado) }, [vista])
  // Aviso de desajuste borrador/publicado en la pestaña "Planilla Guardia"
  // (ver comentario junto a previewPlanilla más arriba) — se recalcula cada
  // vez que se entra a esa pestaña o cambia el mes/año, igual que ya hace
  // la pestaña Disponibilidad arriba.
  useEffect(() => {
    if (!mounted || !adminLoggedIn.current || vista !== 'descarga') return
    let cancelado = false
    setPreviewPlanillaCargando(true)
    fetch(`/api/publicar-guardias?lugar=${lugarDetectado}&mes=${MES}&anio=${ANIO}`)
      .then(r => r.json())
      .then(body => { if (!cancelado) setPreviewPlanilla(body) })
      .catch(() => { if (!cancelado) setPreviewPlanilla({ error: 'Error de conexión.' }) })
      .finally(() => { if (!cancelado) setPreviewPlanillaCargando(false) })
    return () => { cancelado = true }
  }, [vista, mesSeleccionado, anioSeleccionado, mounted])
  // Guardias PUBLICADAS (no el borrador) — se usan para armar el mensaje de
  // WhatsApp en la pestaña Personal, para no mandar nunca el borrador.
  useEffect(() => {
    if (!mounted || !adminLoggedIn.current || vista !== 'personal') return
    fetch(`/api/guardias-publicadas?lugar=${lugarDetectado}&mes=${MES}&anio=${ANIO}`)
      .then(r => r.json())
      .then(body => {
        setTurnosPublicadosPorLegajo(body.turnos_por_legajo || {})
        setPublicacionVigenteInfo({ publicado: !!body.publicado, version: body.version, publicado_en: body.publicado_en })
      })
      .catch(() => { setTurnosPublicadosPorLegajo({}); setPublicacionVigenteInfo({ publicado: false }) })
  }, [vista, lugarDetectado, MES, ANIO, mounted])

  // Punto 9 de esta ronda: estado de aviso de WhatsApp, persistente en el
  // servidor — independiente por lugar/mes/año (lugarDetectado/MES/ANIO en
  // las dependencias), nunca leído de localStorage como fuente de verdad.
  async function cargarWhatsappAvisos() {
    try {
      const { avisos } = await fetch(`/api/whatsapp-avisos?mes=${MES}&anio=${ANIO}`).then(r => r.json())
      setWhatsappAvisos(avisos || {})
    } catch (e) { setWhatsappAvisos({}) }
  }
  useEffect(() => {
    if (!mounted || !adminLoggedIn.current || vista !== 'personal') return
    cargarWhatsappAvisos()
  }, [vista, lugarDetectado, MES, ANIO, mounted])

  async function abrirAviso(legajo, fingerprintCliente) {
    // "Abrir no es enviar": solo registra que se hizo click en el link de
    // wa.me — nunca cambia a 'confirmado' por sí solo.
    //
    // Corrección de esta ronda: antes esto se quedaba con el estado
    // optimista local y nunca volvía a leer el servidor — si la escritura
    // fallaba (red, sesión vencida), la pantalla seguía mostrando "abierto"
    // aunque el servidor nunca haya guardado la foto del fingerprint
    // (fingerprint_en_apertura) que fn_whatsapp_confirmar_envio exige para
    // poder confirmar después. Ahora se informa el error si lo hay, y
    // SIEMPRE se refresca desde el servidor al terminar, para que la
    // pantalla refleje el estado real (incluido si "confirmar" va a
    // aceptarse o no).
    //
    // Corrección de esta ronda ("Confirmación de WhatsApp"): se manda
    // `fingerprintCliente` — el fingerprint del contenido que ESTA
    // pantalla efectivamente preparó (calculado con fingerprintTurnos
    // sobre turnosPublicadosPorLegajo, justo donde se armó el link de
    // wa.me más abajo). El servidor lo compara contra el fingerprint
    // vigente (fn_whatsapp_marcar_abierto, migración 0006) y RECHAZA la
    // apertura si no coincide — la pantalla está desactualizada, hay que
    // recargarla antes de reintentar; nunca se registra el contenido
    // nuevo como comunicado mediante un mensaje viejo.
    setWhatsappAvisos(prev => ({ ...prev, [legajo]: { ...(prev[legajo]||{}), abierto_en: new Date().toISOString(), abierto_por_legajo: 'yo' } }))
    // Corrección de esta ronda ("enlace de WhatsApp espera la validación"):
    // esta función ahora devuelve si la apertura se validó/registró con
    // éxito (true) o no (false) — el único uso de ese valor es el link de
    // WhatsApp más abajo, que ya NO navega a wa.me si la validación falla.
    let exito = true
    try {
      const r = await fetch('/api/whatsapp-avisos', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'abrir', legajo, mes: MES, anio: ANIO, fingerprint_cliente: fingerprintCliente }),
      }).then(r => r.json())
      if (r.error) {
        exito = false
        alert((r.contenido_desactualizado
          ? '⚠ ' + r.error
          : 'No se pudo registrar la apertura del mensaje: ' + r.error))
      }
    } catch (e) {
      exito = false
      alert('No se pudo registrar la apertura del mensaje (error de red). Si confirmás el envío, puede rechazarse por no tener guardado que se abrió con el contenido actual.')
    } finally {
      await cargarWhatsappAvisos()
    }
    return exito
  }
  async function confirmarAviso(legajo, fingerprintCliente) {
    // Corrección de esta ronda ("Confirmación de WhatsApp"): se manda el
    // mismo `fingerprintCliente` que al abrir — el servidor exige que
    // coincida con el fingerprint vigente, además de con lo que se abrió
    // (fn_whatsapp_confirmar_envio, migración 0006), y hace las dos
    // validaciones bajo el lock de la fila para quedar coordinado con una
    // publicación simultánea.
    const r = await fetch('/api/whatsapp-avisos', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'confirmar', legajo, mes: MES, anio: ANIO, fingerprint_cliente: fingerprintCliente }),
    }).then(r => r.json())
    // Corrección de esta ronda: antes, si el servidor rechazaba la
    // confirmación (p.ej. porque el cronograma cambió desde que se abrió
    // el mensaje — ver fn_whatsapp_confirmar_envio), la pantalla se quedaba
    // SIN refrescar y seguía mostrando el estado optimista/viejo. Ahora
    // también se refresca desde el servidor cuando hay error, para que el
    // administrador vea de inmediato que tiene que volver a abrir el
    // mensaje con el contenido vigente antes de poder confirmar.
    if (r.error) { alert('No se pudo confirmar el envío: ' + r.error); await cargarWhatsappAvisos(); return }
    await cargarWhatsappAvisos()
  }
  async function desmarcarAviso(legajo) {
    const r = await fetch('/api/whatsapp-avisos', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'desmarcar', legajo, mes: MES, anio: ANIO }),
    }).then(r => r.json())
    if (r.error) { alert('No se pudo desmarcar: ' + r.error); return }
    await cargarWhatsappAvisos()
  }

  useEffect(() => {
    if (!mounted) return
    async function cargarDispDia() {
      const { data } = await fetch(`/api/admin-disponibilidad?mes=${MES}&anio=${ANIO}&dia=${filtroDia}&lugar=${lugarDetectado}`).then(r => r.json())
      setDispDelDia({ dia: filtroDia, data: data || [] })
    }
    cargarDispDia()
  }, [filtroDia, mesSeleccionado, anioSeleccionado, mounted])

  async function cargarTodo(lugar) {
    const L = lugar || lugarDetectado || APP_LUGAR
    const sectores = SECTORES_POR_LUGAR[L] || SECTORES_POR_LUGAR['HIGA']
    setLoading(true)
    try {
      const [efsRes, dispRes, turnsRes] = await Promise.all([
        fetch('/api/admin-efectivos').then(r => r.json()),
        fetch(`/api/admin-disponibilidad?mes=${MES}&anio=${ANIO}&lugar=${L}`).then(r => r.json()),
        fetch(`/api/admin-turnos?mes=${MES}&anio=${ANIO}`).then(r => r.json())
      ])
      const efs = efsRes.efectivos
      const disp = dispRes.data
      const turns = turnsRes.turnos
      setEfectivos(efs || [])
      const dispMap = {}
      ;(disp || []).forEach(d => {
        const k = normLegajo(d.legajo)
        if (!dispMap[k]) dispMap[k] = {}
        dispMap[k][d.dia] = { turno: d.turno }
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
    } catch(e) {
      console.error('[POLAD] Error al cargar datos:', e)
    } finally {
      setLoading(false)
    }
  }

  async function generarTurnos() {
    const L0 = lugarDetectado
    if (hayTurnos) {
      if (!confirm(`Ya hay ${todosLosTurnos.length} guardia(s) cargadas en ${L0} para ${NOMBRE_MES}.\n\nEsto las va a BORRAR TODAS y las va a generar de nuevo desde cero, respetando las cantidades, parejas y 24hs configurados (igual que "Asignación rápida"). Esta acción no se puede deshacer.\n\n¿Confirmás que querés regenerar?`)) return
    }
    // Capturados ANTES de la llamada asincrónica: reflejan el estado real
    // del borrador en el momento en que se decidió regenerar, no lo que
    // haya quedado en el estado del componente mientras la lectura de
    // disponibilidad está en vuelo.
    const habiaBorrador = hayTurnos
    const cantidadBorradorAnterior = todosLosTurnos.length

    setGenerando(true); setMsgGen(null)
    const L = lugarDetectado
    const sectores = SECTORES_POR_LUGAR[L] || SECTORES_POR_LUGAR['HIGA']
    const esMod = L === 'MODULAR'
    const turnosLugar = esMod ? ['m','t','n'] : ['d','n']
    const horasTurno = esMod ? 8 : 12

    // Pedido de esta ronda ("en asignación rápida respeta las cantidades
    // configuradas... pero si regenero las guardias en Guardias me carga
    // cualquiera"): "Generar/Regenerar turnos" tenía su PROPIO algoritmo,
    // separado del de "Asignación rápida" — un simple relleno hasta el cupo
    // de cada sector/turno (maxSlot), sin mirar para nada la cantidad
    // configurada por efectivo (admin-reglas-objetivo), los puestos fijos,
    // los 24hs ni las parejas de "Casos especiales". Por eso respetaba todo
    // eso en Asignación rápida pero no al regenerar. Ahora usa el MISMO
    // motor (calcularAsignacionRapida, lib/asignacionRapidaFlujo.js) que ya
    // usa "Asignación rápida ⇒ Asignar todos" — se arma la misma lista de
    // objetivos por efectivo (configurado, o derivado del mes anterior) y
    // se corren las mismas fases (puesto fijo, 24hs, parejas, general, fin
    // de semana) antes de borrar y guardar. Se leen ANTES de calcular nada;
    // si alguna falla, se aborta sin tocar el borrador anterior.
    const prevGen = mesAnteriorDe(MES, ANIO)
    const legajosLugar = efectivos.map(e => e.legajo)
    const [turnosPrevRes, reglasPuestoRes, reglasObjetivoRes, turnosOtrosRes] = await Promise.all([
      fetch(`/api/admin-turnos?mes=${prevGen.mes}&anio=${prevGen.anio}`).then(r => r.json()).catch(e => ({ error: e.message })),
      fetch('/api/admin-reglas-puesto').then(r => r.json()).catch(e => ({ error: e.message })),
      fetch('/api/admin-reglas-objetivo').then(r => r.json()).catch(e => ({ error: e.message })),
      legajosLugar.length
        ? fetch(`/api/admin-turnos?mes=${MES}&anio=${ANIO}&scope=todas&legajo=${encodeURIComponent(legajosLugar.join(','))}`).then(r => r.json()).catch(e => ({ error: e.message }))
        : Promise.resolve({ turnos: [] }),
    ])
    if (turnosPrevRes.error || !Array.isArray(turnosPrevRes.turnos)) {
      setGenerando(false); alert(`❌ No se pudieron leer las guardias de ${MESES_NOMBRES[prevGen.mes - 1]} ${prevGen.anio} (hacen falta para calcular la cantidad objetivo de cada efectivo): ${turnosPrevRes.error || 'formato inesperado'}\n\nNo se modificó nada — probá de nuevo.`); return
    }
    if (reglasPuestoRes.error || !Array.isArray(reglasPuestoRes.reglas)) {
      setGenerando(false); alert(`❌ No se pudieron leer los puestos fijos configurados: ${reglasPuestoRes.error || 'formato inesperado'}\n\nNo se modificó nada — probá de nuevo.`); return
    }
    if (reglasObjetivoRes.error || !Array.isArray(reglasObjetivoRes.objetivos)) {
      setGenerando(false); alert(`❌ No se pudieron leer las cantidades configuradas por efectivo: ${reglasObjetivoRes.error || 'formato inesperado'}\n\nNo se modificó nada — probá de nuevo.`); return
    }
    if (turnosOtrosRes.error || !Array.isArray(turnosOtrosRes.turnos)) {
      setGenerando(false); alert(`❌ No se pudieron leer las guardias de los otros destinos (hacen falta para el cruce de horario): ${turnosOtrosRes.error || 'formato inesperado'}\n\nNo se modificó nada — probá de nuevo.`); return
    }

    const countPrevGen = {}
    turnosPrevRes.turnos.forEach(t => { countPrevGen[t.legajo] = (countPrevGen[t.legajo] || 0) + 1 })
    const objetivoCfgPorLegajoGen = {}
    reglasObjetivoRes.objetivos.forEach(o => { objetivoCfgPorLegajoGen[normLegajo(o.legajo)] = o })
    function objetivoDeEfectivoGen(legajo) {
      return resolverObjetivoGuardias({
        objetivoConfigurado: objetivoCfgPorLegajoGen[normLegajo(legajo)],
        objetivoDerivado: countPrevGen[legajo] || 0,
        horasTurno,
      })
    }
    const legajos24hsGen = new Set(especiales.filter(e => e.tipo === '24hs').map(e => e.legajo))
    const infoEfectivosGen = {}
    efectivos.forEach(e => { infoEfectivosGen[normLegajo(e.legajo)] = { tipo: e.tipo, sexo: e.sexo } })

    // Punto 1 de esta ronda de revisión ("Detener la regeneración si falla
    // la lectura de disponibilidad"): la orquestación completa (leer
    // disponibilidad FRESCA con manejo real de errores HTTP/red/JSON/
    // estructura, correr el algoritmo solo si la lectura fue válida, y
    // recién guardar si corresponde) vive en lib/generarTurnosFlujo.js —
    // ver ese archivo para el detalle completo y
    // tests/node/02_generar_turnos_flujo.js para la prueba real de este
    // flujo (mockeando fetch, sin SQL) que confirma que una lectura
    // fallida NUNCA llega a llamar a reemplazar_scope. Esta ronda no toca
    // esa orquestación — solo cambia QUÉ algoritmo corre adentro de
    // `calcularAsignaciones` (ver más arriba).
    let resultadoCalculoGen = null
    const resultado = await ejecutarGeneracionDeTurnos({
      fetchFn: fetch,
      mes: MES,
      anio: ANIO,
      lugar: L,
      habiaBorrador,
      cantidadBorradorAnterior,
      calcularAsignaciones: (dispFresh) => {
        // Mismo criterio que cargarRapida(): solo entran los efectivos que
        // cargaron disponibilidad este mes y cuyo objetivo (configurado, o
        // derivado del mes anterior) es mayor a 0.
        const cargaronGen = new Set(
          dispFresh.map(d => normLegajo(d.legajo))
        )
        const targetsGen = efectivos
          .filter(e => cargaronGen.has(normLegajo(e.legajo)) && objetivoDeEfectivoGen(e.legajo) > 0)
          .map(e => ({ legajo: e.legajo, objetivo: objetivoDeEfectivoGen(e.legajo) }))

        resultadoCalculoGen = calcularAsignacionRapida({
          targets: targetsGen,
          legajos24hs: legajos24hsGen,
          lugar: L,
          mes: MES,
          anio: ANIO,
          sectores,
          turnosLugar,
          horasTurno,
          maxHs: 180,
          dispAll: dispFresh,
          turnosMes: [], // "Regenerar" parte de cero: el scope anterior se borra antes de guardar
          reglasPuesto: reglasPuestoRes.reglas,
          reglasObjetivo: reglasObjetivoRes.objetivos,
          turnosOtrosLugares: turnosOtrosRes.turnos,
          especiales,
          maxSlot,
          normLegajo,
          infoEfectivos: infoEfectivosGen,
        })
        return resultadoCalculoGen.nuevos
      },
      // Punto 2 de la ronda anterior, sin cambios: fn_turnos_borrador_
      // reemplazar_scope borra el scope anterior e inserta el lote nuevo
      // en UNA sola transacción, bajo el mismo lock que la publicación —
      // si falla, el borrador anterior queda intacto, nunca a medias.
      reemplazarScope: (nuevos) => fetch('/api/admin-turnos', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reemplazar_scope', mes: MES, anio: ANIO, sectores, turnos: nuevos }),
      }).then(r => r.json()),
    })

    setGenerando(false)

    if (!resultado.ok) {
      setMsgGen(null)
      if (resultado.vacioConBorradorPrevio) {
        // Punto 1 de esta ronda: un resultado válido (disponibilidad leída
        // sin error) que da 0 asignaciones, con un borrador previo ya
        // cargado, NO se guarda automáticamente — se muestra la situación
        // y se deja el borrador anterior intacto. Si el administrador de
        // verdad quiere vaciarlo, existe la opción explícita de borrar
        // guardias (más abajo en esta misma pantalla), separada de
        // "Generar turnos".
        alert(
          '⚠ ' + resultado.motivo + '.\n\n' +
          'Para no vaciar el borrador automáticamente ante un resultado así, no se modificó nada: el borrador anterior se conserva completo.\n\n' +
          'Revisá la disponibilidad cargada para este mes/lugar antes de reintentar. Si de verdad querés vaciar el borrador, usá la opción de borrar guardias explícitamente.'
        )
      } else {
        alert('❌ Error generando guardias: ' + resultado.motivo + '\n\nNo se modificó nada: el borrador anterior (si había) se conserva completo.')
      }
      return
    }

    // Mismo resumen que ya muestra "Asignación rápida ⇒ Asignar todos":
    // cuántas quedaron pendientes contra su cantidad objetivo, conflictos
    // de cruce de horario, puestos fijos que no se completaron del todo, e
    // incompatibilidades de configuración detectadas — nunca en silencio.
    const reporteGen = resultadoCalculoGen?.reporte || []
    const conflictosGen = resultadoCalculoGen?.conflictos || []
    const puestoFijoReporteGen = resultadoCalculoGen?.puestoFijoReporte || []
    const incompatibilidadesGen = resultadoCalculoGen?.incompatibilidades || []
    const incompletosGen = reporteGen.filter(r => r.pendiente > 0)
    let mGen = `Se generaron ${resultado.nuevos.length} asignaciones.`
    if (incompletosGen.length) {
      mGen += `\n\n⚠ ${incompletosGen.length} efectivo(s) no llegaron a su cantidad configurada:\n` +
        incompletosGen.slice(0, 12).map(r => `   • ${nombreCorto(r.legajo)}: ${r.total} de ${r.objetivo} (pendiente ${r.pendiente})`).join('\n')
      if (incompletosGen.length > 12) mGen += `\n   …y ${incompletosGen.length - 12} más.`
    }
    if (conflictosGen.length) {
      mGen += `\n\n⚠ ${conflictosGen.length} guardia(s) no se asignaron por cruce de horario con otro lugar.`
    }
    mGen += mensajePuestoFijo(puestoFijoReporteGen)
    mGen += mensajeIncompatibilidades(incompatibilidadesGen)
    setMsgGen(mGen)
    await cargarTodo(L)
  }

  async function asignarGuardiasAuto(legajo, cantidad, tipoTurno) {
    setAsignando(true)
    cantidad = parseInt(cantidad) || 0
    if (cantidad <= 0) { alert('Ingresá una cantidad válida.'); setAsignando(false); return }

    const ES_MOD = lugarDetectado === 'MODULAR'
    const horasTurno = ES_MOD ? 8 : 12
    const MAX_HS = 180

    // Pedido de esta ronda ("¿el de asignación por día tiene esa
    // cualidad también?"): este modal calculaba el tope de 180hs y la
    // disponibilidad SOLO con datos de este lugar — nunca se enteraba de
    // guardias que el efectivo ya tenía en los otros dos destinos. Ahora
    // lee también esas guardias (scope=todas) ANTES de decidir el tope y
    // de elegir día/turno, con el mismo criterio que ya usa
    // lib/asignacionRapidaFlujo.js: las horas se suman entre los tres
    // lugares para el tope de 180hs, y un día/turno que se superpone en
    // horario real con una guardia de otro lugar queda descartado (nunca
    // se fuerza), igual que el cruce que ya hace "Asignación rápida" y
    // "Regenerar turnos".
    const [dispDataRes, turnosEfRes, turnosTodosRes, reglaPuestoRes, reglasObjetivoRes, turnosOtrosRes] = await Promise.all([
      fetch(`/api/admin-disponibilidad?mes=${MES}&anio=${ANIO}&lugar=${lugarDetectado}&legajo=${encodeURIComponent(legajo)}`).then(r => r.json()),
      fetch(`/api/admin-turnos?mes=${MES}&anio=${ANIO}&legajo=${encodeURIComponent(legajo)}`).then(r => r.json()),
      fetch(`/api/admin-turnos?mes=${MES}&anio=${ANIO}`).then(r => r.json()),
      fetch(`/api/admin-reglas-puesto?legajo=${encodeURIComponent(legajo)}`).then(r => r.json()).catch(() => ({ reglas: [] })),
      fetch('/api/admin-reglas-objetivo').then(r => r.json()),
      fetch(`/api/admin-turnos?mes=${MES}&anio=${ANIO}&scope=todas&legajo=${encodeURIComponent(legajo)}`).then(r => r.json()).catch(e => ({ error: e.message })),
    ])
    const dispData = dispDataRes.data
    const turnosEfData = turnosEfRes.turnos
    const turnosTodos = turnosTodosRes.turnos

    if (turnosOtrosRes.error || !Array.isArray(turnosOtrosRes.turnos)) {
      alert(`❌ No se pudieron leer las guardias de los otros destinos (hacen falta para el tope de 180hs combinado y el cruce de horario): ${turnosOtrosRes.error || 'formato inesperado'}\n\nNo se intentó asignar nada — probá de nuevo.`)
      setAsignando(false)
      return
    }
    // Mismo criterio que lib/asignacionRapidaFlujo.js: de todo lo que trae
    // scope=todas (que incluye TAMBIÉN este lugar), solo cuenta como "de
    // otro lugar" lo que cae en sectores que no son de `lugarDetectado`.
    const sectoresPropiosAG = SECTORES_POR_LUGAR[lugarDetectado] || SECTORES_POR_LUGAR['HIGA']
    const turnosOtrosDetalleAG = (turnosOtrosRes.turnos || []).filter(t => !sectoresPropiosAG.includes(t.sector))
    function lugarDeSectorAG(sector) {
      if (SECTORES_POR_LUGAR['MODULAR'].includes(sector)) return 'MODULAR'
      if (SECTORES_POR_LUGAR['UPA'].includes(sector)) return 'UPA'
      return 'HIGA'
    }
    const hsOtrosLugaresAG = turnosOtrosDetalleAG.reduce((acc, t) => acc + (lugarDeSectorAG(t.sector) === 'MODULAR' ? 8 : 12), 0)

    const hsActuales = (horasAsig[legajo] || 0) + hsOtrosLugaresAG
    const hsDisponibles = MAX_HS - hsActuales
    const maxGuardiasPorTope = Math.floor(hsDisponibles / horasTurno)

    if (maxGuardiasPorTope <= 0) {
      alert(`⛔ ${nombreCorto(legajo)} ya alcanzó el tope de ${MAX_HS}hs${hsOtrosLugaresAG > 0 ? ' entre los tres lugares' : ''}.`)
      setAsignando(false)
      return
    }
    if (cantidad > maxGuardiasPorTope) {
      cantidad = maxGuardiasPorTope
      alert(`⚠ Se ajustó la cantidad a ${cantidad} guardias para no superar el tope de ${MAX_HS}hs${hsOtrosLugaresAG > 0 ? ' combinado entre los tres lugares' : ''}.\n(Tiene ${hsActuales}hs asignadas, le quedan ${hsDisponibles}hs disponibles)`)
    }

    // Falla reportada en UPA ("le puse tres y terminó con cuatro"): la
    // cantidad configurada por administración (efectivo_objetivo) se
    // respeta SIEMPRE, también desde este modal — mismo criterio que el
    // ajuste por tope de 180hs de arriba: se recorta lo pedido y se avisa.
    // Si no se pudo leer, se corta en vez de asignar sin saber el límite.
    if (reglasObjetivoRes.error) {
      alert(`❌ No se pudieron leer las cantidades configuradas por efectivo: ${reglasObjetivoRes.error}\n\nNo se intentó asignar nada — probá de nuevo.`)
      setAsignando(false)
      return
    }
    const topeCfg = topeCantidadPedida({
      pedida: cantidad,
      objetivoConfigurado: (reglasObjetivoRes.objetivos || []).find(o => normLegajo(o.legajo) === normLegajo(legajo)),
      yaTiene: (turnosEfData || []).length,
      tipoTurno, turnosLugar: TURNOS_LUGAR, horasTurno,
    })
    if (topeCfg.tope !== null && topeCfg.cantidad <= 0) {
      alert(`⛔ ${nombreCorto(legajo)} ya tiene ${topeCfg.yaTiene} guardia(s) este mes y su cantidad configurada es ${topeCfg.tope}. No se asigna ninguna más.`)
      setAsignando(false)
      return
    }
    if (topeCfg.ajustada) {
      cantidad = topeCfg.cantidad
      alert(`⚠ Se ajustó la cantidad a ${cantidad}${tipoTurno === 'doble' ? ' día(s) de 24hs' : ' guardia(s)'} para no superar su cantidad configurada de ${topeCfg.tope} (ya tiene ${topeCfg.yaTiene} este mes).`)
    }

    // Falla reportada por el administrador ("sigue sin respetar el efectivo
    // seleccionado para que solo haga guardias en un sitio designado"):
    // esta función (usada por el modal "Asignar guardias rápido" Y por las
    // tarjetas de "Sin guardias el mes anterior") no tenía NINGÚN chequeo de
    // puesto fijo — solo lo tenía el motor de lib/asignacionRapidaFlujo.js.
    // Mismo criterio que ese motor: si hay puesto fijo, el sector queda
    // SIEMPRE confinado a `fijo.sector` (nunca round-robin a otro), y si
    // además tiene turno fijo, solo se asigna ese turno — si lo pedido es
    // incompatible, se avisa y no se asigna nada (nunca "se acomoda solo"
    // en otro sector/turno).
    const fijo = (reglaPuestoRes.reglas || [])[0] || null
    if (fijo) {
      const nombreFijo = nombreCorto(legajo)
      if (tipoTurno === 'doble' && fijo.turno) {
        alert(`⛔ ${nombreFijo} tiene puesto fijo en "${fijo.sector}" solo para el turno "${fijo.turno}". No se puede asignar "Todos" (24hs) porque cubre ambos turnos del día.\n\nElegí el turno "${fijo.turno}" en el selector.`)
        setAsignando(false)
        return
      }
      if (tipoTurno !== 'doble' && tipoTurno !== 'mixto' && fijo.turno && fijo.turno !== tipoTurno) {
        alert(`⛔ ${nombreFijo} tiene puesto fijo en "${fijo.sector}" solo para el turno "${fijo.turno}". No se puede asignar el turno "${tipoTurno}".`)
        setAsignando(false)
        return
      }
    }

    const ocupacion = {}
    ;(turnosTodos || []).forEach(t => {
      const k = t.dia + '-' + t.turno + '-' + t.sector
      ocupacion[k] = (ocupacion[k] || 0) + 1
    })

    const yaAsignadosPorTurno = {}
    TURNOS_LUGAR.forEach(tk => {
      yaAsignadosPorTurno[tk] = new Set((turnosEfData || []).filter(t => t.turno === tk).map(t => parseInt(t.dia)))
    })

    const dispMap = {}
    ;(dispData || []).forEach(d => { dispMap[parseInt(d.dia)] = d.turno })

    // Cruce de horario con otro lugar — mismo cálculo (rangos reales de
    // cada turno, por lugar) que lib/asignacionRapidaFlujo.js, para que un
    // mismo efectivo nunca termine con dos guardias que se superponen en
    // el reloj solo porque están en destinos distintos.
    const MIN_DIA_AG = 24 * 60
    function rangoTurnoAG(dia, turno, lugarTurno) {
      const base = (dia - 1) * MIN_DIA_AG
      if (lugarTurno === 'MODULAR') {
        if (turno === 'm') return [base + 8 * 60, base + 16 * 60]
        if (turno === 't') return [base + 16 * 60, base + 24 * 60]
        return [base + MIN_DIA_AG, base + MIN_DIA_AG + 8 * 60]
      }
      return turno === 'd' ? [base + 8 * 60, base + 20 * 60] : [base + 20 * 60, base + MIN_DIA_AG + 8 * 60]
    }
    function seSuperponenAG(a, b) { return a[0] < b[1] && b[0] < a[1] }
    const diasConConflictoOtroLugarAG = new Set()
    function hayConflictoOtroLugarAG(dia, turno) {
      const rangoCandidato = rangoTurnoAG(dia, turno, lugarDetectado)
      const conflicto = turnosOtrosDetalleAG.some(o =>
        seSuperponenAG(rangoCandidato, rangoTurnoAG(parseInt(o.dia), o.turno, lugarDeSectorAG(o.sector)))
      )
      if (conflicto) diasConConflictoOtroLugarAG.add(dia + '-' + turno)
      return conflicto
    }

    // Verifica descanso 12hs — solo HIGA/UPA con turnos de 12hs
    function cumpleDescanso(dia, turno, asignadosHastaAhora) {
      if (hayConflictoOtroLugarAG(dia, turno)) return false
      if (ES_MOD) return true
      const ayer = asignadosHastaAhora.find(a => a.dia === dia - 1)
      if (ayer && ayer.turno === 'n' && turno === 'd') return false // sale 08hs, entra 08hs → 0hs descanso
      const manana = asignadosHastaAhora.find(a => a.dia === dia + 1)
      if (manana && turno === 'n' && manana.turno === 'd') return false
      return true
    }

    // Rotación estricta: 1 guardia por sector antes de repetir
    // Cuenta cuántas veces fue asignado cada sector para este efectivo
    const conteoSector = {}
    SECTORES_APP.forEach(s => { conteoSector[s] = 0 })
    function getSector(dia, turno) {
      // Puesto fijo: nunca elegir otro sector que el configurado (y si
      // además tiene turno fijo, solo ese turno) — ver chequeo de
      // incompatibilidad más arriba, que ya descartó los casos imposibles.
      if (fijo) {
        if (fijo.turno && fijo.turno !== turno) return null
        return (ocupacion[dia+'-'+turno+'-'+fijo.sector] || 0) < maxSlot(fijo.sector, turno) ? fijo.sector : null
      }
      // Ordenar sectores por los menos usados primero para distribuir parejo
      const sectoresOrdenados = [...SECTORES_APP].sort((a, b) => conteoSector[a] - conteoSector[b])
      for (const s of sectoresOrdenados) {
        if ((ocupacion[dia+'-'+turno+'-'+s] || 0) < maxSlot(s, turno)) {
          conteoSector[s]++
          return s
        }
      }
      return null
    }

    // Distribuye N guardias espaciadas en el mes a partir de la lista de días disponibles
    // Si un día preferido no cumple descanso o no tiene sector, busca el siguiente disponible
    function asignarEspaciado(diasDisponibles, cantidadPedida, turnoKey) {
      if (diasDisponibles.length === 0) return []
      const resultado = []
      const asignados = [] // para control de descanso

      // Calcular intervalo ideal
      const intervalo = diasDisponibles.length > cantidadPedida
        ? Math.floor(diasDisponibles.length / cantidadPedida)
        : 1

      let idxBase = 0
      let intentos = 0

      while (resultado.length < cantidadPedida && intentos < diasDisponibles.length * 2) {
        intentos++
        // Día preferido según espaciado
        const idxPref = Math.min(idxBase, diasDisponibles.length - 1)
        
        // Buscar desde idxPref hacia adelante un día que cumpla todas las condiciones
        let encontrado = false
        for (let i = idxPref; i < diasDisponibles.length; i++) {
          const { dia, turno: dispTurno } = diasDisponibles[i]
          // Ya asignado este turno este día
          if ((yaAsignadosPorTurno[turnoKey]||new Set()).has(dia)) continue
          // Ya en resultado
          if (resultado.find(r => r.dia === dia && r.turno === turnoKey)) continue
          // Verificar disponibilidad del efectivo para este turno
          if (!dispTurno.includes(turnoKey)) continue
          // Verificar descanso
          if (!cumpleDescanso(dia, turnoKey, asignados)) continue
          // Buscar sector
          const s = getSector(dia, turnoKey)
          if (!s) continue
          // Todo OK — asignar
          resultado.push({ legajo, mes: MES, anio: ANIO, dia, turno: turnoKey, sector: s })
          asignados.push({ dia, turno: turnoKey })
          ocupacion[dia+'-'+turnoKey+'-'+s] = (ocupacion[dia+'-'+turnoKey+'-'+s] || 0) + 1
          ;(yaAsignadosPorTurno[turnoKey] || new Set()).add(dia)
          idxBase = i + 1 + (intervalo - 1) // saltar intervalo para espaciar
          encontrado = true
          break
        }
        if (!encontrado) break // no hay más días disponibles
      }
      return resultado
    }

    const nuevos = []

    if (tipoTurno === 'doble') {
      // Todos los turnos del día — buscar días donde el efectivo tiene TODOS los turnos
      const diasCandidatos = Object.entries(dispMap)
        .filter(([dia, turno]) => TURNOS_LUGAR.every(tk => turno.includes(tk)))
        .map(([dia, turno]) => ({ dia: parseInt(dia), turno }))
        .sort((a, b) => a.dia - b.dia)

      const diasElegidos = []
      let idxD = 0
      const intervaloD = diasCandidatos.length > cantidad ? Math.floor(diasCandidatos.length / cantidad) : 1

      for (let i = idxD; i < diasCandidatos.length && diasElegidos.length < cantidad; i += intervaloD) {
        const { dia, turno: dispTurno } = diasCandidatos[i]
        let todoOk = true
        for (const tk of TURNOS_LUGAR) {
          if (!dispTurno.includes(tk)) { todoOk = false; break }
          if (!cumpleDescanso(dia, tk, nuevos)) { todoOk = false; break }
        }
        if (!todoOk) {
          // Intentar el siguiente
          for (let j = i + 1; j < diasCandidatos.length && diasElegidos.length < cantidad; j++) {
            const { dia: d2, turno: t2 } = diasCandidatos[j]
            let ok2 = TURNOS_LUGAR.every(tk => t2.includes(tk) && cumpleDescanso(d2, tk, nuevos))
            if (ok2) { diasElegidos.push({ dia: d2, turno: t2 }); break }
          }
        } else {
          diasElegidos.push({ dia, turno: dispTurno })
        }
      }

      for (const { dia, turno: dispTurno } of diasElegidos) {
        for (const tk of TURNOS_LUGAR) {
          if (!dispTurno.includes(tk)) continue
          const s = getSector(dia, tk)
          if (s) {
            nuevos.push({ legajo, mes: MES, anio: ANIO, dia, turno: tk, sector: s })
            ocupacion[dia+'-'+tk+'-'+s] = (ocupacion[dia+'-'+tk+'-'+s] || 0) + 1
          }
        }
      }

    } else if (tipoTurno === 'mixto') {
      // Un turno por día, rotando entre los disponibles del efectivo
      const diasCandidatos = Object.entries(dispMap)
        .map(([dia, turno]) => ({ dia: parseInt(dia), turno }))
        .filter(({ dia, turno }) => TURNOS_LUGAR.some(tk => turno.includes(tk) && !(yaAsignadosPorTurno[tk]||new Set()).has(dia)))
        .sort((a, b) => a.dia - b.dia)

      const conteoTurnos = {}
      TURNOS_LUGAR.forEach(tk => { conteoTurnos[tk] = 0 })
      const asignadosMixto = []
      const intervaloM = diasCandidatos.length > cantidad ? Math.floor(diasCandidatos.length / cantidad) : 1
      let idxM = 0

      while (nuevos.length < cantidad && idxM < diasCandidatos.length) {
        const { dia, turno: dispTurno } = diasCandidatos[idxM]
        const turnosOk = TURNOS_LUGAR.filter(tk =>
          dispTurno.includes(tk) &&
          !(yaAsignadosPorTurno[tk]||new Set()).has(dia) &&
          cumpleDescanso(dia, tk, asignadosMixto)
        )
        if (turnosOk.length > 0) {
          const tk = turnosOk.sort((a, b) => conteoTurnos[a] - conteoTurnos[b])[0]
          const s = getSector(dia, tk)
          if (s) {
            nuevos.push({ legajo, mes: MES, anio: ANIO, dia, turno: tk, sector: s })
            asignadosMixto.push({ dia, turno: tk })
            ocupacion[dia+'-'+tk+'-'+s] = (ocupacion[dia+'-'+tk+'-'+s] || 0) + 1
            conteoTurnos[tk]++
            ;(yaAsignadosPorTurno[tk]||new Set()).add(dia)
            idxM += intervaloM
          } else { idxM++ }
        } else { idxM++ }
      }

    } else {
      // Turno específico — espaciado con búsqueda de alternativas
      const diasCandidatos = Object.entries(dispMap)
        .map(([dia, turno]) => ({ dia: parseInt(dia), turno }))
        .filter(({ dia, turno }) => turno.includes(tipoTurno) && !(yaAsignadosPorTurno[tipoTurno]||new Set()).has(dia))
        .sort((a, b) => a.dia - b.dia)

      const resultado = asignarEspaciado(diasCandidatos, cantidad, tipoTurno)
      nuevos.push(...resultado)
    }

    if (nuevos.length === 0) {
      const avisoCruceAG = diasConConflictoOtroLugarAG.size > 0 ? ` (${diasConConflictoOtroLugarAG.size} día(s)/turno(s) descartados por cruce de horario con otro lugar)` : ''
      if (fijo) {
        alert(`✗ No se pudo asignar ninguna guardia a ${nombreCorto(legajo)}. Tiene puesto fijo en "${fijo.sector}"${fijo.turno ? ` (turno "${fijo.turno}")` : ''} y no quedan días con disponibilidad cargada, cupo libre en ese sector, o que respeten el descanso — nunca se lo asigna en otro sector.${avisoCruceAG}`)
      } else {
        alert(`✗ No se pudo asignar ninguna guardia. Verificá disponibilidad y slots disponibles.${avisoCruceAG}`)
      }
      setAsignando(false)
      return
    }

    {
      const { error } = await fetch('/api/admin-turnos', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'insertar', mes: MES, anio: ANIO, turnos: nuevos }),
      }).then(r => r.json())
      if (error) { setAsignando(false); alert('❌ Error guardando: ' + error + '\n\nEs posible que no se hayan guardado todas las guardias.'); return }
    }
    setModalAsignar(null)
    setAsignando(false)
    await cargarTodo(lugarDetectado)

    const nombre = nombreCorto(legajo)
    let msg = `✓ Se asignaron ${nuevos.length} guardias a ${nombre}.`
    if (nuevos.length < cantidad) {
      msg += `\n⚠ Se pedían ${cantidad} pero la disponibilidad permitió ${nuevos.length}.`
    }
    if (diasConConflictoOtroLugarAG.size > 0) {
      msg += `\n⚠ ${diasConConflictoOtroLugarAG.size} día(s)/turno(s) no se usaron por cruce de horario con otro lugar.`
    }
    alert(msg)
  }

  // Completar UN día: rellena los lugares libres con los efectivos disponibles
  // priorizando a los que tienen MENOS guardias en el mes. No carga de más.
  async function rellenarDiaAuto(dia) {
    if (rellenandoDia) return
    setRellenandoDia(dia)
    try {
      const L = lugarDetectado
      const sectores = SECTORES_POR_LUGAR[L] || SECTORES_POR_LUGAR['HIGA']
      const turnosLugar = L === 'MODULAR' ? ['m','t','n'] : ['d','n']
      const horasTurno = L === 'MODULAR' ? 8 : 12

      // Datos frescos: disponibilidad del día + turnos del mes + reglas de
      // puesto fijo (esta última, agregada en esta ronda — ver más abajo) +
      // guardias de ESTE MISMO legajo en los OTROS lugares (scope=todas),
      // para el tope de 180hs combinado y el cruce de horario entre lugares
      // — igual que ya tienen "Regenerar turnos" y "Asignar guardias rápido".
      const legajosLugarRD = efectivos.map(e => e.legajo)
      const [dispDiaRes, turnosMesRes, reglasPuestoRes, reglasObjetivoRes, turnosOtrosRD] = await Promise.all([
        fetch(`/api/admin-disponibilidad?mes=${MES}&anio=${ANIO}&dia=${dia}&lugar=${L}`).then(r => r.json()),
        fetch(`/api/admin-turnos?mes=${MES}&anio=${ANIO}`).then(r => r.json()),
        fetch('/api/admin-reglas-puesto').then(r => r.json()),
        fetch('/api/admin-reglas-objetivo').then(r => r.json()),
        legajosLugarRD.length
          ? fetch(`/api/admin-turnos?mes=${MES}&anio=${ANIO}&scope=todas&legajo=${encodeURIComponent(legajosLugarRD.join(','))}`).then(r => r.json()).catch(e => ({ error: e.message }))
          : Promise.resolve({ turnos: [] }),
      ])
      // Corrección de esta ronda: si cualquiera de las dos lecturas falla
      // (la API devuelve { error }), antes esto seguía de largo tratando
      // el error como si fuera "sin datos" — dispDia/turnosMes quedaban
      // undefined, dispMap quedaba VACÍO, y el cartel final decía "no hay
      // efectivos disponibles" aunque en realidad nunca se pudo ni leer la
      // disponibilidad. Ahora, igual que ya hace la Asignación rápida del
      // mes completo (ver Bug 6 en lib/asignacionRapidaFlujo.js), un error
      // de lectura se informa tal cual y se corta ANTES de calcular nada.
      if (dispDiaRes.error) { alert(`❌ No se pudo leer la disponibilidad del día ${dia}: ${dispDiaRes.error}\n\nNo se intentó asignar nada — probá de nuevo.`); setRellenandoDia(null); return }
      if (turnosMesRes.error) { alert(`❌ No se pudieron leer las guardias ya cargadas del mes: ${turnosMesRes.error}\n\nNo se intentó asignar nada — probá de nuevo.`); setRellenandoDia(null); return }
      // Falla reportada por el administrador ("sigue sin respetar el
      // efectivo seleccionado para que solo haga guardias en un sitio
      // designado"): este botón no tenía NINGÚN chequeo de puesto fijo —
      // podía poner a cualquiera en cualquier sector de los que quedaran
      // libres. Si esta lectura falla, se corta en vez de seguir como si
      // nadie tuviera puesto fijo (que repetiría exactamente ese bug).
      if (reglasPuestoRes.error) { alert(`❌ No se pudieron leer las reglas de puesto fijo: ${reglasPuestoRes.error}\n\nNo se intentó asignar nada — probá de nuevo.`); setRellenandoDia(null); return }
      // Falla reportada en UPA ("le puse tres y terminó con cuatro"): este
      // botón tampoco miraba la cantidad configurada por administración
      // (efectivo_objetivo: "cantidad fija" de Asignación rápida o la ficha
      // del efectivo) — completaba el día con quien tuviera menos horas,
      // aunque ya hubiera llegado a su número. Ahora quien tiene cantidad
      // configurada nunca pasa de ella, igual que en la Asignación rápida
      // (todas sus fases, fin de semana incluido). Si esta lectura falla, se
      // corta en vez de seguir como si nadie tuviera cantidad configurada.
      if (reglasObjetivoRes.error) { alert(`❌ No se pudieron leer las cantidades configuradas por efectivo: ${reglasObjetivoRes.error}\n\nNo se intentó asignar nada — probá de nuevo.`); setRellenandoDia(null); return }
      // Misma lógica que en "Regenerar turnos" y "Asignar guardias rápido":
      // si falla la lectura de guardias en los OTROS lugares, se corta en
      // vez de completar el día como si nadie tuviera guardias en otro
      // lado (lo que podría pasar por arriba el tope de 180hs combinado o
      // meter a alguien en un turno que se cruza de horario con otro lugar).
      if (turnosOtrosRD.error) { alert(`❌ No se pudieron leer las guardias de estos efectivos en los otros lugares: ${turnosOtrosRD.error}\n\nNo se intentó asignar nada — probá de nuevo.`); setRellenandoDia(null); return }
      // El cálculo vive en lib/completarDia.js (probado con datos reales en
      // tests/node/06_completar_dia.js): respeta 180hs (combinado entre los
      // tres lugares), descanso, cruce de horario con otro lugar, puesto
      // fijo y la cantidad configurada de cada efectivo.
      const { nuevos, faltantesPorTurno, motivoPorTurno } = calcularCompletarDia({
        dia, mes: MES, anio: ANIO, lugar: L, sectores, turnosLugar, horasTurno,
        efectivos, dispDia: dispDiaRes.data, turnosMes: turnosMesRes.turnos,
        reglasPuesto: reglasPuestoRes.reglas, reglasObjetivo: reglasObjetivoRes.objetivos,
        turnosOtrosLugares: turnosOtrosRD.turnos,
        maxSlot, normLegajo,
      })

      const avisos = Object.entries(faltantesPorTurno).map(([tk, n]) => {
        const ti = TURNOS_INFO.find(x => x.key === tk)
        return `   • ${ti ? ti.label : tk.toUpperCase()}: faltó cubrir ${n} lugar${n > 1 ? 'es' : ''} — ${motivoPorTurno[tk]}`
      })

      if (nuevos.length === 0) {
        let m = `Día ${dia}: no se asignó ninguna guardia nueva.`
        m += avisos.length ? `\n\n${avisos.join('\n')}` : ` Ya estaba completo o no hay disponibilidad cargada.`
        alert(m)
        setRellenandoDia(null)
        return
      }

      {
        const { error } = await fetch('/api/admin-turnos', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'insertar', mes: MES, anio: ANIO, turnos: nuevos }),
        }).then(r => r.json())
        if (error) { setRellenandoDia(null); alert('❌ Error guardando: ' + error + '\n\nEs posible que no se hayan guardado todas las guardias.'); return }
      }
      await cargarTodo(L)

      let m = `✓ Día ${dia}: se asignaron ${nuevos.length} guardias.`
      if (avisos.length) m += `\n\n⚠ Quedaron lugares sin cubrir:\n${avisos.join('\n')}`
      alert(m)
    } catch (err) {
      alert('Error al completar el día: ' + (err?.message || err))
    } finally {
      setRellenandoDia(null)
    }
  }

  // ===== Solapa "Asignación rápida": iguala la cantidad de guardias del mes anterior =====
  function mesAnteriorDe(m, a) { return m === 1 ? { mes: 12, anio: a - 1 } : { mes: m - 1, anio: a } }

  async function buscarPorLegajo() {
    const legajo = buscarLegajoInput.trim()
    if (!legajo) return
    setBuscarLegajoCargando(true); setBuscarLegajoError(null); setBuscarLegajoResultado(null)
    try {
      const res = await fetch(`/api/buscar-legajo?legajo=${encodeURIComponent(legajo)}&mes=${MES}&anio=${ANIO}`)
      const data = await res.json()
      if (!res.ok) { setBuscarLegajoError(data.error || 'Error al buscar'); return }
      if (!data.encontrado) { setBuscarLegajoError(`No se encontró ningún efectivo ni guardia con el legajo "${legajo}" en ${MES}/${ANIO}.`); return }
      setBuscarLegajoResultado(data)
    } catch (err) {
      setBuscarLegajoError('Error de conexión: ' + err.message)
    } finally {
      setBuscarLegajoCargando(false)
    }
  }

  async function cargarEspeciales() {
    // Antes leía la tabla efectivos_especiales directo con la clave pública
    // del navegador — ahora pasa por /api/admin-especiales (sesión de
    // administrador + clave de servicio). Ver supabase/migrations/
    // 0008_rls_firmas_especiales_asistencia_planilla.sql.
    const { especiales: data } = await fetch('/api/admin-especiales').then(r => r.json()).catch(() => ({ especiales: [] }))
    const lista = data || []
    setEspeciales(lista)
    // Precargar 24hs en el estado rapida24hs
    const set24 = new Set(lista.filter(e => e.tipo === '24hs').map(e => e.legajo1))
    setRapida24hs(set24)
  }

  async function agregarEspecial() {
    if (!nuevoEspecialLeg1.trim()) return alert('Ingresá el legajo')
    if (nuevoEspecialTipo === 'pareja' && !nuevoEspecialLeg2.trim()) return alert('Ingresá el legajo del segundo efectivo')
    const { error } = await fetch('/api/admin-especiales', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'guardar',
        tipo: nuevoEspecialTipo,
        legajo1: nuevoEspecialLeg1.trim(),
        legajo2: nuevoEspecialTipo === 'pareja' ? nuevoEspecialLeg2.trim() : null,
      }),
    }).then(r => r.json())
    if (error) return alert('Error al guardar: ' + error)
    setNuevoEspecialLeg1(''); setNuevoEspecialLeg2('')
    await cargarEspeciales()
  }

  async function quitarEspecial(id) {
    await fetch('/api/admin-especiales', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'desactivar', id }),
    })
    await cargarEspeciales()
  }

  // "Cantidad fija" — mismo backend que "Configurar objetivo" (ficha del
  // efectivo), expuesto acá para cargarlo rápido antes de correr Asignación
  // rápida. Ver lib/asignacionRapidaFlujo.js (Fase 2) para cómo se usa esto
  // para darle prioridad de cupo a estos efectivos.
  //
  // Corrección de esta ronda (migración 0007): este panel lista y agrega
  // SOLO objetivos con prioridad=true. Antes mostraba cualquier objetivo
  // configurado (incluido uno cargado por la ficha del efectivo, o por un
  // script de datos de prueba) como si tuviera prioridad, sin que el
  // administrador lo hubiera elegido acá.
  async function cargarObjetivosFijos() {
    const [{ objetivos }, { reglas }] = await Promise.all([
      fetch('/api/admin-reglas-objetivo?prioridad=true').then(r => r.json()),
      fetch('/api/admin-reglas-puesto').then(r => r.json()).catch(() => ({ reglas: [] })),
    ])
    setObjetivosFijos(objetivos || [])
    const mapa = {}
    ;(reglas || []).forEach(r => { mapa[String(r.legajo)] = r })
    setPuestosFijoPorLegajoFijo(mapa)
  }
  async function agregarObjetivoFijo() {
    if (!nuevoObjetivoFijoLeg.trim()) return alert('Seleccioná un efectivo')
    const cant = Number(nuevoObjetivoFijoCantidad)
    if (!Number.isFinite(cant) || cant < 0) return alert('Cantidad inválida')
    const leg = nuevoObjetivoFijoLeg.trim()
    const { ok, error } = await fetch('/api/admin-reglas-objetivo', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'guardar', legajo: leg, tipo: 'guardias', cantidad: cant, turno_objetivo: 'ambos', prioridad: true }),
    }).then(r => r.json())
    if (!ok) return alert('Error al guardar: ' + error)
    // "Elegir el lugar" (pedido de esta ronda): si se eligió un sector,
    // además deja a este efectivo fijo en ESE sector (Puestos específicos
    // — ver comentario junto a puestosFijoPorLegajoFijo). Si la cantidad
    // ya se guardó bien pero ESTO falla, se avisa explícitamente en vez de
    // fallar en silencio (mismo criterio que el resto del sistema) — la
    // cantidad fija queda igual cargada, solo falta el sector.
    if (nuevoObjetivoFijoSector) {
      const { ok: okP, error: errP } = await fetch('/api/admin-reglas-puesto', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'guardar', legajo: leg, sector: nuevoObjetivoFijoSector }),
      }).then(r => r.json())
      if (!okP) alert('La cantidad fija se guardó, pero no se pudo fijar el sector: ' + errP)
    }
    setNuevoObjetivoFijoLeg(''); setNuevoObjetivoFijoCantidad(0); setFiltroObjetivoFijo(''); setNuevoObjetivoFijoSector('')
    await cargarObjetivosFijos()
    await cargarRapida() // la lista de abajo (rapidaLista) tiene que reflejar el nuevo objetivo ya mismo
  }
  async function quitarObjetivoFijo(id, legajo) {
    // Bug real encontrado esta ronda ("me estás poniendo a Juárez Daniel
    // como que no cargó... lo quité de la lista"): esto ANTES también
    // desactivaba el puesto fijo del efectivo con el único criterio de "¿ya
    // tiene alguno activo?" (puestosFijoPorLegajoFijo, que se llena con
    // CUALQUIER puesto fijo activo del legajo, lo haya configurado este
    // panel o la ficha individual del efectivo, en cualquier momento,
    // completamente aparte). Eso significa que si un efectivo tenía puesto
    // fijo configurado en su ficha (como Daniel, confinado a "Guardia" en
    // esta misma ronda) Y ADEMÁS, sin relación, terminaba con una cantidad
    // fija acá (por ejemplo en 0, que pisaba el objetivo derivado del mes
    // anterior sin que se notara), sacar la cantidad fija le borraba TAMBIÉN
    // el puesto fijo sin ningún aviso — justo lo que pasó. No hay forma de
    // distinguir acá "se configuraron juntos desde este panel" de "ya tenía
    // uno de antes, por su cuenta", así que lo más seguro es no tocar nunca
    // el puesto fijo desde este botón: "Quitar" ahora SOLO saca la cantidad
    // fija. Si además hace falta sacar el puesto fijo, se hace aparte,
    // explícitamente, desde la ficha del efectivo (que ya tiene su propio
    // botón "Quitar puesto fijo").
    await fetch('/api/admin-reglas-objetivo', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'desactivar', id }),
    }).then(r => r.json())
    await cargarObjetivosFijos()
    await cargarRapida()
  }

  async function cargarRapida() {
    setRapidaCargando(true); setRapidaMsg(null)
    const L = lugarDetectado
    const sectores = SECTORES_POR_LUGAR[L] || SECTORES_POR_LUGAR['HIGA']
    const horasTurnoL = L === 'MODULAR' ? 8 : 12
    const prev = mesAnteriorDe(MES, ANIO)
    const [turnosPrevRes, turnosActRes, objetivosCfgRes] = await Promise.all([
      fetch(`/api/admin-turnos?mes=${prev.mes}&anio=${prev.anio}`).then(r => r.json()),
      fetch(`/api/admin-turnos?mes=${MES}&anio=${ANIO}`).then(r => r.json()),
      // Punto 3 de esta ronda: un objetivo configurado reemplaza al derivado
      // del mes anterior (ver lib/objetivosEfectivos.resolverObjetivoGuardias)
      // — sin configuración, el número que se muestra/usa es exactamente el
      // de antes (cantidad de guardias del mes anterior).
      fetch('/api/admin-reglas-objetivo').then(r => r.json()).catch(() => ({ objetivos: [] })),
    ])
    const turnosPrev = turnosPrevRes.turnos
    const turnosAct = turnosActRes.turnos
    const countPrev = {}; (turnosPrev || []).forEach(t => { countPrev[t.legajo] = (countPrev[t.legajo] || 0) + 1 })
    const objetivoCfgPorLegajo = {}
    ;(objetivosCfgRes.objetivos || []).forEach(o => { objetivoCfgPorLegajo[normLegajo(o.legajo)] = o })
    function objetivoDeEfectivo(legajo) {
      return resolverObjetivoGuardias({
        objetivoConfigurado: objetivoCfgPorLegajo[normLegajo(legajo)],
        objetivoDerivado: countPrev[legajo] || 0,
        horasTurno: horasTurnoL,
      })
    }
    // "Cargó disponibilidad" se define acá EXACTAMENTE igual que en la grilla de Disponibilidad:
    // mismo estado 'disponibilidad', mismo criterio (al menos 1 día cargado). Antes esta pantalla
    // hacía su propia consulta aparte a la base, y aunque el filtro fuera el mismo en el papel,
    // podían llegar a mostrar cosas distintas para un mismo efectivo. Ahora usan la misma fuente,
    // así que no pueden divergir.
    const cargaron = new Set(
      Object.keys(disponibilidad).filter(legajo => Object.keys(disponibilidad[legajo] || {}).length > 0)
    )
    const countAct = {}; (turnosAct || []).forEach(t => { countAct[t.legajo] = (countAct[t.legajo] || 0) + 1 })
    const lista = efectivos
      .filter(e => cargaron.has(normLegajo(e.legajo)) && objetivoDeEfectivo(e.legajo) > 0)
      .map(e => ({ legajo: e.legajo, nombre: e.nombre, objetivo: objetivoDeEfectivo(e.legajo), yaAsignadas: countAct[e.legajo] || 0 }))
      // Orden por objetivo (cantidad de guardias a cubrir — del mes anterior,
      // o la configurada si existe) descendente: al correr "Asignar todos",
      // los que tienen que cubrir MÁS guardias entran primero a la
      // asignación rápida, mientras todavía hay más días/turnos
      // compartidos libres. Desempate alfabético para que el orden sea estable en la UI.
      .sort((a, b) => (b.objetivo - a.objetivo) || a.nombre.localeCompare(b.nombre))
    const nuevos = efectivos
      .filter(e => cargaron.has(normLegajo(e.legajo)) && objetivoDeEfectivo(e.legajo) === 0)
      .map(e => ({ legajo: e.legajo, nombre: e.nombre }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre))
    setRapidaNuevos(nuevos)
    setRapidaLista(lista); setRapidaCargando(false)
  }

  // Asigna a una lista de objetivos {legajo, objetivo} respetando descanso 12hs,
  // reparto espaciado, tope 180hs y máx 2 por slot. Mantiene la ocupación compartida.
  //
  // Ronda de corrección de errores: el algoritmo en sí (fases, orden,
  // criterio de reparto) vive ahora en lib/asignacionRapidaFlujo.js
  // (calcularAsignacionRapida + ejecutarAsignacionRapida), con los 6 errores
  // reproducidos corregidos ahí — esta función es un wrapper fino que solo
  // junta los parámetros de la pantalla (lugar/mes/año/sectores/turnos) y
  // delega. Se extrajo así para poder probar la LÓGICA REAL con un test de
  // Node (no una reimplementación aparte) — ver tests/node/04_asignacion_rapida_flujo.js.
  async function procesarRapida(targets, legajos24hs = new Set()) {
    const L = lugarDetectado
    const sectores = SECTORES_POR_LUGAR[L] || SECTORES_POR_LUGAR['HIGA']
    const turnosLugar = L === 'MODULAR' ? ['m', 't', 'n'] : ['d', 'n']
    const horasTurno = L === 'MODULAR' ? 8 : 12

    // Pedido de esta ronda: que en cada día/turno con Uniformados asignados
    // haya de los dos sexos, no todos del mismo — ver "Balance de sexo
    // entre Uniformados" en lib/asignacionRapidaFlujo.js. Para eso la
    // fórmula necesita saber el tipo y el sexo de cada efectivo, que acá ya
    // tenemos cargados en `efectivos`.
    const infoEfectivos = {}
    efectivos.forEach(e => { infoEfectivos[normLegajo(e.legajo)] = { tipo: e.tipo, sexo: e.sexo } })

    const resultado = await ejecutarAsignacionRapida({
      fetchFn: (url) => fetch(url),
      mes: MES, anio: ANIO, lugar: L,
      sectores, turnosLugar, horasTurno, maxHs: 180,
      targets, legajos24hs,
      especiales,
      maxSlot,
      normLegajo,
      infoEfectivos,
      insertarFn: (nuevos) => fetch('/api/admin-turnos', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'insertar', mes: MES, anio: ANIO, turnos: nuevos }),
      }).then(r => r.json()),
    })

    if (!resultado.ok) {
      alert('❌ No se pudo completar la asignación: ' + resultado.motivo + '\n\nNo se guardó ninguna guardia nueva (o se detuvo antes de intentar guardar más).')
      return { total: 0, reporte: resultado.reporte || [], conflictos: resultado.conflictos || [], puestoFijoReporte: resultado.puestoFijoReporte || [], incompatibilidades: resultado.incompatibilidades || [], error: true }
    }
    return { total: resultado.total, reporte: resultado.reporte, conflictos: resultado.conflictos, puestoFijoReporte: resultado.puestoFijoReporte, incompatibilidades: resultado.incompatibilidades }
  }

  async function asignarUnoRapida(item) {
    setRapidaProcesando(true); setRapidaMsg(null)
    const { reporte, conflictos, puestoFijoReporte, incompatibilidades, error } = await procesarRapida([{ legajo: item.legajo, objetivo: item.objetivo }], rapida24hs)
    // Bug 6: si procesarRapida se detuvo por un error de lectura o de
    // guardado, ya mostró el motivo — no hay un reporte válido para
    // destructurar (reporte[0] podría no existir), así que no se sigue.
    if (error) { setRapidaProcesando(false); return }
    await cargarTodo(lugarDetectado); await cargarRapida()
    const r = reporte[0]
    const nombre = nombreCorto(item.legajo)
    // Corrección de esta ronda ("Reporte de objetivo"): se informan
    // anteriores/nuevas/total/pendiente por separado — antes se comparaban
    // solo las guardias NUEVAS de esta corrida contra el objetivo
    // completo, lo que hacía ver "faltan 2" aunque el total ya estuviera
    // cubierto (p.ej. objetivo 3, 2 anteriores + 1 nueva).
    let m = `✓ ${nombre}: ${r.nuevas} guardia(s) nueva(s) esta vez` +
      (r.anteriores > 0 ? ` (+ ${r.anteriores} ya cargada${r.anteriores === 1 ? '' : 's'} este mes)` : '') +
      ` — total ${r.total} de ${r.objetivo}.`
    if (r.pendiente > 0) m += ` Pendiente: ${r.pendiente} (disponibilidad o tope).`
    if (conflictos.length) {
      m += `\n\n⚠ ${conflictos.length} día(s) no se asignaron por cruce de horario con otro lugar:\n` +
        conflictos.map(c => `   • Día ${c.dia}: ya tiene turno "${c.turnoOrigen}" en ${c.lugarOrigen} (día ${c.diaOrigen})`).join('\n')
    }
    // Punto 2 de esta ronda: si tiene puesto fijo configurado y no se pudo
    // cubrir todo desde ahí, se informa explícitamente (nunca en silencio).
    m += mensajePuestoFijo(puestoFijoReporte)
    m += mensajeIncompatibilidades(incompatibilidades)
    setRapidaProcesando(false); alert(m)
  }

  // Punto 2 de esta ronda ("Puestos específicos por efectivo"): arma un
  // mensaje legible cuando un efectivo con puesto fijo configurado no pudo
  // cubrir todo su objetivo desde ese puesto (por disponibilidad o cupo) —
  // "informarlo" en vez de dejarlo en silencio o fingir que se cumplió.
  // Bug 5 de esta ronda: ahora SIEMPRE describe "pendiente, no se completa
  // en otro sector" (antes decía que el resto se intentaba en el resto de
  // sectores, que es justo el comportamiento que se corrigió).
  function mensajePuestoFijo(puestoFijoReporte) {
    // Corrección de esta ronda ("Reporte de objetivo"): se filtra y se
    // muestra por `pendiente` (objetivo - total), no por "asignadas de
    // esta corrida < objetivo" — eso hacía ver pendiente algo que ya
    // estaba cubierto por guardias anteriores + nuevas.
    const incompletos = (puestoFijoReporte || []).filter(p => !p.incompatible && p.pendiente > 0)
    if (!incompletos.length) return ''
    return `\n\n📍 Puesto fijo — no se cubrió todo el objetivo desde el puesto configurado. Queda PENDIENTE (no se completa automáticamente en otro sector):\n` +
      incompletos.map(p => {
        const n = nombreCorto(p.legajo)
        return `   • ${n} (${p.sector}${p.turno ? ' · ' + p.turno : ''}): ${p.total} de ${p.objetivo} desde su puesto fijo (pendiente ${p.pendiente})`
      }).join('\n')
  }

  // Corrección de esta ronda (bug 2 — "configuraciones incompatibles deben
  // informarse, nunca ignorarse silenciosamente"): arma un mensaje legible
  // para cada incompatibilidad detectada por el algoritmo (puesto fijo vs.
  // turno objetivo, 24hs vs. turno objetivo, o pareja sin turno en común).
  function mensajeIncompatibilidades(incompatibilidades) {
    const lista = incompatibilidades || []
    if (!lista.length) return ''
    return `\n\n⚠ ${lista.length} configuración(es) incompatible(s) detectada(s) — no se asignó nada en ese caso:\n` +
      lista.map(i => {
        const nombres = (i.legajos || []).map(lg => nombreCorto(lg)).join(' y ')
        return `   • ${nombres}: ${i.motivo}`
      }).join('\n')
  }

  async function asignarTodosRapida() {
    if (rapidaLista.length === 0) return
    // Pedido de esta ronda ("me estás poniendo a Juárez Daniel como que no
    // cargó el mes anterior y sí cargó... es un detalle para mejorar, ya
    // que confunde"): "el mes anterior" sin decir CUÁL mes, mientras se
    // está probando el sistema saltando entre meses, se presta a leerse
    // como "nunca cargó nada" en vez de "no tiene guardias en el mes
    // puntual que toca comparar ahora". Se nombra el mes explícito en todo
    // este flujo (acá y en el panel "Sin guardias en <mes>" más abajo) —
    // la lógica de cuál mes es "el anterior" no cambió, solo se lo dice.
    const prevConfirm = mesAnteriorDe(MES, ANIO)
    const nombrePrevConfirm = MESES_NOMBRES[prevConfirm.mes - 1] + ' ' + prevConfirm.anio
    const aviso24hs = rapida24hs.size > 0 ? `\n\n${rapida24hs.size} marcado(s) para guardias de 24hs.` : ''
    if (!confirm(`¿Asignar a ${rapidaLista.length} efectivos la misma cantidad de guardias que tuvieron en ${nombrePrevConfirm}?${aviso24hs}`)) return
    setRapidaProcesando(true); setRapidaMsg(null)
    const { total, reporte, conflictos, puestoFijoReporte, incompatibilidades, error } = await procesarRapida(rapidaLista.map(i => ({ legajo: i.legajo, objetivo: i.objetivo })), rapida24hs)
    // Bug 6: idem asignarUnoRapida — si se detuvo por un error, el motivo ya
    // se mostró y no hay reporte válido para seguir con la verificación.
    if (error) { setRapidaProcesando(false); return }
    await cargarTodo(lugarDetectado); await cargarRapida()

    // Verificación: ¿cuántos días del mes quedaron con turnos asignados?
    const sectoresV = SECTORES_POR_LUGAR[lugarDetectado] || SECTORES_POR_LUGAR['HIGA']
    const diasMes = new Date(ANIO, MES, 0).getDate()
    const { turnos: verificacion } = await fetch(`/api/admin-turnos?mes=${MES}&anio=${ANIO}`).then(r => r.json())
    const diasCubiertos = new Set((verificacion || []).map(t => parseInt(t.dia)))
    const diasFaltantes = []
    for (let d = 1; d <= diasMes; d++) { if (!diasCubiertos.has(d)) diasFaltantes.push(d) }

    // Corrección de esta ronda ("Reporte de objetivo"): se filtra y se
    // muestra por `pendiente` (objetivo - total real), no por "nuevas de
    // esta corrida < objetivo".
    const incompletos = reporte.filter(r => r.pendiente > 0)
    let m = `✓ Se asignaron ${total} guardias en total.\n\n`
    if (diasFaltantes.length === 0) {
      m += `✅ ${diasMes}/${diasMes} días del mes tienen turnos asignados.`
    } else {
      m += `⚠ ATENCIÓN: Solo ${diasCubiertos.size}/${diasMes} días tienen turnos.\nDías SIN turnos: ${diasFaltantes.join(', ')}`
    }
    if (incompletos.length) {
      m += `\n\n⚠ ${incompletos.length} efectivo(s) no llegaron al número:\n` +
        incompletos.slice(0, 12).map(r => {
          const n = nombreCorto(r.legajo)
          return `   • ${n}: ${r.total} de ${r.objetivo} (pendiente ${r.pendiente})`
        }).join('\n')
      if (incompletos.length > 12) m += `\n   …y ${incompletos.length - 12} más.`
    }
    if (conflictos.length) {
      m += `\n\n⚠ ${conflictos.length} guardia(s) NO se asignaron por cruce de horario con otro lugar:\n` +
        conflictos.slice(0, 15).map(c => {
          const n = nombreCorto(c.legajo)
          return `   • ${n} - Día ${c.dia}: ya tiene turno "${c.turnoOrigen}" en ${c.lugarOrigen} (día ${c.diaOrigen})`
        }).join('\n')
      if (conflictos.length > 15) m += `\n   …y ${conflictos.length - 15} más.`
    }
    m += mensajePuestoFijo(puestoFijoReporte)
    m += mensajeIncompatibilidades(incompatibilidades)
    setRapidaProcesando(false); alert(m)
  }

  async function borrarRapida() {
    const L = lugarDetectado
    const sectores = SECTORES_POR_LUGAR[L] || SECTORES_POR_LUGAR['HIGA']
    if (!confirm(`¿Borrar TODAS las guardias de ${L} de ${NOMBRE_MES}? (No afecta a los otros lugares)`)) return
    setRapidaProcesando(true)
    const { error } = await fetch('/api/admin-turnos', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'borrar_scope', mes: MES, anio: ANIO, sectores }),
    }).then(r => r.json())
    if (error) { setRapidaProcesando(false); alert('❌ Error borrando: ' + error); return }
    await cargarTodo(L); await cargarRapida()
    setRapidaProcesando(false)
    setRapidaMsg(`Se borraron las guardias de ${L} de ${NOMBRE_MES}.`)
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

  // Devuelve true/false (éxito/fracaso) además de todo lo que ya hacía —
  // lo necesita handleSwapTurno (más abajo) para saber si puede seguir con
  // la segunda mitad del intercambio, o si tiene que abortar antes de
  // tocar al otro efectivo. El llamador de "Cambiar" (ModalTurno, más
  // arriba) sigue ignorando el valor de vuelta, como siempre.
  async function handleGuardarEdicion(t) {
    // Pedido de esta ronda ("arrastro un efectivo que está de día y lo
    // pongo de noche, el sistema no avisó nada si tenía disponibilidad
    // ahí"): este chequeo faltaba para TODA edición que cambia el turno —
    // arrastrar a otra casilla, intercambiar con otro, o el formulario
    // "Cambiar" — las tres pasan por acá. Si el sector cambia pero el
    // turno es el mismo, no hace falta avisar nada nuevo (la disponibilidad
    // ya era válida para ese turno, nada cambió ahí). Es un aviso que se
    // puede pasar por alto (igual que el de cruce de horario más abajo) —
    // el administrador puede tener motivos para hacerlo igual — pero nunca
    // más en silencio.
    const original = todosLosTurnos.find(x => x.id === t.id)
    if (original && original.turno !== t.turno) {
      const dispEf = ((disponibilidad[normLegajo(t.legajo)] || {})[t.dia] || {}).turno || ''
      if (!dispEf.includes(t.turno)) {
        const nombre = efectivos.find(e => e.legajo === t.legajo)?.nombre || t.legajo
        const label = TURNOS_INFO.find(x => x.key === t.turno)?.label || t.turno
        const motivo = dispEf ? `cargó disponibilidad solo para "${dispEf}"` : 'no cargó disponibilidad'
        const ok = confirm(`⚠ SIN DISPONIBILIDAD\n\n${nombre} ${motivo} el día ${t.dia}, y se lo está pasando al turno "${label}".\n\n¿Guardar igual?`)
        if (!ok) return false
      }
    }
    const chequeo = await buscarCruceOtroLugar(t.legajo, parseInt(t.dia), t.turno, lugarDeSectorGlobal(t.sector), MES, ANIO, t.id)
    if (!chequeo.ok) {
      const continuar = confirm(`⚠ NO SE PUDO VERIFICAR\n\nNo se pudo chequear si este efectivo ya tiene una guardia en otro destino ese mismo horario (${chequeo.motivo}).\n\nGuardar sin esa verificación es un riesgo: podría quedar con dos guardias superpuestas sin que nadie se entere. Probá de nuevo en un momento si podés.\n\n¿Guardar igual, asumiendo el riesgo?`)
      if (!continuar) return false
    } else if (chequeo.cruce) {
      const nombre = efectivos.find(e => e.legajo === t.legajo)?.nombre || t.legajo
      const ok = confirm(`⚠ CRUCE DE HORARIO\n\n${nombre} ya tiene un turno "${chequeo.cruce.turno}" en ${chequeo.cruce.lugar} el día ${chequeo.cruce.dia} (${chequeo.cruce.sector}), que se superpone en horario real con este turno.\n\n¿Guardar igual?`)
      if (!ok) return false
    }
    const { error } = await fetch('/api/admin-turnos', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'actualizar_uno', mes: MES, anio: ANIO, id: t.id, legajo: t.legajo, turno: t.turno, sector: t.sector }),
    }).then(r => r.json())
    if (error) { alert('❌ Error guardando: ' + error); return false }
    setModalTurno(null); await cargarTodo()
    return true
  }
  async function handleEliminarTurno(t) {
    const { error } = await fetch('/api/admin-turnos', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'borrar_uno', mes: MES, anio: ANIO, id: t.id }),
    }).then(r => r.json())
    if (error) { alert('❌ Error eliminando: ' + error); return }
    setModalTurno(null); await cargarTodo()
  }
  async function handleAgregarTurno(n) {
    const chequeo = await buscarCruceOtroLugar(n.legajo, parseInt(n.dia), n.turno, lugarDeSectorGlobal(n.sector), n.mes, n.anio, null)
    if (!chequeo.ok) {
      const continuar = confirm(`⚠ NO SE PUDO VERIFICAR\n\nNo se pudo chequear si este efectivo ya tiene una guardia en otro destino ese mismo horario (${chequeo.motivo}).\n\nGuardar sin esa verificación es un riesgo: podría quedar con dos guardias superpuestas sin que nadie se entere. Probá de nuevo en un momento si podés.\n\n¿Guardar igual, asumiendo el riesgo?`)
      if (!continuar) return
    } else if (chequeo.cruce) {
      const nombre = efectivos.find(e => e.legajo === n.legajo)?.nombre || n.legajo
      const ok = confirm(`⚠ CRUCE DE HORARIO\n\n${nombre} ya tiene un turno "${chequeo.cruce.turno}" en ${chequeo.cruce.lugar} el día ${chequeo.cruce.dia} (${chequeo.cruce.sector}), que se superpone en horario real con este turno.\n\n¿Guardar igual?`)
      if (!ok) return
    }
    const { error } = await fetch('/api/admin-turnos', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'insertar', mes: n.mes, anio: n.anio, turnos: [n] }),
    }).then(r => r.json())
    if (error) { alert('❌ Error guardando: ' + error); return }
    setModalTurno(null); await cargarTodo()
  }
  // Mover por arrastre a una casilla CON LUGAR (ver comentario junto a
  // arrastrando/dropHover más arriba): es EXACTAMENTE lo mismo que
  // "Cambiar" (handleGuardarEdicion) — mismo chequeo de cruce de horario
  // con otro destino incluido — solo que acá el sector/turno de destino
  // viene de dónde se soltó la tarjeta, no de un formulario. Nunca se
  // suelta sobre el mismo lugar de donde salió (no hace nada). Si la
  // casilla de destino está completa, quien llama a esto (el onDrop, más
  // abajo) tiene que usar handleSwapTurno en cambio — este chequeo de cupo
  // queda igual como última verificación por si cambió mientras se
  // arrastraba.
  async function handleMoverTurno(item, sectorDestino, turnoDestino) {
    if (item.sector === sectorDestino && item.turno === turnoDestino) return
    const ocupadosDestino = todosLosTurnos.filter(t => t.dia === item.dia && t.turno === turnoDestino && t.sector === sectorDestino).length
    if (ocupadosDestino >= maxSlot(sectorDestino, turnoDestino)) {
      const label = TURNOS_INFO.find(x => x.key === turnoDestino)?.label || turnoDestino
      alert(`⛔ ${sectorDestino} (${label}) ya está completo — no hay lugar para moverlo ahí.`)
      return
    }
    await handleGuardarEdicion({ ...item, sector: sectorDestino, turno: turnoDestino })
  }

  // Intercambiar por arrastre: se soltó "item" sobre una casilla QUE YA
  // TIENE a "otro" (sin lugar libre) — en vez de bloquear, cada uno pasa a
  // ocupar el lugar del otro. Se guarda la ubicación ORIGINAL de "item"
  // antes de la primera actualización (que ya modifica su sector/turno en
  // la base), para que la segunda actualización sepa adónde mandar a
  // "otro". Si la primera mitad falla (cruce de horario rechazado, error de
  // red, etc.) se aborta ANTES de tocar a "otro", para no dejar el
  // intercambio a mitad de camino.
  async function handleSwapTurno(item, otro) {
    if (item.id === otro.id) return
    const sectorOrigen = item.sector, turnoOrigen = item.turno
    const ok = await handleGuardarEdicion({ ...item, sector: otro.sector, turno: otro.turno })
    if (!ok) return
    await handleGuardarEdicion({ ...otro, sector: sectorOrigen, turno: turnoOrigen })
  }

  async function handleGuardarPersonal(datos) {
    setGuardandoPersonal(true)
    if (datos.id) {
      // Punto 3 de la ronda anterior + punto 2 de esta ronda ("Completar la
      // coherencia del cambio de legajo"): el renombrado de los turnos del
      // borrador, Y AHORA TAMBIÉN de disponibilidad/asistencia/
      // planilla_manual/firmas, ya NO se piden acá por separado — antes
      // esto disparaba, con Promise.allSettled (en paralelo, ANTES de
      // llamar a admin-efectivos), un pedido a /api/admin-disponibilidad
      // (rename_legajo) y dos escrituras directas con la clave anon
      // (asistencia, planilla_manual, firmas). Si la llamada principal
      // (fn_admin_guardar_efectivo, más abajo) fallaba después —por
      // ejemplo por legajo duplicado—, esas cuatro escrituras ya habían
      // ocurrido igual, sin ninguna forma de revertirlas: quedaba una
      // parte modificada (las relaciones históricas) y otra no (el
      // efectivo, que seguía con el legajo viejo). Ahora todo —efectivo,
      // turnos, disponibilidad, asistencia, planilla_manual y firmas
      // (cuando es inequívoco)— se renombra en UNA sola llamada, dentro de
      // UNA sola transacción de servidor: si cualquier parte falla,
      // ninguna relación queda modificada. Ver el detalle completo (por
      // qué firmas es un caso aparte, sin columna lugar) en
      // fn_admin_guardar_efectivo, supabase/migrations/0001_borrador_publicacion.sql.
      const { error, ...resto } = await fetch('/api/admin-efectivos', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'guardar', id: datos.id, legajo: datos.legajo, nombre: datos.nombre, tipo: datos.tipo, email: datos.email || '', sector: datos.sector || 'Sin asignar', telefono: datos.telefono || '', notas: datos.notas || null, dni: datos.dni || null, jerarquia: datos.jerarquia || null, password: datos.password || null }),
      }).then(r => r.json())
      if (error) { setMsgPersonal(error); setGuardandoPersonal(false); return }
      // Punto 1 de esta ronda ("Identificación por sexo"): llamada SEPARADA
      // a propósito — fn_admin_guardar_efectivo (arriba) es la función que
      // esta ronda no debe modificar. Si esto fallara, el resto de la
      // edición YA se guardó igual (no se revierte: son dos datos
      // independientes) — se avisa en el mensaje, nunca en silencio.
      let errorSexo = null
      if (datos.sexo) {
        const r = await fetch('/api/admin-efectivos', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'set_sexo', id: datos.id, sexo: datos.sexo }),
        }).then(r => r.json())
        errorSexo = r.error || null
      }
      // Si firmas se omitió por ambigüedad (el legajo viejo o el nuevo
      // podrían pertenecer a más de un efectivo entre todos los lugares),
      // se avisa explícitamente en vez de dejarlo pasar en silencio — el
      // administrador puede revisarlo a mano si corresponde.
      let msg = 'Efectivo actualizado.'
      if (resto?.firmas_omitidas_por_ambiguedad) {
        msg += ' ⚠ La firma NO se renombró automáticamente: el legajo viejo o el nuevo podría corresponder a más de un efectivo (firmas no distingue por lugar) — revisarlo manualmente si corresponde.'
      }
      if (errorSexo) msg += ' ⚠ No se pudo guardar el sexo: ' + errorSexo
      setMsgPersonal(msg)
    } else {
      const { error, mensaje } = await fetch('/api/admin-efectivos', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'guardar', legajo: datos.legajo, nombre: datos.nombre, tipo: datos.tipo, email: datos.email || '', telefono: datos.telefono || '', sexo: datos.sexo || 'sin_informar' }),
      }).then(r => r.json())
      if (error) { setMsgPersonal(error); setGuardandoPersonal(false); return }
      setMsgPersonal(mensaje || ('Efectivo dado de alta. Clave inicial: ' + datos.legajo))
    }
    setGuardandoPersonal(false); await cargarTodo()
  }
  async function handleEliminarPersonal(ef) {
    await fetch('/api/admin-efectivos', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'eliminar', id: ef.id }),
    })
    setModalPersonal(null); await cargarTodo()
  }

  async function cargarPlanillaEf(ef) {
    // Antes leía planilla_manual/firmas/asistencia directo con la clave
    // pública del navegador — ahora pasa por los endpoints del servidor
    // (sesión de administrador + clave de servicio). Ver supabase/migrations/
    // 0008_rls_firmas_especiales_asistencia_planilla.sql.
    setCargandoPlanilla(true)
    const [{ planilla: manual }, { firmas: firmasData }, { asistencia: asist }] = await Promise.all([
      fetch(`/api/admin-planilla-manual?mes=${MES}&anio=${ANIO}&legajo=${encodeURIComponent(ef.legajo)}`).then(r => r.json()).catch(() => ({ planilla: [] })),
      fetch(`/api/admin-firmas?mes=${MES}&anio=${ANIO}&legajo=${encodeURIComponent(ef.legajo)}`).then(r => r.json()).catch(() => ({ firmas: [] })),
      fetch(`/api/admin-asistencia?mes=${MES}&anio=${ANIO}&legajo=${encodeURIComponent(ef.legajo)}`).then(r => r.json()).catch(() => ({ asistencia: [] })),
    ])
    const manualMap = {}
    ;(manual || []).forEach(m => { manualMap[`${m.dia}-${m.horario}`] = m })
    setPlanillaManual(manualMap)
    let firmaObj = firmasData && firmasData[0] ? firmasData[0] : null
    if (!firmaObj?.firma_url && ef.firma_url) {
      const { firma: newFirma } = await fetch('/api/admin-firmas', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'guardar', legajo: ef.legajo, mes: MES, anio: ANIO, firma_url: ef.firma_url }),
      }).then(r => r.json()).catch(() => ({ firma: null }))
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
    // Antes escribía planilla_manual directo con la clave pública del
    // navegador — ahora pasa por /api/admin-planilla-manual. Ver
    // supabase/migrations/0008_rls_firmas_especiales_asistencia_planilla.sql.
    const key = `${dia}-${horario}`; const existe = planillaManual[key]
    if (horas === '' || horas === 0) {
      if (existe) {
        await fetch('/api/admin-planilla-manual', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'borrar', id: existe.id }),
        })
        const nuevo = { ...planillaManual }; delete nuevo[key]; setPlanillaManual(nuevo)
      }
      return
    }
    await fetch('/api/admin-planilla-manual', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'guardar', legajo, mes: MES, anio: ANIO, dia: parseInt(dia), horario, horas: parseInt(horas), sector: sector || '' }),
    })
    const { planilla: fresh } = await fetch(`/api/admin-planilla-manual?mes=${MES}&anio=${ANIO}&legajo=${encodeURIComponent(legajo)}`).then(r => r.json()).catch(() => ({ planilla: [] }))
    const newMap = {}; ;(fresh || []).forEach(m => { newMap[`${m.dia}-${m.horario}`] = m }); setPlanillaManual(newMap)
  }

  async function subirFirmaAdmin(id, legajo, base64) {
    // Antes escribía firmas directo con la clave pública del navegador —
    // ahora pasa por /api/admin-firmas. Ver supabase/migrations/
    // 0008_rls_firmas_especiales_asistencia_planilla.sql.
    await fetch('/api/admin-efectivos', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'set_firma_url', id, firma_url: base64 }),
    })
    await fetch('/api/admin-firmas', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'guardar', legajo, mes: MES, anio: ANIO, firma_url: base64 }),
    })
    setFirmas(prev => ({ ...prev, [legajo]: { ...prev[legajo], firma_url: base64 } }))
    setEfectivos(prev => prev.map(e => e.id === id ? { ...e, firma_url: base64 } : e))
  }

  async function eliminarFirmaAdmin(id, legajo) {
    await fetch('/api/admin-efectivos', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'set_firma_url', id, firma_url: null }),
    })
    await fetch('/api/admin-firmas', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'borrar', legajo, mes: MES, anio: ANIO }),
    })
    setFirmas(prev => ({ ...prev, [legajo]: { ...prev[legajo], firma_url: null } }))
    setEfectivos(prev => prev.map(e => e.id === id ? { ...e, firma_url: null } : e))
  }

  async function fixPrintAreaXlsxClient(buffer) {
    const JSZip = (await import('jszip')).default
    const zip = await JSZip.loadAsync(buffer)
    const workbookFile = zip.file('xl/workbook.xml')
    if (!workbookFile) throw new Error('estructura xlsx inválida')
    let wbXml = await workbookFile.async('string')
    const sheetMatch = wbXml.match(/<sheet[^>]+name="([^"]+)"/)
    const sheetName = sheetMatch ? sheetMatch[1] : 'PLANILLA INDIVIDUAL'
    const printAreaDef = '<definedName name="Print_Area" localSheetId="0">' + "'" + sheetName + "'!$A$1:$G$39</definedName>"
    if (wbXml.includes('<definedNames>')) {
      if (!wbXml.includes('Print_Area')) wbXml = wbXml.replace('<definedNames>', '<definedNames>' + printAreaDef)
    } else {
      wbXml = wbXml.replace('</workbook>', '<definedNames>' + printAreaDef + '</definedNames></workbook>')
    }
    zip.file('xl/workbook.xml', wbXml)
    const sheetFile = zip.file('xl/worksheets/sheet1.xml')
    if (sheetFile) {
      let sheetXml = await sheetFile.async('string')
      while (sheetXml.includes('<rowBreaks')) {
        const start = sheetXml.indexOf('<rowBreaks')
        const end = sheetXml.indexOf('>', start)
        if (sheetXml[end - 1] === '/') sheetXml = sheetXml.slice(0, start) + sheetXml.slice(end + 1)
        else {
          const closeTag = sheetXml.indexOf('</rowBreaks>', end)
          if (closeTag === -1) break
          sheetXml = sheetXml.slice(0, start) + sheetXml.slice(closeTag + 12)
        }
      }
      const pageSetup = '<pageSetup paperSize="9" orientation="portrait" fitToHeight="1" fitToWidth="1"/>'
      if (sheetXml.includes('<pageSetup')) {
        const ps = sheetXml.indexOf('<pageSetup')
        const pe = sheetXml.indexOf('/>', ps) + 2
        sheetXml = sheetXml.slice(0, ps) + pageSetup + sheetXml.slice(pe)
      } else {
        sheetXml = sheetXml.replace('</worksheet>', pageSetup + '</worksheet>')
      }
      zip.file('xl/worksheets/sheet1.xml', sheetXml)
    }
    return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })
  }

  async function fixPrintAreaOdsClient(buffer) {
    const JSZip = (await import('jszip')).default
    const zip = await JSZip.loadAsync(buffer)
    const contentFile = zip.file('content.xml')
    if (!contentFile) throw new Error('estructura ods inválida')
    let contentXml = await contentFile.async('string')
    if (!contentXml.includes('table:print-ranges')) {
      contentXml = contentXml.replace(/(<table:table\b)([^>]*)(>)/, function (match, p1, p2, p3) {
        const sheetMatch = p2.match(/table:name="([^"]+)"/)
        const sheetName = sheetMatch ? sheetMatch[1] : 'PLANILLA INDIVIDUAL'
        return p1 + p2 + ' table:print-ranges="' + sheetName + '.$A$1:$G$39"' + p3
      })
      zip.file('content.xml', contentXml)
    }
    return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })
  }

  async function subirPlanillaAdmin(id, legajo, file) {
    if (!file) return
    const nombreLower = file.name.toLowerCase()
    const esXlsx = nombreLower.endsWith('.xlsx')
    const esOds = nombreLower.endsWith('.ods')
    if (!esXlsx && !esOds) { alert('Solo se aceptan archivos .xlsx o .ods'); return }
    const ext = esXlsx ? 'xlsx' : 'ods'

    try {
      const buffer = await file.arrayBuffer()
      let finalBlob
      try {
        finalBlob = esXlsx ? await fixPrintAreaXlsxClient(buffer) : await fixPrintAreaOdsClient(buffer)
      } catch (e) {
        finalBlob = file
      }

      const urlRes = await fetch('/api/crear-url-planilla', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ legajo, ext, lugar: APP_LUGAR })
      })
      const urlData = await urlRes.json()
      if (!urlRes.ok || !urlData.ok) { alert('Error al preparar la subida: ' + (urlData.error || 'desconocido')); return }

      const { error: uploadError } = await supabase.storage
        .from('planillas')
        .uploadToSignedUrl(urlData.path, urlData.token, finalBlob, {
          contentType: esXlsx
            ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            : 'application/vnd.oasis.opendocument.spreadsheet'
        })
      if (uploadError) { alert('Error al subir: ' + uploadError.message); return }

      const { data: pub } = supabase.storage.from('planillas').getPublicUrl(urlData.path)
      const publicUrl = pub.publicUrl

      const { error: updateError } = await fetch('/api/admin-efectivos', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set_planilla_url', id, planilla_url: publicUrl }),
      }).then(r => r.json())
      if (updateError) { alert('Error actualizando: ' + updateError); return }

      setEfectivos(prev => prev.map(e => e.id === id ? { ...e, planilla_url: publicUrl } : e))
      setPlanillaEf(prev => (prev && prev.id === id) ? { ...prev, planilla_url: publicUrl } : prev)
      alert('✅ Planilla subida correctamente')
    } catch (err) {
      alert('Error al subir: ' + err.message)
    }
  }

  async function eliminarPlanillaAdmin(id, legajo) {
    // Punto 5 de esta ronda: antes esto borraba el archivo en Supabase
    // Storage DIRECTO desde el navegador con la clave anon (ver el
    // comentario en pages/api/admin-efectivos.js, acción
    // 'set_planilla_url') — ahora ese borrado lo hace el servidor, con la
    // service role, scopeado al lugar de la sesión del administrador.
    await fetch('/api/admin-efectivos', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'set_planilla_url', id, planilla_url: null }),
    })
    setEfectivos(prev => prev.map(e => e.id === id ? { ...e, planilla_url: null } : e))
    setPlanillaEf(prev => (prev && prev.id === id) ? { ...prev, planilla_url: null } : prev)
  }

  async function handleLoginAdmin(e) {
    e.preventDefault()
    setLoginAdmin(prev => ({ ...prev, error: '', loading: true }))
    try {
      // Antes esto comparaba la contraseña contra 'admin2025' escrito en el
      // código del cliente (visible para cualquiera). Ahora se verifica en
      // el servidor (pages/api/auth-login.js), que además deja la sesión
      // firmada en una cookie — eso es lo que de verdad protege los
      // endpoints de administración, no esta pantalla.
      const resp = await fetch('/api/auth-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ legajo: loginAdmin.legajo.trim(), password: loginAdmin.pass }),
      })
      const body = await resp.json()
      if (!resp.ok) {
        setLoginAdmin(prev => ({ ...prev, error: body.error || 'No se pudo iniciar sesión.', loading: false }))
        return
      }
      if (!body.usuario?.es_admin) {
        setLoginAdmin(prev => ({ ...prev, error: 'Ese legajo no tiene permisos de administrador.', loading: false }))
        return
      }
      const data = body.usuario
      localStorage.setItem('polad_user', JSON.stringify(data))
      adminLoggedIn.current = true
      setLoginAdmin(false)
      const lugar = _detectLugar()
      const now = new Date()
      // Igual que en el otro punto de carga de la ventana: por endpoint
      // propio, no directo a Supabase (ver pages/api/configuracion.js).
      fetch('/api/configuracion?lugar=' + encodeURIComponent(lugar)).then(r => r.json()).then(({ cfg }) => {
        if (cfg) {
          const v2 = { dia: cfg.dia?.toString()||'', horaInicio: cfg.hora_inicio||'08:00', horaFin: cfg.hora_fin||'20:00', mesVentana: cfg.mes||now.getMonth()+1, anioVentana: cfg.anio||now.getFullYear(), mesApertura: cfg.mes_apertura||now.getMonth()+1, anioApertura: cfg.anio_apertura||now.getFullYear() }
          setVentanas(v2)
          localStorage.setItem(`polad_ventanas_${lugar}`, JSON.stringify(v2))
        }
      }).catch(() => {})
      setTimeout(() => cargarTodo(lugar), 0)
    } catch (err) {
      setLoginAdmin(prev => ({ ...prev, error: 'Error de conexión.', loading: false }))
    }
  }

  const IMAGEN_FONDO = APP_LUGAR === 'UPA' ? '/upa2.webp' : APP_LUGAR === 'MODULAR' ? '/modular.jpeg' : '/higa foto.webp'

  if (loginAdmin !== false) return (
    <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', padding:20, position:'relative', overflow:'hidden' }}>
      <div style={{ position:'fixed', top:0, left:0, right:0, bottom:0, backgroundImage:`url('${IMAGEN_FONDO}')`, backgroundSize:'cover', backgroundPosition:'center', filter:'grayscale(100%) brightness(0.3) contrast(1.1)', zIndex:0 }} />
      <div style={{ position:'fixed', top:0, left:0, right:0, bottom:0, background:'rgba(0,0,0,0.45)', zIndex:1 }} />
      <div style={{ position:'relative', zIndex:2, width:'100%', maxWidth:360 }}>
        <h1 style={{ fontFamily:"'Cinzel', serif", fontSize:22, fontWeight:700, color:'#e8eaf0', marginBottom:4, textAlign:'center', letterSpacing:'0.06em' }}>
          POLAD · {APP_LUGAR}
        </h1>
        <p style={{ fontSize:11, color:'#c8a84b', textAlign:'center', letterSpacing:'0.12em', marginBottom:28, textTransform:'uppercase' }}>
          Panel Administrador
        </p>
        <div style={{ background:'rgba(10,10,10,0.75)', border:'0.5px solid rgba(200,168,75,0.2)', borderRadius:12, padding:'28px 24px', backdropFilter:'blur(6px)' }}>
          {loginAdmin === null ? (
            <p style={{ color:'#8b90a0', textAlign:'center', fontSize:13 }}>Verificando...</p>
          ) : (
            <form onSubmit={handleLoginAdmin}>
              <div style={{ marginBottom:14 }}>
                <label style={{ display:'block', fontSize:12, color:'#8b90a0', marginBottom:5 }}>Legajo</label>
                <input type="text" placeholder="Número de legajo" value={loginAdmin.legajo} onChange={e => setLoginAdmin(prev => ({ ...prev, legajo: e.target.value }))} required autoFocus
                  style={{ width:'100%', padding:'10px 12px', border:'0.5px solid rgba(200,168,75,0.2)', borderRadius:8, fontSize:14, background:'rgba(26,26,26,0.9)', color:'#e8eaf0', boxSizing:'border-box', outline:'none' }} />
              </div>
              <div style={{ marginBottom:20 }}>
                <label style={{ display:'block', fontSize:12, color:'#8b90a0', marginBottom:5 }}>Contraseña</label>
                <input type="password" placeholder="••••••••" value={loginAdmin.pass} onChange={e => setLoginAdmin(prev => ({ ...prev, pass: e.target.value }))} required
                  style={{ width:'100%', padding:'10px 12px', border:'0.5px solid rgba(200,168,75,0.2)', borderRadius:8, fontSize:14, background:'rgba(26,26,26,0.9)', color:'#e8eaf0', boxSizing:'border-box', outline:'none' }} />
              </div>
              {loginAdmin.error && (
                <div style={{ padding:'10px 14px', borderRadius:8, fontSize:13, marginBottom:14, background:'#2b0d0d', color:'#f87171' }}>
                  {loginAdmin.error}
                </div>
              )}
              <button type="submit" disabled={loginAdmin.loading}
                style={{ fontFamily:"'Cinzel', serif", width:'100%', padding:'11px 16px', borderRadius:8, border:'1px solid rgba(200,168,75,0.4)', background:loginAdmin.loading?'rgba(26,26,26,0.85)':'rgba(200,168,75,0.15)', color:'#c8a84b', fontSize:13, fontWeight:600, letterSpacing:'0.1em', cursor:loginAdmin.loading?'not-allowed':'pointer' }}>
                {loginAdmin.loading ? 'Ingresando...' : 'INGRESAR'}
              </button>
            </form>
          )}
        </div>
        <p style={{ fontFamily:"'Cinzel', serif", textAlign:'center', fontSize:9, color:'#444', marginTop:20, letterSpacing:'0.1em' }}>
          SISTEMA DE GESTIÓN DE TURNOS POLAD
        </p>
      </div>
    </div>
  )

  if (!mounted || loading) return <div className="loading">Cargando...</div>

  const todosLosTurnos = Object.values(turnos).flat()
  const hayTurnos = todosLosTurnos.length > 0
  const cargaron = efectivos.filter(e => disponibilidad[normLegajo(e.legajo)] && Object.keys(disponibilidad[normLegajo(e.legajo)]).length > 0).length
  // Pedido de la ronda de prueba: dentro de los que YA cargaron
  // disponibilidad, cuántos son femeninos y cuántos masculinos (para poder
  // advertir si falta convocar a alguno de los dos grupos).
  const cargaronFemenino = efectivos.filter(e => e.sexo === 'femenino' && disponibilidad[normLegajo(e.legajo)] && Object.keys(disponibilidad[normLegajo(e.legajo)]).length > 0).length
  const cargaronMasculino = efectivos.filter(e => e.sexo === 'masculino' && disponibilidad[normLegajo(e.legajo)] && Object.keys(disponibilidad[normLegajo(e.legajo)]).length > 0).length
  const pctDisp = n => cargaron ? `${Math.round(n / cargaron * 100)}%` : '—'
  // Mismo cálculo que pctDisp, pero el NÚMERO solo (sin el "%" ni el "—")
  // — lo necesita la barrita visual del resumen (Opción C elegida entre 3
  // ejemplos mostrados antes de tocar código: "orden" con secciones +
  // "aspecto" con barra de progreso en los carteles que son un porcentaje).
  const pctDispNum = n => cargaron ? Math.round(n / cargaron * 100) : 0
  // Mismo desglose, pero por tipo de personal en vez de por sexo. No hay
  // "sin informar" acá: a diferencia del sexo, el tipo lo carga siempre el
  // administrador al dar de alta al efectivo (no es autoinformado).
  const cargaronUniformado = efectivos.filter(e => e.tipo === 'Uniformado' && disponibilidad[normLegajo(e.legajo)] && Object.keys(disponibilidad[normLegajo(e.legajo)]).length > 0).length
  const cargaronServGeneral = efectivos.filter(e => e.tipo === 'Serv. General' && disponibilidad[normLegajo(e.legajo)] && Object.keys(disponibilidad[normLegajo(e.legajo)]).length > 0).length
  const cargaronDestacamento = efectivos.filter(e => e.tipo === 'Destacamento' && disponibilidad[normLegajo(e.legajo)] && Object.keys(disponibilidad[normLegajo(e.legajo)]).length > 0).length

  // Pedido de la ronda de prueba: mismos totales de horas/sexo que ya
  // tiene la planilla para imprimir (pages/api/generar-planilla.js), pero
  // a la vista acá arriba, sin tener que descargar nada. Usa HORAS_TURNO
  // (8 en Modular, 12 en el resto) y el sexo cargado en cada efectivo.
  const horasAsignadas = todosLosTurnos.length * HORAS_TURNO
  const masculinosAsignados = todosLosTurnos.filter(t => efectivos.find(e => e.legajo === t.legajo)?.sexo === 'masculino').length
  const femeninosAsignados = todosLosTurnos.filter(t => efectivos.find(e => e.legajo === t.legajo)?.sexo === 'femenino').length
  // Mismo desglose, pero por tipo — para que la tarjeta "Turnos asignados"
  // del resumen tenga también su barra "por tipo", igual que ya tiene
  // "Disponibilidad cargada" (pedido de esta ronda: "que luego me haga el
  // de guardias asignadas horas asignadas uniformados...").
  const uniformadosAsignados = todosLosTurnos.filter(t => efectivos.find(e => e.legajo === t.legajo)?.tipo === 'Uniformado').length
  const servGeneralAsignados = todosLosTurnos.filter(t => efectivos.find(e => e.legajo === t.legajo)?.tipo === 'Serv. General').length
  const destacamentoAsignados = todosLosTurnos.filter(t => efectivos.find(e => e.legajo === t.legajo)?.tipo === 'Destacamento').length
  const noUniformadosAsignados = servGeneralAsignados + destacamentoAsignados
  const pctSexo = n => todosLosTurnos.length ? `${Math.round(n / todosLosTurnos.length * 100)}%` : '—'
  // Igual que pctDispNum, para la barrita de los carteles "asignados".
  const pctSexoNum = n => todosLosTurnos.length ? Math.round(n / todosLosTurnos.length * 100) : 0

  // Pedido de esta ronda: cuántas guardias hacen falta cubrir este mes en
  // TOTAL (la suma de los cupos reales de cada sector/turno — los mismos
  // que usa maxSlot, con las excepciones de HIGA como Salud Mental 2d/1n o
  // Rondín Externo 0d/2n — multiplicada por los días del mes), cuántas de
  // esas ya están cubiertas (todosLosTurnos.length, ya se mostraba) y
  // cuántas faltan. Mismo criterio en horas (horas = guardias ×
  // HORAS_TURNO), para tener ambos juntos como pidió.
  const slotsPorDia = SECTORES_APP.reduce((acc, sector) => acc + TURNOS_LUGAR.reduce((acc2, turno) => acc2 + maxSlot(sector, turno), 0), 0)
  const guardiasNecesarias = slotsPorDia * DIAS_MES
  const guardiasSinCubrir = Math.max(0, guardiasNecesarias - todosLosTurnos.length)
  const horasNecesarias = guardiasNecesarias * HORAS_TURNO
  const horasSinCubrir = Math.max(0, horasNecesarias - horasAsignadas)
  const nombreCompleto = leg => { const e = efectivos.find(x => x.legajo === leg); return e ? e.nombre : leg }
  // Pedido de esta ronda ("no me especifica cuál de ellos, no pone
  // nombre"): con un padrón grande es común que dos efectivos compartan
  // apellido (p.ej. dos "Juárez") — mostrar SOLO el apellido en listas
  // compactas (horas, conflictos, "Disponibles", etc.) los vuelve
  // indistinguibles. Si hay OTRO efectivo con el mismo apellido, se
  // muestra el nombre completo para desambiguar; si el apellido es único
  // (el caso normal), se sigue mostrando solo el apellido, compacto, como
  // siempre — ningún cambio visible salvo donde de verdad hay ambigüedad.
  const nombreCorto = leg => {
    const nombre = nombreCompleto(leg)
    const apellido = nombre.split(',')[0]
    const hayOtroConMismoApellido = efectivos.some(x => x.legajo !== leg && (x.nombre || '').split(',')[0] === apellido)
    return hayOtroConMismoApellido ? nombre : apellido
  }

  // ── Carga administrativa de disponibilidad fuera de término ──
  // No reabre la ventana de inscripción general (eso seguiría afectando a
  // todos los demás efectivos): este flujo guarda SOLO la disponibilidad de
  // un efectivo/lugar/mes/año puntual, a través de un endpoint propio que
  // deja registro de auditoría y nunca toca la tabla de turnos.
  async function abrirDispAdmin(e) {
    setDispAdminResultado(null)
    setDispAdminMotivo('')
    setDispAdminPaso('editar')
    setModalDispAdmin({ legajo: e.legajo, nombre: e.nombre })
    setDispAdminCargando(true)
    try {
      const resp = await fetch(`/api/admin-disponibilidad-override?legajo=${encodeURIComponent(e.legajo)}&lugar=${lugarDetectado}&mes=${MES}&anio=${ANIO}`)
      const body = await resp.json()
      if (!resp.ok) {
        setDispAdminResultado({ ok: false, error: body.error || 'No se pudo cargar.' })
        setDispAdminCargando(false)
        return
      }
      setDispAdminDiasOriginal(body.dias_actuales || {})
      setDispAdminDias(body.dias_actuales || {})
      setDispAdminTurnosAsignados(body.turnos_asignados || [])
    } catch (err) {
      setDispAdminResultado({ ok: false, error: 'Error de conexión.' })
    }
    setDispAdminCargando(false)
  }

  function toggleDispAdminDia(dia, key) {
    setDispAdminDias(prev => {
      const actual = prev[dia] || ''
      const keys = actual.split('').filter(Boolean)
      const idx = keys.indexOf(key)
      const nuevasKeys = idx >= 0 ? keys.filter(k => k !== key) : [...keys, key].sort((a, b) => TURNOS_LUGAR.indexOf(a) - TURNOS_LUGAR.indexOf(b))
      const nuevo = nuevasKeys.join('')
      const next = { ...prev }
      if (!nuevo) delete next[dia]; else next[dia] = nuevo
      return next
    })
  }

  // Advertencias calculadas en pantalla (antes de guardar) comparando lo que
  // se está por guardar contra las guardias YA asignadas — el servidor
  // vuelve a calcularlas igual al guardar, esto es solo para que el
  // encargado las vea antes de confirmar.
  function advertenciasDispAdminPreview() {
    return dispAdminTurnosAsignados.filter(t => {
      const disp = dispAdminDias[t.dia] || ''
      return !disp.includes(t.turno)
    })
  }

  async function confirmarDispAdmin() {
    if (!modalDispAdmin) return
    setDispAdminGuardando(true)
    setDispAdminResultado(null)
    try {
      const resp = await fetch('/api/admin-disponibilidad-override', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          legajo: modalDispAdmin.legajo, lugar: lugarDetectado, mes: MES, anio: ANIO,
          dias: dispAdminDias, motivo: dispAdminMotivo || null, confirmar: true,
          // Lo que este formulario tenía al abrirse — si ya no coincide con
          // lo guardado en este momento (otro admin lo cambió mientras
          // tanto), el servidor rechaza el guardado en vez de pisarlo.
          dias_antes_esperado: dispAdminDiasOriginal,
        }),
      })
      const body = await resp.json()
      if (resp.status === 409 && body.conflicto) {
        setDispAdminDiasOriginal(body.dias_actuales || {})
        setDispAdminResultado({ ok: false, error: body.error, conflicto: true })
        setDispAdminPaso('editar')
      } else if (!resp.ok) {
        setDispAdminResultado({ ok: false, error: body.error || 'No se pudo guardar.' })
      } else {
        setDispAdminResultado({ ok: true, ...body })
        // Refleja el cambio en la vista de Disponibilidad sin esperar a
        // recargar todo.
        setDisponibilidad(prev => ({
          ...prev,
          [normLegajo(modalDispAdmin.legajo)]: Object.fromEntries(Object.entries(dispAdminDias).map(([dia, turno]) => [dia, { turno }]))
        }))
      }
    } catch (err) {
      setDispAdminResultado({ ok: false, error: 'Error de conexión. No se guardó — revisá e intentá de nuevo.' })
    }
    setDispAdminGuardando(false)
  }

  // ── Publicar guardias: separa el borrador de trabajo (turnos) de lo que
  // ve el efectivo. No toca turnos; solo crea una nueva versión publicada. ──
  async function abrirPublicar() {
    setPublicarResultado(null)
    setPublicarCargando(true)
    try {
      const resp = await fetch(`/api/publicar-guardias?lugar=${lugarDetectado}&mes=${MES}&anio=${ANIO}`)
      const body = await resp.json()
      setPublicarResumen(resp.ok ? body : { error: body.error || 'No se pudo calcular el resumen.' })
    } catch (err) {
      setPublicarResumen({ error: 'Error de conexión.' })
    }
    setPublicarCargando(false)
  }

  async function confirmarPublicar() {
    setPublicarCargando(true)
    setPublicarResultado(null)
    try {
      // version_base/hash_borrador tienen que ser EXACTAMENTE los que trajo
      // el resumen que el administrador está viendo en este momento (el GET
      // de abrirPublicar) — es lo que el servidor vuelve a comprobar, dentro
      // de la misma transacción y bajo un lock, antes de publicar de verdad.
      // Si faltan (por ejemplo, porque el resumen es de una versión vieja
      // del frontend que todavía no los conocía), no se manda la publicación
      // a ciegas: se pide recalcular el resumen primero.
      if (publicarResumen?.hash_borrador === undefined || publicarResumen?.hash_borrador === null) {
        setPublicarResultado({ ok: false, error: 'Falta recalcular el resumen antes de publicar. Volvé a abrir "Publicar guardias".' })
        setPublicarCargando(false)
        return
      }
      const resp = await fetch('/api/publicar-guardias', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lugar: lugarDetectado, mes: MES, anio: ANIO, confirmar: true,
          version_base: publicarResumen.version_base,
          hash_borrador: publicarResumen.hash_borrador,
        }),
      })
      const body = await resp.json()
      if (resp.ok) {
        setPublicarResultado({ ok: true, ...body })
      } else if (body.desactualizado) {
        // El resumen que se estaba mostrando ya no es el real (alguien
        // publicó mientras tanto, el borrador cambió, o esto es un
        // reintento/doble clic de una publicación que ya se hizo). Se
        // descarta el resumen viejo para que no se pueda reintentar con el
        // mismo version_base/hash_borrador — hay que recalcularlo.
        setPublicarResumen(null)
        setPublicarResultado({ ok: false, error: body.error || 'La información cambió desde que se generó el resumen. Volvé a abrir "Publicar guardias" para revisar el estado actual.' })
      } else {
        setPublicarResultado({ ok: false, error: body.error || 'No se pudo publicar.' })
      }
    } catch (err) {
      setPublicarResultado({ ok: false, error: 'Error de conexión. No se publicó — revisá e intentá de nuevo.' })
    }
    setPublicarCargando(false)
  }

  return (
    <div>
      {firmaEditando && (
        <FirmaEditorModal
          file={firmaEditando.file}
          onCancel={() => setFirmaEditando(null)}
          onConfirm={async (base64) => {
            await subirFirmaAdmin(firmaEditando.id, firmaEditando.legajo, base64)
            setFirmaEditando(null)
          }}
        />
      )}
      {modalTurno && <ModalTurno turno={modalTurno} efectivos={efectivos} horasAsig={horasAsig} onClose={() => setModalTurno(null)} onGuardar={handleGuardarEdicion} onEliminar={handleEliminarTurno} onAgregar={handleAgregarTurno} diasMes={DIAS_MES} mes={MES} anio={ANIO} turnosDelDia={todosLosTurnos.filter(t => t.dia === (modalTurno.dia || filtroDia))} />}
      {swapPendiente && <ModalElegirSwap pendiente={swapPendiente} nombreCompleto={nombreCompleto} onElegir={op => { setSwapPendiente(null); handleSwapTurno(swapPendiente.item, op) }} onCancelar={() => setSwapPendiente(null)} />}

      {modalDispAdmin && (
        <div style={{ position:'fixed',inset:0,background:'rgba(0,0,0,0.6)',zIndex:50,display:'flex',alignItems:'center',justifyContent:'center',padding:20 }}>
          <div style={{ background:'#13151f',borderRadius:12,border:'0.5px solid rgba(200,168,75,0.4)',width:'100%',maxWidth:560,maxHeight:'90vh',overflow:'auto' }}>
            <div style={{ padding:'14px 16px',borderBottom:'0.5px solid rgba(200,168,75,0.3)',display:'flex',justifyContent:'space-between',alignItems:'center',background:'rgba(200,168,75,0.06)',position:'sticky',top:0,zIndex:1 }}>
              <h3 style={{ fontSize:14,fontWeight:500,color:'#c8a84b' }}>✎ Disponibilidad fuera de término — {modalDispAdmin.nombre}</h3>
              <button className="btn btn-sm" onClick={() => { setModalDispAdmin(null); setDispAdminResultado(null) }}>Cerrar</button>
            </div>
            <div style={{ padding:16 }}>
              <div style={{ fontSize:11, color:'var(--text-muted)', marginBottom:12 }}>
                Leg. {modalDispAdmin.legajo} · {lugarDetectado} · {NOMBRE_MES}. Esto NO reabre la inscripción general: solo guarda la disponibilidad de esta persona para este período. No borra ni modifica guardias ya asignadas.
              </div>

              {dispAdminCargando ? (
                <div style={{ textAlign:'center', padding:20, color:'var(--text-muted)' }}>Cargando...</div>
              ) : dispAdminResultado?.ok ? (
                <div>
                  <div className="alert alert-ok" style={{ marginBottom:12 }}>
                    Disponibilidad guardada{dispAdminResultado.atomico === false ? ' (guardado paso a paso, no transaccional — ver aviso abajo)' : ''}.
                    {dispAdminResultado.auditoria_id != null && ` Auditoría #${dispAdminResultado.auditoria_id}.`}
                  </div>
                  {dispAdminResultado.aviso && <div className="alert alert-warn" style={{ marginBottom:12 }}>{dispAdminResultado.aviso}</div>}
                  {(dispAdminResultado.advertencias || []).length > 0 && (
                    <div className="alert alert-warn" style={{ marginBottom:12 }}>
                      <div style={{ fontWeight:600, marginBottom:6 }}>⚠ Guardias ya asignadas que quedan en contradicción (NO se tocaron):</div>
                      {dispAdminResultado.advertencias.map((a, i) => <div key={i} style={{ fontSize:11, marginBottom:4 }}>{a.detalle}</div>)}
                    </div>
                  )}
                  <button className="btn" style={{ width:'100%', justifyContent:'center' }} onClick={() => { setModalDispAdmin(null); setDispAdminResultado(null) }}>Cerrar</button>
                </div>
              ) : (
                <>
                  {dispAdminResultado?.error && <div className="alert alert-err" style={{ marginBottom:12 }}>{dispAdminResultado.error}</div>}

                  {dispAdminPaso === 'editar' && (
                    <>
                      <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginBottom:14 }}>
                        {Array.from({ length: DIAS_MES }, (_, i) => i + 1).map(dia => {
                          const esp = infoDiaEspecial(dia, MES, ANIO)
                          return (
                          <div key={dia} style={{ border: esp.marcar ? '0.5px solid #FFD700' : '0.5px solid rgba(255,255,255,0.1)', borderRadius:6, padding:'4px 6px', minWidth:46, textAlign:'center' }}>
                            <div style={{ fontSize:10, color: esp.marcar ? '#FFD700' : 'var(--text-muted)', fontWeight: esp.marcar ? 700 : 400, marginBottom:3 }}>{dia}</div>
                            <div style={{ display:'flex', gap:2, justifyContent:'center' }}>
                              {TURNOS_LUGAR.map(k => {
                                const activo = (dispAdminDias[dia] || '').includes(k)
                                return (
                                  <button key={k} type="button" onClick={() => toggleDispAdminDia(dia, k)}
                                    style={{ width:20, height:20, fontSize:9, fontWeight:700, borderRadius:4, cursor:'pointer',
                                      border: activo ? '1px solid #c8a84b' : '1px solid rgba(255,255,255,0.15)',
                                      background: activo ? 'rgba(200,168,75,0.3)' : 'rgba(255,255,255,0.04)',
                                      color: activo ? '#c8a84b' : 'var(--text-muted)' }}>
                                    {k.toUpperCase()}
                                  </button>
                                )
                              })}
                            </div>
                          </div>
                          )
                        })}
                      </div>

                      <div style={{ marginBottom:14 }}>
                        <label style={{ fontSize:12, color:'var(--text-muted)', display:'block', marginBottom:5 }}>Motivo (opcional, queda en la auditoría)</label>
                        <input type="text" value={dispAdminMotivo} onChange={e => setDispAdminMotivo(e.target.value)} placeholder="Ej: no llegó a cargar por licencia"
                          style={{ width:'100%', padding:'8px 10px', border:'0.5px solid rgba(255,255,255,0.12)', borderRadius:6, fontSize:13, background:'#1e2130', color:'#e8eaf0', outline:'none' }} />
                      </div>

                      <button className="btn" style={{ width:'100%', justifyContent:'center', background:'rgba(200,168,75,0.15)', color:'#c8a84b', border:'0.5px solid rgba(200,168,75,0.4)' }}
                        onClick={() => setDispAdminPaso('confirmar')}>
                        Ver cambios antes de confirmar →
                      </button>
                    </>
                  )}

                  {dispAdminPaso === 'confirmar' && (() => {
                    const diasAntes = Object.keys(dispAdminDiasOriginal).map(Number).sort((a,b)=>a-b)
                    const diasDespues = Object.keys(dispAdminDias).map(Number).sort((a,b)=>a-b)
                    const advertencias = advertenciasDispAdminPreview()
                    return (
                      <div>
                        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:14 }}>
                          <div>
                            <div style={{ fontSize:11, color:'var(--text-muted)', marginBottom:6 }}>Antes ({diasAntes.length} días)</div>
                            <div style={{ fontSize:12 }}>{diasAntes.length ? diasAntes.map(d => `${d}(${dispAdminDiasOriginal[d]})`).join(', ') : '— sin disponibilidad cargada —'}</div>
                          </div>
                          <div>
                            <div style={{ fontSize:11, color:'#c8a84b', marginBottom:6 }}>Después ({diasDespues.length} días)</div>
                            <div style={{ fontSize:12 }}>{diasDespues.length ? diasDespues.map(d => `${d}(${dispAdminDias[d]})`).join(', ') : '— sin disponibilidad —'}</div>
                          </div>
                        </div>
                        {advertencias.length > 0 && (
                          <div className="alert alert-warn" style={{ marginBottom:14 }}>
                            <div style={{ fontWeight:600, marginBottom:6 }}>⚠ Esto contradice {advertencias.length} guardia(s) ya asignada(s). NO se van a borrar ni reasignar solas — quedan así hasta que decidas qué hacer manualmente.</div>
                            {advertencias.map((a, i) => (
                              <div key={i} style={{ fontSize:11, marginBottom:3 }}>Día {a.dia} — turno {a.turno} — {a.sector}</div>
                            ))}
                          </div>
                        )}
                        <div style={{ display:'flex', gap:8 }}>
                          <button className="btn btn-sm" style={{ flex:1, justifyContent:'center' }} onClick={() => setDispAdminPaso('editar')} disabled={dispAdminGuardando}>← Volver a editar</button>
                          <button className="btn btn-success" style={{ flex:1, justifyContent:'center' }} onClick={confirmarDispAdmin} disabled={dispAdminGuardando}>
                            {dispAdminGuardando ? 'Guardando...' : 'Confirmar y guardar'}
                          </button>
                        </div>
                      </div>
                    )
                  })()}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {mostrarModalPublicar && (
        <div style={{ position:'fixed',inset:0,background:'rgba(0,0,0,0.6)',zIndex:50,display:'flex',alignItems:'center',justifyContent:'center',padding:20 }}>
          <div style={{ background:'#13151f',borderRadius:12,border:'0.5px solid rgba(200,168,75,0.4)',width:'100%',maxWidth:520,maxHeight:'90vh',overflow:'auto' }}>
            <div style={{ padding:'14px 16px',borderBottom:'0.5px solid rgba(200,168,75,0.3)',display:'flex',justifyContent:'space-between',alignItems:'center',background:'rgba(200,168,75,0.06)',position:'sticky',top:0 }}>
              <h3 style={{ fontSize:14,fontWeight:500,color:'#c8a84b' }}>📣 Publicar guardias — {APP_LUGAR} · {NOMBRE_MES}</h3>
              <button className="btn btn-sm" onClick={() => setMostrarModalPublicar(false)}>Cerrar</button>
            </div>
            <div style={{ padding:16 }}>
              {publicarCargando && <div style={{ textAlign:'center', padding:20, color:'var(--text-muted)' }}>Calculando...</div>}

              {!publicarCargando && publicarResultado?.ok && (
                <div>
                  <div className="alert alert-ok" style={{ marginBottom:12 }}>
                    Publicado — versión {publicarResultado.version}. Los efectivos ya pueden ver esta versión de sus guardias.
                  </div>
                  {publicarResultado.efectivos_afectados?.length > 0 && (
                    <div style={{ marginBottom:12 }}>
                      <div style={{ fontSize:12, color:'var(--text-muted)', marginBottom:6 }}>Efectivos para volver a avisar (cambió algo para ellos):</div>
                      <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
                        {publicarResultado.efectivos_afectados.map(a => (
                          <span key={a.legajo} style={{ fontSize:11, padding:'3px 8px', borderRadius:4, background:'rgba(200,168,75,0.12)', color:'#c8a84b', border:'0.5px solid rgba(200,168,75,0.3)' }}>
                            {nombreCorto(a.legajo)} ({a.tipo_cambio})
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  <button className="btn" style={{ width:'100%', justifyContent:'center' }} onClick={() => setMostrarModalPublicar(false)}>Cerrar</button>
                </div>
              )}

              {!publicarCargando && !publicarResultado?.ok && (
                <>
                  {publicarResultado?.error && (
                    <div className="alert alert-err" style={{ marginBottom:12 }}>
                      {publicarResultado.error}
                    </div>
                  )}
                  {publicarResultado?.error && !publicarResumen && (
                    <button className="btn" style={{ width:'100%', justifyContent:'center', marginBottom:12 }} onClick={abrirPublicar} disabled={publicarCargando}>
                      Volver a revisar
                    </button>
                  )}
                  {publicarResumen?.error && <div className="alert alert-err" style={{ marginBottom:12 }}>{publicarResumen.error}</div>}
                  {publicarResumen && !publicarResumen.error && (
                    <div>
                      <div style={{ fontSize:12, color:'var(--text-muted)', marginBottom:10 }}>
                        {publicarResumen.version_anterior
                          ? `Ya existe una publicación previa (versión ${publicarResumen.version_anterior}, ${new Date(publicarResumen.publicado_anteriormente_en).toLocaleString('es-AR')}). Esto va a crear la versión ${publicarResumen.version_anterior + 1}.`
                          : 'Todavía no hay ninguna publicación para este lugar/mes/año. Esto va a crear la versión 1.'}
                      </div>
                      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:12 }}>
                        <div style={{ background:'rgba(255,255,255,0.03)', borderRadius:8, padding:10 }}>
                          <div style={{ fontSize:10, color:'var(--text-muted)' }}>Turnos en el borrador ahora</div>
                          <div style={{ fontSize:18, fontWeight:600 }}>{publicarResumen.total_turnos_actuales}</div>
                        </div>
                        <div style={{ background:'rgba(255,255,255,0.03)', borderRadius:8, padding:10 }}>
                          <div style={{ fontSize:10, color:'var(--text-muted)' }}>Turnos en la última versión publicada</div>
                          <div style={{ fontSize:18, fontWeight:600 }}>{publicarResumen.total_turnos_version_anterior}</div>
                        </div>
                      </div>
                      {publicarResumen.efectivos_afectados.length === 0 ? (
                        <div className="alert alert-warn" style={{ marginBottom:14 }}>No hay cambios respecto a la última publicación — igual se puede publicar para dejar constancia.</div>
                      ) : (
                        <div style={{ marginBottom:14 }}>
                          <div style={{ fontSize:12, color:'var(--text-muted)', marginBottom:6 }}>{publicarResumen.efectivos_afectados.length} efectivo(s) con cambios:</div>
                          <div style={{ display:'flex', flexWrap:'wrap', gap:6, maxHeight:140, overflow:'auto' }}>
                            {publicarResumen.efectivos_afectados.map(a => (
                              <span key={a.legajo} style={{ fontSize:11, padding:'3px 8px', borderRadius:4, background:'rgba(255,255,255,0.05)', color:'var(--text)', border:'0.5px solid rgba(255,255,255,0.1)' }}>
                                {nombreCorto(a.legajo)} ({a.tipo_cambio})
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      <button className="btn btn-success" style={{ width:'100%', justifyContent:'center' }} onClick={confirmarPublicar} disabled={publicarCargando}>
                        Confirmar y publicar
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

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

      <div className="topbar" style={{ display:'block', padding:0 }}>
        <div style={{ display:'flex',justifyContent:'space-between',alignItems:'center',padding:'12px 20px',flexWrap:'wrap',gap:10 }}>
          <div style={{ display:'flex',alignItems:'center',gap:14 }}>
            <span style={{ fontSize:23,fontWeight:700,letterSpacing:'0.04em' }}>POLAD</span>
            <div style={{ display:'flex',flexDirection:'column',lineHeight:1.2 }}>
              <span style={{ fontSize:11,color:COLOR_APP,letterSpacing:'0.1em',fontWeight:600 }}>DESTINO</span>
              <span style={{ fontSize:18,fontWeight:700 }}>{APP_LUGAR}</span>
            </div>
            <span style={{ display:'flex',alignItems:'center',gap:6,fontSize:15,color:'#b7bcc9',borderLeft:'0.5px solid rgba(255,255,255,0.15)',paddingLeft:14,marginLeft:2 }}>📊 Panel de administración</span>
          </div>
          <div style={{ display:'flex',alignItems:'center',gap:8 }}>
            <div style={{ display:'flex',alignItems:'center',gap:4,background:'rgba(255,255,255,0.05)',borderRadius:6,padding:'4px 8px',border:'0.5px solid rgba(255,255,255,0.1)' }}>
              <select value={mesSeleccionado} disabled={mesBloqueado} onChange={e => { setMesSeleccionado(parseInt(e.target.value)); setPlanillaEf(null) }} style={{ background:'transparent',border:'none',color:'#c8a84b',fontSize:14,fontWeight:600,outline:'none',cursor: mesBloqueado ? 'not-allowed' : 'pointer' }}>
                {MESES_NOMBRES.map((m,i) => <option key={i+1} value={i+1} style={{ background:'#1a1d27' }}>{m}</option>)}
              </select>
              <select value={anioSeleccionado} disabled={mesBloqueado} onChange={e => { setAnioSeleccionado(parseInt(e.target.value)); setPlanillaEf(null) }} style={{ background:'transparent',border:'none',color:'#c8a84b',fontSize:14,fontWeight:600,outline:'none',cursor: mesBloqueado ? 'not-allowed' : 'pointer' }}>
                {[ANIO_ACTUAL, ANIO_ACTUAL+1].map(a => <option key={a} value={a} style={{ background:'#1a1d27' }}>{a}</option>)}
              </select>
              <button onClick={toggleBloqueoMes}
                title={mesBloqueado ? `Mes bloqueado en ${NOMBRE_MES} — click para desbloquear` : 'Bloquear este mes (no se va a cambiar solo al entrar y salir)'}
                style={{ background:'transparent', border:'none', cursor:'pointer', fontSize:15, padding:'0 2px', opacity: mesBloqueado ? 1 : 0.55 }}>
                {mesBloqueado ? '🔒' : '🔓'}
              </button>
            </div>
            <button className="btn btn-sm" style={{ color:'#b7bcc9',fontSize:14 }} onClick={() => { localStorage.removeItem('polad_user'); router.push('/') }}>↪ Salir</button>
          </div>
        </div>
        <div style={{ display:'flex',gap:2,padding:'0 16px',borderBottom:'0.5px solid rgba(255,255,255,0.08)',flexWrap:'wrap' }}>
          {[
            { v:'resumen', icon:'📊', label:'Resumen' },
            { v:'personal', icon:'👥', label:'Personal' },
            { v:'disponibilidad', icon:'📅', label:'Disponibilidad' },
            { v:'turnos', icon:'🛡️', label:'Guardias' },
            { v:'edicion', icon:'✏️', label:'Edición manual' },
            { v:'rapida', icon:'⚡', label:'Asignación rápida' },
          ].map(item => (
            <button key={item.v} onClick={() => setVista(item.v)} style={{ display:'flex',alignItems:'center',gap:7,padding:'11px 14px',background:'transparent',border:'none',borderBottom:vista===item.v?'2px solid #2DD4BF':'2px solid transparent',color:vista===item.v?'#2DD4BF':'#b7bcc9',fontSize:15,fontWeight:vista===item.v?700:500,cursor:'pointer' }}>
              <span>{item.icon}</span>{item.label}
            </button>
          ))}
        </div>
        <div style={{ display:'flex',gap:22,padding:'10px 16px',flexWrap:'wrap' }}>
          {[
            { v:'buscarLegajo', icon:'🔍', label:'Buscar legajo' },
            { v:'config', icon:'⚙️', label:'Configuración' },
            { v:'planillas', icon:'🗓️', label:'Planillas' },
            { v:'descarga', icon:'📋', label:'Planilla Guardia' },
          ].map(item => (
            <button key={item.v} onClick={() => setVista(item.v)} style={{ display:'flex',alignItems:'center',gap:6,background:'transparent',border:'none',color:vista===item.v?'#c8a84b':'#b7bcc9',fontSize:14,fontWeight:vista===item.v?600:500,cursor:'pointer',padding:0 }}>
              <span>{item.icon}</span>{item.label}
            </button>
          ))}
          <button onClick={() => router.push('/control')} style={{ display:'flex',alignItems:'center',gap:6,background:'transparent',border:'none',color:'#b7bcc9',fontSize:14,fontWeight:500,cursor:'pointer',padding:0 }}>
            <span>👤</span>Control asistencia
          </button>
        </div>
      </div>

      <div className="content">
        <div style={{ display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:16 }}>
          <div>
            <h2 style={{ fontSize:28,fontWeight:700,color:'#fff',margin:0 }}>Resumen del mes</h2>
            <p style={{ fontSize:15,color:'#c8a84b',margin:'4px 0 0' }}>{APP_LUGAR} · {NOMBRE_MES}</p>
          </div>
          <div style={{ display:'flex',alignItems:'center',gap:6,background:hayTurnos?'rgba(29,158,117,0.15)':'rgba(200,168,75,0.15)',border:hayTurnos?'0.5px solid rgba(29,158,117,0.4)':'0.5px solid rgba(200,168,75,0.4)',color:hayTurnos?'#1D9E75':'#c8a84b',borderRadius:8,padding:'7px 14px',fontSize:14,fontWeight:600 }}>
            <span>{hayTurnos?'✅':'⏱'}</span>{hayTurnos?'Generado':'Sin generar'}
          </div>
        </div>
        {/* Pedido de esta ronda ("los carteles se ven mezclados" → 3
            ejemplos (A/B/C) con la misma grilla de cajitas de siempre, pero
            el usuario pidió "algo distinto y nuevo, moderno" → Opción D:
            una franja resumen arriba, y 2 tarjetas anchas abajo con barras
            SEGMENTADAS (no más cajitas sueltas por cada %) para el
            desglose por sexo/tipo.
            Ajustes pedidos después sobre la Opción D:
            - cada número lleva una "placa" (chip) de color sólido propio
              ("más llamativo" — Opción A de varias mostradas), femenino en
              rosa para distinguirlo del masculino; "No uniformados" en
              naranja coral (antes gris — "no le has puesto nada" — ahora
              tiene un color propio, distinto de todos los demás).
            - ORDEN pedido explícitamente (este es el orden final, no
              cambiarlo sin que lo pidan de nuevo): 1) Guardias a cubrir
              junto con Horas a cubrir, 2) Cargaron disponibilidad (sola,
              más grande — resume a las demás), 3) Femeninas junto con
              Masculinos (femenino primero), 4) Uniformados junto con No
              uniformados.
            - cada PAR va siempre junto en la misma fila — nunca un tema en
              una punta de una fila y su contraparte en la otra.
            "Guardias a cubrir" ya no se repite más abajo (quedaba
            duplicado con el de esta franja) — "Guardias sin cubrir" y
            "Horas sin cubrir" siguen abajo, que es información distinta
            (lo que todavía falta, no el total).
            La tarjeta "Turnos asignados" ahora también tiene su barra "Por
            tipo" (antes solo tenía "Por sexo"), para que tenga la misma
            estructura que "Disponibilidad cargada". */}
        {(() => {
          // Texto oscuro o claro según qué tan clara sea la placa de color
          // de fondo — así funciona bien con CUALQUIER color (incluido
          // COLOR_APP, que cambia según HIGA/UPA/MODULAR) sin tener que
          // elegir el contraste a mano para cada uno.
          const contraste = hex => {
            const h = hex.replace('#', '')
            const r = parseInt(h.substring(0,2),16), g = parseInt(h.substring(2,4),16), b = parseInt(h.substring(4,6),16)
            const lum = (0.299*r + 0.587*g + 0.114*b) / 255
            return lum > 0.6 ? '#0f1117' : '#ffffff'
          }
          const segBar = { display:'flex', height:20, borderRadius:10, overflow:'hidden', background:'rgba(255,255,255,0.05)', gap:2 }
          const seg = (pct, color, label, lightText) => (
            <div style={{ width:`${pct}%`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:11.5, fontWeight:600, color: lightText?'#fff':'#0f1117', background:color, whiteSpace:'nowrap', overflow:'hidden' }}>{label}</div>
          )
          const legendItem = (color, label) => (
            <div style={{ display:'flex', alignItems:'center', gap:6, fontSize:12.5, color:'#a3a8ba' }}><span style={{ width:8, height:8, borderRadius:2, background:color, flexShrink:0 }} />{label}</div>
          )
          const AZUL_M = '#5B9BD5', ROSA_F = '#E8829E', SERVGRAL = '#5DCAA5', DESTACAMENTO = '#F5C518', NO_UNIFORME = '#E8935A', DORADO = '#c8a84b', ROJO_ALERTA = '#E35B5B'
          const noUniformado = cargaronServGeneral + cargaronDestacamento
          // Pedido de esta ronda ("no estoy visualizando uniformidad, hay
          // mucho espacio, mala distribución... abajo hay dos cosas que
          // tienen los diseños anteriores"): las cajitas grises .metric de
          // "Guardias/Horas sin cubrir" quedaban como un tercer lenguaje
          // visual distinto (las cajas viejas del dashboard original).
          // Ahora todo el resumen usa el MISMO componente ("fila par" con
          // chip a la derecha, en vez de chip+texto apilado con mucho aire
          // alrededor), y "sin cubrir" entra como una fila más (en rojo,
          // para que se note que es una alerta) — opción 2 ("en filas") de
          // las 2 mostradas, elegida por el usuario.
          const pairWrap = { display:'flex', borderRadius:12, overflow:'hidden', marginBottom:8, background:'rgba(255,255,255,0.025)' }
          const item = (icono, label, sub, bg, val, chipSize = 20, conBorde = false) => (
            <div style={{ flex:1, display:'flex', alignItems:'center', gap:12, padding:'11px 16px', borderLeft: conBorde ? '1px solid rgba(255,255,255,0.11)' : 'none' }}>
              <div style={{ display:'flex', flexDirection:'column', gap:2, flex:1, minWidth:0 }}>
                <div style={{ fontSize:12, color:'#9aa0b5', display:'flex', alignItems:'center', gap:6, whiteSpace:'nowrap' }}><span>{icono}</span>{label}</div>
                <div style={{ fontSize:11, color:'#a3a8ba' }}>{sub}</div>
              </div>
              <div style={{ display:'inline-flex', alignItems:'center', borderRadius:8, padding:'3px 12px', flexShrink:0, background:bg }}>
                <span style={{ fontWeight:800, lineHeight:1.3, fontSize:chipSize, color:contraste(bg) }}>{val}</span>
              </div>
            </div>
          )
          return (<>
            <div style={pairWrap}>
              {item('📋', 'Guardias a cubrir', NOMBRE_MES, DORADO, guardiasNecesarias)}
              {item('⌛', 'Horas a cubrir', NOMBRE_MES, DORADO, horasNecesarias, 20, true)}
            </div>

            <div style={pairWrap}>
              {item('📅', 'Cargaron disponibilidad', `de ${efectivos.length} efectivos`, '#2DD4BF', cargaron, 22)}
            </div>

            <div style={{ borderTop:'0.5px solid rgba(255,255,255,0.11)', margin:'12px 0 10px' }} />

            <div style={pairWrap}>
              {item('♀', 'Femeninos', `${pctDisp(cargaronFemenino)} de los que cargaron`, ROSA_F, cargaronFemenino)}
              {item('♂', 'Masculinos', `${pctDisp(cargaronMasculino)} de los que cargaron`, AZUL_M, cargaronMasculino, 20, true)}
            </div>

            <div style={pairWrap}>
              {item('🎖️', 'Uniformados', `${pctDisp(cargaronUniformado)} de los que cargaron`, COLOR_APP, cargaronUniformado)}
              {item('🧰', 'No uniformados', `${pctDisp(noUniformado)} de los que cargaron`, NO_UNIFORME, noUniformado, 20, true)}
            </div>

            <div style={{ ...pairWrap, marginBottom:20 }}>
              {item('⏳', 'Guardias sin cubrir', `de ${guardiasNecesarias} necesarias`, ROJO_ALERTA, guardiasSinCubrir)}
              {item('⌛', 'Horas sin cubrir', `de ${horasNecesarias} hs necesarias`, ROJO_ALERTA, horasSinCubrir, 20, true)}
            </div>

            <div style={{ background:'#262a38', border:'0.5px solid rgba(255,255,255,0.11)', borderRadius:14, padding:'18px 20px', marginBottom:14 }}>
              <div style={{ fontSize:14, fontWeight:600, color:'#e8eaf0', display:'flex', alignItems:'center', gap:8, marginBottom:14 }}>Disponibilidad cargada <span style={{ color:'#7a8099', fontWeight:400, fontSize:12.5 }}>— {cargaron} efectivos</span></div>
              <div style={{ marginBottom:16 }}>
                <div style={{ fontSize:11, color:'#7a8099', textTransform:'uppercase', letterSpacing:'.05em', marginBottom:7 }}>Por sexo</div>
                <div style={segBar}>
                  {seg(pctDispNum(cargaronMasculino), AZUL_M, `${cargaronMasculino} · ${pctDisp(cargaronMasculino)}`, true)}
                  {seg(pctDispNum(cargaronFemenino), ROSA_F, `${cargaronFemenino} · ${pctDisp(cargaronFemenino)}`, false)}
                </div>
                <div style={{ display:'flex', gap:18, marginTop:9, flexWrap:'wrap' }}>
                  {legendItem(AZUL_M, '♂ Masculinos')}
                  {legendItem(ROSA_F, '♀ Femeninos')}
                </div>
              </div>
              <div>
                <div style={{ fontSize:11, color:'#7a8099', textTransform:'uppercase', letterSpacing:'.05em', marginBottom:7 }}>Por tipo</div>
                <div style={segBar}>
                  {seg(pctDispNum(cargaronUniformado), COLOR_APP, `${cargaronUniformado} · ${pctDisp(cargaronUniformado)}`, false)}
                  {seg(pctDispNum(cargaronServGeneral), SERVGRAL, `${cargaronServGeneral} · ${pctDisp(cargaronServGeneral)}`, true)}
                  {seg(pctDispNum(cargaronDestacamento), DESTACAMENTO, `${cargaronDestacamento} · ${pctDisp(cargaronDestacamento)}`, false)}
                </div>
                <div style={{ display:'flex', gap:18, marginTop:9, flexWrap:'wrap' }}>
                  {legendItem(COLOR_APP, '🎖️ Uniformados')}
                  {legendItem(SERVGRAL, '🧰 Serv. General')}
                  {legendItem(DESTACAMENTO, '📍 Destacamento')}
                </div>
              </div>
            </div>

            <div style={{ background:'#262a38', border:'0.5px solid rgba(255,255,255,0.11)', borderRadius:14, padding:'18px 20px', marginBottom:16 }}>
              <div style={{ fontSize:14, fontWeight:600, color:'#e8eaf0', display:'flex', alignItems:'center', gap:8, marginBottom:14 }}>Turnos asignados <span style={{ color:'#7a8099', fontWeight:400, fontSize:12.5 }}>— {todosLosTurnos.length} turnos · {horasAsignadas} horas ({HORAS_TURNO} hs/guardia)</span></div>
              <div style={{ marginBottom:16 }}>
                <div style={{ fontSize:11, color:'#7a8099', textTransform:'uppercase', letterSpacing:'.05em', marginBottom:7 }}>Por sexo</div>
                <div style={segBar}>
                  {seg(pctSexoNum(masculinosAsignados), AZUL_M, `${masculinosAsignados} · ${pctSexo(masculinosAsignados)}`, true)}
                  {seg(pctSexoNum(femeninosAsignados), ROSA_F, `${femeninosAsignados} · ${pctSexo(femeninosAsignados)}`, false)}
                </div>
                <div style={{ display:'flex', gap:18, marginTop:9, flexWrap:'wrap' }}>
                  {legendItem(AZUL_M, '♂ Masculinos')}
                  {legendItem(ROSA_F, '♀ Femeninos')}
                </div>
              </div>
              <div>
                <div style={{ fontSize:11, color:'#7a8099', textTransform:'uppercase', letterSpacing:'.05em', marginBottom:7 }}>Por tipo</div>
                <div style={segBar}>
                  {seg(pctSexoNum(uniformadosAsignados), COLOR_APP, `${uniformadosAsignados} · ${pctSexo(uniformadosAsignados)}`, false)}
                  {seg(pctSexoNum(servGeneralAsignados), SERVGRAL, `${servGeneralAsignados} · ${pctSexo(servGeneralAsignados)}`, true)}
                  {seg(pctSexoNum(destacamentoAsignados), DESTACAMENTO, `${destacamentoAsignados} · ${pctSexo(destacamentoAsignados)}`, false)}
                </div>
                <div style={{ display:'flex', gap:18, marginTop:9, flexWrap:'wrap' }}>
                  {legendItem(COLOR_APP, '🎖️ Uniformados')}
                  {legendItem(SERVGRAL, '🧰 Serv. General')}
                  {legendItem(DESTACAMENTO, '📍 Destacamento')}
                </div>
              </div>
            </div>
          </>)
        })()}
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
            const dias = Object.keys(disponibilidad[normLegajo(e.legajo)] || {}).length
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
          // Punto 1 de esta ronda: filtro por sexo, sin inferirlo del
          // nombre — 'todos' (default) no filtra nada, igual que antes.
          const porSexo = e => filtroSexo === 'todos' || (e.sexo || 'sin_informar') === filtroSexo
          const uniformados = efectivos.filter(e => e.tipo === 'Uniformado' && porSexo(e))
          const servGeneral = efectivos.filter(e => e.tipo === 'Serv. General' && porSexo(e))
          const destacamento = efectivos.filter(e => e.tipo === 'Destacamento' && porSexo(e))
          const renderFichas = lista => lista.map(e => {
            const hs = horasAsig[e.legajo] || 0
            const pct = Math.round(hs / 180 * 100)
            const color = pct >= 100 ? '#E24B4A' : pct >= 80 ? '#EF9F27' : '#1D9E75'
            const turnosEf = turnos[e.legajo] || []
            const iniciales = e.nombre.split(',').map(p => p.trim()[0]).join('').toUpperCase().slice(0, 2)
            // Punto 9 de esta ronda: estado persistente en servidor
            // (whatsappAvisos), independiente por lugar/mes/año — nunca el
            // Map de localStorage de antes. 'confirmado' = el administrador
            // confirmó EXPRESAMENTE que envió el mensaje; 'abierto' = solo
            // se hizo click en el link de wa.me, todavía no se confirmó.
            const avisoEf = whatsappAvisos[e.legajo] || {}
            // Corrección de esta ronda ("Confirmación de WhatsApp"): el
            // fingerprint del contenido que ESTA pantalla tiene cargado
            // para este efectivo ahora mismo — se manda tal cual al
            // "abrir" y al "confirmar" (ver fingerprintTurnos más arriba),
            // para que el servidor pueda rechazar la operación si no
            // coincide con lo vigente (pantalla desactualizada).
            const fpActualEf = fingerprintTurnos(turnosPublicadosPorLegajo[e.legajo] || [])
            const avisoConfirmado = avisoEf.estado === 'confirmado'
            const avisoAbiertoSinConfirmar = !avisoConfirmado && !!avisoEf.abierto_en
            return (
              <div key={e.legajo} className="card" style={{ padding:0, overflow:'hidden', cursor:'pointer', border: avisoConfirmado ? '0.5px solid rgba(29,158,117,0.4)' : avisoAbiertoSinConfirmar ? '0.5px solid rgba(239,159,39,0.4)' : undefined }} onClick={() => { setMsgPersonal(null); setModalPersonal({ ...e }) }}>
                {avisoConfirmado && (() => {
                  const d = new Date(avisoEf.confirmado_en)
                  const hora = d.toLocaleTimeString('es-AR', { hour:'2-digit', minute:'2-digit' })
                  const dia = d.toLocaleDateString('es-AR', { day:'numeric', month:'long' })
                  return (
                    <div style={{ background:'rgba(29,158,117,0.1)', borderBottom:'0.5px solid rgba(29,158,117,0.2)', padding:'5px 12px', display:'flex', alignItems:'center', gap:6 }} onClick={ev=>ev.stopPropagation()}>
                      <span style={{ fontSize:13, color:'#1D9E75' }}>✓</span>
                      <span style={{ fontSize:10, fontWeight:500, color:'#1D9E75', flex:1 }}>Envío confirmado el {dia} a las {hora}</span>
                      <button onClick={ev=>{ev.stopPropagation();desmarcarAviso(e.legajo)}} style={{ fontSize:9, color:'var(--text-muted)', background:'none', border:'none', cursor:'pointer', textDecoration:'underline', padding:0 }}>desmarcar</button>
                    </div>
                  )
                })()}
                {avisoAbiertoSinConfirmar && (
                  <div style={{ background:'rgba(239,159,39,0.08)', borderBottom:'0.5px solid rgba(239,159,39,0.2)', padding:'5px 12px', display:'flex', alignItems:'center', gap:6 }} onClick={ev=>ev.stopPropagation()}>
                    <span style={{ fontSize:13, color:'#EF9F27' }}>⏳</span>
                    <span style={{ fontSize:10, fontWeight:500, color:'#EF9F27', flex:1 }}>WhatsApp abierto — falta confirmar el envío</span>
                    <button onClick={ev=>{ev.stopPropagation();confirmarAviso(e.legajo, fpActualEf)}} style={{ fontSize:9, color:'#1D9E75', background:'none', border:'none', cursor:'pointer', textDecoration:'underline', padding:0 }}>confirmar envío</button>
                  </div>
                )}
                <div style={{ padding:'12px 14px',borderBottom:'0.5px solid rgba(255,255,255,0.06)',display:'flex',alignItems:'center',gap:12 }}>
                  <div style={{ width:40,height:40,borderRadius:'50%',background:'rgba(200,168,75,0.15)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:13,fontWeight:500,color:'#c8a84b',flexShrink:0 }}>{iniciales}</div>
                  <div style={{ flex:1,minWidth:0 }}>
                    <div style={{ fontWeight:500,fontSize:12,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',display:'flex',alignItems:'center',gap:5 }}>
                      {e.nombre}{e.notas && <span title={e.notas} style={{ fontSize:13,cursor:'help' }}>📝</span>}
                    </div>
                    <div style={{ fontSize:10,color:'var(--text-muted)',marginTop:2 }}>
                      Leg. {e.legajo} · {e.jerarquia || e.tipo}
                      {e.sexo && e.sexo !== 'sin_informar' && <span> · {e.sexo === 'femenino' ? 'F' : 'M'}</span>}
                    </div>
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
                  {/* El mensaje de WhatsApp usa SOLO guardias publicadas — nunca el
                      borrador — y nunca se manda solo: siempre es un click manual
                      del administrador sobre un link de wa.me. */}
                  {e.telefono && !publicacionVigenteInfo.publicado && turnosEf.length > 0 && (
                    <div style={{ fontSize:10, color:'var(--text-hint)', fontStyle:'italic', padding:'6px 2px' }}>
                      Todavía no se publicaron las guardias de este período — publicalas (pestaña Guardias) para poder avisar por WhatsApp.
                    </div>
                  )}
                  {/* Corrección de esta ronda ("Permitir comunicar que se
                      retiraron todas las guardias de un efectivo"): antes
                      esto se condicionaba a que tuviera guardias publicadas
                      (turnosPublicadosPorLegajo[...].length > 0) — si a un
                      efectivo se le retiraban TODAS las guardias publicadas
                      (quedaba en 0), la acción de WhatsApp desaparecía por
                      completo y nunca se podía avisar justamente eso. Ahora
                      se muestra apenas exista una fila de seguimiento para
                      este efectivo/mes/año (whatsappAvisos[e.legajo] —
                      fn_whatsapp_sincronizar_tras_publicar ya la crea para
                      todo efectivo con una publicación vigente, tenga o no
                      guardias en ella), y el texto del mensaje (más abajo)
                      distingue el caso de 0 guardias. */}
                  {e.telefono && publicacionVigenteInfo.publicado && !!whatsappAvisos[e.legajo] && (
                    avisoConfirmado
                    ? <div style={{ display:'flex', alignItems:'center', gap:8, padding:'7px 12px', borderRadius:6, border:'0.5px solid rgba(29,158,117,0.3)', background:'rgba(29,158,117,0.07)', opacity:0.8 }}>
                        <span style={{ fontSize:14, color:'#1D9E75' }}>✓</span>
                        <span style={{ fontSize:11, fontWeight:500, color:'#1D9E75', flex:1 }}>Mensaje enviado (confirmado)</span>
                        <span style={{ fontSize:14, color:'#1D9E75', opacity:0.5 }}>📱</span>
                      </div>
                    : <div style={{ display:'flex', flexDirection:'column', gap:6 }} onClick={ev=>ev.stopPropagation()}>
                        {/* Abrir WhatsApp (mecanismo de envío SIN CAMBIOS: mismo
                            link wa.me con el mismo texto precargado) ya NO
                            marca "enviado" por sí solo — solo registra
                            abierto_en (punto 9: "abrir no equivale a
                            enviar"). La confirmación es una acción aparte,
                            explícita, del administrador. */}
                        <a href={(() => {
                          const tel = '549' + e.telefono.replace(/\D/g,'')
                          const jerarquia = e.jerarquia ? e.jerarquia + ' ' : ''
                          const nombreFormateado = e.nombre.split(',').map(p => p.trim()).reverse().join(' ')
                          const ts = [...(turnosPublicadosPorLegajo[e.legajo]||[])].sort((a,b) => a.dia - b.dia)
                          const subtotal = ts.length * HORAS_TURNO
                          // Corrección de esta ronda: si no tiene NINGUNA
                          // guardia publicada este período (p.ej. se le
                          // retiraron todas las que tenía), el mensaje ya
                          // no arma una lista vacía + "Total: 0 hs" (que se
                          // leía como un error) — comunica EXPLÍCITAMENTE
                          // que no tiene guardias asignadas este mes.
                          const cuerpo = ts.length === 0
                            ? `Se le informa que NO tiene guardias asignadas en el cronograma POLAD *${APP_LUGAR}* para *${encodeURIComponent(NOMBRE_MES.toUpperCase())}*.`
                            : (() => {
                                const lineas = ts.map(t => { const ti = TURNOS_INFO.find(x=>x.key===t.turno); return `   %E2%80%A2 D%C3%ADa ${t.dia} %E2%80%94 ${encodeURIComponent(ti?.horario||t.turno)} hs %E2%80%94 ${encodeURIComponent(t.sector)}` }).join('%0A')
                                return `Se le comunica el cronograma POLAD *${APP_LUGAR}* para *${encodeURIComponent(NOMBRE_MES.toUpperCase())}*%3A%0A%0A${lineas}%0A%0A%E2%9C%85 *Total: ${subtotal} hs*`
                              })()
                          const msg = `Estimado%2Fa ${encodeURIComponent(jerarquia + nombreFormateado)}%3A%0A%0A${cuerpo}%0A%0A_Referente: Cap. Zara Gonzalo_%0A_POLAD %C2%B7 ${APP_LUGAR} %C2%B7 Mar del Plata_`
                          return `https://wa.me/${tel}?text=${msg}`
                        })()} target="_blank" rel="noopener noreferrer"
                        onClick={ev => {
                          // Corrección de esta ronda ("el enlace de WhatsApp
                          // debe esperar el resultado de la validación
                          // existente antes de abrir el mensaje"): antes,
                          // onClick disparaba abrirAviso() sin esperarlo y
                          // el navegador seguía de largo y abría wa.me de
                          // inmediato, sin importar si el servidor terminaba
                          // rechazando la apertura (p.ej. pantalla
                          // desactualizada, ver fn_whatsapp_marcar_abierto).
                          // Ahora se frena la navegación del link
                          // (preventDefault), se espera el resultado de la
                          // MISMA validación que ya existía (abrirAviso,
                          // sin cambiar su lógica interna) y solo si tuvo
                          // éxito se abre el mensaje; si la validación
                          // falla, abrirAviso ya informa el motivo (alert) y
                          // el mensaje NUNCA se abre.
                          ev.preventDefault()
                          const href = ev.currentTarget.href
                          abrirAviso(e.legajo, fpActualEf).then(exito => {
                            if (exito) window.open(href, '_blank', 'noopener,noreferrer')
                          })
                        }}
                        style={{ display:'flex', alignItems:'center', gap:8, padding:'7px 12px', borderRadius:6, border:'0.5px solid rgba(37,211,102,0.35)', background:'rgba(37,211,102,0.07)', color:'#25D366', fontSize:11, fontWeight:500, textDecoration:'none' }}>
                          <span style={{ fontSize:14 }}>📱</span>
                          <span style={{ flex:1 }}>{avisoAbiertoSinConfirmar ? 'Reabrir WhatsApp' : 'Enviar guardias por WhatsApp'}</span>
                          <span style={{ fontSize:12, opacity:0.6 }}>›</span>
                        </a>
                        <button onClick={() => confirmarAviso(e.legajo, fpActualEf)}
                          style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:6, padding:'6px 12px', borderRadius:6, border:'0.5px solid rgba(29,158,117,0.3)', background:'transparent', color:'#1D9E75', fontSize:10.5, fontWeight:500, cursor:'pointer' }}>
                          ✓ Confirmar que lo envié
                        </button>
                      </div>
                  )}
                </div>
              </div>
            )
          })
          return (
            <div>
              <div style={{ display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12,gap:10 }}>
                <div style={{ display:'flex',alignItems:'center',gap:6 }}>
                  <label style={{ fontSize:11,color:'var(--text-muted)' }}>Filtrar por sexo:</label>
                  <select value={filtroSexo} onChange={e => setFiltroSexo(e.target.value)} style={{ padding:'5px 8px',border:'0.5px solid rgba(255,255,255,0.12)',borderRadius:6,fontSize:12,background:'#1e2130',color:'#e8eaf0' }}>
                    <option value="todos">Todos</option>
                    <option value="femenino">Femenino</option>
                    <option value="masculino">Masculino</option>
                  </select>
                </div>
                <button className="btn btn-sm" style={{ background:'rgba(200,168,75,0.15)',color:'#c8a84b',border:'0.5px solid rgba(200,168,75,0.4)' }} onClick={() => { setMsgPersonal(null); setModalPersonal({ legajo:'',nombre:'',tipo:'Uniformado',email:'',sector:'Sin asignar',lugar:APP_LUGAR,sexo:'sin_informar' }) }}>+ Dar de alta efectivo</button>
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
                  {efectivos.filter(e => Object.keys(disponibilidad[normLegajo(e.legajo)]||{}).length > 0).length} de {efectivos.length} cargaron
                </span>
              </div>
              <div style={{ padding:14 }}>
                <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(220px,1fr))', gap:8 }}>
                  {efectivos.map(e => {
                    const dias = disponibilidad[normLegajo(e.legajo)] || {}
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
                        {seleccionado && !cargo && (
                          <div style={{ border:'0.5px solid #c8a84b', borderTop:'none', borderRadius:'0 0 8px 8px', padding:'10px 12px', background:'rgba(200,168,75,0.05)' }}>
                            <div style={{ fontSize:11, color:'var(--text-muted)', marginBottom:8 }}>No cargó disponibilidad este período.</div>
                            <button className="btn btn-sm" style={{ color:'#c8a84b', border:'0.5px solid rgba(200,168,75,0.4)' }} onClick={ev => { ev.stopPropagation(); abrirDispAdmin(e) }}>
                              ✎ Cargar disponibilidad (fuera de término)
                            </button>
                          </div>
                        )}
                        {seleccionado && cargo && (
                          <div style={{ border:'0.5px solid #c8a84b', borderTop:'none', borderRadius:'0 0 8px 8px', padding:'10px 12px', background:'rgba(200,168,75,0.05)' }}>
                            <div style={{ fontSize:10, color:'#c8a84b', marginBottom:8, fontWeight:500 }}>{cantDias} días cargados</div>
                            <div style={{ display:'flex', flexWrap:'wrap', gap:4 }}>
                              {Array.from({ length: DIAS_MES }, (_, i) => i + 1).map(dia => {
                                const entry = dias[dia]
                                if (!entry) return (
                                  <span key={dia} style={{ display:'inline-flex', alignItems:'center', justifyContent:'center', width:28, height:28, borderRadius:4, background:'var(--surface2)', fontSize:10, color:'var(--text-hint)' }}>{dia}</span>
                                )
                                const v = entry.turno
                                const allTurnos = v && v.length >= TURNOS_LUGAR.length
                                const bg = allTurnos ? 'rgba(29,158,117,0.2)' : (() => { const ti = TURNOS_INFO.find(x => v && v.includes(x.key)); return ti ? ti.bg : 'rgba(133,183,235,0.2)' })()
                                const color = allTurnos ? '#5DCAA5' : (() => { const ti = TURNOS_INFO.find(x => v && v.includes(x.key)); return ti ? ti.color : '#85B7EB' })()
                                const label = allTurnos ? 'A' : v ? v.toUpperCase() : '?'
                                return (
                                  <span key={dia} style={{ display:'inline-flex', flexDirection:'column', alignItems:'center', justifyContent:'center', width:28, height:32, borderRadius:4, background:bg, fontSize:9, color, border:`0.5px solid ${color}55`, fontWeight:600 }}>
                                    <span style={{ fontSize:8 }}>{dia}</span>
                                    <span>{label}</span>
                                  </span>
                                )
                              })}
                            </div>
                            <div style={{ marginTop:8, fontSize:10, color:'var(--text-muted)', display:'flex', gap:12, flexWrap:'wrap' }}>
                              {TURNOS_INFO.map(ti => <span key={ti.key} style={{ color:ti.color }}>{ti.key.toUpperCase()} = {ti.label.split(' ')[0]}</span>)}
                            </div>
                            <button className="btn btn-sm" style={{ marginTop:8, color:'#c8a84b', border:'0.5px solid rgba(200,168,75,0.4)' }} onClick={ev => { ev.stopPropagation(); abrirDispAdmin(e) }}>
                              ✎ Cargar/corregir disponibilidad (fuera de término)
                            </button>

                            {/* Guardias asignadas */}
                            {(() => {
                              const turnosEf = (turnos[e.legajo] || []).filter(t => t && t.dia != null)
                              if (turnosEf.length === 0) return (
                                <div style={{ marginTop:10, paddingTop:10, borderTop:'0.5px solid rgba(255,255,255,0.08)', fontSize:10, color:'var(--text-muted)', fontStyle:'italic' }}>Sin guardias asignadas este mes</div>
                              )
                              const turnosPorDia = {}
                              turnosEf.forEach(t => {
                                const d = parseInt(t.dia)
                                if (!turnosPorDia[d]) turnosPorDia[d] = []
                                turnosPorDia[d].push(t)
                              })
                              return (
                                <div style={{ marginTop:10, paddingTop:10, borderTop:'0.5px solid rgba(255,255,255,0.08)' }}>
                                  <div style={{ fontSize:10, color:'#5DCAA5', marginBottom:8, fontWeight:500 }}>
                                    Guardias asignadas — {turnosEf.length} turno{turnosEf.length !== 1 ? 's' : ''}
                                  </div>
                                  <div style={{ display:'flex', flexWrap:'wrap', gap:4 }}>
                                    {Array.from({ length: DIAS_MES }, (_, i) => i + 1).map(dia => {
                                      const ts = turnosPorDia[dia]
                                      if (!ts || ts.length === 0) return (
                                        <span key={dia} style={{ display:'inline-flex', alignItems:'center', justifyContent:'center', width:28, height:28, borderRadius:4, background:'var(--surface2)', fontSize:10, color:'var(--text-hint)' }}>{dia}</span>
                                      )
                                      const esMultiple = ts.length > 1
                                      const ti = TURNOS_INFO.find(x => x.key === ts[0]?.turno) || TURNOS_INFO[0]
                                      const color = esMultiple ? '#c8a84b' : (ti?.color || '#5DCAA5')
                                      const bg = esMultiple ? 'rgba(200,168,75,0.18)' : (ti?.bg || 'rgba(29,158,117,0.2)')
                                      const label = esMultiple
                                        ? ts.map(t => (t.turno || '?').toUpperCase()).join('+')
                                        : (ts[0]?.turno || '?').toUpperCase()
                                      const tooltip = ts.map(t => `${t.sector || ''} (${t.turno || ''})`).join(', ')
                                      return (
                                        <span key={dia} title={tooltip} style={{ display:'inline-flex', flexDirection:'column', alignItems:'center', justifyContent:'center', width:28, height:32, borderRadius:4, background:bg, fontSize:esMultiple?7:9, color, border:`0.5px solid ${color}88`, fontWeight:700, cursor:'default' }}>
                                          <span style={{ fontSize:8 }}>{dia}</span>
                                          <span>{label}</span>
                                        </span>
                                      )
                                    })}
                                  </div>
                                </div>
                              )
                            })()}
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

            <div className="panel" style={{ marginBottom:16, border:'0.5px solid rgba(200,168,75,0.3)' }}>
              <div className="panel-header" style={{ background:'rgba(200,168,75,0.08)' }}>
                <h3 style={{ color:'#c8a84b' }}>📣 Publicar guardias — {APP_LUGAR} · {NOMBRE_MES}</h3>
              </div>
              <div style={{ padding:14 }}>
                <p style={{ fontSize:12, color:'var(--text-muted)', marginBottom:12 }}>
                  Lo que estás viendo y editando acá arriba (el cronograma) es el borrador de trabajo. Los efectivos NO lo ven hasta que lo publiques. Publicar guardias toma una foto del estado actual y la deja visible para cada efectivo — no borra ni modifica el borrador.
                </p>
                <button className="btn" style={{ background:'rgba(200,168,75,0.15)', color:'#c8a84b', border:'0.5px solid rgba(200,168,75,0.4)' }}
                  onClick={() => { setPublicarResumen(null); setPublicarResultado(null); setMostrarModalPublicar(true); abrirPublicar() }} disabled={publicarCargando}>
                  {publicarCargando ? 'Calculando...' : 'Publicar guardias…'}
                </button>
              </div>
            </div>

            {hayTurnos && (
              <div className="panel">
                <div className="panel-header"><h3>Cronograma {APP_LUGAR} — {NOMBRE_MES}</h3></div>
                <div style={{ overflowX:'auto' }}>
                  <table style={{ tableLayout:'fixed',width:'max-content',minWidth:'100%' }}>
                    <thead>
                      <tr>
                        <th style={{ width:130 }}>Sector</th>
                        {Array.from({ length:DIAS_MES },(_,i) => {
                          const dia = i+1
                          const esp = infoDiaEspecial(dia, MES, ANIO)
                          return <th key={i} style={{ width:76,textAlign:'center',padding:'8px 3px', background: esp.marcar ? 'rgba(255,215,0,0.18)' : undefined, color: esp.marcar ? '#FFD700' : undefined }}>{dia}</th>
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {SECTORES_APP.map(sector => (
                        <tr key={sector}>
                          <td><span style={{ display:'inline-flex',alignItems:'center',gap:4,fontSize:11 }}><span className="dot" style={{ background:SEC_COLORS[sector] }}></span>{sector}</span></td>
                          {Array.from({ length:DIAS_MES },(_,i) => {
                            const dia = i+1
                            const esp = infoDiaEspecial(dia, MES, ANIO)
                            return <td key={i} style={{ padding:'3px',fontSize:10,verticalAlign:'top', background: esp.marcar ? 'rgba(255,215,0,0.08)' : undefined }}>
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
                {Array.from({ length:DIAS_MES },(_,i) => i+1).map(d => {
                  const esp = infoDiaEspecial(d, MES, ANIO)
                  const activo = d === filtroDia
                  return (
                    <button key={d} className="btn btn-sm" style={{ minWidth:32,padding:'4px 6px',fontSize:11,
                      background: activo ? 'rgba(200,168,75,0.15)' : (esp.marcar ? 'rgba(255,215,0,0.12)' : 'transparent'),
                      color: activo ? '#c8a84b' : (esp.marcar ? '#FFD700' : 'var(--text-muted)'),
                      border: activo ? '0.5px solid rgba(200,168,75,0.6)' : (esp.marcar ? '0.5px solid rgba(255,215,0,0.5)' : '0.5px solid rgba(255,255,255,0.1)'),
                      fontWeight: esp.marcar ? 700 : 400 }} onClick={() => setFiltroDia(d)}>{d}</button>
                  )
                })}
              </div>
            </div>
            <div style={{ marginBottom:12,display:'flex',justifyContent:'space-between',alignItems:'center' }}>
              <h3 style={{ fontSize:14,fontWeight:500 }}>{DIAS_SEMANA_NOMBRES[new Date(ANIO, MES-1, filtroDia).getDay()]} {filtroDia} — {NOMBRE_MES} — {APP_LUGAR}
                {infoDiaEspecial(filtroDia, MES, ANIO).nombre && <span style={{ color:'#FFD700', fontWeight:600 }}> · {infoDiaEspecial(filtroDia, MES, ANIO).nombre}</span>}
              </h3>
              <div style={{ display:'flex',gap:8 }}>
                {lugarDetectado === 'HIGA' && (
                  <button className="btn btn-sm" disabled={rellenandoDia === filtroDia}
                    style={{ background:'rgba(29,158,117,0.15)', color:'#1D9E75', border:'0.5px solid rgba(29,158,117,0.4)' }}
                    onClick={() => rellenarDiaAuto(filtroDia)}>
                    {rellenandoDia === filtroDia ? 'Completando…' : `⚡ Completar día ${filtroDia}`}
                  </button>
                )}
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
                          // Pedido de esta ronda ("arrastrar para cambiar de lugar", luego
                          // "si ya había alguien, que se intercambien", y luego "que me
                          // seleccione por cuál efectivo, porque se mezcla con ambos y no
                          // me advierte por qué efectivo"): esta casilla (sector+turno) es
                          // zona de destino para soltar una tarjeta arrastrada desde otra
                          // casilla — ver handleMoverTurno, handleSwapTurno, ModalElegirSwap
                          // y el comentario junto a arrastrando/dropHover más arriba. Si hay
                          // cupo libre, soltar ahí MUEVE (handleMoverTurno). Si está llena:
                          // con UN solo ocupante, INTERCAMBIA directo con ese (no hay
                          // ambigüedad posible); con MÁS DE UNO, abre ModalElegirSwap para
                          // preguntar con cuál de todos — nunca se elige a ciegas el primero
                          // de la lista. Si no hay cupo NI hay nadie (turno que no
                          // corresponde a este sector, maxSlot=0), no se puede soltar. Nunca
                          // se resalta ni se permite soltar sobre la misma casilla de donde
                          // salió la tarjeta (no tendría sentido). handleMoverTurno igual
                          // vuelve a chequear el cupo real al soltar, por si cambió mientras
                          // se arrastraba.
                          const key = sector + '-' + ti.key
                          const hayCupo = list.length < maxSlot(sector, ti.key)
                          const puedeSoltar = hayCupo || list.length > 0
                          const esMismaCasilla = ar => ar && ar.sector === sector && ar.turno === ti.key
                          const esHover = dropHover === key
                          return (
                            <div key={ti.key}
                              onDragOver={e => { if (arrastrandoRef.current && puedeSoltar && !esMismaCasilla(arrastrandoRef.current)) { e.preventDefault(); e.dataTransfer.dropEffect = 'move' } }}
                              onDragEnter={e => { if (arrastrandoRef.current && puedeSoltar && !esMismaCasilla(arrastrandoRef.current)) { e.preventDefault(); setDropHover(key) } }}
                              onDragLeave={() => { if (dropHover === key) setDropHover(null) }}
                              onDrop={e => {
                                e.preventDefault(); setDropHover(null)
                                const arr = arrastrandoRef.current
                                if (!arr || esMismaCasilla(arr)) return
                                if (hayCupo) { handleMoverTurno(arr, sector, ti.key); return }
                                if (list.length === 1) { handleSwapTurno(arr, list[0]); return }
                                // Más de un ocupante en la casilla de destino: no hay forma de
                                // adivinar con cuál de todos se quiso intercambiar — se pregunta
                                // (ModalElegirSwap, más abajo) en vez de elegir el primero a ciegas.
                                if (list.length > 1) setSwapPendiente({ item: arr, opciones: list, sector, turno: ti.key })
                              }}
                              style={{ marginBottom:idx<TURNOS_INFO.length-1?8:0,paddingBottom:idx<TURNOS_INFO.length-1?8:0,borderBottom:idx<TURNOS_INFO.length-1?'0.5px solid var(--border)':'',
                                borderRadius: esHover ? 6 : 0,
                                outline: esHover ? `1.5px dashed ${hayCupo ? '#1D9E75' : '#c8a84b'}` : 'none', outlineOffset:2 }}>
                              <div style={{ fontSize:10,color:ti.color,fontWeight:500,marginBottom:5 }}>{ti.label.toUpperCase()}</div>
                              {list.length===0 && maxSlot(sector, ti.key) === 0 && <span style={{ fontSize:11,color:'var(--text-hint)',fontStyle:'italic' }}>No corresponde este turno</span>}
                              {list.length===0 && maxSlot(sector, ti.key) > 0 && <div style={{ display:'flex',alignItems:'center',gap:6 }}><span style={{ fontSize:11,color:'var(--text-hint)',fontStyle:'italic' }}>Sin cubrir</span><button className="btn btn-sm" style={{ fontSize:10,padding:'2px 8px',color:ti.color,borderColor:`${ti.color}66` }} onClick={() => setModalTurno({ dia:filtroDia,sector,turno:ti.key,legajo:'' })}>+ Asignar</button></div>}
                              {list.map(item => {
                                // Pedido de esta ronda: en esta vista (Edición manual) nada
                                // más — distinguir femenino/masculino por color (rosa/celeste)
                                // y mostrar el escalafón (Uniformado/Serv. General/Destacamento)
                                // de cada efectivo, para orientarse más rápido. NO toca la
                                // planilla para imprimir (pages/api/generar-planilla.js) ni
                                // ninguna otra vista.
                                const ef = efectivos.find(x => x.legajo === item.legajo)
                                const colorSexo = ef?.sexo === 'femenino' ? '#F2A6C6' : ef?.sexo === 'masculino' ? '#85B7EB' : undefined
                                return (
                                  <div key={item.id} draggable
                                    onDragStart={e => {
                                      // Algunos navegadores (Firefox en particular) exigen que
                                      // dataTransfer tenga ALGO seteado en dragstart, si no
                                      // cancelan el arrastre antes de que empiece — por eso esto
                                      // no alcanzaba con guardar `item` solo en el estado de React.
                                      e.dataTransfer.effectAllowed = 'move'
                                      e.dataTransfer.setData('text/plain', String(item.id))
                                      arrastrandoRef.current = item
                                    }}
                                    onDragEnd={() => { arrastrandoRef.current = null; setDropHover(null) }}
                                    title="Arrastrá para moverlo a otro sector/turno de este mismo día (si ya hay alguien ahí, se intercambian)"
                                    style={{ display:'flex',alignItems:'center',justifyContent:'space-between',padding:'4px 8px',background:ti.bg,borderRadius:6,marginBottom:3,cursor:'grab' }}>
                                    <span style={{ fontSize:12,fontWeight:500,color:colorSexo }}>
                                      {nombreCompleto(item.legajo)}
                                      {ef?.tipo && <span style={{ fontSize:10.5,fontWeight:700,color:colorTipo(ef.tipo) }}> · {ef.tipo}</span>}
                                    </span>
                                    <div style={{ display:'flex',gap:4 }}>
                                      <button className="btn btn-sm" style={{ fontSize:10,padding:'2px 6px' }} onClick={() => setModalTurno(item)}>Cambiar</button>
                                      <button className="btn btn-sm" style={{ fontSize:10,padding:'2px 6px',color:'#F09595',borderColor:'rgba(240,149,149,0.3)' }} onClick={() => handleEliminarTurno(item)}>✕</button>
                                    </div>
                                  </div>
                                )
                              })}
                              {list.length>0&&list.length<maxSlot(sector, ti.key) && <button className="btn btn-sm" style={{ fontSize:10,padding:'2px 8px',marginTop:3,color:ti.color,borderColor:`${ti.color}55` }} onClick={() => setModalTurno({ dia:filtroDia,sector,turno:ti.key,legajo:'' })}>+ Agregar</button>}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
              <div style={{ display:'flex',flexDirection:'column',gap:12,height:'fit-content',position:'sticky',top:16 }}>
              <div style={{ background:'var(--surface)',border:'0.5px solid var(--border)',borderRadius:10,overflow:'hidden' }}>
                <div style={{ padding:'10px 14px',background:'var(--surface2)',borderBottom:'0.5px solid var(--border)' }}>
                  <div style={{ fontSize:13,fontWeight:500,marginBottom:2 }}>Disponibles — Día {filtroDia}</div>
                </div>
                {(() => {
                  const dispDatos = dispDelDia.dia === filtroDia ? dispDelDia.data : []
                  const dispDia = dispDatos.map(d => { const ef = efectivos.find(e => e.legajo===d.legajo); if (!ef) return null; return { ...ef, disp:d.turno, hs:horasAsig[ef.legajo]||0 } }).filter(Boolean)
                  // Pedido de esta ronda ("una de las cosas es que no quede
                  // quien ya fue asignado"): alguien con un turno asignado
                  // ESE DÍA en CUALQUIER turno (no solo el que se está
                  // mirando) no puede recibir otro turno el mismo día —
                  // cumpleDescanso, en la Asignación rápida, ya lo bloquea
                  // siempre. Antes acá solo se excluía por el turno
                  // puntual (ti.key), así que alguien ya asignado de día
                  // seguía figurando como "disponible" en la lista de
                  // noche del mismo día, aunque asignarlo ahí fuera
                  // imposible. Ahora se calcula una sola vez por día,
                  // cualquier turno, y se usa en las tres listas.
                  const yaAsignadosEseDia = new Set(todosLosTurnos.filter(t => t.dia===filtroDia).map(t => t.legajo))

                  return (
                    <div>
                      {TURNOS_INFO.map(ti => {
                        const ocupSlots = {}
                        todosLosTurnos.filter(t => t.dia===filtroDia&&t.turno===ti.key).forEach(t => { ocupSlots[t.sector]=(ocupSlots[t.sector]||0)+1 })
                        const hayLugar = SECTORES_APP.some(s => (ocupSlots[s]||0) < maxSlot(s, ti.key))
                        const dispTurno = dispDia.filter(e => e.disp && e.disp.includes(ti.key) && !yaAsignadosEseDia.has(e.legajo) && e.hs<180 && hayLugar)
                        return (
                          <div key={ti.key} style={{ padding:'8px 12px 4px' }}>
                            <div style={{ fontSize:10,fontWeight:500,color:ti.color,marginBottom:6,paddingBottom:4,borderBottom:'0.5px solid var(--border)' }}>{ti.label} — {dispTurno.length}</div>
                            {dispTurno.length===0?<div style={{ fontSize:11,color:'var(--text-hint)',fontStyle:'italic',paddingBottom:6 }}>Sin disponibilidad</div>:dispTurno.map(e => {
                              const pct = Math.round(e.hs/180*100)
                              const colorHs = pct>=100?'#E24B4A':pct>=80?'#EF9F27':'#1D9E75'
                              return (
                                <div key={e.legajo} style={{ display:'flex',alignItems:'center',justifyContent:'space-between',padding:'6px 0',borderBottom:'0.5px solid var(--border)',cursor:'pointer' }} onClick={() => setModalTurno({ dia:filtroDia,sector:SECTORES_APP[0],turno:ti.key,legajo:e.legajo })}>
                                  <div style={{ flex:1,minWidth:0 }}>
                                    <div style={{ fontSize:11,fontWeight:500,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' }}>{nombreCorto(e.legajo)}</div>
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
                            const { data } = await fetch(`/api/admin-disponibilidad?mes=${MES}&anio=${ANIO}&lugar=${lugarDetectado}`).then(r => r.json())
                            const legajos = new Set((data||[]).map(d=>normLegajo(d.legajo)))
                            setEfDisponibles(efectivos.filter(e=>legajos.has(normLegajo(e.legajo))))
                            setModalAsignar({ legajo:'', cantidad:'', tipoTurno:TURNOS_LUGAR[0] })
                          }}>⚡ Asignar guardias rápido</button>
                      </div>
                    </div>
                  )
                })()}
              </div>
              {/* Pedido de esta ronda ("una tabla que esté en cada día actualizada
                  de cuántos efectivos masculinos femeninos uniformados y no
                  uniformados hay, así en cada día"): cuenta, para el DÍA que se
                  está viendo (filtroDia), a los efectivos YA ASIGNADOS ese día
                  (en cualquier sector/turno) — una sola vez cada uno aunque
                  tenga más de un turno ese día — separados por sexo y por si
                  son Uniformados o no (Serv. General + Destacamento, agrupados
                  como "No uniformados", tal como lo pidió). Se recalcula solo
                  con lo que ya está en pantalla (todosLosTurnos/efectivos), así
                  que queda al día con cada arrastre, alta o baja sin recargar. */}
              {(() => {
                const legajosHoy = new Set(todosLosTurnos.filter(t => t.dia === filtroDia).map(t => t.legajo))
                const efHoy = Array.from(legajosHoy).map(l => efectivos.find(e => e.legajo === l)).filter(Boolean)
                const cConteo = [
                  { label:'Masculinos', valor: efHoy.filter(e => e.sexo === 'masculino').length, color:'#85B7EB' },
                  { label:'Femeninos', valor: efHoy.filter(e => e.sexo === 'femenino').length, color:'#F2A6C6' },
                  { label:'Uniformados', valor: efHoy.filter(e => e.tipo === 'Uniformado').length, color:'var(--text)' },
                  { label:'No uniformados', valor: efHoy.filter(e => e.tipo !== 'Uniformado').length, color:'var(--text)' },
                ]
                return (
                  <div style={{ background:'var(--surface)',border:'0.5px solid var(--border)',borderRadius:10,overflow:'hidden' }}>
                    <div style={{ padding:'10px 14px',background:'var(--surface2)',borderBottom:'0.5px solid var(--border)' }}>
                      <div style={{ fontSize:13,fontWeight:500 }}>Asignados — Día {filtroDia}</div>
                      <div style={{ fontSize:10,color:'var(--text-muted)',marginTop:2 }}>{efHoy.length} efectivo{efHoy.length===1?'':'s'} en total</div>
                    </div>
                    <div style={{ padding:'10px 14px',display:'grid',gridTemplateColumns:'1fr auto',rowGap:8,fontSize:12 }}>
                      {cConteo.flatMap(c => [
                        <span key={c.label + '-l'} style={{ color:c.color }}>{c.label}</span>,
                        <span key={c.label + '-v'} style={{ fontWeight:600,textAlign:'right' }}>{c.valor}</span>,
                      ])}
                    </div>
                  </div>
                )
              })()}
              </div>
            </div>
          </div>
        )}

        {vista === 'rapida' && (() => {
          const prev = mesAnteriorDe(MES, ANIO)
          const nombrePrev = MESES_NOMBRES[prev.mes - 1] + ' ' + prev.anio
          const totalObjetivo = rapidaLista.reduce((s, i) => s + i.objetivo, 0)
          return (
            <div>
              <div className="panel" style={{ marginBottom:14 }}>
                <div className="panel-header" style={{ background:BG_APP }}>
                  <h3 style={{ color:COLOR_APP }}>⚡ Asignación rápida — {APP_LUGAR} · {NOMBRE_MES}</h3>
                  <span style={{ fontSize:11, color:'var(--text-muted)' }}>Iguala la cantidad de guardias de {nombrePrev}</span>
                </div>
                <div style={{ padding:14 }}>
                  {(
                    <div style={{ marginBottom:14, border:'1px solid rgba(29,158,117,0.4)', borderRadius:8, overflow:'hidden', background:'rgba(29,158,117,0.05)' }}>
                      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'8px 12px', background:'rgba(255,255,255,0.03)', cursor:'pointer' }}
                        onClick={() => setEspecialesModal(!especialesModal)}>
                        <span style={{ fontSize:12, fontWeight:500 }}>⚙ Casos especiales {APP_LUGAR} ({especiales.filter(e=>e.tipo==='24hs').length} de 24hs · {especiales.filter(e=>e.tipo==='pareja').length} parejas · {objetivosFijos.length} con cantidad fija)</span>
                        <span style={{ fontSize:11, color:'var(--text-muted)' }}>{especialesModal ? '▲' : '▼'}</span>
                      </div>
                      {especialesModal && (
                        <div style={{ padding:12 }}>
                          <div style={{ marginBottom:10 }}>
                            <div style={{ fontSize:11, fontWeight:600, color:'var(--text-muted)', marginBottom:6 }}>GUARDIAS DE 24HS</div>
                            {especiales.filter(e => e.tipo === '24hs').map(e => {
                              const ef = efectivos.find(x => String(x.legajo) === String(e.legajo1))
                              return (
                                <div key={e.id} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'4px 8px', background:'rgba(29,158,117,0.08)', borderRadius:6, marginBottom:4 }}>
                                  <span style={{ fontSize:12 }}>{ef?.nombre || e.legajo1} <span style={{ color:'var(--text-muted)', fontSize:10 }}>Leg. {e.legajo1}</span></span>
                                  <button className="btn btn-sm" style={{ fontSize:10, color:'#F09595', padding:'2px 8px' }} onClick={() => quitarEspecial(e.id)}>Quitar</button>
                                </div>
                              )
                            })}
                          </div>
                          <div style={{ marginBottom:10 }}>
                            <div style={{ fontSize:11, fontWeight:600, color:'var(--text-muted)', marginBottom:6 }}>PAREJAS</div>
                            {especiales.filter(e => e.tipo === 'pareja').map(e => {
                              const ef1 = efectivos.find(x => String(x.legajo) === String(e.legajo1))
                              const ef2 = efectivos.find(x => String(x.legajo) === String(e.legajo2))
                              return (
                                <div key={e.id} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'4px 8px', background:'rgba(239,159,39,0.08)', borderRadius:6, marginBottom:4 }}>
                                  <span style={{ fontSize:12 }}>{ef1?.nombre || e.legajo1} + {ef2?.nombre || e.legajo2}</span>
                                  <button className="btn btn-sm" style={{ fontSize:10, color:'#F09595', padding:'2px 8px' }} onClick={() => quitarEspecial(e.id)}>Quitar</button>
                                </div>
                              )
                            })}
                          </div>
                          <div style={{ marginBottom:10, paddingTop:8, borderTop:'0.5px solid var(--border)' }}>
                            <div style={{ fontSize:11, fontWeight:600, color:'var(--text-muted)', marginBottom:6 }}>CANTIDAD FIJA — no se les suma ni resta, van primero</div>
                            {objetivosFijos.length === 0 && <div style={{ fontSize:11, color:'var(--text-hint)', fontStyle:'italic', marginBottom:6 }}>Ninguno configurado todavía.</div>}
                            {objetivosFijos.map(o => {
                              const ef = efectivos.find(x => String(x.legajo) === String(o.legajo))
                              const puesto = puestosFijoPorLegajoFijo[String(o.legajo)]
                              return (
                                <div key={o.id} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'4px 8px', background:'rgba(133,183,235,0.08)', borderRadius:6, marginBottom:4 }}>
                                  <span style={{ fontSize:12 }}>{ef?.nombre || o.legajo} <span style={{ color:'var(--text-muted)', fontSize:10 }}>Leg. {o.legajo} · {o.cantidad} {o.tipo === 'horas' ? 'hs' : 'guardias'}{puesto ? ` · solo en ${puesto.sector}` : ''}</span></span>
                                  <button className="btn btn-sm" style={{ fontSize:10, color:'#F09595', padding:'2px 8px' }} onClick={() => quitarObjetivoFijo(o.id, o.legajo)}>Quitar</button>
                                </div>
                              )
                            })}
                            {(() => {
                              // Tope: mismas 180hs/mes que ya respeta Asignación rápida
                              // (ver el texto de más abajo), convertidas a cantidad de
                              // guardias según la duración de turno de este lugar (12hs
                              // HIGA/UPA → 15, 8hs MODULAR → 22).
                              const maxGuardiasFijo = Math.floor(180 / HORAS_TURNO)
                              const filtro = filtroObjetivoFijo.trim().toLowerCase()
                              const opciones = [...efectivos]
                                .sort((a,b) => a.nombre.localeCompare(b.nombre))
                                .filter(e => !filtro || e.nombre.toLowerCase().includes(filtro) || String(e.legajo).includes(filtro))
                                .slice(0, 30) // no hace falta mostrar más de 30 a la vez: si no aparece, afina la búsqueda
                              const efSeleccionado = efectivos.find(e => String(e.legajo) === String(nuevoObjetivoFijoLeg))
                              return (
                                <div style={{ marginTop:6 }}>
                                  <input type="text" placeholder="🔍 Buscar efectivo por nombre o legajo..."
                                    value={filtroObjetivoFijo}
                                    onChange={e => { setFiltroObjetivoFijo(e.target.value); setNuevoObjetivoFijoLeg('') }}
                                    style={{ fontSize:11, padding:'4px 6px', borderRadius:6, background:'#ffffff', color:'#111111', border:'1px solid #aaa', width:'100%', marginBottom:6 }} />
                                  {filtro && !efSeleccionado && (
                                    <div style={{ display:'flex', flexDirection:'column', gap:2, maxHeight:150, overflowY:'auto', marginBottom:6, border:'1px solid var(--border)', borderRadius:6, padding:4 }}>
                                      {opciones.length === 0 && <div style={{ fontSize:11, color:'var(--text-hint)', padding:4 }}>Sin resultados.</div>}
                                      {opciones.map(e => (
                                        <div key={e.legajo} onClick={() => { setNuevoObjetivoFijoLeg(e.legajo); setFiltroObjetivoFijo(e.nombre + ' · Leg. ' + e.legajo) }}
                                          style={{ fontSize:11, padding:'4px 6px', borderRadius:4, cursor:'pointer' }}
                                          onMouseEnter={ev => ev.currentTarget.style.background='rgba(133,183,235,0.15)'} onMouseLeave={ev => ev.currentTarget.style.background='transparent'}>
                                          {e.nombre} <span style={{ color:'var(--text-muted)' }}>· Leg. {e.legajo}</span>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                  <div style={{ display:'flex', gap:10, alignItems:'center', flexWrap:'wrap' }}>
                                    <input type="range" min="0" max={maxGuardiasFijo} step="1"
                                      value={nuevoObjetivoFijoCantidad} disabled={!efSeleccionado}
                                      onChange={e => setNuevoObjetivoFijoCantidad(Number(e.target.value))}
                                      style={{ flex:1, minWidth:120 }} />
                                    <span style={{ fontSize:12, minWidth:95, textAlign:'right' }}>{nuevoObjetivoFijoCantidad} / {maxGuardiasFijo} guardias</span>
                                  </div>
                                  <div style={{ display:'flex', gap:6, alignItems:'center', marginTop:6, flexWrap:'wrap' }}>
                                    <select value={nuevoObjetivoFijoSector} disabled={!efSeleccionado} onChange={e => setNuevoObjetivoFijoSector(e.target.value)}
                                      title="Si este efectivo solo hace guardias en un sector puntual, elegilo acá — sus guardias se van a cubrir SOLO ahí."
                                      style={{ fontSize:11, padding:'4px 6px', borderRadius:6, background:'#ffffff', color:'#111111', border:'1px solid #aaa', flex:1, minWidth:180 }}>
                                      <option value="" style={{ color:'#111', background:'#fff' }}>— Todos los sectores —</option>
                                      {SECTORES_APP.map(s => <option key={s} value={s} style={{ color:'#111', background:'#fff' }}>Solo {s}</option>)}
                                    </select>
                                    <button className="btn btn-sm" disabled={!efSeleccionado} style={{ fontSize:11, background:'rgba(133,183,235,0.15)', color:'#85B7EB' }} onClick={agregarObjetivoFijo}>+ Agregar</button>
                                  </div>
                                </div>
                              )
                            })()}
                          </div>
                          <div style={{ paddingTop:8, borderTop:'0.5px solid var(--border)' }}>
                            <div style={{ display:'flex', gap:6, marginBottom:6 }}>
                              <select value={nuevoEspecialTipo} onChange={e => { setNuevoEspecialTipo(e.target.value); setNuevoEspecialLeg1(''); setNuevoEspecialLeg2('') }} style={{ fontSize:11, padding:'4px 6px', borderRadius:6, background:'var(--bg-input)', color:'var(--text)', border:'0.5px solid var(--border)' }}>
                                <option value="24hs">24hs</option>
                                <option value="pareja">Pareja</option>
                              </select>
                            </div>
                            <div style={{ display:'flex', gap:6, flexWrap:'wrap', alignItems:'center' }}>
                              <select value={nuevoEspecialLeg1} onChange={e => setNuevoEspecialLeg1(e.target.value)}
                                style={{ fontSize:11, padding:'4px 6px', borderRadius:6, background:'#ffffff', color:'#111111', border:'1px solid #aaa', flex:1, minWidth:200 }}>
                                <option value="" style={{ color:'#111', background:'#fff' }}>— Seleccioná efectivo{nuevoEspecialTipo === 'pareja' ? ' 1' : ''} —</option>
                                {[...efectivos].sort((a,b) => a.nombre.localeCompare(b.nombre)).map(e => (
                                  <option key={e.legajo} value={e.legajo} style={{ color:'#111', background:'#fff' }}>{e.nombre} · Leg. {e.legajo}</option>
                                ))}
                              </select>
                              {nuevoEspecialTipo === 'pareja' && (
                                <select value={nuevoEspecialLeg2} onChange={e => setNuevoEspecialLeg2(e.target.value)}
                                  style={{ fontSize:11, padding:'4px 6px', borderRadius:6, background:'#ffffff', color:'#111111', border:'1px solid #aaa', flex:1, minWidth:200 }}>
                                  <option value="" style={{ color:'#111', background:'#fff' }}>— Seleccioná efectivo 2 —</option>
                                  {[...efectivos].sort((a,b) => a.nombre.localeCompare(b.nombre)).map(e => (
                                    <option key={e.legajo} value={e.legajo} style={{ color:'#111', background:'#fff' }}>{e.nombre} · Leg. {e.legajo}</option>
                                  ))}
                                </select>
                              )}
                              <button className="btn btn-sm" style={{ fontSize:11, background:'rgba(29,158,117,0.15)', color:'#1D9E75' }} onClick={agregarEspecial}>+ Agregar</button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  <p style={{ fontSize:12, color:'var(--text-muted)', marginBottom:12, lineHeight:1.5 }}>
                    Toma a cada efectivo que <b>cargó disponibilidad este mes</b> y que <b>tuvo guardias en {nombrePrev}</b>, y le asigna la <b>misma cantidad</b> usando su disponibilidad actual. Respeta descanso 12hs, reparto espaciado, <b>fines de semana y feriados primero</b>, y tope 180hs. Nunca asigna fuera de la disponibilidad cargada. Quien tenga <b>cantidad fija</b> configurada (arriba) usa ese número en vez del de {nombrePrev}, nunca se le suma ni se le resta, y se cubre antes que el resto; si además se le eligió un sector, esas guardias se cubren <b>solo</b> en ese sector.
                  </p>
                  <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:12 }}>
                    <button className="btn btn-sm" disabled={rapidaProcesando || rapidaLista.length === 0}
                      style={{ background:'rgba(29,158,117,0.15)', color:'#1D9E75', border:'0.5px solid rgba(29,158,117,0.4)' }}
                      onClick={asignarTodosRapida}>
                      {rapidaProcesando ? 'Procesando…' : `⚡ Asignar todos (${rapidaLista.length})`}
                    </button>
                    <button className="btn btn-sm" disabled={rapidaProcesando}
                      style={{ color:'#F09595', borderColor:'rgba(240,149,149,0.3)' }}
                      onClick={borrarRapida}>
                      🗑 Borrar guardias de {APP_LUGAR} · {NOMBRE_MES_SOLO}
                    </button>
                    <button className="btn btn-sm" disabled={rapidaProcesando} onClick={cargarRapida}>↻ Actualizar</button>
                  </div>
                  {rapidaMsg && <div className="alert alert-ok" style={{ marginBottom:10 }}>{rapidaMsg}</div>}
                  {rapidaCargando ? (
                    <div style={{ padding:'20px 0', textAlign:'center', color:'var(--text-muted)', fontSize:12 }}>Cargando…</div>
                  ) : rapidaLista.length === 0 ? (
                    <div className="alert alert-warn">No hay efectivos que cumplan: deben haber cargado disponibilidad en {NOMBRE_MES} y tener guardias en {nombrePrev}.</div>
                  ) : (
                    <div style={{ overflowX:'auto' }}>
                      <table>
                        <thead>
                          <tr>
                            <th style={{ width:36, textAlign:'center' }}>N°</th>
                            <th style={{ width:50, textAlign:'center' }}>24hs</th>
                            <th>Efectivo</th>
                            <th style={{ width:110, textAlign:'center' }}>{nombrePrev}</th>
                            <th style={{ width:110, textAlign:'center' }}>Este mes</th>
                            <th style={{ width:90, textAlign:'center' }}>Estado</th>
                            <th style={{ width:90 }}></th>
                          </tr>
                        </thead>
                        <tbody>
                          {rapidaLista.map((i, idx) => {
                            // Pedido de esta ronda ("marcar en celeste cuando supera las
                            // guardias, que puede suceder"): antes "completo" agrupaba en el
                            // mismo verde tanto el que quedó EXACTO en el objetivo como el que
                            // quedó POR ENCIMA (por ejemplo, por una guardia de 24hs, o por
                            // quedar en pareja con alguien que sí necesitaba más) — ambos
                            // casos son "sin pendiente", pero no son lo mismo: superar el
                            // objetivo es válido pero vale la pena que se note aparte, no se
                            // confunda con "cumplido justo". Nunca se trata como error ni se
                            // bloquea nada — solo cambia el color/etiqueta.
                            const completo = i.yaAsignadas >= i.objetivo
                            const supera = i.yaAsignadas > i.objetivo
                            const colorEstado = supera ? '#85B7EB' : completo ? '#1D9E75' : i.yaAsignadas > 0 ? '#EF9F27' : 'var(--text-muted)'
                            return (
                              <tr key={i.legajo}>
                                <td style={{ textAlign:'center', fontSize:11, color:'var(--text-muted)' }}>{idx + 1}</td>
                                <td style={{ textAlign:'center' }}>
                                  <input type="checkbox" checked={rapida24hs.has(i.legajo)} disabled={rapidaProcesando}
                                    onChange={() => setRapida24hs(prev => {
                                      const next = new Set(prev)
                                      next.has(i.legajo) ? next.delete(i.legajo) : next.add(i.legajo)
                                      return next
                                    })}
                                    title="Cargar guardias de 24hs (día completo) a este efectivo" />
                                </td>
                                <td>
                                  <div style={{ fontSize:12, fontWeight:500 }}>{i.nombre}</div>
                                  <div style={{ fontSize:10, color:'var(--text-muted)' }}>Leg. {i.legajo}</div>
                                </td>
                                <td style={{ textAlign:'center', fontWeight:500, color:COLOR_APP }}>{i.objetivo}</td>
                                <td style={{ textAlign:'center', fontWeight:500, color: colorEstado }}>{i.yaAsignadas}</td>
                                <td style={{ textAlign:'center' }}>
                                  {supera
                                    ? <span style={{ fontSize:10, color:'#85B7EB', fontWeight:500 }}>▲ Supera (+{i.yaAsignadas - i.objetivo})</span>
                                    : completo
                                    ? <span style={{ fontSize:10, color:'#1D9E75', fontWeight:500 }}>✓ Completo</span>
                                    : <span style={{ fontSize:10, color:'#EF9F27' }}>Faltan {i.objetivo - i.yaAsignadas}</span>}
                                </td>
                                <td>
                                  <button className="btn btn-sm" disabled={rapidaProcesando}
                                    style={{ fontSize:10, padding:'2px 8px', background:'rgba(200,168,75,0.12)', color:'#c8a84b', border:'0.5px solid rgba(200,168,75,0.4)' }}
                                    onClick={() => asignarUnoRapida(i)}>Asignar</button>
                                </td>
                              </tr>
                            )
                          })}
                          <tr style={{ background:'rgba(255,255,255,0.02)' }}>
                            <td></td>
                            <td></td>
                            <td style={{ fontWeight:500 }}>Total ({rapidaLista.length})</td>
                            <td style={{ textAlign:'center', fontWeight:600, color:COLOR_APP }}>{totalObjetivo}</td>
                            <td colSpan={3}></td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
              {rapidaNuevos.length > 0 && (
                <div className="panel">
                  <div className="panel-header">
                    <h3>Sin guardias en {nombrePrev} — {rapidaNuevos.length}</h3>
                    <span style={{ fontSize:11, color:'var(--text-muted)' }}>Cargaron disponibilidad en {NOMBRE_MES} pero no tienen guardias en {nombrePrev} como referencia — asignar a mano</span>
                  </div>
                  <div style={{ padding:14, display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(220px,1fr))', gap:8 }}>
                    {rapidaNuevos.map(n => {
                      const campo = camposRapidaNuevos[n.legajo] || { cantidad: '', tipoTurno: TURNOS_LUGAR[0] }
                      return (
                        <div key={n.legajo} style={{ padding:'8px 10px', border:'0.5px solid var(--border)', borderRadius:8, background:'var(--surface2)' }}>
                          <div style={{ fontSize:12, fontWeight:500 }}>{n.nombre}</div>
                          <div style={{ fontSize:10, color:'var(--text-muted)', marginBottom:6 }}>Leg. {n.legajo}</div>
                          <div style={{ display:'flex', gap:4 }}>
                            <input type="number" min="1" max="31" value={campo.cantidad}
                              onChange={e => setCamposRapidaNuevos(prev => ({ ...prev, [n.legajo]: { ...campo, cantidad: parseInt(e.target.value) || '' } }))}
                              placeholder="Cant." title="Cantidad de guardias"
                              style={{ width:48, padding:'4px 6px', fontSize:11, border:'0.5px solid var(--border2)', borderRadius:6, background:'var(--surface)', color:'var(--text)', outline:'none' }} />
                            <select value={campo.tipoTurno} title="Tipo de turno"
                              onChange={e => setCamposRapidaNuevos(prev => ({ ...prev, [n.legajo]: { ...campo, tipoTurno: e.target.value } }))}
                              style={{ flex:1, minWidth:0, padding:'4px 4px', fontSize:11, border:'0.5px solid var(--border2)', borderRadius:6, background:'var(--surface)', color:'var(--text)', outline:'none' }}>
                              {TURNOS_INFO.map(ti => <option key={ti.key} value={ti.key}>{ti.label}</option>)}
                              <option value="mixto">Mixto</option>
                              <option value="doble">Todos</option>
                            </select>
                            <button className="btn btn-sm" disabled={!campo.cantidad || asignando}
                              style={{ fontSize:10, padding:'4px 8px', background:'rgba(200,168,75,0.12)', color:'#c8a84b', border:'0.5px solid rgba(200,168,75,0.4)', whiteSpace:'nowrap' }}
                              onClick={async () => {
                                await asignarGuardiasAuto(n.legajo, campo.cantidad, campo.tipoTurno)
                                // asignarGuardiasAuto ya refresca turnos/horas (cargarTodo), pero
                                // no la lista propia de esta solapa — se refresca acá para que, si
                                // el admin configuró un objetivo para este legajo mientras tanto,
                                // la tarjeta deje de aparecer acá (mismo patrón que asignarUnoRapida).
                                await cargarRapida()
                                setCamposRapidaNuevos(prev => ({ ...prev, [n.legajo]: { cantidad: '', tipoTurno: campo.tipoTurno } }))
                              }}>
                              Asignar
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          )
        })()}

        {vista === 'buscarLegajo' && (
          <div style={{ padding: 16, maxWidth: 700 }}>
            <div style={{ fontSize: 13, color: '#8b90a0', marginBottom: 12 }}>
              Buscá un legajo y vas a ver su nombre y TODAS las guardias que tiene asignadas este mes ({NOMBRE_MES}), sumando HIGA, UPA y MODULAR — sin importar en qué sitio estés parado ahora.
            </div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
              <input
                type="text"
                placeholder="Número de legajo"
                value={buscarLegajoInput}
                onChange={e => setBuscarLegajoInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') buscarPorLegajo() }}
                style={{ flex: 1, padding: '8px 12px', borderRadius: 6, border: '0.5px solid rgba(255,255,255,0.15)', background: '#1a1a2e', color: '#fff', fontSize: 14 }}
              />
              <button className="btn" disabled={buscarLegajoCargando} onClick={buscarPorLegajo}>
                {buscarLegajoCargando ? 'Buscando...' : '🔍 Buscar'}
              </button>
            </div>

            {buscarLegajoError && (
              <div style={{ padding: 12, borderRadius: 6, background: 'rgba(226,75,74,0.12)', color: '#E24B4A', fontSize: 13, marginBottom: 16 }}>
                {buscarLegajoError}
              </div>
            )}

            {buscarLegajoResultado && (
              <div>
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 18, fontWeight: 700, color: '#fff' }}>{buscarLegajoResultado.nombre || '(sin nombre registrado)'}</div>
                  <div style={{ fontSize: 12, color: '#8b90a0' }}>Leg. {buscarLegajoResultado.legajo}</div>
                  {buscarLegajoResultado.lugares_donde_figura_como_efectivo.length > 0 && (
                    <div style={{ fontSize: 11, color: '#5DCAA5', marginTop: 4 }}>
                      Registrado como efectivo en: {buscarLegajoResultado.lugares_donde_figura_como_efectivo.join(', ')}
                    </div>
                  )}
                  <div style={{ fontSize: 13, color: '#c8a84b', marginTop: 8, fontWeight: 600 }}>
                    Total: {buscarLegajoResultado.total_guardias} guardia{buscarLegajoResultado.total_guardias !== 1 ? 's' : ''} asignada{buscarLegajoResultado.total_guardias !== 1 ? 's' : ''} este mes
                  </div>
                </div>

                {['HIGA', 'UPA', 'MODULAR'].map(lugar => {
                  const lista = buscarLegajoResultado.turnos_por_lugar[lugar] || []
                  const lugarTurnosInfo = lugar === 'MODULAR'
                    ? { m: 'Mañana 08-16', t: 'Tarde 16-24', n: 'Noche 23:59-08' }
                    : { d: 'Día 08-20', n: 'Noche 20-08' }
                  return (
                    <div key={lugar} style={{ marginBottom: 16, border: '0.5px solid rgba(255,255,255,0.1)', borderRadius: 8, overflow: 'hidden' }}>
                      <div style={{ padding: '8px 12px', background: 'rgba(255,255,255,0.04)', fontWeight: 700, fontSize: 13, display: 'flex', justifyContent: 'space-between' }}>
                        <span>{lugar}</span>
                        <span style={{ color: '#8b90a0', fontWeight: 400 }}>{lista.length} guardia{lista.length !== 1 ? 's' : ''}</span>
                      </div>
                      {lista.length === 0 ? (
                        <div style={{ padding: 12, fontSize: 12, color: '#5a5f70' }}>Sin guardias asignadas en {lugar} este mes.</div>
                      ) : (
                        <div style={{ padding: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                          {lista.map((t, i) => (
                            <div key={i} title={`${t.sector} — ${lugarTurnosInfo[t.turno] || t.turno}`} style={{ padding: '4px 8px', borderRadius: 4, background: 'rgba(200,168,75,0.12)', fontSize: 11, color: '#c8a84b', border: '0.5px solid rgba(200,168,75,0.3)' }}>
                              Día {t.dia} · {(t.turno || '?').toUpperCase()} · {t.sector}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
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
                    {/* Sección: Para qué mes cargan */}
                    <div style={{ fontSize:11,color:COLOR_APP,fontWeight:600,marginBottom:6 }}>📅 Mes de disponibilidad a cargar</div>
                    <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:14 }}>
                      <div>
                        <label style={{ fontSize:11,color:'var(--text-muted)',display:'block',marginBottom:4 }}>Mes</label>
                        <select value={ventanas.mesVentana||MES_ACTUAL} onChange={e => setVentanas(prev => ({...prev,mesVentana:parseInt(e.target.value)}))} style={{ width:'100%',padding:'7px 10px',border:'0.5px solid rgba(200,168,75,0.4)',borderRadius:6,fontSize:13,background:'#1e2130',color:'#c8a84b',outline:'none',fontWeight:500 }}>
                          {MESES_NOMBRES.map((m,i) => <option key={i+1} value={i+1} style={{ background:'#1a1d27' }}>{m}</option>)}
                        </select>
                      </div>
                      <div>
                        <label style={{ fontSize:11,color:'var(--text-muted)',display:'block',marginBottom:4 }}>Año</label>
                        <select value={ventanas.anioVentana||ANIO_ACTUAL} onChange={e => setVentanas(prev => ({...prev,anioVentana:parseInt(e.target.value)}))} style={{ width:'100%',padding:'7px 10px',border:'0.5px solid rgba(200,168,75,0.4)',borderRadius:6,fontSize:13,background:'#1e2130',color:'#c8a84b',outline:'none',fontWeight:500 }}>
                          {[ANIO_ACTUAL, ANIO_ACTUAL+1].map(a => <option key={a} value={a} style={{ background:'#1a1d27' }}>{a}</option>)}
                        </select>
                      </div>
                    </div>
                    {/* Sección: Cuándo se abre */}
                    <div style={{ fontSize:11,color:COLOR_APP,fontWeight:600,marginBottom:6 }}>🕐 Fecha y horario de apertura</div>
                    <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:8 }}>
                      <div>
                        <label style={{ fontSize:11,color:'var(--text-muted)',display:'block',marginBottom:4 }}>Mes de apertura</label>
                        <select value={ventanas.mesApertura||MES_ACTUAL} onChange={e => setVentanas(prev => ({...prev,mesApertura:parseInt(e.target.value)}))} style={{ width:'100%',padding:'7px 10px',border:'0.5px solid rgba(255,255,255,0.12)',borderRadius:6,fontSize:13,background:'#1e2130',color:'#e8eaf0',outline:'none' }}>
                          {MESES_NOMBRES.map((m,i) => <option key={i+1} value={i+1} style={{ background:'#1a1d27' }}>{m}</option>)}
                        </select>
                      </div>
                      <div>
                        <label style={{ fontSize:11,color:'var(--text-muted)',display:'block',marginBottom:4 }}>Año de apertura</label>
                        <select value={ventanas.anioApertura||ANIO_ACTUAL} onChange={e => setVentanas(prev => ({...prev,anioApertura:parseInt(e.target.value)}))} style={{ width:'100%',padding:'7px 10px',border:'0.5px solid rgba(255,255,255,0.12)',borderRadius:6,fontSize:13,background:'#1e2130',color:'#e8eaf0',outline:'none' }}>
                          {[ANIO_ACTUAL, ANIO_ACTUAL+1].map(a => <option key={a} value={a} style={{ background:'#1a1d27' }}>{a}</option>)}
                        </select>
                      </div>
                    </div>
                    <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8 }}>
                      <div>
                        <label style={{ fontSize:11,color:'var(--text-muted)',display:'block',marginBottom:4 }}>Día</label>
                        <input type="number" min="1" max="31" placeholder="Ej: 25" value={ventanas.dia} onChange={e => setVentanas(prev => ({...prev,dia:e.target.value}))} style={{ width:'100%',padding:'7px 10px',border:'0.5px solid rgba(255,255,255,0.12)',borderRadius:6,fontSize:13,background:'#1e2130',color:'#e8eaf0',outline:'none' }} />
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
                    <div style={{ marginTop:8,fontSize:10,color:'var(--text-muted)',background:'rgba(255,255,255,0.03)',padding:'8px 10px',borderRadius:6 }}>
                      {ventanas.dia
                        ? `✓ Efectivos cargarán: ${MESES_NOMBRES[(ventanas.mesVentana||MES_ACTUAL)-1]} ${ventanas.anioVentana||ANIO_ACTUAL} — Apertura: ${ventanas.dia}/${ventanas.mesApertura||MES_ACTUAL}/${ventanas.anioApertura||ANIO_ACTUAL} de ${ventanas.horaInicio} a ${ventanas.horaFin}`
                        : 'Sin ventana configurada — inscripción bloqueada'}
                    </div>
                  </div>
                  <button className="btn" style={{ width:'100%',justifyContent:'center',background:'rgba(200,168,75,0.15)',color:'#c8a84b',border:'0.5px solid rgba(200,168,75,0.4)' }} onClick={async () => {
                    const L = lugarDetectado
                    const mesV = ventanas.mesVentana || MES
                    const anioV = ventanas.anioVentana || ANIO
                    const mesAp = ventanas.mesApertura || MES
                    const anioAp = ventanas.anioApertura || ANIO
                    // Guardado por un endpoint propio con sesión de admin, que
                    // hace el upsert (buscar y luego insertar/actualizar) del
                    // lado del servidor — ver pages/api/configuracion.js.
                    try {
                      const resp = await fetch('/api/configuracion', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ lugar: L, dia: parseInt(ventanas.dia)||null, hora_inicio: ventanas.horaInicio, hora_fin: ventanas.horaFin, mes: mesV, anio: anioV, mes_apertura: mesAp, anio_apertura: anioAp }),
                      })
                      if (!resp.ok) { const b = await resp.json().catch(()=>({})); alert('No se pudo guardar la configuración: ' + (b.error || resp.status)); return }
                    } catch (e) { alert('No se pudo guardar la configuración (error de conexión).'); return }
                    localStorage.setItem(`polad_ventanas_${L}`, JSON.stringify(ventanas))
                    setVentanasGuardadas(true); setTimeout(()=>setVentanasGuardadas(false),2500)
                  }}>Guardar configuración</button>
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
                          const { asistencia: asist } = await fetch(`/api/admin-asistencia?mes=${MES}&anio=${ANIO}`).then(r => r.json()).catch(() => ({ asistencia: [] }))
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
                              <span style={{ width:8,height:8,borderRadius:'50%',background:ef.planilla_url?'#1D9E75':'#E24B4A',display:'inline-block' }}></span>
                              <span style={{ color:ef.planilla_url?'#1D9E75':'#E24B4A' }}>{ef.planilla_url?'Planilla ✓':'Sin planilla'}</span>
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
                          const res = await fetch(url)
                          if (!res.ok) { const d = await res.json().catch(()=>({})); alert('Error al generar: ' + (d.error || res.status)); return }
                          const cd = res.headers.get('Content-Disposition') || ''
                          const m = /filename="([^"]+)"/.exec(cd)
                          const nombreArchivo = m ? m[1] : `Planilla_${ef.nombre.replace(/,/g,'').replace(/\s+/g,'_')}_${APP_LUGAR}_${NOMBRE_MES}.xlsx`
                          const blob = await res.blob(); const a = document.createElement('a')
                          a.href = URL.createObjectURL(blob); a.download = nombreArchivo; a.click(); URL.revokeObjectURL(a.href)
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
                                const esp = infoDiaEspecial(f.dia, MES, ANIO)
                                if (f.entradas.length===0) return (
                                  <tr key={f.dia} style={{ opacity:0.4 }}>
                                    <td style={{ textAlign:'center',fontWeight:500,background: esp.marcar ? 'rgba(255,215,0,0.15)' : 'var(--surface2)',color: esp.marcar ? '#FFD700' : undefined }}>{f.dia}</td>
                                    <td colSpan={4} style={{ fontSize:10,color:'var(--text-hint)' }}>Sin guardia</td>
                                  </tr>
                                )
                                return f.entradas.map((e,i) => (
                                  <tr key={`${f.dia}-${i}`} style={{ background:e.confirmado?'rgba(29,158,117,0.08)':e.manual?'rgba(200,168,75,0.06)':'' }}>
                                    <td style={{ textAlign:'center',fontWeight:500,background: esp.marcar ? 'rgba(255,215,0,0.15)' : 'var(--surface2)',color: esp.marcar && i===0 ? '#FFD700' : undefined,borderTop:i===0?'2px solid var(--border2)':'' }}>{i===0?f.dia:''}</td>
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
                          <div className="panel-header"><h3>Planilla del efectivo</h3></div>
                          <div style={{ padding:12 }}>
                            {ef.planilla_url ? (
                              <div>
                                <div style={{ fontSize:11,color:'#1D9E75',marginBottom:8 }}>✅ Planilla cargada</div>
                                <div style={{ display:'flex',gap:6 }}>
                                  <a href={ef.planilla_url} download style={{ flex:1 }}>
                                    <button className="btn btn-sm" style={{ width:'100%',justifyContent:'center',fontSize:11,background:'rgba(29,158,117,0.1)',color:'#1D9E75',border:'0.5px solid rgba(29,158,117,0.3)' }}>⬇ Descargar</button>
                                  </a>
                                  <button className="btn btn-sm" style={{ flex:1,justifyContent:'center',fontSize:11 }} onClick={() => { const inp=document.createElement('input'); inp.type='file'; inp.accept='.xlsx,.ods'; inp.onchange=e=>{ if(e.target.files[0]) subirPlanillaAdmin(ef.id,ef.legajo,e.target.files[0]) }; inp.click() }}>Reemplazar</button>
                                  <button className="btn btn-sm" style={{ flex:1,justifyContent:'center',fontSize:11,color:'#F09595',borderColor:'rgba(240,149,149,0.3)' }} onClick={() => { if(confirm('¿Eliminar la planilla?')) eliminarPlanillaAdmin(ef.id,ef.legajo) }}>Eliminar</button>
                                </div>
                              </div>
                            ) : (
                              <div>
                                <div style={{ height:40,display:'flex',alignItems:'center',justifyContent:'center',marginBottom:8,border:'0.5px dashed var(--border)',borderRadius:6 }}><span style={{ fontSize:11,color:'var(--text-hint)' }}>Sin planilla cargada</span></div>
                                <button className="btn btn-sm" style={{ width:'100%',justifyContent:'center',fontSize:11,background:'rgba(29,158,117,0.1)',color:'#1D9E75',border:'0.5px solid rgba(29,158,117,0.3)' }} onClick={() => { const inp=document.createElement('input'); inp.type='file'; inp.accept='.xlsx,.ods'; inp.onchange=e=>{ if(e.target.files[0]) subirPlanillaAdmin(ef.id,ef.legajo,e.target.files[0]) }; inp.click() }}>+ Subir planilla (.xlsx / .ods)</button>
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="panel">
                          <div className="panel-header"><h3>Firma del efectivo</h3></div>
                          <div style={{ padding:12 }}>
                            {firma ? (
                              <div>
                                <img src={firma} style={{ width:'100%',maxHeight:100,objectFit:'contain',marginBottom:8,background:'white',borderRadius:4,padding:4 }} alt="firma" />
                                <div style={{ display:'flex',gap:6,marginTop:4 }}>
                                  <button className="btn btn-sm" style={{ flex:1,justifyContent:'center',fontSize:11 }} onClick={() => { const inp=document.createElement('input'); inp.type='file'; inp.accept='image/*'; inp.onchange=e=>{ if(e.target.files[0]) setFirmaEditando({ id: ef.id, legajo: ef.legajo, file: e.target.files[0] }) }; inp.click() }}>Cambiar</button>
                                  <button className="btn btn-sm" style={{ flex:1,justifyContent:'center',fontSize:11,color:'#F09595',borderColor:'rgba(240,149,149,0.3)' }} onClick={() => { if(confirm('¿Eliminar la firma?')) eliminarFirmaAdmin(ef.id,ef.legajo) }}>Eliminar</button>
                                </div>
                              </div>
                            ) : (
                              <div>
                                <div style={{ height:60,display:'flex',alignItems:'center',justifyContent:'center',marginBottom:8,border:'0.5px dashed var(--border)',borderRadius:6 }}><span style={{ fontSize:11,color:'var(--text-hint)' }}>Sin firma</span></div>
                                <button className="btn btn-sm" style={{ width:'100%',justifyContent:'center',fontSize:11,background:'rgba(200,168,75,0.1)',color:'#c8a84b',border:'0.5px solid rgba(200,168,75,0.3)' }} onClick={() => { const inp=document.createElement('input'); inp.type='file'; inp.accept='image/*'; inp.onchange=e=>{ if(e.target.files[0]) setFirmaEditando({ id: ef.id, legajo: ef.legajo, file: e.target.files[0] }) }; inp.click() }}>+ Subir firma</button>
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
          const handleDescargar = async () => {
            setDescargando('planilla')
            try {
              const url = `/api/generar-planilla?lugar=${lugarDetectado}&mes=${MES}&anio=${ANIO}`
              const r = await fetch(url)
              if (!r.ok) throw new Error('Error al generar')
              const blob = await r.blob()
              const a = document.createElement('a')
              a.href = URL.createObjectURL(blob)
              a.download = `POLAD_${lugarDetectado}_${NOMBRE_MES.replace(' ','_')}.xlsx`
              a.click()
            } catch(e) { alert('Error al generar la planilla') }
            setDescargando(null)
          }
          return (
            <div>
              <div style={{ marginBottom:20 }}>
                <h3 style={{ fontSize:15,fontWeight:500,marginBottom:6 }}>Planilla de guardia — {APP_LUGAR}</h3>
                <p style={{ fontSize:12,color:'var(--text-muted)' }}>Planilla completa de {NOMBRE_MES}, organizada por día con todos los turnos</p>
              </div>

              {/* Aviso borrador/publicado (ver comentario junto a previewPlanilla):
                  esta planilla con nombres SIEMPRE sale de la última publicación,
                  nunca del borrador que se está editando — si no coinciden, se
                  avisa ACÁ, antes de descargar, en vez de dejar que el .xlsx
                  salga desactualizado sin que nadie se entere. */}
              {previewPlanillaCargando && (
                <div style={{ fontSize:12, color:'var(--text-muted)', marginBottom:16 }}>Verificando si está al día con lo publicado...</div>
              )}
              {!previewPlanillaCargando && previewPlanilla?.error && (
                <div className="alert alert-warn" style={{ marginBottom:16 }}>No se pudo verificar si esta planilla está al día con lo publicado ({previewPlanilla.error}). Se puede descargar igual.</div>
              )}
              {!previewPlanillaCargando && previewPlanilla && !previewPlanilla.error && (
                !previewPlanilla.version_anterior ? (
                  <div className="alert alert-err" style={{ marginBottom:10 }}>
                    ⛔ Todavía no publicaste ninguna guardia de {NOMBRE_MES} ({APP_LUGAR}). Esta planilla va a salir <b>vacía</b> — la que tiene los nombres siempre sale de lo publicado, nunca del borrador. Primero publicá desde la pestaña "Guardias".
                  </div>
                ) : previewPlanilla.efectivos_afectados?.length > 0 ? (
                  <div className="alert alert-warn" style={{ marginBottom:10 }}>
                    ⚠ Hay cambios sin publicar desde la última publicación (versión {previewPlanilla.version_anterior}, {new Date(previewPlanilla.publicado_anteriormente_en).toLocaleString('es-AR')}): {previewPlanilla.efectivos_afectados.length} efectivo(s) con diferencias. Esta planilla va a reflejar esa versión publicada, <b>no</b> lo que se cargó después. Publicá de nuevo desde "Guardias" antes de descargar si querés que coincida.
                  </div>
                ) : (
                  <div className="alert alert-ok" style={{ marginBottom:16 }}>
                    ✓ Publicado y al día (versión {previewPlanilla.version_anterior}) — esta planilla coincide con lo cargado ahora mismo.
                  </div>
                )
              )}
              {!previewPlanillaCargando && previewPlanilla && !previewPlanilla.error && (!previewPlanilla.version_anterior || previewPlanilla.efectivos_afectados?.length > 0) && (
                <button className="btn btn-sm" style={{ marginBottom:16 }}
                  onClick={() => { setVista('turnos'); setPublicarResumen(null); setPublicarResultado(null); setMostrarModalPublicar(true); abrirPublicar() }}>
                  Ir a publicar guardias
                </button>
              )}

              <button disabled={!!descargando} onClick={handleDescargar}
                style={{ display:'flex',alignItems:'center',gap:12,padding:'18px 28px',borderRadius:10,border:`0.5px solid ${COLOR_APP}55`,background:descargando?`${COLOR_APP}22`:`${COLOR_APP}11`,color:COLOR_APP,cursor:descargando?'wait':'pointer',fontSize:14,fontWeight:500 }}>
                <span style={{ fontSize:22 }}>{descargando?'⏳':'⬇'}</span>
                <div style={{ textAlign:'left' }}>
                  <div>{descargando?'Generando planilla...':'Descargar planilla mensual'}</div>
                  <div style={{ fontSize:11,opacity:0.7,marginTop:3 }}>
                    {descargando?'Aguardá un momento...':`POLAD_${lugarDetectado}_${NOMBRE_MES.replace(' ','_')}.xlsx`}
                  </div>
                </div>
              </button>
            </div>
          )
        })()}

      </div>
    </div>
  )
}
