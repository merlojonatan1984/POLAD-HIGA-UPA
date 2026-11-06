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

  // Supabase devuelve como máximo 1000 filas por consulta. Con muchos efectivos la disponibilidad del mes pasa de 1000 filas
  // y los últimos quedaban sin sus días: por eso se lee por páginas hasta traer todo.
  const armar = () => {
    let q = supabase.from('disponibilidad').select('*').eq('mes', parseInt(mes)).eq('anio', parseInt(anio))
    if (lugar) q = q.eq('lugar', lugar)
    if (dia) q = q.eq('dia', parseInt(dia))
    if (legajo) q = q.eq('legajo', legajo)
    return q
  }
  const PAG = 1000
  const r1 = await armar().range(0, PAG - 1)
  if (r1.error) return res.status(500).json({ error: r1.error.message })
  let filas = r1.data || []
  if (filas.length === PAG) {
    const todas = []
    let desde = 0, fallo = false
    while (desde < 200000) {
      const rr = await armar().order('id', { ascending: true }).range(desde, desde + PAG - 1)
      if (rr.error) { fallo = true; break }
      todas.push(...(rr.data || []))
      if ((rr.data || []).length < PAG) break
      desde += PAG
    }
    if (!fallo) filas = todas
  }
  return res.status(200).json({ data: filas })
}
