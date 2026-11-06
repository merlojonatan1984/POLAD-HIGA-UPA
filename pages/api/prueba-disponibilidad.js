// pages/api/prueba-disponibilidad.js
//
// TEMPORAL — solo para la prueba de diciembre 2026. Se borra del repositorio al terminar.
//
// En HIGA, como suelen cargar más personas, se suman efectivos con ficha que no cargaron en noviembre
// hasta llegar a 78-83 efectivos.
//
// Copia la disponibilidad que cargaron los efectivos en NOVIEMBRE 2026 a DICIEMBRE 2026,
// para HIGA, UPA y MODULAR: las mismas personas, con la misma cantidad de días y de
// turnos, y con el mismo patrón por día de la semana (un lunes cargado en noviembre
// queda como un lunes cargado en diciembre). Se cambian a propósito algunos días
// (alrededor del 8 %) para que no sea una copia idéntica.
//
// Solo funciona con la sesión de un administrador, y solo toca diciembre 2026:
// los meses están escritos fijos acá, no se pueden cambiar desde afuera.
//
// Acciones (POST, campo "accion"):
//   vista  → muestra qué se cargaría, sin cambiar nada
//   cargar → carga la disponibilidad simulada (se rechaza si diciembre ya tiene disponibilidad)
//   borrar → borra TODO diciembre 2026 (disponibilidad, guardias, asistencia, planilla manual y firmas)

import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const ORIGEN = { mes: 11, anio: 2026 }
const DESTINO = { mes: 12, anio: 2026 }
const LUGARES = ['HIGA', 'UPA', 'MODULAR']
const PORCENTAJE_CAMBIO = 0.08
// En HIGA suelen cargar más personas que en noviembre: se completa hasta una cantidad entre 78 y 83
const HIGA_MIN = 78
const HIGA_MAX = 83

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
    const a = Buffer.from(firma, 'hex'), b = Buffer.from(esperada, 'hex')
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null
    return { legajo }
  } catch (e) { return null }
}

const norm = x => (x === null || x === undefined) ? '' : String(x).trim().toUpperCase()

// Generador de números al azar repetible (la misma persona da siempre el mismo resultado)
function azar(semilla) {
  let h = 1779033703 ^ semilla.length
  for (let i = 0; i < semilla.length; i++) { h = Math.imul(h ^ semilla.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19) }
  let s = h >>> 0
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

// Para cada día de diciembre, el día de noviembre que cae en el mismo día de la semana y más cerca
function mapaDias() {
  const diasNov = new Date(ORIGEN.anio, ORIGEN.mes, 0).getDate()
  const diasDic = new Date(DESTINO.anio, DESTINO.mes, 0).getDate()
  const mapa = {}
  for (let d = 1; d <= diasDic; d++) {
    const sem = new Date(DESTINO.anio, DESTINO.mes - 1, d).getDay()
    let mejor = null
    for (let n = 1; n <= diasNov; n++) {
      if (new Date(ORIGEN.anio, ORIGEN.mes - 1, n).getDay() !== sem) continue
      if (mejor === null || Math.abs(n - d) < Math.abs(mejor - d)) mejor = n
    }
    mapa[d] = mejor
  }
  return mapa
}

async function leerTodo(tabla, filtros) {
  let q = supabase.from(tabla).select('*')
  Object.entries(filtros || {}).forEach(([k, v]) => { q = q.eq(k, v) })
  const { data, error } = await q.limit(20000)
  if (error) throw new Error(`No se pudo leer ${tabla}: ${error.message}`)
  return data || []
}

async function armarPlan() {
  const [dispNov, efectivos] = await Promise.all([
    leerTodo('disponibilidad', { mes: ORIGEN.mes, anio: ORIGEN.anio }),
    leerTodo('efectivos', {}),
  ])
  // Una ficha puede tener dos lugares ("HIGA,UPA"): se cuenta en cada uno
  const lugaresDe = e => String(e.lugar || '').split(',').map(x => x.trim().toUpperCase()).filter(Boolean)
  const admins = new Set()
  const fichas = new Set()
  const legajoFicha = {}
  efectivos.forEach(e => lugaresDe(e).forEach(l => {
    const k = `${l}|${norm(e.legajo)}`
    if (e.es_admin === true) admins.add(k)
    else { fichas.add(k); legajoFicha[k] = e.legajo }
  }))
  const mapa = mapaDias()
  const diasDic = Object.keys(mapa).map(Number)

  const plan = {}
  LUGARES.forEach(l => { plan[l] = { cargaronNov: 0, conFicha: 0, sinFicha: 0, filas: [] } })

  const porPersona = {}
  dispNov.forEach(r => {
    if (!LUGARES.includes(r.lugar)) return
    const k = `${r.lugar}|${norm(r.legajo)}`
    if (!porPersona[k]) porPersona[k] = { lugar: r.lugar, legajo: r.legajo, dias: {} }
    porPersona[k].dias[parseInt(r.dia)] = r.turno
  })

  const filasDe = (k, dias, lugar, legajo) => {
    const R = azar(k)
    const turnosPropios = Object.values(dias)
    const filas = []
    diasDic.forEach(d => {
      const origen = dias[mapa[d]]
      let turno = origen
      if (R() < PORCENTAJE_CAMBIO) turno = origen ? undefined : turnosPropios[Math.floor(R() * turnosPropios.length)]
      if (turno) filas.push({ legajo, dia: d, turno, mes: DESTINO.mes, anio: DESTINO.anio, lugar })
    })
    return filas
  }

  const donantesHIGA = []
  Object.entries(porPersona).forEach(([k, p]) => {
    if (admins.has(k)) return
    const info = plan[p.lugar]
    info.cargaronNov++
    if (!fichas.has(k)) { info.sinFicha++; return }
    info.conFicha++
    info.filas.push(...filasDe(k, p.dias, p.lugar, legajoFicha[k] || p.legajo))
    if (p.lugar === 'HIGA' && Object.keys(p.dias).length > 0) donantesHIGA.push(p)
  })

  // HIGA: sumar personas con ficha que no cargaron en noviembre, copiando el patrón de alguien que sí cargó
  plan.HIGA.sumados = 0
  plan.HIGA.fichasSinCargar = 0
  const R0 = azar('HIGA-objetivo-diciembre')
  const objetivoHIGA = HIGA_MIN + Math.floor(R0() * (HIGA_MAX - HIGA_MIN + 1))
  const candidatos = efectivos
    .filter(e => lugaresDe(e).includes('HIGA') && e.es_admin !== true && !porPersona[`HIGA|${norm(e.legajo)}`])
    .sort((a, b) => azar('c' + norm(a.legajo))() - azar('c' + norm(b.legajo))())
  plan.HIGA.fichasSinCargar = candidatos.length
  const faltan = Math.max(0, objetivoHIGA - plan.HIGA.conFicha)
  if (donantesHIGA.length > 0) {
    candidatos.slice(0, faltan).forEach(e => {
      const k = `HIGA|${norm(e.legajo)}`
      const donante = donantesHIGA[Math.floor(azar('d' + k)() * donantesHIGA.length)]
      plan.HIGA.filas.push(...filasDe(k, donante.dias, 'HIGA', e.legajo))
      plan.HIGA.conFicha++
      plan.HIGA.sumados++
    })
  }
  return plan
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' })
  const auth = req.headers.authorization || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  if (!verificarToken(token)) return res.status(401).json({ error: 'Sesión inválida o vencida. Entrá como administrador.' })

  const { accion, confirmar } = req.body || {}
  try {
    if (accion === 'vista' || accion === 'cargar') {
      const [plan, existentes] = await Promise.all([
        armarPlan(),
        leerTodo('disponibilidad', { mes: DESTINO.mes, anio: DESTINO.anio }),
      ])
      const resumen = LUGARES.map(l => ({
        lugar: l, cargaronNoviembre: plan[l].cargaronNov, sinFichaVigente: plan[l].sinFicha,
        efectivosEnDiciembre: plan[l].conFicha, filasDiciembre: plan[l].filas.length,
        sumadosQueNoCargaron: plan[l].sumados || 0, fichasSinCargar: plan[l].fichasSinCargar,
      }))
      if (accion === 'vista') return res.status(200).json({ ok: true, resumen, filasYaEnDiciembre: existentes.length })

      if (existentes.length > 0) {
        return res.status(409).json({ error: `Diciembre ya tiene ${existentes.length} filas de disponibilidad. Primero borrá diciembre para no mezclar la simulación con datos reales.` })
      }
      for (const l of LUGARES) {
        const filas = plan[l].filas
        // Seguro extra: jamás se inserta una fila que no sea de diciembre 2026
        if (filas.some(f => f.mes !== DESTINO.mes || f.anio !== DESTINO.anio)) {
          return res.status(500).json({ error: 'Se frenó: había filas que no eran de diciembre. No se cargó nada más.' })
        }
        for (let i = 0; i < filas.length; i += 500) {
          const { error } = await supabase.from('disponibilidad').insert(filas.slice(i, i + 500))
          if (error) return res.status(500).json({ error: `Se cortó al cargar ${l}: ${error.message}. Usá "Borrar diciembre" y volvé a probar.` })
        }
      }
      return res.status(200).json({ ok: true, cargado: true, resumen })
    }

    if (accion === 'borrar') {
      if (confirmar !== 'BORRAR DICIEMBRE') return res.status(400).json({ error: 'Falta la confirmación.' })
      const borrado = {}
      for (const tabla of ['disponibilidad', 'turnos', 'asistencia', 'planilla_manual', 'firmas']) {
        const { error, count } = await supabase.from(tabla).delete({ count: 'exact' }).eq('mes', DESTINO.mes).eq('anio', DESTINO.anio)
        if (error) return res.status(500).json({ error: `Error borrando ${tabla}: ${error.message}`, borradoAntes: borrado })
        borrado[tabla] = count
      }
      return res.status(200).json({ ok: true, borrado })
    }

    return res.status(400).json({ error: 'Acción desconocida.' })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
