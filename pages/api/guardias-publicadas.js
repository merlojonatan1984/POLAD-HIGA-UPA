// pages/api/guardias-publicadas.js
//
// Lectura, para el panel de administración, de la última versión PUBLICADA
// de las guardias de un lugar/mes/año (no el borrador). Se usa para armar
// el mensaje de WhatsApp: el mensaje tiene que reflejar lo publicado, nunca
// el borrador de trabajo (ver pages/admin.js, sección "Enviar guardias por
// WhatsApp").
//
// Requiere sesión de administrador. El "lugar" SIEMPRE es el de la sesión
// (sesion.lugar) — punto 4 de esta ronda: antes este endpoint aceptaba un
// "lugar" mandado por el cliente (query) sin contrastarlo contra la sesión,
// así que un administrador de un lugar podía leer las guardias publicadas
// (y la lista legajo→turnos que de ahí se arma el mensaje de WhatsApp) de
// OTRO lugar con solo cambiar ese parámetro. No existe ningún rol de
// administrador "global" en este proyecto — ver la misma nota en
// pages/api/publicar-guardias.js.

import { createClient } from '@supabase/supabase-js'
import { requireAdminSession } from '../../lib/authServer'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()
  const sesion = requireAdminSession(req, res)
  if (!sesion) return

  const lugar = sesion.lugar
  const { mes, anio } = req.query
  const MES = parseInt(mes), ANIO = parseInt(anio)
  if (!lugar || !MES || !ANIO) return res.status(400).json({ error: 'Faltan parámetros' })

  const { data: publicacion, error: errPub } = await supabase
    .from('publicaciones')
    .select('id, version, publicado_en, publicado_por_legajo')
    .eq('lugar', lugar).eq('mes', MES).eq('anio', ANIO).eq('vigente', true)
    .maybeSingle()

  if (errPub) return res.status(500).json({ error: errPub.message })
  if (!publicacion) return res.status(200).json({ publicado: false, turnos_por_legajo: {} })

  const { data: turnos, error: errTurnos } = await supabase
    .from('turnos_publicados')
    .select('legajo, dia, turno, sector')
    .eq('publicacion_id', publicacion.id)

  if (errTurnos) return res.status(500).json({ error: errTurnos.message })

  const porLegajo = {}
  ;(turnos || []).forEach(t => {
    if (!porLegajo[t.legajo]) porLegajo[t.legajo] = []
    porLegajo[t.legajo].push(t)
  })

  return res.status(200).json({
    publicado: true,
    version: publicacion.version,
    publicado_en: publicacion.publicado_en,
    turnos_por_legajo: porLegajo,
  })
}
