import { createClient } from '@supabase/supabase-js'
import { requireAdminSession } from '../../lib/authServer'

// Cliente admin: usa la service_role key, SOLO se ejecuta en el servidor.
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Punto 5 de esta ronda ("permisos de archivos de planillas"): este
// endpoint ya requería sesión de administrador, pero el `lugar` con el que
// se arma la ruta de Storage (y por lo tanto el nombre del archivo que
// queda sobreescribible) venía del cliente SIN validar que corresponda a
// ningún efectivo real. Dos pantallas lo usan con alcances distintos:
//   - pages/admin.js (subirPlanillaAdmin) — gestión de personal de UN
//     lugar, el de la sesión del administrador logueado.
//   - pages/carga-planillas.js (procesarTodo) — carga masiva, que es
//     DELIBERADAMENTE cruzada entre lugares (ver el mismo comentario en
//     pages/api/carga-planillas-datos.js: el nombre del archivo no indica
//     el lugar, así que un administrador logueado en esa pantalla puede
//     subir la planilla de un efectivo de cualquier lugar). Por eso acá NO
//     se fuerza lugar = sesion.lugar (eso rompería la carga masiva, que es
//     un permiso global ya documentado e intencional) — en cambio, se
//     exige que (legajo, lugar) sea una fila real y existente de
//     `efectivos` antes de firmar la URL de subida, para que no se pueda
//     generar una URL de subida hacia una ruta de Storage arbitraria que no
//     corresponda a ningún efectivo.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  if (!requireAdminSession(req, res)) return

  try {
    const { legajo, ext, lugar } = req.body

    if (!legajo || !ext || !['xlsx', 'ods'].includes(ext) || !lugar) {
      return res.status(400).json({ error: 'Datos inválidos' })
    }

    const { data: efectivo, error: errEf } = await supabase
      .from('efectivos')
      .select('legajo')
      .eq('legajo', legajo)
      .eq('lugar', lugar)
      .maybeSingle()
    if (errEf) return res.status(500).json({ error: errEf.message })
    if (!efectivo) {
      return res.status(404).json({ error: 'No existe ningún efectivo con ese legajo en ese lugar; no se genera la URL de subida.' })
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
