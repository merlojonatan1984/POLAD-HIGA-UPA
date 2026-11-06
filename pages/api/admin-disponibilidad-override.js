// pages/api/admin-disponibilidad-override.js
//
// Disponibilidad "fuera de término": el administrador carga o corrige la
// disponibilidad de UNA persona, aunque la ventana de carga esté cerrada.
// No reabre la carga general y no toca la tabla de turnos (las guardias ya
// asignadas nunca se borran ni se mueven: si quedan en contradicción con lo
// nuevo, solo se avisa).
//
// GET  → disponibilidad actual de esa persona en ese lugar/mes/año, y las
//        guardias que ya tiene asignadas ahí.
// POST → reemplaza SOLO la disponibilidad de esa persona en ese lugar/mes/año.
//        Si otro administrador la cambió mientras tanto, no guarda (409).
//        Si algo falla a mitad de camino, vuelve a dejar lo que había.
//
// Pide el mismo token de administrador que usa el resto del panel.

import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const SECTORES_POR_LUGAR = {
  HIGA: ['Salud Mental', 'Giratoria', 'Llaves', 'Guardia', 'Estacionamiento', 'Rondin Externo'],
  UPA: ['UPA'],
  MODULAR: ['Modular'],
}

function verificarToken(token) {
  if (!token || typeof token !== 'string') return null
  const partes = token.split(':')
  if (partes.length !== 3) return null
  const [legajo, venceStr, firma] = partes
  const vence = parseInt(venceStr, 10)
  if (!Number.isFinite(vence) || Date.now() > vence) return null
  const secreto = process.env.AUTH_SESSION_SECRET
  if (!secreto) return null
  try {
    const esperada = crypto.createHmac('sha256', secreto).update(`${legajo}:${venceStr}`).digest('hex')
    const a = Buffer.from(firma, 'hex')
    const b = Buffer.from(esperada, 'hex')
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null
    return { legajo }
  } catch (e) {
    return null
  }
}

async function esAdmin(legajo) {
  const { data, error } = await supabase
    .from('efectivos').select('legajo').eq('legajo', legajo).eq('es_admin', true).limit(1)
  return !error && Array.isArray(data) && data.length > 0
}

function mapaDias(filas) {
  const m = {}
  ;(filas || []).forEach(f => { m[String(f.dia)] = f.turno })
  return m
}

function iguales(a, b) {
  const ka = Object.keys(a || {}).sort()
  const kb = Object.keys(b || {}).sort()
  if (ka.length !== kb.length) return false
  return ka.every((k, i) => k === kb[i] && String(a[k]) === String(b[k]))
}

export default async function handler(req, res) {
  const auth = req.headers.authorization || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  const sesion = verificarToken(token)
  if (!sesion || !(await esAdmin(sesion.legajo))) {
    return res.status(401).json({ error: 'Tu sesión de administrador venció. Salí y volvé a entrar.' })
  }

  if (req.method === 'GET') {
    const { legajo, lugar, mes, anio } = req.query
    const MES = parseInt(mes, 10), ANIO = parseInt(anio, 10)
    const sectores = SECTORES_POR_LUGAR[lugar]
    if (!legajo || !sectores || !MES || !ANIO) return res.status(400).json({ error: 'Faltan datos.' })

    const [r1, r2, r3] = await Promise.all([
      supabase.from('efectivos').select('legajo, nombre, lugar').eq('legajo', legajo).eq('lugar', lugar).maybeSingle(),
      supabase.from('disponibilidad').select('dia, turno').eq('legajo', legajo).eq('lugar', lugar).eq('mes', MES).eq('anio', ANIO).limit(1000),
      supabase.from('turnos').select('dia, turno, sector').eq('legajo', legajo).eq('mes', MES).eq('anio', ANIO).in('sector', sectores).limit(1000),
    ])
    if (r1.error || r2.error || r3.error) return res.status(500).json({ error: 'No se pudo cargar. Probá de nuevo.' })
    if (!r1.data) return res.status(404).json({ error: `No se encontró el legajo ${legajo} en ${lugar}.` })
    return res.status(200).json({ efectivo: r1.data, dias_actuales: mapaDias(r2.data), turnos_asignados: r3.data || [] })
  }

  if (req.method === 'POST') {
    const { legajo, lugar, mes, anio, dias, confirmar, dias_antes_esperado } = req.body || {}
    const MES = parseInt(mes, 10), ANIO = parseInt(anio, 10)
    const sectores = SECTORES_POR_LUGAR[lugar]
    if (!legajo || !sectores || !MES || !ANIO || !dias || typeof dias !== 'object' || Array.isArray(dias)) {
      return res.status(400).json({ error: 'Datos inválidos.' })
    }
    if (!confirmar) return res.status(400).json({ error: 'Falta confirmar antes de guardar.' })

    const diasMes = new Date(ANIO, MES, 0).getDate()
    const patron = lugar === 'MODULAR' ? /^m?t?n?$/ : /^(d|n|dn)$/
    const limpios = {}
    for (const [d, t] of Object.entries(dias)) {
      const dia = Number(d)
      if (!t) continue
      if (!Number.isInteger(dia) || dia < 1 || dia > diasMes || typeof t !== 'string' || !patron.test(t)) {
        return res.status(400).json({ error: 'La disponibilidad enviada no es válida.' })
      }
      limpios[String(dia)] = t
    }

    try {
      const { data: ef, error: errEf } = await supabase
        .from('efectivos').select('legajo').eq('legajo', legajo).eq('lugar', lugar).maybeSingle()
      if (errEf) return res.status(500).json({ error: 'No se pudo guardar. Probá de nuevo.' })
      if (!ef) return res.status(404).json({ error: `No se encontró el legajo ${legajo} en ${lugar}.` })

      const { data: previas, error: errPrev } = await supabase
        .from('disponibilidad').select('legajo, dia, turno, mes, anio, lugar')
        .eq('legajo', legajo).eq('lugar', lugar).eq('mes', MES).eq('anio', ANIO).limit(1000)
      if (errPrev) return res.status(500).json({ error: 'No se pudo guardar. Probá de nuevo.' })

      // Si otro administrador la cambió desde que se abrió la pantalla, no se pisa.
      if (dias_antes_esperado && typeof dias_antes_esperado === 'object' && !iguales(mapaDias(previas), dias_antes_esperado)) {
        return res.status(409).json({
          error: 'La disponibilidad de esta persona cambió desde que abriste la pantalla. No se guardó nada: revisá lo que quedó y probá de nuevo.',
          conflicto: true,
          dias_actuales: mapaDias(previas),
        })
      }

      const { data: turnosAsig, error: errT } = await supabase
        .from('turnos').select('dia, turno, sector')
        .eq('legajo', legajo).eq('mes', MES).eq('anio', ANIO).in('sector', sectores).limit(1000)
      if (errT) return res.status(500).json({ error: 'No se pudo guardar. Probá de nuevo.' })
      const advertencias = (turnosAsig || [])
        .filter(t => !(limpios[String(t.dia)] || '').includes(t.turno))
        .map(t => ({
          dia: t.dia, turno: t.turno, sector: t.sector,
          detalle: `Ya tiene guardia el día ${t.dia} (${t.turno === 'd' ? 'día' : t.turno === 'n' ? 'noche' : t.turno}, ${t.sector}) que la nueva disponibilidad no cubre. No se modificó ni se borró.`,
        }))

      const { error: errDel } = await supabase
        .from('disponibilidad').delete()
        .eq('legajo', legajo).eq('lugar', lugar).eq('mes', MES).eq('anio', ANIO)
      if (errDel) return res.status(500).json({ error: 'No se pudo guardar. No se cambió nada.' })

      const filas = Object.entries(limpios).map(([dia, turno]) => ({ legajo, dia: Number(dia), turno, mes: MES, anio: ANIO, lugar }))
      if (filas.length > 0) {
        const { error: errIns } = await supabase.from('disponibilidad').insert(filas)
        if (errIns) {
          if ((previas || []).length > 0) await supabase.from('disponibilidad').insert(previas)
          return res.status(500).json({ error: 'No se pudo guardar. Se mantuvo lo que tenía cargado.' })
        }
      }
      return res.status(200).json({ ok: true, guardados: filas.length, advertencias })
    } catch (e) {
      console.error('[admin-disponibilidad-override]', e)
      return res.status(500).json({ error: 'No se pudo guardar. Probá de nuevo.' })
    }
  }

  return res.status(405).json({ error: 'Método no permitido' })
}
