import { createClient } from '@supabase/supabase-js'
import { requireAdminSession } from '../../lib/authServer'

// Usa la SERVICE ROLE KEY (acceso total, sin restricciones de RLS) para que el panel
// de admin siempre vea TODA la disponibilidad cargada, sin depender de qué políticas
// de seguridad tenga la tabla para la clave pública (anon) que usa el navegador.
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export default async function handler(req, res) {
  if (req.method === 'GET') {
    // Antes este endpoint no pedía ninguna autenticación: cualquiera que
    // conociera la URL podía leer TODA la disponibilidad cargada (de
    // cualquier legajo, cualquier lugar). Ahora requiere sesión de admin.
    if (!requireAdminSession(req, res)) return
    const { mes, anio, lugar, dia, legajo } = req.query
    if (!mes || !anio) return res.status(400).json({ error: 'Faltan mes/anio' })

    let q = supabase.from('disponibilidad').select('*').eq('mes', parseInt(mes)).eq('anio', parseInt(anio))
    if (lugar) q = q.eq('lugar', lugar)
    if (dia) q = q.eq('dia', parseInt(dia))
    if (legajo) q = q.eq('legajo', legajo)

    const { data, error } = await q
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ data: data || [] })
  }

  if (req.method === 'POST') {
    // Esta acción nació para que pages/admin.js dejara de renombrar
    // disponibilidad con la clave anon directo desde el navegador. Desde
    // el punto 2 de la ronda siguiente ("Completar la coherencia del
    // cambio de legajo"), pages/admin.js (handleGuardarPersonal) YA NO
    // llama a esta acción: el renombrado de disponibilidad pasó a hacerse
    // DENTRO de fn_admin_guardar_efectivo, en la misma transacción que el
    // efectivo y sus turnos (ver supabase/migrations/0001_borrador_publicacion.sql),
    // que es lo que de verdad hacía falta para que una falla posterior no
    // dejara esto renombrado y el resto no. Esta acción queda, igual,
    // corregida (antes tampoco exigía que el legajo perteneciera al lugar
    // de la sesión) por si algo más la llegara a usar — nunca debe
    // renombrar disponibilidad de un lugar distinto del de quien llama.
    const sesion = requireAdminSession(req, res)
    if (!sesion) return
    const { action, legajo_viejo, legajo_nuevo } = req.body || {}
    if (action !== 'rename_legajo') return res.status(400).json({ error: 'Acción no reconocida.' })
    if (!legajo_viejo || !legajo_nuevo) return res.status(400).json({ error: 'Faltan legajo_viejo/legajo_nuevo.' })

    const { error } = await supabase.from('disponibilidad')
      .update({ legajo: legajo_nuevo })
      .eq('legajo', legajo_viejo)
      .eq('lugar', sesion.lugar)
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ ok: true })
  }

  return res.status(405).end()
}
