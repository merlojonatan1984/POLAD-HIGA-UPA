import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'

function _detectLugar() {
  // Punto 1 de esta ronda ("Ingreso correcto por destino"): coherente con
  // pages/admin.js — en un entorno de prueba local, NEXT_PUBLIC_LUGAR tiene
  // prioridad sobre el hostname (que en local es siempre "localhost", sin
  // importar qué sitio se esté simulando). En los 3 dominios reales de
  // producción esta variable no está definida, así que ahí no cambia nada.
  try { if (process.env.NEXT_PUBLIC_LUGAR && ['HIGA', 'UPA', 'MODULAR'].includes(process.env.NEXT_PUBLIC_LUGAR)) return process.env.NEXT_PUBLIC_LUGAR } catch (e) {}
  if (typeof window === 'undefined') return 'HIGA'
  const h = window.location.hostname
  if (h === 'polad-modular.vercel.app' || h.includes('polad-modular')) return 'MODULAR'
  if (h === 'polad-higa-upa.vercel.app') return 'UPA'
  return 'HIGA'
}

const LUGAR_CONFIG = {
  HIGA:    { label: 'HIGA',    imagen: '/higa foto.webp' },
  UPA:     { label: 'UPA',     imagen: '/upa2.webp' },
  MODULAR: { label: 'MODULAR', imagen: '/modular.jpeg' },
}

export default function Login() {
  const router = useRouter()
  const [lugar, setLugar] = useState('HIGA')
  const [config, setConfig] = useState(LUGAR_CONFIG['HIGA'])
  const [legajo, setLegajo] = useState('')
  const [pass, setPass] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const l = _detectLugar()
    setLugar(l)
    setConfig(LUGAR_CONFIG[l] || LUGAR_CONFIG['HIGA'])
    // Antes, acá se verificaba la ventana de inscripción y, si estaba
    // cerrada, se mostraba una pantalla negra sin siquiera dejar entrar al
    // login. Eso ya no corresponde: la ventana de inscripción ahora SOLO
    // limita la edición de disponibilidad del efectivo (ver EfectivoApp.js),
    // no el ingreso al sistema. El efectivo puede ingresar y consultar
    // durante todo el mes.
  }, [])

  async function handleLogin(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      // El login ahora se verifica del lado del servidor (pages/api/auth-login.js),
      // que además emite una cookie de sesión firmada. Ya no se compara
      // ninguna contraseña (ni la de administrador) en el código del
      // navegador.
      const resp = await fetch('/api/auth-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ legajo: legajo.trim(), password: pass }),
      })
      const body = await resp.json()

      if (!resp.ok) {
        setError(body.error || 'No se pudo iniciar sesión.')
        setLoading(false)
        return
      }

      // Se sigue guardando en localStorage solo para mostrar nombre/legajo
      // en pantalla y por comodidad de navegación — ya NO es lo que autoriza
      // nada: cada operación sensible se verifica en el servidor contra la
      // cookie de sesión, nunca contra este valor.
      localStorage.setItem('polad_user', JSON.stringify(body.usuario))

      if (body.usuario.es_admin) router.push('/admin')
      else router.push('/efectivo')
    } catch (e) {
      setError('Error de conexión.')
      setLoading(false)
    }
  }

  return (
    <>
      <Head>
        <link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700&display=swap" rel="stylesheet" />
      </Head>

      <div style={{ minHeight:'100vh', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:'20px', position:'relative', overflow:'hidden' }}>

        <div style={{
          position:'fixed', top:0, left:0, right:0, bottom:0,
          backgroundImage:`url('${config.imagen}')`,
          backgroundSize:'cover', backgroundPosition:'center',
          filter:'grayscale(100%) brightness(0.3) contrast(1.1)', zIndex:0,
        }} />

        <div style={{
          position:'fixed', top:0, left:0, right:0, bottom:0,
          background:'rgba(0,0,0,0.45)', zIndex:1,
        }} />

        <div style={{ position:'relative', zIndex:2, display:'flex', flexDirection:'column', alignItems:'center', width:'100%' }}>

          <h1 style={{ fontFamily:"'Cinzel', serif", fontSize:24, fontWeight:700, color:'#e8eaf0', marginBottom:6, letterSpacing:'0.06em', textAlign:'center' }}>
            POLAD · {config.label}
          </h1>
          <p style={{ fontFamily:"'Cinzel', serif", fontSize:11, color:'#c8a84b', marginBottom:28, letterSpacing:'0.12em', textTransform:'uppercase', textAlign:'center' }}>
            Sistema de Gestión de Turnos
          </p>

          <div style={{
            width:'100%', maxWidth:'360px',
            background:'rgba(10,10,10,0.75)',
            border:'0.5px solid rgba(200,168,75,0.2)',
            borderRadius:12, padding:'28px 24px', backdropFilter:'blur(6px)',
          }}>
            <form onSubmit={handleLogin}>
              <div style={{ marginBottom:14 }}>
                <label style={{ display:'block', fontSize:12, color:'#8b90a0', marginBottom:5 }}>Legajo</label>
                <input type="text" placeholder="Número de legajo" value={legajo}
                  onChange={e => setLegajo(e.target.value)} required autoFocus
                  style={{ width:'100%', padding:'10px 12px', border:'0.5px solid rgba(200,168,75,0.2)', borderRadius:8, fontSize:14, background:'rgba(26,26,26,0.9)', color:'#e8eaf0', boxSizing:'border-box' }} />
              </div>
              <div style={{ marginBottom:18 }}>
                <label style={{ display:'block', fontSize:12, color:'#8b90a0', marginBottom:5 }}>Contraseña</label>
                <input type="password" placeholder="••••••••" value={pass}
                  onChange={e => setPass(e.target.value)} required
                  style={{ width:'100%', padding:'10px 12px', border:'0.5px solid rgba(200,168,75,0.2)', borderRadius:8, fontSize:14, background:'rgba(26,26,26,0.9)', color:'#e8eaf0', boxSizing:'border-box' }} />
                <p style={{ fontSize:11, color:'#444a5e', marginTop:5 }}>Clave inicial: tu número de legajo</p>
              </div>

              {error && (
                <div style={{ padding:'10px 14px', borderRadius:8, fontSize:13, marginBottom:12, background:'#2b0d0d', color:'#f87171' }}>
                  {error}
                </div>
              )}

              <button type="submit" disabled={loading}
                style={{ fontFamily:"'Cinzel', serif", width:'100%', display:'flex', justifyContent:'center', padding:'11px 16px', borderRadius:8, border:'1px solid rgba(200,168,75,0.4)', background:loading?'rgba(26,26,26,0.85)':'rgba(200,168,75,0.15)', color:'#c8a84b', fontSize:13, fontWeight:600, letterSpacing:'0.1em', cursor:loading?'not-allowed':'pointer' }}>
                {loading ? 'Ingresando...' : 'INGRESAR'}
              </button>
            </form>
          </div>

          <p style={{ fontFamily:"'Cinzel', serif", textAlign:'center', fontSize:9, color:'#444', marginTop:20, letterSpacing:'0.1em' }}>
            SISTEMA DE GESTIÓN DE TURNOS POLAD
          </p>
        </div>
      </div>
    </>
  )
}
