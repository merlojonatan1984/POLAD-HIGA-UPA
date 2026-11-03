// pages/api/admin-storage-remove.js
//
// Paso 6b (seguridad). Única excepción además de /api/admin-db: borrar un
// archivo subido (la "planilla" de un efectivo) del depósito de archivos
// de Supabase. Subir un archivo ya era seguro (usa una URL firmada que se
// pide a /api/crear-url-planilla, válida una sola vez — no hace falta
// tocar eso), pero borrar un archivo sí usaba la clave pública desde el
// navegador. Mismo esquema de sesión que /api/admin-db.

import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

function verificarToken(token) {
  if (!token || typeof token !== 'string') return null
  const partes = token.split(':')
  if (partes.length !== 3) return null
  const [legajo, venceStr, firma] = partes
  const vence = parseInt(venceStr, 10)
  if (!Number.isFinite(vence) || Date.now() > vence) return null
  const secreto = process.env.AUTH_SESSION_SECRET
  if (!secreto) return null
  try {
    const payload = `${legajo}:${venceStr}`
    const firmaEsperada = crypto.createHmac('sha256', secreto).update(payload).digest('hex')
    const a = Buffer.from(firma, 'hex')
    const b = Buffer.from(firmaEsperada, 'hex')
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null
    return { legajo }
  } catch (e) {
    return null
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' })

  const { token, paths } = req.body || {}

  if (!process.env.AUTH_SESSION_SECRET) {
    console.error('[admin-storage-remove] Falta configurar AUTH_SESSION_SECRET.')
    return res.status(500).json({ error: 'Este panel todavía necesita un paso de configuración único en el sitio (AUTH_SESSION_SECRET).' })
  }

  const sesion = verificarToken(token)
  if (!sesion) return res.status(401).json({ error: 'Sesión inválida o vencida. Volvé a entrar.' })

  const lista = Array.isArray(paths) ? paths.filter(p => typeof p === 'string' && p.trim()) : []
  if (!lista.length) {
    return res.status(400).json({ error: 'Falta el archivo a borrar.' })
  }

  try {
    const { error } = await supabaseAdmin.storage.from('planillas').remove(lista)
    if (error) return res.status(400).json({ error: error.message })
    return res.status(200).json({ ok: true })
  } catch (err) {
    console.error('[admin-storage-remove] Error:', err)
    return res.status(500).json({ error: 'Error de conexión.' })
  }
}
