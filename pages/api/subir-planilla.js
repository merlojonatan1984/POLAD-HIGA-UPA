import { createClient } from '@supabase/supabase-js'

export const config = { api: { bodyParser: { sizeLimit: '10mb' } } }

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

async function fixPrintArea(buffer) {
  const JSZip = (await import('jszip')).default
  const zip = await JSZip.loadAsync(buffer)

  let wbXml = await zip.file('xl/workbook.xml').async('string')
  const sheetMatch = wbXml.match(/<sheet[^>]+name="([^"]+)"/)
  const sheetName = sheetMatch ? sheetMatch[1] : 'PLANILLA INDIVIDUAL'
  const printAreaDef = '<definedName name="Print_Area" localSheetId="0">' + "'" + sheetName + "'!$A$1:$G$39</definedName>"

  if (wbXml.includes('<definedNames>')) {
    if (!wbXml.includes('Print_Area')) {
      wbXml = wbXml.replace('<definedNames>', '<definedNames>' + printAreaDef)
    }
  } else {
    wbXml = wbXml.replace('</workbook>', '<definedNames>' + printAreaDef + '</definedNames></workbook>')
  }
  zip.file('xl/workbook.xml', wbXml)

  const sheetFile = zip.file('xl/worksheets/sheet1.xml')
  if (sheetFile) {
    let sheetXml = await sheetFile.async('string')

    while (sheetXml.includes('<rowBreaks')) {
      const start = sheetXml.indexOf('<rowBreaks')
      const end = sheetXml.indexOf('>', start)
      if (sheetXml[end - 1] === '/') {
        sheetXml = sheetXml.slice(0, start) + sheetXml.slice(end + 1)
      } else {
        const closeTag = sheetXml.indexOf('</rowBreaks>', end)
        if (closeTag === -1) break
        sheetXml = sheetXml.slice(0, start) + sheetXml.slice(closeTag + 12)
      }
    }

    const pageSetup = '<pageSetup paperSize="9" orientation="portrait" fitToHeight="1" fitToWidth="1"/>'
    if (sheetXml.includes('<pageSetup')) {
      const ps = sheetXml.indexOf('<pageSetup')
      const pe = sheetXml.indexOf('/>', ps) + 2
      sheetXml = sheetXml.slice(0, ps) + pageSetup + sheetXml.slice(pe)
    } else {
      sheetXml = sheetXml.replace('</worksheet>', pageSetup + '</worksheet>')
    }

    zip.file('xl/worksheets/sheet1.xml', sheetXml)
  }

  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  try {
    const { legajo, fileBase64, fileName } = req.body

    if (!legajo || !fileBase64) {
      return res.status(400).json({ error: 'Faltan datos' })
    }

    if (!fileName || !fileName.toLowerCase().endsWith('.xlsx')) {
      return res.status(400).json({ error: 'Solo se aceptan archivos .xlsx. Guardá el archivo como Excel antes de subirlo.' })
    }

    const buffer = Buffer.from(fileBase64, 'base64')
    const fixedBuffer = await fixPrintArea(buffer)

    const storagePath = legajo + '.xlsx'
    const { error: uploadError } = await supabase.storage
      .from('planillas')
      .upload(storagePath, fixedBuffer, {
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        upsert: true
      })

    if (uploadError) {
      return res.status(500).json({ error: 'Error subiendo archivo: ' + uploadError.message })
    }

    const { data: urlData } = supabase.storage.from('planillas').getPublicUrl(storagePath)
    const publicUrl = urlData.publicUrl

    const { error: updateError } = await supabase
      .from('efectivos')
      .update({ planilla_url: publicUrl })
      .eq('legajo', legajo)

    if (updateError) {
      return res.status(500).json({ error: 'Error actualizando efectivo: ' + updateError.message })
    }

    return res.json({ ok: true, url: publicUrl })

  } catch (err) {
    console.error('Error en subir-planilla:', err)
    return res.status(500).json({ error: err.message })
  }
}
