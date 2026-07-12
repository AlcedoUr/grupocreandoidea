// Mapa central código → mensaje legible (Bloque 11). Toda RPC nueva con RAISE EXCEPTION
// debe sumar su código aquí (puede quedar corta si se agregan RPCs sin actualizar esto).
// mensajeError(err) da el mensaje genérico; para redacción distinta por pantalla o datos
// dinámicos se pasa `overrides`: mensajeError(err, { LOCAL_REQUERIDO: 'Elige el local...' })

export const MENSAJES = {
  // Autenticación / autorización / roles
  NO_AUTORIZADO: 'No tienes permiso para realizar esta acción.',
  NO_AUTH: 'No tienes permiso para realizar esta acción.',
  AAL2_REQUERIDO: 'Esta acción requiere iniciar sesión con tu código 2FA. Cierra sesión y vuelve a entrar.',
  ROL_INVALIDO: 'Ese rol no es válido.',
  ROL_INVALIDO_2FA: 'Ese rol no admite la configuración de 2FA indicada.',
  MODULO_INVALIDO: 'Ese módulo no existe.',

  // Usuarios y roles: eliminar usuario
  NO_AUTOELIMINACION: 'No puedes eliminar tu propia cuenta.',
  ULTIMO_ADMIN: 'Debe quedar al menos un administrador activo.',
  USUARIO_NO_ENCONTRADO: 'No se encontró ese usuario.',
  USUARIO_CON_HISTORIAL: (msg) => `Este usuario tiene historial (${msg.split('USUARIO_CON_HISTORIAL:')[1]?.trim() ?? ''}) y no se puede eliminar. Usa "Desactivar" en su lugar.`,

  // Producción / Kanban / unidades
  TRANSICION_INVALIDA: 'Esta transición de estado no es válida.',
  PAGO_INCOMPLETO: 'El pago no está completo: no se puede marcar como entregado hasta cubrir el 100%.',
  CANDADO_VERIFICACION: 'Hay unidades sin verificar. Revisa la pestaña "Unidades" y verifica todas antes de pasar a planchado.',
  CANDADO_ESTAMPADO: 'Hay unidades sin estampar. Completa el estampado de todas las unidades antes de avanzar.',
  CONFIRMACION_PENDIENTE: 'El cliente todavía no confirmó el diseño de esta etapa.',
  ETAPA_INVALIDA: 'Esa etapa de confirmación no es válida.',
  UNIDAD_NO_ENCONTRADA: 'No se encontró la unidad indicada.',
  UNIDAD_NO_PENDIENTE: 'La unidad ya fue procesada.',
  UNIDAD_NO_VERIFICADA: 'La unidad debe estar verificada primero.',
  SIN_PERMISO_VERIFICAR: 'Tu rol no puede verificar unidades.',
  SIN_PERMISO_ESTAMPAR: 'Tu rol no puede estampar unidades.',

  // Cotizaciones / pedidos / kits
  FECHA_REQUERIDA: 'Indica la fecha y hora de entrega prometida.',
  ADELANTO_INSUFICIENTE: 'El adelanto no alcanza el mínimo requerido.',
  STOCK_INSUFICIENTE: 'Stock insuficiente para cubrir todas las líneas. Revisa el inventario.',
  PEDIDO_NO_EDITABLE: 'El pedido ya no admite ediciones (dejó de ser cotización).',
  PEDIDO_NO_ENCONTRADO: 'No se encontró el pedido.',
  PEDIDO_NOT_FOUND: 'No se encontró el pedido.',
  PEDIDO_NO_ACEPTADO: 'El pedido no está en estado de cotización.',
  PEDIDO_NO_ENTREGADO: 'El reembolso solo aplica a pedidos entregados. Usa descuento de saldo.',
  PEDIDO_NO_RECHAZABLE: 'Este pedido ya no se puede rechazar.',
  PEDIDO_ENTREGADO_NO_CANCELABLE: 'Un pedido ya entregado no se puede cancelar.',
  REEMBOLSO_EXCEDE_PAGADO: 'El monto a reembolsar no puede superar lo pagado.',
  PEDIDO_SIN_TELEFONO: 'El cliente no tiene teléfono registrado.',
  PEDIDO_NO_LISTO: 'El pedido debe estar en "Listo" para avisar.',
  SOLICITUD_NO_ENCONTRADA: 'No se encontró la solicitud.',
  LIMITE_SOLICITUDES: 'Se alcanzó el límite de solicitudes permitidas. Intenta más tarde.',
  DATOS_INCOMPLETOS: 'Faltan datos obligatorios.',
  SIN_ITEMS: 'Agrega al menos un artículo.',
  ITEM_INVALIDO: 'Uno de los artículos no es válido.',
  ITEM_NO_PERTENECE: 'Ese artículo no pertenece a este pedido.',
  ITEM_SIN_VARIANTE: 'Ese artículo no tiene variante y no puede reingresar a stock.',
  VARIANTE_INVALIDA: 'Una de las variantes seleccionadas ya no está disponible.',
  CANTIDAD_INVALIDA: 'La cantidad indicada no es válida.',
  CANTIDAD_EXCEDE_VENDIDO: 'La cantidad supera lo vendido (neto de devoluciones previas).',
  CANTIDAD_KITS_INVALIDA: 'La cantidad de kits no es válida.',
  TIPO_INVALIDO: 'Ese tipo de producto no es válido.',
  KIT_INVALIDO: 'Ese producto no es un kit.',
  KIT_SIN_COMPONENTES: 'El kit no tiene componentes configurados.',
  COMPONENTE_NO_EXISTE: 'Uno de los componentes del kit no existe.',
  COMPONENTE_NO_SIMPLE: 'Un kit no puede tener otro kit como componente.',
  COMPONENTES_NO_CORRESPONDEN: 'Los componentes enviados no corresponden al kit.',
  PRODUCTO_ES_KIT: 'Uno de los productos es un kit y debe cotizarse.',
  PRODUCTO_CON_HISTORIA: 'Este producto tiene pedidos, movimientos o forma parte de un kit: no se puede eliminar. Usa "Ocultar" para sacarlo del catálogo.',
  PRODUCTO_NO_EXISTE: 'Ese producto no existe.',
  PROMOCION_NO_EXISTE: 'Esa promoción no existe.',
  RANGO_INVALIDO: 'El rango de fechas no es válido.',
  ESTADO_INVALIDO: 'Ese estado no es válido.',
  CARRITO_VACIO: 'El carrito está vacío.',

  // Pagos / devoluciones / caja
  MONTO_INVALIDO: 'El monto indicado no es válido.',
  MONTO_EXCEDE_SALDO: 'El monto supera el saldo pendiente.',
  PAGO_EXCEDE_TOTAL: 'El pago supera el total del pedido.',
  SIN_SALDO: 'El pedido no tiene saldo pendiente: solo se puede reembolsar.',
  METODO_PAGO_REQUERIDO: 'Indica el método de pago.',
  METODO_PAGO_INVALIDO: 'Ese método de pago no corresponde a esta operación.',
  EFECTO_INVALIDO: 'Ese efecto de devolución no es válido.',
  MOTIVO_REQUERIDO: 'Indica el motivo.',
  LOCAL_REQUERIDO: 'Selecciona un local.',
  MISMO_LOCAL: 'El local de origen y destino no pueden ser el mismo.',
  MINIMO_INVALIDO: 'El mínimo indicado no es válido.',
  CIERRE_YA_EXISTE: 'Ya existe un cierre para este local y fecha.',
  LOCAL_NO_ENCONTRADO: 'No se encontró ese local.',

  // Traslados
  TRASLADO_NOT_FOUND: 'No se encontró el traslado.',
  YA_CANCELADO: 'Ese traslado ya fue cancelado.',

  // Clientes / CRM / seguimientos
  TELEFONO_DUPLICADO: 'Ya existe un cliente con ese teléfono.',
  CLIENTE_REQUERIDO: 'Indica el cliente (nombre y teléfono) para el seguimiento.',
  ASIGNADO_INVALIDO: 'El usuario asignado no es válido.',
  NOTA_REQUERIDA: 'La nota es obligatoria.',
  FECHA_PASADA: 'La fecha debe ser futura.',
  SEGUIMIENTO_NO_ENCONTRADO: 'No se encontró el seguimiento.',

  // Notificaciones / WhatsApp
  AVISO_YA_ENCOLADO: 'Ya hay un aviso en cola para este pedido.',
  MENSAJE_NO_FALLIDO: 'Solo se pueden reintentar mensajes fallidos.',
};

export const mensajeError = (err, overrides = {}) => {
  const msg = typeof err === 'string' ? err : (err?.message ?? '');
  const mapa = { ...MENSAJES, ...overrides };
  const codigo = Object.keys(mapa).find((c) => msg.includes(c));
  if (codigo) {
    const valor = mapa[codigo];
    return typeof valor === 'function' ? valor(msg) : valor;
  }
  console.error('[errores.js] código no mapeado:', msg || err);
  return 'Ocurrió un error inesperado. Intenta de nuevo o contacta a soporte.';
};
