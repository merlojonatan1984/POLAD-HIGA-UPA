// pages/api/cambiar-clave.js
//
// Cambio de contraseña del PROPIO efectivo (identificado por su sesión
// verificada, nunca por un id que mande el navegador). Reemplaza lo que
// hacía antes components/EfectivoApp.js: escribir directo
// `supabase.from('efectivos').update({password}).eq('id', usuario.id)` con
// la clave anon desde el navegador — esa clave es pública (viaja en el
// JavaScript de cualquier página del sitio), así que cualquiera que la
// copiara del código podía llamar a esa misma actualización para CUALQUIER
// id y pisarle la contraseña a cualquier otra persona, sin loguearse ni
// saber ninguna contraseña. Ahora: sesión de efectivo obligatoria, la
// contraseña actual se verifica del lado del servidor antes de cambiar
// nada, y la escritura la hace el servidor con la service role key.

import { createClient } from '@supabase/supabase-js'
import { requireEfectivoSession } from '../../lib/authServer'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const sesion = requireEfectivoSession(req, res)
  if (!sesion) return

  const { clave_actual, clave_nueva } = req.body || {}
  if (typeof clave_nueva !== 'string' || clave_nueva.length < 4) {
    return res.status(400).json({ error: 'La clave debe tener al menos 4 caracteres.' })
  }
  if (typeof clave_actual !== 'string') {
    return res.status(400).json({ error: 'Falta la clave actual.' })
  }

  const { data: efectivo, error: errEf } = await supabase
    .from('efectivos').select('id, legajo, password').eq('legajo', sesion.legajo).eq('lugar', sesion.lugar).maybeSingle()
  if (errEf) return res.status(500).json({ error: errEf.message })
  if (!efectivo) return res.status(404).json({ error: 'No se encontró tu usuario.' })

  const claveEsperada = efectivo.password || efectivo.legajo
  if (clave_actual !== claveEsperada) {
    return res.status(401).json({ error: 'La clave actual es incorrecta.' })
  }

  const { error: errUpdate } = await supabase.from('efectivos').update({ password: clave_nueva }).eq('id', efectivo.id)
  if (errUpdate) return res.status(500).json({ error: 'No se pudo guardar: ' + errUpdate.message })

  return res.status(200).json({ ok: true })
}
