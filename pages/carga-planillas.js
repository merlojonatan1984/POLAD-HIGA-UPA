import { useState, useEffect } from 'react'
import { createClient } from '@supabase/supabase-js'
import Head from 'next/head'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

export default function CargaPlanillas() {
  const [autenticado, setAutenticado] = useState(false)
  const [pass, setPass] = useState('')
  const [archivos, setArchivos] = useState([])
  const [procesando, setProcesando] = useState(false)
  const [progreso, setProgreso] = useState([])
  const [terminado, setTerminado] = useState(false)

  function login(e) {
    e.preventDefault()
    if (pass === 'admin2025') setAutenticado(true)
    else alert('Clave incorrecta')
  }

  function seleccionarArchivos(e) {
    const files = Array.from(e.target.files)
    setArchivos(files)
    setProgreso([])
    setTerminado(false)
  }

  async function procesarTodo() {
    if (archivos.length === 0) return
    setProcesando(true)
    setTerminado(false)
    setProgreso([])

    const JSZip = (await import('jszip')).default
    const resultados = []

    for (const file of archivos) {
      const nombre = file.name.replace(/\.(ods|xlsx)$/i, '')
      const partes = nombre.split('_').filter(Boolean)
      const p1 = partes[0] || ''
      const p2 = partes[1] || ''
      const ilike = p2 ? '%' + p1 + '%' + p2 + '%' : '%' + p1 + '%'

      // Buscar efectivo en la DB
      const { data: efectivos } = await supabase
        .from('efectivos')
        .select('legajo, nombre, lugar')
        .ilike('nombre', ilike)
        .limit(1)

      if (!efectivos || efectivos.length === 0) {
        resultados.push({ nombre, estado: 'no_encontrado', msg: 'No encontrado en la base de datos' })
        setProgreso([...resultados])
        continue
      }

      const ef = efectivos[0]

      try {
        // Leer archivo como ArrayBuffer
        const buffer = await file.arrayBuffer()

        let finalBuffer = buffer
        const ext = file.name.split('.').pop().toLowerCase()

        // Si es ODS, fijar el print area en el XML interno
        if (ext === 'ods') {
          const zip = await JSZip.loadAsync(buffer)
          const contentFile = zip.file('content.xml')
          if (contentFile) {
            let contentXml = await contentFile.async('string')
            // Agregar print range si no existe
            if (!contentXml.includes('table:print-ranges')) {
              contentXml = contentXml.replace(
                /(<table:table\b)([^>]*)(>)/,
                function(match, p1, p2, p3) {
                  const sheetMatch = p2.match(/table:name="([^"]+)"/)
                  const sheetName = sheetMatch ? sheetMatch[1] : 'PLANILLA INDIVIDUAL'
                  return p1 + p2 + ' table:print-ranges="' + sheetName + '.$A$1:$G$39"' + p3
                }
              )
              zip.file('content.xml', contentXml)
            }
            finalBuffer = await zip.generateAsync({ type: 'arraybuffer' })
          }
        }

        // Subir a Supabase Storage
        const storageName = ef.legajo + '.' + ext
        const { error: uploadError } = await supabase.storage
          .from('planillas')
          .upload(storageName, finalBuffer, {
            contentType: ext === 'ods'
              ? 'application/vnd.oasis.opendocument.spreadsheet'
              : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            upsert: true
          })

        if (uploadError) {
          resultados.push({ nombre, estado: 'error', msg: uploadError.message })
          setProgreso([...resultados])
          continue
        }

        // Obtener URL pública
        const { data: urlData } = supabase.storage.from('planillas').getPublicUrl(storageName)
        const publicUrl = urlData.publicUrl

        // Actualizar efectivo
        await supabase.from('efectivos').update({ planilla_url: publicUrl }).eq('legajo', ef.legajo)

        resultados.push({ nombre, estado: 'ok', msg: ef.nombre + ' — ' + ef.lugar })
        setProgreso([...resultados])

      } catch (err) {
        resultados.push({ nombre, estado: 'error', msg: err.message })
        setProgreso([...resultados])
      }
    }

    setProcesando(false)
    setTerminado(true)
  }

  const ok = progreso.filter(r => r.estado === 'ok').length
  const noEncontrados = progreso.filter(r => r.estado === 'no_encontrado')
  const errores = progreso.filter(r => r.estado === 'error')

  if (!autenticado) return (
    <div style={{ minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',background:'#0f1117' }}>
      <form onSubmit={login} style={{ background:'#1a1d27',padding:32,borderRadius:12,width:320,border:'0.5px solid #2a2d3a' }}>
        <h2 style={{ color:'white',marginBottom:20,textAlign:'center' }}>POLAD — Carga de Planillas</h2>
        <input type="password" placeholder="Clave admin" value={pass} onChange={e => setPass(e.target.value)}
          style={{ width:'100%',padding:'10px 12px',borderRadius:8,border:'0.5px solid #2a2d3a',background:'#0f1117',color:'white',fontSize:14,boxSizing:'border-box',marginBottom:12 }} />
        <button type="submit" style={{ width:'100%',padding:'10px',borderRadius:8,background:'#1D9E75',color:'white',border:'none',fontSize:14,cursor:'pointer' }}>Entrar</button>
      </form>
    </div>
  )

  return (
    <>
      <Head><title>Carga de Planillas — POLAD</title></Head>
      <div style={{ minHeight:'100vh',background:'#0f1117',color:'white',padding:32,fontFamily:'system-ui,sans-serif' }}>
        <div style={{ maxWidth:700,margin:'0 auto' }}>
          <h1 style={{ fontSize:20,fontWeight:600,marginBottom:4 }}>📂 Carga masiva de planillas</h1>
          <p style={{ color:'#888',fontSize:13,marginBottom:24 }}>Seleccioná todos los archivos ODS o XLSX de una vez. El sistema los sube automáticamente a cada efectivo.</p>

          <div style={{ background:'#1a1d27',borderRadius:12,padding:24,border:'0.5px solid #2a2d3a',marginBottom:20 }}>
            <label style={{ display:'block',padding:32,border:'1.5px dashed #2a2d3a',borderRadius:8,textAlign:'center',cursor:'pointer',color:'#888' }}>
              <div style={{ fontSize:32,marginBottom:8 }}>📁</div>
              <div style={{ fontSize:14,marginBottom:4 }}>Hacé clic para seleccionar archivos</div>
              <div style={{ fontSize:12,color:'#555' }}>ODS o XLSX — podés seleccionar todos a la vez</div>
              <input type="file" multiple accept=".ods,.xlsx" onChange={seleccionarArchivos} style={{ display:'none' }} />
            </label>

            {archivos.length > 0 && (
              <div style={{ marginTop:16 }}>
                <div style={{ fontSize:13,color:'#1D9E75',marginBottom:12 }}>✅ {archivos.length} archivos seleccionados</div>
                {!procesando && !terminado && (
                  <button onClick={procesarTodo}
                    style={{ width:'100%',padding:'12px',borderRadius:8,background:'#1D9E75',color:'white',border:'none',fontSize:14,cursor:'pointer',fontWeight:500 }}>
                    ⚡ Subir todos ({archivos.length} archivos)
                  </button>
                )}
              </div>
            )}
          </div>

          {(procesando || progreso.length > 0) && (
            <div style={{ background:'#1a1d27',borderRadius:12,padding:24,border:'0.5px solid #2a2d3a' }}>
              <div style={{ display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16 }}>
                <h3 style={{ fontSize:14,fontWeight:500,margin:0 }}>
                  {procesando ? 'Procesando... ' + progreso.length + '/' + archivos.length : 'Resultado final'}
                </h3>
                {terminado && (
                  <span style={{ fontSize:12,color:'#1D9E75' }}>✅ {ok} subidos · ⚠ {noEncontrados.length} no encontrados · ❌ {errores.length} errores</span>
                )}
              </div>

              <div style={{ maxHeight:400,overflowY:'auto' }}>
                {progreso.map((r, i) => (
                  <div key={i} style={{ display:'flex',gap:10,alignItems:'flex-start',padding:'6px 0',borderBottom:'0.5px solid #2a2d3a',fontSize:12 }}>
                    <span>{r.estado === 'ok' ? '✅' : r.estado === 'error' ? '❌' : '⚠'}</span>
                    <div>
                      <div style={{ color: r.estado === 'ok' ? '#1D9E75' : r.estado === 'error' ? '#F09595' : '#c8a84b' }}>{r.nombre}</div>
                      <div style={{ color:'#666',marginTop:2 }}>{r.msg}</div>
                    </div>
                  </div>
                ))}
              </div>

              {terminado && noEncontrados.length > 0 && (
                <div style={{ marginTop:16,padding:12,background:'rgba(200,168,75,0.08)',borderRadius:8,border:'0.5px solid rgba(200,168,75,0.2)' }}>
                  <div style={{ fontSize:12,color:'#c8a84b',fontWeight:500,marginBottom:6 }}>⚠ Estos efectivos no están en la base de datos:</div>
                  {noEncontrados.map((r, i) => <div key={i} style={{ fontSize:12,color:'#888' }}>• {r.nombre}</div>)}
                </div>
              )}

              {terminado && (
                <button onClick={() => { setArchivos([]); setProgreso([]); setTerminado(false) }}
                  style={{ marginTop:16,width:'100%',padding:'10px',borderRadius:8,background:'#2a2d3a',color:'white',border:'none',fontSize:13,cursor:'pointer' }}>
                  Cargar más archivos
                </button>
              )}
            </div>
          )}

          <div style={{ marginTop:16,textAlign:'center' }}>
            <a href="/admin" style={{ color:'#555',fontSize:12 }}>← Volver al admin</a>
          </div>
        </div>
      </div>
    </>
  )
}
