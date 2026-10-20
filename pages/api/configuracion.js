// pages/api/configuracion.js
//
// Lectura/escritura de la ventana de inscripción (tabla configuracion) por
// un endpoint propio, verificado por el servidor, en vez de con la clave
// anon directo desde el navegador (como hacían antes EfectivoApp.js y
// pages/admin.js). Esto es lo que permite activar RLS denegando a la
// clave anon sobre esta tabla (ver supabase/migrations/0002_rls.sql) sin
// romper ni la pantalla del efectivo ni el panel de administración.
//
// GET  (?lugar=) → cualquier sesión válida (admin o efectivo) puede leer la
//      ventana configurada: ambos la necesitan (el efectivo para saber
//      cuándo puede cargar, el admin para mostrar/editar el formulario).
//      No hay datos sensibles en esta tabla (solo fechas/horas de ventana).
// POST → solo admin. Crea o actualiza (upsert) la fila de configuracion de
//      un lugar.

import { createClient } from '@supabase/supabase-js'
import { requireAdminSession, requireEfectivoSession } from '../../lib/authServer'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const LUGARES_VALIDOS = ['HIGA', 'UPA', 'MODULAR']

export default async function handler(req, res) {
  if (req.method === 'GET') {
    // Alcanza con cualquier sesión válida (admin o efectivo) — no hace
    // falta distinguir el rol para una simple lectura de horarios.
    if (!requireEfectivoSession(req, res)) return
    const { lugar } = req.query
    if (!LUGARES_VALIDOS.includes(lugar)) return res.status(400).json({ error: 'Falta o es inválido el parámetro lugar.' })

    const { data: cfg, error } = await supabase.from('configuracion').select('*').eq('lugar', lugar).maybeSingle()
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ cfg: cfg || null })
  }

  if (req.method === 'POST') {
    const sesion = requireAdminSession(req, res)
    if (!sesion) return

    const { lugar, dia, hora_inicio, hora_fin, mes, anio, mes_apertura, anio_apertura } = req.body || {}
    if (!LUGARES_VALIDOS.includes(lugar)) return res.status(400).json({ error: 'Falta o es inválido el parámetro lugar.' })

    const { data: existing, error: errSel } = await supabase.from('configuracion').select('id').eq('lugar', lugar).maybeSingle()
    if (errSel) return res.status(500).json({ error: errSel.message })

    const payload = { dia, hora_inicio, hora_fin, mes, anio, mes_apertura, anio_apertura }

    if (existing) {
      const { error } = await supabase.from('configuracion').update(payload).eq('id', existing.id)
      if (error) return res.status(500).json({ error: error.message })
    } else {
      const { error } = await supabase.from('configuracion').insert([{ lugar, ...payload }])
      if (error) return res.status(500).json({ error: error.message })
    }
    return res.status(200).json({ ok: true })
  }

  return res.status(405).end()
}
