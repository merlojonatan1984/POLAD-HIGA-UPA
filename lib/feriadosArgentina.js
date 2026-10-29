// lib/feriadosArgentina.js
//
// Pedido de esta ronda: marcar, tanto en la planilla para imprimir
// (pages/api/generar-planilla.js) como en las pantallas del sistema
// (pages/admin.js), los fines de semana (sábado/domingo) y los feriados —
// nacionales y, donde corresponde, el feriado local de Mar del Plata — con
// un color llamativo.
//
// FERIADOS_POR_ANIO abajo es la lista de feriados NACIONALES de Argentina
// para 2026, confirmada contra fuentes de prensa de octubre 2026 (incluye
// los feriados trasladables YA con su fecha final de 2026: Güemes al lunes
// 15/6, Día de la Soberanía Nacional al lunes 23/11). Se incluyen también
// los dos "días no laborables con fines turísticos" (10/7 y 7/12) porque
// para una guardia de seguridad son igual de relevantes que un feriado
// (hay que seguir cubriendo el puesto).
//
// Importante sobre "feriados provinciales de Buenos Aires": la provincia de
// Buenos Aires NO tiene, además de los nacionales, un feriado propio que
// rija para TODA la provincia — lo que existe es un "día no laborable"
// propio de cada partido/localidad, por su aniversario de fundación (ej.
// Mar del Plata, Saladillo, Junín, cada una con su propia fecha). Como este
// sistema es el de POLAD en Mar del Plata (ver el mensaje de WhatsApp en
// pages/admin.js, que ya dice "POLAD · {lugar} · Mar del Plata"), se
// incluye acá el aniversario de fundación de Mar del Plata (10 de febrero)
// como el feriado "local" — si en algún momento esto tiene que cubrir otra
// ciudad, ese es el único dato que habría que cambiar.
//
// Los feriados se repiten cada año en fecha fija salvo los que depende de
// Pascua (Carnaval, Jueves/Viernes Santo) y los trasladables (que el
// Gobierno define por decreto, normalmente a mediados del año anterior) —
// por eso esta tabla es POR AÑO, no una fórmula: para habilitar años
// futuros hace falta agregar la fila de ese año cuando el decreto esté
// confirmado (se puede pedir ayuda para eso llegado el momento).

const FERIADOS_POR_ANIO = {
  2026: [
    { mes: 1, dia: 1, nombre: 'Año Nuevo' },
    { mes: 2, dia: 10, nombre: 'Aniversario de Mar del Plata', local: true },
    { mes: 2, dia: 16, nombre: 'Carnaval' },
    { mes: 2, dia: 17, nombre: 'Carnaval' },
    { mes: 3, dia: 24, nombre: 'Día Nacional de la Memoria por la Verdad y la Justicia' },
    { mes: 4, dia: 2, nombre: 'Día del Veterano y de los Caídos en la Guerra de Malvinas / Jueves Santo' },
    { mes: 4, dia: 3, nombre: 'Viernes Santo' },
    { mes: 5, dia: 1, nombre: 'Día del Trabajador' },
    { mes: 5, dia: 25, nombre: 'Día de la Revolución de Mayo' },
    { mes: 6, dia: 15, nombre: 'Paso a la Inmortalidad del Gral. Güemes (trasladado)' },
    { mes: 6, dia: 20, nombre: 'Paso a la Inmortalidad del Gral. Belgrano' },
    { mes: 7, dia: 9, nombre: 'Día de la Independencia' },
    { mes: 7, dia: 10, nombre: 'Día no laborable (fines turísticos)' },
    { mes: 8, dia: 17, nombre: 'Paso a la Inmortalidad del Gral. San Martín' },
    { mes: 10, dia: 12, nombre: 'Día del Respeto a la Diversidad Cultural' },
    { mes: 11, dia: 23, nombre: 'Día de la Soberanía Nacional (trasladado)' },
    { mes: 12, dia: 7, nombre: 'Día no laborable (fines turísticos)' },
    { mes: 12, dia: 8, nombre: 'Inmaculada Concepción de María' },
    { mes: 12, dia: 25, nombre: 'Navidad' },
  ],
}

// true si dia/mes/anio cae sábado o domingo.
function esFinDeSemana(dia, mes, anio) {
  const d = new Date(anio, mes - 1, dia).getDay() // 0=domingo, 6=sábado
  return d === 0 || d === 6
}

// { esFeriado: bool, nombre: string|null } — nunca tira error si el año
// todavía no está cargado en la tabla (devuelve esFeriado:false).
function infoFeriado(dia, mes, anio) {
  const lista = FERIADOS_POR_ANIO[anio] || []
  const f = lista.find(x => x.dia === dia && x.mes === mes)
  return { esFeriado: !!f, nombre: f ? f.nombre : null }
}

// Combina los dos casos para pintar un día del calendario: devuelve
// { marcar: bool, motivo: 'feriado'|'finde'|null, nombre: string|null }
function infoDiaEspecial(dia, mes, anio) {
  const feriado = infoFeriado(dia, mes, anio)
  if (feriado.esFeriado) return { marcar: true, motivo: 'feriado', nombre: feriado.nombre }
  if (esFinDeSemana(dia, mes, anio)) return { marcar: true, motivo: 'finde', nombre: null }
  return { marcar: false, motivo: null, nombre: null }
}

module.exports = { FERIADOS_POR_ANIO, esFinDeSemana, infoFeriado, infoDiaEspecial }
