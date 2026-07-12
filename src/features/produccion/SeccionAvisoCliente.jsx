import { FaWhatsapp } from 'react-icons/fa';
import { linkWhatsapp, mensajePedidoListo } from '../../lib/whatsapp';

// Antes encolaba en `mensajes_salientes` para un bot de WhatsApp; el bot se retiró
// (doc. arquitectura §63) y quedó huérfana. Ahora es un link directo a wa.me, ya armado.
const SeccionAvisoCliente = ({ pedido }) => {
  const esListo = pedido.estado_produccion === 'listo';

  return (
    <div className="ped-dev">
      <h4 className="ped-section"><FaWhatsapp /> Aviso de pedido listo</h4>

      {esListo ? (
        pedido.clientes?.telefono ? (
          <a
            className="ped-consumo__open"
            href={linkWhatsapp(pedido.clientes.telefono, mensajePedidoListo(pedido))}
            target="_blank"
            rel="noopener noreferrer"
          >
            <FaWhatsapp /> Avisar al cliente
          </a>
        ) : (
          <p className="ped-muted">El cliente no tiene teléfono registrado.</p>
        )
      ) : (
        <p className="ped-muted">Disponible cuando el pedido esté en "Listo para Despacho".</p>
      )}
    </div>
  );
};

export default SeccionAvisoCliente;
