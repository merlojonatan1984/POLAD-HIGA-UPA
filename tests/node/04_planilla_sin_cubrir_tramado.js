// tests/node/04_planilla_sin_cubrir_tramado.js
//
// Punto 5 de esta ronda ("Planilla para imprimir"): prueba REAL de
// JavaScript + ExcelJS real (sin red, sin base de datos) de las DOS
// técnicas de celda que usa pages/api/generar-planilla.js para distinguir,
// incluso impreso en blanco y negro:
//   - "no corresponde cubrir" (p.ej. Rondín Externo de día, cupo 0; el
//     2do espacio de Salud Mental/Llaves de noche, cupo 1) -> TRAMADO
//     (pattern 'darkTrellis'), nunca "SIN CUBRIR".
//   - vacante real dentro del cupo, sin nadie asignado -> celda NEGRA
//     sólida con texto BLANCO "SIN CUBRIR".
//
// cupoHIGA/CUPO_POR_SECTOR_TURNO y las dos funciones de fill están
// copiadas literalmente de generar-planilla.js (líneas ~111-143 y
// ~242-254) para probar la técnica exacta, no una reimplementación
// aparte. Esto NO reemplaza correr el endpoint completo
// /api/generar-planilla contra datos reales de Supabase — no disponible
// en este entorno (sin acceso a ningún proyecto Supabase real) — solo
// prueba, contra un .xlsx real escrito Y RELEÍDO con ExcelJS, que la
// técnica de estilo que usa ese endpoint es válida y persiste tal como se
// pide.
//
// Corre con: node tests/node/04_planilla_sin_cubrir_tramado.js

const path = require('path')
const ExcelJS = require(path.join(__dirname, '..', '..', 'node_modules', 'exceljs'))

function fill(color) { return { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + color } } }
function fillTramado(fg = '999999', bg = 'FFFFFF') {
  return { type: 'pattern', pattern: 'darkTrellis', fgColor: { argb: 'FF' + fg }, bgColor: { argb: 'FF' + bg } }
}
const CUPO_POR_SECTOR_TURNO = {
  'Salud Mental':   { d: 2, n: 1 },
  'Llaves':         { d: 2, n: 1 },
  'Rondin Externo': { d: 0, n: 2 },
}
function cupoHIGA(sector, turno) {
  const porTurno = CUPO_POR_SECTOR_TURNO[sector]
  if (porTurno && turno in porTurno) return porTurno[turno]
  return 2
}

async function main() {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Verificación')
  const casos = [
    ['Rondin Externo', 'd', 0], // cupo 0 -> ambos slots NO CORRESPONDE
    ['Rondin Externo', 'd', 1],
    ['Salud Mental',   'n', 0], // cupo 1 -> slot 0 cubrible/SIN CUBRIR, slot 1 NO CORRESPONDE
    ['Salud Mental',   'n', 1],
    ['Llaves',         'n', 0],
    ['Llaves',         'n', 1],
    ['Guardia',        'd', 0], // cupo 2 (default) -> ambos slots dentro de cupo
    ['Guardia',        'd', 1],
  ]
  let row = 1
  const resultados = []
  for (const [sec, turno, ei] of casos) {
    const cupo = cupoHIGA(sec, turno)
    const noAplica = ei >= cupo
    const c = ws.getCell(row, 1)
    c.value = `${sec}/${turno}/ei${ei}`
    const d = ws.getCell(row, 2)
    if (noAplica) {
      d.value = ei === 0 ? 'NO CORRESPONDE' : ''
      d.font = { name: 'Arial', size: 6, italic: true, color: { argb: 'FF666666' } }
      d.fill = fillTramado('999999', 'FFFFFF')
    } else {
      d.value = 'SIN CUBRIR'
      d.font = { name: 'Arial', bold: true, size: 6.5, color: { argb: 'FFFFFFFF' } }
      d.fill = fill('000000')
    }
    resultados.push({ sec, turno, ei, cupo, noAplica, texto: d.value, pattern: d.fill.pattern })
    row++
  }

  const os = require('os')
  const fs = require('fs')
  const outPath = path.join(os.tmpdir(), `polad_verif_sin_cubrir_tramado_${process.pid}.xlsx`)
  await wb.xlsx.writeFile(outPath)

  // Releer el archivo recién escrito con ExcelJS (no asumir que "no tiró
  // excepción al escribir" alcanza) y confirmar que los fills/patterns
  // persistieron tal como se pidieron.
  const wb2 = new ExcelJS.Workbook()
  await wb2.xlsx.readFile(outPath)
  const ws2 = wb2.getWorksheet('Verificación')

  let ok = 0
  for (let i = 0; i < resultados.length; i++) {
    const esperado = resultados[i]
    const celda = ws2.getCell(i + 1, 2)
    const patronLeido = celda.fill && celda.fill.pattern
    const valorLeido = celda.value
    const colorLeido = celda.fill && celda.fill.fgColor && celda.fill.fgColor.argb
    const condPattern = patronLeido === esperado.pattern
    const condValor = String(valorLeido || '') === String(esperado.texto || '')
    const condColor = esperado.noAplica ? colorLeido === 'FF999999' : colorLeido === 'FF000000'
    if (!condPattern || !condValor || !condColor) {
      console.error(`FALLO fila ${i + 1} (${esperado.sec}/${esperado.turno}/ei${esperado.ei}): pattern leído=${patronLeido} esperado=${esperado.pattern}; valor leído=${JSON.stringify(valorLeido)} esperado=${JSON.stringify(esperado.texto)}; color leído=${colorLeido}`)
      process.exit(1)
    }
    console.log(`  ok  — ${esperado.sec}/${esperado.turno} ei=${esperado.ei} (cupo=${esperado.cupo}): ${esperado.noAplica ? 'TRAMADO darkTrellis + "' + esperado.texto + '" gris' : 'NEGRO sólido + "SIN CUBRIR" blanco'} — persistió correctamente al releer el .xlsx real`)
    ok++
  }
  fs.unlinkSync(outPath)
  console.log(`\n${ok} verificaciones pasaron. Confirma: (a) ExcelJS acepta y escribe el pattern "darkTrellis" sin error; (b) tras escribir Y RELEER el .xlsx, el pattern/color/texto de cada celda coincide exactamente con la regla de cupo real de Rondín Externo (día, cupo 0) y Salud Mental/Llaves (noche, cupo 1) pedida en el Punto 5; (c) esto NO reemplaza correr el endpoint completo /api/generar-planilla contra datos reales de Supabase (no disponible en este entorno) — solo prueba que la técnica de estilo exacta que usa ese endpoint es válida y persiste.`)
}
main().catch(e => { console.error('FALLO (excepción):', e); process.exit(1) })
