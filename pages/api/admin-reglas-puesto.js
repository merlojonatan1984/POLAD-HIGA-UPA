// pages/api/admin-reglas-puesto.js
//
// Punto 2 de esta ronda ("Puestos específicos por efectivo"): configuración
// EDITABLE desde administración de qué sector (y, opcionalmente, qué turno)
// le corresponde de forma preferente a un efectivo puntual — en vez de una
// excepción fija por nombre escrita en el código (lo que el pedido pide
// evitar explícitamente), es una fila en efectivo_puesto_fijo
// (supabase/migrations/0004_reglas_individuales_y_avisos.sql), seleccionando
// al efectivo desde su registro YA EXISTENTE en `efectivos` (nunca un
// nombre suelto). Se consulta desde pages/admin.js (procesarRapida) antes
// de la asignación general de cada corrida de "Asignación rápida".
//
// No toca efectivos, turnos, ni fn_admin_guardar_efectivo — tabla y
// endpoint totalmente nuevos y separados.
//
// GET  (?legajo= opcional) → { reglas: [{id, legajo, sector, turno, activo,
//        creado_en, ...}, ...] }  — todas las del lugar de la sesión
//        (activas), o solo las de un legajo si se pasa ?legajo=.
// POST { action, ... }
//   'guardar'     { legajo, sector, turno? }  — crea una regla nueva activa
//                   para ese legajo+lugar; si ya había una activa para ese
//                   mismo legajo+lugar, la desactiva primero (nunca quedan
//                   dos activas en conflicto — unique index parcial en la
//                   migración lo impediría igual, pero acá se maneja en el
//                   mismo POST para no devolver un error de conflicto al
//                   administrador cuando lo que quiere es simplemente
//                   cambiar el puesto).
//   'desactivar'  { id }

import { createClient } from '@supabase/supabase-js'
import { requireAdminSession } from '../../lib/authServer'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const SECTORES_POR_LUGAR = {
  HIGA: ['Salud Mental', 'Giratoria', 'Llaves', 'Guardia', 'Estacionamiento', 'Rondin Externo'],
  UPA: ['UPA'],
  MODULAR: ['Modular'],
}
const TURNOS_POR_LUGAR = {
  HIGA: ['d', 'n'], UPA: ['d', 'n'], MODULAR: ['m', 't', 'n'],
}

export default async function handler(req, res) {
  const sesion = requireAdminSession(req, res)
  if (!sesion) return
  const lugar = sesion.lugar

  if (req.method === 'GET') {
    let q = supabase.from('efectivo_puesto_fijo').select('*').eq('lugar', lugar).eq('activo', true).order('creado_en')
    if (req.query.legajo) q = q.eq('legajo', req.query.legajo)
    const { data, error } = await q
    if (error) {
      if (/relation .*efectivo_puesto_fijo.* does not exist/i.test(error.message || '')) {
        return res.status(500).json({ error: 'Falta aplicar la migración supabase/migrations/0004_reglas_individuales_y_avisos.sql en esta base (la tabla efectivo_puesto_fijo todavía no existe).' })
      }
      return res.status(500).json({ error: error.message })
    }
    return res.status(200).json({ reglas: data || [] })
  }

  if (req.method !== 'POST') return res.status(405).end()
  const { action } = req.body || {}

  try {
    if (action === 'guardar') {
      const { legajo, sector, turno } = req.body || {}
      if (!legajo || !sector) return res.status(400).json({ error: 'Faltan legajo/sector' })

      const sectoresDelLugar = SECTORES_POR_LUGAR[lugar] || []
      if (!sectoresDelLugar.includes(sector)) {
        return res.status(400).json({ error: `Sector inválido para ${lugar}: ${sector}` })
      }
      if (turno && !(TURNOS_POR_LUGAR[lugar] || []).includes(turno)) {
        return res.status(400).json({ error: `Turno inválido para ${lugar}: ${turno}` })
      }

      // El efectivo tiene que existir YA en este lugar — nunca se crea una
      // regla para un legajo suelto que no sea un registro real.
      const { data: ef, error: errEf } = await supabase
        .from('efectivos').select('id, legajo').eq('legajo', legajo).eq('lugar', lugar).maybeSingle()
      if (errEf) return res.status(500).json({ error: errEf.message })
      if (!ef) return res.status(404).json({ error: 'Ese legajo no corresponde a ningún efectivo de este lugar. Seleccionalo desde la lista de Personal.' })

      // Corrección de esta ronda ("Guardar los cambios de puestos y
      // objetivos mediante transacciones"): antes, desactivar la regla
      // previa e insertar la nueva eran DOS llamadas separadas desde acá —
      // si la segunda fallaba, el efectivo quedaba sin ninguna regla
      // activa. Ahora es UNA sola función SQL atómica
      // (fn_guardar_puesto_fijo, supabase/migrations/0005_correcciones_ronda_bugs.sql):
      // si algo falla, Postgres revierte todo y la regla anterior sigue
      // activa exactamente como estaba.
      const { data: nueva, error: errRpc } = await supabase.rpc('fn_guardar_puesto_fijo', {
        p_legajo: legajo, p_lugar: lugar, p_sector: sector, p_turno: turno || null, p_actor_legajo: sesion.legajo,
      })
      if (errRpc) {
        if (/function fn_guardar_puesto_fijo/i.test(errRpc.message || '')) {
          return res.status(500).json({ error: 'Falta aplicar la migración supabase/migrations/0005_correcciones_ronda_bugs.sql en esta base (la función fn_guardar_puesto_fijo todavía no existe).' })
        }
        return res.status(500).json({ error: errRpc.message })
      }
      return res.status(200).json({ ok: true, regla: nueva })
    }

    if (action === 'desactivar') {
      const { id } = req.body || {}
      if (!id) return res.status(400).json({ error: 'Falta id' })
      const { data: filas, error } = await supabase
        .from('efectivo_puesto_fijo')
        .update({ activo: false, actualizado_por_legajo: sesion.legajo, actualizado_en: new Date().toISOString() })
        .eq('id', id).eq('lugar', lugar).select('id')
      if (error) return res.status(500).json({ error: error.message })
      if (!filas || filas.length === 0) return res.status(404).json({ error: 'No se encontró esa regla en este lugar.' })
      return res.status(200).json({ ok: true })
    }

    return res.status(400).json({ error: 'action inválida (esperaba guardar/desactivar)' })
  } catch (err) {
    console.error('[admin-reglas-puesto] Error:', err)
    return res.status(500).json({ error: err.message })
  }
}
