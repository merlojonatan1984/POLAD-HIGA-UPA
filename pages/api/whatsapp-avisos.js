// pages/api/whatsapp-avisos.js
//
// Punto 9 de esta ronda ("WhatsApp por destino"): seguimiento PERSISTENTE
// (servidor, no localStorage) del aviso de cronograma por efectivo+lugar+
// mes+año, independiente entre HIGA/UPA/MODULAR. NO cambia el mecanismo de
// envío existente (el link wa.me se sigue armando igual en pages/admin.js):
// este endpoint solo registra abrir vs confirmar.
//
// GET  (?mes&anio) → { avisos: { [legajo]: {estado, abierto_en,
//        abierto_por_legajo, confirmado_en, confirmado_por_legajo,
//        publicacion_id} } } — del lugar de la sesión.
// POST { action, legajo, mes, anio }
//   'abrir'       — se hizo click en el link de wa.me (abrir ≠ enviar). No
//                    cambia el estado si ya estaba confirmado.
//   'confirmar'   — el administrador confirma EXPRESAMENTE que lo envió.
//                    Acción separada de 'abrir' a propósito (ver pedido:
//                    "abrir WhatsApp no equivale a enviar").
//   'desmarcar'   — corrección manual del administrador: vuelve a pendiente
//                    un aviso confirmado por error (análogo al
//                    "desmarcarNotificado" que ya existía, pero ahora
//                    persistente y registrado en el historial).
//
// Requiere que exista una publicación vigente para (lugar, mes, anio) —
// fn_whatsapp_sincronizar_tras_publicar (migración 0004) ya crea la fila de
// whatsapp_avisos para cada efectivo publicado en el momento de publicar;
// este endpoint solo actualiza una fila que ya debería existir. Si por
// alguna razón no existe (nunca se publicó ese período), se informa en vez
// de inventar un estado.

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
    const mes = parseInt(req.query.mes), anio = parseInt(req.query.anio)
    if (!mes || !anio) return res.status(400).json({ error: 'Faltan mes/anio' })
    const { data, error } = await supabase
      .from('whatsapp_avisos').select('*').eq('lugar', lugar).eq('mes', mes).eq('anio', anio)
    if (error) {
      if (/relation .*whatsapp_avisos.* does not exist/i.test(error.message || '')) {
        return res.status(500).json({ error: 'Falta aplicar la migración supabase/migrations/0004_reglas_individuales_y_avisos.sql en esta base (la tabla whatsapp_avisos todavía no existe).' })
      }
      return res.status(500).json({ error: error.message })
    }
    const avisos = {}
    ;(data || []).forEach(a => {
      avisos[a.legajo] = {
        estado: a.estado,
        abierto_en: a.abierto_en,
        abierto_por_legajo: a.abierto_por_legajo,
        confirmado_en: a.confirmado_en,
        confirmado_por_legajo: a.confirmado_por_legajo,
        publicacion_id: a.publicacion_id,
        // Corrección de esta ronda: se expone también el fingerprint
        // actual y el que se "fotografió" la última vez que se abrió el
        // link — así pages/admin.js puede mostrar, antes de que el
        // administrador intente confirmar, que el cronograma cambió desde
        // que se abrió el mensaje (en vez de que la única señal sea un
        // error recién al confirmar).
        fingerprint_turnos: a.fingerprint_turnos,
        fingerprint_en_apertura: a.fingerprint_en_apertura,
        cambio_desde_apertura: a.fingerprint_en_apertura == null || a.fingerprint_en_apertura !== a.fingerprint_turnos,
      }
    })
    return res.status(200).json({ avisos })
  }

  if (req.method !== 'POST') return res.status(405).end()

  try {
    const { action, legajo } = req.body || {}
    const mes = parseInt(req.body?.mes), anio = parseInt(req.body?.anio)
    if (!legajo || !mes || !anio) return res.status(400).json({ error: 'Faltan legajo/mes/anio' })
    if (!['abrir', 'confirmar', 'desmarcar'].includes(action)) {
      return res.status(400).json({ error: 'action inválida (esperaba abrir/confirmar/desmarcar)' })
    }

    // Corrección de esta ronda ("Confirmación de WhatsApp"): "abrir" y
    // "confirmar" ahora exigen que el cliente mande el fingerprint del
    // contenido que efectivamente preparó (mismo algoritmo que
    // fingerprint_turnos, calculado en el navegador sobre
    // turnosPublicadosPorLegajo — ver fingerprintTurnos en pages/admin.js).
    // Sin esto, "abrir" no tenía forma de saber si la pantalla que armó el
    // link de wa.me estaba desactualizada respecto del cronograma
    // VIGENTE del servidor — ver fn_whatsapp_marcar_abierto/
    // fn_whatsapp_confirmar_envio (supabase/migrations/
    // 0006_correcciones_ronda3.sql). Puede ser '' (cero guardias
    // publicadas), pero tiene que venir explícitamente — nunca se asume
    // "sin contenido" como válido por omisión.
    const fingerprintCliente = req.body?.fingerprint_cliente
    if ((action === 'abrir' || action === 'confirmar') && typeof fingerprintCliente !== 'string') {
      return res.status(400).json({ error: 'Falta fingerprint_cliente (el contenido exacto del mensaje preparado en la pantalla) — recargá la pantalla e intentá de nuevo.' })
    }

    const { data: filaActual, error: errSel } = await supabase
      .from('whatsapp_avisos').select('*').eq('legajo', legajo).eq('lugar', lugar).eq('mes', mes).eq('anio', anio).maybeSingle()
    if (errSel) {
      if (/relation .*whatsapp_avisos.* does not exist/i.test(errSel.message || '')) {
        return res.status(500).json({ error: 'Falta aplicar la migración supabase/migrations/0004_reglas_individuales_y_avisos.sql en esta base (la tabla whatsapp_avisos todavía no existe).' })
      }
      return res.status(500).json({ error: errSel.message })
    }

    if (!filaActual) {
      // No hay fila: normalmente la crea fn_whatsapp_sincronizar_tras_publicar
      // al publicar. Si no existe, es porque este período todavía no tiene
      // ninguna publicación vigente para este efectivo — no se inventa un
      // estado "confirmado" ni "pendiente" sin ese antecedente.
      return res.status(409).json({ error: 'Todavía no hay una publicación vigente de este período para este efectivo — publicá las guardias antes de registrar el aviso.' })
    }

    // Corrección de esta ronda: las tres acciones ahora son UNA sola
    // función SQL atómica cada una (fn_whatsapp_marcar_abierto /
    // fn_whatsapp_confirmar_envio / fn_whatsapp_desmarcar, supabase/
    // migrations/0005_correcciones_ronda_bugs.sql) en vez de un UPDATE (o,
    // en 'desmarcar', dos pasos) hechos directo desde acá. El cambio de
    // comportamiento real está en 'confirmar': fn_whatsapp_confirmar_envio
    // exige que lo último que se abrió (fingerprint_en_apertura) coincida
    // con el contenido publicado VIGENTE (fingerprint_turnos) — si las
    // guardias cambiaron después de abrir el mensaje, se rechaza la
    // confirmación de ESE mensaje viejo en vez de aceptarla ("no permitir
    // confirmar ese mensaje viejo como aviso del cronograma nuevo").
    function mapearErrorRpc(err, nombreFn) {
      const msg = err?.message || ''
      if (new RegExp('function .*' + nombreFn, 'i').test(msg)) {
        // fn_whatsapp_marcar_abierto y fn_whatsapp_confirmar_envio cambiaron
        // de firma en 0006 (reciben el fingerprint del cliente) — las
        // demás siguen viviendo en 0005.
        const migracion = (nombreFn === 'fn_whatsapp_marcar_abierto' || nombreFn === 'fn_whatsapp_confirmar_envio')
          ? '0006_correcciones_ronda3.sql'
          : '0005_correcciones_ronda_bugs.sql'
        return { status: 500, body: { error: `Falta aplicar la migración supabase/migrations/${migracion} en esta base (la función ${nombreFn} todavía no existe con la firma esperada).` } }
      }
      if (msg.includes('no_existe_aviso')) {
        return { status: 409, body: { error: 'Todavía no hay una publicación vigente de este período para este efectivo — publicá las guardias antes de registrar el aviso.' } }
      }
      if (msg.includes('contenido_cambio_desde_apertura')) {
        return { status: 409, body: {
          error: 'El cronograma publicado para este efectivo cambió desde la última vez que se abrió el mensaje de WhatsApp (o todavía no se abrió con el contenido actual), o el mensaje que se está confirmando no es el vigente. Volvé a abrir el mensaje con el cronograma vigente antes de confirmar el envío — nunca se confirma un mensaje viejo o distinto como aviso del cronograma actual.',
          contenido_desactualizado: true,
        } }
      }
      // Corrección de esta ronda: "abrir" también puede rechazarse si el
      // fingerprint que mandó el cliente (el contenido que la pantalla
      // efectivamente preparó) no coincide con el vigente del servidor —
      // la pantalla está desactualizada, hay que recargarla antes de
      // reintentar abrir el mensaje.
      if (msg.includes('contenido_desactualizado')) {
        return { status: 409, body: {
          error: 'El mensaje que se preparó en esta pantalla no coincide con el cronograma publicado vigente (cambió desde que se cargó la pantalla). Recargá la pantalla de Personal antes de volver a abrir el mensaje de WhatsApp — nunca se registra un contenido nuevo como comunicado mediante un mensaje viejo.',
          contenido_desactualizado: true,
        } }
      }
      return { status: 500, body: { error: err.message } }
    }

    if (action === 'abrir') {
      const { data: fila, error } = await supabase.rpc('fn_whatsapp_marcar_abierto', {
        p_legajo: legajo, p_lugar: lugar, p_mes: mes, p_anio: anio,
        p_fingerprint_cliente: fingerprintCliente, p_actor_legajo: sesion.legajo,
      })
      if (error) { const m = mapearErrorRpc(error, 'fn_whatsapp_marcar_abierto'); return res.status(m.status).json(m.body) }
      // Si ya estaba confirmado, fn_whatsapp_marcar_abierto no cambia nada
      // (mismo comportamiento que antes) — se informa igual que antes.
      return res.status(200).json({ ok: true, sin_cambios: fila?.estado === 'confirmado' && filaActual.estado === 'confirmado' })
    }

    if (action === 'confirmar') {
      const { error } = await supabase.rpc('fn_whatsapp_confirmar_envio', {
        p_legajo: legajo, p_lugar: lugar, p_mes: mes, p_anio: anio,
        p_fingerprint_cliente: fingerprintCliente, p_actor_legajo: sesion.legajo,
      })
      if (error) { const m = mapearErrorRpc(error, 'fn_whatsapp_confirmar_envio'); return res.status(m.status).json(m.body) }
      return res.status(200).json({ ok: true })
    }

    if (action === 'desmarcar') {
      const { error } = await supabase.rpc('fn_whatsapp_desmarcar', {
        p_legajo: legajo, p_lugar: lugar, p_mes: mes, p_anio: anio, p_actor_legajo: sesion.legajo,
      })
      if (error) { const m = mapearErrorRpc(error, 'fn_whatsapp_desmarcar'); return res.status(m.status).json(m.body) }
      return res.status(200).json({ ok: true })
    }
  } catch (err) {
    console.error('[whatsapp-avisos] Error:', err)
    return res.status(500).json({ error: err.message })
  }
}
