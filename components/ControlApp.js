import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../lib/supabase'

export const dynamic = 'force-dynamic'


const MES = new Date().getMonth() + 1
const ANIO = new Date().getFullYear()
const DIAS_MES = new Date(ANIO, MES, 0).getDate()
const NOMBRE_MES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'][MES-1] + ' ' + ANIO
const NOMBRE_MES_SOLO = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'][MES-1]
const LUGARES = ['HIGA', 'UPA', 'MODULAR']

export default function ControlApp() {
  const router = useRouter()
  const [user, setUser] = useState(null)
  const [lugar, setLugar] = useState('HIGA')
  const [efectivos, setEfectivos] = useState([])
  const [turnos, setTurnos] = useState([])
  const [asistencia, setAsistencia] = useState({})
  const [firmas, setFirmas] = useState({})
  const [loading, setLoading] = useState(true)
  const [mounted, setMounted] = useState(false)
  const [planillaEf, setPlanillaEf] = useState(null)
  const [subiendoFirma, setSubiendoFirma] = useState(null)
  const [msg, setMsg] = useState(null)
  const firmaRef = useRef()

  useEffect(() => {
    setMounted(true)
    const u = localStorage.getItem('polad_user')
    if (!u) { router.push('/'); return }
    const parsed = JSON.parse(u)
    if (!parsed.es_admin) { router.push('/efectivo'); return }
    setUser(parsed)
    cargarDatos('HIGA')
  }, [])

  async function cargarDatos(lg) {
    setLoading(true)
    const [{ data: efs }, { data: turns }, { data: asist }, { data: firmasData }] = await Promise.all([
      supabase.from('efectivos').select('*').eq('es_admin', false).ilike('lugar', `%${lg}%`).order('nombre'),
      supabase.from('turnos').select('*').eq('mes', MES).eq('anio', ANIO),
      supabase.from('asistencia').select('*').eq('mes', MES).eq('anio', ANIO).eq('lugar', lg),
      supabase.from('firmas').select('*').eq('mes', MES).eq('anio', ANIO)
    ])
    setEfectivos(efs || [])
    setTurnos(turns || [])
    const asistMap = {}
    ;(asist || []).forEach(a => {
      const key = `${a.legajo}-${a.dia}-${a.turno}`
      asistMap[key] = a
    })
    setAsistencia(asistMap)
    const firmasMap = {}
    ;(firmasData || []).forEach(f => { firmasMap[f.legajo] = f })
    setFirmas(firmasMap)
    setLoading(false)
  }

  async function confirmarPresencia(legajo, dia, turno, sector) {
    const key = `${legajo}-${dia}-${turno}`
    const existe = asistencia[key]
    if (existe) {
      await supabase.from('asistencia').delete().eq('id', existe.id)
      const nuevo = { ...asistencia }
      delete nuevo[key]
      setAsistencia(nuevo)
    } else {
      const { data } = await supabase.from('asistencia').insert([{
        legajo, mes: MES, anio: ANIO, dia, turno, sector, lugar,
        presente: true, confirmado_at: new Date().toISOString()
      }]).select().single()
      if (data) setAsistencia(prev => ({ ...prev, [key]: data }))
    }
  }

  async function subirFirma(legajo, file) {
    setSubiendoFirma(legajo)
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
      setSubiendoFirma(null)
      setMsg('Firma guardada correctamente.')
      setTimeout(() => setMsg(null), 2500)
    }
    reader.readAsDataURL(file)
  }

  function imprimirPlanilla(ef) {
    const turnosEf = turnos.filter(t => t.legajo === ef.legajo).sort((a, b) => a.dia - b.dia)
    const firma = firmas[ef.legajo]?.firma_url || ''
    const win = window.open('', '_blank')
    
    const filas = Array.from({ length: DIAS_MES }, (_, i) => i + 1).map(dia => {
      const tDia = turnosEf.find(t => t.dia === dia && t.turno === 'd')
      const tNoche = turnosEf.find(t => t.dia === dia && t.turno === 'n')
      const pDia = tDia ? asistencia[`${ef.legajo}-${dia}-d`] : null
      const pNoche = tNoche ? asistencia[`${ef.legajo}-${dia}-n`] : null
      
      let horario = ''
      let horas = ''
      if (tDia && pDia) { horario = '08:00 a 20:00'; horas = '12' }
      else if (tNoche && pNoche) { horario = '20:00 a 08:00'; horas = '12' }
      else if (tDia || tNoche) { horario = tDia ? '08:00 a 20:00' : '20:00 a 08:00'; horas = '' }
      
      return { dia, horario, horas, confirmado: !!(pDia || pNoche) }
    })

    const totalHoras = filas.reduce((sum, f) => sum + (parseInt(f.horas) || 0), 0)
    const total90 = Math.round(totalHoras * 0.9)

    win.document.write(`<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Planilla ${ef.nombre}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: Arial, sans-serif; font-size: 10px; padding: 15mm; color: #000; }
  h2 { font-size: 13px; text-align: center; margin-bottom: 4px; }
  h3 { font-size: 11px; text-align: center; margin-bottom: 10px; }
  .header-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 8px; }
  .field { border-bottom: 1px solid #000; padding: 2px 0; margin-bottom: 4px; }
  .field label { font-size: 8px; color: #555; display: block; }
  .field span { font-size: 10px; font-weight: bold; }
  .field-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin-bottom: 6px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
  th { background: #333; color: #fff; padding: 4px; font-size: 9px; text-align: center; border: 1px solid #000; }
  td { border: 1px solid #000; padding: 3px 5px; font-size: 9px; text-align: center; height: 18px; }
  td.dia { font-weight: bold; background: #f5f5f5; }
  td.confirmado { background: #e8f5e9; }
  .totales { text-align: right; margin-bottom: 10px; }
  .totales span { font-weight: bold; font-size: 11px; }
  .declaracion { font-size: 9px; margin-bottom: 16px; line-height: 1.5; }
  .firmas { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-top: 10px; }
  .firma-box { text-align: center; }
  .firma-img { max-width: 120px; max-height: 50px; margin-bottom: 4px; }
  .firma-line { border-top: 1px solid #000; padding-top: 3px; font-size: 9px; }
  @media print { body { padding: 10mm; } }
</style>
</head>
<body>
  <h2>POLICIA ADICIONAL — MINISTERIO DE SEGURIDAD</h2>
  <h3>PLANILLA DE CUMPLIMIENTO SERVICIO DE POLICÍA ADICIONAL</h3>
  
  <div class="header-grid">
    <div>
      <div class="field"><label>Servicio POLAD</label><span>POLAD</span></div>
      <div class="field"><label>Destino / Domicilio del servicio</label><span>Ministerio de Salud - Pcia de Bs As</span></div>
    </div>
    <div>
      <div class="field"><label>Sucursal</label><span>${lugar}</span></div>
      <div class="field"><label>Localidad</label><span>Mar del Plata</span></div>
    </div>
  </div>

  <div class="field-row">
    <div class="field"><label>Apellido y Nombre</label><span>${ef.nombre}</span></div>
    <div class="field"><label>Categoría</label><span>1°</span></div>
    <div class="field"><label>Mes / Año</label><span>${NOMBRE_MES_SOLO.toUpperCase()} ${ANIO}</span></div>
    <div class="field"><label>Jerarquía</label><span>${ef.jerarquia || ''}</span></div>
  </div>
  <div class="field-row">
    <div class="field"><label>Legajo</label><span>${ef.legajo}</span></div>
    <div class="field"><label>N° Documento</label><span>${ef.dni || ''}</span></div>
    <div class="field"></div>
    <div class="field"></div>
  </div>

  <table>
    <thead>
      <tr>
        <th>DÍA</th><th>HORARIO</th><th>HORAS</th>
        <th>DÍA</th><th>HORARIO</th><th>HORAS</th>
      </tr>
    </thead>
    <tbody>
      ${Array.from({ length: 16 }, (_, i) => {
        const f1 = filas[i] || {}
        const f2 = filas[i + 16] || {}
        return `<tr>
          <td class="dia">${f1.dia || ''}</td>
          <td class="${f1.confirmado ? 'confirmado' : ''}">${f1.horario || ''}</td>
          <td class="${f1.confirmado ? 'confirmado' : ''}">${f1.horas || ''}</td>
          <td class="dia">${f2.dia || ''}</td>
          <td class="${f2.confirmado ? 'confirmado' : ''}">${f2.horario || ''}</td>
          <td class="${f2.confirmado ? 'confirmado' : ''}">${f2.horas || ''}</td>
        </tr>`
      }).join('')}
      <tr>
        <td colspan="3" style="text-align:right;font-weight:bold;font-size:9px;">TOTAL DE HORAS CUMPLIDAS EN EL MES</td>
        <td colspan="3" style="font-weight:bold;font-size:11px;">${totalHoras}</td>
      </tr>
      <tr>
        <td colspan="3" style="text-align:right;font-weight:bold;font-size:9px;">TOTAL 90%</td>
        <td colspan="3" style="font-weight:bold;font-size:11px;">${total90}</td>
      </tr>
    </tbody>
  </table>

  <div class="declaracion">
    Declaro de conformidad, haber prestado <strong>${totalHoras}</strong> horas de servicio de Policía Adicional, en el destino que figura en la presente planilla.
  </div>

  <div class="firmas">
    <div class="firma-box">
      ${firma ? `<img src="${firma}" class="firma-img" />` : '<div style="height:50px"></div>'}
      <div class="firma-line">FIRMA EFECTIVO — ${ef.nombre}</div>
    </div>
    <div class="firma-box">
      <div style="height:50px"></div>
      <div class="firma-line">FIRMA ENCARGADO — Crio. Paulo Corbela</div>
    </div>
  </div>
</body>
</html>`)
    win.document.close()
    setTimeout(() => win.print(), 500)
  }

  if (!mounted || loading) return <div className="loading">Cargando...</div>

  return (
    <div>
      <div className="topbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 15, fontWeight: 500 }}>Control de Asistencia</span>
          <span style={{ background: 'rgba(200,168,75,0.15)', color: '#c8a84b', fontSize: 11, padding: '2px 8px', borderRadius: 3, fontWeight: 500 }}>{NOMBRE_MES}</span>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {LUGARES.map(lg => (
            <button key={lg} className="btn btn-sm"
              style={{ fontWeight: lugar === lg ? 600 : 400, background: lugar === lg ? 'rgba(200,168,75,0.15)' : 'transparent', color: lugar === lg ? '#c8a84b' : '#8b90a0', border: lugar === lg ? '0.5px solid rgba(200,168,75,0.6)' : '0.5px solid rgba(255,255,255,0.1)' }}
              onClick={() => { setLugar(lg); cargarDatos(lg) }}>{lg}</button>
          ))}
          <button className="btn btn-sm" onClick={() => router.push('/admin')} style={{ color: '#8b90a0' }}>← Admin</button>
        </div>
      </div>

      <div style={{ padding: 18 }}>
        {msg && <div className="alert alert-ok" style={{ marginBottom: 12 }}>{msg}</div>}

        {planillaEf && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 50, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 20, overflowY: 'auto' }}>
            <div style={{ background: '#13151f', borderRadius: 12, border: '0.5px solid rgba(200,168,75,0.2)', width: '100%', maxWidth: 700, overflow: 'hidden' }}>
              <div style={{ padding: '14px 16px', borderBottom: '0.5px solid rgba(200,168,75,0.15)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(200,168,75,0.06)' }}>
                <h3 style={{ fontSize: 14, fontWeight: 500, color: '#c8a84b' }}>Planilla — {planillaEf.nombre}</h3>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-sm" style={{ background: 'rgba(200,168,75,0.15)', color: '#c8a84b', border: '0.5px solid rgba(200,168,75,0.4)' }} onClick={() => imprimirPlanilla(planillaEf)}>🖨 Imprimir</button>
                  <button className="btn btn-sm" onClick={() => setPlanillaEf(null)}>Cerrar</button>
                </div>
              </div>
              <div style={{ padding: 16 }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 8, marginBottom: 14, fontSize: 12 }}>
                  {[['Legajo', planillaEf.legajo], ['DNI', planillaEf.dni], ['Jerarquía', planillaEf.jerarquia], ['Lugar', lugar]].map(([k, v]) => (
                    <div key={k} style={{ background: 'var(--surface2)', borderRadius: 6, padding: '8px 10px' }}>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 2 }}>{k}</div>
                      <div style={{ fontWeight: 500, color: 'var(--text)' }}>{v || '—'}</div>
                    </div>
                  ))}
                </div>

                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>Firma del efectivo</div>
                  {firmas[planillaEf.legajo]?.firma_url
                    ? <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <img src={firmas[planillaEf.legajo].firma_url} style={{ maxHeight: 60, maxWidth: 180, background: '#fff', borderRadius: 6, padding: 4 }} alt="firma" />
                        <button className="btn btn-sm" onClick={() => firmaRef.current.click()} style={{ fontSize: 11 }}>Cambiar firma</button>
                      </div>
                    : <button className="btn btn-sm" style={{ background: 'rgba(200,168,75,0.1)', color: '#c8a84b', border: '0.5px solid rgba(200,168,75,0.3)' }} onClick={() => firmaRef.current.click()}>
                        📎 Subir firma escaneada
                      </button>
                  }
                  <input ref={firmaRef} type="file" accept="image/*" style={{ display: 'none' }}
                    onChange={e => { if (e.target.files[0]) subirFirma(planillaEf.legajo, e.target.files[0]) }} />
                  {subiendoFirma === planillaEf.legajo && <span style={{ fontSize: 11, color: '#c8a84b', marginLeft: 8 }}>Subiendo...</span>}
                </div>

                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                  <thead>
                    <tr>
                      <th style={{ padding: '6px 8px', background: 'var(--surface2)', borderBottom: '0.5px solid var(--border)', textAlign: 'center', width: 40 }}>Día</th>
                      <th style={{ padding: '6px 8px', background: 'var(--surface2)', borderBottom: '0.5px solid var(--border)' }}>Horario</th>
                      <th style={{ padding: '6px 8px', background: 'var(--surface2)', borderBottom: '0.5px solid var(--border)', textAlign: 'center' }}>Horas</th>
                      <th style={{ padding: '6px 8px', background: 'var(--surface2)', borderBottom: '0.5px solid var(--border)', textAlign: 'center' }}>Presente</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Array.from({ length: DIAS_MES }, (_, i) => i + 1).map(dia => {
                      const turnosEfDia = turnos.filter(t => t.legajo === planillaEf.legajo && t.dia === dia)
                      if (!turnosEfDia.length) return (
                        <tr key={dia} style={{ borderBottom: '0.5px solid var(--border)' }}>
                          <td style={{ textAlign: 'center', padding: '5px', fontWeight: 500, color: 'var(--text-muted)' }}>{dia}</td>
                          <td colSpan={3} style={{ padding: '5px 8px', color: 'var(--text-hint)', fontSize: 10 }}>Sin guardia</td>
                        </tr>
                      )
                      return turnosEfDia.map(t => {
                        const key = `${planillaEf.legajo}-${dia}-${t.turno}`
                        const presente = !!asistencia[key]
                        return (
                          <tr key={`${dia}-${t.turno}`} style={{ borderBottom: '0.5px solid var(--border)', background: presente ? 'rgba(29,158,117,0.08)' : '' }}>
                            <td style={{ textAlign: 'center', padding: '5px', fontWeight: 500 }}>{dia}</td>
                            <td style={{ padding: '5px 8px', color: t.turno === 'd' ? '#EF9F27' : '#85B7EB' }}>
                              {t.turno === 'd' ? '08:00 a 20:00' : '20:00 a 08:00'} — {t.sector}
                            </td>
                            <td style={{ textAlign: 'center', padding: '5px', fontWeight: 500, color: presente ? '#1D9E75' : 'var(--text-hint)' }}>
                              {presente ? '12' : '—'}
                            </td>
                            <td style={{ textAlign: 'center', padding: '5px' }}>
                              <button onClick={() => confirmarPresencia(planillaEf.legajo, dia, t.turno, t.sector)}
                                style={{ padding: '3px 10px', borderRadius: 5, border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 500, background: presente ? '#1D9E75' : 'rgba(255,255,255,0.08)', color: presente ? '#fff' : '#8b90a0' }}>
                                {presente ? '✓ Presente' : 'Confirmar'}
                              </button>
                            </td>
                          </tr>
                        )
                      })
                    })}
                  </tbody>
                </table>

                <div style={{ marginTop: 10, display: 'flex', justifyContent: 'space-between', padding: '10px 8px', background: 'var(--surface2)', borderRadius: 8 }}>
                  {(() => {
                    const total = Object.keys(asistencia).filter(k => k.startsWith(planillaEf.legajo + '-')).length * 12
                    return <>
                      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Total horas confirmadas:</span>
                      <span style={{ fontSize: 14, fontWeight: 500, color: '#1D9E75' }}>{total} hs — 90%: {Math.round(total * 0.9)} hs</span>
                    </>
                  })()}
                </div>
              </div>
            </div>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
          {efectivos.map(ef => {
            const turnosEf = turnos.filter(t => t.legajo === ef.legajo)
            const confirmados = turnosEf.filter(t => asistencia[`${ef.legajo}-${t.dia}-${t.turno}`]).length
            const total = turnosEf.length
            const pct = total ? Math.round(confirmados / total * 100) : 0
            const tieneFirma = !!firmas[ef.legajo]?.firma_url
            const color = pct >= 100 ? '#1D9E75' : pct >= 50 ? '#EF9F27' : '#8b90a0'

            return (
              <div key={ef.legajo} style={{ background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 10, padding: '12px 14px', cursor: 'pointer' }}
                onClick={() => setPlanillaEf(ef)}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text)' }}>{ef.nombre}</div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>Leg. {ef.legajo} · {ef.jerarquia}</div>
                  </div>
                  <span style={{ fontSize: 14, fontWeight: 600, color }}>{confirmados}/{total}</span>
                </div>
                <div className="hbar" style={{ width: '100%', marginBottom: 8 }}>
                  <div className="hfill" style={{ width: `${pct}%`, background: color }}></div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 10, color: tieneFirma ? '#1D9E75' : '#555b6e' }}>
                    {tieneFirma ? '✓ Firma cargada' : 'Sin firma'}
                  </span>
                  <span style={{ fontSize: 10, color: 'var(--text-hint)' }}>{confirmados * 12} hs confirmadas</span>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
