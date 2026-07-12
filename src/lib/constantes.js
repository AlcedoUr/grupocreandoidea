// Constantes compartidas entre features (Bloque 12). METODOS_PAGO la usan caja y
// devoluciones; vive en lib/ porque ninguna feature es dueña. Mismo enum `metodo_pago_tipo` de la DB.
export const METODOS_PAGO = [
  { m: 'efectivo',      label: 'Efectivo' },
  { m: 'yape',          label: 'Yape' },
  { m: 'plin',          label: 'Plin' },
  { m: 'transferencia', label: 'Transferencia' },
  { m: 'tarjeta',       label: 'Tarjeta' },
];

// Etapas de producción — las necesitan tanto el Kanban como ModalDetalle.
export const COLUMNAS = [
  { estado: 'pendiente',    label: 'Pendiente',           color: '#e74c3c', emoji: '⏳' },
  { estado: 'en_diseno',    label: 'En Diseño',           color: '#e67e22', emoji: '🎨' },
  { estado: 'en_impresion', label: 'En Impresión',        color: '#f39c12', emoji: '🖨️'  },
  { estado: 'en_planchado', label: 'En Planchado',        color: '#00a838', emoji: '👕' },
  { estado: 'en_costura',   label: 'En Costura',          color: '#2980b9', emoji: '🧵' },
  { estado: 'listo',        label: 'Listo para Despacho', color: '#8e44ad', emoji: '✅' },
  { estado: 'entregado',    label: 'Entregado',           color: '#7a8a82', emoji: '📦' },
];

export const BADGE_PAGO = {
  pendiente:       { label: 'Pago Pendiente', clase: 'badge-status badge-status--pendiente' },
  adelanto_pagado: { label: 'Con Adelanto',   clase: 'badge-status badge-status--proceso' },
  cancelado_total: { label: 'Pagado Total',   clase: 'badge-status badge-status--exito' },
};

export const BADGE_CANAL = {
  web:        '🌐 Web',
  whatsapp:   '💬 WhatsApp',
  presencial: '🏪 Presencial',
  b2b:        '🏢 B2B',
};

// mejoras.txt §8: 0-2 pedidos sin etiqueta, 3-4 "Potencial", 5+ "Frecuente"
// (umbral ajustado porque con 1 pedido calificaba de Potencial, muy laxo).
export const etiquetaRelacion = (numPedidos) => {
  const n = numPedidos ?? 0;
  if (n >= 5) return { label: 'Cliente Frecuente', clase: 'cli-relacion--frecuente' };
  if (n >= 3) return { label: 'Cliente Potencial', clase: 'cli-relacion--potencial' };
  return null;
};
