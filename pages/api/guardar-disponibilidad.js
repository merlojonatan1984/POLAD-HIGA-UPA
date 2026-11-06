// pages/api/guardar-disponibilidad.js
//
// NUEVO. Hasta ahora la pantalla del efectivo guardaba la disponibilidad
// directo en la base, y el control de apertura/cierre existía solo en la
// pantalla (los botones se deshabilitaban). Ahora el guardado pasa por acá:
// el servidor comprueba, con su propio reloj (hora de Argentina), que:
//   1) la persona existe (su ficha no fue dada de baja) y su clave es la
//      correcta,
//   2) hay una ventana configurada para su lugar,
//   3) este momento cae dentro de esa ventana (día, hora de inicio y fin),
//   4) el mes y año a guardar son los que el administrador habilitó.
// Si algo de eso falla, no se guarda nada.

import { createClient } from '@supabase/supabase-js'
import { ventanaAbierta } from '../../lib/ventanaCarga'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const LUGARES = ['HIGA', 'UPA', 'MODULAR']
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' })

  const { legajo, id, password, lugar, mes, anio, disponibilidad } = req.body || {}
  const MES = parseInt(mes, 10)
  const ANIO = parseInt(anio, 10)

  if (!legajo || !id || typeof password !== 'string' || !LUGARES.includes(lugar) ||
      !Number.isInteger(MES) || MES < 1 || MES > 12 || !Number.isInteger(ANIO) ||
      !disponibilidad || typeof disponibilidad !== 'object' || Array.isArray(disponibilidad)) {
    return res.status(400).json({ error: 'Datos incompletos.' })
  }

  // Cada día con su turno, validado
  const diasMes = new Date(ANIO, MES, 0).getDate()
  const patron = lugar === 'MODULAR' ? /^m?t?n?$/ : /^(d|n|dn)$/
  const filas = []
  for (const [diaTxt, turno] of Object.entries(disponibilidad)) {
    const dia = Number(diaTxt)
    if (!Number.isInteger(dia) || dia < 1 || dia > diasMes ||
        typeof turno !== 'string' || turno === '' || !patron.test(turno)) {
      return res.status(400).json({ error: 'La disponibilidad enviada no es válida.' })
    }
    filas.push({ dia, turno })
  }

  try {
    // 1) La persona existe, no es una ficha dada de baja y la clave coincide
    const { data: ef, error: errEf } = await supabase
      .from('efectivos')
      .select('id, legajo, password, es_admin')
      .eq('legajo', String(legajo).trim())
      .eq('lugar', lugar)
      .maybeSingle()
    if (errEf) return res.status(500).json({ error: 'No se pudo verificar tu usuario. Probá de nuevo.' })
    if (!ef || String(ef.id) !== String(id)) {
      return res.status(401).json({ codigo: 'baja', error: 'Tu usuario ya no está activo. Consultá con el encargado.' })
    }
    if (ef.es_admin) return res.status(403).json({ error: 'Los administradores no cargan disponibilidad desde acá.' })
    const claveEsperada = ef.password || ef.legajo
    if (password !== claveEsperada) {
      return res.status(401).json({ codigo: 'clave', error: 'Tu sesión quedó desactualizada. Salí y volvé a entrar.' })
    }

    // 2) Ventana configurada para este lugar
    const { data: cfg, error: errCfg } = await supabase
      .from('configuracion').select('*').eq('lugar', lugar).maybeSingle()
    if (errCfg) return res.status(500).json({ error: 'No se pudo verificar el horario. Probá de nuevo.' })
    if (!cfg || !cfg.dia) {
      return res.status(403).json({ codigo: 'cerrado', error: 'La carga de disponibilidad está cerrada.' })
    }

    // 3) Este momento tiene que caer dentro de la ventana (reloj del servidor, hora de Argentina)
    if (!ventanaAbierta(cfg)) {
      return res.status(403).json({ codigo: 'cerrado', error: 'La carga de disponibilidad está cerrada en este momento.' })
    }

    // 4) Solo el mes y año habilitados por el administrador
    if (!cfg.mes || !cfg.anio || parseInt(cfg.mes, 10) !== MES || parseInt(cfg.anio, 10) !== ANIO) {
      return res.status(403).json({ codigo: 'mes', error: 'Ese mes no está habilitado para cargar disponibilidad.' })
    }

    // Guardado: se reemplaza lo anterior de esta persona en ese mes y lugar.
    // Si algo falla a mitad de camino, se restituye lo que había.
    const { data: previas, error: errPrev } = await supabase
      .from('disponibilidad')
      .select('legajo, dia, turno, mes, anio, lugar')
      .eq('legajo', ef.legajo).eq('mes', MES).eq('anio', ANIO).eq('lugar', lugar)
    if (errPrev) return res.status(500).json({ error: 'No se pudo guardar. Probá de nuevo.' })

    const { error: errDel } = await supabase
      .from('disponibilidad').delete()
      .eq('legajo', ef.legajo).eq('mes', MES).eq('anio', ANIO).eq('lugar', lugar)
    if (errDel) return res.status(500).json({ error: 'No se pudo guardar. Probá de nuevo.' })

    if (filas.length > 0) {
      const inserts = filas.map(f => ({ legajo: ef.legajo, dia: f.dia, turno: f.turno, mes: MES, anio: ANIO, lugar }))
      const { error: errIns } = await supabase.from('disponibilidad').insert(inserts)
      if (errIns) {
        if ((previas || []).length > 0) await supabase.from('disponibilidad').insert(previas)
        return res.status(500).json({ error: 'No se pudo guardar. Se mantuvo lo que tenías cargado.' })
      }
    }

    return res.status(200).json({ ok: true, guardados: filas.length })
  } catch (e) {
    console.error('[guardar-disponibilidad]', e)
    return res.status(500).json({ error: 'No se pudo guardar. Probá de nuevo.' })
  }
}
