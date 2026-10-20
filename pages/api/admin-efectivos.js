// pages/api/admin-efectivos.js
//
// Punto 1 de la revisión: mismo motivo que pages/api/admin-turnos.js, para
// la tabla `efectivos` — antes pages/admin.js la leía y escribía directo
// desde el navegador con la clave anon pública (gestión de personal, alta,
// baja, edición, firma, planilla), ~7 puntos distintos. `efectivos` además
// tiene una columna `password` en texto plano: con la clave anon, cualquiera
// podía leerla con un simple select, sin ninguna sesión. Este endpoint
// requiere sesión de administrador verificada por el servidor y escribe con
// la service role key.
//
// Decisión explícita (documentada, no silenciosa): el GET de este endpoint
// SIGUE devolviendo `password` al administrador autenticado de su propio
// lugar (no se la oculta). pages/admin.js usa `form.password` como
// indicador booleano ("¿tiene clave personalizada?") y como valor por
// defecto al reenviar el formulario en una edición — si se la ocultara acá,
// una edición de otro campo (nombre, sector, teléfono...) que no toque el
// campo contraseña en la pantalla terminaría guardando `password: null` y
// borrando en silencio la clave personalizada de alguien. Resolver esto bien
// (no guardar más contraseñas en texto plano) es un cambio más grande, fuera
// del alcance de esta etapa — queda documentado como pendiente real, no
// resuelto, en el informe final.
//
// Cada escritura por id exige ADEMÁS que la fila ya pertenezca al lugar de
// la sesión (where id=... and lugar=...) — un administrador de un lugar no
// puede editar/borrar/firmar una fila de otro lugar adivinando un id,
// aunque ambos compartan la misma base.
//
// Punto 3 de esta ronda de revisión: cuando la edición ('guardar' con id)
// cambia el legajo, antes esto se hacía en DOS pasos separados — un POST
// aparte a /api/admin-turnos (renombrar_legajo), con sus errores IGNORADOS
// a propósito del lado de pages/admin.js, y RECIÉN DESPUÉS este endpoint
// actualizaba la fila de efectivos. Si el renombrado de turnos fallaba por
// lo que fuera, el efectivo terminaba con el legajo nuevo igual, con sus
// turnos del borrador huérfanos bajo el legajo viejo — una parte
// modificada, la otra no. Ahora la edición (con o sin cambio de legajo) es
// una sola llamada a fn_admin_guardar_efectivo (migración 0001), que hace
// las dos cosas (renombrar los turnos del borrador de este lugar si el
// legajo cambia, y actualizar la fila de efectivos) en UNA transacción: si
// cualquiera de las dos falla, Postgres revierte todo.
//
// Punto 2 de la ronda siguiente ("Completar la coherencia del cambio de
// legajo"): la misma función ahora también renombra, en esa misma
// transacción, disponibilidad/asistencia/planilla_manual (acotadas a este
// lugar) y, cuando es inequívoco, firmas — ver el comentario completo en
// fn_admin_guardar_efectivo, en supabase/migrations/0001_borrador_publicacion.sql.
// pages/admin.js (handleGuardarPersonal) YA NO hace esas cuatro escrituras
// por su cuenta antes de llamar a este endpoint; si fn_admin_guardar_efectivo
// falla, ninguna de las relaciones queda modificada.
//
// GET  → { efectivos: [...] }  (personal no-admin del lugar de la sesión)
// POST { action, ... }
//   'guardar'          { id?, legajo, nombre, tipo, email, sector, telefono,
//                         notas, dni, jerarquia, password }
//   'eliminar'         { id }
//   'set_firma_url'    { id, firma_url }      (firma_url: string o null)
//   'set_planilla_url' { id, planilla_url }   (planilla_url: string o null)
//   'set_sexo'          { id, sexo }           (femenino/masculino/sin_informar
//                         — punto 1 de esta ronda, acción separada para no
//                         modificar fn_admin_guardar_efectivo)

import { createClient } from '@supabase/supabase-js'
import { requireAdminSession } from '../../lib/authServer'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export default async function handler(req, res) {
  const sesion = requireAdminSession(req, res)
  if (!sesion) return
  const lugar = sesion.lugar

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('efectivos').select('*').eq('es_admin', false).eq('lugar', lugar).order('nombre')
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ efectivos: data || [] })
  }

  if (req.method !== 'POST') return res.status(405).end()

  const { action } = req.body || {}

  try {
    if (action === 'guardar') {
      const d = req.body || {}
      if (!d.legajo || !d.nombre) return res.status(400).json({ error: 'Faltan legajo/nombre' })

      if (d.id) {
        // Edición: fn_admin_guardar_efectivo exige que la fila ya sea del
        // lugar de la sesión (p_lugar) y, si el legajo cambia, renombra en
        // la MISMA transacción los turnos del borrador de ese legajo EN
        // ESTE LUGAR — ver el comentario de arriba y el de la función en
        // supabase/migrations/0001_borrador_publicacion.sql.
        const { data: rpcResult, error: rpcError } = await supabase.rpc('fn_admin_guardar_efectivo', {
          p_lugar: lugar, p_id: d.id, p_legajo: d.legajo, p_nombre: d.nombre, p_tipo: d.tipo,
          p_email: d.email || '', p_sector: d.sector || 'Sin asignar', p_telefono: d.telefono || '',
          p_notas: d.notas || null, p_dni: d.dni || null, p_jerarquia: d.jerarquia || null,
          p_password: d.password || null,
        })
        if (rpcError) {
          const m = rpcError.message || ''
          if (/function .*fn_admin_guardar_efectivo/i.test(m)) {
            return res.status(500).json({ error: 'No se pudo guardar: falta aplicar la migración supabase/migrations/0001_borrador_publicacion.sql en esta base (la función fn_admin_guardar_efectivo todavía no existe). No se modificó nada.' })
          }
          if (m.includes('legajo_duplicado')) return res.status(400).json({ error: 'Error: ese legajo ya existe.' })
          if (m.includes('efectivo_no_encontrado')) return res.status(404).json({ error: 'No se encontró ese efectivo en este lugar (o ya no pertenece a este lugar).' })
          if (m.includes('datos_invalidos')) return res.status(400).json({ error: 'Faltan legajo/nombre' })
          return res.status(500).json({ error: 'Error: ' + m })
        }
        const fila = Array.isArray(rpcResult) ? rpcResult[0] : rpcResult
        // Punto 2 de esta ronda: fn_admin_guardar_efectivo ahora también
        // renombra, en la misma transacción, disponibilidad/asistencia/
        // planilla_manual (acotadas a este lugar) y, cuando es inequívoco,
        // firmas. Se devuelven los contadores y el aviso de ambigüedad
        // para que pages/admin.js se lo muestre al administrador — ya no
        // hace esas escrituras por su cuenta (ver handleGuardarPersonal).
        return res.status(200).json({
          ok: true,
          mensaje: 'Efectivo actualizado.',
          turnos_renombrados: fila?.turnos_renombrados || 0,
          disponibilidad_renombrada: fila?.disponibilidad_renombrada || 0,
          asistencia_renombrada: fila?.asistencia_renombrada || 0,
          planilla_manual_renombrada: fila?.planilla_manual_renombrada || 0,
          firmas_renombradas: fila?.firmas_renombradas || 0,
          firmas_omitidas_por_ambiguedad: !!fila?.firmas_omitidas_por_ambiguedad,
        })
      } else {
        // Punto 1 de esta ronda ("Identificación por sexo"): se admite en el
        // alta porque este insert es un paso aparte, no la función
        // fn_admin_guardar_efectivo (frozen esta ronda) — nunca se infiere
        // del nombre; si no se manda, la columna usa su default
        // 'sin_informar' (migración 0004).
        const sexoValido = ['femenino', 'masculino', 'sin_informar'].includes(d.sexo) ? d.sexo : 'sin_informar'
        const { error: errIns } = await supabase.from('efectivos').insert([{
          legajo: d.legajo, nombre: d.nombre, tipo: d.tipo,
          email: d.email || '', sector: 'Sin asignar', es_admin: false,
          telefono: d.telefono || '', lugar, sexo: sexoValido,
        }])
        if (errIns) {
          return res.status(400).json({ error: 'Error: ' + (errIns.message.includes('duplicate') ? 'ese legajo ya existe.' : errIns.message) })
        }
        return res.status(200).json({ ok: true, mensaje: 'Efectivo dado de alta. Clave inicial: ' + d.legajo })
      }
    }

    if (action === 'eliminar') {
      const { id } = req.body || {}
      if (!id) return res.status(400).json({ error: 'Falta id' })
      const { data: filas, error } = await supabase.from('efectivos').delete().eq('id', id).eq('lugar', lugar).select('id')
      if (error) return res.status(500).json({ error: error.message })
      if (!filas || filas.length === 0) return res.status(404).json({ error: 'No se encontró ese efectivo en este lugar.' })
      return res.status(200).json({ ok: true })
    }

    if (action === 'set_sexo') {
      // Punto 1 de esta ronda: edición de sexo como acción SEPARADA de
      // fn_admin_guardar_efectivo (que esta ronda no debe modificar) — así
      // se puede registrar/corregir sin tocar esa función ni el resto de la
      // ficha. Nunca se infiere del nombre: solo se guarda lo que cargue el
      // administrador.
      const { id, sexo } = req.body || {}
      if (!id) return res.status(400).json({ error: 'Falta id' })
      if (!['femenino', 'masculino', 'sin_informar'].includes(sexo)) {
        return res.status(400).json({ error: 'sexo inválido (esperaba femenino/masculino/sin_informar)' })
      }
      const { data: filas, error } = await supabase.from('efectivos').update({ sexo }).eq('id', id).eq('lugar', lugar).select('id')
      if (error) return res.status(500).json({ error: error.message })
      if (!filas || filas.length === 0) return res.status(404).json({ error: 'No se encontró ese efectivo en este lugar.' })
      return res.status(200).json({ ok: true })
    }

    if (action === 'set_firma_url' || action === 'set_planilla_url') {
      const { id } = req.body || {}
      if (!id) return res.status(400).json({ error: 'Falta id' })
      const campo = action === 'set_firma_url' ? 'firma_url' : 'planilla_url'
      const valor = req.body?.[campo] ?? null

      // Punto 5 de esta ronda ("permisos de archivos de planillas"): cuando
      // se borra la planilla (set_planilla_url con valor null), antes
      // pages/admin.js (eliminarPlanillaAdmin) hacía el .remove() del
      // archivo en Supabase Storage DIRECTO desde el navegador, con la
      // clave anon pública — cualquiera que la conociera podía borrar
      // cualquier archivo del bucket 'planillas' adivinando su nombre, sin
      // sesión ni control alguno. Ahora el borrado del archivo se hace acá,
      // del lado del servidor, con la service role, usando el legajo y la
      // extensión de la fila real (ya scopeada por lugar más abajo) — nunca
      // un nombre de archivo que mande el cliente. El nombre coincide con
      // el que arma pages/api/crear-url-planilla.js al subir
      // (legajo-lugar.ext). Si falla el borrado en Storage no se bloquea la
      // limpieza de la columna en la base (igual se puede volver a subir
      // una planilla nueva en el mismo lugar), pero se deja constancia en
      // el log del servidor.
      if (action === 'set_planilla_url' && valor === null) {
        const { data: filaActual } = await supabase
          .from('efectivos').select('legajo, planilla_url').eq('id', id).eq('lugar', lugar).maybeSingle()
        if (filaActual?.planilla_url) {
          const ext = filaActual.planilla_url.toLowerCase().includes('.ods') ? 'ods' : 'xlsx'
          const path = `${filaActual.legajo}-${lugar}.${ext}`
          const { error: errRemove } = await supabase.storage.from('planillas').remove([path])
          if (errRemove) console.warn('[admin-efectivos] no se pudo borrar el archivo de Storage "' + path + '": ' + errRemove.message)
        }
      }

      const { data: filas, error } = await supabase.from('efectivos').update({ [campo]: valor }).eq('id', id).eq('lugar', lugar).select('id')
      if (error) return res.status(500).json({ error: error.message })
      if (!filas || filas.length === 0) return res.status(404).json({ error: 'No se encontró ese efectivo en este lugar.' })
      return res.status(200).json({ ok: true })
    }

    return res.status(400).json({ error: 'action inválida (esperaba guardar/eliminar/set_firma_url/set_planilla_url)' })
  } catch (err) {
    console.error('[admin-efectivos] Error:', err)
    return res.status(500).json({ error: err.message })
  }
}
