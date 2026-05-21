import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../lib/supabase'

const APP_LUGAR = process.env.NEXT_PUBLIC_LUGAR || 'HIGA'
const SECTORES_POR_LUGAR = {
  'HIGA': ['Salud Mental','Giratoria','Llaves','Guardia','Estacionamiento'],
  'UPA': ['UPA'],
  'MODULAR': ['Modular']
}
const SECTORES_APP = SECTORES_POR_LUGAR[APP_LUGAR] || SECTORES_POR_LUGAR['HIGA']
const COLOR_APP = APP_LUGAR === 'HIGA' ? '#AFA9EC' : APP_LUGAR === 'UPA' ? '#D85A30' : '#20A0B0'

const MES_ACTUAL = new Date().getMonth() + 1
const ANIO_ACTUAL = new Date().getFullYear()
const MESES_NOMBRES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']

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
  const diasMes = new Date(anio, mes, 0).getDate()
  const nombreMes = MESES_NOMBRES[mes - 1] + ' ' + anio
  const primerDia = (new Date(anio, mes - 1, 1).getDay() + 6) % 7

  useEffect(() => {
    const u = localStorage.getItem('polad_user')
    if (!u) { router.push('/'); return }
    const parsed = JSON.parse(u)
    if (parsed.es_admin) { router.push('/admin'); return }
    setUsuario(parsed)
    cargarDatos(parsed.legajo, mes, anio)
  }, [])

  async function cargarDatos(legajo, m, a) {
    setLoading(true)
    const ventanasStr = localStorage.getItem(`polad_ventanas_${APP_LUGAR}`)
    if (ventanasStr) {
      try { setVentana(JSON.parse(ventanasStr)) } catch(e) {}
    }
    const [{ data: disp }, { data: turns }] = await Promise.all([
      supabase.from('disponibilidad').select('dia, turno').eq('legajo', legajo).eq('mes', m).eq('anio', a).eq('lugar', APP_LUGAR),
      supabase.from('turnos').select('dia, turno, sector').eq('legajo', legajo).eq('mes', m).eq('anio', a).in('sector', SECTORES_APP)
    ])
    const dispMap = {}
    ;(disp || []).forEach(d => { dispMap[d.dia] = d.turno })
    setDisponibilidad(dispMap)
    setTurnos(turns || [])
    setLoading(false)
  }

  function toggleDia(dia, tipo) {
    setDisponibilidad(prev => {
      const actual = prev[dia] || ''
      let nuevo
      if (tipo === 'd') {
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

  async function guardar() {
    if (!usuario) return
    const diasSeleccionados = Object.keys(disponibilidad).length
    if (diasSeleccionados === 0) {
      if (!confirm('No seleccionaste ningún día. ¿Confirmar disponibilidad vacía?')) return
    }
    setGuardando(true)
    // Solo borra disponibilidad de este lugar
    await supabase.from('disponibilidad').delete().eq('legajo', usuario.legajo).eq('mes', mes).eq('anio', anio).eq('lugar', APP_LUGAR)
    const inserts = Object.entries(disponibilidad).map(([dia, turno]) => ({
      legajo: usuario.legajo, mes, anio, dia: parseInt(dia), turno, lugar: APP_LUGAR
    }))
    if (inserts.length > 0) await supabase.from('disponibilidad').insert(inserts)
    setMsg('✓ Disponibilidad guardada para ' + APP_LUGAR)
    setTimeout(() => setMsg(null), 3000)
    setGuardando(false)
  }

  function esVentanaAbierta() {
    if (!ventana || !ventana.dia) return true // sin configurar = siempre abierta
    const ahora = new Date()
    const diaV = parseInt(ventana.dia)
    const [hIni, mIni] = (ventana.horaInicio || '00:00').split(':').map(Number)
    const [hFin, mFin] = (ventana.horaFin || '23:59').split(':').map(Number)
    const inicio = new Date(ahora.getFullYear(), ahora.getMonth(), diaV, hIni, mIni)
    const fin = new Date(ahora.getFullYear(), ahora.getMonth(), diaV, hFin, mFin)
    return ahora >= inicio && ahora <= fin
  }

  const abierta = esVentanaAbierta()

  if (loading) return <div className="loading">Cargando...</div>

  return (
    <div>
      <div className="topbar">
        <div style={{ display:'flex',alignItems:'center',gap:10 }}>
          <span style={{ fontSize:14,fontWeight:500 }}>{usuario?.nombre?.split(',')[0]}</span>
          <span style={{ fontSize:11,color:'var(--text-muted)' }}>Leg. {usuario?.legajo}</span>
          <span style={{ background:`${COLOR_APP}22`,color:COLOR_APP,fontSize:11,padding:'2px 8px',borderRadius:3,fontWeight:600,border:`0.5px solid ${COLOR_APP}66` }}>{APP_LUGAR}</span>
        </div>
        <div style={{ display:'flex',gap:6,alignItems:'center' }}>
          <div style={{ display:'flex',alignItems:'center',gap:4,background:'rgba(255,255,255,0.05)',borderRadius:6,padding:'2px 6px',border:'0.5px solid rgba(255,255,255,0.1)' }}>
            <select value={mes} onChange={e => { const m=parseInt(e.target.value); setMes(m); cargarDatos(usuario.legajo,m,anio) }} style={{ background:'transparent',border:'none',color:'#c8a84b',fontSize:12,fontWeight:500,outline:'none',cursor:'pointer' }}>
              {MESES_NOMBRES.map((m,i) => <option key={i+1} value={i+1} style={{ background:'#1a1d27' }}>{m}</option>)}
            </select>
            <select value={anio} onChange={e => { const a=parseInt(e.target.value); setAnio(a); cargarDatos(usuario.legajo,mes,a) }} style={{ background:'transparent',border:'none',color:'#c8a84b',fontSize:12,fontWeight:500,outline:'none',cursor:'pointer' }}>
              {[ANIO_ACTUAL, ANIO_ACTUAL+1].map(a => <option key={a} value={a} style={{ background:'#1a1d27' }}>{a}</option>)}
            </select>
          </div>
          <button className="btn btn-sm" style={{ color:'#8b90a0' }} onClick={() => { localStorage.removeItem('polad_user'); router.push('/') }}>Salir</button>
        </div>
      </div>

      <div className="content">
        {msg && <div className="alert alert-ok" style={{ marginBottom:14 }}>{msg}</div>}

        {!abierta && ventana?.dia && (
          <div className="alert alert-warn" style={{ marginBottom:14 }}>
            La inscripción para {APP_LUGAR} está habilitada el día {ventana.dia} de {MESES_NOMBRES[mes-1]} de {ventana.horaInicio} a {ventana.horaFin}.
          </div>
        )}

        <div style={{ marginBottom:16 }}>
          <div style={{ fontSize:13,fontWeight:500,marginBottom:4 }}>Disponibilidad — {APP_LUGAR} · {nombreMes}</div>
          <div style={{ fontSize:11,color:'var(--text-muted)',marginBottom:12 }}>
            Tocá los días en que podés hacer guardia en {APP_LUGAR}. D = día (08-20) · N = noche (20-08) · A = ambos
          </div>
          <div style={{ display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:2,marginBottom:4 }}>
            {['Lu','Ma','Mi','Ju','Vi','Sá','Do'].map(d => <div key={d} style={{ textAlign:'center',fontSize:10,color:'var(--text-hint)',padding:'4px 0' }}>{d}</div>)}
          </div>
          <div style={{ display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:3 }}>
            {Array.from({ length: primerDia }).map((_,i) => <div key={`e-${i}`}></div>)}
            {Array.from({ length: diasMes }, (_, i) => i + 1).map(dia => {
              const v = disponibilidad[dia] || ''
              const turno = turnos.find(t => t.dia === dia)
              const bg = v === 'dn' ? '#0d2b1a' : v === 'd' ? '#3a2a0a' : v === 'n' ? '#0d2040' : 'var(--surface2)'
              const bc = v === 'dn' ? '#1D9E75' : v === 'd' ? '#BA7517' : v === 'n' ? '#378ADD' : 'var(--border)'
              return (
                <div key={dia} style={{ border:`0.5px solid ${bc}`,borderRadius:6,padding:'4px 3px',minHeight:48,background:bg,cursor:abierta?'pointer':'not-allowed',opacity:abierta?1:0.6 }}>
                  <div style={{ fontSize:10,fontWeight:500,color:'var(--text-muted)',marginBottom:1 }}>{dia}</div>
                  <div style={{ display:'flex',gap:2,marginBottom:2 }}>
                    <button disabled={!abierta} onClick={() => abierta && toggleDia(dia, 'd')} style={{ flex:1,padding:'2px 0',borderRadius:3,border:'none',cursor:abierta?'pointer':'default',fontSize:9,fontWeight:500,background:(v==='d'||v==='dn')?'#BA7517':'rgba(255,255,255,0.06)',color:(v==='d'||v==='dn')?'#FFC94B':'#666' }}>D</button>
                    <button disabled={!abierta} onClick={() => abierta && toggleDia(dia, 'n')} style={{ flex:1,padding:'2px 0',borderRadius:3,border:'none',cursor:abierta?'pointer':'default',fontSize:9,fontWeight:500,background:(v==='n'||v==='dn')?'#1A4A8A':'rgba(255,255,255,0.06)',color:(v==='n'||v==='dn')?'#85B7EB':'#666' }}>N</button>
                  </div>
                  {turno && <div style={{ fontSize:7,color:turno.turno==='d'?'#EF9F27':'#85B7EB',textAlign:'center',marginTop:1 }}>✓ {turno.turno==='d'?'Día':'Noche'}</div>}
                </div>
              )
            })}
          </div>
        </div>

        <div style={{ display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:20 }}>
          <div style={{ fontSize:12,color:'var(--text-muted)' }}>
            {Object.keys(disponibilidad).length} días seleccionados
          </div>
          <button className="btn btn-success" disabled={guardando || !abierta} onClick={guardar}>
            {guardando ? 'Guardando...' : `Guardar disponibilidad — ${APP_LUGAR}`}
          </button>
        </div>

        {turnos.length > 0 && (
          <div className="panel">
            <div className="panel-header" style={{ background:`${COLOR_APP}22` }}><h3 style={{ color:COLOR_APP }}>Mis guardias asignadas — {APP_LUGAR} · {nombreMes}</h3></div>
            <div style={{ padding:12 }}>
              {turnos.sort((a,b) => a.dia - b.dia).map(t => (
                <div key={t.id || `${t.dia}-${t.turno}`} style={{ display:'flex',justifyContent:'space-between',alignItems:'center',padding:'8px 10px',background:'var(--surface2)',borderRadius:7,marginBottom:6,border:'0.5px solid var(--border)' }}>
                  <div>
                    <span style={{ fontSize:13,fontWeight:500 }}>Día {t.dia}</span>
                    <span style={{ fontSize:11,color:'var(--text-muted)',marginLeft:8 }}>{t.sector}</span>
                  </div>
                  <span style={{ fontSize:11,fontWeight:500,padding:'2px 10px',borderRadius:4,background:t.turno==='d'?'#3a2a0a':'#0d2040',color:t.turno==='d'?'#EF9F27':'#85B7EB' }}>
                    {t.turno === 'd' ? '08:00 a 20:00' : '20:00 a 08:00'}
                  </span>
                </div>
              ))}
              <div style={{ marginTop:8,fontSize:12,color:COLOR_APP,fontWeight:500 }}>Total: {turnos.length * 12} hs en {APP_LUGAR}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
