import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN
const WHATSAPP_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID
const ADMIN_WHATSAPP = process.env.ADMIN_WHATSAPP_NUMBER // ej: 5492235123456

const SECTORES_POR_LUGAR = {
  HIGA: ['Salud Mental', 'Giratoria', 'Llaves', 'Guardia', 'Estacionamiento'],
  UPA: ['UPA'],
  MODULAR: ['Modular']
}
function lugarDeSector(sector) {
  if (SECTORES_POR_LUGAR.MODULAR.includes(sector)) return 'MODULAR'
  if (SECTORES_POR_LUGAR.UPA.includes(sector)) return 'UPA'
  return 'HIGA'
}

// Devuelve [inicio, fin] como objetos Date (UTC) para el turno de un día real,
// tratando los horarios como hora Argentina (UTC-3).
function rangoTurnoFecha(anio, mes, dia, turno, lugar) {
  const fechaAr = (d, h, min) => new Date(Date.UTC(anio, mes - 1, d, h + 3, min))
  if (lugar === 'MODULAR') {
    if (turno === 'm') return [fechaAr(dia, 8, 0), fechaAr(dia, 16, 0)]
    if (turno === 't') return [fechaAr(dia, 16, 0), fechaAr(dia + 1, 0, 0)]
    // noche real: 23:59 del día X a 08:00 del día X+1 (igual que en EfectivoApp.js
    // y en la planilla impresa) — antes quedaba 24hs corrido hacia el mismo día X.
    return [fechaAr(dia + 1, 0, 0), fechaAr(dia + 1, 8, 0)]
  }
  return turno === 'd' ? [fechaAr(dia, 8, 0), fechaAr(dia, 20, 0)] : [fechaAr(dia, 20, 0), fechaAr(dia + 1, 8, 0)]
}

const LABEL_TURNO = { d: 'día', n: 'noche', m: 'mañana', t: 'tarde' }

// Los webhooks entrantes de números argentinos llegan CON el "9" móvil
// (ej: 5492236918690), pero para RESPONDER hay que sacarlo (54...), porque
// así es como Meta tiene registrado el número en la lista de destinatarios
// autorizados durante el modo de prueba.
function normalizarParaEnviar(numero) {
  if (numero.startsWith('549')) {
    return '54' + numero.slice(3)
  }
  return numero
}

async function enviarWhatsapp(numero, texto) {
  if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) {
    console.error('[whatsapp-webhook] Faltan WHATSAPP_TOKEN o PHONE_NUMBER_ID')
    return
  }
  try {
    const r = await fetch(`https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${WHATSAPP_TOKEN}` },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: numero,
        type: 'text',
        text: { body: texto }
      })
    })
    const cuerpo = await r.text()
    if (!r.ok) {
      console.error('[whatsapp-webhook] Meta respondió error al enviar. Numero usado:', numero, 'Status:', r.status, 'Body:', cuerpo)
    } else {
      console.log('[whatsapp-webhook] Mensaje enviado OK. Numero usado:', numero, 'Body:', cuerpo)
    }
  } catch (e) {
    console.error('[whatsapp-webhook] Error de red enviando mensaje:', e.message)
  }
}

export default async function handler(req, res) {
  // Verificación del webhook (Meta la llama una sola vez, al conectar)
  if (req.method === 'GET') {
    const mode = req.query['hub.mode']
    const token = req.query['hub.verify_token']
    const challenge = req.query['hub.challenge']
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      return res.status(200).send(challenge)
    }
    return res.status(403).end()
  }

  if (req.method !== 'POST') return res.status(405).end()

  try {
    const entry = req.body?.entry?.[0]
    const value = entry?.changes?.[0]?.value
    const msg = value?.messages?.[0]

    // Los webhooks de "statuses" (entregado/leído) no traen "messages" — los ignoramos
    if (!msg) return res.status(200).end()
    if (msg.type !== 'text') return res.status(200).end()

    const numeroOrigen = msg.from // ej: "5492235123456"
    console.log('[whatsapp-webhook] numeroOrigen crudo recibido:', numeroOrigen)

    const texto = (msg.text?.body || '').trim()
    const textoNormalizado = texto
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // saca acentos
      .toUpperCase()

    if (!textoNormalizado.includes('PRESENTE')) {
      await enviarWhatsapp(normalizarParaEnviar(numeroOrigen), 'Para registrar tu presencia, escribí: ESTOY PRESENTE')
      return res.status(200).end()
    }

    // Buscar el efectivo por teléfono (comparando solo los dígitos finales, para
    // no depender de si el número está guardado con o sin código de país)
    const digitosOrigen = numeroOrigen.replace(/\D/g, '')
    const { data: efectivos } = await supabase.from('efectivos').select('legajo, nombre, telefono')
    const candidatos = (efectivos || []).filter(e => {
      const dig = (e.telefono || '').replace(/\D/g, '')
      return dig.length >= 8 && digitosOrigen.endsWith(dig)
    })

    if (candidatos.length === 0) {
      await enviarWhatsapp(normalizarParaEnviar(numeroOrigen), 'No pude identificarte. Verificá que tu número esté cargado en el sistema, o contactate con el administrador.')
      return res.status(200).end()
    }
    const efectivo = candidatos[0]

    // Calcular "ahora" y "hoy" en hora Argentina
    const ahoraUTC = new Date()
    const ahoraAr = new Date(ahoraUTC.getTime() - 3 * 60 * 60 * 1000)
    const anioHoy = ahoraAr.getUTCFullYear()
    const mesHoy = ahoraAr.getUTCMonth() + 1
    const diaHoy = ahoraAr.getUTCDate()
    const ayerAr = new Date(ahoraAr.getTime() - 24 * 60 * 60 * 1000)
    const anioAyer = ayerAr.getUTCFullYear()
    const mesAyer = ayerAr.getUTCMonth() + 1
    const diaAyer = ayerAr.getUTCDate()

    // Punto de revisión 6: la confirmación de presencia por WhatsApp tiene que
    // mirar ÚNICAMENTE lo que ya está publicado (turnos_publicados, filtrado
    // por la publicación VIGENTE de cada lugar/mes/año), nunca el borrador
    // (turnos) que el administrador puede estar editando. Antes esta ruta
    // consultaba `turnos` directo, así que un cambio en el borrador — incluso
    // uno que el administrador todavía no publicó — podía hacer que alguien
    // reciba o deje de recibir la confirmación de presencia según una guardia
    // que los efectivos ni siquiera llegaron a ver.
    //
    // turnos_publicados conserva filas de publicaciones anteriores (no se
    // borran al publicar una versión nueva), así que no alcanza con filtrar
    // por mes/año/lugar: hay que acotar explícitamente a los id de las
    // publicaciones que están VIGENTES ahora para cada (lugar, mes, año)
    // relevante (hoy y, por si un turno noche de ayer sigue en curso, ayer).
    const periodos = [{ mes: mesHoy, anio: anioHoy }]
    if (mesAyer !== mesHoy || anioAyer !== anioHoy) periodos.push({ mes: mesAyer, anio: anioAyer })

    const resultadosVigentes = await Promise.all(
      periodos.map(p =>
        supabase.from('publicaciones').select('id, lugar, mes, anio')
          .eq('mes', p.mes).eq('anio', p.anio).eq('vigente', true)
      )
    )
    const publicacionesVigentesIds = []
    for (const r of resultadosVigentes) {
      if (r.error) console.error('[whatsapp-webhook] Error consultando publicaciones vigentes (¿falta aplicar la migración?):', r.error.message)
      for (const pub of (r.data || [])) publicacionesVigentesIds.push(pub.id)
    }

    let candidatosTurno = []
    if (publicacionesVigentesIds.length > 0) {
      const { data: turnosPublicados } = await supabase
        .from('turnos_publicados').select('*')
        .eq('legajo', efectivo.legajo)
        .in('publicacion_id', publicacionesVigentesIds)
      candidatosTurno = (turnosPublicados || []).filter(t =>
        (parseInt(t.dia) === diaHoy && t.mes === mesHoy && t.anio === anioHoy) ||
        (parseInt(t.dia) === diaAyer && t.mes === mesAyer && t.anio === anioAyer)
      )
    }

    let turnoVigente = null
    for (const t of candidatosTurno) {
      // turnos_publicados ya guarda `lugar` explícitamente (se fija en el
      // momento de publicar — ver fn_publicar_guardias), así que no hace
      // falta volver a derivarlo del sector.
      const lugarT = t.lugar || lugarDeSector(t.sector)
      const [inicio, fin] = rangoTurnoFecha(t.anio, t.mes, parseInt(t.dia), t.turno, lugarT)
      if (ahoraUTC >= inicio && ahoraUTC < fin) { turnoVigente = { ...t, lugar: lugarT }; break }
    }

    if (!turnoVigente) {
      await enviarWhatsapp(normalizarParaEnviar(numeroOrigen), 'No tenés guardia asignada hoy. Si creés que es un error, contactate con el administrador.')
      await supabase.from('avisos_whatsapp').insert([{
        legajo: efectivo.legajo, nombre: efectivo.nombre, telefono: numeroOrigen,
        mensaje: texto, motivo: 'Sin guardia asignada para el horario actual', lugar: null
      }])
      if (ADMIN_WHATSAPP) {
        await enviarWhatsapp(ADMIN_WHATSAPP,
          `⚠ ${efectivo.nombre} (legajo ${efectivo.legajo}) escribió "PRESENTE" pero no tiene guardia asignada ahora.`)
      }
      return res.status(200).end()
    }

    // Evitar duplicar si ya estaba confirmada
    const { data: yaExiste } = await supabase.from('asistencia').select('id')
      .eq('legajo', efectivo.legajo).eq('mes', turnoVigente.mes).eq('anio', turnoVigente.anio)
      .eq('dia', turnoVigente.dia).eq('turno', turnoVigente.turno).eq('lugar', turnoVigente.lugar)
      .maybeSingle()

    if (!yaExiste) {
      await supabase.from('asistencia').insert([{
        legajo: efectivo.legajo, mes: turnoVigente.mes, anio: turnoVigente.anio, dia: turnoVigente.dia,
        turno: turnoVigente.turno, sector: turnoVigente.sector, lugar: turnoVigente.lugar,
        presente: true, confirmado_at: new Date().toISOString()
      }])
    }

    const nombreCorto = efectivo.nombre.split(',')[0]
    await enviarWhatsapp(normalizarParaEnviar(numeroOrigen),
      `✅ Presencia registrada — ${nombreCorto}, turno ${LABEL_TURNO[turnoVigente.turno] || turnoVigente.turno}, ${turnoVigente.lugar}, ${String(turnoVigente.dia).padStart(2, '0')}/${String(turnoVigente.mes).padStart(2, '0')}/${turnoVigente.anio}.`)

    return res.status(200).end()

  } catch (err) {
    console.error('[whatsapp-webhook] Error:', err)
    return res.status(200).end() // 200 igual, para que Meta no reintente en loop
  }
}
