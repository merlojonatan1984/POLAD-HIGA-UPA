// pages/api/tablero-efectivos.js
//
// TEMPORAL — tablero de control de la limpieza de personal. Se borra del repositorio cuando ya no haga falta.
//
// SOLO LEE. No inserta, no modifica y no borra nada en ninguna tabla.
//
// Se abre desde el navegador, en cualquiera de los tres sitios, con el código temporal:
//   /api/tablero-efectivos?codigo=<código>
//
// Muestra, con los datos de la base al momento de abrirlo:
//   - cuántos efectivos quedan en HIGA, UPA y MODULAR
//   - femeninos / masculinos y uniformados / no uniformados
//   - en qué meses de 2026 cargó disponibilidad cada uno
//   - control de la lista de efectivos dados de baja el 08/11/2026
//   - datos que quedaron sueltos (legajos sin ficha)

import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'

export const config = { maxDuration: 60 }

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Mismo código temporal que usa prueba-disponibilidad.js
const CODIGO = '4ce167bc8dcb991f446d27cf'

const ANIO = 2026
const MES_ACTUAL = 11            // noviembre: último mes real cargado
const LUGARES = ['HIGA', 'UPA', 'MODULAR']
const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']

// Efectivos dados de baja el 08/11/2026 (tal cual los pasó el usuario)
const BAJAS = {
  HIGA: ['barrionuevo daiana', 'cejaz benitez alex manuel', 'chalu diego maximiliano', 'despoux emiliano', 'gomez romina margarita',
    'luque leticia elizabeth', 'miranda belen', 'molina maria andrea', 'porfilio lorena paola', 'rojas noelia',
    'sandoval antonella', 'segovia cruz', 'tolosa juan', 'urrutia ludmila'],
  UPA: ['burelli luis', 'castro laura', 'cugliandolo david', 'gutierrez michell'],
  MODULAR: ['aguero evelyn', 'corbela paulo', 'gomez alex damian', 'gutierrez michelle', 'julieta camaly', 'punal miriam'],
}

function codigoValido(c) {
  if (typeof c !== 'string' || c.length !== CODIGO.length) return false
  return crypto.timingSafeEqual(Buffer.from(c), Buffer.from(CODIGO))
}

const norm = x => (x === null || x === undefined) ? '' : String(x).trim().toUpperCase()
const sinTildes = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const palabras = s => sinTildes(s).replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean)
const esc = s => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

// Lee una tabla completa por páginas (Supabase entrega como máximo 1000 filas por consulta).
async function leerCols(tabla, cols, filtros) {
  const PAG = 1000
  const armar = () => {
    let q = supabase.from(tabla).select(cols)
    Object.entries(filtros || {}).forEach(([k, v]) => { q = q.eq(k, v) })
    return q.order('id', { ascending: true })
  }
  const r1 = await armar().range(0, PAG - 1)
  if (r1.error) throw new Error(`No se pudo leer ${tabla}: ${r1.error.message}`)
  const filas = r1.data || []
  if (filas.length < PAG) return filas
  for (let desde = PAG; desde < 400000; desde += PAG * 6) {
    const lotes = []
    for (let i = 0; i < 6; i++) { const d = desde + i * PAG; lotes.push(armar().range(d, d + PAG - 1)) }
    const rs = await Promise.all(lotes)
    let fin = false
    for (const r of rs) {
      if (r.error) throw new Error(`No se pudo leer ${tabla} completa: ${r.error.message}`)
      filas.push(...(r.data || []))
      if ((r.data || []).length < PAG) fin = true
    }
    if (fin) break
  }
  return filas
}

function tokenIgual(a, b) {
  if (a === b) return true
  return Math.min(a.length, b.length) >= 5 && (a.startsWith(b) || b.startsWith(a))
}
function coincide(palabrasBaja, palabrasFicha) {
  return palabrasBaja.every(pb => palabrasFicha.some(pf => tokenIgual(pb, pf)))
}

function estadisticas(lista) {
  const e = { n: lista.length, fem: 0, masc: 0, sinSexo: 0, unif: 0, noUnif: 0, tipos: {}, cruz: { unif: { f: 0, m: 0, s: 0 }, no: { f: 0, m: 0, s: 0 } } }
  lista.forEach(f => {
    if (f.sexo === 'femenino') e.fem++; else if (f.sexo === 'masculino') e.masc++; else e.sinSexo++
    if (f.unif) e.unif++; else e.noUnif++
    const t = f.tipo || 'Sin tipo'
    e.tipos[t] = (e.tipos[t] || 0) + 1
    const fila = f.unif ? e.cruz.unif : e.cruz.no
    if (f.sexo === 'femenino') fila.f++; else if (f.sexo === 'masculino') fila.m++; else fila.s++
  })
  return e
}

function barra(partes) {
  const total = partes.reduce((s, p) => s + p.v, 0) || 1
  return `<div class="barra">${partes.filter(p => p.v > 0).map(p => `<span style="width:${(p.v / total * 100).toFixed(2)}%;background:var(${p.c})" title="${esc(p.t)}: ${p.v}"></span>`).join('')}</div>`
}

function pct(a, b) { return b ? Math.round(a / b * 100) : 0 }

function seccionSitio(L, lista, st) {
  const mesesReales = MESES.slice(0, MES_ACTUAL)
  const filasMeses = MESES.map((m, i) => {
    const n = lista.filter(f => f.meses.has(i + 1)).length
    const p = pct(n, lista.length)
    const prueba = i + 1 > MES_ACTUAL
    return `<tr class="${prueba ? 'prueba' : ''}"><td>${m}${prueba ? ' <small>(prueba)</small>' : ''}</td><td class="num">${n}</td><td class="num">${p}%</td><td><div class="mini"><span style="width:${p}%"></span></div></td></tr>`
  }).join('')
  const dist = {}
  lista.forEach(f => { const k = [...f.meses].filter(m => m <= MES_ACTUAL).length; dist[k] = (dist[k] || 0) + 1 })
  const maxDist = Math.max(1, ...Object.values(dist))
  const columnas = []
  for (let k = 0; k <= MES_ACTUAL; k++) {
    const n = dist[k] || 0
    columnas.push(`<div class="col" title="${n} ${n === 1 ? 'efectivo cargó' : 'efectivos cargaron'} en ${k} ${k === 1 ? 'mes' : 'meses'}"><span class="v">${n || ''}</span><span class="b" style="height:${Math.max(n ? 4 : 0, Math.round(n / maxDist * 70))}px"></span><span class="k">${k}</span></div>`)
  }
  const nunca = dist[0] || 0
  const tiposTxt = Object.entries(st.tipos).sort((a, b) => b[1] - a[1]).map(([t, n]) => `${esc(t)}: ${n}`).join(' · ')
  return `
  <section class="sitio">
    <h3>${L} <span class="chip">${st.n} efectivos</span></h3>
    <div class="dos">
      <div class="caja">
        <h4>Sexo</h4>
        ${barra([{ v: st.fem, c: '--fem', t: 'Femenino' }, { v: st.masc, c: '--masc', t: 'Masculino' }, { v: st.sinSexo, c: '--nd', t: 'Sin dato' }])}
        <p class="leyenda"><i style="background:var(--fem)"></i>Femenino <b>${st.fem}</b> (${pct(st.fem, st.n)}%) &nbsp; <i style="background:var(--masc)"></i>Masculino <b>${st.masc}</b> (${pct(st.masc, st.n)}%)${st.sinSexo ? ` &nbsp; <i style="background:var(--nd)"></i>Sin dato <b>${st.sinSexo}</b>` : ''}</p>
        <h4>Tipo</h4>
        ${barra([{ v: st.unif, c: '--unif', t: 'Uniformado' }, { v: st.noUnif, c: '--no', t: 'No uniformado' }])}
        <p class="leyenda"><i style="background:var(--unif)"></i>Uniformados <b>${st.unif}</b> (${pct(st.unif, st.n)}%) &nbsp; <i style="background:var(--no)"></i>No uniformados <b>${st.noUnif}</b> (${pct(st.noUnif, st.n)}%)</p>
        <p class="chico">${tiposTxt}</p>
        <table class="cruz"><thead><tr><th></th><th>Fem.</th><th>Masc.</th><th>Sin dato</th><th>Total</th></tr></thead><tbody>
          <tr><td>Uniformados</td><td class="num">${st.cruz.unif.f}</td><td class="num">${st.cruz.unif.m}</td><td class="num">${st.cruz.unif.s}</td><td class="num"><b>${st.unif}</b></td></tr>
          <tr><td>No uniformados</td><td class="num">${st.cruz.no.f}</td><td class="num">${st.cruz.no.m}</td><td class="num">${st.cruz.no.s}</td><td class="num"><b>${st.noUnif}</b></td></tr>
        </tbody></table>
        <h4>Cuántos meses cargó cada uno (Ene–${mesesReales[mesesReales.length - 1]})</h4>
        <div class="histo">${columnas.join('')}</div>
        <p class="chico">Abajo: cantidad de meses (0 a ${MES_ACTUAL}). Arriba de cada barra: cuántos efectivos.</p>
        ${nunca ? `<p class="aviso">${nunca} ${nunca === 1 ? 'efectivo no cargó' : 'efectivos no cargaron'} disponibilidad en ningún mes de ${ANIO}.</p>` : ''}
      </div>
      <div class="caja">
        <h4>Quiénes cargaron disponibilidad, por mes (${ANIO})</h4>
        <table class="meses"><thead><tr><th>Mes</th><th class="num">Cargaron</th><th class="num">%</th><th></th></tr></thead><tbody>${filasMeses}</tbody></table>
      </div>
    </div>
  </section>`
}

function filaEfectivo(f, L) {
  const celdas = MESES.map((m, i) => `<td class="pt ${f.meses.has(i + 1) ? 'si' : ''} ${i + 1 > MES_ACTUAL ? 'fut' : ''}" title="${m}"></td>`).join('')
  const total = [...f.meses].filter(m => m <= MES_ACTUAL).length
  return `<tr data-l="${L}" data-s="${esc(f.sexo || 'sin dato')}" data-u="${f.unif ? 'u' : 'n'}" data-m="${total}" data-t="${esc(sinTildes(f.nombre) + ' ' + norm(f.legajo))}">
    <td>${esc(f.nombre)}</td><td class="num">${esc(f.legajo)}</td><td>${f.sexo === 'femenino' ? 'F' : f.sexo === 'masculino' ? 'M' : '—'}</td><td>${esc(f.tipo || '—')}</td>${celdas}<td class="num"><b>${total}</b></td></tr>`
}

function pagina(d) {
  const kpi = LUGARES.map(L => {
    const s = d.stats[L]
    return `<div class="kpi"><span class="et">${L}</span><b class="gr">${s.n}</b><span class="sub">F ${s.fem} · M ${s.masc}${s.sinSexo ? ` · s/d ${s.sinSexo}` : ''}</span><span class="sub">Unif. ${s.unif} · No unif. ${s.noUnif}</span></div>`
  }).join('') + `<div class="kpi tot"><span class="et">TOTAL (sin repetir)</span><b class="gr">${d.total.n}</b><span class="sub">F ${d.total.fem} · M ${d.total.masc}${d.total.sinSexo ? ` · s/d ${d.total.sinSexo}` : ''}</span><span class="sub">Unif. ${d.total.unif} · No unif. ${d.total.noUnif}</span></div>`

  const filasBajas = []
  LUGARES.forEach(L => d.control[L].forEach(b => {
    filasBajas.push(`<tr><td>${L}</td><td>${esc(b.nombre)}</td><td>${b.estado === 'ok' ? '<span class="ok">✓ Ya no figura</span>' : b.estado === 'otro' ? `<span class="inf">Ya no figura en ${L}; figura en ${esc(b.donde)}</span>` : `<span class="mal">⚠ Sigue en la lista: ${esc(b.donde)}</span>`}</td></tr>`)
  }))
  const resBajas = LUGARES.map(L => {
    const c = d.control[L]; const ok = c.filter(b => b.estado !== 'sigue').length
    return `<tr><td>${L}</td><td class="num">${c.length}</td><td class="num">${ok}</td><td class="num">${c.length - ok}</td><td class="num">${d.stats[L].n}</td><td class="num">${d.stats[L].n + ok}</td></tr>`
  }).join('')

  const detalle = LUGARES.map(L => d.listas[L].map(f => filaEfectivo(f, L)).join('')).join('')
  const sueltos = d.sueltos

  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>Tablero de efectivos</title>
<style>
:root{--bg:#f5f6f8;--card:#fff;--tx:#1b2430;--mu:#5d6a7a;--bd:#dde2e9;--ac:#1f4f8f;--fem:#8b5cc4;--masc:#2f7fd1;--nd:#aab3bf;--unif:#2f8f5b;--no:#c98a1b;--ok:#1f7a45;--mal:#b3261e;--inf:#8a6d1a}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#12161c;--card:#1b222b;--tx:#e6ebf2;--mu:#9aa7b8;--bd:#2c3642;--ac:#7fb0f0;--fem:#b48be6;--masc:#5aa0ee;--nd:#6b7787;--unif:#4fbf86;--no:#e0a63a;--ok:#5ad08f;--mal:#ff8a80;--inf:#e3c36a}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--tx);font:14px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
.w{max-width:1180px;margin:0 auto;padding:20px 16px 60px}
h1{font-size:22px;margin:0 0 4px}
h2{font-size:17px;margin:32px 0 10px;padding-bottom:6px;border-bottom:1px solid var(--bd)}
h3{font-size:16px;margin:0 0 10px;display:flex;align-items:center;gap:10px}
h4{font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:var(--mu);margin:14px 0 6px}
.mu{color:var(--mu)}
.chip{font-size:12px;font-weight:600;background:var(--bg);border:1px solid var(--bd);border-radius:20px;padding:2px 10px;color:var(--mu)}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-top:16px}
.kpi{background:var(--card);border:1px solid var(--bd);border-radius:12px;padding:14px 16px;display:flex;flex-direction:column;gap:2px}
.kpi .et{font-size:12px;font-weight:700;letter-spacing:.06em;color:var(--mu)}
.kpi .gr{font-size:38px;line-height:1.1;font-weight:700;color:var(--ac)}
.kpi .sub{font-size:13px;color:var(--mu)}
.kpi.tot{border-color:var(--ac)}
.sitio{background:var(--card);border:1px solid var(--bd);border-radius:12px;padding:16px;margin-bottom:16px}
.dos{display:grid;grid-template-columns:1fr 1fr;gap:20px}
@media (max-width:780px){.dos{grid-template-columns:1fr}}
.barra{display:flex;height:16px;border-radius:8px;overflow:hidden;background:var(--bd)}
.barra span{display:block;height:100%}
.leyenda{margin:6px 0 0;font-size:13px}
.leyenda i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:4px;vertical-align:-1px}
.chico{font-size:12px;color:var(--mu);margin:6px 0}
table{border-collapse:collapse;width:100%}
th,td{padding:5px 8px;border-bottom:1px solid var(--bd);text-align:left;font-size:13px}
th{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--mu);font-weight:600}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
.cruz th:not(:first-child),.cruz td:not(:first-child){text-align:right}
.meses td:first-child{width:90px}
.histo{display:flex;gap:4px;align-items:flex-end;height:104px;margin-top:4px}
.histo .col{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:2px}
.histo .b{width:100%;background:var(--ac);border-radius:3px 3px 0 0}
.histo .v{font-size:11px;color:var(--mu);height:14px;line-height:14px}
.histo .k{font-size:11px;color:var(--mu);border-top:1px solid var(--bd);width:100%;text-align:center;padding-top:2px}
.mini{height:8px;background:var(--bd);border-radius:4px;overflow:hidden;min-width:60px}
.mini span{display:block;height:100%;background:var(--ac)}
tr.prueba td{color:var(--mu)}
small{color:var(--mu)}
.aviso{margin:10px 0 0;padding:8px 10px;border-radius:8px;background:var(--bg);border-left:3px solid var(--no);font-size:13px}
.tabs{display:flex;gap:6px;flex-wrap:wrap;margin:10px 0}
.tabs button,.filtros select,.filtros input{font:inherit;padding:6px 12px;border:1px solid var(--bd);border-radius:8px;background:var(--card);color:var(--tx)}
.tabs button{cursor:pointer}
.tabs button.on{background:var(--ac);color:var(--bg);border-color:var(--ac);font-weight:600}
.filtros{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px}
.filtros input{min-width:200px;flex:1}
.scroll{overflow-x:auto;background:var(--card);border:1px solid var(--bd);border-radius:12px}
.det td:nth-child(n+5):nth-child(-n+16){padding:3px 2px}
td.pt{width:16px;min-width:16px;text-align:center}
td.pt::before{content:"";display:inline-block;width:11px;height:11px;border-radius:3px;background:var(--bd)}
td.pt.si::before{background:var(--ok)}
td.pt.fut::before{opacity:.45}
.det th.m{text-align:center;padding:5px 0;font-size:10px}
.ok{color:var(--ok);font-weight:600}.mal{color:var(--mal);font-weight:600}.inf{color:var(--inf)}
details{margin-top:10px}
summary{cursor:pointer;color:var(--ac)}
.pie{margin-top:30px;color:var(--mu);font-size:12px}
</style></head><body><div class="w">
<h1>Tablero de efectivos</h1>
<div class="mu">Datos leídos de la base ahora: ${esc(d.hora)} · Solo lectura, no se modificó nada.</div>
<div class="kpis">${kpi}</div>
<p class="chico">Se cuentan las fichas de personal (sin administradores). Una ficha con dos lugares cuenta en cada uno; el total no la repite. ${d.sinLugar ? `Fichas sin ningún lugar válido: ${d.sinLugar}.` : ''}</p>

<h2>Sexo, tipo y meses cargados por sitio</h2>
${LUGARES.map(L => seccionSitio(L, d.listas[L], d.stats[L])).join('')}
<p class="chico">Enero a noviembre son meses reales. Diciembre aparece atenuado porque es la prueba (su disponibilidad puede estar borrada). El conteo de "cuántos meses" llega hasta noviembre.</p>

<h2>Control de la limpieza (bajas del 08/11)</h2>
<table style="max-width:640px"><thead><tr><th>Sitio</th><th class="num">En la lista de bajas</th><th class="num">Ya no figuran</th><th class="num">Siguen</th><th class="num">Quedan hoy</th><th class="num">Antes (estimado)</th></tr></thead><tbody>${resBajas}</tbody></table>
<p class="chico">"Antes" = quedan hoy + los que ya no figuran. La comparación es por nombre; si la ficha está escrita distinto puede no detectarse.</p>
<details><summary>Ver los ${d.totalBajas} nombres uno por uno</summary><table style="margin-top:8px"><thead><tr><th>Sitio</th><th>Nombre</th><th>Estado</th></tr></thead><tbody>${filasBajas.join('')}</tbody></table></details>

<h2>Datos sueltos (legajos sin ficha)</h2>
<p>Disponibilidad ${ANIO}: <b>${sueltos.disp.length}</b> legajos sin ficha${sueltos.disp.length ? ` (${sueltos.filasDisp} filas)` : ''}. Guardias de noviembre ${ANIO}: <b>${sueltos.turnos.length}</b> legajos sin ficha${sueltos.turnos.length ? ` (${sueltos.filasTurnos} guardias)` : ''}.</p>
<p class="chico">Son datos de personas dadas de baja: la baja borra solo la ficha. No se tocó nada.</p>
${sueltos.disp.length || sueltos.turnos.length ? `<details><summary>Ver legajos</summary><p class="chico">Disponibilidad: ${esc(sueltos.disp.slice(0, 120).join(', ')) || '—'}${sueltos.disp.length > 120 ? ' …' : ''}<br>Guardias de noviembre: ${esc(sueltos.turnos.slice(0, 120).join(', ')) || '—'}${sueltos.turnos.length > 120 ? ' …' : ''}</p></details>` : ''}

<h2>Detalle por efectivo</h2>
<div class="tabs" id="tabs">${LUGARES.map((L, i) => `<button data-l="${L}" class="${i === 0 ? 'on' : ''}">${L} (${d.stats[L].n})</button>`).join('')}</div>
<div class="filtros">
  <input id="q" type="search" placeholder="Buscar por nombre o legajo">
  <select id="fs"><option value="">Sexo: todos</option><option value="femenino">Femenino</option><option value="masculino">Masculino</option><option value="sin dato">Sin dato</option></select>
  <select id="fu"><option value="">Tipo: todos</option><option value="u">Uniformados</option><option value="n">No uniformados</option></select>
  <select id="fm"><option value="">Meses cargados: todos</option><option value="0">Ninguno</option><option value="1">1 o menos</option><option value="3">3 o menos</option><option value="6">6 o menos</option></select>
</div>
<div class="scroll"><table class="det"><thead><tr><th>Nombre</th><th class="num">Legajo</th><th>Sexo</th><th>Tipo</th>${MESES.map(m => `<th class="m">${m[0]}</th>`).join('')}<th class="num">Meses</th></tr></thead><tbody id="cuerpo">${detalle}</tbody></table></div>
<p class="chico" id="cuenta"></p>
<p class="pie">Cada cuadrito verde es un mes (Ene a Dic ${ANIO}) en el que el efectivo cargó disponibilidad. "Meses" cuenta de enero a noviembre.</p>
</div>
<script>
(function(){
  var lugar='${LUGARES[0]}';
  var f=function(id){return document.getElementById(id)};
  function aplicar(){
    var q=f('q').value.trim().toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g,''),s=f('fs').value,u=f('fu').value,m=f('fm').value,n=0;
    document.querySelectorAll('#cuerpo tr').forEach(function(tr){
      var ok=tr.dataset.l===lugar&&(!q||tr.dataset.t.indexOf(q)>=0)&&(!s||tr.dataset.s===s)&&(!u||tr.dataset.u===u)&&(m===''||parseInt(tr.dataset.m,10)<=parseInt(m,10));
      tr.style.display=ok?'':'none';if(ok)n++;
    });
    f('cuenta').textContent=n+' efectivos en la lista';
  }
  document.querySelectorAll('#tabs button').forEach(function(b){b.onclick=function(){
    lugar=b.dataset.l;document.querySelectorAll('#tabs button').forEach(function(x){x.classList.toggle('on',x===b)});aplicar()}});
  ['q','fs','fu','fm'].forEach(function(id){f(id).addEventListener('input',aplicar)});
  aplicar();
})();
</script></body></html>`
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).send('Método no permitido')
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Robots-Tag', 'noindex')
  if (!codigoValido((req.query || {}).codigo)) {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    return res.status(401).send('ERROR: No autorizado.')
  }
  try {
    const [efectivos, disp, turnosNov] = await Promise.all([
      leerCols('efectivos', 'legajo,nombre,tipo,sexo,es_admin,lugar', null),
      leerCols('disponibilidad', 'legajo,mes,anio', { anio: ANIO }),
      leerCols('turnos', 'legajo,mes,anio', { mes: MES_ACTUAL, anio: ANIO }),
    ])

    const mesesPorLegajo = new Map()
    disp.forEach(r => {
      const k = norm(r.legajo); if (!k) return
      if (!mesesPorLegajo.has(k)) mesesPorLegajo.set(k, new Set())
      mesesPorLegajo.get(k).add(Number(r.mes))
    })

    const fichas = efectivos.filter(e => e.es_admin === false).map(e => {
      const sx = String(e.sexo || '').trim().toLowerCase()
      return {
        legajo: e.legajo, k: norm(e.legajo), nombre: e.nombre || '', tipo: String(e.tipo || '').trim(),
        unif: sinTildes(e.tipo).trim() === 'uniformado',
        sexo: (sx === 'femenino' || sx === 'masculino') ? sx : '',
        lugares: String(e.lugar || '').split(',').map(norm).filter(Boolean),
        meses: mesesPorLegajo.get(norm(e.legajo)) || new Set(),
        pal: palabras(e.nombre),
      }
    })

    const listas = {}, stats = {}
    LUGARES.forEach(L => {
      listas[L] = fichas.filter(f => f.lugares.includes(L)).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
      stats[L] = estadisticas(listas[L])
    })
    const unicas = []
    const vistos = new Set()
    fichas.forEach(f => { if (f.lugares.some(l => LUGARES.includes(l)) && !vistos.has(f.k)) { vistos.add(f.k); unicas.push(f) } })
    const total = estadisticas(unicas)
    const sinLugar = fichas.filter(f => !f.lugares.some(l => LUGARES.includes(l))).length

    // Control de la lista de bajas
    const control = {}
    let totalBajas = 0
    LUGARES.forEach(L => {
      control[L] = (BAJAS[L] || []).map(nombre => {
        totalBajas++
        const pb = palabras(nombre)
        const aqui = listas[L].filter(f => coincide(pb, f.pal))
        if (aqui.length) return { nombre, estado: 'sigue', donde: aqui.map(f => `${f.nombre} (legajo ${f.legajo})`).join(' / ') }
        const otro = fichas.filter(f => coincide(pb, f.pal))
        if (otro.length) return { nombre, estado: 'otro', donde: otro.map(f => `${f.nombre} (${f.lugares.join(',') || 'sin lugar'})`).join(' / ') }
        return { nombre, estado: 'ok' }
      })
    })

    // Legajos con datos pero sin ninguna ficha
    const conFicha = new Set(efectivos.map(e => norm(e.legajo)))
    const sueltosDisp = [...mesesPorLegajo.keys()].filter(k => !conFicha.has(k)).sort()
    const filasDisp = disp.filter(r => !conFicha.has(norm(r.legajo))).length
    const tNov = turnosNov.filter(r => !conFicha.has(norm(r.legajo)))
    const sueltosTurnos = [...new Set(tNov.map(r => norm(r.legajo)))].filter(Boolean).sort()

    const hora = new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', dateStyle: 'short', timeStyle: 'short' })
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    return res.status(200).send(pagina({
      hora, listas, stats, total, sinLugar, control, totalBajas,
      sueltos: { disp: sueltosDisp, filasDisp, turnos: sueltosTurnos, filasTurnos: tNov.length },
    }))
  } catch (e) {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    return res.status(500).send('ERROR: ' + (e && e.message ? e.message : 'no se pudo armar el tablero'))
  }
}
