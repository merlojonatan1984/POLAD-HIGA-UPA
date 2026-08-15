import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const SECTORES_POR_LUGAR = {
  HIGA: ['Salud Mental', 'Giratoria', 'Llaves', 'Guardia', 'Estacionamiento'],
  UPA: ['UPA'],
  MODULAR: ['Modular'],
}
function lugarDeSector(sector) {
  if (SECTORES_POR_LUGAR.UPA.includes(sector)) return 'UPA'
  if (SECTORES_POR_LUGAR.MODULAR.includes(sector)) return 'MODULAR'
  return 'HIGA'
}
function normLegajo(x) { return x === null || x === undefined ? '' : String(x).trim().toUpperCase() }

export default async function handler(req, res) {
  const { legajo, mes, anio } = req.query
  if (!legajo || !mes || !anio) return res.status(400).json({ error: 'Faltan parámetros: legajo, mes, anio' })

  // Traemos TODOS los efectivos y turnos que matcheen el legajo (normalizando espacios/mayúsculas,
  // por si el legajo está guardado con formato levemente distinto en algún lado).
  const [{ data: efectivosAll, error: e1 }, { data: turnosAll, error: e2 }] = await Promise.all([
    supabase.from('efectivos').select('legajo, nombre, lugar'),
    supabase.from('turnos').select('legajo, dia, turno, sector').eq('mes', parseInt(mes)).eq('anio', parseInt(anio)),
  ])
  if (e1) return res.status(500).json({ error: e1.message })
  if (e2) return res.status(500).json({ error: e2.message })

  const buscado = normLegajo(legajo)
  const efectivos = (efectivosAll || []).filter(e => normLegajo(e.legajo) === buscado)
  const turnos = (turnosAll || []).filter(t => normLegajo(t.legajo) === buscado)

  const porLugar = { HIGA: [], UPA: [], MODULAR: [] }
  turnos.forEach(t => { porLugar[lugarDeSector(t.sector)].push(t) })
  Object.keys(porLugar).forEach(l => porLugar[l].sort((a, b) => parseInt(a.dia) - parseInt(b.dia)))

  return res.json({
    legajo,
    encontrado: efectivos.length > 0 || turnos.length > 0,
    nombre: efectivos[0]?.nombre || null,
    lugares_donde_figura_como_efectivo: efectivos.map(e => e.lugar),
    turnos_por_lugar: porLugar,
    total_guardias: turnos.length,
  })
}
