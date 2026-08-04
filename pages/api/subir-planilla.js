import { createClient } from '@supabase/supabase-js'

export const config = { api: { bodyParser: { sizeLimit: '15mb' } } }

// Cliente admin: usa la service_role key, SOLO se ejecuta en el servidor.
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function fixPrintAreaXlsx(buffer) {
  const JSZip = (await import('jszip')).default
  const zip = await JSZip.loadAsync(buffer)

  const workbookFile = zip.file('xl/workbook.xml')
  if (!workbookFile) {
    throw new Error('El archivo no tiene la estructura interna de un .xlsx válido')
  }
  let wbXml = await workbookFile.async('string')
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

async function fixPrintAreaOds(buffer) {
  const JSZip = (await import('jszip')).default
  const zip = await JSZip.loadAsync(buffer)

  const contentFile = zip.file('content.xml')
  if (!contentFile) {
    throw new Error('El archivo no tiene la estructura interna de un .ods válido')
  }
  let contentXml = await contentFile.async('string')

  if (!contentXml.includes('table:print-ranges')) {
    contentXml = contentXml.replace(
      /(<table:table\b)([^>]*)(>)/,
      function (match, p1, p2, p3) {
        const sheetMatch = p2.match(/table:name="([^"]+)"/)
        const sheetName = sheetMatch ? sheetMatch[1] : 'PLANILLA INDIVIDUAL'
        return p1 + p2 + ' table:print-ranges="' + sheetName + '.$A$1:$G$39"' + p3
      }
    )
    zip.file('content.xml', contentXml)
  }

  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  try {
    const { legajo, fileBase64, fileName } = req.body

    if (!legajo || !fileBase64 || !fileName) {
      return res.status(400).json({ error: 'Faltan datos' })
    }

    const nombreLower = fileName.toLowerCase()
    const esXlsx = nombreLower.endsWith('.xlsx')
    const esOds = nombreLower.endsWith('.ods')

    if (!esXlsx && !esOds) {
      return res.status(400).json({ error: 'Solo se aceptan archivos .xlsx o .ods' })
    }

    const ext = esXlsx ? 'xlsx' : 'ods'
    const buffer = Buffer.from(fileBase64, 'base64')

    let fixedBuffer
    try {
      fixedBuffer = esXlsx ? await fixPrintAreaXlsx(buffer) : await fixPrintAreaOds(buffer)
    } catch (e) {
      console.error('No se pudo ajustar el área de impresión, se sube el archivo tal cual:', e.message)
      fixedBuffer = buffer
    }

    const contentType = esXlsx
      ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      : 'application/vnd.oasis.opendocument.spreadsheet'

    const storagePath = legajo + '.' + ext
    const { error: uploadError } = await supabase.storage
      .from('planillas')
      .upload(storagePath, fixedBuffer, { contentType, upsert: true })

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
