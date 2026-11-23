// v240: qué días le faltan a Estadísticas. El historial trae los últimos 30
// partidos pasados; con más de 30 en el mes, Día y Mes quedaban cortos (en
// noviembre de 2026 arrancaban el 9/11). Estadísticas pide una sola vez lo que
// falta, del 1 del mes hasta el día anterior al más viejo ya cargado.
import { addDays } from './dates.js';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-\d{2}$/;
const YEAR = /^\d{4}$/;

function monthEnd(ym) {
  const [y, m] = ym.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${ym}-${String(last).padStart(2, '0')}`;
}

/** «2026-11» menos n meses. */
export function shiftMonth(ym, n) {
  if (!MONTH.test(ym || '')) return '';
  const [y, m] = ym.split('-').map(Number);
  const total = y * 12 + (m - 1) + Number(n || 0);
  const year = Math.floor(total / 12);
  const month = total - year * 12 + 1;
  return `${year}-${String(month).padStart(2, '0')}`;
}

/** Días pasados de un mes: del 1 al último, sin llegar a hoy. Null si no hay ninguno. */
export function monthRange(ym, today) {
  if (!MONTH.test(ym || '') || !DAY.test(today || '')) return null;
  const yesterday = addDays(today, -1);
  const from = `${ym}-01`;
  const end = monthEnd(ym);
  const to = end < yesterday ? end : yesterday;
  return from <= to ? { from, to } : null;
}

/**
 * Los rangos que necesita la pantalla. Siempre el mes en curso. Un mes, un
 * día de otro mes o el año, solo cuando se eligen. `monthsBack`: los meses
 * anteriores que se pidieron con «Ver mes anterior».
 */
export function statsRangesFor({ mode, id = '', today, monthsBack = 0 } = {}) {
  if (!DAY.test(today || '')) return [];
  const out = [];
  const push = (range) => {
    if (range && !out.some((row) => row.from === range.from && row.to === range.to)) out.push(range);
  };
  const current = today.slice(0, 7);
  push(monthRange(current, today));
  const back = Math.max(0, Math.min(24, Number(monthsBack) || 0));
  for (let i = 1; i <= back; i += 1) push(monthRange(shiftMonth(current, -i), today));
  const key = String(id || '');
  if (mode === 'mes' && MONTH.test(key)) push(monthRange(key, today));
  if (mode === 'dia' && DAY.test(key)) push(monthRange(key.slice(0, 7), today));
  if (mode === 'anio') {
    const year = YEAR.test(key) ? key : today.slice(0, 4);
    const yesterday = addDays(today, -1);
    const to = `${year}-12-31` < yesterday ? `${year}-12-31` : yesterday;
    const from = `${year}-01-01`;
    if (from <= to) push({ from, to });
  }
  return out;
}

/**
 * Lo que hay que pedir de un rango. `loaded`: el historial reciente
 * ({ ready, hasMore, oldest }); null si el historial está filtrado por fecha
 * (entonces no sirve de base y se pide el rango entero). `covered`: lo que ya
 * se pidió en esta sesión. Null si no falta nada o todavía no se sabe.
 */
export function statsFetchRange({ from, to, loaded = null, covered = [] } = {}) {
  if (!DAY.test(from || '') || !DAY.test(to || '') || from > to) return null;
  let end = to;
  if (loaded) {
    if (!loaded.ready) return null;
    // El historial ya trajo todos los partidos pasados.
    if (!loaded.hasMore) return null;
    if (DAY.test(loaded.oldest || '')) {
      const before = addDays(loaded.oldest, -1);
      if (before < end) end = before;
    }
  }
  if (from > end) return null;
  if ((covered || []).some((row) => row && row.from <= from && row.to >= end)) return null;
  return { from, to: end };
}

/** Une lo cargado con lo que trajo Estadísticas. Lo cargado gana (está en vivo). */
export function mergeById(live, extra) {
  const list = Array.isArray(live) ? live : [];
  if (!Array.isArray(extra) || !extra.length) return list;
  const seen = new Set(list.map((row) => row?.id).filter(Boolean));
  const add = extra.filter((row) => row?.id && !seen.has(row.id));
  return add.length ? list.concat(add) : list;
}
