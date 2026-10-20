import { createClient } from '@supabase/supabase-js'
import { requireAdminSession } from '../../lib/authServer'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// SOLO LIMPIEZA DE PRUEBA: borra TODOS los datos de Septiembre 2026 (turnos, disponibilidad,
// asistencia, planilla manual) en los 3 lugares (HIGA, UPA, MODULAR), sin tocar ningún otro mes.
// Se usa visitando: https://polad-modular.vercel.app/api/limpiar-mes-prueba?confirmar=SI
// (funciona igual desde cualquiera de los 3 sitios, porque comparten la misma base de datos).
const MES = 9
const ANIO = 2026
const TABLAS = ['turnos', 'disponibilidad', 'asistencia', 'planilla_manual']

export default async function handler(req, res) {
  // ⚠ HALLAZGO IMPORTANTE (ver resumen de entrega): este endpoint borra
  // datos reales (turnos, disponibilidad, asistencia, planilla_manual) de
  // los 3 lugares para un mes/año fijo, y hasta ahora era accesible por
  // CUALQUIERA que visitara la URL con ?confirmar=SI — sin ningún login.
  // Es un riesgo activo en producción, independiente del resto de este
  // trabajo. Ahora exige sesión de admin antes de hacer nada.
  if (!requireAdminSession(req, res)) return
  if (req.query.confirmar !== 'SI') {
    return res.status(400).json({
      error: `Agregá ?confirmar=SI a la URL para ejecutar esto (medida de seguridad).`,
      esto_va_a_borrar: `TODOS los datos de ${MES}/${ANIO} (turnos, disponibilidad, asistencia, planilla manual) en HIGA, UPA y MODULAR. No toca ningún otro mes.`
    })
  }

  const borrados = {}
  try {
    for (const tabla of TABLAS) {
      const { error, count } = await supabase
        .from(tabla)
        .delete({ count: 'exact' })
        .eq('mes', MES)
        .eq('anio', ANIO)
      if (error) {
        return res.status(500).json({ error: `Error borrando "${tabla}": ${error.message}`, borrados_antes_del_error: borrados })
      }
      borrados[tabla] = count
    }
    return res.json({ ok: true, mes: MES, anio: ANIO, filas_borradas_por_tabla: borrados })
  } catch (err) {
    return res.status(500).json({ error: err.message, borrados_antes_del_error: borrados })
  }
}
