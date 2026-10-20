// pages/api/carga-planillas-datos.js
//
// Punto 1 de la revisión: pages/carga-planillas.js (carga masiva de
// planillas desde archivos .ods/.xlsx, buscando el efectivo por el nombre
// del archivo) tenía su propio login real (contra /api/auth-login, que sí
// deja la sesión firmada en una cookie) pero, después de loguearse, seguía
// leyendo Y ESCRIBIENDO la tabla `efectivos` directo con la clave anon
// desde el navegador — el login de esa pantalla no protegía nada a nivel de
// base de datos. Hallazgo nuevo de esta ronda (no estaba en los 9 puntos
// originales, pero cae directamente bajo el punto 1: "Cerrá el acceso
// directo a... efectivos").
//
// A diferencia de admin-efectivos.js, esta búsqueda es DELIBERADAMENTE
// cruzada entre lugares (el nombre del archivo no indica el lugar, y la
// herramienta original buscaba en toda la tabla sin filtrar por lugar) —
// se preserva ese comportamiento exacto acá, autenticado, en vez de
// restringirlo al lugar de la sesión como se hizo en admin-efectivos.js
// (que es deliberadamente de un solo lugar). Requiere sesión de
// administrador (de cualquier lugar — no se exige que coincida con el del
// efectivo encontrado, igual que el comportamiento original).
//
// Punto 5 de esta ronda ("permisos de archivos de planillas"):
// 'actualizar_planilla_url' ahora exige también `lugar` (el que ya
// devuelve 'buscar_por_nombre' para ese efectivo) para no pisar la fila de
// una persona distinta que comparta el mismo legajo en otro lugar — ver el
// comentario en esa acción, más abajo.

import { createClient } from '@supabase/supabase-js'
import { requireAdminSession } from '../../lib/authServer'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  if (!requireAdminSession(req, res)) return

  const { action } = req.body || {}

  if (action === 'buscar_por_nombre') {
    const { ilike } = req.body || {}
    if (!ilike) return res.status(400).json({ error: 'Falta ilike' })
    const { data, error } = await supabase
      .from('efectivos').select('legajo, nombre, lugar').ilike('nombre', ilike).limit(1)
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ efectivos: data || [] })
  }

  if (action === 'actualizar_planilla_url') {
    const { legajo, lugar, planilla_url } = req.body || {}
    if (!legajo) return res.status(400).json({ error: 'Falta legajo' })
    // Punto 5 de esta ronda: el mismo legajo puede existir como personas
    // distintas en lugares distintos (ver la nota de unique(legajo, lugar)
    // en el esquema de pruebas, y el comentario de arriba sobre la
    // búsqueda deliberadamente cruzada entre lugares). Antes este update
    // filtraba SOLO por legajo: si el nombre del archivo hacía coincidir a
    // un efectivo con un legajo que también existe en otro lugar, el
    // .update() de Supabase actualiza TODAS las filas que matchean el
    // filtro — podía pisar silenciosamente el planilla_url de una persona
    // distinta en otro lugar. Ahora se exige también `lugar` (el que ya
    // devolvió buscar_por_nombre para ese efectivo) y se filtra por los
    // dos campos juntos.
    if (!lugar) return res.status(400).json({ error: 'Falta lugar' })
    const { error } = await supabase.from('efectivos').update({ planilla_url }).eq('legajo', legajo).eq('lugar', lugar)
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ ok: true })
  }

  return res.status(400).json({ error: 'action inválida' })
}
