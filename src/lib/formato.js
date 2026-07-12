// Helpers de fecha es-PE (Bloque 12). Antes en Pedidos.jsx; ahora en lib/ porque
// los usan tanto el Kanban como ModalDetalle (ninguna feature es dueña).

// fecha_recojo_estimada es timestamptz: comparar contra el instante actual.
export const esAtrasado = (fecha) => !!fecha && new Date(fecha) < new Date();

export const esHoy = (fecha) => {
  if (!fecha) return false;
  return new Date(fecha).toDateString() === new Date().toDateString();
};

export const claseRecojo = (fecha) => {
  if (!fecha) return '';
  if (esAtrasado(fecha)) return 'ped-card__recojo--late';
  if (esHoy(fecha))      return 'ped-card__recojo--hoy';
  return '';
};

// Fecha Y hora prometida (dd/mm/aaaa hh:mm)
export const formatFecha = (fecha) => {
  if (!fecha) return null;
  return new Date(fecha).toLocaleString('es-PE', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
};
