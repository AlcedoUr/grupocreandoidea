// Capa api/ (Bloque 11, auditoría) — dominio pedidos. Envuelve las RPCs que
// mutan producción y devoluciones; el componente sigue traduciendo el error
// con `mensajeError` de `lib/errores.js`.
import { supabase } from '../supabase/client';

export const avanzarProduccion = (pedidoId, nuevoEstado) =>
  supabase.rpc('fn_avanzar_produccion', { p_pedido_id: pedidoId, p_nuevo_estado: nuevoEstado });

// Confirmación del cliente sobre el diseño, en dos candados de fn_avanzar_produccion
// (antes de en_impresion y de en_planchado) — evita avanzar algo que el cliente no validó.
export const confirmarDisenoCliente = (pedidoId, etapa, canal, nota) =>
  supabase.rpc('fn_confirmar_diseno_cliente', {
    p_pedido_id: pedidoId, p_etapa: etapa, p_canal: canal || null, p_nota: nota || null,
  });

export const registrarDevolucion = ({ pedidoId, motivo, items, efecto, monto, metodoPago }) =>
  supabase.rpc('fn_registrar_devolucion', {
    p_pedido_id:   pedidoId,
    p_motivo:      motivo,
    p_items:       items,
    p_efecto:      efecto,
    p_monto:       monto,
    p_metodo_pago: metodoPago,
  });
