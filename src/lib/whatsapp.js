// Link directo de WhatsApp (sin cola/bot — mensajes_salientes quedó huérfana al
// retirarse whatsapp-bot/, doc. arquitectura §77). Mismo patrón wa.me/51 que CotizacionesTab.jsx.
export const linkWhatsapp = (telefono, mensaje) =>
  `https://wa.me/51${(telefono || '').replace(/\s+/g, '')}?text=${encodeURIComponent(mensaje)}`;

// Mensaje de "pedido listo" según método de entrega — recojo en tienda vs envío.
export const mensajePedidoListo = (pedido) => {
  const num = pedido.numero_boleta || `#${pedido.id}`;
  return pedido.metodo_entrega === 'recojo_tienda'
    ? `Hola! Tu pedido ${num} ya está listo. Puedes pasar a recogerlo a la tienda.`
    : `Hola! Tu pedido ${num} ya está listo. Comunícate con nosotros para coordinar la entrega.`;
};
