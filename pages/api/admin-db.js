// pages/api/admin-db.js
//
// Paso 6b (seguridad). Este endpoint es el único "cajero" que puede
// hablar con las tablas de la base de datos que usa la pantalla de admin
// (turnos, efectivos, disponibilidad, etc.) usando la clave de servicio
// de Supabase — esa clave nunca viaja al navegador, solo vive acá, en el
// servidor.
//
// Antes, admin.js (lib/supabase.js) hablaba DIRECTO con Supabase desde el
// navegador con la clave "anon" (pública). Para que eso deje de funcionar
// hace falta, en el panel de Supabase, activar "Row Level Security" en
// cada tabla sin dejar permisos de escritura para esa clave pública — ese
// paso se hace una sola vez en Supabase (instrucciones aparte) y es
// recién ahí que la clave anon deja de poder escribir nada. Este endpoint
// es el reemplazo: usa la clave de servicio, que SIEMPRE puede escribir,
// sin importar lo que diga Row Level Security, así que admin.js sigue
// funcionando igual que antes.
//
// Para que esto no sea "cualquiera que encuentre esta dirección puede
// escribir lo que quiera", cada pedido tiene que traer un token de sesión
// válido (se arma en pages/api/auth-login.js cuando un administrador
// entra con su legajo y contraseña, y vence solo a las 12 horas) y la
// tabla tiene que estar en la lista de tablas permitidas de abajo — nada
// de otra tabla, ni ninguna otra operación, se acepta.

import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Mismas tablas que ya tocaba admin.js hablando directo con Supabase —
// ninguna tabla nueva, ninguna de más.
const TABLAS_PERMITIDAS = new Set([
  'turnos',
  'efectivos',
  'efectivo_puesto_fijo',
  'efectivo_objetivo_fijo',
  'configuracion',
  'planilla_manual',
  'firmas',
  'planillas',
  'efectivos_especiales',
  'asistencia',
  'disponibilidad',
])

const OPERACIONES_PERMITIDAS = new Set(['select', 'insert', 'update', 'delete'])

// Mismo esquema de token que arma pages/api/auth-login.js:
// "<legajo>:<vence-timestamp-ms>:<firma-hmac-sha256-hex>"
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

  const { token, tabla, op, columnas, valores, filtros, orden, limite } = req.body || {}

  if (!process.env.AUTH_SESSION_SECRET) {
    console.error('[admin-db] Falta configurar AUTH_SESSION_SECRET en las variables de entorno de este despliegue.')
    return res.status(500).json({ error: 'Este panel todavía necesita un paso de configuración único en el sitio (AUTH_SESSION_SECRET). Avisale a quien te ayudó a subirlo.' })
  }

  const sesion = verificarToken(token)
  if (!sesion) return res.status(401).json({ error: 'Sesión inválida o vencida. Volvé a entrar.' })

  if (typeof tabla !== 'string' || !TABLAS_PERMITIDAS.has(tabla)) {
    return res.status(400).json({ error: 'Tabla no permitida.' })
  }
  if (typeof op !== 'string' || !OPERACIONES_PERMITIDAS.has(op)) {
    return res.status(400).json({ error: 'Operación no permitida.' })
  }
  if (!Array.isArray(filtros || [])) {
    return res.status(400).json({ error: 'Filtros inválidos.' })
  }

  try {
    let q = supabaseAdmin.from(tabla)

    if (op === 'select') q = q.select(columnas || '*')
    else if (op === 'insert') q = q.insert(valores).select(columnas || '*')
    else if (op === 'update') q = q.update(valores).select(columnas || '*')
    else if (op === 'delete') q = q.delete().select(columnas || '*')

    for (const f of (filtros || [])) {
      if (!f || typeof f !== 'object') continue
      if (f.tipo === 'eq' && f.col) q = q.eq(f.col, f.val)
      else if (f.tipo === 'in' && f.col) q = q.in(f.col, f.val)
      else if (f.tipo === 'match' && f.val && typeof f.val === 'object') q = q.match(f.val)
    }
    if (orden && orden.col) q = q.order(orden.col, { ascending: orden.ascending !== false })
    if (limite) q = q.limit(limite)

    const { data, error } = await q
    if (error) {
      console.error('[admin-db] Error de Supabase:', error)
      return res.status(400).json({ error: error.message })
    }
    return res.status(200).json({ data })
  } catch (err) {
    console.error('[admin-db] Error:', err)
    return res.status(500).json({ error: 'Error de conexión con la base.' })
  }
}
