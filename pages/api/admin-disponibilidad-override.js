// pages/api/admin-disponibilidad-override.js
//
// Carga/consulta/corrección de disponibilidad de UN efectivo puntual, hecha
// por un administrador, fuera de la ventana de inscripción, SIN reabrir la
// inscripción general (que seguiría afectando a todos los demás efectivos).
//
// GET  → trae la disponibilidad actual de ese efectivo/lugar/mes/año, más
//        las guardias (turnos) ya asignadas en ese período PARA ESE LUGAR,
//        para que la pantalla pueda mostrar advertencias ANTES de guardar
//        si lo nuevo contradice una guardia ya asignada.
// POST → guarda, de forma atómica (todo o nada), reemplazando SOLO la
//        disponibilidad de ese efectivo/lugar/mes/año, usando la función de
//        base de datos fn_guardar_disponibilidad_admin (ver migración
//        0001). Esa función hace, en una sola transacción: valida días y
//        turnos, comprueba bajo un lock que nadie más modificó la
//        disponibilidad desde que este administrador la abrió (control de
//        concurrencia DENTRO de la transacción, no antes), reemplaza las
//        filas, y deja la auditoría — todo o nada. Si la función no está
//        desplegada todavía (falta aplicar la migración), este endpoint lo
//        informa con un error claro y NO modifica ningún dato: no existe
//        un camino alternativo que escriba sin esas garantías.
//
//        Nunca toca la tabla turnos: si hay guardias que quedan en
//        contradicción con la nueva disponibilidad, se devuelven como
//        advertencia pero NO se borran ni se reasignan solas — las
//        conserva hasta que el encargado decida qué hacer manualmente.
//
// Requiere sesión de administrador verificada por el servidor.

import { createClient } from '@supabase/supabase-js'
import { requireAdminSession } from '../../lib/authServer'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Mismo mapeo que pages/admin.js y pages/api/publicar-guardias.js: a qué
// lugar pertenece cada sector. Las guardias de turnos NO tienen una columna
// "lugar" propia (se deriva del sector), así que al buscar "¿qué guardias
// ya tiene asignadas este efectivo" hay que filtrar por los sectores DE ESE
// LUGAR — si no, un legajo que trabaja en más de un lugar (ocurre: HIGA,
// UPA y MODULAR comparten la misma base) recibía advertencias sobre
// guardias de un destino distinto al que se está editando.
const SECTORES_POR_LUGAR = {
  HIGA: ['Salud Mental', 'Giratoria', 'Llaves', 'Guardia', 'Estacionamiento', 'Rondin Externo'],
  UPA: ['UPA'],
  MODULAR: ['Modular'],
}

function calcularAdvertencias(turnosAsignados, diasNuevos) {
  // Para cada guardia ya asignada (en ESTE lugar), si el día ya no figura
  // disponible (o no incluye ese turno específico) en la disponibilidad
  // nueva, es una contradicción a advertir — pero la guardia NO se toca.
  const advertencias = []
  for (const t of turnosAsignados) {
    const disponibleEseDia = diasNuevos[String(t.dia)] || ''
    if (!disponibleEseDia.includes(t.turno)) {
      advertencias.push({
        dia: t.dia, turno: t.turno, sector: t.sector,
        detalle: `Ya tiene una guardia asignada el día ${t.dia} (turno "${t.turno}", sector ${t.sector}) que la nueva disponibilidad cargada no cubre. La guardia NO se modifica ni se borra — se conserva hasta que el encargado decida qué hacer.`
      })
    }
  }
  return advertencias
}

export default async function handler(req, res) {
  const sesion = requireAdminSession(req, res)
  if (!sesion) return

  if (req.method === 'GET') {
    const { legajo, lugar, mes, anio } = req.query
    const MES = parseInt(mes), ANIO = parseInt(anio)
    if (!legajo || !lugar || !MES || !ANIO) return res.status(400).json({ error: 'Faltan parámetros' })
    const sectores = SECTORES_POR_LUGAR[lugar]
    if (!sectores) return res.status(400).json({ error: 'Lugar inválido' })

    const [{ data: efectivo, error: errEf }, { data: disp, error: errDisp }, { data: turnosAsignados, error: errTurnos }] = await Promise.all([
      supabase.from('efectivos').select('legajo, nombre, lugar').eq('legajo', legajo).eq('lugar', lugar).maybeSingle(),
      supabase.from('disponibilidad').select('dia, turno, cargado_por_legajo, cargado_en, origen').eq('legajo', legajo).eq('lugar', lugar).eq('mes', MES).eq('anio', ANIO),
      supabase.from('turnos').select('dia, turno, sector').eq('legajo', legajo).eq('mes', MES).eq('anio', ANIO).in('sector', sectores),
    ])
    if (errEf) return res.status(500).json({ error: errEf.message })
    if (errDisp) return res.status(500).json({ error: errDisp.message })
    if (errTurnos) return res.status(500).json({ error: errTurnos.message })

    if (!efectivo) return res.status(404).json({ error: `No se encontró el legajo ${legajo} en ${lugar}.` })

    const diasActuales = {}
    ;(disp || []).forEach(d => { diasActuales[d.dia] = d.turno })

    return res.status(200).json({
      efectivo,
      dias_actuales: diasActuales,
      turnos_asignados: turnosAsignados || [],
      meta_filas: disp || []
    })
  }

  if (req.method === 'POST') {
    const { legajo, lugar, mes, anio, dias, motivo, confirmar, dias_antes_esperado } = req.body || {}
    const MES = parseInt(mes), ANIO = parseInt(anio)
    if (!legajo || !lugar || !MES || !ANIO || typeof dias !== 'object' || dias === null) {
      return res.status(400).json({ error: 'Datos inválidos' })
    }
    if (!confirmar) {
      return res.status(400).json({ error: 'Falta la confirmación explícita antes de guardar (confirmar:true).' })
    }
    const sectores = SECTORES_POR_LUGAR[lugar]
    if (!sectores) return res.status(400).json({ error: 'Lugar inválido' })

    try {
      const { data: efectivo, error: errEf } = await supabase
        .from('efectivos').select('legajo').eq('legajo', legajo).eq('lugar', lugar).maybeSingle()
      if (errEf) return res.status(500).json({ error: errEf.message })
      if (!efectivo) return res.status(404).json({ error: `No se encontró el legajo ${legajo} en ${lugar}.` })

      // Las advertencias se recalculan acá (solo son informativas para la
      // respuesta; no afectan si se guarda o no). El filtro por sectores
      // de ESTE lugar es lo que corrige el error de la entrega anterior.
      const { data: turnosAsignados, error: errTurnos } = await supabase
        .from('turnos').select('dia, turno, sector').eq('legajo', legajo).eq('mes', MES).eq('anio', ANIO).in('sector', sectores)
      if (errTurnos) return res.status(500).json({ error: errTurnos.message })

      const diasNuevosLimpios = {}
      Object.entries(dias).forEach(([dia, turno]) => {
        if (turno) diasNuevosLimpios[String(parseInt(dia))] = turno
      })

      const advertencias = calcularAdvertencias(turnosAsignados || [], diasNuevosLimpios)

      // dias_antes_esperado: el mapa {dia: turno} (o {} si no había nada
      // cargado) que el administrador vio al abrir el formulario. La
      // función de base de datos compara esto, BAJO UN LOCK y dentro de la
      // misma transacción que escribe, contra lo que hay guardado AHORA —
      // así no queda ninguna ventana de carrera entre leer y escribir en la
      // que otro administrador pudiera guardar algo distinto sin que se
      // note.
      const { data: auditoriaId, error: rpcError } = await supabase.rpc('fn_guardar_disponibilidad_admin', {
        p_legajo: legajo,
        p_lugar: lugar,
        p_mes: MES,
        p_anio: ANIO,
        p_dias: diasNuevosLimpios,
        p_modificado_por_legajo: sesion.legajo,
        p_motivo: motivo || null,
        p_dias_antes_esperado: dias_antes_esperado === undefined ? null : dias_antes_esperado,
        p_advertencias: advertencias,
      })

      if (rpcError) {
        if (/function .*fn_guardar_disponibilidad_admin/i.test(rpcError.message || '')) {
          // No hay camino alternativo: si la función no está desplegada,
          // no se modifica NADA, y se informa con claridad qué falta.
          return res.status(500).json({
            error: 'No se pudo guardar: falta aplicar la migración supabase/migrations/0001_borrador_publicacion.sql en esta base (la función fn_guardar_disponibilidad_admin todavía no existe). No se modificó ningún dato.'
          })
        }
        if ((rpcError.message || '').includes('disponibilidad_desactualizada')) {
          // Alguien más (probablemente otro administrador) modificó esta
          // disponibilidad entre que se abrió el formulario y que se
          // confirmó. No se guardó nada — se devuelve el estado actual real
          // para que el encargado lo revise antes de reintentar.
          const { data: dispActual } = await supabase
            .from('disponibilidad').select('dia, turno').eq('legajo', legajo).eq('lugar', lugar).eq('mes', MES).eq('anio', ANIO)
          const diasActuales = {}
          ;(dispActual || []).forEach(d => { diasActuales[d.dia] = d.turno })
          return res.status(409).json({
            error: 'La disponibilidad de este efectivo cambió desde que abriste este formulario (probablemente otro administrador la modificó). No se guardó nada — revisá el estado actual antes de reintentar.',
            conflicto: true,
            dias_actuales: diasActuales,
          })
        }
        if (/dia_invalido|turno_invalido|lugar_invalido|legajo_invalido/.test(rpcError.message || '')) {
          return res.status(400).json({ error: 'Datos inválidos: ' + rpcError.message })
        }
        return res.status(500).json({ error: 'Error al guardar: ' + rpcError.message })
      }

      return res.status(200).json({ ok: true, auditoria_id: auditoriaId, advertencias, atomico: true })

    } catch (err) {
      console.error('[admin-disponibilidad-override] Error:', err)
      return res.status(500).json({ error: err.message })
    }
  }

  return res.status(405).end()
}
