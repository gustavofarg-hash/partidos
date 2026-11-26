// v256: diagnóstico de un guardado que falló. Cada paso (anotar, actualizar el
// partido, confirmación, Registro, saldo…) marca el error con su nombre y el
// documento de Firebase. El admin lo ve en el aviso; todos, en la consola.
// No cambia qué se guarda ni en qué orden.

/** Suma un paso por fuera (el primero que se lee) y guarda el documento más adentro. */
export function tagSaveStep(error, step, path = '') {
  if (!error || typeof error !== 'object') return error;
  try {
    const steps = Array.isArray(error.saveSteps) ? error.saveSteps : [];
    const label = String(step || '').trim();
    if (label && steps[0] !== label) error.saveSteps = [label, ...steps];
    else if (!Array.isArray(error.saveSteps)) error.saveSteps = steps;
    if (path && !error.savePath) error.savePath = String(path);
  } catch { /* un error congelado sigue igual */ }
  return error;
}

/** Corre un paso y, si falla, deja el nombre del paso en el error. */
export async function saveStep(step, path, job) {
  try {
    return await job();
  } catch (error) {
    throw tagSaveStep(error, step, typeof path === 'function' ? path() : path);
  }
}

/** «con el invitado 1 › al actualizar el partido (matches/x)», o '' si no hay pasos. */
export function saveStepText(error) {
  const steps = Array.isArray(error?.saveSteps) ? error.saveSteps.filter(Boolean) : [];
  if (!steps.length) return '';
  const path = String(error?.savePath || '').trim();
  return steps.join(' › ') + (path ? ` (${path})` : '');
}

/**
 * El aviso para el admin: «No se pudo guardar al anotar a X › en el Registro (log/…): Firebase rechazó el permiso».
 * Sin pasos devuelve el texto tal cual.
 */
export function withSaveStep(text, error) {
  const where = saveStepText(error);
  const value = String(text || '');
  if (!where) return value;
  const m = value.match(/^No se pudo guardar:?\s*(.*)$/s);
  if (!m) return `${value} (${where})`;
  return `No se pudo guardar ${where}${m[1] ? ': ' + m[1] : ''}`;
}
