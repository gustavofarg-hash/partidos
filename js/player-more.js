// v236 (punto 1): los tres puntos al lado del ícono de compartir del jugador.
// Puro: qué opciones se muestran y a dónde va «Compartir link».

/**
 * Opciones del menú. Mismos permisos que los botones del panel:
 * Cargar y Devolver solo si el organizador puede cargar crédito;
 * Devolver queda deshabilitado con crédito $0.
 */
export function playerMoreItems({ canCredit = false, creditAmount = 0 } = {}) {
  const items = [{ key: 'share', label: 'Compartir link', disabled: false }];
  if (canCredit) {
    items.push({ key: 'credit', label: 'Cargar Crédito', disabled: false });
    items.push({ key: 'refund', label: 'Devolver Crédito', disabled: !(Number(creditAmount) > 0) });
  }
  return items;
}

/**
 * Compartir link: con el WhatsApp visible, el chat de ese jugador con el link.
 * Sin número (o privado), el link solo, para elegir a quién mandarlo.
 * Siempre el link completo: no hay acortador.
 */
export function playerShareTarget({ phone = '', url = '' } = {}) {
  const link = String(url || '').trim();
  if (!link) return null;
  const to = String(phone || '').trim();
  return { phone: to, text: link };
}
