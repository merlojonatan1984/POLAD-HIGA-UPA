// pages/api/prueba-disponibilidad.js
//
// TEMPORAL — solo para la prueba de diciembre 2026. Se borra del repositorio al terminar.
//
// SOLO UPA y MODULAR (HIGA no se toca). Cada lugar queda con una cantidad exacta de efectivos cargados en diciembre: UPA 24 y MODULAR 30.
// Si en noviembre cargaron menos, se suman efectivos con ficha que no cargaron (copiando el patrón de alguien que sí
// cargó); si cargaron más, se dejan solo los pedidos (siempre los mismos).
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
// SOLO se cargan UPA y MODULAR. HIGA no se toca: ni se carga ni se borra su disponibilidad de diciembre.
const LUGARES = ['UPA', 'MODULAR']
// Cada efectivo conserva exactamente su disponibilidad de noviembre (mismo patrón por día de la semana)
const PORCENTAJE_CAMBIO = 0
// Cada lugar queda con exactamente esta cantidad de efectivos cargados en diciembre
const OBJETIVOS = { UPA: 24, MODULAR: 30 }

// Código temporal para usar la prueba sin pantalla (se abre la dirección en el navegador).
// Este archivo se borra del repositorio al terminar la prueba.
const CODIGO = '4ce167bc8dcb991f446d27cf'

function codigoValido(c) {
  if (typeof c !== 'string' || c.length !== CODIGO.length) return false
  return crypto.timingSafeEqual(Buffer.from(c), Buffer.from(CODIGO))
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
  // Supabase entrega como máximo 1000 filas por consulta aunque se pida más: se lee por páginas para no perder datos.
  const PAG = 1000
  const armar = () => {
    let q = supabase.from(tabla).select('*')
    Object.entries(filtros || {}).forEach(([k, v]) => { q = q.eq(k, v) })
    return q
  }
  const r1 = await armar().range(0, PAG - 1)
  if (r1.error) throw new Error(`No se pudo leer ${tabla}: ${r1.error.message}`)
  let filas = r1.data || []
  if (filas.length === PAG) {
    const todas = []
    for (let desde = 0; desde < 200000; desde += PAG) {
      const rr = await armar().order('id', { ascending: true }).range(desde, desde + PAG - 1)
      if (rr.error) throw new Error(`No se pudo leer ${tabla} completa: ${rr.error.message}`)
      todas.push(...(rr.data || []))
      if ((rr.data || []).length < PAG) break
    }
    filas = todas
  }
  return filas
}

async function armarPlan() {
  const [dispNov, efectivos] = await Promise.all([
    leerTodo('disponibilidad', { mes: ORIGEN.mes, anio: ORIGEN.anio }),
    leerTodo('efectivos', {}),
  ])
  // Igual que el panel: una ficha cuenta en un lugar solo si su lugar es exactamente ese.
  // (Los que trabajan en varios lugares tienen una ficha por cada lugar.)
  const lugaresDe = e => [String(e.lugar || '').trim()].filter(Boolean)
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
    // Quien cargó en noviembre tiene que figurar cargado en diciembre: nunca queda con cero días
    if (filas.length === 0) {
      diasDic.forEach(d => { if (dias[mapa[d]]) filas.push({ legajo, dia: d, turno: dias[mapa[d]], mes: DESTINO.mes, anio: DESTINO.anio, lugar }) })
    }
    return filas
  }

  const donantes = {}, cargadores = {}
  LUGARES.forEach(l => { donantes[l] = []; cargadores[l] = [] })
  Object.entries(porPersona).forEach(([k, p]) => {
    if (admins.has(k)) return
    const info = plan[p.lugar]
    if (!fichas.has(k)) { info.sinFicha++; return }
    info.cargaronNov++   // igual que el panel: solo cuentan los que hoy tienen ficha en ese lugar
    const filasP = filasDe(k, p.dias, p.lugar, legajoFicha[k] || p.legajo)
    cargadores[p.lugar].push({ k, filas: filasP })
    if (Object.keys(p.dias).length > 0) donantes[p.lugar].push(p)
  })
  LUGARES.forEach(l => {
    const objetivo = OBJETIVOS[l]
    // Si hubiera más de los pedidos, se quedan solo los pedidos (siempre los mismos)
    cargadores[l].sort((a, b) => azar('t' + a.k)() - azar('t' + b.k)())
    cargadores[l].slice(0, objetivo).forEach(c => { plan[l].conFicha++; plan[l].filas.push(...c.filas) })
    plan[l].recortados = Math.max(0, cargadores[l].length - objetivo)
    // Si faltan, se suman personas con ficha que no cargaron en noviembre, copiando el patrón de alguien que sí cargó
    plan[l].sumados = 0
    const candidatos = efectivos
      .filter(e => lugaresDe(e).includes(l) && e.es_admin !== true && !porPersona[`${l}|${norm(e.legajo)}`])
      .sort((a, b) => azar('c' + norm(a.legajo))() - azar('c' + norm(b.legajo))())
    plan[l].fichasSinCargar = candidatos.length
    const faltan = Math.max(0, objetivo - plan[l].conFicha)
    if (donantes[l].length > 0) {
      candidatos.slice(0, faltan).forEach(e => {
        const k = `${l}|${norm(e.legajo)}`
        const donante = donantes[l][Math.floor(azar('d' + k)() * donantes[l].length)]
        plan[l].filas.push(...filasDe(k, donante.dias, l, e.legajo))
        plan[l].conFicha++
        plan[l].sumados++
      })
    }
  })
  return plan
}

export default async function handler(req, res) {
  const esGET = req.method === 'GET'
  if (!esGET && req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' })
  const datos = esGET ? (req.query || {}) : (req.body || {})

  // Respuesta: en el navegador (GET) sale como texto simple, sin pantalla
  const salir = (status, obj) => {
    if (!esGET) return res.status(status).json(obj)
    res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    if (obj.error) return res.status(status).send('ERROR: ' + obj.error)
    const lineas = []
    if (obj.resumen) obj.resumen.forEach(r => lineas.push(`${r.lugar}: cargaron en noviembre ${r.cargaronNoviembre} (sin contar ${r.sinFichaVigente} que cargaron y ya no tienen ficha) | quedan en diciembre ${r.efectivosEnDiciembre} (sumados ${r.sumadosQueNoCargaron}) | ${r.filasDiciembre} filas` + (r.enLaBase !== undefined ? ` | EN LA BASE AHORA: ${r.enLaBase} efectivos` : '')))
    if (obj.cargado) lineas.unshift('LISTO: disponibilidad de diciembre cargada.')
    else if (obj.resumen) lineas.unshift(obj.filasYaEnDiciembre > 0 ? `Diciembre ya tiene ${obj.filasYaEnDiciembre} filas. No se cargó nada.` : 'Diciembre está vacío. No se cargó nada todavía.')
    if (obj.borrado) lineas.push('LISTO: diciembre borrado. ' + Object.entries(obj.borrado).map(([k, v]) => `${k}: ${v}`).join(' | '))
    return res.status(status).send(lineas.join('\n'))
  }

  const auth = req.headers.authorization || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  if (!(esGET ? codigoValido(datos.codigo) : (codigoValido(datos.codigo) || verificarToken(token)))) {
    return salir(401, { error: 'No autorizado.' })
  }

  const { accion, confirmar } = datos
  try {
    if (accion === 'vista' || accion === 'cargar' || accion === 'reiniciar') {
      const [plan, existentes] = await Promise.all([
        armarPlan(),
        leerTodo('disponibilidad', { mes: DESTINO.mes, anio: DESTINO.anio }).then(f => f.filter(r => LUGARES.includes(r.lugar))),
      ])
      const resumen = LUGARES.map(l => ({
        lugar: l, cargaronNoviembre: plan[l].cargaronNov, sinFichaVigente: plan[l].sinFicha,
        efectivosEnDiciembre: plan[l].conFicha, filasDiciembre: plan[l].filas.length,
        sumadosQueNoCargaron: plan[l].sumados || 0, recortados: plan[l].recortados || 0, fichasSinCargar: plan[l].fichasSinCargar,
      }))
      if (accion === 'vista') return salir(200, { ok: true, resumen, filasYaEnDiciembre: existentes.length })

      if (accion === 'reiniciar' && existentes.length > 0) {
        // Solo la disponibilidad de diciembre 2026 de UPA y MODULAR; nada más (HIGA no se toca)
        const { error: eDel } = await supabase.from('disponibilidad').delete().eq('mes', DESTINO.mes).eq('anio', DESTINO.anio).in('lugar', LUGARES)
        if (eDel) return salir(500, { error: `No se pudo limpiar diciembre: ${eDel.message}` })
      } else if (existentes.length > 0) {
        return salir(409, { error: `UPA y MODULAR ya tienen ${existentes.length} filas de disponibilidad en diciembre. Primero usá "reiniciar" (o borrá diciembre) para no mezclar la simulación con datos reales.` })
      }
      for (const l of LUGARES) {
        const filas = plan[l].filas
        // Seguro extra: jamás se inserta una fila que no sea de diciembre 2026
        if (filas.some(f => f.mes !== DESTINO.mes || f.anio !== DESTINO.anio)) {
          return salir(500, { error: 'Se frenó: había filas que no eran de diciembre. No se cargó nada más.' })
        }
        for (let i = 0; i < filas.length; i += 500) {
          const { error } = await supabase.from('disponibilidad').insert(filas.slice(i, i + 500))
          if (error) return salir(500, { error: `Se cortó al cargar ${l}: ${error.message}. Usá "borrar" y volvé a probar.` })
        }
      }
      // Comprobación contra la base: cuántos efectivos quedaron realmente cargados en cada lugar
      const luego = (await leerTodo('disponibilidad', { mes: DESTINO.mes, anio: DESTINO.anio })).filter(r => LUGARES.includes(r.lugar))
      const enBase = {}
      LUGARES.forEach(l => { enBase[l] = new Set(luego.filter(r => r.lugar === l).map(r => norm(r.legajo))).size })
      resumen.forEach(r => { r.enLaBase = enBase[r.lugar] })
      return salir(200, { ok: true, cargado: true, resumen })
    }

    if (accion === 'borrar') {
      if (confirmar !== 'BORRAR DICIEMBRE' && confirmar !== 'SI') return salir(400, { error: 'Falta la confirmación (confirmar=SI).' })
      const borrado = {}
      for (const tabla of ['disponibilidad', 'turnos', 'asistencia', 'planilla_manual', 'firmas']) {
        const { error, count } = await supabase.from(tabla).delete({ count: 'exact' }).eq('mes', DESTINO.mes).eq('anio', DESTINO.anio)
        if (error) return salir(500, { error: `Error borrando ${tabla}: ${error.message}`, borradoAntes: borrado })
        borrado[tabla] = count
      }
      return salir(200, { ok: true, borrado })
    }

    return salir(400, { error: 'Acción desconocida.' })
  } catch (e) {
    return salir(500, { error: e.message })
  }
}
