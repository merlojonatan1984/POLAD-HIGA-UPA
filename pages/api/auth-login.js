// pages/api/auth-login.js
//
// Login verificado del lado del servidor. Reemplaza la comparación de
// contraseña de administrador que antes vivía en el código del cliente
// (pages/index.js tenía 'admin2025' escrito en el JavaScript que se manda
// al navegador — cualquiera podía leerlo). Ahora la contraseña de admin se
// compara acá, en el servidor, contra la variable de entorno ADMIN_PASSWORD
// (nunca en el código fuente).
//
// Para un efectivo normal, sigue el mismo esquema de clave que ya existía
// (su propio campo `password`, o su legajo como clave inicial si todavía no
// la cambió) pero la comparación también pasa a hacerse acá, del lado del
// servidor, usando la service role key — no la clave anon desde el navegador.
//
// Si el login es válido, se emite una cookie de sesión firmada (ver
// lib/authServer.js). pages/index.js debe llamar a este endpoint en vez de
// consultar Supabase directamente.

import { createClient } from '@supabase/supabase-js'
import { setearCookieSesion } from '../../lib/authServer'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Punto de revisión 7: "El login no debe devolver contraseñas ni el
// registro completo del efectivo al navegador." Antes esta ruta hacía
// `select('*')` (para poder comparar la contraseña del lado del servidor,
// lo cual está bien) pero después devolvía esa misma fila completa al
// cliente con `res.json({usuario: admin})` / `res.json({usuario: efectivo})`
// — eso incluía el campo `password` en texto plano (y cualquier otro campo
// interno) viajando al navegador y quedando guardado en localStorage. La
// comparación de contraseña sigue haciéndose acá con la fila completa, pero
// lo único que se devuelve al navegador es esta lista explícita y acotada
// de campos, pensada para lo que la pantalla necesita mostrar (nombre,
// legajo, lugar, si es admin) — nunca password ni el resto de la fila.
function sanitizarUsuario(fila) {
  if (!fila) return null
  const { legajo, nombre, lugar, es_admin, tipo, jerarquia } = fila
  return { legajo, nombre, lugar, es_admin, tipo, jerarquia }
}

function detectLugar(req) {
  // Punto 1 de esta ronda ("Ingreso correcto por destino"): en un entorno
  // de prueba local (ver tests/README.md), los 3 "sitios" se simulan con 3
  // `next dev` locales, cada uno con su propio NEXT_PUBLIC_LUGAR — los
  // componentes del CLIENTE (_detectLugar() en pages/admin.js,
  // pages/index.js, pages/login-admin.js, components/ControlApp.js,
  // components/EfectivoApp.js) ya miran esa variable ANTES del hostname,
  // pero este endpoint no lo hacía: el host real en local es siempre
  // "localhost" (con cualquier puerto), así que login-login.js terminaba
  // identificando SIEMPRE "HIGA" sin importar qué sitio se estuviera
  // simulando. Esto no afectaba el login de administrador (su sesión usa
  // admin.lugar, la fila real — ver más abajo) pero sí rompía el login de
  // un EFECTIVO (no administrador) en una instancia local que simulaba UPA
  // o MODULAR: buscaba igual en la tabla de HIGA y no lo encontraba.
  //
  // Se agrega la misma comprobación que ya usa el cliente, en el mismo
  // orden (variable primero, host después) — en los 3 dominios reales de
  // producción (polad-higa-upa-qb7s.vercel.app → HIGA,
  // polad-higa-upa.vercel.app → UPA, polad-modular.vercel.app → MODULAR)
  // esta variable no está definida, así que el comportamiento ahí no
  // cambia en nada: sigue resolviendo por el host exactamente igual que
  // antes.
  if (process.env.NEXT_PUBLIC_LUGAR && ['HIGA', 'UPA', 'MODULAR'].includes(process.env.NEXT_PUBLIC_LUGAR)) {
    return process.env.NEXT_PUBLIC_LUGAR
  }
  const host = (req.headers['x-forwarded-host'] || req.headers.host || '').toString()
  if (host.includes('polad-modular')) return 'MODULAR'
  if (host === 'polad-higa-upa.vercel.app') return 'UPA'
  return 'HIGA'
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' })

  const { legajo, password } = req.body || {}
  if (!legajo || typeof legajo !== 'string') return res.status(400).json({ error: 'Falta el legajo' })
  if (typeof password !== 'string') return res.status(400).json({ error: 'Falta la contraseña' })

  // lugar "detectado" por request: SOLO se usa para decidir, de entrada,
  // en qué lugar buscar a un EFECTIVO (no hay otra forma de saberlo: el
  // formulario de login no pide lugar). Hallazgo de esta ronda, al revisar
  // el punto 4 ("permisos consistentes por lugar"): este valor viene de
  // request.headers['x-forwarded-host'] (o headers.host) — un header HTTP
  // común, que fetch() desde el navegador SÍ puede fijar libremente (a
  // diferencia de "Host", "X-Forwarded-Host" no es un header prohibido por
  // la spec de fetch). Antes, la sesión de ADMINISTRADOR se armaba
  // directamente con ESTE valor detectado (sesion.lugar = lugar), sin
  // ninguna relación con el lugar real de la fila de efectivos con la que
  // se logueó — como el login de administrador no filtra por lugar (ver
  // más abajo: "sin filtrar por lugar") y ADMIN_PASSWORD es una sola clave
  // compartida entre los tres lugares, cualquiera que conociera un legajo
  // de administrador válido y esa clave podía, mandando un
  // X-Forwarded-Host falso al pedir este mismo login, conseguir una sesión
  // con sesion.lugar = el lugar que quisiera — exactamente lo que el resto
  // de los endpoints de esta ronda (publicar-guardias.js,
  // guardias-publicadas.js, admin-turnos.js, admin-efectivos.js) ahora
  // confían ciegamente como "el lugar autorizado de esta sesión". Confiar
  // en sesion.lugar en esos endpoints no alcanza si sesion.lugar en sí se
  // pudo forjar acá. Por eso ahora, para un administrador, la sesión usa
  // SIEMPRE admin.lugar (la columna real de la fila con la que se
  // autenticó, verificada contra la base), nunca el lugar detectado por
  // request — así sesion.lugar queda atado a un dato verificado en la
  // base, no a un header que el que llama puede elegir.
  const lugarDetectadoPorRequest = detectLugar(req)
  const legajoTrim = legajo.trim()

  try {
    // 1) ¿Es un legajo de administrador? Punto 10 de esta ronda
    //    ("Funcionamiento de los tres destinos"): un administrador
    //    MULTI-DESTINO se representa con varias filas es_admin=true, mismo
    //    legajo, una por cada lugar al que tiene acceso (HIGA/UPA/MODULAR) —
    //    exactamente el mismo patrón que ya usa un efectivo normal con el
    //    mismo legajo en lugares distintos (ver el comentario de
    //    lugarDetectadoPorRequest y 01_seed_ficticio.sql). Antes esta
    //    consulta usaba `.maybeSingle()`, que en Supabase/PostgREST lanza
    //    un error si encuentra MÁS DE UNA fila — con un administrador
    //    multi-destino real (2 o 3 filas, mismo legajo), el login quedaba
    //    roto con un error de servidor, nunca con un login exitoso. Ahora
    //    se trae el array completo (sin .maybeSingle()) y se resuelve acá
    //    mismo cuál fila usar, unificando el mismo criterio de destino que
    //    ya usa el camino de efectivo normal, más abajo.
    const { data: admins, error: errorAdmins } = await supabase
      .from('efectivos')
      .select('*')
      .eq('legajo', legajoTrim)
      .eq('es_admin', true)

    if (errorAdmins) {
      console.error('[auth-login] Error consultando administradores:', errorAdmins)
      return res.status(500).json({ error: 'Error de conexión.' })
    }

    // Caso normal (un único lugar): se preserva el comportamiento de
    // siempre, sin exigir que el lugar detectado coincida con nada —
    // sesion.lugar queda atado a esa única fila real, igual que antes.
    // Caso multi-destino (2 o 3 filas, mismo legajo): se elige la fila cuyo
    // `lugar` coincide con el destino detectado por esta request
    // (lugarDetectadoPorRequest — la MISMA variable/host que ya decide el
    // destino en el resto de esta ronda, nunca un valor que el cliente
    // pueda forjar en el body). Si por algún motivo ninguna fila coincide
    // (dato inconsistente), se informa con claridad en vez de adivinar o
    // loguear en un lugar al que esa fila no pertenece.
    let admin = null
    if (admins && admins.length === 1) {
      admin = admins[0]
    } else if (admins && admins.length > 1) {
      admin = admins.find(a => a.lugar === lugarDetectadoPorRequest) || null
      if (!admin) {
        return res.status(401).json({ error: `Este legajo de administrador no tiene acceso configurado en ${lugarDetectadoPorRequest}.` })
      }
    }

    if (admin) {
      const adminPassword = process.env.ADMIN_PASSWORD
      if (!adminPassword) {
        // No inventamos ni asumimos una contraseña por defecto: si falta la
        // variable de entorno, el login de administrador queda bloqueado y
        // se informa con claridad, en vez de aceptar cualquier valor o
        // usar un valor fijo escondido en el código.
        console.error('[auth-login] Falta configurar ADMIN_PASSWORD en las variables de entorno de este despliegue.')
        return res.status(500).json({ error: 'El login de administrador no está configurado en este entorno (falta ADMIN_PASSWORD). Contactar a quien administra el despliegue.' })
      }
      if (password !== adminPassword) {
        return res.status(401).json({ error: 'Contraseña incorrecta.' })
      }
      // sesion.lugar = admin.lugar (la fila real, verificada), NUNCA el
      // lugar detectado por el request — ver el comentario de arriba.
      setearCookieSesion(res, { legajo: admin.legajo, lugar: admin.lugar, rol: 'admin' })
      return res.status(200).json({ usuario: sanitizarUsuario(admin) })
    }

    // 2) Efectivo normal. El lugar detectado por request se usa para
    //    decidir en qué lugar buscar (permite el mismo legajo en distintas
    //    sedes, igual que antes) — pero, una vez encontrada la fila, la
    //    sesión usa efectivo.lugar (el de la fila real), no el valor
    //    detectado: en el camino normal son el mismo valor (la búsqueda ya
    //    filtró por igualdad), pero así la sesión siempre queda atada a lo
    //    que la base confirmó, nunca a un header, por si algún día cambia
    //    cómo se decide dónde buscar.
    const { data: efectivo, error } = await supabase
      .from('efectivos')
      .select('*')
      .eq('legajo', legajoTrim)
      .eq('lugar', lugarDetectadoPorRequest)
      .maybeSingle()

    if (error || !efectivo) {
      return res.status(401).json({ error: 'Legajo no encontrado.' })
    }

    const claveEsperada = efectivo.password || legajoTrim
    if (password !== claveEsperada) {
      return res.status(401).json({ error: 'Contraseña incorrecta.' })
    }

    setearCookieSesion(res, { legajo: efectivo.legajo, lugar: efectivo.lugar, rol: 'efectivo' })
    return res.status(200).json({ usuario: sanitizarUsuario(efectivo) })

  } catch (err) {
    console.error('[auth-login] Error:', err)
    return res.status(500).json({ error: 'Error de conexión.' })
  }
}
