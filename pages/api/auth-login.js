// pages/api/auth-login.js
//
// NUEVO — Paso 6 (seguridad). Hasta ahora pages/index.js (la pantalla de
// login) hacía la consulta a Supabase y la comparación de contraseña
// DIRECTO en el navegador: para un administrador, la línea tenía
// literalmente `'admin2025'` escrita en el código fuente — cualquiera que
// abriera las herramientas de desarrollador del navegador, o simplemente
// leyera el archivo en GitHub, la veía tal cual. Para un efectivo normal,
// se traía la fila completa (incluida su contraseña guardada) al navegador
// antes de comparar.
//
// Este endpoint nuevo hace esa misma búsqueda y comparación acá, en el
// servidor, usando la clave de servicio de Supabase (nunca la clave
// pública/anon que ya viaja al navegador) — así la contraseña real nunca
// forma parte del código fuente ni de lo que llega al navegador de quien
// está entrando. pages/index.js pasa a llamar a este endpoint en vez de
// consultar Supabase y comparar él mismo.
//
// Se mantiene el mismo comportamiento que tenía el login de siempre: para
// el legajo ingresado, primero se busca si es administrador (sin filtrar
// por lugar — así lo hacía el código original), y si no lo es, se busca
// como efectivo normal del lugar correspondiente, con su propia
// contraseña guardada o su legajo como clave inicial si nunca la cambió.

import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// La contraseña de administrador ya no se guarda en texto plano. La
// variable de entorno ADMIN_PASSWORD_HASH guarda un hash PBKDF2-SHA256 con
// el formato "pbkdf2:<iteraciones>:<salt en hex>:<hash en hex>" — a partir
// de eso es matemáticamente inviable reconstruir la contraseña real. Se
// usa ":" como separador (no "$"): Next.js expande cualquier "$algo"
// dentro de un archivo de variables de entorno como si fuera una
// referencia a OTRA variable — se probó con "$" y el hash terminaba
// cortado en el primer "$". Con ":" ese problema no existe. Se usa
// crypto.pbkdf2Sync (ya incluido en Node, nada que agregar a
// package.json) y crypto.timingSafeEqual para comparar sin dar pistas por
// diferencias de tiempo de respuesta. El archivo
// generar_hash_contrasena.html (fuera del repo, nunca se sube a ningún
// lado) hace el mismo cálculo del lado del navegador con la Web Crypto
// API, para que la contraseña elegida nunca viaje a ningún servidor — ni
// siquiera a este chat — y solo el hash resultante se pegue en Vercel.
function verificarPasswordHash(password, hashAlmacenado) {
  try {
    const partes = (hashAlmacenado || '').split(':')
    if (partes.length !== 4 || partes[0] !== 'pbkdf2') return false
    const iteraciones = parseInt(partes[1], 10)
    if (!Number.isFinite(iteraciones) || iteraciones <= 0) return false
    const salt = Buffer.from(partes[2], 'hex')
    const hashEsperado = Buffer.from(partes[3], 'hex')
    if (salt.length === 0 || hashEsperado.length === 0) return false
    const hashCalculado = crypto.pbkdf2Sync(password, salt, iteraciones, hashEsperado.length, 'sha256')
    return hashCalculado.length === hashEsperado.length && crypto.timingSafeEqual(hashCalculado, hashEsperado)
  } catch (e) {
    console.error('[auth-login] Error verificando hash de contraseña:', e)
    return false
  }
}

// Paso 6b (seguridad) — nuevo. Hasta ahora, una vez que entrabas, la
// pantalla de admin (admin.js) seguía hablando DIRECTO con la base de
// datos usando la clave pública ("anon"), sin que el servidor pudiera
// saber si quien mandaba cada pedido realmente había iniciado sesión como
// administrador o no. Ahora admin.js pasa a hablar con la base a través
// de /api/admin-db, que exige este token para cada pedido.
//
// El token es "<legajo>:<vence>:<firma>" — vence solo (12hs) y la firma
// se calcula con AUTH_SESSION_SECRET (una clave interna, no es ninguna
// contraseña de ninguna persona) usando HMAC-SHA256, así que nadie puede
// armar un token válido sin conocer esa clave, que vive solo acá en el
// servidor. No hace falta ninguna tabla ni dependencia nueva — todo con
// lo que ya trae Node.
function generarTokenSesion(legajo) {
  const secreto = process.env.AUTH_SESSION_SECRET
  if (!secreto) return null
  const vence = Date.now() + 1000 * 60 * 60 * 12 // 12 horas
  const payload = `${legajo}:${vence}`
  const firma = crypto.createHmac('sha256', secreto).update(payload).digest('hex')
  return `${payload}:${firma}`
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' })

  const { legajo, password, lugar } = req.body || {}
  if (!legajo || typeof legajo !== 'string') return res.status(400).json({ error: 'Falta el legajo' })
  if (typeof password !== 'string') return res.status(400).json({ error: 'Falta la contraseña' })

  const legajoTrim = legajo.trim()
  const lugarDestino = ['HIGA', 'UPA', 'MODULAR'].includes(lugar) ? lugar : 'HIGA'

  try {
    // 1) ¿Es administrador? Mismo criterio que usaba el login original: se
    //    busca por legajo con es_admin=true, sin filtrar por lugar.
    const { data: admin, error: errorAdmin } = await supabase
      .from('efectivos')
      .select('*')
      .eq('legajo', legajoTrim)
      .eq('es_admin', true)
      .maybeSingle()

    if (errorAdmin) {
      console.error('[auth-login] Error consultando administrador:', errorAdmin)
      return res.status(500).json({ error: 'Error de conexión.' })
    }

    if (admin) {
      const adminPasswordHash = process.env.ADMIN_PASSWORD_HASH
      if (!adminPasswordHash) {
        // No se inventa ni se asume una contraseña por defecto: si falta
        // la variable de entorno, el login de administrador queda
        // bloqueado y se informa con claridad, en vez de aceptar
        // cualquier valor.
        console.error('[auth-login] Falta configurar ADMIN_PASSWORD_HASH en las variables de entorno de este despliegue.')
        return res.status(500).json({ error: 'El login de administrador no está configurado en este entorno (falta ADMIN_PASSWORD_HASH). Contactar a quien administra el despliegue.' })
      }
      if (!verificarPasswordHash(password, adminPasswordHash)) {
        return res.status(401).json({ error: 'Contraseña incorrecta.' })
      }
      const sessionToken = generarTokenSesion(legajoTrim)
      if (!sessionToken) {
        console.error('[auth-login] Falta configurar AUTH_SESSION_SECRET en las variables de entorno de este despliegue.')
        return res.status(500).json({ error: 'El panel de administrador todavía necesita un paso de configuración único en el sitio (AUTH_SESSION_SECRET). Contactar a quien administra el despliegue.' })
      }
      return res.status(200).json({ usuario: admin, sessionToken })
    }

    // 2) Efectivo normal, filtrando por el lugar detectado en el
    //    navegador (mismo criterio que el login original).
    const { data: efectivo, error } = await supabase
      .from('efectivos')
      .select('*')
      .eq('legajo', legajoTrim)
      .eq('lugar', lugarDestino)
      .maybeSingle()

    if (error || !efectivo) {
      return res.status(401).json({ error: 'Legajo no encontrado.' })
    }

    const claveEsperada = efectivo.password || legajoTrim
    if (password !== claveEsperada) {
      return res.status(401).json({ error: 'Contraseña incorrecta.' })
    }

    return res.status(200).json({ usuario: efectivo })

  } catch (err) {
    console.error('[auth-login] Error:', err)
    return res.status(500).json({ error: 'Error de conexión.' })
  }
}
