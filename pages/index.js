import { useState } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../lib/supabase'

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

      // Verificar contraseña (en producción usar bcrypt; acá usamos legajo como contraseña inicial)
      // La clave inicial de cada efectivo es su legajo. El admin tiene clave "admin2025"
      const claveCorrecta = data.es_admin ? pass === 'admin2025' : pass === legajo.trim()
      if (!claveCorrecta) { setError('Contraseña incorrecta.'); setLoading(false); return }

      // Guardar sesión en localStorage
      localStorage.setItem('polad_user', JSON.stringify(data))

      if (data.es_admin) router.push('/admin')
      else router.push('/efectivo')
    } catch (e) {
      setError('Error de conexión.')
      setLoading(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
      <div style={{ width: '100%', maxWidth: '360px' }}>
        <div style={{ textAlign: 'center', marginBottom: '28px' }}>
          <div style={{ width: 52, height: 52, background: '#E6F1FB', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px' }}>
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
              <rect x="3" y="11" width="18" height="11" rx="2" stroke="#185FA5" strokeWidth="1.5"/>
              <path d="M7 11V7a5 5 0 0 1 10 0v4" stroke="#185FA5" strokeWidth="1.5"/>
              <circle cx="12" cy="16" r="1.5" fill="#185FA5"/>
            </svg>
          </div>
          <h1 style={{ fontSize: 20, fontWeight: 500, marginBottom: 4 }}>POLAD · HIGA-UPA</h1>
          <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Sistema de gestión de turnos</p>
        </div>

        <div className="card">
          <form onSubmit={handleLogin}>
            <div style={{ marginBottom: 14 }}>
              <label>Legajo</label>
              <input type="text" placeholder="Ej: 45231" value={legajo} onChange={e => setLegajo(e.target.value)} required autoFocus />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label>Contraseña</label>
              <input type="password" placeholder="••••••••" value={pass} onChange={e => setPass(e.target.value)} required />
              <p style={{ fontSize: 11, color: 'var(--text-hint)', marginTop: 5 }}>
                Clave inicial: tu número de legajo. Admin: admin2025
              </p>
            </div>
            {error && <div className="alert alert-err" style={{ marginBottom: 12 }}>{error}</div>}
            <button type="submit" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} disabled={loading}>
              {loading ? 'Ingresando...' : 'Ingresar'}
            </button>
          </form>
        </div>

        <p style={{ textAlign: 'center', fontSize: 11, color: 'var(--text-hint)', marginTop: 16 }}>
          POLAD · Policía de la Provincia de Buenos Aires
        </p>
      </div>
    </div>
  )
}
