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
  const printAreaDef = `<definedName name="Print_Area" localSheetId="0">'${sheetName}'!$A$1:$G$39</definedName>`
  if (wbXml.includes('<definedNames>')) {
    if (!wbXml.includes('Print_Area')) {
      wbXml = wbXml.replace('<definedNames>', `<definedNames>${printAreaDef}`)
    }
  } else {
    wbXml = wbXml.replace('</workbook>', `<definedNames>${printAreaDef}</definedNames></workbook>`)
  }
  zip.file('xl/workbook.xml', wbXml)
  const sheetFile = zip.file('xl/worksheets/sheet1.xml')
  if (sheetFile) {
    let sheetXml = await sheetFile.async('string')
    sheetXml = sheetXml.replace(/<rowBreaks[^>]*\/>/g, '')
    sheetXml = sheetXml.replace(/<rowBreaks[^>]*>[\s\S]*?<\/rowBreaks>/g, '')
    const pageSetup = '<pageSetup paperSize="9" orientation="portrait"
