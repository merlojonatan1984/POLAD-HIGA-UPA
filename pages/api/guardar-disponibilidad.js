// pages/api/guardar-disponibilidad.js
//
// Guarda la disponibilidad del PROPIO efectivo (identificado por su sesión
// verificada, nunca por un legajo que mande el cliente). Antes, EfectivoApp.js
// escribía directo a Supabase desde el navegador con la clave anon, sin
// ningún control de ventana del lado del servidor: aunque el botón apareciera
// deshabilitado en pantalla, nada impedía mandar el pedido igual. Ahora la
// ventana de inscripción se vuelve a verificar acá, en el servidor, en hora
// de Argentina (ver lib/tiempoArgentina.js) antes de guardar nada.
//
// El guardado en sí se hace con una función de base de datos transaccional
// (fn_guardar_disponibilidad_efectivo — ver supabase/migrations/0001), que
// también valida que cada día exista en ese mes/año y que el turno sea uno
// de los permitidos para ese lugar. Si la migración todavía no se aplicó en
// este entorno, este endpoint lo informa con claridad y NO guarda nada con
// un camino alternativo: no hay un "modo degradado" que modifique datos sin
// las mismas garantías.
//
// Nunca toca la tabla turnos (ni para borrar ni para modificar guardias ya
// asignadas) — solo escribe en disponibilidad.

import { createClient } from '@supabase/supabase-js'
import { requireEfectivoSession } from '../../lib/authServer'
const { estaVentanaAbierta } = require('../../lib/tiempoArgentina')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export default async function handler(req, res) {
  const sesion = requireEfectivoSession(req, res)
  if (!sesion) return
  const { lugar, legajo } = sesion

  if (req.method === 'GET') {
    const MES = parseInt(req.query.mes), ANIO = parseInt(req.query.anio)
    if (!MES || !ANIO) return res.status(400).json({ error: 'Faltan mes/anio' })
    const { data, error } = await supabase
      .from('disponibilidad').select('dia, turno')
      .eq('legajo', legajo).eq('lugar', lugar).eq('mes', MES).eq('anio', ANIO)
    if (error) return res.status(500).json({ error: error.message })
    const dias = {}
    ;(data || []).forEach(d => { dias[d.dia] = d.turno })
    return res.status(200).json({ dias })
  }

  if (req.method !== 'POST') return res.status(405).end()
  // Un administrador que use este mismo endpoint (no debería desde la UI,
  // pero por las dudas) queda igual sujeto a la ventana: la carga fuera de
  // término tiene su propio endpoint (admin-disponibilidad-override.js),
  // que SÍ puede pasar por alto la ventana, dejando registro de auditoría.

  const { mes, anio, dias, dias_antes_esperado } = req.body || {}
  const MES = parseInt(mes), ANIO = parseInt(anio)
  if (!MES || !ANIO || typeof dias !== 'object' || dias === null) {
    return res.status(400).json({ error: 'Datos inválidos' })
  }
  // Punto 3 de la revisión: este guardado (el del propio efectivo) no tenía
  // ningún control de concurrencia — ni siquiera comparaba contra lo que la
  // pantalla mostró al abrirse. Ahora es obligatorio mandar exactamente eso
  // (el mapa {dia:turno} que devolvió el GET de este mismo endpoint, o {} si
  // no había nada cargado): sin esto no se guarda nada, no hay forma de
  // omitirlo desde el cliente.
  if (dias_antes_esperado === undefined || dias_antes_esperado === null || typeof dias_antes_esperado !== 'object') {
    return res.status(400).json({ error: 'Falta dias_antes_esperado (tiene que ser exactamente lo que devolvió el GET de este endpoint antes de editar, o {} si no había nada cargado).' })
  }

  const { data: cfg, error: errCfg } = await supabase
    .from('configuracion').select('*').eq('lugar', lugar).maybeSingle()
  if (errCfg) return res.status(500).json({ error: errCfg.message })

  if (!estaVentanaAbierta(cfg)) {
    return res.status(403).json({ error: 'La ventana de inscripción está cerrada (o no fue configurada todavía para este período). No se puede modificar la disponibilidad en este momento.' })
  }
  // Si el admin fijó un mes/año de carga específico en configuracion, solo
  // se permite guardar para ESE mes/año (igual criterio que ya aplicaba
  // EfectivoApp.js al fijar `mes`/`anio` desde cfg al cargar la pantalla).
  if (cfg?.mes && cfg?.anio && (cfg.mes !== MES || cfg.anio !== ANIO)) {
    return res.status(403).json({ error: 'No corresponde cargar disponibilidad para ese mes/año en este momento.' })
  }

  const diasNuevosLimpios = {}
  Object.entries(dias).forEach(([dia, turno]) => {
    if (turno) diasNuevosLimpios[String(parseInt(dia))] = turno
  })

  const { error: rpcError } = await supabase.rpc('fn_guardar_disponibilidad_efectivo', {
    p_legajo: legajo,
    p_lugar: lugar,
    p_mes: MES,
    p_anio: ANIO,
    p_dias: diasNuevosLimpios,
    p_dias_antes_esperado: dias_antes_esperado,
  })

  if (rpcError) {
    if (/function .*fn_guardar_disponibilidad_efectivo/i.test(rpcError.message || '')) {
      return res.status(500).json({
        error: 'No se pudo guardar: falta aplicar la migración supabase/migrations/0001_borrador_publicacion.sql en esta base (la función fn_guardar_disponibilidad_efectivo todavía no existe). No se modificó ningún dato — tu disponibilidad anterior sigue como estaba.'
      })
    }
    if ((rpcError.message || '').includes('disponibilidad_desactualizada')) {
      // Otra carga (propia, en otra pestaña, o una corrección administrativa
      // fuera de término) cambió esta disponibilidad entre que se abrió la
      // pantalla y que se confirmó el guardado. No se guardó nada — se
      // devuelve el estado real actual para que se recargue antes de
      // reintentar, en vez de pisarlo en silencio.
      const { data: dispActual } = await supabase
        .from('disponibilidad').select('dia, turno').eq('legajo', legajo).eq('lugar', lugar).eq('mes', MES).eq('anio', ANIO)
      const diasActuales = {}
      ;(dispActual || []).forEach(d => { diasActuales[d.dia] = d.turno })
      return res.status(409).json({
        error: 'Tu disponibilidad cambió desde que abriste esta pantalla (quizás la guardaste en otra pestaña, o un administrador la corrigió). No se guardó nada — recargá antes de volver a intentar.',
        conflicto: true,
        dias_actuales: diasActuales,
      })
    }
    if (/dia_invalido|turno_invalido|lugar_invalido/.test(rpcError.message || '')) {
      return res.status(400).json({ error: 'Datos inválidos: ' + rpcError.message })
    }
    return res.status(500).json({ error: 'Error al guardar: ' + rpcError.message })
  }

  return res.status(200).json({ ok: true })
}
