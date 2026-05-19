import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

export default async function handler(req, res) {
  const { mes, anio, lugar } = req.query
  const MES = parseInt(mes), ANIO = parseInt(anio)
  const LUGAR = lugar || 'HIGA'

  const { data: asistencias, error: aErr } = await supabase
    .from('asistencia')
    .select('*')
    .eq('mes', MES).eq('anio', ANIO).eq('lugar', LUGAR)

  const legajos = [...new Set((asistencias||[]).map(a => a.legajo))]

  const { data: efectivos, error: eErr } = await supabase
    .from('efectivos')
    .select('legajo, nombre')
    .in('legajo', legajos.length > 0 ? legajos : ['none'])

  res.json({
    mes: MES, anio: ANIO, lugar: LUGAR,
    asistencias_count: asistencias?.length || 0,
    asistencias: asistencias || [],
    legajos_unicos: legajos,
    efectivos_count: efectivos?.length || 0,
    efectivos: efectivos || [],
    error_asist: aErr,
    error_ef: eErr
  })
}
