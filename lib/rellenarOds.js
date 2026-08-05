// Motor para rellenar campos (datos del efectivo + guardias del mes) sobre un
// archivo .ods ya preparado a mano (con sello, firma del referente y firma del
// efectivo ya incrustados como imágenes). Solo toca el texto de las celdas de
// datos — nunca las imágenes ni el resto del archivo.

async function cargarJSZip() {
  const mod = await import('jszip')
  return mod.default
}

// Tokeniza una fila de tabla ODS en celdas reales + celdas cubiertas por merge,
// devolviendo la posición de columna efectiva (0-indexed) de cada token real.
function tokenizarFila(rowXml) {
  const tokens = []
  const re = /<table:covered-table-cell\b[^>]*\/>|<table:covered-table-cell\b[^>]*>.*?<\/table:covered-table-cell>|<table:table-cell\b[^>]*\/>|<table:table-cell\b[^>]*>.*?<\/table:table-cell>/gs
  let m
  let col = 0
  while ((m = re.exec(rowXml)) !== null) {
    const raw = m[0]
    const start = m.index
    const end = start + raw.length
    if (raw.startsWith('<table:covered-table-cell')) {
      const rep = /table:number-columns-repeated="(\d+)"/.exec(raw)
      const repN = rep ? parseInt(rep[1]) : 1
      tokens.push({ col, colEnd: col + repN - 1, raw, start, end, covered: true })
      col += repN
    } else {
      const rep = /table:number-columns-repeated="(\d+)"/.exec(raw)
      const repN = rep ? parseInt(rep[1]) : 1
      tokens.push({ col, colEnd: col, raw, start, end, covered: false })
      col += repN
    }
  }
  return tokens
}

function construirCeldaTexto(valor, tipo, celdaOriginalRaw) {
  const valorStr = String(valor)
  const escapado = valorStr
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  // Preservar los atributos de la etiqueta de apertura original (estilo, spans, etc.)
  // pero reemplazar/añadir office:value-type y office:value, y quitar el contenido viejo.
  const aperturaMatch = /^<table:table-cell\b([^>]*?)\/?>/s.exec(celdaOriginalRaw)
  let attrs = aperturaMatch ? aperturaMatch[1] : ''
  attrs = attrs.replace(/\/\s*$/, '') // quitar la barra de autocierre si la celda original no tenía contenido
  // quitar cualquier office:value-type / office:value previos
  attrs = attrs.replace(/\s+office:value-type="[^"]*"/g, '').replace(/\s+office:value="[^"]*"/g, '')

  const valueTypeAttr = tipo === 'float' ? ` office:value-type="float" office:value="${valorStr}"` : ` office:value-type="string"`

  // Preservar cualquier imagen/dibujo anclado dentro de la celda original (p. ej. una
  // firma pegada junto al texto de declaración) — no se debe perder al reemplazar el texto.
  const dibujos = celdaOriginalRaw.match(/<draw:frame\b.*?<\/draw:frame>/gs) || []

  return `<table:table-cell${attrs}${valueTypeAttr}><text:p>${escapado}</text:p>${dibujos.join('')}</table:table-cell>`
}

// Escribe un valor en la celda ubicada en (filaIdx, colIdx), ambos 0-indexed,
// dentro de la sección <table:table>...</table:table> del content.xml.
// Devuelve el content.xml modificado.
function escribirCelda(contentXml, tableStart, tableEnd, filaIdx, colIdx, valor, tipo = 'string') {
  const tableXml = contentXml.slice(tableStart, tableEnd)
  const rowRe = /<table:table-row\b[^>]*>.*?<\/table:table-row>/gs
  let m
  let idx = 0
  let rowMatch = null
  while ((m = rowRe.exec(tableXml)) !== null) {
    if (idx === filaIdx) { rowMatch = m; break }
    idx++
  }
  if (!rowMatch) throw new Error(`Fila ${filaIdx} no encontrada`)

  const rowXml = rowMatch[0]
  const rowStartInTable = rowMatch.index
  const tokens = tokenizarFila(rowXml)
  const token = tokens.find(t => colIdx >= t.col && colIdx <= t.colEnd)
  if (!token) throw new Error(`Columna ${colIdx} no encontrada en fila ${filaIdx}`)
  if (token.covered) throw new Error(`Columna ${colIdx} en fila ${filaIdx} es una celda cubierta por merge, no editable directamente`)

  const nuevaCelda = construirCeldaTexto(valor, tipo, token.raw)
  const nuevoRowXml = rowXml.slice(0, token.start) + nuevaCelda + rowXml.slice(token.end)

  const nuevoTableXml = tableXml.slice(0, rowStartInTable) + nuevoRowXml + tableXml.slice(rowStartInTable + rowXml.length)
  return contentXml.slice(0, tableStart) + nuevoTableXml + contentXml.slice(tableEnd)
}

async function rellenarPlanillaOds(buffer, datos) {
  const JSZip = await cargarJSZip()
  const zip = await JSZip.loadAsync(buffer)

  // Ajustar impresión a 1 sola página (evita que sobre una hoja en blanco al imprimir)
  const stylesFile = zip.file('styles.xml')
  if (stylesFile) {
    let stylesXml = await stylesFile.async('string')
    stylesXml = stylesXml.replace(
      /(<style:page-layout-properties\b[^>]*?)\bstyle:scale-to="[^"]*"([^>]*\/>)/,
      '$1style:scale-to-pages="1"$2'
    )
    // si no había scale-to (formato distinto), intentar insertar scale-to-pages igual
    if (!stylesXml.includes('style:scale-to-pages')) {
      stylesXml = stylesXml.replace(
        /(<style:page-layout-properties\b)([^>]*fo:page-width[^>]*?)(\/>)/,
        '$1$2 style:scale-to-pages="1"$3'
      )
    }
    zip.file('styles.xml', stylesXml)
  }
  const contentFile = zip.file('content.xml')
  if (!contentFile) throw new Error('El archivo no tiene la estructura interna de un .ods válido')
  let contentXml = await contentFile.async('string')

  const tableStartMatch = /<table:table\b[^>]*>/.exec(contentXml)
  const tableEndMatch = /<\/table:table>/.exec(contentXml)
  if (!tableStartMatch || !tableEndMatch) throw new Error('No se encontró la tabla en el .ods')
  const tableStart = tableStartMatch.index
  const tableEnd = tableEndMatch.index + tableEndMatch[0].length

  // Mapa de escrituras: [fila 0-idx, col 0-idx, valor, tipo]
  const escrituras = []
  escrituras.push([6, 0, datos.nombre, 'string'])
  escrituras.push([6, 3, datos.lugar, 'string'])
  escrituras.push([8, 1, datos.mesAnio, 'string'])
  escrituras.push([8, 2, datos.jerarquia, 'string'])
  escrituras.push([8, 3, datos.legajo, 'string'])
  escrituras.push([8, 5, datos.dni, 'string'])

  // días 1-16 (izquierda): filas 10-25 (0-idx), col1=horario, col2=horas
  for (let i = 0; i < 16; i++) {
    const dia = i + 1
    const fila = 10 + i
    const g = datos.gdsMap[dia]
    if (g && g.length) {
      escrituras.push([fila, 1, g[0].horario, 'string'])
      escrituras.push([fila, 2, g[0].horas, 'float'])
    }
  }
  // días 17-31 (derecha): filas 10-24 (0-idx), col4=horario, col6=horas
  for (let i = 0; i < 15; i++) {
    const dia = 17 + i
    const fila = 10 + i
    const g = datos.gdsMap[dia]
    if (g && g.length) {
      escrituras.push([fila, 4, g[0].horario, 'string'])
      escrituras.push([fila, 6, g[0].horas, 'float'])
    }
  }

  escrituras.push([25, 6, datos.totalHoras, 'float'])
  escrituras.push([26, 6, datos.total90, 'float'])
  escrituras.push([28, 0, `Declaro de conformidad, haber prestado ${datos.totalHoras} horas de servicio de Policia Adicional, en el destino que figura la presente planilla.`, 'string'])

  let table_start = tableStart, table_end = tableEnd
  for (const [fila, col, valor, tipo] of escrituras) {
    const antes = table_end
    contentXml = escribirCelda(contentXml, table_start, table_end, fila, col, valor, tipo)
    // recalcular tableEnd porque el tamaño del contenido cambió
    const nuevoTableEndMatch = /<\/table:table>/.exec(contentXml)
    table_end = nuevoTableEndMatch.index + nuevoTableEndMatch[0].length
  }

  zip.file('content.xml', contentXml)
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}

export { rellenarPlanillaOds }
