// lib/authServer.js
//
// Sesión de servidor para POLAD, para dejar de depender de una contraseña
// fija en el código del cliente (ver pages/index.js antes de este cambio)
// y de localStorage para autorizar operaciones (ver pedido del administrador:
// "No confiar en localStorage ni en una contraseña fija incluida en
// JavaScript para autorizar operaciones").
//
// Cómo funciona: tras un login válido (verificado contra la tabla
// `efectivos` con la service role key, del lado del servidor), se firma un
// token con HMAC-SHA256 usando un secreto que SOLO el servidor conoce
// (variable de entorno AUTH_SESSION_SECRET) y se manda como cookie HttpOnly.
// El navegador no puede leer ni falsificar esa cookie sin conocer el
// secreto. Cada endpoint protegido vuelve a verificar la firma y la
// expiración antes de hacer cualquier cosa — nunca confía en un legajo o un
// "es_admin" que mande el cliente en el body/query.
//
// Esto NO es Supabase Auth ni reemplaza una revisión de políticas RLS (ver
// supabase/migrations/0002_rls_propuesta.sql) — es la pieza mínima para que
// los endpoints nuevos de esta etapa puedan confiar en "quién está pidiendo
// esto" sin usar una clave fija ni localStorage.

import crypto from 'crypto'

const COOKIE_NAME = 'polad_session'
const TTL_SEGUNDOS_DEFAULT = 60 * 60 * 10 // 10 horas

function getSecret() {
  const secret = process.env.AUTH_SESSION_SECRET
  if (secret && secret.length >= 16) return secret
  if (process.env.NODE_ENV !== 'production') {
    // Solo para desarrollo local: permite levantar el proyecto sin configurar
    // todavía la variable de entorno. NUNCA debe llegar a producción así.
    console.warn('[authServer] AUTH_SESSION_SECRET no está configurada (o es muy corta). Usando un secreto de DESARROLLO inseguro. Configurar AUTH_SESSION_SECRET antes de desplegar.')
    return 'dev-only-insecure-secret-cambiar-en-produccion'
  }
  throw new Error('Falta configurar la variable de entorno AUTH_SESSION_SECRET en este entorno (producción). Sin esto, no se pueden emitir ni verificar sesiones de forma segura.')
}

function base64url(input) {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
function base64urlDecode(input) {
  input = input.replace(/-/g, '+').replace(/_/g, '/')
  while (input.length % 4) input += '='
  return Buffer.from(input, 'base64').toString('utf8')
}

// payload: objeto plano serializable (legajo, lugar, rol, etc). No poner
// datos sensibles (contraseñas) acá: el token viaja en una cookie.
export function firmarSesion(payload, ttlSegundos = TTL_SEGUNDOS_DEFAULT) {
  const secret = getSecret()
  const body = { ...payload, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + ttlSegundos }
  const bodyB64 = base64url(JSON.stringify(body))
  const firma = crypto.createHmac('sha256', secret).update(bodyB64).digest('hex')
  return `${bodyB64}.${firma}`
}

// Devuelve el payload si el token es válido y no expiró, o null si no.
export function verificarSesion(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null
  const [bodyB64, firma] = token.split('.')
  if (!bodyB64 || !firma) return null
  const secret = getSecret()
  const firmaEsperada = crypto.createHmac('sha256', secret).update(bodyB64).digest('hex')
  // Comparación en tiempo constante para evitar timing attacks.
  const a = Buffer.from(firma, 'hex')
  const b = Buffer.from(firmaEsperada, 'hex')
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null
  let body
  try { body = JSON.parse(base64urlDecode(bodyB64)) } catch (e) { return null }
  if (!body.exp || Math.floor(Date.now() / 1000) > body.exp) return null
  return body
}

function parseCookies(req) {
  const header = req.headers?.cookie
  if (!header) return {}
  return Object.fromEntries(
    header.split(';').map(p => p.trim()).filter(Boolean).map(p => {
      const idx = p.indexOf('=')
      return [decodeURIComponent(p.slice(0, idx)), decodeURIComponent(p.slice(idx + 1))]
    })
  )
}

export function obtenerSesion(req) {
  const cookies = parseCookies(req)
  return verificarSesion(cookies[COOKIE_NAME])
}

export function setearCookieSesion(res, payload, ttlSegundos = TTL_SEGUNDOS_DEFAULT) {
  const token = firmarSesion(payload, ttlSegundos)
  const partes = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${ttlSegundos}`,
  ]
  if (process.env.NODE_ENV === 'production') partes.push('Secure')
  res.setHeader('Set-Cookie', partes.join('; '))
}

export function borrarCookieSesion(res) {
  const partes = [`${COOKIE_NAME}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0']
  if (process.env.NODE_ENV === 'production') partes.push('Secure')
  res.setHeader('Set-Cookie', partes.join('; '))
}

// Usar al principio de un endpoint admin-only. Si no hay sesión de admin
// válida, ya responde 401 y devuelve null (el caller debe hacer `return`).
export function requireAdminSession(req, res) {
  const sesion = obtenerSesion(req)
  if (!sesion || sesion.rol !== 'admin') {
    res.status(401).json({ error: 'No autenticado como administrador. Iniciá sesión de nuevo.' })
    return null
  }
  return sesion
}

// Usar al principio de un endpoint para efectivos. Devuelve { legajo, lugar }
// verificados por el servidor — nunca confiar en un legajo que mande el
// cliente en el body/query para estas rutas.
export function requireEfectivoSession(req, res) {
  const sesion = obtenerSesion(req)
  if (!sesion || (sesion.rol !== 'efectivo' && sesion.rol !== 'admin')) {
    res.status(401).json({ error: 'No autenticado. Iniciá sesión de nuevo.' })
    return null
  }
  return sesion
}
