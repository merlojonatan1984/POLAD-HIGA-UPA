// lib/supabaseAdminProxy.js
//
// Paso 6b (seguridad) — hasta ahora, admin.js hablaba DIRECTO con la base
// de datos desde el navegador usando la clave "anon" (pública: viaja
// dentro del código de la página, cualquiera que abra las herramientas de
// desarrollador del navegador la puede ver). Con esa clave, y sabiendo la
// dirección de la base (también pública), cualquiera podía leer o
// modificar turnos, efectivos, etc. directamente, sin pasar por el login
// de la aplicación.
//
// Esto reemplaza esa conexión directa por una que pasa por el servidor
// (/api/admin-db), que es el único que tiene la clave de servicio real
// (nunca viaja al navegador) y que además exige probar que quien pregunta
// inició sesión como administrador (ver sesionAdmin() más abajo y
// pages/api/auth-login.js). admin.js no tuvo que cambiar en sus ~60
// lugares que usan supabase.from(...): este archivo imita exactamente la
// misma forma de escribir (.from().select().eq()... etc.) que ya usaba el
// cliente real de Supabase, así que alcanza con cambiar de dónde se
// importa "supabase" en la parte de arriba del archivo.
//
// Si el servidor contesta que la sesión venció o no es válida (por
// ejemplo, alguien que ya estaba adentro desde antes de este cambio, o
// pasaron más de 12hs), se limpia la sesión guardada y se manda de vuelta
// a la pantalla de login — en vez de quedar con pantallas a medio cargar
// o errores confusos.
//
// Nota sobre storage (subir/borrar la "planilla" de un efectivo):
// subir un archivo (uploadToSignedUrl) ya era seguro tal cual estaba —
// usa una URL firmada de un solo uso que se pide a
// /api/crear-url-planilla — y getPublicUrl no hace ninguna llamada de
// red, solo arma el texto de la dirección pública, así que ninguna de
// las dos necesitaba cambiar. Se mantienen con el cliente liviano de
// siempre (clave anon, igual que antes: no hay nada ahí para proteger).
// Solo "remove" (borrar un archivo) sí escribía con la clave anon, así
// que ese se manda a /api/admin-storage-remove.
import { createClient } from '@supabase/supabase-js'

const storageClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

function sesionAdmin() {
  try {
    return localStorage.getItem('polad_session') || ''
  } catch (e) {
    return ''
  }
}

// admin.js dispara varios pedidos a la vez al cargar una pantalla (p.ej.
// cargarTodo hace varias lecturas en paralelo con Promise.all) — si la
// sesión venció, TODOS esos pedidos vuelven con 401 casi al mismo tiempo.
// Sin esta bandera, cada uno dispararía su propio cartel y su propia
// redirección por separado (varios "Tu sesión venció" apilados, uno atrás
// del otro). Con la bandera, solo el primero actúa.
let yaAvisoSesionVencida = false
function sesionVencida() {
  if (yaAvisoSesionVencida) return
  yaAvisoSesionVencida = true
  try {
    localStorage.removeItem('polad_user')
    localStorage.removeItem('polad_session')
  } catch (e) {}
  if (typeof window !== 'undefined') {
    alert('Tu sesión venció o no es válida. Volvé a entrar con tu legajo y contraseña.')
    window.location.href = '/'
  }
}

function crearQuery(tabla) {
  const estado = {
    tabla,
    op: null, // 'select' | 'insert' | 'update' | 'delete'
    columnas: '*',
    valores: null,
    filtros: [],
    orden: null,
    limite: null,
    modoSingle: null, // 'maybeSingle' | 'single'
  }
  let promesaCache = null

  async function ejecutar() {
    let resp
    try {
      resp = await fetch('/api/admin-db', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: sesionAdmin(), ...estado }),
      })
    } catch (eRed) {
      return { data: null, error: { message: `Error de red (${eRed.message})` } }
    }
    let body
    try { body = await resp.json() } catch (eJson) { body = {} }
    if (resp.status === 401) {
      sesionVencida()
      return { data: null, error: { message: 'Sesión vencida.' } }
    }
    if (!resp.ok) {
      return { data: null, error: { message: body.error || `Error ${resp.status}` } }
    }
    let data = body.data
    if (estado.modoSingle === 'maybeSingle') data = Array.isArray(data) ? (data[0] ?? null) : (data ?? null)
    else if (estado.modoSingle === 'single') data = Array.isArray(data) ? data[0] : data
    return { data, error: null }
  }

  function ejecutarUnaVez() {
    if (!promesaCache) promesaCache = ejecutar()
    return promesaCache
  }

  const builder = {
    select(cols) {
      if (!estado.op) estado.op = 'select'
      estado.columnas = cols || '*'
      return builder
    },
    insert(valores) { estado.op = 'insert'; estado.valores = valores; return builder },
    update(valores) { estado.op = 'update'; estado.valores = valores; return builder },
    delete() { estado.op = 'delete'; return builder },
    eq(col, val) { estado.filtros.push({ col, tipo: 'eq', val }); return builder },
    in(col, val) { estado.filtros.push({ col, tipo: 'in', val }); return builder },
    match(obj) { estado.filtros.push({ col: null, tipo: 'match', val: obj }); return builder },
    order(col, opts) { estado.orden = { col, ascending: !opts || opts.ascending !== false }; return builder },
    limit(n) { estado.limite = n; return builder },
    maybeSingle() { estado.modoSingle = 'maybeSingle'; return ejecutarUnaVez() },
    single() { estado.modoSingle = 'single'; return ejecutarUnaVez() },
    then(onFulfilled, onRejected) { return ejecutarUnaVez().then(onFulfilled, onRejected) },
    catch(onRejected) { return ejecutarUnaVez().catch(onRejected) },
  }
  return builder
}

async function removerArchivo(bucket, paths) {
  if (bucket !== 'planillas') {
    return { data: null, error: { message: `Depósito "${bucket}" no soportado acá.` } }
  }
  const lista = Array.isArray(paths) ? paths : [paths]
  let resp
  try {
    resp = await fetch('/api/admin-storage-remove', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: sesionAdmin(), paths: lista }),
    })
  } catch (eRed) {
    return { data: null, error: { message: `Error de red (${eRed.message})` } }
  }
  let body
  try { body = await resp.json() } catch (eJson) { body = {} }
  if (resp.status === 401) {
    sesionVencida()
    return { data: null, error: { message: 'Sesión vencida.' } }
  }
  if (!resp.ok) return { data: null, error: { message: body.error || `Error ${resp.status}` } }
  return { data: null, error: null }
}

export const supabase = {
  from(tabla) { return crearQuery(tabla) },
  storage: {
    from(bucket) {
      return {
        uploadToSignedUrl: (...args) => storageClient.storage.from(bucket).uploadToSignedUrl(...args),
        getPublicUrl: (...args) => storageClient.storage.from(bucket).getPublicUrl(...args),
        remove: (paths) => removerArchivo(bucket, paths),
      }
    },
  },
}
