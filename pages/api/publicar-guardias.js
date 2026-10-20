// pages/api/publicar-guardias.js
//
// Publicar guardias = tomar una "foto" del borrador actual (tabla turnos,
// filtrado por lugar/mes/año) y guardarla en turnos_publicados como una
// versión nueva, vigente. Es la única forma en la que los cambios del
// administrador pasan a ser visibles para los efectivos (ver
// pages/api/mis-guardias.js). Nunca modifica la tabla turnos.
//
// GET  (?mes&anio) → "preview": calcula, de un ÚNICO estado consistente
//        (ver fn_resumen_publicacion en la migración 0001), el resumen y la
//        diferencia contra la última publicación vigente (si existe), sin
//        escribir nada. Devuelve, además, version_base y hash_borrador: una
//        "foto" de qué versión estaba vigente y cómo estaba el borrador en
//        el momento de generar este resumen. El administrador revisa este
//        resumen y, si confirma, el POST tiene que devolver EXACTAMENTE
//        esos dos valores.
//
//        Punto 1 de esta ronda de revisión: antes este preview se calculaba
//        con varias consultas Supabase SEPARADAS desde este archivo (leer
//        turnos, después la publicación vigente, después turnos_publicados,
//        y recién al final pedir el hash con una llamada RPC aparte) — sin
//        ningún lock, el borrador podía cambiar entre una consulta y la
//        siguiente, y el administrador podía terminar viendo un resumen de
//        un estado con el hash de otro. Ahora todo eso es UNA sola llamada
//        a fn_resumen_publicacion, que toma el mismo lock que usan la
//        publicación y las escrituras del borrador (fn_lock_turnos_borrador)
//        antes de leer nada — así resumen, versión vigente y hash salen
//        siempre del mismo estado, y ninguna escritura del borrador puede
//        intercalarse mientras se calculan.
// POST ({mes, anio, confirmar:true, version_base, hash_borrador}) →
//        publica de verdad, de forma atómica, usando la función
//        fn_publicar_guardias (ver migración 0001) — que internamente usa
//        esa MISMA fn_resumen_publicacion para su propia verificación, así
//        que preview y publicación comparten exactamente el mismo cálculo.
//        Esa función vuelve a comprobar, dentro de la misma transacción y
//        bajo el mismo lock, que la versión vigente y el borrador siguen
//        siendo los que version_base/hash_borrador describen: si alguien
//        publicó mientras tanto, si el borrador cambió, o si esto es un
//        reintento o un doble clic de una publicación que ya se hizo,
//        rechaza en vez de publicar — así se publica EXACTAMENTE el estado
//        revisado, o se rechaza por desactualización, nunca algo intermedio.
//
// Requiere sesión de administrador. El "lugar" SIEMPRE es el de la sesión
// (sesion.lugar) — punto 4 de esta ronda: antes este endpoint aceptaba un
// "lugar" mandado por el cliente (query/body) sin contrastarlo contra la
// sesión, así que un administrador de un lugar podía pedir el preview o
// publicar las guardias de OTRO lugar con solo cambiar ese parámetro. No
// existe ningún rol de administrador "global" en este proyecto (cada sesión
// de administrador tiene un único lugar — ver lib/authServer.js y la fila
// de efectivos con la que se logueó); si en el futuro se necesitara un
// permiso de ese tipo, tendría que ser una decisión explícita y nueva, no
// algo que se deduzca de un parámetro del cliente.

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

function mapearErrorPreview(mensaje) {
  const m = mensaje || ''
  if (/function .*fn_resumen_publicacion/i.test(m)) {
    return 'No se pudo calcular el resumen: falta aplicar la migración supabase/migrations/0001_borrador_publicacion.sql en esta base (la función fn_resumen_publicacion todavía no existe).'
  }
  return 'Error al calcular el resumen: ' + m
}

export default async function handler(req, res) {
  const sesion = requireAdminSession(req, res)
  if (!sesion) return

  const lugar = sesion.lugar
  const mes = parseInt(req.method === 'GET' ? req.query.mes : req.body?.mes)
  const anio = parseInt(req.method === 'GET' ? req.query.anio : req.body?.anio)
  const sectores = SECTORES_POR_LUGAR[lugar]
  if (!sectores || !mes || !anio) return res.status(400).json({ error: 'Faltan/son inválidos mes o anio' })

  if (req.method === 'GET') {
    try {
      const { data: rpcResult, error: rpcError } = await supabase.rpc('fn_resumen_publicacion', {
        p_lugar: lugar, p_mes: mes, p_anio: anio, p_sectores: sectores,
      })
      if (rpcError) return res.status(500).json({ error: mapearErrorPreview(rpcError.message) })
      const fila = Array.isArray(rpcResult) ? rpcResult[0] : rpcResult
      // Se aplana la respuesta (resumen + efectivos_afectados + version_base
      // + hash_borrador en un solo objeto) para no cambiar el formato que ya
      // consume pages/admin.js — mismos nombres de campo que antes.
      return res.status(200).json({
        ...(fila?.resumen || {}),
        efectivos_afectados: fila?.efectivos_afectados || [],
        version_base: fila?.version_base ?? 0,
        hash_borrador: fila?.hash_borrador,
      })
    } catch (err) {
      return res.status(500).json({ error: err.message })
    }
  }

  if (req.method === 'POST') {
    const { confirmar, version_base, hash_borrador } = req.body || {}
    if (!confirmar) {
      return res.status(400).json({ error: 'Falta la confirmación explícita antes de publicar (confirmar:true).' })
    }
    if (hash_borrador === undefined || hash_borrador === null) {
      return res.status(400).json({ error: 'Falta hash_borrador (tiene que ser exactamente el que devolvió el preview que se está confirmando).' })
    }
    try {
      // Corrección de esta ronda ("Coordinar publicación y actualización de
      // avisos para que un fallo no deje confirmado un cronograma
      // desactualizado"): antes, fn_publicar_guardias y
      // fn_whatsapp_sincronizar_tras_publicar se llamaban por separado, "a
      // propósito nunca en la misma transacción" — si la sincronización
      // fallaba, la publicación YA confirmada no se revertía, y quedaba
      // solo una advertencia aparte (aviso_whatsapp_sync_warning). Eso es
      // exactamente lo que podía dejar un aviso "confirmado" apuntando a un
      // cronograma viejo si la sincronización que debía resetearlo no
      // llegaba a correr. Ahora se llama a una sola función que hace las
      // dos cosas EN LA MISMA transacción (fn_publicar_guardias_y_
      // sincronizar_whatsapp, supabase/migrations/0005_correcciones_ronda_bugs.sql,
      // que internamente llama a fn_publicar_guardias sin modificarla): si
      // la sincronización falla, la publicación también se revierte — nunca
      // queda una publicación confirmada con avisos desactualizados o sin
      // sincronizar. Por eso ya no existe un "avisoSyncWarning": un fallo
      // acá es, directamente, un fallo de publicación.
      const { data: rpcResult, error: rpcError } = await supabase.rpc('fn_publicar_guardias_y_sincronizar_whatsapp', {
        p_lugar: lugar,
        p_mes: mes,
        p_anio: anio,
        p_sectores: sectores,
        p_publicado_por_legajo: sesion.legajo,
        p_version_base: version_base ?? 0,
        p_hash_borrador: hash_borrador,
      })

      if (rpcError) {
        if (/function .*fn_publicar_guardias_y_sincronizar_whatsapp/i.test(rpcError.message || '')) {
          return res.status(500).json({
            error: 'No se pudo publicar: falta aplicar la migración supabase/migrations/0005_correcciones_ronda_bugs.sql en esta base (la función fn_publicar_guardias_y_sincronizar_whatsapp todavía no existe). No se publicó nada.'
          })
        }
        if (/function .*fn_publicar_guardias\(/i.test(rpcError.message || '')) {
          return res.status(500).json({
            error: 'No se pudo publicar: falta aplicar la migración supabase/migrations/0001_borrador_publicacion.sql en esta base (la función fn_publicar_guardias todavía no existe). No se publicó nada.'
          })
        }
        if ((rpcError.message || '').includes('publicacion_desactualizada')) {
          return res.status(409).json({
            error: 'Alguien publicó una versión nueva (o esto es un reintento de una publicación que ya se hizo) desde que se generó este resumen. No se publicó de nuevo — volvé a abrir "Publicar guardias" para revisar el estado actual.',
            desactualizado: true,
          })
        }
        if ((rpcError.message || '').includes('borrador_desactualizado')) {
          return res.status(409).json({
            error: 'El borrador (las guardias en preparación) cambió desde que se generó este resumen. No se publicó nada — volvé a abrir "Publicar guardias" para revisar los cambios actuales antes de confirmar.',
            desactualizado: true,
          })
        }
        // Cualquier otro error (incluido uno de la sincronización de
        // WhatsApp) revierte TODA la transacción — no se publicó nada.
        return res.status(500).json({ error: 'Error al publicar: ' + rpcError.message + ' — no se publicó nada (se revirtió toda la operación, incluida la sincronización de avisos de WhatsApp).' })
      }

      const fila = Array.isArray(rpcResult) ? rpcResult[0] : rpcResult

      // resumen y efectivos_afectados vienen YA calculados, correctos y
      // atómicos, directo de la función — no hay nada más que recalcular
      // ni volver a consultar.
      return res.status(200).json({
        ok: true,
        publicacion_id: fila?.publicacion_id,
        version: fila?.version,
        resumen: fila?.resumen,
        efectivos_afectados: fila?.efectivos_afectados || [],
      })
    } catch (err) {
      console.error('[publicar-guardias] Error:', err)
      return res.status(500).json({ error: err.message })
    }
  }

  return res.status(405).end()
}
