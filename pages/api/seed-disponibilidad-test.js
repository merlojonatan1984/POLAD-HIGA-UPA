import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// SOLO PRUEBA: carga disponibilidad ficticia en Septiembre 2026 para poder probar
// la Asignación rápida a gran escala, sin tocar absolutamente nada de Agosto.
// Se borra fácil después con "Borrar todas las guardias" (mismo mes/año seleccionado).

const MES = 9
const ANIO = 2026

export default async function handler(req, res) {
  if (req.query.confirmar !== 'SI') {
    return res.status(400).json({ error: 'Agregá ?confirmar=SI a la URL para ejecutar esto (es una medida de seguridad).' })
  }

  try {
    const { data: efectivosHiga } = await supabase.from('efectivos').select('legajo, lugar').eq('lugar', 'HIGA').eq('es_admin', false)
    const { data: efectivosUpa } = await supabase.from('efectivos').select('legajo, lugar').eq('lugar', 'UPA').eq('es_admin', false)
    const { data: efectivosModular } = await supabase.from('efectivos').select('legajo, lugar').eq('lugar', 'MODULAR').eq('es_admin', false)

    // Detectar legajos que existen en más de un lugar (candidatos ideales para
    // forzar el escenario de cruce de horarios entre lugares)
    const legajosPorLugar = { HIGA: new Set((efectivosHiga || []).map(e => e.legajo)), UPA: new Set((efectivosUpa || []).map(e => e.legajo)), MODULAR: new Set((efectivosModular || []).map(e => e.legajo)) }
    const todosLegajos = new Set([...legajosPorLugar.HIGA, ...legajosPorLugar.UPA, ...legajosPorLugar.MODULAR])
    const compartidos = [...todosLegajos].filter(l => {
      const c = (legajosPorLugar.HIGA.has(l) ? 1 : 0) + (legajosPorLugar.UPA.has(l) ? 1 : 0) + (legajosPorLugar.MODULAR.has(l) ? 1 : 0)
      return c > 1
    })

    // HIGA: priorizar los compartidos, completar hasta 80
    const higaCompartidos = (efectivosHiga || []).filter(e => compartidos.includes(e.legajo))
    const higaResto = (efectivosHiga || []).filter(e => !compartidos.includes(e.legajo))
    const higaSeleccion = [...higaCompartidos, ...higaResto].slice(0, 80)

    const seleccion = [
      ...higaSeleccion.map(e => ({ ...e, lugar: 'HIGA' })),
      ...(efectivosUpa || []).map(e => ({ ...e, lugar: 'UPA' })),
      ...(efectivosModular || []).map(e => ({ ...e, lugar: 'MODULAR' }))
    ]

    const DIAS_SEPTIEMBRE = 30
    const filas = []
    for (const ef of seleccion) {
      const turnoCompleto = ef.lugar === 'MODULAR' ? 'mtn' : 'dn'
      // Disponible en ~20 de los 30 días, con TODOS los turnos posibles ese día
      // (así se maximizan las chances de que la asignación rápida intente cruzar)
      for (let dia = 1; dia <= DIAS_SEPTIEMBRE; dia++) {
        if ((dia + ef.legajo.length) % 3 === 0) continue // deja libres ~1 de cada 3 días, variado por legajo
        filas.push({ legajo: ef.legajo, mes: MES, anio: ANIO, dia, turno: turnoCompleto, lugar: ef.lugar })
      }
    }

    // Insertar en lotes
    let insertados = 0
    for (let i = 0; i < filas.length; i += 500) {
      const lote = filas.slice(i, i + 500)
      const { error } = await supabase.from('disponibilidad').insert(lote)
      if (error) {
        return res.status(500).json({ error: 'Error insertando: ' + error.message, insertadosAntesDelError: insertados })
      }
      insertados += lote.length
    }

    return res.json({
      ok: true,
      efectivosHiga: higaSeleccion.length,
      efectivosUpa: (efectivosUpa || []).length,
      efectivosModular: (efectivosModular || []).length,
      legajosCompartidosEntreLugares: compartidos.length,
      filasDeDisponibilidadInsertadas: insertados
    })

  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
