// pages/api/login.js
//
// Punto de revisión 7 y 8 ("revisá las rutas antiguas para que no permitan
// eludir la autenticación nueva"): esta ruta es ANTERIOR al login nuevo
// (pages/api/auth-login.js). Tal como estaba, era una vulnerabilidad grave
// por dos motivos a la vez:
//   1) No pedía ninguna contraseña — solo un legajo — y devolvía "login
//      exitoso" igual.
//   2) Devolvía la fila COMPLETA de `efectivos`, incluyendo la contraseña
//      en texto plano, al navegador.
// Ningún código del frontend llama hoy a esta ruta (se verificó con una
// búsqueda en todo el proyecto), pero al ser una ruta de Next.js queda
// igual accesible públicamente mientras exista el archivo — así que el
// problema no es solo de UI, sino del servidor. No se puede "ocultar" este
// endpoint; hay que desactivarlo. No se borra el archivo (se conserva su
// historia/ubicación), pero ya no autentica ni devuelve datos de nadie: no
// toca la base de datos en absoluto.
//
// Si en algún momento se necesitara reintroducir un login legado, debe
// construirse sobre el mismo esquema que pages/api/auth-login.js (verificar
// contraseña en el servidor, emitir la cookie de sesión firmada, y nunca
// devolver el registro completo del efectivo).

export default async function handler(req, res) {
  return res.status(410).json({
    error: 'Esta ruta de login quedó deshabilitada por motivos de seguridad (no verificaba contraseña y exponía datos). Usá /api/auth-login.'
  })
}
