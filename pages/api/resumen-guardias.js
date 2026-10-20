import ExcelJS from 'exceljs'
import { createClient } from '@supabase/supabase-js'
import { requireAdminSession } from '../../lib/authServer'

// Punto 1 de la revisión: usaba la clave anon para leer turnos/efectivos
// (ya exigía sesión de admin, pero con esa clave se habría roto en cuanto
// se activara RLS sobre esas tablas — ver supabase/migrations/
// 0002_rls_propuesta.sql). Ahora usa la service role key. A diferencia de
// generar-planilla.js/planilla-efectivo.js, este endpoint SÍ sigue leyendo
// el borrador (tabla turnos) a propósito: es un resumen de horas para el
// administrador mientras todavía está armando/ajustando las guardias,
// antes de publicar — no es una planilla definitiva, así que no corresponde
// migrarlo a turnos_publicados (point 6 solo pide eso para los documentos
// definitivos).
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']

// Punto 6 de esta ronda ("Sumatoria de horas"): se agrega 'Rondin Externo',
// que faltaba acá (SÍ está en pages/admin.js y pages/api/generar-planilla.js
// — con esta lista incompleta, las guardias de ese sector quedaban
// subcontadas en este resumen). Se deja también un mapa inverso
// sector→lugar, para la columna cruzada entre destinos (más abajo).
const SECTORES_POR_LUGAR = {
  'HIGA': ['Salud Mental', 'Giratoria', 'Llaves', 'Guardia', 'Estacionamiento', 'Rondin Externo'],
  'UPA': ['UPA'],
  'MODULAR': ['Modular']
}
const SECTOR_A_LUGAR = {}
Object.entries(SECTORES_POR_LUGAR).forEach(([lg, secs]) => secs.forEach(s => { SECTOR_A_LUGAR[s] = lg }))

const HORAS_POR_LUGAR = { 'HIGA': 12, 'UPA': 12, 'MODULAR': 8 }

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()
  if (!requireAdminSession(req, res)) return
  const { mes, anio, lugar } = req.query
  if (!mes || !anio) return res.status(400).json({ error: 'Faltan parámetros' })
  const MES = parseInt(mes)
  const ANIO = parseInt(anio)
  const APP_LUGAR = lugar || process.env.NEXT_PUBLIC_LUGAR || 'HIGA'
  const NOMBRE_MES = MESES[MES - 1] + ' ' + ANIO
  const SECTORES_APP = SECTORES_POR_LUGAR[APP_LUGAR] || SECTORES_POR_LUGAR['HIGA']
  const ES_MODULAR = APP_LUGAR === 'MODULAR'
  const HORAS_TURNO = HORAS_POR_LUGAR[APP_LUGAR] || 12

  const [{ data: efectivos }, { data: turnos }, { data: turnosTodosLugares }, { data: pubVigente }] = await Promise.all([
    supabase.from('efectivos').select('legajo, nombre, tipo, jerarquia').eq('es_admin', false).eq('lugar', APP_LUGAR).order('nombre'),
    supabase.from('turnos').select('legajo, turno, sector').eq('mes', MES).eq('anio', ANIO).in('sector', SECTORES_APP),
    // Punto 6 ("Sumatoria de horas"): total del efectivo sumando HIGA+UPA+
    // MODULAR para el mismo mes/año — SIN filtrar por sector/lugar, porque
    // los sectores de los 3 lugares son disjuntos (ver SECTOR_A_LUGAR). Es
    // indispensable para esto mismo poder seguir leyendo turnos de los 3
    // lugares acá — igual que ya hace buscarCruceOtroLugar en pages/admin.js
    // para las alertas de superposición (ese control NO se toca ni se ve
    // afectado por esto).
    supabase.from('turnos').select('legajo, sector').eq('mes', MES).eq('anio', ANIO),
    // Para "horas realizadas" (ver más abajo): la publicación vigente de
    // ESTE lugar/mes/año, si existe.
    supabase.from('publicaciones').select('id').eq('lugar', APP_LUGAR).eq('mes', MES).eq('anio', ANIO).eq('vigente', true).maybeSingle(),
  ])

  const conteo = {}
  ;(turnos || []).forEach(t => {
    if (!conteo[t.legajo]) conteo[t.legajo] = { total: 0, t1: 0, t2: 0, t3: 0 }
    conteo[t.legajo].total++
    if (ES_MODULAR) {
      if (t.turno === 'm') conteo[t.legajo].t1++
      else if (t.turno === 't') conteo[t.legajo].t2++
      else if (t.turno === 'n') conteo[t.legajo].t3++
    } else {
      if (t.turno === 'd') conteo[t.legajo].t1++
      else conteo[t.legajo].t2++
    }
  })

  // Horas ASIGNADAS (borrador) sumando los 3 destinos para el mismo
  // efectivo+mes+año — columna aparte, nunca sumada/mezclada con "horas
  // realizadas" (ver más abajo), para no contar nada dos veces.
  const horasCruzadasPorLegajo = {}
  ;(turnosTodosLugares || []).forEach(t => {
    const lg = SECTOR_A_LUGAR[t.sector] || APP_LUGAR
    const h = HORAS_POR_LUGAR[lg] || 12
    horasCruzadasPorLegajo[t.legajo] = (horasCruzadasPorLegajo[t.legajo] || 0) + h
  })

  // Horas REALIZADAS (distinto de "asignadas"): solo las guardias
  // PUBLICADAS de este lugar/mes/año que además tienen asistencia
  // confirmada (presente=true) — nunca desde el borrador. Si no hay
  // publicación vigente todavía, queda vacío (0 para todos) en vez de
  // inventar un valor.
  const horasRealizadasPorLegajo = {}
  if (pubVigente?.id) {
    const [{ data: turnosPub }, { data: asist }] = await Promise.all([
      supabase.from('turnos_publicados').select('legajo, dia, turno').eq('publicacion_id', pubVigente.id),
      supabase.from('asistencia').select('legajo, dia, turno').eq('lugar', APP_LUGAR).eq('mes', MES).eq('anio', ANIO).eq('presente', true),
    ])
    const asistSet = new Set((asist || []).map(a => `${a.legajo}-${a.dia}-${a.turno}`))
    ;(turnosPub || []).forEach(t => {
      if (!asistSet.has(`${t.legajo}-${t.dia}-${t.turno}`)) return
      horasRealizadasPorLegajo[t.legajo] = (horasRealizadasPorLegajo[t.legajo] || 0) + HORAS_TURNO
    })
  }

  const conTurnos = (efectivos || []).filter(e => (conteo[e.legajo]?.total || 0) > 0)
  const sinTurnos = (efectivos || []).filter(e => (conteo[e.legajo]?.total || 0) === 0)

  const COLORES = {
    'HIGA':    { navy: 'FF1a3a6b', title: 'FF85B7EB' },
    'UPA':     { navy: 'FF7a3a10', title: 'FFD85A30' },
    'MODULAR': { navy: 'FF0a3a44', title: 'FF20A0B0' }
  }
  const COL = COLORES[APP_LUGAR] || COLORES['HIGA']
  const NAVY = COL.navy
  const WHITE = 'FFFFFFFF'
  const BLACK = 'FF111111'
  const RED = 'FF8b4040'

  const wb = new ExcelJS.Workbook()
  const b = (s = 'thin') => ({ top: { style: s }, bottom: { style: s }, left: { style: s }, right: { style: s } })
  const a = (h = 'center') => ({ horizontal: h, vertical: 'middle' })
  const f = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } })

  const ws = wb.addWorksheet(`Guardias ${APP_LUGAR}`)
  ws.pageSetup = { orientation: 'portrait', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.5, right: 0.5, top: 0.5, bottom: 0.5, header: 0, footer: 0 } }

  // Columnas según lugar. Punto 6 de esta ronda ("Sumatoria de horas"): se
  // agregan dos columnas — "Horas (3 destinos)" (asignadas, borrador, suma
  // HIGA+UPA+MODULAR del mismo efectivo) y "Horas realizadas" (publicado +
  // asistencia confirmada, SOLO de este lugar) — nunca se suman entre sí ni
  // con "Horas" (que sigue siendo asignadas de este lugar únicamente, sin
  // cambios respecto de antes).
  const headers = ES_MODULAR
    ? ['N°', 'Apellido y Nombre', 'Legajo', 'Jerarquía', 'Guardias', 'Mañana', 'Tarde', 'Noche', 'Horas', 'Horas (3 destinos)', 'Horas realizadas']
    : ['N°', 'Apellido y Nombre', 'Legajo', 'Jerarquía', 'Guardias', 'Día', 'Noche', 'Horas', 'Horas (3 destinos)', 'Horas realizadas']

  const colWidths = ES_MODULAR
    ? [6, 42, 12, 20, 11, 9, 9, 9, 9, 15, 14]
    : [6, 42, 12, 20, 11, 9, 9, 9, 15, 14]

  colWidths.forEach((w, i) => { ws.getColumn(i + 1).width = w })

  const totalCols = headers.length
  const lastCol = String.fromCharCode(64 + totalCols) // hasta 11 columnas hoy, sigue dentro de A-Z

  ws.mergeCells(`A1:${lastCol}1`); ws.getRow(1).height = 22
  Object.assign(ws.getCell('A1'), {
    value: `POLICIA ADICIONAL · MINISTERIO DE SEGURIDAD · MAR DEL PLATA — ${APP_LUGAR}`,
    font: { name: 'Arial', bold: true, size: 9, color: { argb: WHITE } },
    fill: f(NAVY), alignment: a(), border: b('medium')
  })

  ws.mergeCells(`A2:${lastCol}2`); ws.getRow(2).height = 28
  Object.assign(ws.getCell('A2'), {
    value: `RESUMEN DE GUARDIAS DESIGNADAS — ${APP_LUGAR} — ${NOMBRE_MES.toUpperCase()}`,
    font: { name: 'Arial', bold: true, size: 13, color: { argb: NAVY } },
    fill: f('FFf5f8ff'), alignment: a(), border: b()
  })

  // Punto 8 de esta ronda ("...si se imprime un borrador para revisión,
  // identificarlo expresamente como BORRADOR"): este resumen SIEMPRE lee la
  // tabla turnos (el borrador en preparación, nunca lo publicado — ver el
  // comentario al principio del archivo) — se identifica expresamente en
  // vez de dejar que alguien lo confunda con una planilla definitiva.
  ws.mergeCells(`A3:${lastCol}3`); ws.getRow(3).height = 18
  Object.assign(ws.getCell('A3'), {
    value: `⚠ BORRADOR — guardias en preparación, puede no coincidir con lo publicado (pestaña "Guardias" → Publicar)`,
    font: { name: 'Arial', bold: true, size: 9.5, color: { argb: WHITE } },
    fill: f('FFB8860B'), alignment: a(), border: b('medium')
  })

  ws.mergeCells(`A4:${lastCol}4`); ws.getRow(4).height = 16
  Object.assign(ws.getCell('A4'), {
    value: `Efectivos con guardias: ${conTurnos.length}   ·   Sin guardias: ${sinTurnos.length}`,
    font: { name: 'Arial', size: 9, color: { argb: 'FF444444' } },
    fill: f('FFfafafa'), alignment: a(), border: b()
  })

  ws.getRow(5).height = 20
  headers.forEach((h, i) => {
    const c = ws.getCell(5, i + 1)
    c.value = h; c.font = { name: 'Arial', bold: true, size: 9, color: { argb: WHITE } }
    c.fill = f(NAVY); c.alignment = a(i === 1 ? 'left' : 'center'); c.border = b()
  })

  let totalG = 0, totalT1 = 0, totalT2 = 0, totalT3 = 0, totalCruzadas = 0, totalRealizadas = 0
  conTurnos.forEach((ef, idx) => {
    const c = conteo[ef.legajo] || { total: 0, t1: 0, t2: 0, t3: 0 }
    const hCruzadas = horasCruzadasPorLegajo[ef.legajo] || 0
    const hRealizadas = horasRealizadasPorLegajo[ef.legajo] || 0
    totalG += c.total; totalT1 += c.t1; totalT2 += c.t2; totalT3 += c.t3
    totalCruzadas += hCruzadas; totalRealizadas += hRealizadas
    const row = 6 + idx
    const bg = idx % 2 === 0 ? 'FFffffff' : 'FFf0f4f8'
    ws.getRow(row).height = 17

    const valores = ES_MODULAR
      ? [idx + 1, ef.nombre, ef.legajo, ef.jerarquia || '—', c.total, c.t1, c.t2, c.t3, c.total * HORAS_TURNO, hCruzadas, hRealizadas]
      : [idx + 1, ef.nombre, ef.legajo, ef.jerarquia || '—', c.total, c.t1, c.t2, c.total * HORAS_TURNO, hCruzadas, hRealizadas]

    valores.forEach((v, i) => {
      const cell = ws.getCell(row, i + 1)
      cell.value = v; cell.fill = f(bg)
      cell.alignment = a(i === 1 ? 'left' : 'center'); cell.border = b('thin')
      cell.font = { name: 'Arial', size: 9, bold: i >= 4, color: { argb: i === 4 ? NAVY : BLACK } }
    })
  })

  const ft = 6 + conTurnos.length; ws.getRow(ft).height = 20
  const totales = ES_MODULAR
    ? ['', `TOTAL ${APP_LUGAR}`, '', '', totalG, totalT1, totalT2, totalT3, totalG * HORAS_TURNO, totalCruzadas, totalRealizadas]
    : ['', `TOTAL ${APP_LUGAR}`, '', '', totalG, totalT1, totalT2, totalG * HORAS_TURNO, totalCruzadas, totalRealizadas]

  totales.forEach((v, i) => {
    const cell = ws.getCell(ft, i + 1)
    cell.value = v; cell.font = { name: 'Arial', bold: true, size: 10, color: { argb: WHITE } }
    cell.fill = f(NAVY); cell.alignment = a(i === 1 ? 'left' : 'center'); cell.border = b('medium')
  })

  if (sinTurnos.length > 0) {
    const ws2 = wb.addWorksheet('Sin guardias')
    ws2.getColumn(1).width = 6; ws2.getColumn(2).width = 42; ws2.getColumn(3).width = 12; ws2.getColumn(4).width = 16
    ws2.mergeCells('A1:D1'); ws2.getRow(1).height = 22
    Object.assign(ws2.getCell('A1'), {
      value: `SIN GUARDIAS ASIGNADAS — ${APP_LUGAR} — ${NOMBRE_MES.toUpperCase()}`,
      font: { name: 'Arial', bold: true, size: 11, color: { argb: WHITE } },
      fill: f(RED), alignment: a(), border: b('medium')
    })
    ws2.getRow(2).height = 18
    ;['N°', 'Apellido y Nombre', 'Legajo', 'Escalafón'].forEach((h, i) => {
      const c = ws2.getCell(2, i + 1)
      c.value = h; c.font = { name: 'Arial', bold: true, size: 9, color: { argb: WHITE } }
      c.fill = f(RED); c.alignment = a(i === 1 ? 'left' : 'center'); c.border = b()
    })
    sinTurnos.forEach((ef, idx) => {
      const row = 3 + idx; const bg = idx % 2 === 0 ? 'FFfff5f5' : 'FFffe8e8'
      ws2.getRow(row).height = 16
      ;[idx + 1, ef.nombre, ef.legajo, ef.tipo || ''].forEach((v, i) => {
        const cell = ws2.getCell(row, i + 1)
        cell.value = v; cell.fill = f(bg); cell.alignment = a(i === 1 ? 'left' : 'center'); cell.border = b('thin')
        cell.font = { name: 'Arial', size: 9, color: { argb: 'FF444444' } }
      })
    })
  }

  const buffer = await wb.xlsx.writeBuffer()
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', `attachment; filename="Resumen_${APP_LUGAR}_${NOMBRE_MES.replace(' ', '_')}.xlsx"`)
  res.send(Buffer.from(buffer))
}
