import { supabase } from '../../lib/supabase'

const APP_LUGAR = process.env.NEXT_PUBLIC_LUGAR || 'HIGA'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { legajo } = req.body
  if (!legajo) return res.status(400).json({ error: 'Legajo requerido' })

  // Busca el efectivo filtrando por lugar — permite el mismo legajo en distintas áreas
  const { data, error } = await supabase
    .from('efectivos')
    .select('*')
    .eq('legajo', legajo)
    .eq('lugar', APP_LUGAR)
    .single()

  if (error || !data) {
    return res.status(401).json({ error: 'Legajo no encontrado en ' + APP_LUGAR })
  }

  return res.status(200).json({ usuario: data })
}
