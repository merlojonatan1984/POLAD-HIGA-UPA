import { createClient } from '@supabase/supabase-js'

// Usa la SERVICE ROLE KEY (acceso total, sin restricciones de RLS) para que el panel
// de admin siempre vea TODA la disponibilidad cargada, sin depender de qué políticas
// de seguridad tenga la tabla para la clave pública (anon) que usa el navegador.
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()
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
