import { useState } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../lib/supabase'

const LOGO = "data:image/png;base64,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"

export default function Login() {
  const router = useRouter()
  const [legajo, setLegajo] = useState('')
  const [pass, setPass] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleLogin(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const { data, error: err } = await supabase
        .from('efectivos')
        .select('*')
        .eq('legajo', legajo.trim())
        .single()

      if (err || !data) { setError('Legajo no encontrado.'); setLoading(false); return }

      const claveCorrecta = data.es_admin ? pass === 'admin2025' : pass === legajo.trim()
      if (!claveCorrecta) { setError('Contraseña incorrecta.'); setLoading(false); return }

      localStorage.setItem('polad_user', JSON.stringify(data))

      if (data.es_admin) router.push('/admin')
      else router.push('/efectivo')
    } catch (e) {
      setError('Error de conexión.')
      setLoading(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px', background: '#0f1117' }}>
      <div style={{ width: '100%', maxWidth: '380px' }}>
        <div style={{ textAlign: 'center', marginBottom: '28px' }}>
          <img src={LOGO} alt="Logo Policía" style={{ width: 90, height: 90, objectFit: 'contain', marginBottom: 14 }} />
          <h1 style={{ fontSize: 20, fontWeight: 500, color: '#e8eaf0', marginBottom: 4 }}>POLAD · HIGA-UPA</h1>
          <p style={{ fontSize: 13, color: '#8b90a0' }}>Sistema de gestión de turnos</p>
          <p style={{ fontSize: 12, color: '#5DCAA5', marginTop: 6, fontWeight: 500 }}>A cargo de Crio. Paulo Corbela</p>
        </div>

        <div style={{ background: '#1a1d27', border: '0.5px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '1.25rem' }}>
          <form onSubmit={handleLogin}>
            <div style={{ marginBottom: 14 }}>
              <label style={{ display: 'block', fontSize: 12, color: '#8b90a0', marginBottom: 5 }}>Legajo</label>
              <input type="text" placeholder="Ej: 45231" value={legajo} onChange={e => setLegajo(e.target.value)} required autoFocus style={{ width: '100%', padding: '9px 11px', border: '0.5px solid rgba(255,255,255,0.14)', borderRadius: 8, fontSize: 14, background: '#222637', color: '#e8eaf0', outline: 'none' }} />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 12, color: '#8b90a0', marginBottom: 5 }}>Contraseña</label>
              <input type="password" placeholder="••••••••" value={pass} onChange={e => setPass(e.target.value)} required style={{ width: '100%', padding: '9px 11px', border: '0.5px solid rgba(255,255,255,0.14)', borderRadius: 8, fontSize: 14, background: '#222637', color: '#e8eaf0', outline: 'none' }} />
              <p style={{ fontSize: 11, color: '#555b6e', marginTop: 5 }}>Clave inicial: tu número de legajo</p>
            </div>
            {error && <div style={{ padding: '10px 14px', borderRadius: 8, fontSize: 13, marginBottom: 12, background: '#2b0d0d', color: '#F09595', border: '0.5px solid #E24B4A' }}>{error}</div>}
            <button type="submit" style={{ width: '100%', justifyContent: 'center', display: 'flex', alignItems: 'center', padding: '10px 16px', borderRadius: 8, border: 'none', background: '#378ADD', cursor: 'pointer', fontSize: 14, color: '#fff', fontWeight: 500 }} disabled={loading}>
              {loading ? 'Ingresando...' : 'Ingresar'}
            </button>
          </form>
        </div>

        <p style={{ textAlign: 'center', fontSize: 11, color: '#555b6e', marginTop: 16 }}>
          Policía de la Provincia de Buenos Aires
        </p>
      </div>
    </div>
  )
}
