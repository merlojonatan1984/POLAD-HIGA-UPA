// pages/api/verificar-sesion.js
//
// Lo usa la pantalla del efectivo, al abrir y cada minuto, para saber dos cosas:
//   ok:      su ficha todavía existe (no fue dada de baja) y es la misma de su sesión.
//   abierta: la carga está abierta ahora, según el reloj del servidor. Si no lo
//            está, la pantalla del efectivo se pone en negro, igual que el ingreso.
// No devuelve ningún dato de la persona.

import { createClient } from '@supabase/supabase-js'
import { ventanaAbierta } from '../../lib/ventanaCarga'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' })

  const { legajo, lugar, id } = req.body || {}
  if (!legajo || !id || !['HIGA', 'UPA', 'MODULAR'].includes(lugar)) {
    return res.status(400).json({ error: 'Faltan datos' })
  }

  try {
    const { data, error } = await supabase
      .from('efectivos')
      .select('id')
      .eq('legajo', String(legajo).trim())
      .eq('lugar', lugar)
      .maybeSingle()
    // Ante un problema técnico no se afirma nada: la pantalla decide qué hacer.
    if (error) return res.status(500).json({ error: 'No se pudo verificar' })

    // Ficha inexistente o distinta (fue borrada y dada de alta de nuevo): hay que volver a entrar.
    if (!data || String(data.id) !== String(id)) return res.status(200).json({ ok: false, abierta: false })

    const { data: cfg, error: errCfg } = await supabase
      .from('configuracion').select('*').eq('lugar', lugar).maybeSingle()
    if (errCfg) return res.status(500).json({ error: 'No se pudo verificar' })

    return res.status(200).json({ ok: true, abierta: ventanaAbierta(cfg) })
  } catch (e) {
    return res.status(500).json({ error: 'No se pudo verificar' })
  }
}
