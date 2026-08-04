import { createClient } from '@supabase/supabase-js'

// Cliente admin: usa la service_role key, SOLO se ejecuta en el servidor.
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  try {
    const { legajo, ext, lugar } = req.body

    if (!legajo || !ext || !['xlsx', 'ods'].includes(ext) || !lugar) {
      return res.status(400).json({ error: 'Datos inválidos' })
    }

    const path = legajo + '-' + lugar + '.' + ext
    const { data, error } = await supabase.storage
      .from('planillas')
      .createSignedUploadUrl(path, { upsert: true })

    if (error) {
      return res.status(500).json({ error: 'Error creando URL de subida: ' + error.message })
    }

    return res.json({ ok: true, path: data.path, token: data.token })

  } catch (err) {
    console.error('Error en crear-url-planilla:', err)
    return res.status(500).json({ error: err.message })
  }
}
