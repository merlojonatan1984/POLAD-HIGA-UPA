import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/router'
// Paso 6b (seguridad): antes esto importaba lib/supabase (cliente que
// habla DIRECTO con la base usando la clave pública/anon, visible en el
// navegador). Ahora importa lib/supabaseAdminProxy, que imita la misma
// forma de escribir (.from().select().eq()...) pero manda cada pedido a
// /api/admin-db, que es quien de verdad habla con la base, con la clave
// de servicio (nunca pública) y exigiendo una sesión de administrador
// válida. No hizo falta tocar ninguno de los lugares de este archivo que
// usan "supabase.from(...)" — solo esta línea.
import { supabase } from '../lib/supabaseAdminProxy'
import FirmaEditorModal from '../components/FirmaEditorModal'
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
async function buscarCruceOtroLugar(legajo, dia, turno, lugarPropio, mes, anio, idExcluir) {
  if (!legajo) return null
  const { data: otros } = await supabase
    .from('turnos').select('id, dia, turno, sector, legajo')
    .eq('mes', mes).eq('anio', anio).eq('legajo', legajo)
  const rangoCand = rangoTurnoGlobal(dia, turno, lugarPropio)
  for (const o of (otros || [])) {
    if (idExcluir && o.id === idExcluir) continue
    const lugarO = lugarDeSectorGlobal(o.sector)
    if (lugarO === lugarPropio) continue
    const rangoO = rangoTurnoGlobal(parseInt(o.dia), o.turno, lugarO)
    if (seSuperponenGlobal(rangoCand, rangoO)) return { dia: o.dia, turno: o.turno, sector: o.sector, lugar: lugarO }
  }
  return null
}
const SECTORES_APP = SECTORES_POR_LUGAR[APP_LUGAR] || SECTORES_POR_LUGAR['HIGA']
const ES_MODULAR = APP_LUGAR === 'MODULAR'
const TURNOS_LUGAR = ES_MODULAR ? ['m', 't', 'n'] : ['d', 'n']
const HORAS_TURNO = ES_MODULAR ? 8 : 12
const MAX_POR_SLOT = ES_MODULAR ? 2 : 2
// Cupo real por sector y turno en HIGA: Salud Mental y Llaves bajan a 1 de
// noche porque los otros 2 efectivos forman el Rondín Externo, que es 0 de
// día (no corresponde cubrirlo de día) y 2 de noche. Donde no hay
// excepción, el cupo es el de siempre (MAX_POR_SLOT). Mismo criterio que
// ya usan pages/api/generar-planilla.js y el resumen del dashboard — acá
// se aplica también a la asignación real, para que el sistema no pueda
// asignar de más en esos casos.
const CUPO_POR_SECTOR_TURNO = APP_LUGAR === 'HIGA' ? {
  'Salud Mental':   { d: 2, n: 1 },
  'Llaves':         { d: 2, n: 1 },
  'Rondin Externo': { d: 0, n: 2 },
} : {}
function cupoSlot(sector, turno) {
  const porTurno = CUPO_POR_SECTOR_TURNO[sector]
  if (porTurno && turno in porTurno) return porTurno[turno]
  return MAX_POR_SLOT
}
const TURNOS_INFO = ES_MODULAR
  ? [
      { key: 'm', label: 'Mañana 08-16', color: '#EF9F27', bg: 'rgba(239,159,39,0.15)', horario: '08:00 a 16:00' },
      // Antes Tarde usaba #AFA9EC (un violeta claro) — contra el fondo
      // oscuro se veía muy parecido al celeste de Noche (#85B7EB) y
      // costaba distinguirlos de un vistazo, en especial en el Cronograma
      // con letra chica. Se cambia a un verde (#5DCAA5, el mismo que ya se
      // usa en otras partes para "Serv. General") para que los 3 turnos de
      // MODULAR queden bien separados: naranja / verde / celeste.
      { key: 't', label: 'Tarde 16-24',  color: '#5DCAA5', bg: 'rgba(93,202,165,0.15)', horario: '16:00 a 24:00' },
      { key: 'n', label: 'Noche 23:59-08',  color: '#85B7EB', bg: 'rgba(55,138,221,0.15)', horario: '23:59 a 08:00' },
    ]
  : [
      { key: 'd', label: 'Día 08-20',    color: '#EF9F27', bg: 'rgba(239,159,39,0.15)', horario: '08:00 a 20:00' },
      { key: 'n', label: 'Noche 20-08',  color: '#85B7EB', bg: 'rgba(55,138,221,0.15)', horario: '20:00 a 08:00' },
    ]

const SEC_COLORS = { 'Salud Mental': '#378ADD', 'Giratoria': '#1D9E75', 'Llaves': '#EF9F27', 'Guardia': '#D4537E', 'Estacionamiento': '#7F77DD', 'UPA': '#D85A30', 'Modular': '#20A0B0' }
const MES_ACTUAL = new Date().getMonth() + 1
const ANIO_ACTUAL = new Date().getFullYear()
const MESES_NOMBRES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
const VISTAS = ['resumen', 'personal', 'disponibilidad', 'turnos', 'edicion', 'rapida', 'buscarLegajo', 'config', 'planillas', 'descarga']
const LABELS = { resumen: 'Resumen', personal: 'Personal', disponibilidad: 'Disponibilidad', turnos: 'Guardias', edicion: 'Edición manual', rapida: '⚡ Asignación rápida', buscarLegajo: '🔍 Buscar legajo', config: 'Configuración', planillas: 'Planillas', descarga: '⬇ Planilla Guardia' }

const COLOR_APP = APP_LUGAR === 'HIGA' ? '#AFA9EC' : APP_LUGAR === 'UPA' ? '#D85A30' : '#20A0B0'
const BG_APP   = APP_LUGAR === 'HIGA' ? 'rgba(42,37,96,0.5)' : APP_LUGAR === 'UPA' ? 'rgba(80,30,10,0.5)' : 'rgba(10,50,60,0.5)'
// Usado para armar los nombres de archivo de las fotos del rediseño
// (/higa-hero.jpg, /upa-hero.jpg, /modular-hero.jpg, etc.) — un solo lugar
// para esa convención de nombres, en vez de repetir el ternario 3 veces.
const PHG_SLUG = APP_LUGAR.toLowerCase()

// ===== Rediseño visual (HIGA, UPA y MODULAR) =====
// Íconos SVG en línea — no se agregó ninguna librería de íconos nueva
// (no había ninguna ya disponible en el proyecto), así que se dibujaron a
// mano, livianos, del mismo estilo que la vista previa aprobada. Se usan
// tanto en el menú lateral como en las tarjetas y accesos rápidos.
const PHG_ICONOS = {
  resumen: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="12" width="4" height="8"/><rect x="10" y="8" width="4" height="12"/><rect x="17" y="4" width="4" height="16"/></svg>,
  personal: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="9" cy="7" r="3.2"/><path d="M2.5 20c0-3.6 2.9-6.2 6.5-6.2s6.5 2.6 6.5 6.2"/><circle cx="17.5" cy="8" r="2.6"/><path d="M15 13.5c2.7.3 4.7 2.3 5.5 5"/></svg>,
  disponibilidad: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4.5" width="18" height="16" rx="2.5"/><path d="M3 9.5h18M8 3v3M16 3v3"/></svg>,
  turnos: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2.5l7.5 3.2v5.1c0 5-3.2 8.6-7.5 10.2-4.3-1.6-7.5-5.2-7.5-10.2V5.7z"/></svg>,
  edicion: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 20l1-4.3L15.6 5.1a1.8 1.8 0 012.6 0l.7.7a1.8 1.8 0 010 2.6L8.3 19 4 20z"/></svg>,
  rapida: <svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M13 2L3 14h7l-1 8 11-14h-7l0-6z"/></svg>,
  buscarLegajo: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M20 20l-4.8-4.8"/></svg>,
  config: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 13.5a1.7 1.7 0 00.3-1.9l1.1-1.9-1.7-1.7-1.9 1.1a1.7 1.7 0 00-1.9-.8l-.5-2.1h-2.4l-.5 2.1a1.7 1.7 0 00-1.9.8l-1.9-1.1-1.7 1.7 1.1 1.9a1.7 1.7 0 00-.3 1.9l-2.1.5v2.4l2.1.5a1.7 1.7 0 00.3 1.9l-1.1 1.9 1.7 1.7 1.9-1.1a1.7 1.7 0 001.9.8l.5 2.1h2.4l.5-2.1a1.7 1.7 0 001.9-.8l1.9 1.1 1.7-1.7-1.1-1.9a1.7 1.7 0 00.3-1.9l2.1-.5v-2.4z"/></svg>,
  planillas: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="4" y="3.5" width="16" height="17" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>,
  descarga: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 3v12m0 0l-4-4m4 4l4-4"/><path d="M4 17v2.5A1.5 1.5 0 005.5 21h13a1.5 1.5 0 001.5-1.5V17"/></svg>,
  control: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2a5 5 0 015 5v2a5 5 0 01-10 0V7a5 5 0 015-5z"/><path d="M8 11v1a4 4 0 008 0v-1M12 16v5M9 21h6"/></svg>,
  calendario: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4.5" width="18" height="16" rx="2.5"/><path d="M3 9.5h18M8 3v3M16 3v3"/></svg>,
  reloj: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg>,
  femenino: <svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 21s-7-4.6-9.5-8.8C.8 8.7 2.3 5 6 5c2.1 0 3.6 1.2 4.3 2.6C11 6.2 12.5 5 14.6 5c3.7 0 5.2 3.7 3.5 7.2C19 16.4 12 21 12 21z"/></svg>,
  masculino: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="10" cy="14" r="6"/><path d="M14.5 9.5L21 3m0 0h-5m5 0v5"/></svg>,
  noUniforme: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="4" y="7" width="16" height="13" rx="2"/><path d="M9 7V5a3 3 0 016 0v2"/></svg>,
  alerta: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>,
  mapa: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 20l-6-2V4l6 2 6-2 6 2v14l-6-2-6 2z"/><path d="M9 4v16M15 6v16"/></svg>,
  estado: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4.5" width="18" height="16" rx="2.5"/><path d="M3 9.5h18M8 3v3M16 3v3"/></svg>,
}
// Orden y etiquetas del menú lateral — mismos 11 accesos, mismas claves de
// vista y la misma función setVista()/router.push('/control') que ya usaba
// el menú de pestañas: solo cambia la presentación (lateral en vez de
// tiras horizontales), no la navegación.
const PHG_NAV_PRINCIPAL = [
  { v:'personal', label:'Personal' },
  { v:'disponibilidad', label:'Disponibilidad' },
  // Se saca "Guardias" (vista 'turnos') del menú: mostraba el cronograma
  // día por día, que ya se ve en Resumen y en la planilla para imprimir,
  // así que quedaba redundante y confundía. El botón "Generar turnos
  // automáticamente" que vivía ahí tampoco se usa (los turnos se arman
  // a mano desde Asignación rápida), así que se va junto con la pantalla.
  // La vista 'turnos' sigue en el código, solo que ya no hay forma de
  // llegar a ella desde el menú — así se puede volver atrás fácil si
  // hiciera falta.
  { v:'edicion', label:'Edición manual' },
  { v:'rapida', label:'Asignación rápida' },
]
const PHG_NAV_SECUNDARIO = [
  { v:'buscarLegajo', label:'Buscar legajo' },
  { v:'config', label:'Configuración' },
  { v:'planillas', label:'Planillas' },
  { v:'descarga', label:'Planilla Guardia' },
]

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
          <div style={{ marginBottom:8 }}>
            <label>Sexo</label>
            <select value={form.sexo||''} onChange={e => setForm({...form,sexo:e.target.value})} style={{ width:'100%',padding:'7px 10px',border:'0.5px solid rgba(255,255,255,0.12)',borderRadius:8,fontSize:13,background:'#1e2130',color:'#e8eaf0',outline:'none' }}>
              <option value="">Sin especificar</option><option value="femenino">Femenino</option><option value="masculino">Masculino</option>
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
  // Candadito de mes (pedido: "que me deje en un mes de trabajo, para no ir
  // cambiando y permitirme a cometer errores"): mesSeleccionado/anioSeleccionado
  // nunca se guardaban en ningún lado, así que al recargar la página siempre
  // arrancaban en el mes/año REAL de hoy. Con el candado activo: 1) el mes/año
  // con el que se entró la última vez se restaura solo al volver a entrar (ver
  // el useEffect de montaje, junto a polad_ventanas_), en vez de resetear al
  // mes de hoy; 2) los selectores de mes/año quedan deshabilitados mientras
  // esté puesto, para que no se toquen por error.
  const [mesBloqueado, setMesBloqueado] = useState(false)
  const MES = mesSeleccionado
  const ANIO = anioSeleccionado
  const DIAS_MES = new Date(ANIO, MES, 0).getDate()
  const NOMBRE_MES = MESES_NOMBRES[MES-1] + ' ' + ANIO
  const NOMBRE_MES_SOLO = MESES_NOMBRES[MES-1]
  const [vista, setVista] = useState('personal')
  const [efectivos, setEfectivos] = useState([])
  const [disponibilidad, setDisponibilidad] = useState({})
  const [turnos, setTurnos] = useState({})
  const [horasAsig, setHorasAsig] = useState({})
  const [loading, setLoading] = useState(true)
  const [notificados, setNotificados] = useState(new Map()) // legajo → timestamp ISO
  const [generando, setGenerando] = useState(false)
  const [msgGen, setMsgGen] = useState(null)
  const [modalTurno, setModalTurno] = useState(null)
  const [modalPersonal, setModalPersonal] = useState(null)
  const [guardandoPersonal, setGuardandoPersonal] = useState(false)
  const [msgPersonal, setMsgPersonal] = useState(null)
  const [efDetalle, setEfectivoDetalle] = useState(null)
  const [filtroDia, setFiltroDia] = useState(1)
  // Arrastrar y soltar en Edición manual (ver handleDropTurno): solo guarda
  // sobre qué puesto o efectivo está pasando el arrastre ahora mismo, para
  // resaltarlo — nada de esto se persiste, es puramente visual.
  const [dragOverKey, setDragOverKey] = useState(null)
  const [config, setConfig] = useState({ totalHoras: 2400, pctUniformados: 60, pctGeneral: 40 })
  const [ventanas, setVentanas] = useState({ dia: '', horaInicio: '08:00', horaFin: '20:00', mesVentana: MES_ACTUAL, anioVentana: ANIO_ACTUAL, mesApertura: MES_ACTUAL, anioApertura: ANIO_ACTUAL })
  const [ventanasGuardadas, setVentanasGuardadas] = useState(false)
  const [configGuardada, setConfigGuardada] = useState(false)
  const [planillaEf, setPlanillaEf] = useState(null)
  const [planillaManual, setPlanillaManual] = useState({})
  const [firmas, setFirmas] = useState({})
  const [firmaEditando, setFirmaEditando] = useState(null) // { legajo, file } o null
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
  const [rellenandoDia, setRellenandoDia] = useState(null)
  const [rapidaLista, setRapidaLista] = useState([])
  const [rapidaCargando, setRapidaCargando] = useState(false)
  const [rapidaProcesando, setRapidaProcesando] = useState(false)
  const [rapidaMsg, setRapidaMsg] = useState(null)
  const [rapidaNuevos, setRapidaNuevos] = useState([])
  // Tarjetas de "Sin guardias el mes anterior": cantidad + tipo de turno que
  // se está tipeando para cada legajo, antes de apretar "Asignar" (pedido:
  // "había colocado una opción de ponerle cantidad de días desde ahí, así en
  // cada uno que haya"). Se guarda por legajo porque puede haber varias
  // tarjetas abiertas a la vez, cada una con su propio valor.
  const [camposRapidaNuevos, setCamposRapidaNuevos] = useState({})
  const [rapida24hs, setRapida24hs] = useState(new Set())
  const [rapidaDoble, setRapidaDoble] = useState(new Set())
  const [especiales, setEspeciales] = useState([])
  const [especialesModal, setEspecialesModal] = useState(true)
  const [nuevoEspecialTipo, setNuevoEspecialTipo] = useState('24hs')
  const [nuevoEspecialLeg1, setNuevoEspecialLeg1] = useState('')
  const [nuevoEspecialLeg2, setNuevoEspecialLeg2] = useState('')
  // Puesto fijo (Paso 3B): configuración editable por efectivo de un sector (y,
  // opcionalmente, un turno) exclusivo — nunca se lo asigna en otro sector por
  // ningún mecanismo automático (Asignación rápida, Asignar guardias rápido,
  // Completar día, Generar turnos). Ver efectivo_puesto_fijo (tabla nueva).
  const [puestoFijoReglas, setPuestoFijoReglas] = useState([])
  const [puestoFijoModal, setPuestoFijoModal] = useState(true)
  const [nuevoPuestoLeg, setNuevoPuestoLeg] = useState('')
  const [nuevoPuestoSector, setNuevoPuestoSector] = useState('')
  const [nuevoPuestoTurno, setNuevoPuestoTurno] = useState('')
  // Cantidad fija de guardias (objetivo individual): en vez de que "Asignación
  // rápida" derive el objetivo de un efectivo de la cantidad del mes anterior,
  // una regla activa acá lo REEMPLAZA directamente (nunca se suma ni se resta).
  // Ver efectivo_objetivo_fijo (tabla nueva).
  const [objetivoReglas, setObjetivoReglas] = useState([])
  const [objetivoModal, setObjetivoModal] = useState(true)
  const [nuevoObjetivoLeg, setNuevoObjetivoLeg] = useState('')
  const [nuevoObjetivoCantidad, setNuevoObjetivoCantidad] = useState('')
  // Un solo panel colapsable "Reglas especiales" con pestañas para Casos
  // especiales / Puestos fijos / Cantidad fija, en vez de 3 paneles separados
  // uno debajo del otro — mismo contenido, menos altura en pantalla.
  const [reglasModal, setReglasModal] = useState(true)
  const [reglasTab, setReglasTab] = useState('especiales')
  const [buscarLegajoInput, setBuscarLegajoInput] = useState('')
  const [buscarLegajoResultado, setBuscarLegajoResultado] = useState(null)
  const [buscarLegajoCargando, setBuscarLegajoCargando] = useState(false)
  const [buscarLegajoError, setBuscarLegajoError] = useState(null)
  const [mounted, setMounted] = useState(false)
  const [lugarDetectado, setLugarDetectado] = useState(APP_LUGAR)
  const [loginAdmin, setLoginAdmin] = useState(null) // null=verificando, false=logueado, {legajo,pass,error,loading}=mostrando form
  const adminLoggedIn = useRef(false)
  // ── Disponibilidad fuera de término (solo HIGA por ahora): carga/edición
  // manual de la disponibilidad de UN efectivo, hecha por un administrador,
  // sin reabrir la ventana de inscripción general — ver abrirDispAdmin()
  // más abajo. Esta función ya se probó antes y quedó fuera del panel real
  // porque depende de una sesión de servidor que el login de abajo no
  // establecía; handleLoginAdmin ahora intenta establecerla como un
  // agregado de solo lectura, sin tocar en nada el login de siempre.
  const [modalDispAdmin, setModalDispAdmin] = useState(null) // { legajo, nombre } | null
  const [dispAdminCargando, setDispAdminCargando] = useState(false)
  const [dispAdminDiasOriginal, setDispAdminDiasOriginal] = useState({})
  const [dispAdminDias, setDispAdminDias] = useState({})
  const [dispAdminTurnosAsignados, setDispAdminTurnosAsignados] = useState([])
  const [dispAdminMotivo, setDispAdminMotivo] = useState('')
  const [dispAdminGuardando, setDispAdminGuardando] = useState(false)
  const [dispAdminResultado, setDispAdminResultado] = useState(null)
  const [dispAdminPaso, setDispAdminPaso] = useState('editar') // 'editar' | 'confirmar'

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
    // Cargar notificados del mes actual
    try {
      const nKey = `polad_notif_${MES}_${ANIO}_${lugar}`
      const saved = localStorage.getItem(nKey)
      if (saved) setNotificados(new Map(JSON.parse(saved)))
    } catch(e) {}
    const v = localStorage.getItem(`polad_ventanas_${lugar}`)
    if (v) try { setVentanas(JSON.parse(v)) } catch(e) {}
    // Candadito de mes (ver comentario junto a mesBloqueado más arriba): si
    // había un mes/año guardado con el candado puesto, se restaura ACÁ, antes
    // de cargar nada, en vez de dejar el mes/año de hoy por default.
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
    supabase.from('configuracion').select('*').eq('lugar', lugar).maybeSingle().then(({ data: cfg }) => {
      if (cfg) {
        const v2 = { dia: cfg.dia?.toString()||'', horaInicio: cfg.hora_inicio||'08:00', horaFin: cfg.hora_fin||'20:00', mesVentana: cfg.mes||now.getMonth()+1, anioVentana: cfg.anio||now.getFullYear(), mesApertura: cfg.mes_apertura||now.getMonth()+1, anioApertura: cfg.anio_apertura||now.getFullYear() }
        setVentanas(v2)
        localStorage.setItem(`polad_ventanas_${lugar}`, JSON.stringify(v2))
      }
    })
    setTimeout(() => cargarTodo(lugar), 0)
  }, [])

  // Candadito de mes: al activarlo guarda el mes/año actual (el que se estaba
  // viendo en ese momento) en localStorage y deshabilita los selectores; al
  // desactivarlo solo borra lo guardado (el mes/año con el que se estaba se
  // mantiene hasta que se cambie a mano).
  function toggleBloqueoMes() {
    if (mesBloqueado) {
      localStorage.removeItem(`polad_mes_bloqueado_${lugarDetectado}`)
      setMesBloqueado(false)
    } else {
      localStorage.setItem(`polad_mes_bloqueado_${lugarDetectado}`, JSON.stringify({ mes: mesSeleccionado, anio: anioSeleccionado }))
      setMesBloqueado(true)
    }
  }

  function marcarNotificado(legajo) {
    setNotificados(prev => {
      const next = new Map(prev)
      next.set(legajo, new Date().toISOString())
      try {
        const nKey = `polad_notif_${MES}_${ANIO}_${APP_LUGAR}`
        localStorage.setItem(nKey, JSON.stringify([...next]))
      } catch(e) {}
      return next
    })
  }

  function desmarcarNotificado(legajo) {
    setNotificados(prev => {
      const next = new Map(prev)
      next.delete(legajo)
      try {
        const nKey = `polad_notif_${MES}_${ANIO}_${APP_LUGAR}`
        localStorage.setItem(nKey, JSON.stringify([...next]))
      } catch(e) {}
      return next
    })
  }

  useEffect(() => { if (mounted && adminLoggedIn.current) cargarTodo(lugarDetectado) }, [mesSeleccionado, anioSeleccionado, mounted, lugarDetectado])
  useEffect(() => {
    if (mounted && vista === 'rapida') { cargarTodo(lugarDetectado).then(() => { cargarRapida(); cargarEspeciales(); cargarObjetivoFijo() }) }
  }, [vista, mesSeleccionado, anioSeleccionado, mounted])
  // Refresca la grilla de Disponibilidad cada vez que se entra a esa pestaña, para que no
  // quede desactualizada si alguien cargó disponibilidad después de la carga inicial de la página.
  useEffect(() => { if (mounted && adminLoggedIn.current && vista === 'disponibilidad') cargarTodo(lugarDetectado) }, [vista])

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
      const [{ data: efs }, dispRes, { data: turns }, puestoFijoRes] = await Promise.all([
        supabase.from('efectivos').select('*').eq('es_admin', false).eq('lugar', L).order('nombre'),
        fetch(`/api/admin-disponibilidad?mes=${MES}&anio=${ANIO}&lugar=${L}`).then(r => r.json()),
        supabase.from('turnos').select('*').eq('mes', MES).eq('anio', ANIO).in('sector', sectores).limit(10000),
        supabase.from('efectivo_puesto_fijo').select('*').eq('lugar', L).eq('activo', true),
      ])
      const disp = dispRes.data
      setEfectivos(efs || [])
      // Si la tabla todavía no existe en esta base (migración no aplicada), puestoFijoRes.error
      // va a venir seteado — se ignora en silencio (equivale a "sin reglas configuradas"), nunca
      // rompe la carga del resto de la pantalla por una tabla opcional que falte.
      setPuestoFijoReglas(puestoFijoRes?.data || [])
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
      if (!confirm(`Ya hay ${todosLosTurnos.length} guardia(s) cargadas en ${L0} para ${NOMBRE_MES}.\n\nEsto las va a BORRAR TODAS y las va a generar de nuevo desde cero. Esta acción no se puede deshacer.\n\n¿Confirmás que querés regenerar?`)) return
    }
    setGenerando(true); setMsgGen(null)
    const L = lugarDetectado
    const sectores = SECTORES_POR_LUGAR[L] || SECTORES_POR_LUGAR['HIGA']
    const esMod = L === 'MODULAR'
    const turnosLugar = esMod ? ['m','t','n'] : ['d','n']
    const horasTurno = esMod ? 8 : 12


    // Leer disponibilidad FRESCA desde Supabase (vía endpoint con clave de servicio,
    // para no depender de posibles políticas RLS de la clave pública)
    const { data: dispFresh } = await fetch(`/api/admin-disponibilidad?mes=${MES}&anio=${ANIO}&lugar=${L}`).then(r => r.json())

    // Construir mapa de disponibilidad
    const dispMap = {}
    ;(dispFresh || []).forEach(d => {
      const k = normLegajo(d.legajo)
      if (!dispMap[k]) dispMap[k] = {}
      dispMap[k][d.dia] = d.turno
    })

    const { error: errorBorrado } = await supabase.from('turnos').delete().eq('mes', MES).eq('anio', ANIO).in('sector', sectores)
    if (errorBorrado) { setGenerando(false); alert('❌ Error borrando guardias anteriores: ' + errorBorrado.message + '\n\nNo se generó nada nuevo, para evitar duplicar.'); return }

    const pool = efectivos.map(e => ({ ...e, hs: 0 }))
    const nuevos = []

    // Puesto fijo (Paso 3B): un efectivo con regla activa nunca entra en el pool de
    // ningún otro sector — ver filtro de candidatos más abajo.
    const fijoPorLegajo = {}
    ;(puestoFijoReglas || []).forEach(r => { fijoPorLegajo[normLegajo(r.legajo)] = { sector: r.sector, turno: r.turno || null } })

    // Ordenar días por cantidad de candidatos disponibles (días difíciles primero)
    const diasOrdenados = Array.from({ length: DIAS_MES }, (_, i) => i + 1).sort((a, b) => {
      const candA = pool.filter(e => {
        const avail = (dispMap[normLegajo(e.legajo)] || {})[a] || ''
        return turnosLugar.some(t => avail.includes(t))
      }).length
      const candB = pool.filter(e => {
        const avail = (dispMap[normLegajo(e.legajo)] || {})[b] || ''
        return turnosLugar.some(t => avail.includes(t))
      }).length
      return candA - candB
    })

    for (const dia of diasOrdenados) {
      for (const turno of turnosLugar) {
        for (const sector of sectores) {
          const candidatos = pool.filter(e => {
            const avail = (dispMap[normLegajo(e.legajo)] || {})[dia] || ''
            const yaAsignado = nuevos.some(n => n.legajo === e.legajo && n.turno === turno && n.dia === dia)
            if (!avail.includes(turno) || yaAsignado) return false
            // Puesto fijo: nunca elegir otro sector que el configurado (ni otro turno
            // si la regla especifica uno) — queda pendiente antes que asignarlo afuera.
            const fijo = fijoPorLegajo[normLegajo(e.legajo)]
            if (fijo) {
              if (fijo.sector !== sector) return false
              if (fijo.turno && fijo.turno !== turno) return false
            }
            return true
          }).sort((a, b) => a.hs - b.hs)
          candidatos.slice(0, cupoSlot(sector, turno)).forEach(e => {
            e.hs += horasTurno
            nuevos.push({ legajo: e.legajo, mes: MES, anio: ANIO, dia, turno, sector })
          })
        }
      }
    }

    for (let i = 0; i < nuevos.length; i += 500) {
      const { error } = await supabase.from('turnos').insert(nuevos.slice(i, i + 500))
      if (error) { setGenerando(false); setMsgGen(null); alert('❌ Error guardando guardias: ' + error.message + '\n\nNo se terminó de generar. Revisá antes de seguir.'); return }
    }
    setMsgGen(`Se generaron ${nuevos.length} asignaciones.`)
    await cargarTodo(L); setGenerando(false)
  }

  async function asignarGuardiasAuto(legajo, cantidad, tipoTurno) {
    setAsignando(true)
    cantidad = parseInt(cantidad) || 0
    if (cantidad <= 0) { alert('Ingresá una cantidad válida.'); setAsignando(false); return }

    const ES_MOD = lugarDetectado === 'MODULAR'
    const horasTurno = ES_MOD ? 8 : 12
    const MAX_HS = 180
    const hsActuales = horasAsig[legajo] || 0
    const hsDisponibles = MAX_HS - hsActuales
    const maxGuardiasPorTope = Math.floor(hsDisponibles / horasTurno)

    if (maxGuardiasPorTope <= 0) {
      alert(`⛔ ${efectivos.find(e=>e.legajo===legajo)?.nombre?.split(',')[0]||legajo} ya alcanzó el tope de ${MAX_HS}hs.`)
      setAsignando(false)
      return
    }
    if (cantidad > maxGuardiasPorTope) {
      cantidad = maxGuardiasPorTope
      alert(`⚠ Se ajustó la cantidad a ${cantidad} guardias para no superar el tope de ${MAX_HS}hs.\n(Tiene ${hsActuales}hs asignadas, le quedan ${hsDisponibles}hs disponibles)`)
    }

    // Puesto fijo (Paso 3B): si este efectivo tiene una regla activa, toda guardia
    // que se le asigne acá tiene que caer en su sector configurado (y en su turno,
    // si la regla especifica uno) — nunca en otro, por más libre que esté.
    const fijo = (() => {
      const r = (puestoFijoReglas || []).find(x => normLegajo(x.legajo) === normLegajo(legajo))
      return r ? { sector: r.sector, turno: r.turno || null } : null
    })()
    const nombreFijo = efectivos.find(e => e.legajo === legajo)?.nombre?.split(',')[0] || legajo
    if (fijo && fijo.turno && tipoTurno === 'doble') {
      alert(`⛔ ${nombreFijo} tiene puesto fijo en "${fijo.sector}" solo para el turno "${fijo.turno}". No se puede asignar "Todos" (24hs) porque cubre ambos turnos del día.\n\nElegí el turno "${fijo.turno}" en el selector.`)
      setAsignando(false)
      return
    }
    if (fijo && fijo.turno && tipoTurno !== fijo.turno && tipoTurno !== 'mixto') {
      alert(`⛔ ${nombreFijo} tiene puesto fijo en "${fijo.sector}" solo para el turno "${fijo.turno}". No se puede asignar el turno "${tipoTurno}".`)
      setAsignando(false)
      return
    }

    const [dispDataRes, { data: turnosEfData }, { data: turnosTodos }] = await Promise.all([
      fetch(`/api/admin-disponibilidad?mes=${MES}&anio=${ANIO}&lugar=${lugarDetectado}&legajo=${encodeURIComponent(legajo)}`).then(r => r.json()),
      supabase.from('turnos').select('dia, turno, sector').eq('legajo', legajo).eq('mes', MES).eq('anio', ANIO).in('sector', SECTORES_APP).limit(1000),
      supabase.from('turnos').select('dia, turno, sector').eq('mes', MES).eq('anio', ANIO).in('sector', SECTORES_APP).limit(10000)
    ])
    const dispData = dispDataRes.data

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

    // Verifica descanso 12hs — solo HIGA/UPA con turnos de 12hs
    function cumpleDescanso(dia, turno, asignadosHastaAhora) {
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
      // Puesto fijo: el único sector posible es el configurado — nunca se elige
      // otro por más libre que esté. Si no hay cupo ahí, este día/turno queda sin
      // asignar (pendiente), nunca "cambia de sector en silencio".
      if (fijo) {
        if (fijo.turno && fijo.turno !== turno) return null
        return (ocupacion[dia+'-'+turno+'-'+fijo.sector] || 0) < cupoSlot(fijo.sector, turno) ? fijo.sector : null
      }
      // Ordenar sectores por los menos usados primero para distribuir parejo
      const sectoresOrdenados = [...SECTORES_APP].sort((a, b) => conteoSector[a] - conteoSector[b])
      for (const s of sectoresOrdenados) {
        if ((ocupacion[dia+'-'+turno+'-'+s] || 0) < cupoSlot(s, turno)) {
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
      alert('✗ No se pudo asignar ninguna guardia. Verificá disponibilidad y slots disponibles.')
      setAsignando(false)
      return
    }

    for (let i = 0; i < nuevos.length; i += 100) {
      const { error } = await supabase.from('turnos').insert(nuevos.slice(i, i + 100))
      if (error) { setAsignando(false); alert('❌ Error guardando: ' + error.message + '\n\nEs posible que no se hayan guardado todas las guardias.'); return }
    }
    setModalAsignar(null)
    setAsignando(false)
    await cargarTodo(lugarDetectado)

    const nombre = efectivos.find(e => e.legajo === legajo)?.nombre?.split(',')[0] || legajo
    let msg = `✓ Se asignaron ${nuevos.length} guardias a ${nombre}.`
    if (nuevos.length < cantidad) {
      msg += `\n⚠ Se pedían ${cantidad} pero la disponibilidad permitió ${nuevos.length}.`
      if (fijo) msg += ` Tiene puesto fijo en "${fijo.sector}"${fijo.turno ? ` (turno "${fijo.turno}")` : ''} y no se la asigna en otro sector — el resto queda pendiente.`
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

      // Datos frescos desde Supabase: disponibilidad del día + turnos del mes
      const [dispDiaRes, { data: turnosMes }] = await Promise.all([
        fetch(`/api/admin-disponibilidad?mes=${MES}&anio=${ANIO}&dia=${dia}&lugar=${L}`).then(r => r.json()),
        supabase.from('turnos').select('legajo, dia, turno, sector').eq('mes', MES).eq('anio', ANIO).in('sector', sectores).limit(10000)
      ])
      const dispDia = dispDiaRes.data

      const ocupacion = {}
      const hsMap = {}
      const turnosPorLegajo = {}
      ;(turnosMes || []).forEach(t => {
        const k = t.dia + '-' + t.turno + '-' + t.sector
        ocupacion[k] = (ocupacion[k] || 0) + 1
        hsMap[t.legajo] = (hsMap[t.legajo] || 0) + horasTurno
        if (!turnosPorLegajo[t.legajo]) turnosPorLegajo[t.legajo] = []
        turnosPorLegajo[t.legajo].push({ dia: parseInt(t.dia), turno: t.turno })
      })

      const dispMap = {}
      ;(dispDia || []).forEach(d => { dispMap[normLegajo(d.legajo)] = d.turno || '' })

      const nuevos = []
      const nuevosPorLegajo = {}
      const faltantesPorTurno = {}

      // Puesto fijo (Paso 3B): mientras se completa el día, un efectivo con regla
      // activa solo puede entrar en SU sector (y turno, si lo especifica) — nunca en
      // otro, aunque esté libre. No les reserva el lugar: si otro efectivo sin regla
      // lo necesita, igual puede ocuparlo.
      const fijoPorLegajo = {}
      ;(puestoFijoReglas || []).forEach(r => { fijoPorLegajo[normLegajo(r.legajo)] = { sector: r.sector, turno: r.turno || null } })

      // Descanso 12hs (HIGA/UPA): no D+N el mismo día, no N→D en días seguidos
      function cumpleDescanso(legajo, diaX, turnoX) {
        if (L === 'MODULAR') return true
        const previos = [...(turnosPorLegajo[legajo] || []), ...(nuevosPorLegajo[legajo] || [])]
        if (previos.some(a => a.dia === diaX && a.turno !== turnoX)) return false
        if (turnoX === 'd' && previos.some(a => a.dia === diaX - 1 && a.turno === 'n')) return false
        if (turnoX === 'n' && previos.some(a => a.dia === diaX + 1 && a.turno === 'd')) return false
        return true
      }

      function horasDe(legajo) {
        return (hsMap[legajo] || 0) + ((nuevosPorLegajo[legajo] || []).length * horasTurno)
      }

      // Disponibles para un turno en un sector dado: con disponibilidad cargada, sin
      // duplicar, < 180hs, que cumplan descanso, y que no tengan puesto fijo en OTRO
      // sector (o en otro turno, si su regla especifica uno). Ordenados por MENOS
      // guardias primero (equilibra la carga).
      function candidatosTurno(turno, sector) {
        return efectivos.filter(e => {
          const avail = dispMap[normLegajo(e.legajo)] || ''
          if (!avail.includes(turno)) return false
          if (nuevos.some(n => n.legajo === e.legajo && n.dia === dia && n.turno === turno)) return false
          if ((turnosPorLegajo[e.legajo] || []).some(a => a.dia === dia && a.turno === turno)) return false
          if (horasDe(e.legajo) >= 180) return false
          if (!cumpleDescanso(e.legajo, dia, turno)) return false
          const fijo = fijoPorLegajo[normLegajo(e.legajo)]
          if (fijo) {
            if (fijo.sector !== sector) return false
            if (fijo.turno && fijo.turno !== turno) return false
          }
          return true
        }).sort((a, b) => horasDe(a.legajo) - horasDe(b.legajo))
      }

      for (const turno of turnosLugar) {
        // Armar la lista de lugares libres de este turno (cada sector hasta su cupo real)
        const slots = []
        for (const sector of sectores) {
          const ocup = ocupacion[dia + '-' + turno + '-' + sector] || 0
          for (let k = ocup; k < cupoSlot(sector, turno); k++) slots.push(sector)
        }
        for (const sector of slots) {
          const cands = candidatosTurno(turno, sector)
          if (cands.length === 0) { faltantesPorTurno[turno] = (faltantesPorTurno[turno] || 0) + 1; continue }
          const e = cands[0]
          nuevos.push({ legajo: e.legajo, mes: MES, anio: ANIO, dia, turno, sector })
          if (!nuevosPorLegajo[e.legajo]) nuevosPorLegajo[e.legajo] = []
          nuevosPorLegajo[e.legajo].push({ dia, turno })
          ocupacion[dia + '-' + turno + '-' + sector] = (ocupacion[dia + '-' + turno + '-' + sector] || 0) + 1
        }
      }

      const avisos = Object.entries(faltantesPorTurno).map(([tk, n]) => {
        const ti = TURNOS_INFO.find(x => x.key === tk)
        return `   • ${ti ? ti.label : tk.toUpperCase()}: faltó cubrir ${n} lugar${n > 1 ? 'es' : ''} (no hay más efectivos disponibles)`
      })

      if (nuevos.length === 0) {
        let m = `Día ${dia}: no se asignó ninguna guardia nueva.`
        m += avisos.length ? `\n\n${avisos.join('\n')}` : ` Ya estaba completo o no hay disponibilidad cargada.`
        alert(m)
        setRellenandoDia(null)
        return
      }

      for (let i = 0; i < nuevos.length; i += 100) {
        const { error } = await supabase.from('turnos').insert(nuevos.slice(i, i + 100))
        if (error) { setRellenandoDia(null); alert('❌ Error guardando: ' + error.message + '\n\nEs posible que no se hayan guardado todas las guardias.'); return }
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
    const { data } = await supabase.from('efectivos_especiales').select('*').eq('lugar', APP_LUGAR).eq('activo',true)
    const lista = data || []
    setEspeciales(lista)
    // Precargar 24hs y doble turno en sus respectivos estados
    const set24 = new Set(lista.filter(e => e.tipo === '24hs').map(e => e.legajo1))
    setRapida24hs(set24)
    const setDoble = new Set(lista.filter(e => e.tipo === 'doble').map(e => e.legajo1))
    setRapidaDoble(setDoble)
  }

  async function agregarEspecial() {
    if (!nuevoEspecialLeg1.trim()) return alert('Ingresá el legajo')
    if (nuevoEspecialTipo === 'pareja' && !nuevoEspecialLeg2.trim()) return alert('Ingresá el legajo del segundo efectivo')
    const { error } = await supabase.from('efectivos_especiales').insert({
      lugar: APP_LUGAR,
      tipo: nuevoEspecialTipo,
      legajo1: nuevoEspecialLeg1.trim(),
      legajo2: nuevoEspecialTipo === 'pareja' ? nuevoEspecialLeg2.trim() : null,
      activo: true
    })
    if (error) return alert('Error al guardar: ' + error.message + '\n\nVerificá los permisos de la tabla efectivos_especiales en Supabase.')
    setNuevoEspecialLeg1(''); setNuevoEspecialLeg2('')
    await cargarEspeciales()
  }

  async function quitarEspecial(id) {
    await supabase.from('efectivos_especiales').update({ activo: false }).eq('id', id)
    await cargarEspeciales()
  }

  async function cargarPuestoFijo() {
    const { data } = await supabase.from('efectivo_puesto_fijo').select('*').eq('lugar', APP_LUGAR).eq('activo', true)
    setPuestoFijoReglas(data || [])
  }

  async function agregarPuestoFijo() {
    if (!nuevoPuestoLeg.trim()) return alert('Seleccioná el efectivo.')
    if (!nuevoPuestoSector) return alert('Elegí el sector.')
    // A lo sumo una regla activa por legajo+lugar: si ya tenía un puesto fijo
    // configurado, se desactiva primero (nunca quedan dos activas en conflicto).
    await supabase.from('efectivo_puesto_fijo').update({ activo: false })
      .eq('lugar', APP_LUGAR).eq('legajo', nuevoPuestoLeg.trim()).eq('activo', true)
    const { error } = await supabase.from('efectivo_puesto_fijo').insert({
      lugar: APP_LUGAR,
      legajo: nuevoPuestoLeg.trim(),
      sector: nuevoPuestoSector,
      turno: nuevoPuestoTurno || null,
      activo: true,
    })
    if (error) return alert('Error al guardar: ' + error.message + '\n\nVerificá que la tabla efectivo_puesto_fijo exista en Supabase (ejecutá migracion_puesto_fijo.sql).')
    setNuevoPuestoLeg(''); setNuevoPuestoSector(''); setNuevoPuestoTurno('')
    await cargarPuestoFijo()
  }

  async function quitarPuestoFijo(id) {
    await supabase.from('efectivo_puesto_fijo').update({ activo: false }).eq('id', id)
    await cargarPuestoFijo()
  }

  async function cargarObjetivoFijo() {
    const { data } = await supabase.from('efectivo_objetivo_fijo').select('*').eq('lugar', APP_LUGAR).eq('activo', true)
    setObjetivoReglas(data || [])
  }

  async function agregarObjetivoFijo() {
    if (!nuevoObjetivoLeg.trim()) return alert('Seleccioná el efectivo.')
    const cant = parseInt(nuevoObjetivoCantidad, 10)
    if (!cant || cant <= 0) return alert('Ingresá una cantidad válida (mayor a 0).')
    // A lo sumo una regla activa por legajo+lugar: si ya tenía una cantidad fija
    // configurada, se desactiva primero (nunca quedan dos activas en conflicto).
    await supabase.from('efectivo_objetivo_fijo').update({ activo: false })
      .eq('lugar', APP_LUGAR).eq('legajo', nuevoObjetivoLeg.trim()).eq('activo', true)
    const { error } = await supabase.from('efectivo_objetivo_fijo').insert({
      lugar: APP_LUGAR,
      legajo: nuevoObjetivoLeg.trim(),
      cantidad: cant,
      activo: true,
    })
    if (error) return alert('Error al guardar: ' + error.message + '\n\nVerificá que la tabla efectivo_objetivo_fijo exista en Supabase (ejecutá migracion_objetivo_fijo.sql).')
    setNuevoObjetivoLeg(''); setNuevoObjetivoCantidad('')
    await cargarObjetivoFijo()
    await cargarRapida()
  }

  async function quitarObjetivoFijo(id) {
    await supabase.from('efectivo_objetivo_fijo').update({ activo: false }).eq('id', id)
    await cargarObjetivoFijo()
    await cargarRapida()
  }

  async function cargarRapida() {
    setRapidaCargando(true); setRapidaMsg(null)
    const L = lugarDetectado
    const sectores = SECTORES_POR_LUGAR[L] || SECTORES_POR_LUGAR['HIGA']
    const prev = mesAnteriorDe(MES, ANIO)
    const [{ data: turnosPrev }, { data: turnosAct }, { data: objetivoFijoData }] = await Promise.all([
      supabase.from('turnos').select('legajo').eq('mes', prev.mes).eq('anio', prev.anio).in('sector', sectores).limit(10000),
      supabase.from('turnos').select('legajo').eq('mes', MES).eq('anio', ANIO).in('sector', sectores).limit(10000),
      supabase.from('efectivo_objetivo_fijo').select('*').eq('lugar', L).eq('activo', true),
    ])
    const countPrev = {}; (turnosPrev || []).forEach(t => { countPrev[t.legajo] = (countPrev[t.legajo] || 0) + 1 })
    // "Cargó disponibilidad" se define acá EXACTAMENTE igual que en la grilla de Disponibilidad:
    // mismo estado 'disponibilidad', mismo criterio (al menos 1 día cargado). Antes esta pantalla
    // hacía su propia consulta aparte a la base, y aunque el filtro fuera el mismo en el papel,
    // podían llegar a mostrar cosas distintas para un mismo efectivo. Ahora usan la misma fuente,
    // así que no pueden divergir.
    const cargaron = new Set(
      Object.keys(disponibilidad).filter(legajo => Object.keys(disponibilidad[legajo] || {}).length > 0)
    )
    const countAct = {}; (turnosAct || []).forEach(t => { countAct[t.legajo] = (countAct[t.legajo] || 0) + 1 })
    // Cantidad fija (objetivo individual): si hay una regla activa para este
    // legajo+lugar, su cantidad REEMPLAZA la del mes anterior — nunca se suman
    // ni se restan entre sí. También hace que un efectivo que cargó
    // disponibilidad pero no tuvo guardias el mes pasado (antes aparecía solo
    // en "nuevos", sin objetivo) pase a la lista principal con su cantidad fija.
    const objetivoFijoPorLegajo = {}
    ;(objetivoFijoData || []).forEach(r => { objetivoFijoPorLegajo[normLegajo(r.legajo)] = r.cantidad })
    const lista = efectivos
      .filter(e => cargaron.has(normLegajo(e.legajo)) && ((countPrev[e.legajo] || 0) > 0 || objetivoFijoPorLegajo[normLegajo(e.legajo)] != null))
      .map(e => {
        const fijo = objetivoFijoPorLegajo[normLegajo(e.legajo)]
        return { legajo: e.legajo, nombre: e.nombre, objetivo: fijo != null ? fijo : countPrev[e.legajo], objetivoFijo: fijo != null, yaAsignadas: countAct[e.legajo] || 0 }
      })
      .sort((a, b) => a.nombre.localeCompare(b.nombre))
    const nuevos = efectivos
      .filter(e => cargaron.has(normLegajo(e.legajo)) && (countPrev[e.legajo] || 0) === 0 && objetivoFijoPorLegajo[normLegajo(e.legajo)] == null)
      .map(e => ({ legajo: e.legajo, nombre: e.nombre }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre))
    setRapidaNuevos(nuevos)
    setRapidaLista(lista); setRapidaCargando(false)
  }

  // ── Equilibrio entre varones y mujeres (pedido) ──
  // Solo se usa en "Asignar todos". Toma la lista de objetivos (cuántas guardias le toca a cada
  // uno) y, SIN cambiar el total de guardias, le sube la cantidad al sexo que tiene menos guardias
  // y se la baja al que tiene más, hasta que ambos sumen lo mismo. Reglas:
  //  - Nunca se toca a quien tiene "cantidad fija" ni a quien no tiene el sexo cargado en la ficha.
  //  - Nadie baja de lo que ya tiene asignado este mes, ni de 1 guardia (si tenía objetivo).
  //  - Nadie sube más allá de los días que cargó como disponibles ni del tope de 180 hs.
  //  - Si no alcanza la disponibilidad para llegar a la paridad, se llega lo más cerca posible.
  // No borra ni cambia nada ya asignado: solo cambia cuántas guardias NUEVAS se intentan asignar.
  function equilibrarObjetivos(lista) {
    const maxGuardias = Math.floor(180 / (lugarDetectado === 'MODULAR' ? 8 : 12))
    const sexoDe = {}
    efectivos.forEach(e => { sexoDe[normLegajo(e.legajo)] = String(e.sexo || '').trim().toLowerCase() })
    const grupos = { femenino: [], masculino: [] }
    let fijoF = 0, fijoM = 0
    lista.forEach((it, idx) => {
      const sx = sexoDe[normLegajo(it.legajo)]
      if (sx !== 'femenino' && sx !== 'masculino') return
      if (it.objetivoFijo) { if (sx === 'femenino') fijoF += it.objetivo; else fijoM += it.objetivo; return }
      const yaTiene = it.yaAsignadas || 0
      const dias = Object.keys(disponibilidad[normLegajo(it.legajo)] || {}).length
      const hi = Math.max(yaTiene, Math.min(maxGuardias, dias), 0)
      const lo = Math.min(hi, Math.max(yaTiene, it.objetivo > 0 ? 1 : 0))
      grupos[sx].push({ idx, w: Math.max(it.objetivo, 0), lo, hi })
    })
    const F = grupos.femenino, M = grupos.masculino
    const suma = (g, f) => g.reduce((a, x) => a + f(x), 0)
    const sinCambio = { lista, cambio: false }
    if (!F.length || !M.length) return sinCambio
    const objF = suma(F, x => x.w), objM = suma(M, x => x.w)
    const T = objF + objM
    const totF = objF + fijoF, totM = objM + fijoM
    if (totF === totM) return sinCambio

    // Reparte S guardias entre un grupo, proporcional al objetivo de cada uno y respetando mínimos y máximos.
    function repartir(g, S) {
      const sumLo = suma(g, x => x.lo), sumHi = suma(g, x => x.hi)
      S = Math.max(sumLo, Math.min(S, sumHi))
      const val = k => g.map(x => Math.min(x.hi, Math.max(x.lo, x.w * k)))
      let a = 0, b = 1000
      for (let i = 0; i < 60; i++) { const m = (a + b) / 2; if (val(m).reduce((u, v) => u + v, 0) < S) a = m; else b = m }
      const v = val(b)
      const base = v.map(Math.floor)
      let resto = S - base.reduce((u, w) => u + w, 0)
      v.map((x, i) => ({ i, f: x - Math.floor(x) })).sort((p, q) => q.f - p.f).forEach(({ i }) => {
        if (resto > 0 && base[i] < g[i].hi) { base[i]++; resto-- }
      })
      for (let pasada = 0; resto > 0 && pasada < 30; pasada++) {
        for (let i = 0; i < base.length && resto > 0; i++) if (base[i] < g[i].hi) { base[i]++; resto-- }
      }
      return base
    }

    const menor = totM < totF ? 'masculino' : 'femenino'
    const gMenor = menor === 'masculino' ? M : F
    const gMayor = menor === 'masculino' ? F : M
    const fijoMenor = menor === 'masculino' ? fijoM : fijoF
    const fijoMayor = menor === 'masculino' ? fijoF : fijoM
    const origMenor = suma(gMenor, x => x.w)
    const deseado = Math.round((T + fijoMenor + fijoMayor) / 2 - fijoMenor)
    const asigMenor = repartir(gMenor, Math.max(deseado, Math.min(origMenor, suma(gMenor, x => x.hi))))
    const asigMayor = repartir(gMayor, T - suma(asigMenor, x => x))

    const nueva = lista.map(it => ({ ...it }))
    gMenor.forEach((x, i) => { nueva[x.idx].objetivo = asigMenor[i] })
    gMayor.forEach((x, i) => { nueva[x.idx].objetivo = asigMayor[i] })
    const nuevoF = (menor === 'femenino' ? asigMenor : asigMayor).reduce((u, v) => u + v, 0) + fijoF
    const nuevoM = (menor === 'masculino' ? asigMenor : asigMayor).reduce((u, v) => u + v, 0) + fijoM
    const cambio = nueva.some((it, i) => it.objetivo !== lista[i].objetivo)
    return {
      lista: nueva, cambio,
      resumen: { antesF: totF, antesM: totM, despuesF: nuevoF, despuesM: nuevoM, personasF: F.length, personasM: M.length },
    }
  }

  // Asigna a una lista de objetivos {legajo, objetivo} respetando descanso 12hs,
  // reparto espaciado, tope 180hs y máx 2 por slot. Mantiene la ocupación compartida.
  async function procesarRapida(targets, legajos24hs = new Set(), legajosDoble = new Set(), legajosCantidadFija = null) {
    const L = lugarDetectado
    const sectores = SECTORES_POR_LUGAR[L] || SECTORES_POR_LUGAR['HIGA']
    const turnosLugar = L === 'MODULAR' ? ['m', 't', 'n'] : ['d', 'n']
    const horasTurno = L === 'MODULAR' ? 8 : 12
    const MAX_HS = 180

    const [dispAllRes, { data: turnosMes }] = await Promise.all([
      fetch(`/api/admin-disponibilidad?mes=${MES}&anio=${ANIO}&lugar=${L}`).then(r => r.json()),
      supabase.from('turnos').select('legajo, dia, turno, sector').eq('mes', MES).eq('anio', ANIO).in('sector', sectores).limit(10000),
    ])
    const dispAll = dispAllRes.data

    const ocupacion = {}
    const hsMap = {}
    const turnosPorLegajo = {}
    ;(turnosMes || []).forEach(t => {
      ocupacion[t.dia + '-' + t.turno + '-' + t.sector] = (ocupacion[t.dia + '-' + t.turno + '-' + t.sector] || 0) + 1
      hsMap[t.legajo] = (hsMap[t.legajo] || 0) + horasTurno
      if (!turnosPorLegajo[t.legajo]) turnosPorLegajo[t.legajo] = []
      turnosPorLegajo[t.legajo].push({ dia: parseInt(t.dia), turno: t.turno })
    })
    const previasPorLegajo = {}   // guardias que ya tenía cada uno ANTES de esta asignación (para informar bien)
    Object.keys(turnosPorLegajo).forEach(k => { previasPorLegajo[k] = turnosPorLegajo[k].length })

    // Cargar horas de los OTROS lugares para respetar el tope global de 180hs
    const sectoresModular = ['Modular']
    const sectoresUPA     = ['UPA']
    const sectoresHIGA    = ['Salud Mental','Giratoria','Llaves','Guardia','Estacionamiento','Rondin Externo']
    const sectoresOtros   = L === 'MODULAR' ? [...sectoresUPA, ...sectoresHIGA]
                          : L === 'UPA'     ? [...sectoresModular, ...sectoresHIGA]
                          : [...sectoresModular, ...sectoresUPA]

    const { data: turnosOtrosLugares } = await supabase
      .from('turnos').select('legajo, sector')
      .eq('mes', MES).eq('anio', ANIO).in('sector', sectoresOtros).limit(10000)

    ;(turnosOtrosLugares || []).forEach(t => {
      const hsT = sectoresModular.includes(t.sector) ? 8 : 12
      hsMap[t.legajo] = (hsMap[t.legajo] || 0) + hsT
    })

    // Cargar turnos de los DOS otros lugares (no solo del "hermano") para detectar
    // cruces de horario reales, no solo coincidencia de día.
    const { data: turnosOtrosDetalle } = await supabase
      .from('turnos').select('legajo, dia, turno, sector')
      .eq('mes', MES).eq('anio', ANIO).in('sector', sectoresOtros).limit(10000)

    function lugarDeSector(sector) {
      if (sectoresModular.includes(sector)) return 'MODULAR'
      if (sectoresUPA.includes(sector)) return 'UPA'
      return 'HIGA'
    }

    const turnosOtrosPorLegajo = {}
    ;(turnosOtrosDetalle || []).forEach(t => {
      if (!turnosOtrosPorLegajo[t.legajo]) turnosOtrosPorLegajo[t.legajo] = []
      turnosOtrosPorLegajo[t.legajo].push({ dia: parseInt(t.dia), turno: t.turno, lugarOrigen: lugarDeSector(t.sector) })
    })

    // Rango horario real de un turno, en minutos absolutos (día 1 00:00 = minuto 0),
    // para poder comparar franjas que cruzan la medianoche.
    const MIN_DIA = 24 * 60
    function rangoTurno(dia, turno, lugarTurno) {
      const base = (dia - 1) * MIN_DIA
      if (lugarTurno === 'MODULAR') {
        if (turno === 'm') return [base + 8 * 60, base + 16 * 60]
        if (turno === 't') return [base + 16 * 60, base + 24 * 60]
        // noche real: 23:59 del día X a 08:00 del día X+1 (igual que en EfectivoApp.js
        // y en la planilla impresa). Antes se calculaba como 00:00-08:00 del mismo día X,
        // 24hs antes de lo real, y por eso no detectaba cruces reales con turnos noche
        // de HIGA/UPA el mismo día.
        return [base + MIN_DIA, base + MIN_DIA + 8 * 60]
      }
      return turno === 'd' ? [base + 8 * 60, base + 20 * 60] : [base + 20 * 60, base + MIN_DIA + 8 * 60]
    }
    function seSuperponen(a, b) { return a[0] < b[1] && b[0] < a[1] }

    function conflictoOtroLugar(legajo, dia, turno) {
      const rangoCandidato = rangoTurno(dia, turno, L)
      for (const o of (turnosOtrosPorLegajo[legajo] || [])) {
        if (seSuperponen(rangoCandidato, rangoTurno(o.dia, o.turno, o.lugarOrigen))) return o
      }
      return null
    }

    const dispMap = {}
    ;(dispAll || []).forEach(d => {
      const k = normLegajo(d.legajo)
      if (!dispMap[k]) dispMap[k] = {}
      dispMap[k][parseInt(d.dia)] = d.turno
    })

    const nuevos = []
    const reporte = []
    const conflictos = []

    // Días que cada legajo debe tener libres por descanso obligatorio post-24hs o post-doble
    // turno. Se declaran acá (antes de cumpleDescanso) para que el descanso se respete tanto
    // en la Fase 1/1.25 que los genera como en la Fase 2, que antes no los consultaba.
    const diasBloqueados24hs = {} // legajo -> Set de días bloqueados por descanso post-24hs
    const diasBloqueadosDoble = {} // legajo -> Set de días bloqueados por descanso post-doble turno

    function cumpleDescanso(legajo, dia, turno) {
      const prev = turnosPorLegajo[legajo] || []
      if (prev.some(a => a.dia === dia)) return false // ya tiene algo ese día en este mismo lugar
      if ((diasBloqueados24hs[legajo] || new Set()).has(dia)) return false // descanso post-24hs
      if ((diasBloqueadosDoble[legajo] || new Set()).has(dia)) return false // descanso post-doble turno
      const conflicto = conflictoOtroLugar(legajo, dia, turno)
      if (conflicto) {
        conflictos.push({ legajo, dia, turno, lugarOrigen: conflicto.lugarOrigen, turnoOrigen: conflicto.turno, diaOrigen: conflicto.dia })
        return false
      }
      if (L !== 'MODULAR') {
        const ayer = prev.find(a => a.dia === dia - 1)
        if (ayer && ayer.turno === 'n' && turno === 'd') return false
        const manana = prev.find(a => a.dia === dia + 1)
        if (manana && turno === 'n' && manana.turno === 'd') return false
      }
      return true
    }

    // ===== Fase 0: puestos fijos configurados por administración =====
    // Un efectivo con regla activa en efectivo_puesto_fijo tiene esta fase como ÚNICA
    // fuente de guardias sueltas (salvo que esté marcado para 24hs o doble turno,
    // que se resuelven en las fases siguientes respetando igual su sector/turno). Si
    // no alcanza a cubrir todo el objetivo acá, el resto queda PENDIENTE — la Fase 2
    // ya no lo completa en otro sector (ver guardia de exclusividad más abajo).
    const asignadasFase1 = {} // legajo -> cantidad de turnos nuevos ya cubiertos en las fases 0 / 1 / 1.25 / 1.5
    const fijoPorLegajo = {}
    ;(puestoFijoReglas || []).forEach(r => { fijoPorLegajo[normLegajo(r.legajo)] = { sector: r.sector, turno: r.turno || null } })
    for (const { legajo, objetivo } of targets) {
      const fijo = fijoPorLegajo[normLegajo(legajo)]
      if (!fijo || legajos24hs.has(legajo) || legajosDoble.has(legajo)) continue

      const turnosDelFijo = fijo.turno ? [fijo.turno] : turnosLugar
      const dmap = dispMap[normLegajo(legajo)] || {}
      const diasCandidatos = Object.keys(dmap).map(d => parseInt(d)).sort((a, b) => a - b)
      const existentes = (turnosPorLegajo[legajo] || []).length
      const metaFijo = Math.max(0, objetivo - existentes)

      let asignadasFijo = 0
      for (const dia of diasCandidatos) {
        if (asignadasFijo >= metaFijo) break
        if ((turnosPorLegajo[legajo] || []).some(a => a.dia === dia)) continue
        if ((hsMap[legajo] || 0) + horasTurno > MAX_HS) break
        // Si la regla no especifica turno, probar cada turno permitido (no solo el
        // primero que tenga disponibilidad): un sector con cupo 0 de día (p.ej.
        // Rondín Externo) no debe hacer que el día entero se salte sin probar la
        // noche, que es donde realmente tiene cupo.
        const tk = turnosDelFijo.find(t =>
          (dmap[dia] || '').includes(t) && cumpleDescanso(legajo, dia, t) &&
          (ocupacion[dia + '-' + t + '-' + fijo.sector] || 0) < cupoSlot(fijo.sector, t)
        )
        if (!tk) continue

        nuevos.push({ legajo, mes: MES, anio: ANIO, dia, turno: tk, sector: fijo.sector })
        if (!turnosPorLegajo[legajo]) turnosPorLegajo[legajo] = []
        turnosPorLegajo[legajo].push({ dia, turno: tk })
        ocupacion[dia + '-' + tk + '-' + fijo.sector] = (ocupacion[dia + '-' + tk + '-' + fijo.sector] || 0) + 1
        hsMap[legajo] = (hsMap[legajo] || 0) + horasTurno
        asignadasFijo++
      }
      asignadasFase1[legajo] = (asignadasFase1[legajo] || 0) + asignadasFijo
    }

    // ===== Fase 1: efectivos marcados para guardias de 24hs (día completo, con día de descanso después) =====
    for (const { legajo, objetivo } of targets) {
      if (!legajos24hs.has(legajo)) continue

      // Puesto fijo con turno específico (solo día o solo noche) es incompatible con
      // una 24hs, que por definición cubre AMBOS turnos del día — no se asigna
      // ninguna 24hs para este efectivo, queda pendiente e informado (la Fase 2 ya
      // no lo completa en otro sector por la exclusividad del puesto fijo).
      const fijo = fijoPorLegajo[normLegajo(legajo)]
      if (fijo && fijo.turno) continue

      const dmap = dispMap[normLegajo(legajo)] || {}
      const diasCandidatos = Object.keys(dmap).map(d => parseInt(d)).sort((a, b) => a - b)
        .filter(dia => turnosLugar.every(tk => (dmap[dia] || '').includes(tk))) // debe estar disponible para TODOS los turnos ese día

      const conteoSector = {}; sectores.forEach(s => { conteoSector[s] = 0 })
      let sectorRotIdx = 0
      function getSector24(dia, turno) {
        // Puesto fijo (sin turno específico, ya descartado arriba): la 24hs debe
        // cubrirse ENTERA en ese sector — nunca repartida en otro por más libre que
        // esté. Si no hay cupo para AMBOS turnos ese día, el día queda sin asignar.
        if (fijo) {
          return (ocupacion[dia + '-' + turno + '-' + fijo.sector] || 0) < cupoSlot(fijo.sector, turno) ? fijo.sector : null
        }
        const orden = [...sectores].sort((a, b) => conteoSector[a] - conteoSector[b])
        for (const s of orden) {
          if ((ocupacion[dia + '-' + turno + '-' + s] || 0) < cupoSlot(s, turno)) { conteoSector[s]++; return s }
        }
        return null
      }

      if (!diasBloqueados24hs[legajo]) diasBloqueados24hs[legajo] = new Set()
      const costoDia = horasTurno * turnosLugar.length // 24hs siempre (2×12 o 3×8)
      let diasAsignados = 0
      const metaDias = Math.floor(objetivo / turnosLugar.length)

      for (const dia of diasCandidatos) {
        if (diasAsignados >= metaDias) break
        if ((hsMap[legajo] || 0) + costoDia > MAX_HS) continue
        if ((turnosPorLegajo[legajo] || []).some(a => a.dia === dia)) continue
        if (diasBloqueados24hs[legajo].has(dia)) continue // día reservado como descanso de una 24hs anterior

        const conflicto = turnosLugar.map(tk => conflictoOtroLugar(legajo, dia, tk)).find(Boolean)
        if (conflicto) {
          conflictos.push({ legajo, dia, turno: '24hs', lugarOrigen: conflicto.lugarOrigen, turnoOrigen: conflicto.turno, diaOrigen: conflicto.dia })
          continue
        }

        const sectoresDelDia = turnosLugar.map(tk => getSector24(dia, tk))
        if (sectoresDelDia.some(s => !s)) continue // no hay cupo de sector para completar el día entero

        turnosLugar.forEach((tk, i) => {
          nuevos.push({ legajo, mes: MES, anio: ANIO, dia, turno: tk, sector: sectoresDelDia[i] })
          if (!turnosPorLegajo[legajo]) turnosPorLegajo[legajo] = []
          turnosPorLegajo[legajo].push({ dia, turno: tk })
          ocupacion[dia + '-' + tk + '-' + sectoresDelDia[i]] = (ocupacion[dia + '-' + tk + '-' + sectoresDelDia[i]] || 0) + 1
        })
        hsMap[legajo] = (hsMap[legajo] || 0) + costoDia
        diasBloqueados24hs[legajo].add(dia + 1) // el día siguiente queda de descanso obligatorio
        diasAsignados++
      }
      asignadasFase1[legajo] = diasAsignados * turnosLugar.length
    }

    // ===== Fase 1.25: doble turno (solo MODULAR) — Mañana+Tarde o Tarde+Noche seguidas
    // (16hs), con el día siguiente de descanso obligatorio, igual que el de 24hs. Un
    // legajo marcado para 24hs no se procesa acá para no duplicar/pisar esa asignación.
    const PARES_DOBLE = [['m', 't'], ['t', 'n']]
    if (L === 'MODULAR') {
      for (const { legajo, objetivo } of targets) {
        if (!legajosDoble.has(legajo) || legajos24hs.has(legajo)) continue

        // Puesto fijo con turno específico es incompatible con doble turno (que cubre
        // 2 de los 3 turnos del día) — no se asigna ningún doble turno para este
        // efectivo, queda pendiente e informado.
        const fijo = fijoPorLegajo[normLegajo(legajo)]
        if (fijo && fijo.turno) continue

        const dmap = dispMap[normLegajo(legajo)] || {}
        const diasCandidatos = Object.keys(dmap).map(d => parseInt(d)).sort((a, b) => a - b)

        if (!diasBloqueadosDoble[legajo]) diasBloqueadosDoble[legajo] = new Set()
        const costoDia = horasTurno * 2 // 16hs
        let diasAsignados = 0
        const metaDias = Math.floor(objetivo / 2)

        for (const dia of diasCandidatos) {
          if (diasAsignados >= metaDias) break
          if ((hsMap[legajo] || 0) + costoDia > MAX_HS) continue
          if ((turnosPorLegajo[legajo] || []).some(a => a.dia === dia)) continue
          if (diasBloqueadosDoble[legajo].has(dia)) continue // día reservado como descanso de un doble turno anterior

          const dispDia = dmap[dia] || ''
          const par = PARES_DOBLE.find(([t1, t2]) =>
            dispDia.includes(t1) && dispDia.includes(t2) &&
            cumpleDescanso(legajo, dia, t1) && cumpleDescanso(legajo, dia, t2)
          )
          if (!par) continue

          // Puesto fijo (sin turno específico, ya descartado arriba): el doble turno
          // completo tiene que caer en ese único sector — nunca se reparte en otro.
          const sector = fijo
            ? (((ocupacion[dia + '-' + par[0] + '-' + fijo.sector] || 0) < cupoSlot(fijo.sector, par[0]) &&
                (ocupacion[dia + '-' + par[1] + '-' + fijo.sector] || 0) < cupoSlot(fijo.sector, par[1]))
                ? fijo.sector : null)
            : sectores.find(s =>
                (ocupacion[dia + '-' + par[0] + '-' + s] || 0) < cupoSlot(s, par[0]) &&
                (ocupacion[dia + '-' + par[1] + '-' + s] || 0) < cupoSlot(s, par[1])
              )
          if (!sector) continue

          par.forEach(tk => {
            nuevos.push({ legajo, mes: MES, anio: ANIO, dia, turno: tk, sector })
            if (!turnosPorLegajo[legajo]) turnosPorLegajo[legajo] = []
            turnosPorLegajo[legajo].push({ dia, turno: tk })
            ocupacion[dia + '-' + tk + '-' + sector] = (ocupacion[dia + '-' + tk + '-' + sector] || 0) + 1
          })
          hsMap[legajo] = (hsMap[legajo] || 0) + costoDia
          diasBloqueadosDoble[legajo].add(dia + 1) // el día siguiente queda de descanso obligatorio
          diasAsignados++
        }
        asignadasFase1[legajo] = (asignadasFase1[legajo] || 0) + diasAsignados * 2
      }
    }

    // ===== Fase 1.5: parejas — a los marcados como "pareja" en Casos especiales se les
    // asigna siempre el mismo día + mismo turno + mismo sector, ocupando entre los dos
    // el puesto completo (MAX_POR_SLOT = 2). Solo se emparejan si AMBOS integrantes están
    // en esta misma tanda (targets); si falta alguno, cada uno sigue el circuito normal
    // de la Fase 2 sin coordinación con su pareja.
    const objetivoPorLegajo = {}
    targets.forEach(t => { objetivoPorLegajo[t.legajo] = t.objetivo })
    const parejasActivas = (especiales || []).filter(e => e.tipo === 'pareja')
    const yaEmparejado = new Set()
    for (const pareja of parejasActivas) {
      const a = String(pareja.legajo1), b = String(pareja.legajo2)
      if (yaEmparejado.has(a) || yaEmparejado.has(b)) continue
      if (!(a in objetivoPorLegajo) || !(b in objetivoPorLegajo)) continue // ambos deben estar en esta tanda
      // Puesto fijo (Paso 3B): si cualquiera de los dos tiene una regla activa, no se
      // los empareja automáticamente (cada uno ya tuvo su chance en la Fase 0, en su
      // propio sector) — evita tener que elegir en silencio el sector de uno de los dos.
      if (fijoPorLegajo[normLegajo(a)] || fijoPorLegajo[normLegajo(b)]) continue
      yaEmparejado.add(a); yaEmparejado.add(b)

      const metaPareja = Math.min(objetivoPorLegajo[a], objetivoPorLegajo[b])
      const dmapA = dispMap[normLegajo(a)] || {}
      const dmapB = dispMap[normLegajo(b)] || {}
      const diasComunes = Object.keys(dmapA).map(d => parseInt(d)).filter(d => dmapB[d]).sort((x, y) => x - y)

      let asignadasPareja = 0
      for (const dia of diasComunes) {
        if (asignadasPareja >= metaPareja) break
        if ((hsMap[a] || 0) + horasTurno > MAX_HS || (hsMap[b] || 0) + horasTurno > MAX_HS) continue
        const turnoOk = turnosLugar.find(tk =>
          (dmapA[dia] || '').includes(tk) && (dmapB[dia] || '').includes(tk) &&
          cumpleDescanso(a, dia, tk) && cumpleDescanso(b, dia, tk)
        )
        if (!turnoOk) continue
        // Necesitan un puesto completamente libre para entrar juntos los dos
        const sectorLibre = sectores.find(s => (ocupacion[dia + '-' + turnoOk + '-' + s] || 0) === 0 && cupoSlot(s, turnoOk) >= 2)
        if (!sectorLibre) continue

        ;[a, b].forEach(legajo => {
          nuevos.push({ legajo, mes: MES, anio: ANIO, dia, turno: turnoOk, sector: sectorLibre })
          if (!turnosPorLegajo[legajo]) turnosPorLegajo[legajo] = []
          turnosPorLegajo[legajo].push({ dia, turno: turnoOk })
          hsMap[legajo] = (hsMap[legajo] || 0) + horasTurno
        })
        ocupacion[dia + '-' + turnoOk + '-' + sectorLibre] = 2
        asignadasFase1[a] = (asignadasFase1[a] || 0) + 1
        asignadasFase1[b] = (asignadasFase1[b] || 0) + 1
        asignadasPareja++
      }
    }

    // ===== Fase 2: asignación normal (turno por turno) para completar lo que falte =====
    // Incluye también a los marcados para 24hs: si la Fase 1 no les cubrió todo su objetivo
    // (o no les armó ningún bloque, p.ej. por falta de disponibilidad de día completo),
    // acá se completa con turnos sueltos en vez de dejarlos sin nada.
    //
    // EQUILIBRIO (pedido): se aplican dos preferencias, en este orden de importancia:
    //   1) En cada turno tiene que haber al menos un Uniformado (el personal de Serv. General
    //      y Destacamento no porta arma y no puede cubrir un turno solo).
    //   2) Reparto parejo de sexos dentro de cada turno, contando a TODO el personal.
    // Son preferencias de ORDEN: nunca cambian cuántas guardias tiene cada persona ni los días
    // que cargó como disponibles, y nunca dejan un turno sin cubrir por perseguir el equilibrio
    // (si ese día solo hay un sexo o ningún uniformado disponible, se asigna igual).
    const infoPorLegajo = {}
    ;(efectivos || []).forEach(e => {
      infoPorLegajo[normLegajo(e.legajo)] = { tipo: e.tipo, sexo: String(e.sexo || '').trim().toLowerCase() }
    })
    const tipoDe = l => infoPorLegajo[normLegajo(l)]?.tipo || null
    const sexoDe = l => { const x = infoPorLegajo[normLegajo(l)]?.sexo; return (x === 'femenino' || x === 'masculino') ? x : null }
    // Cuenta, por día+turno, cuántas mujeres, varones y uniformados hay ya asignados
    // (lo que había antes + lo que ya se asignó en esta corrida).
    function calcularBalance() {
      const b = {}
      Object.keys(turnosPorLegajo).forEach(leg => {
        const esUnif = tipoDe(leg) === 'Uniformado'
        const sx = sexoDe(leg)
        ;(turnosPorLegajo[leg] || []).forEach(a => {
          const k = a.dia + '-' + a.turno
          if (!b[k]) b[k] = { femenino: 0, masculino: 0, uniformados: 0 }
          if (sx) b[k][sx]++
          if (esUnif) b[k].uniformados++
        })
      })
      return b
    }
    // Orden de procesamiento: primero los Uniformados (así tienen primera elección de días y
    // se asegura uno por turno), intercalando mujeres y varones; después el resto, también
    // intercalado. Antes se recorría `targets` en el orden en que vinieron.
    function intercalarPorSexo(lista) {
      const f = lista.filter(t => sexoDe(t.legajo) === 'femenino')
      const m = lista.filter(t => sexoDe(t.legajo) === 'masculino')
      const x = lista.filter(t => !sexoDe(t.legajo))
      const out = []
      const max = Math.max(f.length, m.length)
      for (let i = 0; i < max; i++) { if (f[i]) out.push(f[i]); if (m[i]) out.push(m[i]) }
      return [...out, ...x]
    }
    // Los efectivos con CANTIDAD FIJA (la que pone el administrador en Reglas especiales) van
    // primero de todos, sean o no uniformados, para que consigan exactamente esa cantidad antes
    // de que se ocupen los lugares; después el resto, de los que más guardias tienen a los que menos.
    const esCantidadFija = t => !!(legajosCantidadFija && legajosCantidadFija.has(t.legajo))
    const targetsFase2 = [
      ...targets.filter(esCantidadFija).sort((a, b) => b.objetivo - a.objetivo),
      ...intercalarPorSexo(targets.filter(t => !esCantidadFija(t) && tipoDe(t.legajo) === 'Uniformado').sort((a, b) => b.objetivo - a.objetivo)),
      ...intercalarPorSexo(targets.filter(t => !esCantidadFija(t) && tipoDe(t.legajo) !== 'Uniformado').sort((a, b) => b.objetivo - a.objetivo)),
    ]
    // Fines de semana y feriados se cubren primero, y después el resto de los días.
    // Cada efectivo aporta a los fines de semana/feriados la misma proporción que ellos
    // tienen en el mes (por ejemplo 11 de 31 días ≈ 35 % de sus guardias).
    const diasDelMes = new Date(ANIO, MES, 0).getDate()
    const esDiaPrimero = dia => infoDiaEspecial(dia, MES, ANIO).marcar
    let diasPrimero = 0
    for (let d = 1; d <= diasDelMes; d++) if (esDiaPrimero(d)) diasPrimero++
    const fraccionPrimero = diasPrimero / diasDelMes
    const extraPrimero = {}   // legajo -> guardias que ya se le dieron en la primera pasada
    const conteosPersona = {} // legajo -> reparto por sector/turno, se conserva entre las dos pasadas

    const movibles = new Set() // guardias creadas en esta corrida por la Fase 2 (las únicas que se pueden reacomodar)
    for (const pasada of ['primero', 'resto']) {
    for (const { legajo, objetivo } of targetsFase2) {
      // Puesto fijo (Paso 3B, "Bug 5"): un efectivo con regla activa ya agotó su única
      // fuente de guardias en las fases anteriores (solo, en 24hs o en doble turno,
      // siempre en SU sector). Si no llegó al objetivo, queda PENDIENTE e informado —
      // esta fase ya NO lo completa en el resto de los sectores.
      if (fijoPorLegajo[normLegajo(legajo)]) {
        if (pasada === 'resto') reporte.push({ legajo, objetivo, asignadas: asignadasFase1[legajo] || 0, previas: previasPorLegajo[legajo] || 0, dias: Object.keys(dispMap[normLegajo(legajo)] || {}).length })
        continue
      }

      const hsActuales = hsMap[legajo] || 0
      const cupoPorTope = Math.floor((MAX_HS - hsActuales) / horasTurno)
      const metaTotal = Math.max(0, Math.min(objetivo - (turnosPorLegajo[legajo] || []).length, cupoPorTope))
      const meta = pasada === 'primero' ? Math.min(metaTotal, Math.ceil(metaTotal * fraccionPrimero)) : metaTotal

      const dmap = dispMap[normLegajo(legajo)] || {}
      const diasCandidatos = Object.keys(dmap).map(d => parseInt(d)).sort((a, b) => a - b)
        .map(dia => ({ dia, turno: dmap[dia] }))
        .filter(({ dia, turno }) => turnosLugar.some(tk => turno.includes(tk)))
        .filter(({ dia }) => pasada !== 'primero' || esDiaPrimero(dia))

      if (!conteosPersona[legajo]) {
        conteosPersona[legajo] = { s: {}, t: {} }
        sectores.forEach(x => { conteosPersona[legajo].s[x] = 0 })
        turnosLugar.forEach(tk => { conteosPersona[legajo].t[tk] = 0 })
      }
      const conteoSector = conteosPersona[legajo].s
      const conteoTurnos = conteosPersona[legajo].t
      function getSector(dia, turno) {
        const orden = [...sectores].sort((a, b) => conteoSector[a] - conteoSector[b])
        for (const s of orden) {
          if ((ocupacion[dia + '-' + turno + '-' + s] || 0) < cupoSlot(s, turno)) { conteoSector[s]++; return s }
        }
        return null
      }

      const balance = calcularBalance()
      const sexoEf = sexoDe(legajo)
      const esUnif = tipoDe(legajo) === 'Uniformado'
      const opuesto = sexoEf === 'femenino' ? 'masculino' : 'femenino'
      // Puntaje de un día+turno para esta persona (mayor = mejor lugar para ponerla).
      function puntosTurno(dia, tk) {
        const c = balance[dia + '-' + tk]
        const sinUnif = !c || c.uniformados === 0
        let p = 0
        if (esUnif && sinUnif) p += 1000   // un Uniformado va primero a los turnos que todavía no tienen ninguno
        if (!esUnif && sinUnif) p -= 500   // alguien sin arma, a los turnos donde ya hay un Uniformado
        if (sexoEf && c) p += c[opuesto] - c[sexoEf] // se completa el sexo que falta
        return p
      }
      function prioridadDia({ dia, turno: dispTurno }) {
        let mejor = -Infinity
        turnosLugar.forEach(tk => { if (dispTurno.includes(tk)) mejor = Math.max(mejor, puntosTurno(dia, tk)) })
        return mejor
      }

      const asignadasPrevias = (asignadasFase1[legajo] || 0) + (extraPrimero[legajo] || 0)
      let asignadas = asignadasPrevias
      const probados = new Set()
      // Intenta asignar un día; devuelve true si lo logró.
      function intentarDia({ dia, turno: dispTurno }) {
        const turnosOk = turnosLugar.filter(tk =>
          dispTurno.includes(tk) &&
          !(turnosPorLegajo[legajo] || []).some(a => a.dia === dia && a.turno === tk) &&
          cumpleDescanso(legajo, dia, tk)
        )
        if (turnosOk.length === 0) return false
        // Entre los turnos posibles ese día, el que más ayuda al equilibrio; si empatan, el menos usado.
        // Se prueba primero el turno que más ayuda; si ese turno ya no tiene lugar, se prueba el otro.
        const ordenados = turnosOk.sort((a, b) => (puntosTurno(dia, b) - puntosTurno(dia, a)) || (conteoTurnos[a] - conteoTurnos[b]))
        let tk = null, s = null
        for (const t of ordenados) {
          const ss = getSector(dia, t)
          if (ss) { tk = t; s = ss; break }
        }
        if (!s) return false
        const guardiaNueva = { legajo, mes: MES, anio: ANIO, dia, turno: tk, sector: s }
        nuevos.push(guardiaNueva)
        movibles.add(guardiaNueva)
        if (!turnosPorLegajo[legajo]) turnosPorLegajo[legajo] = []
        turnosPorLegajo[legajo].push({ dia, turno: tk })
        ocupacion[dia + '-' + tk + '-' + s] = (ocupacion[dia + '-' + tk + '-' + s] || 0) + 1
        conteoTurnos[tk]++
        hsMap[legajo] = (hsMap[legajo] || 0) + horasTurno
        const k = dia + '-' + tk
        if (!balance[k]) balance[k] = { femenino: 0, masculino: 0, uniformados: 0 }
        if (sexoEf) balance[k][sexoEf]++
        if (esUnif) balance[k].uniformados++
        asignadas++
        return true
      }
      // Se reparte a lo largo del mes como antes: el mes se divide en tantos tramos como
      // guardias faltan, y en cada tramo se prueba primero el día que mejor equilibra.
      const faltan = () => meta - (asignadas - asignadasPrevias)
      if (meta > 0 && diasCandidatos.length > 0) {
        const tramos = Math.min(meta, diasCandidatos.length)
        for (let t = 0; t < tramos && faltan() > 0; t++) {
          const desde = Math.floor(t * diasCandidatos.length / tramos)
          const hasta = Math.floor((t + 1) * diasCandidatos.length / tramos)
          const tramo = diasCandidatos.slice(desde, hasta).sort((x, y) => prioridadDia(y) - prioridadDia(x))
          for (const d of tramo) {
            if (probados.has(d.dia)) continue
            probados.add(d.dia)
            if (intentarDia(d)) break
          }
        }
        // Si algún tramo no pudo asignar, se completa con los días que quedaron sin probar.
        if (faltan() > 0) {
          const resto = diasCandidatos.filter(d => !probados.has(d.dia)).sort((x, y) => prioridadDia(y) - prioridadDia(x))
          for (const d of resto) {
            if (faltan() <= 0) break
            probados.add(d.dia)
            intentarDia(d)
          }
        }
      }
      if (pasada === 'primero') extraPrimero[legajo] = asignadas - (asignadasFase1[legajo] || 0)
      else reporte.push({ legajo, objetivo, asignadas, previas: previasPorLegajo[legajo] || 0, dias: Object.keys(dispMap[normLegajo(legajo)] || {}).length })
    }
    }

    // ===== Fase 3: completar a los que quedaron cortos =====
    // Si a alguien le faltan guardias porque los lugares de sus días ya se llenaron, se busca
    // a otro efectivo de ESTA MISMA corrida que ocupe uno de esos lugares y pueda pasar a otro
    // día/turno con lugar libre (y que esté disponible ese día): él mantiene su cantidad y el
    // que estaba corto se completa. Solo se mueven guardias recién creadas por esta asignación;
    // nada de lo que ya estaba asignado se modifica. Se respeta descanso, tope de horas y que
    // haya un Uniformado en cada turno (el que entra es del mismo tipo que el que sale).
    {
      const libreSector = (dia, t) => sectores.find(x => (ocupacion[dia + '-' + t + '-' + x] || 0) < cupoSlot(x, t)) || null
      const sinChoque = (leg, dia, t) => {
        const prev = turnosPorLegajo[leg] || []
        if (prev.some(a => a.dia === dia)) return false
        if ((diasBloqueados24hs[leg] || new Set()).has(dia)) return false
        if ((diasBloqueadosDoble[leg] || new Set()).has(dia)) return false
        if (conflictoOtroLugar(leg, dia, t)) return false
        if (L !== 'MODULAR') {
          const ayer = prev.find(a => a.dia === dia - 1)
          if (ayer && ayer.turno === 'n' && t === 'd') return false
          const manana = prev.find(a => a.dia === dia + 1)
          if (manana && t === 'n' && manana.turno === 'd') return false
        }
        return true
      }
      const quitarDe = (leg, dia, t) => { turnosPorLegajo[leg] = (turnosPorLegajo[leg] || []).filter(a => !(a.dia === dia && a.turno === t)) }
      const faltaLeg = leg => (turnosPorLegajo[leg] || []).length < (objetivoPorLegajo[leg] ?? 0) && (hsMap[leg] || 0) + horasTurno <= MAX_HS
      const cortos = targetsFase2.filter(t => !fijoPorLegajo[normLegajo(t.legajo)] && !legajos24hs.has(t.legajo) && !legajosDoble.has(t.legajo))
      for (const { legajo: P } of cortos) {
        let seguir = true
        while (seguir && faltaLeg(P)) {
          seguir = false
          const dmapP = dispMap[normLegajo(P)] || {}
          const dias = Object.keys(dmapP).map(d => parseInt(d)).sort((a, b) => (esDiaPrimero(b) - esDiaPrimero(a)) || (a - b))
          const unifP = tipoDe(P) === 'Uniformado', sexoP = sexoDe(P)
          buscar:
          for (const dia of dias) {
            for (const t of turnosLugar) {
              if (!(dmapP[dia] || '').includes(t) || !sinChoque(P, dia, t)) continue
              let sectorP = libreSector(dia, t)
              let movida = null
              if (!sectorP) {
                // Lugar lleno: ver si alguno de los que lo ocupan puede pasar a otro lado.
                const ocupantes = nuevos
                  .filter(g => movibles.has(g) && g.dia === dia && g.turno === t && g.legajo !== P &&
                    !legajos24hs.has(g.legajo) && !legajosDoble.has(g.legajo) && !fijoPorLegajo[normLegajo(g.legajo)] &&
                    (tipoDe(g.legajo) === 'Uniformado') === unifP)
                  .sort((a, b) => (sexoDe(b.legajo) === sexoP) - (sexoDe(a.legajo) === sexoP))
                for (const g of ocupantes) {
                  const Q = g.legajo
                  const dmapQ = dispMap[normLegajo(Q)] || {}
                  quitarDe(Q, g.dia, g.turno)
                  let destino = null
                  for (const d2 of Object.keys(dmapQ).map(x => parseInt(x)).sort((a, b) => a - b)) {
                    for (const t2 of turnosLugar) {
                      if ((d2 === dia && t2 === t) || !(dmapQ[d2] || '').includes(t2) || !sinChoque(Q, d2, t2)) continue
                      const s2 = libreSector(d2, t2)
                      if (s2) { destino = { d2, t2, s2 }; break }
                    }
                    if (destino) break
                  }
                  if (!destino) { turnosPorLegajo[Q].push({ dia: g.dia, turno: g.turno }); continue }
                  // Mover a Q a su nuevo lugar y dejar libre el suyo para P.
                  sectorP = g.sector
                  ocupacion[dia + '-' + t + '-' + g.sector]--
                  g.dia = destino.d2; g.turno = destino.t2; g.sector = destino.s2
                  ocupacion[destino.d2 + '-' + destino.t2 + '-' + destino.s2] = (ocupacion[destino.d2 + '-' + destino.t2 + '-' + destino.s2] || 0) + 1
                  turnosPorLegajo[Q].push({ dia: destino.d2, turno: destino.t2 })
                  movida = g
                  break
                }
              }
              if (!sectorP) continue
              const guardiaP = { legajo: P, mes: MES, anio: ANIO, dia, turno: t, sector: sectorP }
              nuevos.push(guardiaP); movibles.add(guardiaP)
              if (!turnosPorLegajo[P]) turnosPorLegajo[P] = []
              turnosPorLegajo[P].push({ dia, turno: t })
              ocupacion[dia + '-' + t + '-' + sectorP] = (ocupacion[dia + '-' + t + '-' + sectorP] || 0) + 1
              hsMap[P] = (hsMap[P] || 0) + horasTurno
              const rr = reporte.find(r => r.legajo === P)
              if (rr) rr.asignadas++
              seguir = true
              break buscar
            }
          }
        }
      }


      // ===== Fase 5: cubrir todo lo posible =====
      // Con todos ya asignados a su cantidad, los lugares que sigan vacíos se llenan con efectivos
      // que tengan disponibilidad ese día. Se recorre de los que MÁS guardias tienen a los que
      // menos, dándole una guardia más a cada uno por vuelta (así ninguno se lleva todo) hasta
      // que no quede lugar posible. En cada caso se elige el mejor día automáticamente: primero
      // fines de semana y feriados, después el que más ayuda a tener un uniformado y a igualar
      // mujeres y varones, y evitando días pegados a otra guardia suya. Respeta descanso y tope de
      // 180 hs. NO se les suma a quien tiene cantidad fija, ni a los de puesto fijo, 24hs, doble
      // turno o pareja: esos quedan exactamente como se configuraron.
      if (legajosCantidadFija) {
        const enEspeciales = new Set()
        ;(especiales || []).forEach(e => { if (e.legajo1) enEspeciales.add(String(e.legajo1)); if (e.legajo2) enEspeciales.add(String(e.legajo2)) })
        const aptos = targetsFase2.map(t => t.legajo).filter(leg =>
          !fijoPorLegajo[normLegajo(leg)] && !legajos24hs.has(leg) && !legajosDoble.has(leg) &&
          !legajosCantidadFija.has(leg) && !enEspeciales.has(String(leg)))
        const bal5 = calcularBalance()
        const vecinas5 = (leg, dia) => (turnosPorLegajo[leg] || []).filter(a => a.dia === dia - 1 || a.dia === dia + 1).length
        for (let vuelta = 0; vuelta < 20; vuelta++) {
          let diouna = false
          const orden = [...aptos].sort((a, b) => ((turnosPorLegajo[b] || []).length - (turnosPorLegajo[a] || []).length))
          for (const leg of orden) {
            if ((hsMap[leg] || 0) + horasTurno > MAX_HS) continue
            const dm = dispMap[normLegajo(leg)] || {}
            const esUnif = tipoDe(leg) === 'Uniformado', sx = sexoDe(leg)
            const op = sx === 'femenino' ? 'masculino' : 'femenino'
            let mejor = null
            for (const dia of Object.keys(dm).map(d => parseInt(d))) {
              for (const t of turnosLugar) {
                if (!(dm[dia] || '').includes(t) || !sinChoque(leg, dia, t)) continue
                const libres = sectores.filter(x => (ocupacion[dia + '-' + t + '-' + x] || 0) < cupoSlot(x, t))
                if (libres.length === 0) continue
                const c = bal5[dia + '-' + t]
                const sinUnif = !c || c.uniformados === 0
                let p = 0
                if (esDiaPrimero(dia)) p += 5000
                if (esUnif && sinUnif) p += 1000
                if (!esUnif && sinUnif) p -= 500
                if (sx && c) p += 10 * (c[op] - c[sx])
                p -= 30 * vecinas5(leg, dia)
                if (!mejor || p > mejor.p) mejor = { dia, t, p, libres }
              }
            }
            if (!mejor) continue
            const cp = conteosPersona[leg] ? conteosPersona[leg].s : {}
            const sectorX = mejor.libres.sort((a, b) => (cp[a] || 0) - (cp[b] || 0))[0]
            const g = { legajo: leg, mes: MES, anio: ANIO, dia: mejor.dia, turno: mejor.t, sector: sectorX }
            nuevos.push(g); movibles.add(g)
            if (!turnosPorLegajo[leg]) turnosPorLegajo[leg] = []
            turnosPorLegajo[leg].push({ dia: mejor.dia, turno: mejor.t })
            ocupacion[mejor.dia + '-' + mejor.t + '-' + sectorX] = (ocupacion[mejor.dia + '-' + mejor.t + '-' + sectorX] || 0) + 1
            hsMap[leg] = (hsMap[leg] || 0) + horasTurno
            if (conteosPersona[leg]) conteosPersona[leg].s[sectorX] = (conteosPersona[leg].s[sectorX] || 0) + 1
            const k5 = mejor.dia + '-' + mejor.t
            if (!bal5[k5]) bal5[k5] = { femenino: 0, masculino: 0, uniformados: 0 }
            if (sx) bal5[k5][sx]++
            if (esUnif) bal5[k5].uniformados++
            const rr = reporte.find(r => r.legajo === leg)
            if (rr) rr.asignadas++
            diouna = true
          }
          if (!diouna) break
        }
      }

      // ===== Fase 4: pulido del equilibrio entre mujeres y varones =====
      // Se intercambian de lugar dos efectivos de ESTA MISMA corrida (una mujer y un varón)
      // cuando eso deja más parejos los dos turnos. El lugar y el sector no cambian: solo
      // cambia quién lo ocupa, así que los cupos, las cantidades de cada uno y las horas
      // quedan igual. Se exige que ambos estén disponibles, que cumplan el descanso, que no
      // queden pegados a otra guardia suya y que cada turno conserve su Uniformado.
      {
        const bal = calcularBalance()
        const clave = (d, t) => d + '-' + t
        const cuenta = (d, t) => bal[clave(d, t)] || { femenino: 0, masculino: 0, uniformados: 0 }
        const desb = c => Math.abs(c.femenino - c.masculino)
        const vecinas = (leg, dia, ignorar) => (turnosPorLegajo[leg] || []).filter(a => (a.dia === dia - 1 || a.dia === dia + 1) && !(ignorar && a.dia === ignorar.dia && a.turno === ignorar.turno)).length
        const puedeIr = (leg, desde, hacia) => {
          const dm = dispMap[normLegajo(leg)] || {}
          if (!(dm[hacia.dia] || '').includes(hacia.turno)) return false
          const guardado = turnosPorLegajo[leg]
          turnosPorLegajo[leg] = guardado.filter(a => !(a.dia === desde.dia && a.turno === desde.turno))
          const ok = sinChoque(leg, hacia.dia, hacia.turno)
          const pegada = vecinas(leg, hacia.dia) > vecinas(leg, desde.dia, desde) + 0 && vecinas(leg, hacia.dia) > 0
          turnosPorLegajo[leg] = guardado
          return ok && !pegada
        }
        const pool = () => nuevos.filter(g => movibles.has(g) && !legajos24hs.has(g.legajo) && !legajosDoble.has(g.legajo) && !fijoPorLegajo[normLegajo(g.legajo)] && sexoDe(g.legajo))
        for (let vuelta = 0; vuelta < 6; vuelta++) {
          let cambios = 0
          const lista = pool()
          for (const g1 of lista) {
            const X = g1.legajo, a = sexoDe(X), b = a === 'femenino' ? 'masculino' : 'femenino'
            const c1 = cuenta(g1.dia, g1.turno)
            if (c1[a] - c1[b] < 1) continue                   // en este turno, X no sobra
            for (const g2 of lista) {
              const Y = g2.legajo
              if (sexoDe(Y) !== b || X === Y) continue
              if (g2.dia === g1.dia && g2.turno === g1.turno) continue
              const c2 = cuenta(g2.dia, g2.turno)
              if (c2[b] - c2[a] < 1) continue                 // en el otro, Y no sobra
              const antes = desb(c1) + desb(c2)
              const despues = Math.abs((c1[a] - 1) - (c1[b] + 1)) + Math.abs((c2[a] + 1) - (c2[b] - 1))
              if (despues >= antes) continue
              const uX = tipoDe(X) === 'Uniformado', uY = tipoDe(Y) === 'Uniformado'
              if (uX !== uY) {
                if (uX && c1.uniformados - 1 < 1) continue
                if (uY && c2.uniformados - 1 < 1) continue
              }
              const p1 = { dia: g1.dia, turno: g1.turno }, p2 = { dia: g2.dia, turno: g2.turno }
              if (!puedeIr(X, p1, p2) || !puedeIr(Y, p2, p1)) continue
              // Intercambio: cada uno pasa al lugar del otro.
              g1.legajo = Y; g2.legajo = X
              turnosPorLegajo[X] = turnosPorLegajo[X].filter(a2 => !(a2.dia === p1.dia && a2.turno === p1.turno)).concat([p2])
              turnosPorLegajo[Y] = turnosPorLegajo[Y].filter(a2 => !(a2.dia === p2.dia && a2.turno === p2.turno)).concat([p1])
              c1[a]--; c1[b]++; c2[a]++; c2[b]--
              if (uX !== uY) { if (uX) { c1.uniformados--; c2.uniformados++ } else { c1.uniformados++; c2.uniformados-- } }
              bal[clave(p1.dia, p1.turno)] = c1; bal[clave(p2.dia, p2.turno)] = c2
              cambios++
              break
            }
          }
          if (cambios === 0) break
        }
      }
    }

    // Aviso: turnos que quedaron con personal pero SIN ningún Uniformado.
    const sinUniformado = []
    {
      const b = calcularBalance()
      Object.keys(b).forEach(k => {
        if (b[k].uniformados === 0) { const [d, t] = k.split('-'); sinUniformado.push({ dia: parseInt(d), turno: t }) }
      })
      sinUniformado.sort((x, y) => x.dia - y.dia)
    }

    for (let i = 0; i < nuevos.length; i += 100) {
      const { error } = await supabase.from('turnos').insert(nuevos.slice(i, i + 100))
      if (error) { alert('❌ Error guardando guardias: ' + error.message + '\n\nEs posible que no se hayan guardado todas. Revisá antes de seguir.'); return { total: 0, reporte, conflictos, error: true } }
    }
    return { total: nuevos.length, reporte, conflictos, sinUniformado }
  }

  async function asignarUnoRapida(item) {
    setRapidaProcesando(true); setRapidaMsg(null)
    const { reporte, conflictos } = await procesarRapida([{ legajo: item.legajo, objetivo: item.objetivo }], rapida24hs, rapidaDoble)
    await cargarTodo(lugarDetectado); await cargarRapida()
    const r = reporte[0]
    const nombre = (efectivos.find(e => e.legajo === item.legajo)?.nombre || item.legajo).split(',')[0]
    const totalU = (r.previas || 0) + r.asignadas
    let m = `✓ ${nombre}: se asignaron ${r.asignadas} nuevas${r.previas ? ` (ya tenía ${r.previas})` : ''}, queda con ${totalU} de ${r.objetivo}.`
    if (totalU < r.objetivo) m += ` Faltan ${r.objetivo - totalU}: cargó ${r.dias} día(s) de disponibilidad${r.dias < r.objetivo - (r.previas || 0) ? ', no alcanzan para llegar al número' : ' y en esos días no hubo lugar o no se cumplía el descanso'}.`
    if (conflictos.length) {
      m += `\n\n⚠ ${conflictos.length} día(s) no se asignaron por cruce de horario con otro lugar:\n` +
        conflictos.map(c => `   • Día ${c.dia}: ya tiene turno "${c.turnoOrigen}" en ${c.lugarOrigen} (día ${c.diaOrigen})`).join('\n')
    }
    setRapidaProcesando(false); alert(m)
  }

  async function asignarTodosRapida() {
    if (rapidaLista.length === 0) return
    const aviso24hs = rapida24hs.size > 0 ? `\n\n${rapida24hs.size} marcado(s) para guardias de 24hs.` : ''
    const avisoDoble = rapidaDoble.size > 0 ? `\n${rapidaDoble.size} marcado(s) para doble turno.` : ''
    const eq = equilibrarObjetivos(rapidaLista) // siempre activo: reparto parejo entre varones y mujeres
    const listaAsignar = eq.lista
    if (!confirm(`¿Asignar a ${listaAsignar.length} efectivos?${aviso24hs}${avisoDoble}`)) return
    setRapidaProcesando(true); setRapidaMsg(null)
    const { total, reporte, conflictos, sinUniformado = [] } = await procesarRapida(listaAsignar.map(i => ({ legajo: i.legajo, objetivo: i.objetivo })), rapida24hs, rapidaDoble, new Set(listaAsignar.filter(i => i.objetivoFijo).map(i => i.legajo)))
    await cargarTodo(lugarDetectado); await cargarRapida()

    // Verificación: ¿cuántos días del mes quedaron con turnos asignados?
    const sectoresV = SECTORES_POR_LUGAR[lugarDetectado] || SECTORES_POR_LUGAR['HIGA']
    const diasMes = new Date(ANIO, MES, 0).getDate()
    const { data: verificacion } = await supabase
      .from('turnos').select('dia')
      .eq('mes', MES).eq('anio', ANIO)
      .in('sector', sectoresV).limit(10000)
    const diasCubiertos = new Set((verificacion || []).map(t => parseInt(t.dia)))
    const diasFaltantes = []
    for (let d = 1; d <= diasMes; d++) { if (!diasCubiertos.has(d)) diasFaltantes.push(d) }

    const incompletos = reporte.filter(r => (r.previas || 0) + r.asignadas < r.objetivo)
    let m = `✓ Se asignaron ${total} guardias en total.\n\n`
    if (diasFaltantes.length === 0) {
      m += `✅ ${diasMes}/${diasMes} días del mes tienen turnos asignados.`
    } else {
      m += `⚠ ATENCIÓN: Solo ${diasCubiertos.size}/${diasMes} días tienen turnos.\nDías SIN turnos: ${diasFaltantes.join(', ')}`
    }
    if (incompletos.length) {
      m += `\n\n⚠ ${incompletos.length} efectivo(s) no llegaron al número:\n` +
        incompletos.slice(0, 12).map(r => {
          const n = (efectivos.find(e => e.legajo === r.legajo)?.nombre || r.legajo).split(',')[0]
          return `   • ${n}: ${(r.previas || 0) + r.asignadas} de ${r.objetivo} (cargó ${r.dias} día${r.dias === 1 ? '' : 's'} de disponibilidad)`
        }).join('\n')
      if (incompletos.length > 12) m += `\n   …y ${incompletos.length - 12} más.`
    }
    if (sinUniformado.length) {
      const nombreTurno = t => ({ d: 'día', n: 'noche', m: 'mañana', t: 'tarde' }[t] || t)
      m += `\n\n⚠ ${sinUniformado.length} turno(s) quedaron SIN ningún uniformado (no había uniformados disponibles):\n` +
        sinUniformado.slice(0, 15).map(x => `   • Día ${x.dia} — ${nombreTurno(x.turno)}`).join('\n')
      if (sinUniformado.length > 15) m += `\n   …y ${sinUniformado.length - 15} más.`
    }
    if (conflictos.length) {
      m += `\n\n⚠ ${conflictos.length} guardia(s) NO se asignaron por cruce de horario con otro lugar:\n` +
        conflictos.slice(0, 15).map(c => {
          const n = (efectivos.find(e => e.legajo === c.legajo)?.nombre || c.legajo).split(',')[0]
          return `   • ${n} - Día ${c.dia}: ya tiene turno "${c.turnoOrigen}" en ${c.lugarOrigen} (día ${c.diaOrigen})`
        }).join('\n')
      if (conflictos.length > 15) m += `\n   …y ${conflictos.length - 15} más.`
    }
    setRapidaProcesando(false); alert(m)
  }

  async function borrarRapida() {
    const L = lugarDetectado
    const sectores = SECTORES_POR_LUGAR[L] || SECTORES_POR_LUGAR['HIGA']
    if (!confirm(`¿Borrar TODAS las guardias de ${L} de ${NOMBRE_MES}? (No afecta a los otros lugares)`)) return
    setRapidaProcesando(true)
    const { error } = await supabase.from('turnos').delete().eq('mes', MES).eq('anio', ANIO).in('sector', sectores)
    if (error) { setRapidaProcesando(false); alert('❌ Error borrando: ' + error.message); return }
    await cargarTodo(L); await cargarRapida()
    setRapidaProcesando(false)
    setRapidaMsg(`Se borraron las guardias de ${L} de ${NOMBRE_MES}.`)
  }

  async function descargarPlanilla(turno) {
    try {
      const url = `/api/generar-planilla?lugar=${lugarDetectado}&turno=${turno}&mes=${MES}&anio=${ANIO}`
      const res = await fetch(url, { headers: { Authorization: 'Bearer ' + (localStorage.getItem('polad_session') || '') } })
      if (res.status === 401) throw new Error('Tu sesión venció. Salí y volvé a entrar.')
      if (!res.ok) throw new Error('Error al generar')
      const blob = await res.blob(); const a = document.createElement('a')
      a.href = URL.createObjectURL(blob); a.download = `${APP_LUGAR}_${turno}_${NOMBRE_MES}.xlsx`; a.click(); URL.revokeObjectURL(a.href)
    } catch(e) { alert('Error: ' + e.message) }
  }

  async function handleGuardarEdicion(t) {
    const cruce = await buscarCruceOtroLugar(t.legajo, parseInt(t.dia), t.turno, lugarDeSectorGlobal(t.sector), MES, ANIO, t.id)
    if (cruce) {
      const nombre = efectivos.find(e => e.legajo === t.legajo)?.nombre || t.legajo
      const ok = confirm(`⚠ CRUCE DE HORARIO\n\n${nombre} ya tiene un turno "${cruce.turno}" en ${cruce.lugar} el día ${cruce.dia} (${cruce.sector}), que se superpone en horario real con este turno.\n\n¿Guardar igual?`)
      if (!ok) return
    }
    await supabase.from('turnos').update({ legajo: t.legajo, turno: t.turno, sector: t.sector }).eq('id', t.id)
    setModalTurno(null); await cargarTodo()
  }
  async function handleEliminarTurno(t) {
    const { error } = await supabase.from('turnos').delete().eq('id', t.id)
    if (error) { alert('❌ Error eliminando: ' + error.message); return }
    setModalTurno(null); await cargarTodo()
  }
  async function handleAgregarTurno(n) {
    const cruce = await buscarCruceOtroLugar(n.legajo, parseInt(n.dia), n.turno, lugarDeSectorGlobal(n.sector), n.mes, n.anio, null)
    if (cruce) {
      const nombre = efectivos.find(e => e.legajo === n.legajo)?.nombre || n.legajo
      const ok = confirm(`⚠ CRUCE DE HORARIO\n\n${nombre} ya tiene un turno "${cruce.turno}" en ${cruce.lugar} el día ${cruce.dia} (${cruce.sector}), que se superpone en horario real con este turno.\n\n¿Guardar igual?`)
      if (!ok) return
    }
    const { error } = await supabase.from('turnos').insert([n])
    if (error) { alert('❌ Error guardando: ' + error.message); return }
    setModalTurno(null); await cargarTodo()
  }

  // Arrastrar y soltar en Edición manual: mover (o intercambiar) un
  // efectivo de un puesto (sector+turno) a otro del MISMO día, sin tener
  // que abrir el modal "Cambiar" para cada caso. Pedido: "arrastraba el
  // efectivo hasta el puesto y automáticamente quedaba en la planilla
  // mensual y demás, y si había otro efectivo, el efectivo suplantaba el
  // lugar que dejaba este" — es decir, si el puesto destino ya tiene a
  // alguien, SE INTERCAMBIAN los dos (cada uno pasa al puesto del otro),
  // no que uno quede sin asignar.
  //
  // origenItem: la fila de turnos que se está arrastrando ({id, legajo,
  //   sector, turno, dia}).
  // destino: { sector, turno } — el puesto donde se soltó. ocupanteItem,
  //   si no es null, es la fila de turnos de quien ya estaba en ESE puesto
  //   específico (se soltó encima de esa persona = intercambio). Si es
  //   null, se soltó en un espacio vacío del puesto = mover (respetando
  //   el cupo del puesto destino).
  //
  // En los dos casos se reutiliza el mismo chequeo de "cruce de horario"
  // que ya usa handleGuardarEdicion/handleAgregarTurno — moverlo de
  // puesto puede cambiar su horario real (p.ej. de Día a Noche), y eso
  // puede ahora superponerse con un turno suyo en otro lugar.
  // Pedido nuevo (ronda del arrastre): antes de mover/intercambiar a
  // alguien a un turno, avisar si esa persona NO cargó disponibilidad
  // para ESE turno puntual ese día — antes el arrastre solo revisaba
  // cupo y cruce de horario con otro lugar, no esto. Usa los mismos
  // datos que ya carga el panel "Disponibles — Día X" de al lado
  // (dispDelDia, vía /api/admin-disponibilidad), no pide nada nuevo al
  // servidor. Si todavía no terminó de cargar la disponibilidad de este
  // día (dispDelDia.dia !== filtroDia, apenas se cambió de día), no se
  // puede saber todavía — se deja pasar sin avisar en vez de bloquear
  // por una carga que está en curso.
  function chequearDisponibilidadTurno(legajo, turnoDestino) {
    if (dispDelDia.dia !== filtroDia) return null
    const entrada = (dispDelDia.data || []).find(d => normLegajo(d.legajo) === normLegajo(legajo))
    const turnoLabel = TURNOS_INFO.find(t => t.key === turnoDestino)?.label || turnoDestino
    if (!entrada) return `no cargó disponibilidad para el día ${filtroDia}`
    if (!entrada.turno || !entrada.turno.includes(turnoDestino)) return `cargó disponibilidad para el día ${filtroDia}, pero no para "${turnoLabel}"`
    return null
  }

  async function handleDropTurno(origenItem, destino) {
    if (!origenItem || origenItem.dia !== filtroDia) return
    if (origenItem.sector === destino.sector && origenItem.turno === destino.turno) return // soltó en el mismo puesto, no hay nada que hacer

    if (destino.ocupanteItem) {
      // Intercambio: cada uno pasa al puesto del otro.
      const ocupante = destino.ocupanteItem
      if (ocupante.id === origenItem.id) return
      const nombreOrigen = nombreCompleto(origenItem.legajo)
      const nombreOcupante = nombreCompleto(ocupante.legajo)
      const [cruceOrigen, cruceOcupante] = await Promise.all([
        buscarCruceOtroLugar(origenItem.legajo, filtroDia, destino.turno, lugarDeSectorGlobal(destino.sector), MES, ANIO, origenItem.id),
        buscarCruceOtroLugar(ocupante.legajo, filtroDia, origenItem.turno, lugarDeSectorGlobal(origenItem.sector), MES, ANIO, ocupante.id),
      ])
      const dispOrigen = chequearDisponibilidadTurno(origenItem.legajo, destino.turno)
      const dispOcupante = chequearDisponibilidadTurno(ocupante.legajo, origenItem.turno)
      if (cruceOrigen || cruceOcupante || dispOrigen || dispOcupante) {
        const partes = []
        if (cruceOrigen) partes.push(`${nombreOrigen}: ya tiene "${cruceOrigen.turno}" en ${cruceOrigen.lugar} (${cruceOrigen.sector}) el día ${cruceOrigen.dia}.`)
        if (cruceOcupante) partes.push(`${nombreOcupante}: ya tiene "${cruceOcupante.turno}" en ${cruceOcupante.lugar} (${cruceOcupante.sector}) el día ${cruceOcupante.dia}.`)
        if (dispOrigen) partes.push(`${nombreOrigen}: ${dispOrigen}.`)
        if (dispOcupante) partes.push(`${nombreOcupante}: ${dispOcupante}.`)
        const ok = confirm(`⚠ ATENCIÓN\n\n${partes.join('\n')}\n\n¿Intercambiar igual?`)
        if (!ok) return
      }
      const [{ error: e1 }, { error: e2 }] = await Promise.all([
        supabase.from('turnos').update({ sector: destino.sector, turno: destino.turno }).eq('id', origenItem.id),
        supabase.from('turnos').update({ sector: origenItem.sector, turno: origenItem.turno }).eq('id', ocupante.id),
      ])
      if (e1 || e2) { alert('❌ Error al intercambiar: ' + (e1?.message || e2?.message)); return }
    } else {
      // Mover a un puesto vacío (o con lugar todavía, si el cupo es >1) — respeta el cupo del destino.
      const ocupadosDestino = todosLosTurnos.filter(t => t.dia === filtroDia && t.turno === destino.turno && t.sector === destino.sector).length
      if (ocupadosDestino >= cupoSlot(destino.sector, destino.turno)) {
        alert(`⛔ No hay cupo disponible en ${destino.sector} / ${TURNOS_INFO.find(t => t.key === destino.turno)?.label || destino.turno}.`)
        return
      }
      const cruce = await buscarCruceOtroLugar(origenItem.legajo, filtroDia, destino.turno, lugarDeSectorGlobal(destino.sector), MES, ANIO, origenItem.id)
      const dispAviso = chequearDisponibilidadTurno(origenItem.legajo, destino.turno)
      if (cruce || dispAviso) {
        const nombre = nombreCompleto(origenItem.legajo)
        const partes = []
        if (cruce) partes.push(`ya tiene un turno "${cruce.turno}" en ${cruce.lugar} el día ${cruce.dia} (${cruce.sector}), que se superpone en horario real con este turno.`)
        if (dispAviso) partes.push(dispAviso + '.')
        const ok = confirm(`⚠ ATENCIÓN\n\n${nombre}: ${partes.join(' ')}\n\n¿Mover igual?`)
        if (!ok) return
      }
      const { error } = await supabase.from('turnos').update({ sector: destino.sector, turno: destino.turno }).eq('id', origenItem.id)
      if (error) { alert('❌ Error al mover: ' + error.message); return }
    }
    await cargarTodo()
  }

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
      await supabase.from('efectivos').update({ legajo: datos.legajo, nombre: datos.nombre, tipo: datos.tipo, sexo: datos.sexo || null, email: datos.email || '', sector: datos.sector || 'Sin asignar', telefono: datos.telefono || '', notas: datos.notas || null, dni: datos.dni || null, jerarquia: datos.jerarquia || null, lugar: APP_LUGAR, password: datos.password || null }).eq('id', datos.id)
      setMsgPersonal('Efectivo actualizado.')
    } else {
      const { error } = await supabase.from('efectivos').insert([{ legajo: datos.legajo, nombre: datos.nombre, tipo: datos.tipo, sexo: datos.sexo || null, email: datos.email || '', sector: 'Sin asignar', es_admin: false, telefono: datos.telefono || '', lugar: APP_LUGAR }])
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

  async function subirFirmaAdmin(id, legajo, base64) {
    await supabase.from('efectivos').update({ firma_url: base64 }).eq('id', id)
    const existeFirma = firmas[legajo]
    if (existeFirma) await supabase.from('firmas').update({ firma_url: base64 }).eq('id', existeFirma.id)
    else await supabase.from('firmas').insert([{ legajo, mes: MES, anio: ANIO, firma_url: base64 }])
    setFirmas(prev => ({ ...prev, [legajo]: { ...prev[legajo], firma_url: base64 } }))
    setEfectivos(prev => prev.map(e => e.id === id ? { ...e, firma_url: base64 } : e))
  }

  async function eliminarFirmaAdmin(id, legajo) {
    await supabase.from('efectivos').update({ firma_url: null }).eq('id', id)
    const existeFirma = firmas[legajo]
    if (existeFirma) await supabase.from('firmas').update({ firma_url: null }).eq('id', existeFirma.id)
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

      const { error: updateError } = await supabase.from('efectivos').update({ planilla_url: publicUrl }).eq('id', id)
      if (updateError) { alert('Error actualizando: ' + updateError.message); return }

      setEfectivos(prev => prev.map(e => e.id === id ? { ...e, planilla_url: publicUrl } : e))
      setPlanillaEf(prev => (prev && prev.id === id) ? { ...prev, planilla_url: publicUrl } : prev)
      alert('✅ Planilla subida correctamente')
    } catch (err) {
      alert('Error al subir: ' + err.message)
    }
  }

  async function eliminarPlanillaAdmin(id, legajo) {
    const actual = efectivos.find(e => e.id === id)
    const extActual = actual?.planilla_url?.toLowerCase().endsWith('.ods') ? 'ods' : 'xlsx'
    await supabase.storage.from('planillas').remove([`${legajo}-${APP_LUGAR}.${extActual}`])
    await supabase.from('efectivos').update({ planilla_url: null }).eq('id', id)
    setEfectivos(prev => prev.map(e => e.id === id ? { ...e, planilla_url: null } : e))
    setPlanillaEf(prev => (prev && prev.id === id) ? { ...prev, planilla_url: null } : prev)
  }

  async function handleLoginAdmin(e) {
    e.preventDefault()
    setLoginAdmin(prev => ({ ...prev, error: '', loading: true }))
    try {
      // Paso 6 (seguridad): antes esta función traía la fila del
      // administrador directo de Supabase (con la clave anon, visible en
      // el navegador) y comparaba acá mismo, en el navegador, contra
      // 'admin2025' escrito tal cual en el código fuente — cualquiera que
      // abriera las herramientas de desarrollador, o leyera este archivo,
      // la veía. Ahora se manda legajo+contraseña a /api/auth-login (el
      // mismo endpoint que ya usa pages/index.js) y es el servidor el que
      // busca al administrador y compara la contraseña contra el hash
      // guardado en ADMIN_PASSWORD_HASH — la contraseña real nunca viaja
      // al código fuente ni a lo que ve quien inspecciona el navegador.
      const resp = await fetch('/api/auth-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ legajo: loginAdmin.legajo.trim(), password: loginAdmin.pass }),
      })
      const body = await resp.json().catch(() => ({}))
      if (!resp.ok) {
        setLoginAdmin(prev => ({ ...prev, error: body.error || 'Error de conexión.', loading: false }))
        return
      }
      const data = body.usuario
      localStorage.setItem('polad_user', JSON.stringify(data))
      // Paso 6b: este token es lo que ahora exige /api/admin-db (y
      // /api/admin-storage-remove) en cada pedido para aceptar leer o
      // escribir en la base — sin esto, ningún llamado de los que hace
      // esta pantalla funcionaría. Vence solo a las 12hs (ver
      // pages/api/auth-login.js); si venció, lib/supabaseAdminProxy.js lo
      // detecta solo y manda de vuelta al login.
      if (body.sessionToken) localStorage.setItem('polad_session', body.sessionToken)
      adminLoggedIn.current = true
      setLoginAdmin(false)
      // (Antes había acá un segundo fetch a /api/auth-login "best effort",
      // pensado para dejar activada una sesión de cookie que usaría
      // /api/admin-disponibilidad-override — pero ese archivo y
      // lib/authServer.js, que esa sesión necesitaría, nunca llegaron a
      // subirse al repo real. Se saca el fetch duplicado: ya se llamó una
      // vez arriba para validar la contraseña, y un segundo llamado
      // idéntico no sumaba nada. "Disponibilidad fuera de término" queda
      // pendiente como una funcionalidad aparte, no resuelta todavía.)
      const lugar = _detectLugar()
      const now = new Date()
      supabase.from('configuracion').select('*').eq('lugar', lugar).maybeSingle().then(({ data: cfg }) => {
        if (cfg) {
          const v2 = { dia: cfg.dia?.toString()||'', horaInicio: cfg.hora_inicio||'08:00', horaFin: cfg.hora_fin||'20:00', mesVentana: cfg.mes||now.getMonth()+1, anioVentana: cfg.anio||now.getFullYear(), mesApertura: cfg.mes_apertura||now.getMonth()+1, anioApertura: cfg.anio_apertura||now.getFullYear() }
          setVentanas(v2)
          localStorage.setItem(`polad_ventanas_${lugar}`, JSON.stringify(v2))
        }
      })
      setTimeout(() => cargarTodo(lugar), 0)
    } catch (err) {
      setLoginAdmin(prev => ({ ...prev, error: 'Error de conexión.', loading: false }))
    }
  }

  // ── Disponibilidad fuera de término: carga/edición manual de la
  // disponibilidad de UN efectivo, hecha por un administrador, SIN reabrir
  // la ventana de inscripción general (eso seguiría afectando a todos los
  // demás efectivos — ver pedido original). Usa
  // /api/admin-disponibilidad-override, que ya respeta todo lo que
  // respetaba cuando se probó: se agrega a la lista de asignación rápida,
  // nunca toca la tabla de turnos (las guardias ya asignadas que queden en
  // contradicción se avisan, no se borran), y deja auditoría. Requiere la
  // sesión de servidor que handleLoginAdmin intenta establecer al
  // loguearse — si todavía no está disponible en este entorno, se avisa
  // con un mensaje claro en vez de fallar en silencio o romper algo.
  async function abrirDispAdmin(e) {
    setDispAdminResultado(null)
    setDispAdminMotivo('')
    setDispAdminPaso('editar')
    setModalDispAdmin({ legajo: e.legajo, nombre: e.nombre })
    setDispAdminCargando(true)
    try {
      const resp = await fetch(`/api/admin-disponibilidad-override?legajo=${encodeURIComponent(e.legajo)}&lugar=${lugarDetectado}&mes=${MES}&anio=${ANIO}`, { headers: { Authorization: 'Bearer ' + (localStorage.getItem('polad_session') || '') } })
      const body = await resp.json().catch(() => ({}))
      if (!resp.ok) {
        if (resp.status === 401) {
          setDispAdminResultado({ ok: false, error: 'Tu sesión de administrador venció. Salí y volvé a entrar. No se modificó nada.' })
        } else {
          setDispAdminResultado({ ok: false, error: body.error || 'No se pudo cargar.' })
        }
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

  // Advertencias calculadas en pantalla (antes de guardar), comparando lo
  // que se está por guardar contra las guardias YA asignadas. El servidor
  // vuelve a calcularlas igual al guardar — esto es solo para que el
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
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (localStorage.getItem('polad_session') || '') },
        body: JSON.stringify({
          legajo: modalDispAdmin.legajo, lugar: lugarDetectado, mes: MES, anio: ANIO,
          dias: dispAdminDias, motivo: dispAdminMotivo || null, confirmar: true,
          // Lo que este formulario tenía al abrirse — si ya no coincide con
          // lo guardado en este momento (otro admin lo cambió mientras
          // tanto), el servidor rechaza el guardado en vez de pisarlo.
          dias_antes_esperado: dispAdminDiasOriginal,
        }),
      })
      const body = await resp.json().catch(() => ({}))
      if (resp.status === 409 && body.conflicto) {
        setDispAdminDiasOriginal(body.dias_actuales || {})
        setDispAdminResultado({ ok: false, error: body.error, conflicto: true })
        setDispAdminPaso('editar')
      } else if (resp.status === 401) {
        setDispAdminResultado({ ok: false, error: 'Tu sesión de administrador venció. Salí y volvé a entrar. No se modificó nada.' })
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
  // Dentro de los que YA cargaron disponibilidad, cuántos son femeninos y
  // cuántos masculinos (para el resumen de arriba).
  const cargaronFemenino = efectivos.filter(e => e.sexo === 'femenino' && disponibilidad[normLegajo(e.legajo)] && Object.keys(disponibilidad[normLegajo(e.legajo)]).length > 0).length
  const cargaronMasculino = efectivos.filter(e => e.sexo === 'masculino' && disponibilidad[normLegajo(e.legajo)] && Object.keys(disponibilidad[normLegajo(e.legajo)]).length > 0).length
  const pctDisp = n => cargaron ? `${Math.round(n / cargaron * 100)}%` : '—'
  const pctDispNum = n => cargaron ? Math.round(n / cargaron * 100) : 0
  // Mismo desglose, por tipo de personal (no hay "sin informar": el tipo
  // lo carga siempre el administrador al dar de alta al efectivo).
  const cargaronUniformado = efectivos.filter(e => e.tipo === 'Uniformado' && disponibilidad[normLegajo(e.legajo)] && Object.keys(disponibilidad[normLegajo(e.legajo)]).length > 0).length
  const cargaronServGeneral = efectivos.filter(e => e.tipo === 'Serv. General' && disponibilidad[normLegajo(e.legajo)] && Object.keys(disponibilidad[normLegajo(e.legajo)]).length > 0).length
  const cargaronDestacamento = efectivos.filter(e => e.tipo === 'Destacamento' && disponibilidad[normLegajo(e.legajo)] && Object.keys(disponibilidad[normLegajo(e.legajo)]).length > 0).length

  // Mismos totales de horas/sexo que ya tiene la planilla para imprimir
  // (pages/api/generar-planilla.js), pero a la vista acá arriba.
  const horasAsignadas = todosLosTurnos.length * HORAS_TURNO
  const masculinosAsignados = todosLosTurnos.filter(t => efectivos.find(e => e.legajo === t.legajo)?.sexo === 'masculino').length
  const femeninosAsignados = todosLosTurnos.filter(t => efectivos.find(e => e.legajo === t.legajo)?.sexo === 'femenino').length
  const uniformadosAsignados = todosLosTurnos.filter(t => efectivos.find(e => e.legajo === t.legajo)?.tipo === 'Uniformado').length
  const servGeneralAsignados = todosLosTurnos.filter(t => efectivos.find(e => e.legajo === t.legajo)?.tipo === 'Serv. General').length
  const destacamentoAsignados = todosLosTurnos.filter(t => efectivos.find(e => e.legajo === t.legajo)?.tipo === 'Destacamento').length
  const noUniformadosAsignados = servGeneralAsignados + destacamentoAsignados
  const pctSexo = n => todosLosTurnos.length ? `${Math.round(n / todosLosTurnos.length * 100)}%` : '—'
  const pctSexoNum = n => todosLosTurnos.length ? Math.round(n / todosLosTurnos.length * 100) : 0

  // Cuántas guardias hacen falta cubrir este mes en TOTAL (la suma de los
  // cupos reales de cada sector/turno, multiplicada por los días del
  // mes), cuántas ya están cubiertas y cuántas faltan — en guardias y en
  // horas. Usa cupoSlot (definido arriba de todo el archivo), el mismo
  // cupo real por sector/turno que ya usan pages/api/generar-planilla.js
  // y ahora también la asignación real.
  const slotsPorDia = SECTORES_APP.reduce((acc, sector) => acc + TURNOS_LUGAR.reduce((acc2, turno) => acc2 + cupoSlot(sector, turno), 0), 0)
  const guardiasNecesarias = slotsPorDia * DIAS_MES
  const guardiasSinCubrir = Math.max(0, guardiasNecesarias - todosLosTurnos.length)
  const horasNecesarias = guardiasNecesarias * HORAS_TURNO
  const horasSinCubrir = Math.max(0, horasNecesarias - horasAsignadas)
  const nombreCompleto = leg => { const e = efectivos.find(x => x.legajo === leg); return e ? e.nombre : leg }
  const nombreCorto = leg => nombreCompleto(leg).split(',')[0]
  // Marcas en cada nombre de las tarjetas: círculo rosa ♀ / azul ♂ y etiqueta UNIF / S/U (no uniformado)
  const marcaSexo = leg => {
    const e = efectivos.find(x => x.legajo === leg)
    const sx = String(e?.sexo || '').trim().toLowerCase()
    if (sx !== 'femenino' && sx !== 'masculino') return null
    const f = sx === 'femenino'
    return <span title={f ? 'Femenino' : 'Masculino'} style={{ display:'inline-flex',alignItems:'center',justifyContent:'center',width:16,height:16,borderRadius:'50%',fontSize:11,fontWeight:700,color:'#10131c',background:f ? '#E8829E' : '#5B9BD5',flexShrink:0 }}>{f ? '♀' : '♂'}</span>
  }
  const marcaTipo = leg => {
    const e = efectivos.find(x => x.legajo === leg)
    if (!e || !e.tipo) return null
    const unif = e.tipo === 'Uniformado'
    return <span title={e.tipo} style={{ fontSize:9,fontWeight:700,padding:'1px 5px',borderRadius:4,flexShrink:0,
      background: unif ? 'rgba(245,197,24,0.18)' : 'rgba(232,147,90,0.15)', color: unif ? '#F5C518' : '#E8935A',
      border: '1px solid ' + (unif ? 'rgba(245,197,24,0.45)' : 'rgba(232,147,90,0.4)') }}>{unif ? 'UNIF' : 'S/U'}</span>
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

      {/* Disponibilidad fuera de término (HIGA, UPA y MODULAR — ver botón
          en la vista "disponibilidad"). No reemplaza ni toca la ventana de
          inscripción general. */}
      {modalDispAdmin && (
        <div style={{ position:'fixed',inset:0,background:'rgba(0,0,0,0.6)',zIndex:50,display:'flex',alignItems:'center',justifyContent:'center',padding:20 }}>
          <div style={{ background:'#13151f',borderRadius:12,border:'0.5px solid rgba(200,168,75,0.4)',width:'100%',maxWidth:560,maxHeight:'90vh',overflow:'auto' }}>
            <div style={{ padding:'14px 16px',borderBottom:'0.5px solid rgba(200,168,75,0.3)',display:'flex',justifyContent:'space-between',alignItems:'center',background:'rgba(200,168,75,0.06)',position:'sticky',top:0,zIndex:1 }}>
              <h3 style={{ fontSize:14,fontWeight:500,color:'#c8a84b' }}>✎ Disponibilidad fuera de término — {modalDispAdmin.nombre}</h3>
              <button className="btn btn-sm" onClick={() => { setModalDispAdmin(null); setDispAdminResultado(null) }}>Cerrar</button>
            </div>
            <div style={{ padding:16 }}>
              <div style={{ fontSize:11, color:'var(--text-muted)', marginBottom:12 }}>
                Leg. {modalDispAdmin.legajo} · {APP_LUGAR} · {NOMBRE_MES}. Esto NO reabre la inscripción general: solo guarda la disponibilidad de esta persona para este período. No borra ni modifica guardias ya asignadas.
              </div>

              {dispAdminCargando ? (
                <div style={{ textAlign:'center', padding:20, color:'var(--text-muted)' }}>Cargando...</div>
              ) : dispAdminResultado?.ok ? (
                <div>
                  <div className="alert alert-ok" style={{ marginBottom:12 }}>
                    Disponibilidad guardada.
                    {dispAdminResultado.auditoria_id != null && ` Auditoría #${dispAdminResultado.auditoria_id}.`}
                  </div>
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

      {/* Encabezado: diseño que ya habías aprobado antes (marca POLAD /
          DESTINO + lugar, mes/año/candado y Salir arriba; pestañas
          principales con ícono y línea de color debajo; pestañas
          secundarias más chicas, en texto dorado, abajo de todo). Se
          restaura tal cual estaba — el rediseño anterior (una sola tira
          con las 10 pestañas) queda descartado.
          Para HIGA (y solo HIGA — UPA/MODULAR siguen con este mismo
          encabezado de siempre, sin tocar) se reemplaza por el encabezado
          con fotos reales + menú lateral que aprobaste en la vista previa.
          Es solo presentación: usa exactamente los mismos
          mesSeleccionado/anioSeleccionado/mesBloqueado/toggleBloqueoMes/
          setVista/router que ya existían — no hay lógica nueva. */}
      {/* Topbar viejo: reemplazado para los 3 lugares por el encabezado con
          foto + menú lateral de más abajo. Se deja el código acá, inerte
          (nunca se renderiza), en vez de borrarlo, por si alguna vez hace
          falta volver atrás para alguno de los tres. */}
      {false && (
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
            <button className="btn btn-sm" style={{ color:'#b7bcc9',fontSize:14 }} onClick={() => { localStorage.removeItem('polad_user'); localStorage.removeItem('polad_session'); router.push('/') }}>↪ Salir</button>
          </div>
        </div>
        <div style={{ display:'flex',gap:2,padding:'0 16px',borderBottom:'0.5px solid rgba(255,255,255,0.08)',flexWrap:'nowrap',overflowX:'auto' }}>
          {[
            { v:'personal', icon:'👥', label:'Personal' },
            { v:'disponibilidad', icon:'📅', label:'Disponibilidad' },
            { v:'turnos', icon:'🛡️', label:'Guardias' },
            { v:'edicion', icon:'✏️', label:'Edición manual' },
            { v:'rapida', icon:'⚡', label:'Asignación rápida' },
          ].map(item => (
            <button key={item.v} onClick={() => setVista(item.v)} style={{ display:'flex',alignItems:'center',gap:7,padding:'11px 14px',background:'transparent',border:'none',borderBottom:vista===item.v?'2px solid #2DD4BF':'2px solid transparent',color:vista===item.v?'#2DD4BF':'#b7bcc9',fontSize:15,fontWeight:vista===item.v?700:500,cursor:'pointer',whiteSpace:'nowrap',flexShrink:0 }}>
              <span>{item.icon}</span>{item.label}
            </button>
          ))}
        </div>
        <div style={{ display:'flex',gap:22,padding:'10px 16px',flexWrap:'nowrap',overflowX:'auto' }}>
          {[
            { v:'buscarLegajo', icon:'🔍', label:'Buscar legajo' },
            { v:'config', icon:'⚙️', label:'Configuración' },
            { v:'planillas', icon:'🗓️', label:'Planillas' },
            { v:'descarga', icon:'📋', label:'Planilla Guardia' },
          ].map(item => (
            <button key={item.v} onClick={() => setVista(item.v)} style={{ display:'flex',alignItems:'center',gap:6,background:'transparent',border:'none',color:vista===item.v?'#c8a84b':'#b7bcc9',fontSize:14,fontWeight:vista===item.v?600:500,cursor:'pointer',padding:0,whiteSpace:'nowrap',flexShrink:0 }}>
              <span>{item.icon}</span>{item.label}
            </button>
          ))}
          <button onClick={() => router.push('/control')} style={{ display:'flex',alignItems:'center',gap:6,background:'transparent',border:'none',color:'#b7bcc9',fontSize:14,fontWeight:500,cursor:'pointer',padding:0,whiteSpace:'nowrap',flexShrink:0 }}>
            <span>👤</span>Control asistencia
          </button>
        </div>
      </div>
      )}

      {true && (<>
      <style>{`
        @keyframes phgPulse{0%,100%{opacity:1;transform:scale(1);}50%{opacity:.5;transform:scale(1.3);}}
        @keyframes phgShimmer{0%{transform:translateX(-120%);}100%{transform:translateX(320%);}}
        .phg-navbtn{display:flex;align-items:center;gap:11px;padding:10px 12px;border-radius:9px;color:#93a0c4;font-size:13.5px;font-weight:500;cursor:pointer;border:none;background:transparent;text-align:left;width:100%;transition:background .15s,color .15s;}
        .phg-navbtn svg{width:17px;height:17px;flex-shrink:0;opacity:.85;}
        .phg-navbtn:hover{background:rgba(255,255,255,0.05);color:#fff;}
        .phg-navbtn.phg-activa{background:linear-gradient(90deg,rgba(45,212,191,0.22),rgba(45,212,191,0.06));color:#6EE7DA;font-weight:700;box-shadow:inset 3px 0 0 #2DD4BF;}
        .phg-salir:hover{background:rgba(224,91,91,0.24) !important;}
        .phg-acceso:hover{transform:translateY(-2px);}
        .phg-maingrid{display:flex;align-items:flex-start;gap:18px;margin-bottom:18px;}
        .phg-col-izq{width:43%;min-width:0;display:flex;flex-direction:column;gap:14px;}
        .phg-col-der{flex:1;min-width:0;display:flex;flex-direction:column;gap:14px;}
        .phg-grid-stats{display:grid;grid-template-columns:1fr 1fr;gap:8px;}
        .phg-grid-stats .phg-full{grid-column:1 / -1;}
        .phg-accesos-grid{display:flex;gap:10px;}
        .phg-acceso{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:9px;flex:1;min-width:0;padding:22px 8px;border-radius:12px;cursor:pointer;font-size:12px;font-weight:700;color:#fff;text-align:center;transition:transform .12s;line-height:1.3;}
        .phg-acceso svg{width:24px;height:24px;flex-shrink:0;}
        .phg-stat-icon{width:17px;height:17px;flex-shrink:0;display:inline-flex;}
        .phg-stat-icon svg{width:100%;height:100%;}
        @media (max-width:920px){
          .phg-sidebar{width:64px !important;}
          .phg-lbl{display:none !important;}
          .phg-navbtn{justify-content:center;}
          .phg-sidebar-foot-txt{display:none !important;}
          .phg-maingrid{flex-direction:column;align-items:stretch;}
          .phg-col-izq,.phg-col-der{display:contents;}
          .phg-col-resumen{order:1;}
          .phg-col-mapa{order:2;}
          .phg-col-accesos{order:3;}
          .phg-col-estado{order:4;}
          .phg-accesos-grid{flex-wrap:wrap;}
          .phg-acceso{flex:1 1 calc(50% - 8px);}
          .phg-hero-left,.phg-hero-right{width:100%;justify-content:space-between;}
        }
        @media (max-width:480px){
          .phg-grid-stats{grid-template-columns:1fr;}
        }
      `}</style>
      <div style={{ position:'relative', minHeight:150, overflow:'hidden', display:'flex', alignItems:'center', justifyContent:'space-between', gap:20, padding:'18px 28px', flexWrap:'wrap', borderBottom:'1px solid rgba(45,212,191,0.35)', boxShadow:'0 4px 24px rgba(0,0,0,0.5)' }}>
        <div style={{ position:'absolute', inset:0, backgroundImage:`url('/${PHG_SLUG}-hero.jpg')`, backgroundSize:'cover', backgroundPosition:'center 38%', filter:'saturate(0.85) brightness(0.55)', zIndex:0 }} />
        <div style={{ position:'absolute', inset:0, zIndex:1, background:'linear-gradient(100deg, rgba(8,12,28,0.94) 0%, rgba(12,22,48,0.88) 30%, rgba(13,35,66,0.55) 60%, rgba(10,16,34,0.9) 100%)' }} />
        <div className="phg-hero-left" style={{ position:'relative', zIndex:2, display:'flex', alignItems:'center', gap:18, flexWrap:'wrap' }}>
          <div style={{ display:'flex', alignItems:'center', gap:16 }}>
            <span style={{ fontSize:30, fontWeight:800, letterSpacing:'0.06em', color:'#fff', textShadow:'0 0 18px rgba(45,212,191,0.5)' }}>POLAD</span>
            <div style={{ width:1, height:34, background:'linear-gradient(180deg, transparent, #2DD4BF, transparent)', boxShadow:'0 0 10px rgba(45,212,191,0.55)' }} />
            <div style={{ display:'flex', flexDirection:'column', lineHeight:1.15 }}>
              <span style={{ fontSize:11, letterSpacing:'0.18em', color:'#8fe8dd', fontWeight:700 }}>DESTINO</span>
              <span style={{ fontSize:21, fontWeight:800, color:'#fff', position:'relative', display:'inline-block' }}>
                {APP_LUGAR}
                <span style={{ position:'absolute', left:0, right:0, bottom:-4, height:2, background:'#2DD4BF', boxShadow:'0 0 8px rgba(45,212,191,0.55)', borderRadius:2 }} />
              </span>
            </div>
            <span style={{ width:8, height:8, borderRadius:'50%', background:'#2DD4BF', boxShadow:'0 0 10px 2px rgba(45,212,191,0.55)', animation:'phgPulse 1.8s ease-in-out infinite', marginLeft:4 }} />
          </div>
        </div>
        <div className="phg-hero-right" style={{ position:'relative', zIndex:2, display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
          <div style={{ display:'flex', alignItems:'center', gap:8, background:'rgba(255,255,255,0.07)', border:'0.5px solid rgba(255,255,255,0.15)', borderRadius:10, padding:'8px 14px', backdropFilter:'blur(2px)' }}>
            <select value={mesSeleccionado} disabled={mesBloqueado} onChange={e => { setMesSeleccionado(parseInt(e.target.value)); setPlanillaEf(null) }} style={{ width:'auto', padding:0, background:'transparent', border:'none', color:'#ffd77a', fontSize:13.5, fontWeight:600, outline:'none', cursor: mesBloqueado ? 'not-allowed' : 'pointer', whiteSpace:'nowrap' }}>
              {MESES_NOMBRES.map((m,i) => <option key={i+1} value={i+1} style={{ background:'#111a33', color:'#fff' }}>{m}</option>)}
            </select>
            <select value={anioSeleccionado} disabled={mesBloqueado} onChange={e => { setAnioSeleccionado(parseInt(e.target.value)); setPlanillaEf(null) }} style={{ width:'auto', padding:0, background:'transparent', border:'none', color:'#ffd77a', fontSize:13.5, fontWeight:600, outline:'none', cursor: mesBloqueado ? 'not-allowed' : 'pointer', whiteSpace:'nowrap' }}>
              {[ANIO_ACTUAL, ANIO_ACTUAL+1].map(a => <option key={a} value={a} style={{ background:'#111a33', color:'#fff' }}>{a}</option>)}
            </select>
            <button onClick={toggleBloqueoMes}
              title={mesBloqueado ? `Mes bloqueado en ${NOMBRE_MES} — click para desbloquear` : 'Bloquear este mes (no se va a cambiar solo al entrar y salir)'}
              style={{ background:'transparent', border:'none', cursor:'pointer', fontSize:15, padding:'0 2px', opacity: mesBloqueado ? 1 : 0.55 }}>
              {mesBloqueado ? '🔒' : '🔓'}
            </button>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:8, background:'rgba(55,138,221,0.18)', border:'0.5px solid rgba(55,138,221,0.5)', borderRadius:10, padding:'8px 14px', fontWeight:600, color:'#bcd9f7', fontSize:13.5 }}>👤 Admin</div>
          <button className="phg-salir" onClick={() => { localStorage.removeItem('polad_user'); localStorage.removeItem('polad_session'); router.push('/') }}
            style={{ display:'flex', alignItems:'center', gap:6, background:'rgba(224,91,91,0.14)', border:'0.5px solid rgba(224,91,91,0.4)', color:'#f3b3b3', borderRadius:10, padding:'8px 14px', fontWeight:600, cursor:'pointer', fontSize:13.5 }}>↪ Salir</button>
        </div>
      </div>
      </>)}

      <div style={true ? { display:'flex', alignItems:'flex-start' } : undefined}>
      {true && (
        <div className="phg-sidebar" style={{ width:220, flexShrink:0, background:'#0f1830', borderRight:'0.5px solid rgba(255,255,255,0.08)', display:'flex', flexDirection:'column', padding:'14px 10px', gap:2, minHeight:'calc(100vh - 150px)' }}>
          {PHG_NAV_PRINCIPAL.map(it => (
            <button key={it.v} className={'phg-navbtn' + (vista===it.v ? ' phg-activa' : '')} onClick={() => setVista(it.v)}>
              {PHG_ICONOS[it.v]}<span className="phg-lbl">{it.label}</span>
            </button>
          ))}
          <div style={{ height:1, background:'rgba(255,255,255,0.08)', margin:'10px 6px' }} />
          {PHG_NAV_SECUNDARIO.map(it => (
            <button key={it.v} className={'phg-navbtn' + (vista===it.v ? ' phg-activa' : '')} onClick={() => setVista(it.v)}>
              {PHG_ICONOS[it.v]}<span className="phg-lbl">{it.label}</span>
            </button>
          ))}
          <button className="phg-navbtn" onClick={() => router.push('/control')}>
            {PHG_ICONOS.control}<span className="phg-lbl">Control asistencia</span>
          </button>
          <div style={{ marginTop:'auto', display:'flex', alignItems:'center', gap:10, padding:'12px 10px 4px', borderTop:'1px solid rgba(255,255,255,0.08)' }}>
            <img src={`/${PHG_SLUG}-facade.jpg`} alt={APP_LUGAR} style={{ width:34, height:34, borderRadius:8, objectFit:'cover', border:'1px solid rgba(45,212,191,0.4)' }} />
            <div className="phg-sidebar-foot-txt" style={{ fontSize:13, fontWeight:700, color:'#fff' }}>
              {APP_LUGAR}
              <span style={{ display:'block', width:26, height:2, background:'#2DD4BF', marginTop:3, boxShadow:'0 0 6px rgba(45,212,191,0.55)' }} />
            </div>
          </div>
        </div>
      )}

      <div className="content" style={true ? { flex:1, minWidth:0 } : undefined}>
        <div style={{ display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:16 }}>
          <div>
            <h2 style={{ fontSize:28,fontWeight:700,color:'#fff',margin:0 }}>Resumen del mes</h2>
            <p style={{ fontSize:15,color:'#c8a84b',margin:'4px 0 0' }}>{APP_LUGAR} · {NOMBRE_MES}</p>
          </div>
          <div style={{ display:'flex',alignItems:'center',gap:6,background:hayTurnos?'rgba(29,158,117,0.15)':'rgba(200,168,75,0.15)',border:hayTurnos?'0.5px solid rgba(29,158,117,0.4)':'0.5px solid rgba(200,168,75,0.4)',color:hayTurnos?'#1D9E75':'#c8a84b',borderRadius:8,padding:'7px 14px',fontSize:14,fontWeight:600 }}>
            <span>{hayTurnos?'✅':'⏱'}</span>{hayTurnos?'Generado':'Sin generar'}
          </div>
        </div>
        {(() => {
          // Texto oscuro o claro según qué tan clara sea la placa de color
          // de fondo — así funciona con cualquier color (incluido
          // COLOR_APP, que cambia según HIGA/UPA/MODULAR).
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

          // Cobertura de guardias — mismos 2 paneles con barras segmentadas
          // de siempre (pedido anterior: título + un título por barra),
          // sin tocar ningún cálculo. Se muestran para HIGA y para
          // UPA/MODULAR por igual.
          const coberturaPanels = (
            <>
              <div style={{ fontSize:16, fontWeight:700, color:'#fff', borderLeft:`3px solid ${COLOR_APP}`, paddingLeft:10, marginBottom:14 }}>Cobertura de guardias — {NOMBRE_MES}</div>

              <div style={{ background:'#262a38', border:'0.5px solid rgba(255,255,255,0.11)', borderRadius:14, padding:'18px 20px', marginBottom:14 }}>
                <div style={{ fontSize:14, fontWeight:600, color:'#e8eaf0', display:'flex', alignItems:'center', gap:8, marginBottom:14 }}>Guardias asignadas <span style={{ color:'#7a8099', fontWeight:400, fontSize:12.5 }}>— {todosLosTurnos.length} turnos · {horasAsignadas} horas ({HORAS_TURNO} hs/guardia)</span></div>
                <div style={{ marginBottom:16 }}>
                  <div style={{ fontSize:11, color:'#7a8099', textTransform:'uppercase', letterSpacing:'.05em', marginBottom:7 }}>Guardias asignadas por sexo</div>
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
                  <div style={{ fontSize:11, color:'#7a8099', textTransform:'uppercase', letterSpacing:'.05em', marginBottom:7 }}>Guardias asignadas por tipo de efectivo</div>
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

              <div style={{ background:'#262a38', border:'0.5px solid rgba(255,255,255,0.11)', borderRadius:14, padding:'18px 20px', marginBottom:16 }}>
                <div style={{ fontSize:14, fontWeight:600, color:'#e8eaf0', display:'flex', alignItems:'center', gap:8, marginBottom:14 }}>Disponibilidad cargada <span style={{ color:'#7a8099', fontWeight:400, fontSize:12.5 }}>— {cargaron} efectivos</span></div>
                {/* Pedido: la barra "por sexo" de este cuadro se sacó porque es
                    la misma medición que ya muestran las cajitas "Femeninos" /
                    "Masculinos" de arriba, solo que repetida en otro formato.
                    La de "por tipo" queda, porque acá desglosa en 3 categorías
                    (Uniformados/Serv. General/Destacamento) algo que arriba
                    solo aparece como 2 (Uniformados/No uniformados). */}
                <div>
                  <div style={{ fontSize:11, color:'#7a8099', textTransform:'uppercase', letterSpacing:'.05em', marginBottom:7 }}>Disponibilidad cargada por tipo de efectivo</div>
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
            </>
          )

          if (true) {
            // Rediseño aprobado: tarjetas de colores + accesos rápidos +
            // mapa de recorridos (imagen de referencia, pendiente de
            // validar) + estado general con % real. Todos los valores son
            // los mismos de siempre (guardiasNecesarias, cargaron,
            // cargaronFemenino, etc. — ya calculados arriba, sin tocar). Los
            // 2 paneles de "Cobertura de guardias" con barras segmentadas
            // que ya tenías (con su título y el de cada barra) se
            // mantienen debajo, sin sacarles nada: tienen el desglose de
            // Servicio General / Destacamento que las tarjetas nuevas (que
            // solo separan Uniformados / No uniformados) no muestran.
            const statCard = (icon, color, label, sub, val, full = false) => (
              <div key={label} className={full ? 'phg-full' : undefined} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:8, background:'#15203f', border:'0.5px solid rgba(255,255,255,0.09)', borderLeft:`4px solid ${color}`, borderRadius:11, padding:'10px 12px', minWidth:0 }}>
                <div style={{ display:'flex', alignItems:'center', gap:8, minWidth:0 }}>
                  <span className="phg-stat-icon" style={{ color }}>{icon}</span>
                  <div style={{ minWidth:0 }}>
                    <div style={{ fontSize:12, fontWeight:600, color:'#e9ecf7', lineHeight:1.25 }}>{label}</div>
                    <div style={{ fontSize:10, color:'#5f6c93', lineHeight:1.3 }}>{sub}</div>
                  </div>
                </div>
                <div style={{ fontSize:17, fontWeight:800, color, flexShrink:0 }}>{val}</div>
              </div>
            )
            // % real de guardias cubiertas este mes (no es un número fijo:
            // guardiasNecesarias y guardiasSinCubrir ya están calculados
            // arriba con el mismo cupo real que usa la planilla).
            const pctCobertura = guardiasNecesarias ? Math.max(0, Math.min(100, Math.round((guardiasNecesarias - guardiasSinCubrir) / guardiasNecesarias * 100))) : 0
            return (<>
              <div className="phg-maingrid">
                <div className="phg-col-izq">
                  <div className="phg-col-resumen">
                    <div className="phg-grid-stats">
                      {statCard(PHG_ICONOS.calendario, DORADO, 'Guardias a cubrir', NOMBRE_MES, guardiasNecesarias)}
                      {statCard(PHG_ICONOS.reloj, DORADO, 'Horas a cubrir', NOMBRE_MES, horasNecesarias)}
                      {statCard(PHG_ICONOS.personal, '#2DD4BF', 'Cargaron disponibilidad', `de ${efectivos.length} efectivos`, cargaron, true)}
                      {statCard(PHG_ICONOS.femenino, ROSA_F, 'Femeninos', `${pctDisp(cargaronFemenino)} de los que cargaron`, cargaronFemenino)}
                      {statCard(PHG_ICONOS.masculino, AZUL_M, 'Masculinos', `${pctDisp(cargaronMasculino)} de los que cargaron`, cargaronMasculino)}
                      {statCard(PHG_ICONOS.turnos, COLOR_APP, 'Uniformados', `${pctDisp(cargaronUniformado)} de los que cargaron`, cargaronUniformado)}
                      {statCard(PHG_ICONOS.noUniforme, NO_UNIFORME, 'No uniformados', `${pctDisp(noUniformado)} de los que cargaron`, noUniformado)}
                      {statCard(PHG_ICONOS.alerta, ROJO_ALERTA, 'Guardias sin cubrir', `de ${guardiasNecesarias} necesarias`, guardiasSinCubrir)}
                      {statCard(PHG_ICONOS.alerta, ROJO_ALERTA, 'Horas sin cubrir', `de ${horasNecesarias} hs necesarias`, horasSinCubrir)}
                    </div>
                  </div>
                  <div className="phg-col-accesos">
                    <div>
                      <h3 style={{ fontSize:15, fontWeight:800, color:'#fff', display:'flex', alignItems:'center', gap:8, marginBottom:12 }}>⚡ Accesos rápidos</h3>
                      <div className="phg-accesos-grid">
                        <button className="phg-acceso" style={{ background:'rgba(216,165,49,0.14)', border:'0.5px solid rgba(216,165,49,0.4)', color:'#ffd77a' }} onClick={() => setVista('rapida')}>{PHG_ICONOS.rapida}Asignación rápida</button>
                        <button className="phg-acceso" style={{ background:'rgba(55,138,221,0.14)', border:'0.5px solid rgba(55,138,221,0.4)', color:'#9cc8f2' }} onClick={() => setVista('disponibilidad')}>{PHG_ICONOS.disponibilidad}Cargar disponibilidad</button>
                        <button className="phg-acceso" style={{ background:'rgba(175,169,236,0.14)', border:'0.5px solid rgba(175,169,236,0.4)', color:'#cfc9f7' }} onClick={() => setVista('planillas')}>{PHG_ICONOS.planillas}Planilla del mes</button>
                        <button className="phg-acceso" style={{ background:'rgba(29,158,117,0.16)', border:'0.5px solid rgba(29,158,117,0.45)', color:'#7ee0bd' }} onClick={() => setVista('descarga')}>{PHG_ICONOS.descarga}Planilla Guardia</button>
                        <button className="phg-acceso" style={{ background:'rgba(99,102,241,0.16)', border:'0.5px solid rgba(99,102,241,0.45)', color:'#b4b8f7' }} onClick={() => router.push('/control')}>{PHG_ICONOS.control}Control asistencia</button>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="phg-col-der">
                  <div className="phg-col-mapa">
                    <div style={{ background:'#15203f', border:'0.5px solid rgba(255,255,255,0.09)', borderRadius:14, overflow:'hidden' }}>
                      <img src={`/${PHG_SLUG}-mapa-referencia.jpg`} alt="Recorridos y puestos — referencia" style={{ width:'100%', display:'block' }} />
                      <div style={{ padding:'10px 16px', fontSize:11, color:'#5f6c93', background:'rgba(255,255,255,0.03)', borderTop:'0.5px solid rgba(255,255,255,0.07)', lineHeight:1.5 }}>
                        <b style={{ color:'#c9bdf5' }}>Pendiente de validar con vos:</b> esta imagen es la que vos aprobaste como referencia visual. Antes de animarla con los recorridos reales (quién camina por dónde, perímetro exacto) necesito que me confirmes sector por sector si el trazado coincide con el predio real — no quiero inventar un recorrido que no sea el verdadero.
                      </div>
                    </div>
                  </div>
                  <div className="phg-col-estado">
                    <div style={{ background:'#15203f', border:'0.5px solid rgba(255,255,255,0.09)', borderRadius:14, padding:'18px 20px' }}>
                      <h3 style={{ fontSize:14.5, fontWeight:700, color:'#fff', display:'flex', alignItems:'center', gap:8 }}>📅 Estado general</h3>
                      <div style={{ display:'flex', alignItems:'baseline', justifyContent:'space-between', margin:'10px 0 10px' }}>
                        <span style={{ fontSize:14, color:'#eef1fb' }}>Guardias cubiertas</span>
                        <span style={{ fontSize:26, fontWeight:800, color:'#6EE7DA' }}>{pctCobertura}%</span>
                      </div>
                      <div style={{ height:14, borderRadius:7, background:'rgba(255,255,255,0.07)', overflow:'hidden' }}>
                        <div style={{ height:'100%', borderRadius:7, background:'linear-gradient(90deg,#1D9E75,#2DD4BF)', width:`${pctCobertura}%`, boxShadow:'0 0 14px rgba(45,212,191,0.5)', position:'relative', overflow:'hidden', transition:'width 1.2s cubic-bezier(.22,.9,.3,1)' }}>
                          <div style={{ position:'absolute', inset:0, background:'linear-gradient(90deg, transparent, rgba(255,255,255,0.35), transparent)', width:'40%', animation:'phgShimmer 2.4s linear infinite' }} />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              {coberturaPanels}
            </>)
          }

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

            {/* Pedido: "arriba esté Guardias asignadas y abajo Disponibilidad
                cargada", con un título para la sección y para cada
                porcentaje — antes los dos cuadros usaban las mismas
                etiquetas genéricas "Por sexo"/"Por tipo" sin aclarar a cuál
                de los dos cuadros correspondía cada barra. */}
            {coberturaPanels}
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
          const uniformados = efectivos.filter(e => e.tipo === 'Uniformado')
          const servGeneral = efectivos.filter(e => e.tipo === 'Serv. General')
          const destacamento = efectivos.filter(e => e.tipo === 'Destacamento')
          // Cuántos masculinos y femeninos hay en cada grupo (los que no tienen
          // el sexo cargado en la ficha se cuentan aparte, como "sin dato")
          const textoSexo = lista => {
            let m = 0, f = 0, sd = 0
            lista.forEach(e => {
              const x = String(e.sexo || '').trim().toLowerCase()
              if (x === 'masculino') m++
              else if (x === 'femenino') f++
              else sd++
            })
            return `${m} ${m === 1 ? 'masculino' : 'masculinos'} · ${f} ${f === 1 ? 'femenino' : 'femeninos'}` + (sd > 0 ? ` · ${sd} sin dato` : '')
          }
          const detalleSexo = lista => <span style={{ fontSize:12,fontWeight:400,opacity:0.9,marginLeft:12 }}>({textoSexo(lista)})</span>
          const renderFichas = lista => lista.map(e => {
            const hs = horasAsig[e.legajo] || 0
            const pct = Math.round(hs / 180 * 100)
            const color = pct >= 100 ? '#E24B4A' : pct >= 80 ? '#EF9F27' : '#1D9E75'
            const turnosEf = turnos[e.legajo] || []
            const iniciales = e.nombre.split(',').map(p => p.trim()[0]).join('').toUpperCase().slice(0, 2)
            return (
              <div key={e.legajo} className="card" style={{ padding:0, overflow:'hidden', cursor:'pointer', border: notificados.has(e.legajo) ? '0.5px solid rgba(29,158,117,0.4)' : undefined }} onClick={() => { setMsgPersonal(null); setModalPersonal({ ...e }) }}>
                {notificados.has(e.legajo) && (() => {
                  const ts = notificados.get(e.legajo)
                  const d = new Date(ts)
                  const hora = d.toLocaleTimeString('es-AR', { hour:'2-digit', minute:'2-digit' })
                  const dia = d.toLocaleDateString('es-AR', { day:'numeric', month:'long' })
                  return (
                    <div style={{ background:'rgba(29,158,117,0.1)', borderBottom:'0.5px solid rgba(29,158,117,0.2)', padding:'5px 12px', display:'flex', alignItems:'center', gap:6 }} onClick={ev=>ev.stopPropagation()}>
                      <span style={{ fontSize:13, color:'#1D9E75' }}>✓</span>
                      <span style={{ fontSize:10, fontWeight:500, color:'#1D9E75', flex:1 }}>Avisado el {dia} a las {hora}</span>
                      <button onClick={ev=>{ev.stopPropagation();desmarcarNotificado(e.legajo)}} style={{ fontSize:9, color:'var(--text-muted)', background:'none', border:'none', cursor:'pointer', textDecoration:'underline', padding:0 }}>desmarcar</button>
                    </div>
                  )
                })()}
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
                    notificados.has(e.legajo)
                    ? <div style={{ display:'flex', alignItems:'center', gap:8, padding:'7px 12px', borderRadius:6, border:'0.5px solid rgba(29,158,117,0.3)', background:'rgba(29,158,117,0.07)', opacity:0.8 }}>
                        <span style={{ fontSize:14, color:'#1D9E75' }}>✓</span>
                        <span style={{ fontSize:11, fontWeight:500, color:'#1D9E75', flex:1 }}>Mensaje enviado</span>
                        <span style={{ fontSize:14, color:'#1D9E75', opacity:0.5 }}>📱</span>
                      </div>
                    : <a href={(() => {
                        const tel = '549' + e.telefono.replace(/\D/g,'')
                        const jerarquia = e.jerarquia ? e.jerarquia + ' ' : ''
                        const nombreFormateado = e.nombre.split(',').map(p => p.trim()).reverse().join(' ')
                        const ts = [...turnosEf].sort((a,b) => a.dia - b.dia)
                        const subtotal = ts.length * HORAS_TURNO
                        const lineas = ts.map(t => { const ti = TURNOS_INFO.find(x=>x.key===t.turno); return `   %E2%80%A2 D%C3%ADa ${t.dia} %E2%80%94 ${encodeURIComponent(ti?.horario||t.turno)} hs %E2%80%94 ${encodeURIComponent(t.sector)}` }).join('%0A')
                        const msg = `Estimado%2Fa ${encodeURIComponent(jerarquia + nombreFormateado)}%3A%0A%0ASe le comunica el cronograma POLAD *${APP_LUGAR}* para *${encodeURIComponent(NOMBRE_MES.toUpperCase())}*%3A%0A%0A${lineas}%0A%0A%E2%9C%85 *Total: ${subtotal} hs*%0A%0A_Referente: Crio. Paulo Corbela_%0A_POLAD %C2%B7 ${APP_LUGAR} %C2%B7 Mar del Plata_`
                        return `https://wa.me/${tel}?text=${msg}`
                      })()} target="_blank" rel="noopener noreferrer"
                      onClick={ev=>{ev.stopPropagation();marcarNotificado(e.legajo)}}
                      style={{ display:'flex', alignItems:'center', gap:8, padding:'7px 12px', borderRadius:6, border:'0.5px solid rgba(37,211,102,0.35)', background:'rgba(37,211,102,0.07)', color:'#25D366', fontSize:11, fontWeight:500, textDecoration:'none' }}>
                        <span style={{ fontSize:14 }}>📱</span>
                        <span style={{ flex:1 }}>Enviar guardias por WhatsApp</span>
                        <span style={{ fontSize:12, opacity:0.6 }}>›</span>
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
                <div className="panel-header" style={{ background:BG_APP }}><h3 style={{ color:COLOR_APP }}>Uniformados — {uniformados.length} efectivos{detalleSexo(uniformados)}</h3></div>
                <div style={{ padding:14,display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))',gap:10 }}>{renderFichas(uniformados)}</div>
              </div>
              <div className="panel">
                <div className="panel-header" style={{ background:'rgba(13,51,40,0.5)' }}><h3 style={{ color:'#5DCAA5' }}>Servicio General — {servGeneral.length} efectivos{detalleSexo(servGeneral)}</h3></div>
                <div style={{ padding:14,display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))',gap:10 }}>{renderFichas(servGeneral)}</div>
              </div>
              {destacamento.length > 0 && (
                <div className="panel" style={{ marginTop:16 }}>
                  <div className="panel-header" style={{ background:'rgba(80,70,0,0.4)' }}><h3 style={{ color:'#F5C518' }}>Destacamento — {destacamento.length} efectivos{detalleSexo(destacamento)}</h3></div>
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
                        {seleccionado && (
                          <div style={{ border:'0.5px solid rgba(200,168,75,0.3)', borderTop:'none', borderRadius: cargo ? 0 : '0 0 8px 8px', padding:'8px 12px', background:'rgba(200,168,75,0.04)' }}>
                            <button className="btn btn-sm" style={{ width:'100%', justifyContent:'center', background:'rgba(200,168,75,0.12)', color:'#c8a84b', border:'0.5px solid rgba(200,168,75,0.35)' }} onClick={() => abrirDispAdmin(e)}>
                              ✎ Cargar/editar disponibilidad (fuera de término)
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
                                        <span key={dia} style={{ display:'inline-flex', alignItems:'center', justifyContent:'center', width:28, height:28, borderRadius:4, background:'var(--surface2)', fontSize:10, color:'var(--text-hint)', border:'0.5px solid rgba(255,255,255,0.05)' }}>{dia}</span>
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
                                          <span style={{ fontSize:8, fontWeight:400, opacity:0.8 }}>{dia}</span>
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
            {hayTurnos && (
              <div className="panel">
                <div className="panel-header"><h3>Cronograma {APP_LUGAR} — {NOMBRE_MES}</h3></div>
                <div style={{ overflowX:'auto' }}>
                  <table style={{ tableLayout:'fixed',width:'max-content',minWidth:'100%' }}>
                    <thead>
                      <tr>
                        <th style={{ width:130 }}>Sector</th>
                        {Array.from({ length:DIAS_MES },(_,i) => <th key={i} style={{ width:94,textAlign:'center',padding:'8px 3px' }}>{i+1}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {SECTORES_APP.map(sector => (
                        <tr key={sector}>
                          <td><span style={{ display:'inline-flex',alignItems:'center',gap:4,fontSize:11 }}><span className="dot" style={{ background:SEC_COLORS[sector] }}></span>{sector}</span></td>
                          {Array.from({ length:DIAS_MES },(_,i) => {
                            const dia = i+1
                            return <td key={i} style={{ padding:'3px',fontSize:10,verticalAlign:'top' }}>
                              {TURNOS_INFO.map((ti, tidx) => {
                                const list = todosLosTurnos.filter(t=>t.dia===dia&&t.turno===ti.key&&t.sector===sector)
                                // Un encabezado chico con la letra del turno,
                                // una sola vez por grupo (antes se repetía
                                // "(M)"/"(T)"/"(N)" al lado de cada nombre, lo
                                // que alargaba cada línea y hacía más fácil que
                                // se corten en 2-3 renglones). Una línea
                                // separadora entre grupos para que se note de
                                // un vistazo dónde termina un turno y empieza
                                // el siguiente, sin depender solo del color.
                                return (
                                  <div key={ti.key} style={{ marginBottom:6, paddingBottom:5, borderBottom: tidx < TURNOS_INFO.length-1 ? '0.5px solid rgba(255,255,255,0.09)' : 'none' }}>
                                    <div style={{ color:ti.color, fontWeight:800, fontSize:9, letterSpacing:'0.04em', marginBottom:2, opacity:0.9 }}>{ti.key.toUpperCase()}</div>
                                    {list.length ? list.map((t, idx) => (
                                      // Un efectivo por línea (antes iban todos
                                      // separados solo por comas, en una columna
                                      // angosta — con varios nombres se pegaban
                                      // uno con otro y costaba distinguirlos).
                                      <div key={t.id ?? `${t.legajo}-${idx}`} style={{ color:ti.color, lineHeight:1.5 }}>{nombreCorto(t.legajo)}</div>
                                    )) : <div style={{ color:'var(--text-hint)' }}>—</div>}
                                  </div>
                                )
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
                          const celdaKey = `${sector}|${ti.key}`
                          return (
                            <div key={ti.key} data-celda={celdaKey} style={{ marginBottom:idx<TURNOS_INFO.length-1?8:0,paddingBottom:idx<TURNOS_INFO.length-1?8:0,borderBottom:idx<TURNOS_INFO.length-1?'0.5px solid var(--border)':'', borderRadius:6, outline: dragOverKey===celdaKey ? `1.5px dashed ${ti.color}` : 'none', outlineOffset:2 }}
                              // Soltar sobre el espacio del puesto (no sobre una persona puntual) = mover ahí, sin intercambiar a nadie.
                              onDragOver={e => { e.preventDefault(); setDragOverKey(celdaKey) }}
                              onDragLeave={() => setDragOverKey(prev => prev===celdaKey ? null : prev)}
                              onDrop={e => {
                                e.preventDefault()
                                setDragOverKey(null)
                                let origen = null
                                try { origen = JSON.parse(e.dataTransfer.getData('application/json')) } catch (err) { return }
                                handleDropTurno(origen, { sector, turno: ti.key, ocupanteItem: null })
                              }}>
                              <div style={{ fontSize:10,color:ti.color,fontWeight:500,marginBottom:5 }}>{ti.label.toUpperCase()}</div>
                              {list.length===0 && cupoSlot(sector, ti.key)===0 && <div style={{ fontSize:11,color:'var(--text-hint)',fontStyle:'italic' }}>No corresponde</div>}
                              {list.length===0 && cupoSlot(sector, ti.key)>0 && <div style={{ display:'flex',alignItems:'center',gap:6 }}><span style={{ fontSize:11,color:'var(--text-hint)',fontStyle:'italic' }}>Sin cubrir</span><button className="btn btn-sm" style={{ fontSize:10,padding:'2px 8px',color:ti.color,borderColor:`${ti.color}66` }} onClick={() => setModalTurno({ dia:filtroDia,sector,turno:ti.key,legajo:'' })}>+ Asignar</button></div>}
                              {list.map(item => (
                                <div key={item.id}
                                  data-turno-id={item.id}
                                  draggable
                                  title="Arrastrá para mover o intercambiar de puesto"
                                  onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('application/json', JSON.stringify({ id:item.id, legajo:item.legajo, sector:item.sector, turno:item.turno, dia:item.dia })) }}
                                  onDragOver={e => { e.preventDefault(); e.stopPropagation(); setDragOverKey(`item|${item.id}`) }}
                                  onDragLeave={() => setDragOverKey(prev => prev===`item|${item.id}` ? null : prev)}
                                  onDrop={e => {
                                    e.preventDefault(); e.stopPropagation()
                                    setDragOverKey(null)
                                    let origen = null
                                    try { origen = JSON.parse(e.dataTransfer.getData('application/json')) } catch (err) { return }
                                    handleDropTurno(origen, { sector, turno: ti.key, ocupanteItem: item })
                                  }}
                                  style={{ display:'flex',alignItems:'center',justifyContent:'space-between',padding:'4px 8px',background:ti.bg,borderRadius:6,marginBottom:3, cursor:'grab', outline: dragOverKey===`item|${item.id}` ? '1.5px dashed #c8a84b' : 'none', outlineOffset:1 }}>
                                  <span style={{ display:'flex',alignItems:'center',gap:6,minWidth:0 }}>
                                    {marcaSexo(item.legajo)}
                                    <span style={{ fontSize:12,fontWeight:500 }}>{nombreCompleto(item.legajo)}</span>
                                    {marcaTipo(item.legajo)}
                                  </span>
                                  <div style={{ display:'flex',gap:4 }}>
                                    <button className="btn btn-sm" style={{ fontSize:10,padding:'2px 6px' }} onClick={() => setModalTurno(item)}>Cambiar</button>
                                    <button className="btn btn-sm" style={{ fontSize:10,padding:'2px 6px',color:'#F09595',borderColor:'rgba(240,149,149,0.3)' }} onClick={() => handleEliminarTurno(item)}>✕</button>
                                  </div>
                                </div>
                              ))}
                              {list.length>0&&list.length<cupoSlot(sector, ti.key) && <button className="btn btn-sm" style={{ fontSize:10,padding:'2px 8px',marginTop:3,color:ti.color,borderColor:`${ti.color}55` }} onClick={() => setModalTurno({ dia:filtroDia,sector,turno:ti.key,legajo:'' })}>+ Agregar</button>}
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
                        const hayLugar = SECTORES_APP.some(s => (ocupSlots[s]||0) < cupoSlot(s, ti.key))
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
                    <div style={{ marginBottom:14, border:'1px solid var(--border)', borderRadius:8, overflow:'hidden', background:'rgba(255,255,255,0.02)' }}>
                      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'8px 12px', background:'rgba(255,255,255,0.03)', cursor:'pointer' }}
                        onClick={() => setReglasModal(!reglasModal)}>
                        <span style={{ fontSize:12, fontWeight:500 }}>⚙ Reglas especiales {APP_LUGAR}</span>
                        <span style={{ fontSize:11, color:'var(--text-muted)' }}>{reglasModal ? '▲' : '▼'}</span>
                      </div>
                      {reglasModal && (
                        <div style={{ padding:12 }}>
                          <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginBottom:12 }}>
                            {[
                              { key:'especiales', label:'⚙ Casos especiales', count: especiales.length, color:'#1D9E75', bg:'rgba(29,158,117,0.15)' },
                              { key:'puestoFijo', label:'📍 Puestos fijos', count: puestoFijoReglas.length, color:'#EF9F27', bg:'rgba(239,159,39,0.15)' },
                              { key:'cantidadFija', label:'🎯 Cantidad fija', count: objetivoReglas.length, color:'#AFA9EC', bg:'rgba(123,111,216,0.15)' },
                            ].map(t => (
                              <button key={t.key} className="btn btn-sm"
                                style={{ fontSize:11, background: reglasTab === t.key ? t.bg : 'transparent', color: reglasTab === t.key ? t.color : 'var(--text-muted)', border: reglasTab === t.key ? `0.5px solid ${t.color}` : '0.5px solid var(--border)' }}
                                onClick={() => setReglasTab(t.key)}>
                                {t.label} ({t.count})
                              </button>
                            ))}
                          </div>

                          {reglasTab === 'especiales' && (
                            <div>
                              <div style={{ display:'flex', flexWrap:'wrap', gap:10, marginBottom:10 }}>
                                <div style={{ flex:'1 1 240px' }}>
                                  <div style={{ fontSize:11, fontWeight:600, color:'var(--text-muted)', marginBottom:6 }}>GUARDIAS DE 24HS</div>
                                  <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
                                    {especiales.filter(e => e.tipo === '24hs').length === 0 && <span style={{ fontSize:11, color:'var(--text-hint)' }}>Ninguno configurado.</span>}
                                    {especiales.filter(e => e.tipo === '24hs').map(e => {
                                      const ef = efectivos.find(x => String(x.legajo) === String(e.legajo1))
                                      return (
                                        <div key={e.id} style={{ display:'inline-flex', alignItems:'center', gap:6, padding:'4px 8px', background:'rgba(29,158,117,0.1)', border:'0.5px solid rgba(29,158,117,0.3)', borderRadius:14 }}>
                                          <span style={{ fontSize:11 }}>{(ef?.nombre || e.legajo1).split(',')[0]}</span>
                                          <button style={{ fontSize:10, color:'#F09595', background:'none', border:'none', cursor:'pointer', padding:0 }} onClick={() => quitarEspecial(e.id)}>✕</button>
                                        </div>
                                      )
                                    })}
                                  </div>
                                </div>
                                <div style={{ flex:'1 1 240px' }}>
                                  <div style={{ fontSize:11, fontWeight:600, color:'var(--text-muted)', marginBottom:6 }}>PAREJAS</div>
                                  <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
                                    {especiales.filter(e => e.tipo === 'pareja').length === 0 && <span style={{ fontSize:11, color:'var(--text-hint)' }}>Ninguna configurada.</span>}
                                    {especiales.filter(e => e.tipo === 'pareja').map(e => {
                                      const ef1 = efectivos.find(x => String(x.legajo) === String(e.legajo1))
                                      const ef2 = efectivos.find(x => String(x.legajo) === String(e.legajo2))
                                      return (
                                        <div key={e.id} style={{ display:'inline-flex', alignItems:'center', gap:6, padding:'4px 8px', background:'rgba(239,159,39,0.1)', border:'0.5px solid rgba(239,159,39,0.3)', borderRadius:14 }}>
                                          <span style={{ fontSize:11 }}>{(ef1?.nombre || e.legajo1).split(',')[0]} + {(ef2?.nombre || e.legajo2).split(',')[0]}</span>
                                          <button style={{ fontSize:10, color:'#F09595', background:'none', border:'none', cursor:'pointer', padding:0 }} onClick={() => quitarEspecial(e.id)}>✕</button>
                                        </div>
                                      )
                                    })}
                                  </div>
                                </div>
                                {APP_LUGAR === 'MODULAR' && (
                                  <div style={{ flex:'1 1 240px' }}>
                                    <div style={{ fontSize:11, fontWeight:600, color:'var(--text-muted)', marginBottom:6 }}>DOBLE TURNO</div>
                                    <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
                                      {especiales.filter(e => e.tipo === 'doble').length === 0 && <span style={{ fontSize:11, color:'var(--text-hint)' }}>Ninguno configurado.</span>}
                                      {especiales.filter(e => e.tipo === 'doble').map(e => {
                                        const ef = efectivos.find(x => String(x.legajo) === String(e.legajo1))
                                        return (
                                          <div key={e.id} style={{ display:'inline-flex', alignItems:'center', gap:6, padding:'4px 8px', background:'rgba(123,111,216,0.1)', border:'0.5px solid rgba(123,111,216,0.3)', borderRadius:14 }}>
                                            <span style={{ fontSize:11 }}>{(ef?.nombre || e.legajo1).split(',')[0]}</span>
                                            <button style={{ fontSize:10, color:'#F09595', background:'none', border:'none', cursor:'pointer', padding:0 }} onClick={() => quitarEspecial(e.id)}>✕</button>
                                          </div>
                                        )
                                      })}
                                    </div>
                                  </div>
                                )}
                                {especiales.filter(e => !(e.tipo === '24hs' || e.tipo === 'pareja' || (e.tipo === 'doble' && APP_LUGAR === 'MODULAR'))).length > 0 && (
                                  <div style={{ flex:'1 1 240px' }}>
                                    <div style={{ fontSize:11, fontWeight:600, color:'var(--text-muted)', marginBottom:6 }}>OTROS GUARDADOS</div>
                                    <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
                                      {especiales.filter(e => !(e.tipo === '24hs' || e.tipo === 'pareja' || (e.tipo === 'doble' && APP_LUGAR === 'MODULAR'))).map(e => {
                                        const ef1 = efectivos.find(x => String(x.legajo) === String(e.legajo1))
                                        const ef2 = e.legajo2 ? efectivos.find(x => String(x.legajo) === String(e.legajo2)) : null
                                        return (
                                          <div key={e.id} style={{ display:'inline-flex', alignItems:'center', gap:6, padding:'4px 8px', background:'rgba(138,143,152,0.12)', border:'0.5px solid rgba(138,143,152,0.35)', borderRadius:14 }}>
                                            <span style={{ fontSize:11 }}>{(ef1?.nombre || e.legajo1 || '').split(',')[0]}{e.legajo2 ? ' + ' + (ef2?.nombre || e.legajo2).split(',')[0] : ''} · {e.tipo || 'sin tipo'}</span>
                                            <button style={{ fontSize:10, color:'#F09595', background:'none', border:'none', cursor:'pointer', padding:0 }} onClick={() => quitarEspecial(e.id)}>✕</button>
                                          </div>
                                        )
                                      })}
                                    </div>
                                  </div>
                                )}
                              </div>
                              <div style={{ paddingTop:8, borderTop:'0.5px solid var(--border)', display:'flex', flexWrap:'wrap', gap:6, alignItems:'center' }}>
                                <select value={nuevoEspecialTipo} onChange={e => { setNuevoEspecialTipo(e.target.value); setNuevoEspecialLeg1(''); setNuevoEspecialLeg2('') }}
                                  style={{ fontSize:11, padding:'4px 6px', borderRadius:6, background:'var(--bg-input)', color:'var(--text)', border:'0.5px solid var(--border)', flex:'0 0 120px' }}>
                                  <option value="24hs">24hs</option>
                                  <option value="pareja">Pareja</option>
                                  {APP_LUGAR === 'MODULAR' && <option value="doble">Doble turno</option>}
                                </select>
                                <select value={nuevoEspecialLeg1} onChange={e => setNuevoEspecialLeg1(e.target.value)}
                                  style={{ fontSize:11, padding:'4px 6px', borderRadius:6, background:'#ffffff', color:'#111111', border:'1px solid #aaa', flex:'1 1 200px' }}>
                                  <option value="" style={{ color:'#111', background:'#fff' }}>— Efectivo{nuevoEspecialTipo === 'pareja' ? ' 1' : ''} —</option>
                                  {[...efectivos].sort((a,b) => a.nombre.localeCompare(b.nombre)).map(e => (
                                    <option key={e.legajo} value={e.legajo} style={{ color:'#111', background:'#fff' }}>{e.nombre} · Leg. {e.legajo}</option>
                                  ))}
                                </select>
                                {nuevoEspecialTipo === 'pareja' && (
                                  <select value={nuevoEspecialLeg2} onChange={e => setNuevoEspecialLeg2(e.target.value)}
                                    style={{ fontSize:11, padding:'4px 6px', borderRadius:6, background:'#ffffff', color:'#111111', border:'1px solid #aaa', flex:'1 1 200px' }}>
                                    <option value="" style={{ color:'#111', background:'#fff' }}>— Efectivo 2 —</option>
                                    {[...efectivos].sort((a,b) => a.nombre.localeCompare(b.nombre)).map(e => (
                                      <option key={e.legajo} value={e.legajo} style={{ color:'#111', background:'#fff' }}>{e.nombre} · Leg. {e.legajo}</option>
                                    ))}
                                  </select>
                                )}
                                <button className="btn btn-sm" style={{ fontSize:11, background:'rgba(29,158,117,0.15)', color:'#1D9E75', flex:'0 0 auto' }} onClick={agregarEspecial}>+ Agregar</button>
                              </div>
                            </div>
                          )}

                          {reglasTab === 'puestoFijo' && (
                            <div>
                              <p style={{ fontSize:11, color:'var(--text-muted)', marginBottom:10, lineHeight:1.5 }}>
                                Un efectivo con puesto fijo configurado nunca se asigna automáticamente en otro sector (ni en otro turno, si se especifica uno) — ni en Asignación rápida, ni en Asignar guardias rápido, ni en Completar día, ni en Generar turnos. Si no alcanza a cubrir todo el objetivo desde su puesto, el resto queda pendiente e informado, nunca se completa en otro lado.
                              </p>
                              <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginBottom:10 }}>
                                {puestoFijoReglas.length === 0 && <span style={{ fontSize:11, color:'var(--text-hint)' }}>Ningún efectivo tiene puesto fijo configurado en {APP_LUGAR}.</span>}
                                {puestoFijoReglas.map(r => {
                                  const ef = efectivos.find(x => String(x.legajo) === String(r.legajo))
                                  const ti = TURNOS_INFO.find(x => x.key === r.turno)
                                  return (
                                    <div key={r.id} style={{ display:'inline-flex', alignItems:'center', gap:6, padding:'4px 8px', background:'rgba(239,159,39,0.1)', border:'0.5px solid rgba(239,159,39,0.3)', borderRadius:14 }}>
                                      <span style={{ fontSize:11 }}>{(ef?.nombre || r.legajo).split(',')[0]} — {r.sector}{ti ? ` · ${ti.label}` : ' · ambos turnos'}</span>
                                      <button style={{ fontSize:10, color:'#F09595', background:'none', border:'none', cursor:'pointer', padding:0 }} onClick={() => quitarPuestoFijo(r.id)}>✕</button>
                                    </div>
                                  )
                                })}
                              </div>
                              <div style={{ paddingTop:8, borderTop:'0.5px solid var(--border)', display:'flex', flexWrap:'wrap', gap:6, alignItems:'center' }}>
                                <select value={nuevoPuestoLeg} onChange={e => setNuevoPuestoLeg(e.target.value)}
                                  style={{ fontSize:11, padding:'4px 6px', borderRadius:6, background:'#ffffff', color:'#111111', border:'1px solid #aaa', flex:'1 1 200px' }}>
                                  <option value="" style={{ color:'#111', background:'#fff' }}>— Seleccioná efectivo —</option>
                                  {[...efectivos].sort((a,b) => a.nombre.localeCompare(b.nombre)).map(e => (
                                    <option key={e.legajo} value={e.legajo} style={{ color:'#111', background:'#fff' }}>{e.nombre} · Leg. {e.legajo}</option>
                                  ))}
                                </select>
                                <select value={nuevoPuestoSector} onChange={e => setNuevoPuestoSector(e.target.value)}
                                  style={{ fontSize:11, padding:'4px 6px', borderRadius:6, background:'#ffffff', color:'#111111', border:'1px solid #aaa', flex:'0 0 150px' }}>
                                  <option value="" style={{ color:'#111', background:'#fff' }}>— Sector —</option>
                                  {SECTORES_APP.map(s => (
                                    <option key={s} value={s} style={{ color:'#111', background:'#fff' }}>{s}</option>
                                  ))}
                                </select>
                                <select value={nuevoPuestoTurno} onChange={e => setNuevoPuestoTurno(e.target.value)}
                                  style={{ fontSize:11, padding:'4px 6px', borderRadius:6, background:'#ffffff', color:'#111111', border:'1px solid #aaa', flex:'0 0 140px' }}>
                                  <option value="" style={{ color:'#111', background:'#fff' }}>Ambos turnos</option>
                                  {TURNOS_INFO.map(t => (
                                    <option key={t.key} value={t.key} style={{ color:'#111', background:'#fff' }}>Solo {t.label}</option>
                                  ))}
                                </select>
                                <button className="btn btn-sm" style={{ fontSize:11, background:'rgba(239,159,39,0.15)', color:'#EF9F27', flex:'0 0 auto' }} onClick={agregarPuestoFijo}>+ Configurar</button>
                              </div>
                            </div>
                          )}

                          {reglasTab === 'cantidadFija' && (
                            <div>
                              <p style={{ fontSize:11, color:'var(--text-muted)', marginBottom:10, lineHeight:1.5 }}>
                                Para un efectivo con cantidad fija configurada, Asignación rápida usa ESE número como objetivo en vez de la cantidad de {nombrePrev} — lo reemplaza directamente, nunca se suma ni se resta. Si cargó disponibilidad pero no tenía guardias el mes pasado, con esto pasa a la lista de abajo con su cantidad.
                              </p>
                              <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginBottom:10 }}>
                                {objetivoReglas.length === 0 && <span style={{ fontSize:11, color:'var(--text-hint)' }}>Ningún efectivo tiene cantidad fija configurada en {APP_LUGAR}.</span>}
                                {objetivoReglas.map(r => {
                                  const ef = efectivos.find(x => String(x.legajo) === String(r.legajo))
                                  return (
                                    <div key={r.id} style={{ display:'inline-flex', alignItems:'center', gap:6, padding:'4px 8px', background:'rgba(123,111,216,0.1)', border:'0.5px solid rgba(123,111,216,0.3)', borderRadius:14 }}>
                                      <span style={{ fontSize:11 }}>{(ef?.nombre || r.legajo).split(',')[0]} — {r.cantidad} guardias</span>
                                      <button style={{ fontSize:10, color:'#F09595', background:'none', border:'none', cursor:'pointer', padding:0 }} onClick={() => quitarObjetivoFijo(r.id)}>✕</button>
                                    </div>
                                  )
                                })}
                              </div>
                              <div style={{ paddingTop:8, borderTop:'0.5px solid var(--border)', display:'flex', flexWrap:'wrap', gap:6, alignItems:'center' }}>
                                <select value={nuevoObjetivoLeg} onChange={e => setNuevoObjetivoLeg(e.target.value)}
                                  style={{ fontSize:11, padding:'4px 6px', borderRadius:6, background:'#ffffff', color:'#111111', border:'1px solid #aaa', flex:'1 1 200px' }}>
                                  <option value="" style={{ color:'#111', background:'#fff' }}>— Seleccioná efectivo —</option>
                                  {[...efectivos].sort((a,b) => a.nombre.localeCompare(b.nombre)).map(e => (
                                    <option key={e.legajo} value={e.legajo} style={{ color:'#111', background:'#fff' }}>{e.nombre} · Leg. {e.legajo}</option>
                                  ))}
                                </select>
                                <input type="number" min="1" placeholder="Cantidad" value={nuevoObjetivoCantidad} onChange={e => setNuevoObjetivoCantidad(e.target.value)}
                                  style={{ fontSize:11, padding:'4px 6px', borderRadius:6, background:'#ffffff', color:'#111111', border:'1px solid #aaa', flex:'0 0 90px' }} />
                                <button className="btn btn-sm" style={{ fontSize:11, background:'rgba(123,111,216,0.15)', color:'#AFA9EC', flex:'0 0 auto' }} onClick={agregarObjetivoFijo}>+ Configurar</button>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                  <p style={{ fontSize:12, color:'var(--text-muted)', marginBottom:12, lineHeight:1.5 }}>
                    Toma a cada efectivo que <b>cargó disponibilidad este mes</b> y que <b>tuvo guardias en {nombrePrev}</b> (o tiene una <b>cantidad fija</b> configurada), y le asigna esa cantidad usando su disponibilidad actual. Respeta descanso 12hs, reparto espaciado y tope 180hs. Nunca asigna fuera de la disponibilidad cargada.
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
                            {APP_LUGAR === 'MODULAR' && <th style={{ width:60, textAlign:'center' }}>Doble</th>}
                            <th>Efectivo</th>
                            <th style={{ width:110, textAlign:'center' }}>{nombrePrev}</th>
                            <th style={{ width:110, textAlign:'center' }}>Este mes</th>
                            <th style={{ width:90, textAlign:'center' }}>Estado</th>
                            <th style={{ width:90 }}></th>
                          </tr>
                        </thead>
                        <tbody>
                          {rapidaLista.map((i, idx) => {
                            const completo = i.yaAsignadas >= i.objetivo
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
                                {APP_LUGAR === 'MODULAR' && (
                                  <td style={{ textAlign:'center' }}>
                                    <input type="checkbox" checked={rapidaDoble.has(i.legajo)} disabled={rapidaProcesando}
                                      onChange={() => setRapidaDoble(prev => {
                                        const next = new Set(prev)
                                        next.has(i.legajo) ? next.delete(i.legajo) : next.add(i.legajo)
                                        return next
                                      })}
                                      title="Cargar doble turno (Mañana+Tarde o Tarde+Noche, 16hs) a este efectivo" />
                                  </td>
                                )}
                                <td>
                                  <div style={{ fontSize:12, fontWeight:500 }}>{i.nombre}</div>
                                  <div style={{ fontSize:10, color:'var(--text-muted)' }}>Leg. {i.legajo}</div>
                                </td>
                                <td style={{ textAlign:'center', fontWeight:500, color:COLOR_APP }}>
                                  {i.objetivo}
                                  {i.objetivoFijo && <div style={{ fontSize:9, color:'#AFA9EC', fontWeight:400 }}>🎯 fijo</div>}
                                </td>
                                <td style={{ textAlign:'center', fontWeight:500, color: completo ? '#1D9E75' : i.yaAsignadas > 0 ? '#EF9F27' : 'var(--text-muted)' }}>{i.yaAsignadas}</td>
                                <td style={{ textAlign:'center' }}>
                                  {completo
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
                    <h3>Sin guardias el mes anterior — {rapidaNuevos.length}</h3>
                    <span style={{ fontSize:11, color:'var(--text-muted)' }}>Cargaron disponibilidad este mes pero no tienen número de referencia — poné cantidad y turno y asigná directo, o configurá una "Cantidad fija" en Reglas especiales</span>
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
                              style={{ width:48, padding:'4px 6px', fontSize:11, border:'0.5px solid var(--border)', borderRadius:6, background:'var(--surface)', color:'var(--text)', outline:'none' }} />
                            <select value={campo.tipoTurno} title="Tipo de turno"
                              onChange={e => setCamposRapidaNuevos(prev => ({ ...prev, [n.legajo]: { ...campo, tipoTurno: e.target.value } }))}
                              style={{ flex:'1 1 0%', minWidth:0, padding:'4px 4px', fontSize:11, border:'0.5px solid var(--border)', borderRadius:6, background:'var(--surface)', color:'var(--text)', outline:'none' }}>
                              {TURNOS_INFO.map(ti => <option key={ti.key} value={ti.key}>{ti.label}</option>)}
                              <option value="mixto">Mixto</option>
                              <option value="doble">Todos</option>
                            </select>
                            <button className="btn btn-sm" disabled={!campo.cantidad || asignando}
                              style={{ fontSize:10, padding:'4px 8px', background:'rgba(200,168,75,0.12)', color:'#c8a84b', border:'0.5px solid rgba(200,168,75,0.4)', whiteSpace:'nowrap' }}
                              onClick={async () => {
                                await asignarGuardiasAuto(n.legajo, campo.cantidad, campo.tipoTurno)
                                // asignarGuardiasAuto ya refresca turnos/horas (cargarTodo), pero no
                                // esta lista propia — se refresca acá para que, si quedó cubierto,
                                // la tarjeta deje de aparecer (mismo patrón que el resto de "rápida").
                                await cargarRapida()
                                setCamposRapidaNuevos(prev => ({ ...prev, [n.legajo]: { cantidad: '', tipoTurno: campo.tipoTurno } }))
                              }}>
                              Asignar
                            </button>
                          </div>
                          {/* Detalle compacto de lo asignado a este efectivo en el mes: se actualiza solo al asignar */}
                          {(() => {
                            const mias = (turnos[n.legajo] || []).slice().sort((x, y) => parseInt(x.dia) - parseInt(y.dia))
                            if (mias.length === 0) return null
                            const porTurno = {}
                            mias.forEach(t => { (porTurno[t.turno] = porTurno[t.turno] || []).push(t) })
                            return (
                              <div style={{ marginTop:4, fontSize:10, color:'var(--text-hint)', lineHeight:1.4 }}>
                                <span style={{ color:'#1D9E75', fontWeight:600 }}>✓ {mias.length}</span>
                                {Object.keys(porTurno).map(k => {
                                  const ti = TURNOS_INFO.find(x => x.key === k)
                                  return (
                                    <span key={k} style={{ marginLeft:6 }}>
                                      <span style={{ color: ti?.color || 'inherit' }}>{ti?.label ? ti.label.split(' ')[0] : k}</span>
                                      {': '}
                                      {porTurno[k].map((t, i) => (
                                        <span key={i} title={t.sector}>{i > 0 ? ', ' : ''}{t.dia}</span>
                                      ))}
                                    </span>
                                  )
                                })}
                              </div>
                            )
                          })()}
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
                    // Buscar por lugar únicamente — un registro por lugar
                    const { data: existing } = await supabase.from('configuracion').select('id').eq('lugar', L).maybeSingle()
                    const mesV = ventanas.mesVentana || MES
                    const anioV = ventanas.anioVentana || ANIO
                    const mesAp = ventanas.mesApertura || MES
                    const anioAp = ventanas.anioApertura || ANIO
                    if (existing) {
                      await supabase.from('configuracion').update({ dia: parseInt(ventanas.dia)||null, hora_inicio: ventanas.horaInicio, hora_fin: ventanas.horaFin, mes: mesV, anio: anioV, mes_apertura: mesAp, anio_apertura: anioAp }).eq('id', existing.id)
                    } else {
                      await supabase.from('configuracion').insert([{ lugar: L, mes: mesV, anio: anioV, dia: parseInt(ventanas.dia)||null, hora_inicio: ventanas.horaInicio, hora_fin: ventanas.horaFin, mes_apertura: mesAp, anio_apertura: anioAp }])
                    }
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
              const r = await fetch(url, { headers: { Authorization: 'Bearer ' + (localStorage.getItem('polad_session') || '') } })
              if (r.status === 401) throw new Error('Tu sesión venció. Salí y volvé a entrar.')
              if (!r.ok) throw new Error('Error al generar')
              const blob = await r.blob()
              const a = document.createElement('a')
              a.href = URL.createObjectURL(blob)
              a.download = `POLAD_${lugarDetectado}_${NOMBRE_MES.replace(' ','_')}.xlsx`
              a.click()
            } catch(e) { alert(e.message && e.message.startsWith('Tu sesión') ? e.message : 'Error al generar la planilla') }
            setDescargando(null)
          }
          return (
            <div>
              <div style={{ marginBottom:20 }}>
                <h3 style={{ fontSize:15,fontWeight:500,marginBottom:6 }}>Planilla de guardia — {APP_LUGAR}</h3>
                <p style={{ fontSize:12,color:'var(--text-muted)' }}>Planilla completa de {NOMBRE_MES}, organizada por día con todos los turnos</p>
              </div>
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
    </div>
  )
}
