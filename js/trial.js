// Versión de prueba en /prueba/. No toca la app de producción.
// En Node (pruebas) no hay location: se usa el sitio publicado.

export const PRODUCTION_ORIGIN = 'https://gustavofarg-hash.github.io/partidos';
export const PRODUCTION_PROJECT_ID = 'futbol-partidos';
export const TRIAL_STORAGE_PREFIX = 'prueba:';

/** Carpetas o archivos de la app cuando corre en la raíz (local o emulador). */
const ROOT_APP_SEGMENTS = new Set([
  'c', 'js', 'icons', 'tests', 'docs', 'functions', 'css',
]);

export function isTrialPath(pathname) {
  return /\/prueba(\/|$)/.test(String(pathname || ''));
}

function isRootAppSegment(seg) {
  return !seg || /\./.test(seg) || ROOT_APP_SEGMENTS.has(seg);
}

/** Ruta base de la app: /partidos, /futbol-colegiales, /partidos/prueba, o '' en la raíz. */
export function appBasePath(pathname) {
  const path = String(pathname || '');
  if (isTrialPath(path)) {
    const root = path.split(/\/prueba(\/|$)/)[0];
    return `${root}/prueba`;
  }
  const match = path.match(/^\/([^/]+)/);
  if (!match || isRootAppSegment(match[1])) return '';
  return `/${match[1]}`;
}

/** Origen público de los links. Sale de location; si no hay carpeta, el sitio publicado. */
export function publicAppOriginFrom(pathname, pageOrigin) {
  const host = String(pageOrigin || 'https://gustavofarg-hash.github.io').replace(/\/$/, '');
  const base = appBasePath(pathname);
  if (base) return `${host}${base}`;
  return PRODUCTION_ORIGIN;
}

export function publicAppOrigin() {
  try {
    if (typeof location === 'undefined') return PRODUCTION_ORIGIN;
    return publicAppOriginFrom(location.pathname, location.origin);
  } catch {
    return PRODUCTION_ORIGIN;
  }
}

function pageLocation() {
  try {
    const loc = globalThis.location;
    if (loc && typeof loc.pathname === 'string') return loc;
  } catch { /* sin navegador */ }
  return null;
}

export function isTrialPage() {
  const loc = pageLocation();
  return !!loc && isTrialPath(loc.pathname);
}

/** En /prueba/ no se puede abrir el proyecto de producción, aunque config.js lo tenga. */
export function blocksProductionFirebase(pathname, projectId) {
  return isTrialPath(pathname) && String(projectId || '') === PRODUCTION_PROJECT_ID;
}
