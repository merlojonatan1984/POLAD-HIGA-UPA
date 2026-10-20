// pages/api/admin-turnos.js
//
// Punto 1 de la revisión: "Cerrá el acceso directo a turnos y efectivos,
// migrando primero los accesos necesarios de las pantallas a endpoints
// autenticados." Antes, pages/admin.js leía y escribía la tabla `turnos`
// (el borrador de guardias) directo desde el navegador con la clave anon
// pública, en ~21 puntos distintos — cualquiera que conociera esa clave
// (pública, embebida en el bundle del cliente) podía leer o modificar el
// borrador de guardias de cualquier lugar/mes/año, sin sesión ni control
// alguno. Este endpoint reemplaza TODOS esos accesos: requiere sesión de
// administrador verificada por el servidor (lib/authServer.js) y escribe
// con la service role key, nunca con la clave anon.
//
// GET — lectura. Query params:
//   mes, anio       (obligatorios)
//   dia             (opcional) — filtra por día
//   legajo          (opcional, pero OBLIGATORIO junto con scope=todas — ver
//                   abajo) — filtra por legajo. Acepta una lista separada
//                   por comas (legajo=100001,100002) para pedir varios a la
//                   vez en un solo llamado.
//   scope=todas     (opcional) — sin este flag, se filtra por los sectores
//                   del LUGAR de la sesión (lo habitual: "mis guardias").
//
//                   Punto 4 de esta ronda de revisión: con scope=todas,
//                   ANTES no se filtraba por sector/lugar EN ABSOLUTO — un
//                   administrador de cualquier lugar podía pedir
//                   /api/admin-turnos?mes=X&anio=Y&scope=todas (sin
//                   legajo) y recibir el borrador COMPLETO de todos los
//                   lugares para ese mes/año, aunque la documentación de
//                   este mismo archivo dijera que scope=todas es
//                   "SOLO para el chequeo de cruce de horario entre
//                   lugares" (buscarCruceOtroLugar en admin.js, y el
//                   cálculo de horas cruzadas de pages/admin.js
//                   procesarRapida) — las dos veces que de verdad se usa
//                   esto, siempre se pide con uno o varios legajos
//                   puntuales, nunca "todo". Ahora scope=todas EXIGE
//                   legajo (si falta, 400) y la consulta devuelve
//                   ÚNICAMENTE las columnas necesarias para ese chequeo
//                   (legajo, dia, turno, sector — ni id ni mes/anio, que el
//                   que llama ya conoce), nunca la fila completa de otros
//                   lugares sin acotar.
// Devuelve: { turnos: [{id, legajo, dia, turno, sector, mes, anio}, ...] }
//           (con scope=todas: { turnos: [{legajo, dia, turno, sector}, ...] },
//           sin id/mes/anio — ver arriba)
//
// POST — escritura, vía las funciones transaccionales de
// supabase/migrations/0001_borrador_publicacion.sql (fn_turnos_borrador_*),
// que además toman el lock compartido con la publicación (punto 5) y
// validan que los sectores pertenezcan al lugar de la sesión — nunca al
// lugar que mande el cliente. Body: { action, mes, anio, ... }
//   action: 'insertar'          { turnos: [{legajo,dia,turno,sector}, ...] }
//   action: 'reemplazar_scope'  { sectores, turnos: [...] }  — punto 2 de
//                   esta ronda: borra el scope anterior e inserta el lote
//                   nuevo en UNA sola transacción (fn_turnos_borrador_
//                   reemplazar_scope), para que nunca quede un hueco vacío
//                   publicable entre borrar e insertar (lo que antes
//                   pasaba al usar 'borrar_scope' + 'insertar' como dos
//                   pedidos separados — ver pages/admin.js, generarTurnos).
//   action: 'borrar_scope'      { sectores?: [...] }  (default: todos los del lugar)
//   action: 'actualizar_uno'    { id, legajo, turno, sector }
//   action: 'borrar_uno'        { id }
//   action: 'renombrar_legajo'  { legajo_viejo, legajo_nuevo }  (mes/anio no
//                   aplican; p_lugar es SIEMPRE el de la sesión — punto 3
//                   de esta ronda: ahora se acota a ese lugar, nunca toca
//                   turnos de otro lugar del mismo legajo).
//
// Nunca toca turnos_publicados ni publicaciones.

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

function mapearErrorFuncion(mensaje) {
  const m = mensaje || ''
  if (/function .*fn_turnos_borrador/i.test(m)) {
    return { status: 500, error: 'No se pudo completar: falta aplicar la migración supabase/migrations/0001_borrador_publicacion.sql en esta base (las funciones fn_turnos_borrador_* todavía no existen). No se modificó nada.' }
  }
  if (m.includes('sector_invalido')) return { status: 400, error: 'Sector inválido para este lugar: ' + m }
  if (m.includes('turno_no_encontrado')) return { status: 404, error: 'La guardia que se intentó editar/borrar ya no existe (puede que otra persona la haya borrado).' }
  if (m.includes('turnos_invalidos')) return { status: 400, error: 'Datos de turnos inválidos: ' + m }
  if (m.includes('sectores_invalidos')) return { status: 400, error: 'Faltan sectores: ' + m }
  if (m.includes('legajo_invalido')) return { status: 400, error: 'Legajo inválido: ' + m }
  if (m.includes('mes_invalido') || m.includes('anio_invalido') || m.includes('lugar_invalido')) {
    return { status: 400, error: 'Datos inválidos: ' + m }
  }
  return { status: 500, error: 'Error: ' + m }
}

export default async function handler(req, res) {
  const sesion = requireAdminSession(req, res)
  if (!sesion) return
  const lugar = sesion.lugar
  const sectoresPropios = SECTORES_POR_LUGAR[lugar] || []

  if (req.method === 'GET') {
    const mes = parseInt(req.query.mes), anio = parseInt(req.query.anio)
    if (!mes || !anio) return res.status(400).json({ error: 'Faltan mes/anio' })

    const esTodas = req.query.scope === 'todas'
    const legajos = (req.query.legajo || '').split(',').map(l => l.trim()).filter(Boolean)

    if (esTodas && legajos.length === 0) {
      // Punto 4 de esta ronda: scope=todas (sin filtro de sector/lugar)
      // solo tiene sentido para comprobar cruces de un efectivo puntual
      // contra OTROS lugares — nunca para traer el borrador completo de
      // todos los lugares sin acotar.
      return res.status(400).json({ error: 'scope=todas requiere indicar legajo (uno o varios, separados por coma) — no se puede pedir el borrador completo de todos los lugares sin acotar por legajo.' })
    }

    let q = esTodas
      // Solo las columnas que hacen falta para un chequeo de cruce de
      // horario entre lugares — nunca la fila completa (id, mes, anio son
      // redundantes para quien ya sabe qué pidió).
      ? supabase.from('turnos').select('legajo, dia, turno, sector')
      : supabase.from('turnos').select('id, legajo, dia, turno, sector, mes, anio')

    q = q.eq('mes', mes).eq('anio', anio).limit(10000)

    if (esTodas) {
      q = q.in('legajo', legajos)
    } else {
      q = q.in('sector', sectoresPropios)
      if (req.query.legajo) q = q.eq('legajo', req.query.legajo)
    }
    if (req.query.dia) q = q.eq('dia', parseInt(req.query.dia))

    const { data, error } = await q
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ turnos: data || [] })
  }

  if (req.method !== 'POST') return res.status(405).end()

  const { action } = req.body || {}

  try {
    if (action === 'renombrar_legajo') {
      const { legajo_viejo, legajo_nuevo } = req.body || {}
      if (!legajo_viejo || !legajo_nuevo) return res.status(400).json({ error: 'Faltan legajo_viejo/legajo_nuevo' })
      // p_lugar: SIEMPRE el de la sesión (nunca uno que mande el cliente) —
      // punto 3 de esta ronda: acota el renombrado a este lugar, coordinado
      // con fn_lock_turnos_borrador para cada mes/año afectado.
      const { data, error } = await supabase.rpc('fn_turnos_borrador_renombrar_legajo', {
        p_lugar: lugar, p_legajo_viejo: legajo_viejo, p_legajo_nuevo: legajo_nuevo,
      })
      if (error) { const m = mapearErrorFuncion(error.message); return res.status(m.status).json({ error: m.error }) }
      return res.status(200).json({ ok: true, filas_afectadas: data })
    }

    const mes = parseInt(req.body?.mes), anio = parseInt(req.body?.anio)
    if (!mes || !anio) return res.status(400).json({ error: 'Faltan mes/anio' })

    if (action === 'insertar') {
      const { turnos } = req.body || {}
      if (!Array.isArray(turnos) || turnos.length === 0) return res.status(400).json({ error: 'Falta turnos (array no vacío)' })
      // Los sectores vienen en cada elemento (ya los decide la pantalla), pero
      // se verifica ACÁ que todos pertenezcan al lugar de la SESIÓN — nunca se
      // confía en el lugar implícito que mande el cliente.
      const { data, error } = await supabase.rpc('fn_turnos_borrador_insertar', {
        p_lugar: lugar, p_mes: mes, p_anio: anio, p_turnos: turnos,
      })
      if (error) { const m = mapearErrorFuncion(error.message); return res.status(m.status).json({ error: m.error }) }
      return res.status(200).json({ ok: true, insertados: data })
    }

    if (action === 'reemplazar_scope') {
      const { turnos } = req.body || {}
      const sectores = Array.isArray(req.body?.sectores) && req.body.sectores.length ? req.body.sectores : sectoresPropios
      if (!Array.isArray(turnos)) return res.status(400).json({ error: 'Falta turnos (array — puede ser vacío para dejar el scope sin guardias)' })
      // Una sola transacción (borra + inserta) bajo un único lock — ver el
      // comentario de fn_turnos_borrador_reemplazar_scope en la migración
      // 0001: si algo falla, el borrador anterior queda intacto completo,
      // nunca a medias ni vacío de forma visible para otra sesión.
      const { data, error } = await supabase.rpc('fn_turnos_borrador_reemplazar_scope', {
        p_lugar: lugar, p_mes: mes, p_anio: anio, p_sectores: sectores, p_turnos: turnos,
      })
      if (error) { const m = mapearErrorFuncion(error.message); return res.status(m.status).json({ error: m.error }) }
      return res.status(200).json({ ok: true, insertados: data })
    }

    if (action === 'borrar_scope') {
      const sectores = Array.isArray(req.body?.sectores) && req.body.sectores.length ? req.body.sectores : sectoresPropios
      const { data, error } = await supabase.rpc('fn_turnos_borrador_borrar_scope', {
        p_lugar: lugar, p_mes: mes, p_anio: anio, p_sectores: sectores,
      })
      if (error) { const m = mapearErrorFuncion(error.message); return res.status(m.status).json({ error: m.error }) }
      return res.status(200).json({ ok: true, borrados: data })
    }

    if (action === 'actualizar_uno') {
      const { id, legajo, turno, sector } = req.body || {}
      if (!id || !legajo || !turno || !sector) return res.status(400).json({ error: 'Faltan id/legajo/turno/sector' })
      const { error } = await supabase.rpc('fn_turnos_borrador_actualizar_uno', {
        p_lugar: lugar, p_mes: mes, p_anio: anio, p_id: id, p_legajo: legajo, p_turno: turno, p_sector: sector,
      })
      if (error) { const m = mapearErrorFuncion(error.message); return res.status(m.status).json({ error: m.error }) }
      return res.status(200).json({ ok: true })
    }

    if (action === 'borrar_uno') {
      const { id } = req.body || {}
      if (!id) return res.status(400).json({ error: 'Falta id' })
      const { error } = await supabase.rpc('fn_turnos_borrador_borrar_uno', {
        p_lugar: lugar, p_mes: mes, p_anio: anio, p_id: id,
      })
      if (error) { const m = mapearErrorFuncion(error.message); return res.status(m.status).json({ error: m.error }) }
      return res.status(200).json({ ok: true })
    }

    return res.status(400).json({ error: 'action inválida (esperaba insertar/reemplazar_scope/borrar_scope/actualizar_uno/borrar_uno/renombrar_legajo)' })
  } catch (err) {
    console.error('[admin-turnos] Error:', err)
    return res.status(500).json({ error: err.message })
  }
}
