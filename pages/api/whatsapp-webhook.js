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

    // Traer los turnos asignados a este legajo hoy y ayer (por si un turno noche
    // de ayer todavía sigue vigente), en los 3 lugares
    const [{ data: turnosHoy }, { data: turnosAyer }] = await Promise.all([
      supabase.from('turnos').select('*').eq('legajo', efectivo.legajo).eq('mes', mesHoy).eq('anio', anioHoy).eq('dia', diaHoy),
      supabase.from('turnos').select('*').eq('legajo', efectivo.legajo).eq('mes', mesAyer).eq('anio', anioAyer).eq('dia', diaAyer)
    ])
    const candidatosTurno = [...(turnosHoy || []), ...(turnosAyer || [])]

    let turnoVigente = null
    for (const t of candidatosTurno) {
      const lugarT = lugarDeSector(t.sector)
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
