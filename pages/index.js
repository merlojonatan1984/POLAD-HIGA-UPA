import { useState } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../lib/supabase'

const LOGO = "data:image/png;base64,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klWjxRqGaA4Y2zRED2i6TltfdCx24ld/q2E+hBOD2jHmtfUT3RGKPM+UqT27tKktRVj627zzPkEh5sFwdkOP7TgfIuLnfVa5EWyI1GmUREXoIiICIiAiIgIiICIiAiIgIiICt/gTrOgpxV6U1MRJZLpGIKhrjjw+gZKP4dgfQNOPdJVQLsp5pIJmzRO5XsOQev8A9U8uOMle2XVLTWdwtzVWmafQ1/qrbqCgmuEExa6gq45CxkkWTl4wcE4wC3PUHcAgrVfadJB8r22+sy5rBG0n3WuGec7PBwcjGTtjfPeTcPdeWPUOm2aN1yx77cwfqtW05mt7gMAgnJMfruW7h2RgrX654a33TbDcKUNvFkeOeG4Ug52lh6F4GeX57jyKxVtMW7MvE+mqPzRurWMqtGiuJNsuLqTwmNDHSAuLw48xBDtsggYOcYPnkcKep0i2CpE9rq3SmZ5gc12AxhxyA79Rg+e5z2UfBBGQQR5r71Wj4on253pKIq3REcviOtNyfkcpDZOUg5G4IcTjG2PTPfbj9r0PlzjarkHYGMPy0EZyXDnyckjoRsFHaSmnrKqOkpIJaiokOGRRML3k+gG5Vo6d4fW3S1JFqLiVJ4MfxUtmjIdPVOAzh4HRvp/UjoY37MfvmfXt1G5jxw+8NLFbtO0M3EvUFO6Oggkd9y0UrgH1Mp+F2/Ydj83dAM05rvUVXqbUNTcqubxXyyOeXYOCTjJGd8YAA6bNHfKkPFriHcNX3Tl/DgpIWmKCCE/hwR/uNx1JGOZ3fGB7vxV+q4MUxM3v5n+EMt4niPAiItSQiIgIiICIiAiIgIiICIiAiIgIiICIiDlG98UjZI3uY9py1zTgg+YKnmguKOo9KP5aStkZATl8QYHwv88xHAz0GWlv1KgKLm9K3jVodVtNZ3C+2cR+H2oHc+o9B2qSoIHiVFDVfZST8n8pP9SF9F94KRcz4dJV87+ojmvEYb/3FQaLN/R09TMfdT57fovOu400NnpX02i9O2qwcwLXSQRCef8AzkBo+fvKptS6mut+rJamuq55XS/G6WTne8Zzgu8umwAGw2ytKirj6fHj5rHLi2S1vMiIis4EREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREH/2Q=="

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
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '20px', background: '#0a0c12' }}>

      <img src={LOGO} alt="Logo PDS" style={{ width: 200, height: 220, objectFit: 'contain', marginBottom: 16 }} />

      <h1 style={{ fontSize: 22, fontWeight: 600, color: '#e8eaf0', marginBottom: 4, letterSpacing: '0.04em', textAlign: 'center' }}>POLAD · HIGA-UPA</h1>
      <p style={{ fontSize: 11, color: '#c8a84b', marginBottom: 28, letterSpacing: '0.08em', textTransform: 'uppercase', textAlign: 'center' }}>Policía de Seguridad · Pcia. de Buenos Aires</p>

      <div style={{ width: '100%', maxWidth: '360px', background: '#13151f', border: '0.5px solid rgba(200,168,75,0.15)', borderRadius: 12, padding: '1.5rem' }}>
        <form onSubmit={handleLogin}>
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: 'block', fontSize: 12, color: '#8b90a0', marginBottom: 5 }}>Legajo</label>
            <input type="text" placeholder="Número de legajo" value={legajo} onChange={e => setLegajo(e.target.value)} required autoFocus
              style={{ width: '100%', padding: '10px 12px', border: '0.5px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 14, background: '#1e2130', color: '#e8eaf0', outline: 'none' }} />
          </div>
          <div style={{ marginBottom: 18 }}>
            <label style={{ display: 'block', fontSize: 12, color: '#8b90a0', marginBottom: 5 }}>Contraseña</label>
            <input type="password" placeholder="••••••••" value={pass} onChange={e => setPass(e.target.value)} required
              style={{ width: '100%', padding: '10px 12px', border: '0.5px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 14, background: '#1e2130', color: '#e8eaf0', outline: 'none' }} />
            <p style={{ fontSize: 11, color: '#444a5e', marginTop: 5 }}>Clave inicial: tu número de legajo</p>
          </div>
          {error && <div style={{ padding: '10px 14px', borderRadius: 8, fontSize: 13, marginBottom: 12, background: '#2b0d0d', color: '#F09595', border: '0.5px solid #E24B4A' }}>{error}</div>}
          <button type="submit" disabled={loading}
            style={{ width: '100%', display: 'flex', justifyContent: 'center', padding: '11px 16px', borderRadius: 8, border: '1px solid rgba(200,168,75,0.5)', background: 'transparent', cursor: 'pointer', fontSize: 13, color: '#c8a84b', fontWeight: 600, letterSpacing: '0.08em' }}>
            {loading ? 'Ingresando...' : 'INGRESAR'}
          </button>
        </form>
      </div>

      <p style={{ textAlign: 'center', fontSize: 10, color: '#2a2f3e', marginTop: 20, letterSpacing: '0.06em' }}>
        SISTEMA DE GESTIÓN DE TURNOS POLAD
      </p>
    </div>
  )
}
