// pages/api/admin-reglas-objetivo.js
//
// Punto 3 de esta ronda ("Objetivos individuales configurables"):
// configuración editable del objetivo mensual vigente (horas o cantidad de
// guardias) de un efectivo puntual en este lugar, con turno día/noche/
// ambos. Vive en efectivo_objetivo (migración 0004), con historial completo
// en efectivo_objetivo_historial — cambiar la cantidad (ej. Coronel 3→2)
// nunca borra el valor anterior, queda registrado quién y cuándo lo cambió.
//
// Se consulta desde pages/admin.js (cargarRapida) para reemplazar, SOLO
// cuando existe una fila activa para ese legajo+lugar, el objetivo que
// antes se derivaba siempre del mes anterior — ver lib/objetivosEfectivos.js
// (resolverObjetivoGuardias). Si no hay configuración, el comportamiento
// anterior (derivar del mes anterior) sigue exactamente igual.
//
// GET  (?legajo= opcional) → { objetivos: [{id, legajo, tipo, cantidad,
//        turno_objetivo, activo, ...}, ...] } del lugar de la sesión.
// POST { action, ... }
//   'guardar'     { legajo, tipo, cantidad, turno_objetivo? }
//   'desactivar'  { id }

import { createClient } from '@supabase/supabase-js'
import { requireAdminSession } from '../../lib/authServer'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export default async function handler(req, res) {
  const sesion = requireAdminSession(req, res)
  if (!sesion) return
  const lugar = sesion.lugar

  if (req.method === 'GET') {
    let q = supabase.from('efectivo_objetivo').select('*').eq('lugar', lugar).eq('activo', true).order('creado_en')
    if (req.query.legajo) q = q.eq('legajo', req.query.legajo)
    const { data, error } = await q
    if (error) {
      if (/relation .*efectivo_objetivo.* does not exist/i.test(error.message || '')) {
        return res.status(500).json({ error: 'Falta aplicar la migración supabase/migrations/0004_reglas_individuales_y_avisos.sql en esta base (la tabla efectivo_objetivo todavía no existe).' })
      }
      return res.status(500).json({ error: error.message })
    }
    return res.status(200).json({ objetivos: data || [] })
  }

  if (req.method !== 'POST') return res.status(405).end()
  const { action } = req.body || {}

  try {
    if (action === 'guardar') {
      const { legajo, tipo, turno_objetivo } = req.body || {}
      const cantidad = Number(req.body?.cantidad)
      if (!legajo || !tipo || !['horas', 'guardias'].includes(tipo)) {
        return res.status(400).json({ error: 'Faltan/son inválidos legajo/tipo (esperaba horas o guardias)' })
      }
      if (!Number.isFinite(cantidad) || cantidad < 0) return res.status(400).json({ error: 'cantidad inválida' })
      const turnoObj = turno_objetivo || 'ambos'
      if (!['dia', 'noche', 'ambos'].includes(turnoObj)) return res.status(400).json({ error: 'turno_objetivo inválido (esperaba dia/noche/ambos)' })

      const { data: ef, error: errEf } = await supabase
        .from('efectivos').select('id, legajo').eq('legajo', legajo).eq('lugar', lugar).maybeSingle()
      if (errEf) return res.status(500).json({ error: errEf.message })
      if (!ef) return res.status(404).json({ error: 'Ese legajo no corresponde a ningún efectivo de este lugar. Seleccionalo desde la lista de Personal.' })

      // Corrección de esta ronda ("Guardar los cambios de puestos y
      // objetivos mediante transacciones"): antes, el historial, la
      // desactivación de la regla previa y la inserción de la nueva eran
      // TRES llamadas separadas desde acá — si cualquiera fallaba después
      // de la primera, el efectivo podía quedar sin ningún objetivo activo,
      // o con un historial que registraba un cambio que nunca se completó.
      // Ahora es UNA sola función SQL atómica (fn_guardar_objetivo,
      // supabase/migrations/0005_correcciones_ronda_bugs.sql): si algo
      // falla, Postgres revierte todo y el objetivo anterior sigue activo
      // exactamente como estaba.
      const { data: nuevo, error: errRpc } = await supabase.rpc('fn_guardar_objetivo', {
        p_legajo: legajo, p_lugar: lugar, p_tipo: tipo, p_cantidad: cantidad, p_turno_objetivo: turnoObj, p_actor_legajo: sesion.legajo,
      })
      if (errRpc) {
        if (/function fn_guardar_objetivo/i.test(errRpc.message || '')) {
          return res.status(500).json({ error: 'Falta aplicar la migración supabase/migrations/0005_correcciones_ronda_bugs.sql en esta base (la función fn_guardar_objetivo todavía no existe).' })
        }
        return res.status(500).json({ error: errRpc.message })
      }
      return res.status(200).json({ ok: true, objetivo: nuevo })
    }

    if (action === 'desactivar') {
      const { id } = req.body || {}
      if (!id) return res.status(400).json({ error: 'Falta id' })

      // Mismo criterio que 'guardar': historial + desactivación en UNA
      // transacción atómica (fn_desactivar_objetivo), en vez de dos
      // llamadas separadas.
      const { data: ok, error: errRpc } = await supabase.rpc('fn_desactivar_objetivo', {
        p_id: id, p_lugar: lugar, p_actor_legajo: sesion.legajo,
      })
      if (errRpc) {
        if (/function fn_desactivar_objetivo/i.test(errRpc.message || '')) {
          return res.status(500).json({ error: 'Falta aplicar la migración supabase/migrations/0005_correcciones_ronda_bugs.sql en esta base (la función fn_desactivar_objetivo todavía no existe).' })
        }
        return res.status(500).json({ error: errRpc.message })
      }
      if (!ok) return res.status(404).json({ error: 'No se encontró ese objetivo en este lugar.' })
      return res.status(200).json({ ok: true })
    }

    return res.status(400).json({ error: 'action inválida (esperaba guardar/desactivar)' })
  } catch (err) {
    console.error('[admin-reglas-objetivo] Error:', err)
    return res.status(500).json({ error: err.message })
  }
}
