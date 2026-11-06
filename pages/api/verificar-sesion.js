// pages/api/verificar-sesion.js
//
// NUEVO. Sirve para que un efectivo al que se le dio de baja (se borró su
// ficha) no pueda seguir usando el sistema con una sesión que ya tenía
// abierta en el celular. La pantalla del efectivo le pregunta acá, al abrir
// y antes de guardar, si su ficha todavía existe. Solo devuelve ok true/false:
// no devuelve ningún dato de la persona.

import { createClient } from '@supabase/supabase-js'

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

    // Si hubo un problema técnico no se afirma que la ficha no existe:
    // se responde error y la pantalla no echa a nadie por eso.
    if (error) return res.status(500).json({ error: 'No se pudo verificar' })

    // ok solo si la ficha existe Y es la misma que la de la sesión. Si la
    // persona fue borrada y luego dada de alta de nuevo, la ficha nueva
    // tiene otro id: tiene que volver a entrar con su clave.
    return res.status(200).json({ ok: !!data && String(data.id) === String(id) })
  } catch (e) {
    return res.status(500).json({ error: 'No se pudo verificar' })
  }
}
