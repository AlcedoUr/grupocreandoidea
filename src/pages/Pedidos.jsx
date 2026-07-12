import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  FaTimes, FaSpinner, FaTruck, FaHandshake, FaArrowRight, FaBoxOpen,
  FaCalendarAlt, FaExclamationTriangle, FaClipboardCheck, FaWhatsapp,
} from 'react-icons/fa';
import { supabase } from '../supabase/client';
import { useAuth } from '../context/AuthContext';
import CotizacionesTab from './CotizacionesTab';
import { mensajeError } from '../lib/errores';
import { COLUMNAS, BADGE_PAGO, BADGE_CANAL } from '../lib/constantes';
import { esAtrasado, claseRecojo, formatFecha } from '../lib/formato';
import { linkWhatsapp, mensajePedidoListo } from '../lib/whatsapp';
import { avanzarProduccion, confirmarDisenoCliente } from '../api/pedidos';
import CajaPanel from '../features/caja/CajaPanel';
import ModalDetalle from '../features/produccion/ModalDetalle';
import './Pedidos.css';

// ── Etapas de producción ──
const COLUMNAS_TABLERO = COLUMNAS.filter((c) => c.estado !== 'entregado');

const SIGUIENTE_ESTADO_BASE = {
  pendiente:    'en_diseno',
  en_diseno:    'en_impresion',
  en_impresion: 'en_planchado',
  en_costura:   'listo',
  listo:        'entregado',
  entregado:    null,
};

const ETIQUETA_AVANZAR_BASE = {
  pendiente:    'Iniciar Diseño',
  en_diseno:    'Enviar a Impresión',
  en_impresion: 'Pasar a Planchado',
  en_costura:   'Marcar Listo',
};

// Bifurcación: ¿requiere etapa de confección?
const necesitaConfeccion = (pedido) =>
  (pedido.pedido_items ?? []).some((item) => item.requiere_confeccion === true);

const esRecojo = (pedido) => pedido.metodo_entrega === 'recojo_tienda';

// Deuda = saldo pendiente. El servidor es la autoridad real (fn_registrar_pago/devolucion); esto solo pinta la UI.
const pagadoDe = (pedido) => (pedido.pagos ?? []).reduce((s, p) => s + parseFloat(p.monto || 0), 0);
const descontadoDe = (pedido) => (pedido.devoluciones ?? [])
  .filter((d) => d.efecto === 'descuento_saldo')
  .reduce((s, d) => s + parseFloat(d.monto || 0), 0);
const saldoDe = (pedido) => Math.max(0, parseFloat(pedido.total || 0) - descontadoDe(pedido) - pagadoDe(pedido));

// Candado de confirmación del cliente antes de avanzar (evita imprimir/coser un diseño no validado); espejo del candado real en fn_avanzar_produccion.
const confirmoEtapa = (pedido, etapa) =>
  (pedido.pedido_confirmaciones_cliente ?? []).some((c) => c.etapa === etapa);

const ETIQUETA_CONFIRMACION = {
  impresion: { titulo: 'Confirmar diseño con el cliente', detalle: 'Antes de enviar a imprimir' },
  planchado: { titulo: 'Confirmar diseño en la prenda',   detalle: 'Antes de pasar a planchado, ya impreso' },
};

// Etapa que falta confirmar para poder avanzar desde estadoActual, o null si
// no aplica candado (todas las demás transiciones no lo requieren).
const getBloqueoConfirmacion = (pedido, estadoActual) => {
  if (estadoActual === 'en_diseno'    && !confirmoEtapa(pedido, 'impresion')) return 'impresion';
  if (estadoActual === 'en_impresion' && !confirmoEtapa(pedido, 'planchado')) return 'planchado';
  return null;
};

// Transición siguiente según ruta del pedido — validada también en servidor
const getSiguienteEstado = (pedido, estadoActual) => {
  if (estadoActual === 'en_planchado')
    return necesitaConfeccion(pedido) ? 'en_costura' : 'listo';
  return SIGUIENTE_ESTADO_BASE[estadoActual] ?? null;
};

const getAccionAvanzar = (pedido, estadoActual) => {
  if (estadoActual === 'en_planchado') {
    return necesitaConfeccion(pedido)
      ? { texto: 'Pasar a Costura',     icono: <FaArrowRight />, variante: '' }
      : { texto: 'Listo para Despacho', icono: <FaArrowRight />, variante: '' };
  }
  if (estadoActual === 'listo') {
    return esRecojo(pedido)
      ? { texto: 'Marcar Recogido', icono: <FaHandshake />, variante: 'ped-advance--recojo' }
      : { texto: 'Marcar Enviado',  icono: <FaTruck />,     variante: 'ped-advance--enviar' };
  }
  const texto = ETIQUETA_AVANZAR_BASE[estadoActual];
  return texto ? { texto, icono: <FaArrowRight />, variante: '' } : null;
};

// ── Pedidos (Cotizaciones + Kanban) ──
const Pedidos = () => {
  const { perfil }                            = useAuth();
  const [pedidos, setPedidos]                 = useState([]);
  const [cargando, setCargando]               = useState(true);
  const [avanzando, setAvanzando]             = useState(null);
  const [errorAvance, setErrorAvance]         = useState(null);
  const [seleccionado, setSeleccionado]       = useState(null);
  const [verEntregados, setVerEntregados]     = useState(false);
  // Confirmación de avance de etapa: reemplaza window.confirm nativo (mejoras.txt §6)
  const [confirmAvance, setConfirmAvance]     = useState(null); // { pedido, accion }
  // Confirmación de diseño con el cliente (candado antes de Impresión/Planchado)
  const [confirmDiseno, setConfirmDiseno]     = useState(null); // { pedido, etapa }
  const [canalConfirm, setCanalConfirm]       = useState('whatsapp');
  const [notaConfirm, setNotaConfirm]         = useState('');
  const [guardandoConfirm, setGuardandoConfirm] = useState(false);
  const [tabActiva, setTabActiva]             = useState('cotizaciones');
  const [filtroAtrasados, setFiltroAtrasados] = useState(false);
  const [searchParams, setSearchParams]       = useSearchParams();

  // Ids presentes en el tablero: permite detectar cuándo un UPDATE trae un
  // pedido que AÚN no está (ej. cotización recién aceptada) y recargar con embeds.
  const idsTablero = useRef(new Set());

  const cargarPedidos = useCallback(async () => {
    const { data, error } = await supabase
      .from('pedidos')
      .select(`
        id, canal, metodo_entrega, estado_produccion, estado_pago,
        total, notas, created_at,
        numero_boleta, fecha_recojo_estimada, tipo_venta, local_atencion_id,
        cliente_id,
        clientes ( nombre, telefono ),
        pedido_confirmaciones_cliente ( etapa ),
        pagos ( monto ), devoluciones ( monto, efecto ),
        pedido_items (
          id, cantidad, precio_unitario, subtotal,
          detalle_personalizacion, requiere_confeccion,
          productos!pedido_items_producto_id_fkey ( nombre, imagen_url, requiere_costura ),
          producto_variantes ( atributos ),
          pedido_item_unidades ( id, nombre, sexo, estado_verificacion )
        )
      `)
      .eq('estado_comercial', 'aceptado')
      .eq('origen_pos', false)
      .order('created_at', { ascending: false });

    if (!error) {
      setPedidos(data ?? []);
      idsTablero.current = new Set((data ?? []).map((p) => p.id));
    }
    setCargando(false);
  }, []);

  useEffect(() => {
    cargarPedidos();
    const canal = supabase
      .channel('kanban_pedidos')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'pedidos' }, (payload) => {
        const n = payload.new;
        if (!idsTablero.current.has(n.id)) {
          // Cotización recién aceptada entra al tablero (el map de antes la ignoraba)
          if (n.estado_comercial === 'aceptado') cargarPedidos();
          return;
        }
        if (n.estado_comercial && n.estado_comercial !== 'aceptado') {
          // Cancelado: sale del tablero
          idsTablero.current.delete(n.id);
          setPedidos((prev) => prev.filter((p) => p.id !== n.id));
          return;
        }
        setPedidos((prev) => prev.map((p) => (p.id === n.id ? { ...p, ...n } : p)));
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'pedidos' },
        () => cargarPedidos())
      .subscribe();
    return () => supabase.removeChannel(canal);
  }, [cargarPedidos]);

  // Al entrar a Producción, recargar: no depender solo de Realtime (caso: aceptar → "Ver en Producción").
  useEffect(() => {
    if (tabActiva === 'produccion') cargarPedidos();
  }, [tabActiva, cargarPedidos]);

  // Deep-link desde la campana de notificaciones o el widget "Pendientes de hoy":
  // ?tab=produccion&pedido=N
  useEffect(() => {
    const tabParam = searchParams.get('tab');
    const pedidoId = parseInt(searchParams.get('pedido'), 10);
    if (!tabParam && !pedidoId) return;
    if (['produccion', 'pedidos', 'cotizaciones'].includes(tabParam)) setTabActiva(tabParam);
    if (!pedidoId) { setSearchParams({}, { replace: true }); return; }
    if (cargando) return; // esperar a que el tablero cargue antes de consumir el param
    const p = pedidos.find((x) => x.id === pedidoId);
    if (p) setSeleccionado(p);
    setSearchParams({}, { replace: true }); // consumir el param una sola vez
  }, [searchParams, cargando, pedidos, setSearchParams]);

  // Avanza usando fn_avanzar_produccion — enforcement completo en servidor
  const avanzarEstado = async (pedido) => {
    const siguiente = getSiguienteEstado(pedido, pedido.estado_produccion);
    if (!siguiente) return;

    setAvanzando(pedido.id);
    const { error } = await avanzarProduccion(pedido.id, siguiente);

    if (error) {
      setErrorAvance(mensajeError(error, { NO_AUTORIZADO: 'Tu rol no tiene permiso para este movimiento.' }));
    } else {
      setPedidos((prev) =>
        prev.map((p) => p.id === pedido.id ? { ...p, estado_produccion: siguiente } : p)
      );
    }
    setAvanzando(null);
  };

  // Registra la confirmación del cliente (RPC fn_confirmar_diseno_cliente) y
  // desbloquea el botón de avanzar de esa tarjeta sin recargar todo el tablero.
  const confirmarDiseno = async () => {
    if (!confirmDiseno) return;
    const { pedido, etapa } = confirmDiseno;
    setGuardandoConfirm(true);
    const { error } = await confirmarDisenoCliente(pedido.id, etapa, canalConfirm, notaConfirm.trim());
    setGuardandoConfirm(false);
    if (error) {
      setErrorAvance(mensajeError(error));
      return;
    }
    setPedidos((prev) => prev.map((p) => p.id !== pedido.id ? p : {
      ...p,
      pedido_confirmaciones_cliente: [
        ...(p.pedido_confirmaciones_cliente ?? []).filter((c) => c.etapa !== etapa),
        { etapa },
      ],
    }));
    setConfirmDiseno(null);
    setCanalConfirm('whatsapp');
    setNotaConfirm('');
  };

  const pedidosPorEstado = pedidos.reduce((acc, p) => {
    (acc[p.estado_produccion] ??= []).push(p);
    return acc;
  }, {});
  const entregados     = pedidosPorEstado['entregado'] ?? [];
  const atrasadosCount = pedidos.filter(
    (p) => esAtrasado(p.fecha_recojo_estimada) && p.estado_produccion !== 'entregado'
  ).length;

  return (
    <div className="ped">
      <div className="ped-head">
        <div>
          <h2 className="ped-title">Gestión de Pedidos</h2>
          <p className="ped-subtitle">
            {tabActiva === 'produccion' && `${pedidos.length} pedido${pedidos.length !== 1 ? 's' : ''} en producción`}
            {tabActiva === 'cotizaciones' && 'Cotizaciones abiertas, rechazadas y solicitudes entrantes'}
            {tabActiva === 'pedidos' && 'Pedidos aceptados: boletas, pagos y cancelaciones'}
            {tabActiva === 'caja' && 'Arqueo de caja: resumen del día, conteo y cierre'}
          </p>
        </div>
        {tabActiva === 'produccion' && (
          <div className="ped-head__actions">
            <button className="ped-entregados-btn" onClick={() => setVerEntregados(true)}>
              <FaBoxOpen /> Ver entregados
              <span className="ped-entregados-btn__count">{entregados.length}</span>
            </button>
            <div className="ped-live"><span className="ped-live__dot" /> En tiempo real</div>
          </div>
        )}
      </div>

      <nav className="ped-tabs">
        <button
          className={`ped-tab ${tabActiva === 'cotizaciones' ? 'ped-tab--on' : ''}`}
          onClick={() => setTabActiva('cotizaciones')}
        >
          Cotizaciones
        </button>
        <button
          className={`ped-tab ${tabActiva === 'pedidos' ? 'ped-tab--on' : ''}`}
          onClick={() => setTabActiva('pedidos')}
        >
          Pedidos
        </button>
        <button
          className={`ped-tab ${tabActiva === 'produccion' ? 'ped-tab--on' : ''}`}
          onClick={() => setTabActiva('produccion')}
        >
          Producción
        </button>
        <button
          className={`ped-tab ${tabActiva === 'caja' ? 'ped-tab--on' : ''}`}
          onClick={() => setTabActiva('caja')}
        >
          Caja
        </button>
      </nav>

      {errorAvance && (
        <div className="ped-caja__alert" role="alert">
          {errorAvance}
          <button type="button" className="ped-dialog__close" onClick={() => setErrorAvance(null)} aria-label="Cerrar aviso">
            <FaTimes />
          </button>
        </div>
      )}

      {tabActiva === 'cotizaciones' && (
        <CotizacionesTab
          key="cotizaciones"
          modo="cotizaciones"
          onVerProduccion={() => setTabActiva('produccion')}
          onVerPedidos={() => setTabActiva('pedidos')}
        />
      )}

      {tabActiva === 'pedidos' && (
        <CotizacionesTab
          key="pedidos"
          modo="pedidos"
          onVerProduccion={() => setTabActiva('produccion')}
        />
      )}

      {tabActiva === 'caja' && <CajaPanel perfil={perfil} />}

      {tabActiva === 'produccion' && (
        cargando ? (
          <div className="ped-board-skel">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="ped-col-skel">
                <div className="ped-col-skel__head" />
                <div className="ped-col-skel__body">
                  {[1, 2].map((j) => (
                    <div key={j} className="ped-card-skel">
                      <div className="ped-card-skel__line ped-card-skel__line--title" />
                      <div className="ped-card-skel__line ped-card-skel__line--text" />
                      <div className="ped-card-skel__line ped-card-skel__line--meta" />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <>
            {/* Barra de filtros */}
            <div className="ped-filters">
              <button
                className={`ped-filter-btn ${filtroAtrasados ? 'ped-filter-btn--on' : ''}`}
                onClick={() => setFiltroAtrasados((v) => !v)}
              >
                <FaExclamationTriangle />
                Atrasados
                {atrasadosCount > 0 && (
                  <span className="ped-filter-btn__count">{atrasadosCount}</span>
                )}
              </button>
            </div>

            <div className="ped-board">
              {COLUMNAS_TABLERO.map((col) => {
                let items = pedidosPorEstado[col.estado] ?? [];
                if (filtroAtrasados) {
                  items = items.filter((p) => esAtrasado(p.fecha_recojo_estimada));
                }

                return (
                  <div key={col.estado} className="ped-col" style={{ '--col': col.color }}>
                    <div className="ped-col__head">
                      <span className="ped-col__title">{col.emoji} {col.label}</span>
                      <span className="ped-col__count">{items.length}</span>
                    </div>

                    <div className="ped-col__body">
                      {items.length === 0 && <p className="ped-col__empty">Sin pedidos</p>}

                      {items.map((pedido) => {
                        const totalItems    = pedido.pedido_items?.reduce((s, i) => s + i.cantidad, 0) ?? 0;
                        const badgePago     = BADGE_PAGO[pedido.estado_pago] ?? {};
                        const enCurso       = avanzando === pedido.id;
                        const conConfeccion = col.estado === 'en_planchado' && necesitaConfeccion(pedido);
                        const sinConfeccion = col.estado === 'en_planchado' && !necesitaConfeccion(pedido);
                        const bloqueo       = getBloqueoConfirmacion(pedido, pedido.estado_produccion);
                        const accion        = bloqueo ? null : getAccionAvanzar(pedido, pedido.estado_produccion);
                        const recojoClase   = claseRecojo(pedido.fecha_recojo_estimada);

                        const unidades = pedido.pedido_items?.flatMap((i) => i.pedido_item_unidades ?? []) ?? [];
                        const totalU   = unidades.length;
                        const stampU   = unidades.filter((u) => u.estado_verificacion === 'estampado').length;

                        return (
                          <div key={pedido.id} className="ped-card" onClick={() => setSeleccionado(pedido)}>
                            <div className="ped-card__top">
                              <span className="ped-card__canal">{BADGE_CANAL[pedido.canal]}</span>
                              <span className={`ped-pago ${badgePago.clase ?? ''}`}>{badgePago.label}</span>
                              {col.estado === 'listo' && saldoDe(pedido) > 0 && (
                                <span className="ped-card__deuda" title="Saldo pendiente de pago">
                                  Debe S/.{saldoDe(pedido).toFixed(2)}
                                </span>
                              )}
                            </div>

                            <div className={`ped-entrega ${esRecojo(pedido) ? 'ped-entrega--recojo' : 'ped-entrega--envio'}`}>
                              {esRecojo(pedido) ? <FaHandshake /> : <FaTruck />}
                              {esRecojo(pedido) ? 'Recojo en tienda' : 'Envío a domicilio'}
                            </div>

                            {conConfeccion && <div className="ped-flag ped-flag--costura">🧵 Confección</div>}
                            {sinConfeccion && <div className="ped-flag ped-flag--nocostura">📦 Sin confección</div>}

                            <p className="ped-card__id">
                              Pedido <span style={{ color: col.color }}>#{pedido.id}</span>
                              {pedido.numero_boleta && (
                                <span className="ped-card__boleta">{pedido.numero_boleta}</span>
                              )}
                            </p>
                            <p className="ped-card__cli">👤 {pedido.clientes?.nombre ?? '—'}</p>

                            {pedido.fecha_recojo_estimada && (
                              <p className={`ped-card__recojo ${recojoClase}`}>
                                <FaCalendarAlt />
                                {formatFecha(pedido.fecha_recojo_estimada)}
                                {recojoClase === 'ped-card__recojo--late' && ' · ATRASADO'}
                                {recojoClase === 'ped-card__recojo--hoy'  && ' · HOY'}
                              </p>
                            )}

                            {totalU > 0 && (
                              <div className="ped-card__stamps">
                                <div className="ped-card__stamps-bar">
                                  <div
                                    className="ped-card__stamps-fill"
                                    style={{ transform: `scaleX(${totalU ? stampU / totalU : 0})` }}
                                  />
                                </div>
                                <span className="ped-card__stamps-txt">{stampU}/{totalU} estampadas</span>
                              </div>
                            )}

                            <div className="ped-card__money">
                              <span className="ped-card__total">S/.{parseFloat(pedido.total || 0).toFixed(2)}</span>
                              <span className="ped-card__units">{totalItems} ud.</span>
                            </div>

                            {bloqueo && (
                              <button
                                className="ped-advance ped-advance--confirmar"
                                onClick={(e) => { e.stopPropagation(); setConfirmDiseno({ pedido, etapa: bloqueo }); }}
                              >
                                <FaClipboardCheck /> {ETIQUETA_CONFIRMACION[bloqueo].titulo}
                              </button>
                            )}

                            {col.estado === 'listo' && pedido.clientes?.telefono && (
                              <a
                                className="ped-avisar-cliente"
                                href={linkWhatsapp(pedido.clientes.telefono, mensajePedidoListo(pedido))}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                title="Avisar al cliente por WhatsApp que el pedido está listo"
                              >
                                <FaWhatsapp /> Avisar al cliente
                              </a>
                            )}

                            {accion && (
                              <button
                                disabled={enCurso}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setConfirmAvance({ pedido, accion });
                                }}
                                className={`ped-advance ${accion.variante}`}
                              >
                                {enCurso
                                  ? <><FaSpinner className="ped-spin" /> Moviendo…</>
                                  : <>{accion.icono} {accion.texto}</>}
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

            {verEntregados && (
              <div className="ped-drawer-overlay" onClick={() => setVerEntregados(false)}>
                <aside className="ped-drawer" onClick={(e) => e.stopPropagation()}>
                  <div className="ped-drawer__head">
                    <div>
                      <h3 className="ped-drawer__title">📦 Pedidos entregados</h3>
                      <p className="ped-drawer__sub">{entregados.length} entregado{entregados.length !== 1 ? 's' : ''}</p>
                    </div>
                    <button className="ped-dialog__close" onClick={() => setVerEntregados(false)} aria-label="Cerrar">
                      <FaTimes />
                    </button>
                  </div>
                  <div className="ped-drawer__body">
                    {entregados.length === 0 && (
                      <p className="ped-drawer__empty">Aún no hay pedidos entregados.</p>
                    )}
                    {entregados.map((pedido) => {
                      const totalItems = pedido.pedido_items?.reduce((s, i) => s + i.cantidad, 0) ?? 0;
                      return (
                        <button
                          key={pedido.id}
                          className="ped-drawer-row"
                          onClick={() => { setSeleccionado(pedido); setVerEntregados(false); }}
                        >
                          <div className="ped-drawer-row__main">
                            <span className="ped-drawer-row__id">#{pedido.id}</span>
                            <span className="ped-drawer-row__cli">{pedido.clientes?.nombre ?? '—'}</span>
                          </div>
                          <div className="ped-drawer-row__meta">
                            <span className={`ped-entrega ${esRecojo(pedido) ? 'ped-entrega--recojo' : 'ped-entrega--envio'}`}>
                              {esRecojo(pedido) ? <FaHandshake /> : <FaTruck />}
                              {esRecojo(pedido) ? 'Recojo' : 'Envío'}
                            </span>
                            <span className="ped-drawer-row__units">{totalItems} ud.</span>
                            <span className="ped-drawer-row__total">S/.{parseFloat(pedido.total || 0).toFixed(2)}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </aside>
              </div>
            )}
          </>
        )
      )}

      <ModalDetalle pedido={seleccionado} onClose={() => setSeleccionado(null)} />

      {confirmAvance && (
        <div className="ped-confirm-overlay" onClick={() => setConfirmAvance(null)}>
          <div className="ped-confirm" onClick={(e) => e.stopPropagation()}>
            <h3 className="ped-confirm__title">{confirmAvance.accion.texto}</h3>
            <p className="ped-confirm__text">
              ¿Confirmas "{confirmAvance.accion.texto}" para el pedido #{confirmAvance.pedido.id}?
            </p>
            {/* Al entrar a Planchado: lista de unidades solo informativa. Material/Talla vienen de la variante;
                cada categoría nombra sus atributos distinto, por eso la búsqueda es flexible, no exacta. */}
            {confirmAvance.pedido.estado_produccion === 'en_impresion' && (() => {
              const buscarAtributo = (atributos, patron) => {
                const key = Object.keys(atributos || {}).find((k) => patron.test(k));
                return key ? atributos[key] : '—';
              };
              const gruposUnidades = (confirmAvance.pedido.pedido_items ?? [])
                .map((it) => {
                  const atributos = it.producto_variantes?.atributos;
                  return {
                    nombre:   it.productos?.nombre ?? 'Producto',
                    material: buscarAtributo(atributos, /material|tela/i),
                    talla:    buscarAtributo(atributos, /talla/i),
                    unidades: it.pedido_item_unidades ?? [],
                  };
                })
                .filter((g) => g.unidades.length > 0);
              if (gruposUnidades.length === 0) return null;
              return (
                <div className="ped-confirm__unidades">
                  <p className="ped-confirm__unidades-k">Unidades a planchar:</p>
                  {gruposUnidades.map((g, i) => (
                    <div key={i} className="ped-uni-grupo">
                      <p className="ped-uni-grupo__prod">{g.nombre}</p>
                      <table className="ped-uni-table">
                        <thead>
                          <tr><th>Material</th><th>Talla</th><th>Nombre</th><th>Sexo</th></tr>
                        </thead>
                        <tbody>
                          {g.unidades.map((u) => (
                            <tr key={u.id}>
                              <td>{g.material}</td>
                              <td>{g.talla}</td>
                              <td>{u.nombre || 'Sin nombre'}</td>
                              <td>{u.sexo || '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ))}
                </div>
              );
            })()}
            <div className="ped-confirm__actions">
              <button type="button" className="ped-confirm__btn" onClick={() => setConfirmAvance(null)}>
                Cancelar
              </button>
              <button
                type="button"
                className="ped-confirm__btn ped-confirm__btn--primary"
                onClick={() => { avanzarEstado(confirmAvance.pedido); setConfirmAvance(null); }}
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmDiseno && (
        <div className="ped-confirm-overlay" onClick={() => !guardandoConfirm && setConfirmDiseno(null)}>
          <div className="ped-confirm" onClick={(e) => e.stopPropagation()}>
            <h3 className="ped-confirm__title">{ETIQUETA_CONFIRMACION[confirmDiseno.etapa].titulo}</h3>
            <p className="ped-confirm__text">
              {ETIQUETA_CONFIRMACION[confirmDiseno.etapa].detalle} del pedido #{confirmDiseno.pedido.id}.
              Registra cómo el cliente dio el visto bueno.
            </p>
            <label className="ped-flabel">Canal
              <select className="ped-input" value={canalConfirm} onChange={(e) => setCanalConfirm(e.target.value)}>
                <option value="whatsapp">WhatsApp</option>
                <option value="llamada">Llamada</option>
                <option value="presencial">Presencial</option>
                <option value="otro">Otro</option>
              </select>
            </label>
            <label className="ped-flabel">Nota (opcional)
              <textarea className="ped-input" rows={2} placeholder="Ej: envié la foto del mockup, dijo que sí…"
                value={notaConfirm} onChange={(e) => setNotaConfirm(e.target.value)} />
            </label>
            <div className="ped-confirm__actions">
              <button type="button" className="ped-confirm__btn" onClick={() => setConfirmDiseno(null)} disabled={guardandoConfirm}>
                Cancelar
              </button>
              <button
                type="button"
                className="ped-confirm__btn ped-confirm__btn--primary"
                onClick={confirmarDiseno}
                disabled={guardandoConfirm}
              >
                {guardandoConfirm ? <><FaSpinner className="ped-spin" /> Guardando…</> : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Pedidos;
