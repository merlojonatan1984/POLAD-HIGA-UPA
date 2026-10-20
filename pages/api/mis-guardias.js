// pages/api/mis-guardias.js
//
// Lo único que un efectivo puede leer de sus guardias: la última versión
// PUBLICADA (tabla turnos_publicados bajo la publicación vigente), nunca el
// borrador de trabajo del administrador (tabla turnos). El legajo y el
// lugar salen de la sesión verificada por el servidor, nunca de un
// parámetro que mande el cliente — así un efectivo no puede pedir las
// guardias de otro legajo cambiando la URL.

import { createClient } from '@supabase/supabase-js'
import { requireEfectivoSession } from '../../lib/authServer'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()

  const sesion = requireEfectivoSession(req, res)
  if (!sesion) return // requireEfectivoSession ya respondió 401

  const mes = parseInt(req.query.mes) || null
  const anio = parseInt(req.query.anio) || null
  if (!mes || !anio) return res.status(400).json({ error: 'Faltan mes/anio' })

  const { lugar, legajo } = sesion

  const { data: publicacion, error: errPub } = await supabase
    .from('publicaciones')
    .select('id, version, publicado_en, publicado_por_legajo')
    .eq('lugar', lugar).eq('mes', mes).eq('anio', anio).eq('vigente', true)
    .maybeSingle()

  if (errPub) return res.status(500).json({ error: errPub.message })

  if (!publicacion) {
    return res.status(200).json({
      publicado: false,
      mensaje: 'Las guardias de este mes todavía no fueron publicadas.',
      turnos: []
    })
  }

  const { data: turnos, error: errTurnos } = await supabase
    .from('turnos_publicados')
    .select('dia, turno, sector')
    .eq('publicacion_id', publicacion.id)
    .eq('legajo', legajo)
    .order('dia', { ascending: true })

  if (errTurnos) return res.status(500).json({ error: errTurnos.message })

  return res.status(200).json({
    publicado: true,
    version: publicacion.version,
    publicado_en: publicacion.publicado_en,
    turnos: turnos || []
  })
}
