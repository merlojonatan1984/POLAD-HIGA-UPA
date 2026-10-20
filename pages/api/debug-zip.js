import { createClient } from '@supabase/supabase-js'
import { requireAdminSession } from '../../lib/authServer'

// Punto 1 de la revisión: usaba la clave anon para leer efectivos (ya
// exigía sesión de admin, pero con esa clave se habría roto en cuanto se
// active RLS sobre esa tabla — ver supabase/migrations/0002_rls_propuesta.sql).
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export default async function handler(req, res) {
  // Endpoint de depuración que devuelve nombres y asistencia reales sin
  // ninguna autenticación. Se deja funcionando (puede seguir siendo útil
  // para diagnosticar), pero ahora exige sesión de admin.
  if (!requireAdminSession(req, res)) return
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
