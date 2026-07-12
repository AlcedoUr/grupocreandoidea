import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  FaPlus, FaEdit, FaCheck, FaBan, FaTimes, FaFileInvoice,
  FaMoneyBill, FaSpinner, FaSearch, FaPrint, FaExclamationTriangle,
  FaTrash, FaUser, FaTruck, FaHandshake, FaEye,
  FaWhatsapp, FaGlobe, FaStore, FaBuilding, FaCalendarAlt, FaCopy, FaCalendarPlus,
} from 'react-icons/fa';
import { supabase } from '../supabase/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { UnidadesEditorItem } from './UnidadesPanel';
import ModalSeguimiento from '../components/ModalSeguimiento';
import { mensajeError } from '../lib/errores';
import { esTelefonoValido, soloDigitos9 } from '../lib/telefono';
import './CotizacionesTab.css';

// ── Helpers ──
const fmt = (n) => `S/. ${parseFloat(n || 0).toFixed(2)}`;
const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
// Entrega prometida es timestamptz, por eso incluye hora.
const fmtDateTime = (d) =>
  d ? new Date(d).toLocaleString('es-PE', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
// Pagado real = suma de tabla pagos (monto_adelanto es legacy, ya no se escribe).
const pagadoDe = (pedido) => (pedido?.pagos ?? []).reduce((s, p) => s + parseFloat(p.monto || 0), 0);
// Total negociado no se muta (auditoría); total efectivo = total − devoluciones descuento_saldo.
const descontadoDe = (pedido) =>
  (pedido?.devoluciones ?? []).filter((d) => d.efecto === 'descuento_saldo').reduce((s, d) => s + parseFloat(d.monto || 0), 0);
// Espejo de exhibición client-side; autoridad real es fn_total_efectivo() en la DB
// (Bloque 6, auditoría P2) — esto solo pinta la UI, nunca decide límites de negocio.
const totalEfectivoDe = (pedido) => parseFloat(pedido?.total || 0) - descontadoDe(pedido);
const motivoDe = (notas) => {
  const m = (notas || '').match(/Motivo (?:rechazo|cancelación):\s*([\s\S]*)$/);
  return m ? m[1].trim() : null;
};

const esAtrasado = (fecha) => !!fecha && new Date(fecha) < new Date();
const esHoy = (fecha) => {
  if (!fecha) return false;
  return new Date(fecha).toDateString() === new Date().toDateString();
};

const getInitials = (nombre) => {
  if (!nombre) return '—';
  const parts = nombre.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
};

const getAvatarColor = (nombre) => {
  if (!nombre) return '#8a938d';
  const colors = [
    '#e17055', '#0984e3', '#6c5ce7', '#00b894', '#fdcb6e',
    '#e84393', '#2d3436', '#10ac84', '#ff9f43', '#5758bb'
  ];
  let hash = 0;
  for (let i = 0; i < nombre.length; i++) {
    hash = nombre.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % colors.length;
  return colors[index];
};

const renderCanalChip = (canal, labelMap) => {
  const icons = {
    whatsapp: <FaWhatsapp />,
    web: <FaGlobe />,
    presencial: <FaStore />,
    b2b: <FaBuilding />
  };
  const label = labelMap[canal] || canal;
  return (
    <span className={`ctz-canal-chip ctz-canal-chip--${canal}`}>
      {icons[canal] || <FaFileInvoice />}
      <span className="ctz-canal-chip__label">{label}</span>
    </span>
  );
};

const ESTADO_CONFIG = {
  cotizacion: { label: 'Cotización', clase: 'ctz-badge--cotiz' },
  aceptado:   { label: 'Aceptado',   clase: 'ctz-badge--acept' },
  rechazado:  { label: 'Rechazado',  clase: 'ctz-badge--recha' },
  cancelado:  { label: 'Cancelado',  clase: 'ctz-badge--cance' },
};

const CANAL_LABEL = { web: 'Web', whatsapp: 'WhatsApp', presencial: 'Presencial', b2b: 'B2B' };

const METODOS_PAGO = [
  { value: 'efectivo', label: 'Efectivo' },
  { value: 'yape',     label: 'Yape' },
  { value: 'plin',     label: 'Plin' },
  { value: 'transferencia', label: 'Transferencia' },
  { value: 'tarjeta',  label: 'Tarjeta' },
];

// ── Modal base ──
// cerrarAlClickFuera=false en formularios largos: un clic accidental fuera no debe tirar el trabajo.
const ModalBase = ({ titulo, subtitulo, onClose, ancho = '640px', children, cerrarAlClickFuera = true }) => (
  <div className="ctz-modal" onClick={cerrarAlClickFuera ? onClose : undefined}>
    <div className="ctz-dialog" style={{ maxWidth: ancho }} onClick={e => e.stopPropagation()}>
      <div className="ctz-dialog__head">
        <div>
          <h2 className="ctz-dialog__title">{titulo}</h2>
          {subtitulo && <p className="ctz-dialog__sub">{subtitulo}</p>}
        </div>
        <button className="ctz-close-btn" onClick={onClose} aria-label="Cerrar">
          <FaTimes />
        </button>
      </div>
      {children}
    </div>
  </div>
);

// ── ModalRechazar ──
const ModalRechazar = ({ pedidoId, onClose, onHecho }) => {
  const [motivo, setMotivo]     = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError]       = useState(null);

  const submit = async () => {
    if (!motivo.trim()) {
      setError('El motivo de rechazo es obligatorio.');
      return;
    }
    setGuardando(true); setError(null);
    const { error: e } = await supabase.rpc('fn_rechazar_cotizacion', {
      p_pedido_id: pedidoId,
      p_motivo: motivo.trim(),
    });
    setGuardando(false);
    if (e) { setError(e.message); return; }
    onHecho();
  };

  return (
    <ModalBase titulo={`Rechazar cotización #${pedidoId}`} onClose={onClose} ancho="480px">
      <div className="ctz-dialog__body">
        {error && <div className="ctz-alert ctz-alert--red">{error}</div>}
        <div className="ctz-field">
          <label className="ctz-label">Motivo (obligatorio)</label>
          <textarea
            className="ctz-textarea" rows={3}
            placeholder="Ej: El cliente desistió, no hay disponibilidad del color…"
            value={motivo} onChange={e => setMotivo(e.target.value)}
            required
          />
        </div>
        <div className="ctz-dialog__foot">
          <button className="ctz-btn ctz-btn--ghost" onClick={onClose}>Cancelar</button>
          <button className="ctz-btn ctz-btn--red" onClick={submit} disabled={guardando || !motivo.trim()}>
            {guardando ? <><FaSpinner className="ctz-spin" /> Rechazando…</> : <><FaBan /> Rechazar</>}
          </button>
        </div>
      </div>
    </ModalBase>
  );
};

// ── ModalCancelar ──
// Reglas de cancelación por estado (mejoras.txt §6): pendiente = reembolso 100% automático;
// impresión/diseño = stock vuelve solo pero reembolso manual; planchado+ = nada automático.
const ModalCancelar = ({ pedido, onClose, onHecho }) => {
  const { toastInfo } = useToast();
  const [motivo, setMotivo]             = useState('');
  const [montoReembolso, setMontoReembolso] = useState('');
  const [metodoPago, setMetodoPago]     = useState('efectivo');
  const [guardando, setGuardando]       = useState(false);
  const [error, setError]               = useState(null);

  const pagado    = pagadoDe(pedido);
  const esAutomatico = pedido.estado_produccion === 'pendiente';
  const monto     = esAutomatico ? pagado : (parseFloat(montoReembolso) || 0);

  const submit = async () => {
    if (!motivo.trim()) {
      setError('El motivo de cancelación es obligatorio.');
      return;
    }
    setGuardando(true); setError(null);
    const { data, error: e } = await supabase.rpc('fn_cancelar_pedido', {
      p_pedido_id: pedido.id,
      p_motivo: motivo.trim(),
      p_monto_reembolso: esAutomatico ? null : monto,
      p_metodo_pago: monto > 0 ? metodoPago : null,
    });
    setGuardando(false);
    if (e) { setError(mensajeError(e)); return; }
    if (data?.advertencia) toastInfo(data.advertencia, 6000);
    onHecho();
  };

  return (
    <ModalBase titulo={`Cancelar pedido #${pedido.id}`} onClose={onClose} ancho="480px">
      <div className="ctz-dialog__body">
        {error && <div className="ctz-alert ctz-alert--red">{error}</div>}

        <div className="ctz-alert ctz-alert--amber">
          {esAutomatico
            ? <span>El pedido aún no entra a producción: el stock reservado vuelve solo y se reembolsa el 100% de lo pagado ({fmt(pagado)}), automático.</span>
            : <span>El pedido ya está en producción ({pedido.estado_produccion}): el reembolso no es automático — indica el monto exacto a devolver (máximo {fmt(pagado)}).</span>}
        </div>

        <div className="ctz-field">
          <label className="ctz-label">Motivo (obligatorio)</label>
          <textarea
            className="ctz-textarea" rows={3}
            placeholder="Ej: Cliente canceló, cambio de pedido…"
            value={motivo} onChange={e => setMotivo(e.target.value)}
            required
          />
        </div>

        {!esAutomatico && (
          <>
            <div className="ctz-field">
              <label className="ctz-label">Monto a reembolsar (S/.)</label>
              <input type="number" min="0" max={pagado} step="0.01" className="ctz-input" placeholder="0.00"
                value={montoReembolso} onChange={e => setMontoReembolso(e.target.value)} />
              <span className="ctz-hint-min">Pagado: {fmt(pagado)} — deja 0 si no corresponde reembolso.</span>
            </div>
            {monto > 0 && (
              <div className="ctz-field">
                <label className="ctz-label">Método del reembolso</label>
                <select className="ctz-select" value={metodoPago} onChange={e => setMetodoPago(e.target.value)}>
                  {METODOS_PAGO.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </div>
            )}
          </>
        )}

        <div className="ctz-dialog__foot">
          <button className="ctz-btn ctz-btn--ghost" onClick={onClose}>No cancelar</button>
          <button className="ctz-btn ctz-btn--red" onClick={submit} disabled={guardando || !motivo.trim() || monto > pagado}>
            {guardando ? <><FaSpinner className="ctz-spin" /> Cancelando…</> : <><FaTimes /> Cancelar pedido</>}
          </button>
        </div>
      </div>
    </ModalBase>
  );
};

// ── ModalPago ──
const ModalPago = ({ pedido, onClose, onHecho }) => {
  const [tipo, setTipo]       = useState('adelanto');
  const [monto, setMonto]     = useState('');
  const [metodo, setMetodo]   = useState('efectivo');
  const [guardando, setGuardando] = useState(false);
  const [error, setError]     = useState(null);

  const total       = totalEfectivoDe(pedido);
  const descontado  = descontadoDe(pedido);
  const pagado      = pagadoDe(pedido);
  const saldo       = Math.max(0, total - pagado);

  const submit = async () => {
    setGuardando(true); setError(null);
    const montoFinal = tipo === 'cancelado_total' ? saldo : (parseFloat(monto) || 0);
    const { error: e } = await supabase.rpc('fn_registrar_pago', {
      p_pedido_id: pedido.id,
      p_tipo:      tipo,
      p_monto:     montoFinal,
      p_metodo:    metodo,
    });
    setGuardando(false);
    if (e) { setError(e.message); return; }
    onHecho();
  };

  return (
    <ModalBase
      titulo={`Registrar pago — Pedido #${pedido.id}`}
      subtitulo={pedido.numero_boleta}
      onClose={onClose} ancho="480px"
    >
      <div className="ctz-dialog__body">
        {error && <div className="ctz-alert ctz-alert--red">{error}</div>}
        <div className="ctz-info-row"><span className="ctz-info-row__k">Total pedido</span><span className="ctz-info-row__v ctz-strong">{fmt(pedido.total)}</span></div>
        {descontado > 0 && (
          <div className="ctz-info-row"><span className="ctz-info-row__k">Descuento por devolución</span><span className="ctz-info-row__v">— {fmt(descontado)}</span></div>
        )}
        <div className="ctz-info-row"><span className="ctz-info-row__k">Adelanto pagado</span><span className="ctz-info-row__v">{fmt(pagado)}</span></div>
        <div className="ctz-info-row ctz-info-row--highlight">
          <span className="ctz-info-row__k">Saldo pendiente</span>
          <span className="ctz-info-row__v ctz-strong ctz-green">{fmt(saldo)}</span>
        </div>
        <div className="ctz-field ctz-field--mt">
          <label className="ctz-label">Tipo de pago</label>
          <div className="ctz-radio-group">
            {[{ v: 'adelanto', l: 'Adelanto parcial' }, { v: 'cancelado_total', l: `Pago total (${fmt(saldo)})` }].map(o => (
              <label key={o.v} className={`ctz-radio ${tipo === o.v ? 'ctz-radio--on' : ''}`}>
                <input type="radio" name="tipopago" value={o.v} checked={tipo === o.v} onChange={() => setTipo(o.v)} />
                {o.l}
              </label>
            ))}
          </div>
        </div>
        {tipo === 'adelanto' && (
          <div className="ctz-field">
            <label className="ctz-label">Monto (S/.)</label>
            <input type="number" min="0" step="0.01" className="ctz-input" value={monto} onChange={e => setMonto(e.target.value)} placeholder="0.00" />
          </div>
        )}
        <div className="ctz-field">
          <label className="ctz-label">Método</label>
          <select className="ctz-select" value={metodo} onChange={e => setMetodo(e.target.value)}>
            {METODOS_PAGO.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </div>
        <div className="ctz-dialog__foot">
          <button className="ctz-btn ctz-btn--ghost" onClick={onClose}>Cancelar</button>
          <button className="ctz-btn ctz-btn--green" onClick={submit} disabled={guardando}>
            {guardando ? <><FaSpinner className="ctz-spin" /> Registrando…</> : <><FaMoneyBill /> Registrar pago</>}
          </button>
        </div>
      </div>
    </ModalBase>
  );
};

// ── ModalBoleta ──
const ModalBoleta = ({ pedido, locales, onClose }) => {
  const local      = locales.find(l => l.id === pedido.local_atencion_id);
  const total      = totalEfectivoDe(pedido);
  const descontado = descontadoDe(pedido);
  const pagado     = pagadoDe(pedido);

  return (
    <ModalBase titulo="Boleta de venta" ancho="700px" onClose={onClose}>
      <div className="ctz-dialog__body">
        <div className="ctz-boleta-print-area">
          <div className="ctz-boleta__head">
            <div>
              <h1 className="ctz-boleta__empresa">Grupo Creando Ideas</h1>
              <p className="ctz-boleta__tipo">Boleta de venta</p>
            </div>
            <div className="ctz-boleta__num-box">
              <p className="ctz-boleta__num-label">N° Boleta</p>
              <p className="ctz-boleta__num">{pedido.numero_boleta}</p>
            </div>
          </div>

          <div className="ctz-boleta__meta">
            <div className="ctz-boleta__meta-col">
              <p className="ctz-boleta__mk">Cliente</p>
              <p className="ctz-boleta__mv ctz-strong">{pedido.clientes?.nombre}</p>
              {pedido.clientes?.telefono && <p className="ctz-boleta__mv">{pedido.clientes.telefono}</p>}
            </div>
            <div className="ctz-boleta__meta-col">
              <p className="ctz-boleta__mk">Fecha aceptación</p>
              <p className="ctz-boleta__mv">{fmtDate(pedido.accepted_at)}</p>
              {pedido.fecha_recojo_estimada && (
                <>
                  <p className="ctz-boleta__mk ctz-mt-xs">Entrega prometida</p>
                  <p className="ctz-boleta__mv">{fmtDateTime(pedido.fecha_recojo_estimada)}</p>
                </>
              )}
            </div>
            <div className="ctz-boleta__meta-col">
              <p className="ctz-boleta__mk">Local</p>
              <p className="ctz-boleta__mv">{local?.nombre || '—'}</p>
              <p className="ctz-boleta__mk ctz-mt-xs">Entrega</p>
              <p className="ctz-boleta__mv">
                {pedido.metodo_entrega === 'recojo_tienda' ? 'Recojo en tienda' : 'Delivery'}
              </p>
            </div>
          </div>

          <table className="ctz-boleta__table">
            <thead>
              <tr>
                <th className="ctz-boleta__th">Producto / Servicio</th>
                <th className="ctz-boleta__th ctz-center">Cant.</th>
                <th className="ctz-boleta__th ctz-right">P. Unit.</th>
                <th className="ctz-boleta__th ctz-right">Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {(pedido.pedido_items || []).map(item => (
                <React.Fragment key={item.id}>
                  <tr className="ctz-boleta__row--prod">
                    <td>
                      <span className="ctz-strong">
                        {item.producto_variantes?.productos?.nombre || 'Producto'}
                      </span>
                      {item.producto_variantes?.sku && (
                        <span className="ctz-boleta__sku"> — {item.producto_variantes.sku}</span>
                      )}
                      {Object.entries(item.producto_variantes?.atributos || {})
                        .filter(([, v]) => v)
                        .map(([k, v]) => (
                          <span key={k} className="ctz-boleta__attr"> · {v}</span>
                        ))}
                    </td>
                    <td className="ctz-center">{item.cantidad}</td>
                    <td className="ctz-right">{fmt(item.precio_unitario_base)}</td>
                    <td className="ctz-right">
                      {fmt(item.cantidad * parseFloat(item.precio_unitario_base || 0))}
                    </td>
                  </tr>
                  {(item.pedido_item_servicios || []).map(sv => (
                    <tr key={sv.id} className="ctz-boleta__row--svc">
                      <td>
                        <span className="ctz-boleta__svc-lbl">Servicio: </span>
                        {sv.descripcion || 'Servicio'}
                        {sv.ubicacion && <span className="ctz-boleta__attr"> — {sv.ubicacion}</span>}
                        {sv.tamano    && <span className="ctz-boleta__attr"> {sv.tamano}</span>}
                      </td>
                      <td className="ctz-center">—</td>
                      <td className="ctz-right">—</td>
                      <td className="ctz-right">{fmt(sv.monto)}</td>
                    </tr>
                  ))}
                  {(item.pedido_item_unidades || []).length > 0 && (
                    <tr className="ctz-boleta__row--svc">
                      <td colSpan={4}>
                        <span className="ctz-boleta__svc-lbl">Unidades: </span>
                        {item.pedido_item_unidades.map((u, i) => (
                          <span key={u.id} className="ctz-boleta__attr">
                            {i > 0 && ' · '}{u.nombre || '—'}{u.sexo ? ` (${u.sexo})` : ''}
                          </span>
                        ))}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>

          <div className="ctz-boleta__totals">
            <div className="ctz-boleta__tot-row">
              <span>Subtotal</span><span>{fmt(pedido.subtotal)}</span>
            </div>
            {parseFloat(pedido.descuento || 0) > 0 && (
              <div className="ctz-boleta__tot-row">
                <span>Descuento</span><span>— {fmt(pedido.descuento)}</span>
              </div>
            )}
            <div className="ctz-boleta__tot-row ctz-boleta__tot-row--total">
              <span>TOTAL</span><span>{fmt(pedido.total)}</span>
            </div>
            {descontado > 0 && (
              <div className="ctz-boleta__tot-row">
                <span>Descuento por devolución</span><span>— {fmt(descontado)}</span>
              </div>
            )}
            {pagado > 0 && (
              <div className="ctz-boleta__tot-row">
                <span>Adelanto pagado</span><span>— {fmt(pagado)}</span>
              </div>
            )}
            <div className="ctz-boleta__tot-row ctz-boleta__tot-row--saldo">
              <span>SALDO</span><span>{fmt(Math.max(0, total - pagado))}</span>
            </div>
          </div>

          {pedido.notas && (
            <div className="ctz-boleta__notas">
              <span className="ctz-boleta__notas-lbl">Notas: </span>{pedido.notas}
            </div>
          )}
        </div>

        <div className="ctz-dialog__foot">
          <button className="ctz-btn ctz-btn--ghost" onClick={onClose}>Cerrar</button>
          <button className="ctz-btn ctz-btn--green" onClick={() => window.print()}>
            <FaPrint /> Imprimir boleta
          </button>
        </div>
      </div>
    </ModalBase>
  );
};

// ── ModalAceptar ──
// Próximo día hábil 18:00 como valor por defecto (mejoras.txt §6: el selector de fecha/hora es poco intuitivo).
const fechaSugeridaISO = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(18, 0, 0, 0);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const ahoraISOMin = () => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const ModalAceptar = ({ pedido, locales, adelantoPct, onClose, onHecho, onVerProduccion, onVerPedidos }) => {
  const [localId, setLocalId]           = useState(locales[0]?.id || '');
  const [metodoEntrega, setMetodoEntrega] = useState('recojo_tienda');
  const [fechaRecojo, setFechaRecojo]   = useState(fechaSugeridaISO());
  const [metodoPago, setMetodoPago]     = useState('efectivo');
  const [guardando, setGuardando]       = useState(false);
  const [error, setError]               = useState(null);
  const [resultado, setResultado]       = useState(null);

  // Cliente/teléfono/canal/tipo de venta se completan aquí, no en la cotización rápida (mejoras.txt §6).
  const [clienteId, setClienteId]       = useState(pedido.clientes?.id || null);
  const [clienteQuery, setClienteQuery] = useState(pedido.clientes?.nombre || '');
  const [clienteTelef, setClienteTelef] = useState(pedido.clientes?.telefono || '');
  const [clienteRes, setClienteRes]     = useState([]);
  const [showDrop, setShowDrop]         = useState(false);
  const [canal, setCanal]               = useState(pedido.canal === 'whatsapp' ? 'whatsapp' : 'presencial');

  const total  = parseFloat(pedido.total || 0);
  const minimo = +(total * (adelantoPct || 0) / 100).toFixed(2);
  // Adelanto precargado con el mínimo (mejoras.txt §6); el staff puede subirlo.
  const [montoAdelanto, setMontoAdelanto] = useState(minimo > 0 ? String(minimo) : '');

  useEffect(() => {
    if (!clienteQuery || clienteQuery.length < 2 || clienteId) { setClienteRes([]); return; }
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from('clientes')
        .select('id, nombre, telefono')
        .or(`nombre.ilike.%${clienteQuery}%,telefono.ilike.%${clienteQuery}%`)
        .limit(6);
      setClienteRes(data || []);
    }, 250);
    return () => clearTimeout(t);
  }, [clienteQuery, clienteId]);

  const submit = async () => {
    if (!fechaRecojo) { setError('Indica la fecha y hora de entrega prometida.'); return; }
    if (!clienteId && clienteQuery.trim().length < 2) {
      setError('Indica el cliente (nombre y teléfono) antes de aceptar.'); return;
    }
    if (!clienteId && clienteTelef.trim() && !esTelefonoValido(clienteTelef)) {
      setError('El teléfono debe tener 9 dígitos (celular de Perú).'); return;
    }
    if ((parseFloat(montoAdelanto) || 0) < minimo) {
      setError(`El adelanto no puede ser menor al mínimo (${fmt(minimo)} — ${adelantoPct}% de ${fmt(total)}).`);
      return;
    }
    setGuardando(true); setError(null);
    const { data, error: e } = await supabase.rpc('fn_aceptar_cotizacion', {
      p_pedido_id:         pedido.id,
      p_local_atencion_id: parseInt(localId),
      p_metodo_entrega:    metodoEntrega,
      p_fecha_recojo:      new Date(fechaRecojo).toISOString(),
      p_monto_adelanto:    parseFloat(montoAdelanto) || 0,
      p_metodo_pago:       (parseFloat(montoAdelanto) || 0) > 0 ? metodoPago : null,
      p_cliente_id:        clienteId || null,
      p_cliente_nombre:    !clienteId ? clienteQuery.trim() : null,
      p_cliente_telefono:  !clienteId ? clienteTelef.trim() : null,
      p_canal:             canal,
      // Tipo de venta ya no se pide en pantalla; valor fijo (reporte por tipo de venta es escalón futuro).
      p_tipo_venta:        'minorista',
    });
    setGuardando(false);
    if (e) {
      const msg = e.message || '';
      if (msg.includes('STOCK_INSUFICIENTE')) {
        setError('Stock insuficiente para cubrir todas las líneas. Revisa el inventario.');
      } else if (msg.includes('ADELANTO_INSUFICIENTE')) {
        setError(`El adelanto no alcanza el mínimo requerido (S/. ${minimo.toFixed(2)} — ${adelantoPct}% de ${fmt(total)}).`);
      } else if (msg.includes('FECHA_REQUERIDA')) {
        setError('Indica la fecha y hora de entrega prometida.');
      } else if (msg.includes('CLIENTE_REQUERIDO')) {
        setError('Indica el cliente antes de aceptar la cotización.');
      } else {
        setError(msg);
      }
      return;
    }
    setResultado(data);
  };

  if (resultado) {
    return (
      <ModalBase titulo="Cotización aceptada" onClose={() => onHecho(resultado)} ancho="520px">
        <div className="ctz-dialog__body">
          <div className="ctz-result-ok">
            <div className="ctz-result-ok__icon"><FaCheck /></div>
            <p className="ctz-result-ok__title">Boleta generada</p>
            <p className="ctz-result-ok__boleta">{resultado.numero_boleta}</p>
            <p className="ctz-result-ok__hint">El pedido ya está en la columna «Pendiente» del tablero de Producción.</p>
          </div>
          {resultado.traslados_requeridos?.length > 0 && (
            <div className="ctz-alert ctz-alert--amber">
              <FaExclamationTriangle />
              <div>
                <strong>Se requieren traslados de stock</strong>
                <ul className="ctz-traslado-list">
                  {resultado.traslados_requeridos.map((t, i) => (
                    <li key={i}>
                      {t.cantidad} ud. de <strong>{t.sku}</strong> — desde local #{t.local_origen_id}
                    </li>
                  ))}
                </ul>
                <p className="ctz-traslado-hint">Usa Inventario → Traslados para gestionarlos.</p>
              </div>
            </div>
          )}
          <div className="ctz-dialog__foot">
            <button className="ctz-btn ctz-btn--ghost" onClick={() => onHecho(resultado)}>
              Entendido
            </button>
            {onVerPedidos && (
              <button className="ctz-btn ctz-btn--ghost" onClick={() => { onHecho(resultado); onVerPedidos(); }}>
                Ver en Pedidos
              </button>
            )}
            <button className="ctz-btn ctz-btn--green" onClick={() => { onHecho(resultado); onVerProduccion?.(); }}>
              Ver en Producción
            </button>
          </div>
        </div>
      </ModalBase>
    );
  }

  return (
    <ModalBase
      titulo={`Aceptar cotización #${pedido.id}`}
      subtitulo={`${pedido.clientes?.nombre} — Total: ${fmt(pedido.total)}`}
      onClose={onClose} ancho="540px"
    >
      <div className="ctz-dialog__body">
        {error && <div className="ctz-alert ctz-alert--red">{error}</div>}

        <div className="ctz-ed__meta-row">
          <div className="ctz-field ctz-field--grow" style={{ position: 'relative' }}>
            <label className="ctz-label">Cliente</label>
            <div className="ctz-client-search">
              <FaUser className="ctz-client-search__icon" />
              <input
                type="text" className="ctz-input ctz-client-search__input"
                placeholder="Buscar por nombre o teléfono…"
                value={clienteQuery}
                autoComplete="off"
                onChange={e => { setClienteQuery(e.target.value); setClienteId(null); setShowDrop(true); }}
                onFocus={() => setShowDrop(true)}
                onBlur={() => setTimeout(() => setShowDrop(false), 180)}
              />
              {clienteId && <span className="ctz-client-check"><FaCheck /></span>}
            </div>
            {showDrop && clienteRes.length > 0 && (
              <div className="ctz-client-drop">
                {clienteRes.map(c => (
                  <button key={c.id} className="ctz-client-drop__item"
                    onMouseDown={() => { setClienteId(c.id); setClienteQuery(c.nombre); setClienteTelef(c.telefono); setShowDrop(false); }}>
                    <span className="ctz-client-drop__name">{c.nombre}</span>
                    <span className="ctz-client-drop__tel">{c.telefono}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          {!clienteId && (
            <div className="ctz-field" style={{ minWidth: 150 }}>
              <label className="ctz-label">Teléfono</label>
              <input type="tel" inputMode="numeric" maxLength={9} className="ctz-input" placeholder="999888777"
                value={clienteTelef} onChange={e => setClienteTelef(soloDigitos9(e.target.value))} />
            </div>
          )}
        </div>
        <div className="ctz-ed__meta-row">
          <div className="ctz-field">
            <label className="ctz-label">Canal</label>
            <select className="ctz-select" value={canal} onChange={e => setCanal(e.target.value)}>
              <option value="presencial">Presencial</option>
              <option value="whatsapp">WhatsApp</option>
            </select>
          </div>
        </div>

        <div className="ctz-field">
          <label className="ctz-label">Local de atención</label>
          <select className="ctz-select" value={localId} onChange={e => setLocalId(e.target.value)}>
            {locales.map(l => <option key={l.id} value={l.id}>{l.nombre}</option>)}
          </select>
        </div>
        <div className="ctz-field">
          <label className="ctz-label">Método de entrega</label>
          <div className="ctz-radio-group">
            <label className={`ctz-radio ${metodoEntrega === 'recojo_tienda' ? 'ctz-radio--on' : ''}`}>
              <input type="radio" name="entrega" value="recojo_tienda"
                checked={metodoEntrega === 'recojo_tienda'}
                onChange={() => setMetodoEntrega('recojo_tienda')} />
              <FaHandshake /> Recojo en tienda
            </label>
            <label className={`ctz-radio ${metodoEntrega === 'delivery_tercero' ? 'ctz-radio--on' : ''}`}>
              <input type="radio" name="entrega" value="delivery_tercero"
                checked={metodoEntrega === 'delivery_tercero'}
                onChange={() => setMetodoEntrega('delivery_tercero')} />
              <FaTruck /> Delivery
            </label>
          </div>
        </div>
        <div className="ctz-field">
          <label className="ctz-label">Fecha y hora de entrega prometida</label>
          <input type="datetime-local" className="ctz-input" required
            min={ahoraISOMin()}
            value={fechaRecojo} onChange={e => setFechaRecojo(e.target.value)} />
        </div>
        <div className="ctz-field">
          <label className="ctz-label">Adelanto (S/.)</label>
          <input type="number" min="0" step="0.01" className="ctz-input" placeholder="0.00"
            value={montoAdelanto} onChange={e => setMontoAdelanto(e.target.value)} />
          {adelantoPct > 0 && (
            <span className="ctz-hint-min">
              Mínimo: {fmt(minimo)} — {adelantoPct}% de {fmt(total)}
            </span>
          )}
        </div>
        {(parseFloat(montoAdelanto) || 0) > 0 && (
          <div className="ctz-field">
            <label className="ctz-label">Método del adelanto</label>
            <select className="ctz-select" value={metodoPago} onChange={e => setMetodoPago(e.target.value)}>
              {METODOS_PAGO.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>
        )}
        <div className="ctz-dialog__foot">
          <button className="ctz-btn ctz-btn--ghost" onClick={onClose}>Cancelar</button>
          <button className="ctz-btn ctz-btn--green" onClick={submit} disabled={guardando}>
            {guardando
              ? <><FaSpinner className="ctz-spin" /> Verificando stock…</>
              : <><FaCheck /> Aceptar y reservar stock</>}
          </button>
        </div>
      </div>
    </ModalBase>
  );
};

// ── ModalEditor ──
const ModalEditor = ({ pedidoInicial, serviciosCatalogo, solicitudId, onClose, onHecho }) => {
  const [guardando, setGuardando] = useState(false);
  const [error, setError]         = useState(null);

  // Creación rápida: cliente solo se busca/selecciona si ya existe (opcional).
  // Teléfono/canal/tipo de venta se completan al aceptar (mejoras.txt §6).
  const [clienteId, setClienteId]         = useState(pedidoInicial?.clientes?.id || null);
  const [clienteQuery, setClienteQuery]   = useState(pedidoInicial?.clientes?.nombre || '');
  const [clienteRes, setClienteRes]       = useState([]);
  const [showDrop, setShowDrop]           = useState(false);

  const [notas, setNotas]         = useState(pedidoInicial?.notas || '');
  const [descuento, setDescuento] = useState(String(pedidoInicial?.descuento || '0'));

  const [items, setItems] = useState(() => {
    if (!pedidoInicial?.pedido_items) return [];
    return pedidoInicial.pedido_items.map(item => ({
      tempId:       String(item.id),
      pedidoItemId: item.id || null,
      varianteId:   item.variante_id,
      kitGrupo:     item.kit_grupo || null,
      kitId:        item.kit_id || null,
      productoId:   item.producto_variantes?.productos?.id ?? null,
      varianteInfo: {
        sku:           item.producto_variantes?.sku,
        productoNombre: item.producto_variantes?.productos?.nombre || '—',
        atributos:     item.producto_variantes?.atributos,
        imagenUrl:     item.producto_variantes?.productos?.imagen_url,
        controlaStock: item.producto_variantes?.productos?.controla_stock ?? true,
      },
      // null = bajo pedido/confección (sin stock); se corrige con la carga real más abajo.
      stockCombinado: item.producto_variantes?.productos?.controla_stock === false ? null : 0,
      cantidad: item.cantidad,
      precioUnitarioBase: String(item.precio_unitario_base || 0),
      // mejoras.txt §9: trigger de "Confección" es decisión manual por línea, no por producto/categoría.
      requiereConfeccion: !!item.requiere_confeccion,
      servicios: (item.pedido_item_servicios || []).map(sv => ({
        tempId:     String(sv.id),
        servicioId: sv.servicio_id,
        descripcion: sv.descripcion || '',
        ubicacion:   sv.ubicacion || '',
        tamano:      sv.tamano || '',
        monto:       String(sv.monto || 0),
      })),
      unidades: (item.pedido_item_unidades || []).map(u => ({
        _key:   crypto.randomUUID(),
        nombre: u.nombre || '',
        sexo:   u.sexo || '',
      })),
    }));
  });

  // Bug corregido: los ítems precargados nacían con stockCombinado hardcodeado en 0 (mostraba
  // "disp. 0" aunque hubiera stock real); ahora se carga real al montar, como agregarVariante.
  useEffect(() => {
    const idsIniciales = (pedidoInicial?.pedido_items ?? [])
      .map(i => i.variante_id)
      .filter(Boolean);
    if (idsIniciales.length === 0) return;
    (async () => {
      const { data: stockRows } = await supabase
        .from('stock_variantes')
        .select('variante_id, cantidad_disponible')
        .in('variante_id', idsIniciales);
      const porVariante = {};
      (stockRows || []).forEach(r => {
        porVariante[r.variante_id] = (porVariante[r.variante_id] || 0) + (r.cantidad_disponible || 0);
      });
      setItems(prev => prev.map(i =>
        i.varianteId in porVariante ? { ...i, stockCombinado: porVariante[i.varianteId] } : i
      ));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [todasVariantes, setTodasVariantes] = useState([]);
  const [varQuery, setVarQuery]             = useState('');

  const [kitsCatalogo, setKitsCatalogo] = useState([]);
  // Metadatos por grupo de kit: { [grupo]: { kitId, kitNombre, cantidadKits } }
  const [kitGrupos, setKitGrupos] = useState({});

  useEffect(() => {
    supabase
      .from('producto_variantes')
      .select('id, sku, atributos, precio_base, productos(id, nombre, imagen_url, controla_stock)')
      .eq('activo', true)
      .then(({ data }) => setTodasVariantes(data || []));
    supabase
      .from('productos')
      .select('id, nombre, imagen_url, kit_componentes!kit_id(componente_id, cantidad_por_kit, orden, componente:productos!componente_id(id, nombre))')
      .eq('tipo', 'kit')
      .eq('activo', true)
      .then(({ data }) => setKitsCatalogo(data || []));
  }, []);

  // Al editar, reconstruye los metadatos de kits desde el catálogo.
  useEffect(() => {
    if (!kitsCatalogo.length) return;
    setKitGrupos(prev => {
      const next = { ...prev };
      items.filter(i => i.kitGrupo && !next[i.kitGrupo]).forEach(i => {
        const kit = kitsCatalogo.find(k => k.id === i.kitId);
        const cpk = kit?.kit_componentes?.find(c => c.componente_id === i.productoId)?.cantidad_por_kit || 1;
        next[i.kitGrupo] = {
          kitId:        i.kitId,
          kitNombre:    kit?.nombre || 'Kit',
          cantidadKits: Math.max(1, Math.round((parseInt(i.cantidad) || 1) / cpk)),
        };
      });
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kitsCatalogo]);

  useEffect(() => {
    if (!clienteQuery || clienteQuery.length < 2) { setClienteRes([]); return; }
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from('clientes')
        .select('id, nombre, telefono')
        .or(`nombre.ilike.%${clienteQuery}%,telefono.ilike.%${clienteQuery}%`)
        .limit(6);
      setClienteRes(data || []);
    }, 250);
    return () => clearTimeout(t);
  }, [clienteQuery]);

  const varFiltered = useMemo(() => {
    if (!varQuery || varQuery.length < 2) return [];
    const q = varQuery.toLowerCase();
    return todasVariantes
      .filter(v =>
        v.sku?.toLowerCase().includes(q) ||
        v.productos?.nombre?.toLowerCase().includes(q) ||
        Object.values(v.atributos || {}).some(a => String(a).toLowerCase().includes(q))
      )
      .slice(0, 10);
  }, [todasVariantes, varQuery]);

  // "Estampado" cobra por unidad (× cantidad); otros tipos son precio único — mismo criterio que fn_crear_cotizacion.
  const montoServicio = (sv, cantidad) => {
    const monto = parseFloat(sv.monto) || 0;
    const esEstampado = serviciosCatalogo.find(s => s.id === sv.servicioId)?.tipo === 'estampado';
    return esEstampado ? monto * (parseInt(cantidad) || 0) : monto;
  };

  const totalItem = (item) =>
    (parseInt(item.cantidad) || 0) * (parseFloat(item.precioUnitarioBase) || 0)
    + item.servicios.reduce((ss, sv) => ss + montoServicio(sv, item.cantidad), 0);

  const { subtotal, total } = useMemo(() => {
    const s = items.reduce((acc, item) => acc + totalItem(item), 0);
    const desc = parseFloat(descuento) || 0;
    return { subtotal: s, total: Math.max(0, s - desc) };
  }, [items, descuento, serviciosCatalogo]);

  const agregarVariante = async (variante) => {
    const controlaStock = variante.productos?.controla_stock ?? true;
    let stockCombinado = null;
    if (controlaStock) {
      const { data: stockRows } = await supabase
        .from('stock_variantes')
        .select('cantidad_disponible')
        .eq('variante_id', variante.id);
      stockCombinado = (stockRows || []).reduce((s, r) => s + (r.cantidad_disponible || 0), 0);
    }
    setItems(prev => [...prev, {
      tempId:    crypto.randomUUID(),
      varianteId: variante.id,
      varianteInfo: {
        sku:           variante.sku,
        productoNombre: variante.productos?.nombre || '—',
        atributos:     variante.atributos,
        imagenUrl:     variante.productos?.imagen_url,
        controlaStock,
      },
      stockCombinado,
      cantidad:          1,
      precioUnitarioBase: String(variante.precio_base || 0),
      requiereConfeccion: false,
      servicios: [],
      unidades: [],
    }]);
    setVarQuery('');
  };

  const actualizarItem = (tempId, campo, valor) =>
    setItems(prev => prev.map(i => i.tempId === tempId ? { ...i, [campo]: valor } : i));

  const actualizarUnidades = (tempId, nuevasUnidades) =>
    setItems(prev => prev.map(i => i.tempId === tempId ? { ...i, unidades: nuevasUnidades } : i));

  const eliminarItem = (tempId) =>
    setItems(prev => prev.filter(i => i.tempId !== tempId));

  // ── Kits ──
  // Agrega un kit: una línea por componente, todas unidas por un kit_grupo común.
  const agregarKit = async (kit) => {
    const grupo = crypto.randomUUID();
    const comps = (kit.kit_componentes || []).slice().sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0));
    const nuevas = [];
    for (const comp of comps) {
      const variantesProd = todasVariantes.filter(v => v.productos?.id === comp.componente_id);
      const variante = variantesProd[0] || null;
      const controlaStock = variante?.productos?.controla_stock ?? true;
      let stockCombinado = null;
      if (variante && controlaStock) {
        const { data: stockRows } = await supabase
          .from('stock_variantes')
          .select('cantidad_disponible')
          .eq('variante_id', variante.id);
        stockCombinado = (stockRows || []).reduce((s, r) => s + (r.cantidad_disponible || 0), 0);
      }
      nuevas.push({
        tempId:     crypto.randomUUID(),
        varianteId: variante?.id ?? null,
        kitGrupo:   grupo,
        kitId:      kit.id,
        productoId: comp.componente_id,
        varianteInfo: {
          sku:            variante?.sku,
          productoNombre: comp.componente?.nombre || '—',
          atributos:      variante?.atributos,
          imagenUrl:      variante?.productos?.imagen_url,
          controlaStock,
        },
        stockCombinado,
        cantidad:           comp.cantidad_por_kit,
        precioUnitarioBase: String(variante?.precio_base || 0),
        requiereConfeccion: false,
        servicios: [],
        unidades: [],
      });
    }
    setItems(prev => [...prev, ...nuevas]);
    setKitGrupos(prev => ({ ...prev, [grupo]: { kitId: kit.id, kitNombre: kit.nombre, cantidadKits: 1 } }));
    setVarQuery('');
  };

  // Cambiar el n.º de kits recalcula la cantidad de todas sus líneas.
  const setCantidadKits = (grupo, valor) => {
    const n = Math.max(1, parseInt(valor) || 1);
    setKitGrupos(prev => ({ ...prev, [grupo]: { ...prev[grupo], cantidadKits: n } }));
    const kit = kitsCatalogo.find(k => k.id === kitGrupos[grupo]?.kitId);
    setItems(prev => prev.map(i => {
      if (i.kitGrupo !== grupo) return i;
      const cpk = kit?.kit_componentes?.find(c => c.componente_id === i.productoId)?.cantidad_por_kit || 1;
      return { ...i, cantidad: n * cpk };
    }));
  };

  // Cambia la variante de una línea de kit (ej. otra tela).
  const cambiarVarianteKit = (tempId, varianteId) => {
    const variante = todasVariantes.find(v => v.id === parseInt(varianteId));
    if (!variante) return;
    setItems(prev => prev.map(i => i.tempId === tempId ? {
      ...i,
      varianteId: variante.id,
      varianteInfo: {
        ...i.varianteInfo,
        sku:       variante.sku,
        atributos: variante.atributos,
        imagenUrl: variante.productos?.imagen_url || i.varianteInfo?.imagenUrl,
      },
      precioUnitarioBase: String(variante.precio_base || 0),
    } : i));
  };

  // Un kit se quita completo (la composición es exacta; el server la valida)
  const quitarGrupoKit = (grupo) => {
    setItems(prev => prev.filter(i => i.kitGrupo !== grupo));
    setKitGrupos(prev => { const n = { ...prev }; delete n[grupo]; return n; });
  };

  const agregarServicio = (itemTempId, servicio) =>
    setItems(prev => prev.map(item => {
      if (item.tempId !== itemTempId) return item;
      return {
        ...item,
        servicios: [...item.servicios, {
          tempId:     crypto.randomUUID(),
          servicioId: servicio.id,
          descripcion: '',
          ubicacion:   '',
          tamano:      '',
          monto:       String(servicio.precio_referencia || 0),
        }],
      };
    }));

  const actualizarServicio = (itemTempId, svTempId, campo, valor) =>
    setItems(prev => prev.map(item => {
      if (item.tempId !== itemTempId) return item;
      return {
        ...item,
        servicios: item.servicios.map(sv =>
          sv.tempId === svTempId ? { ...sv, [campo]: valor } : sv
        ),
      };
    }));

  const eliminarServicio = (itemTempId, svTempId) =>
    setItems(prev => prev.map(item => {
      if (item.tempId !== itemTempId) return item;
      return { ...item, servicios: item.servicios.filter(sv => sv.tempId !== svTempId) };
    }));

  const submit = async () => {
    if (items.length === 0) { setError('Agrega al menos un producto.'); return; }
    if (items.some(i => i.kitGrupo && !i.varianteId)) {
      setError('Selecciona la variante de cada componente de los kits.'); return;
    }

    setGuardando(true); setError(null);

    const p_pedido = {
      id:               pedidoInicial?.id || null,
      cliente_id:       clienteId || null,
      // Cotización nace sin cliente resuelto; nombre/teléfono se piden al aceptar (mejoras.txt §6).
      cliente_nombre:   null,
      cliente_telefono: null,
      // Canal/tipo de venta reales se fijan al aceptar; aquí son solo relleno neutro del borrador.
      canal:            'presencial',
      tipo_venta:       'minorista',
      notas:            notas.trim() || null,
      descuento:        parseFloat(descuento) || 0,
    };

    const mapServicios = (item) => item.servicios.map(sv => ({
      servicio_id: sv.servicioId,
      descripcion: sv.descripcion || null,
      ubicacion:   sv.ubicacion || null,
      tamano:      sv.tamano || null,
      monto:       parseFloat(sv.monto) || 0,
    }));

    // Unidades viajan en el mismo guardado que la línea; antes usaban un RPC aparte que solo
    // funcionaba con id real, así que en ítems nuevos lo tipeado se perdía en silencio.
    const mapUnidades = (item) => item.unidades.map(u => ({
      nombre: u.nombre || null,
      sexo:   u.sexo || null,
    }));

    // Líneas de kit se envían agrupadas; el servidor las explota (cantidad = kits × cantidad_por_kit).
    const p_items = [
      ...items.filter(i => !i.kitGrupo).map(item => ({
        variante_id:         item.varianteId,
        cantidad:            parseInt(item.cantidad) || 1,
        precio_unitario_base: parseFloat(item.precioUnitarioBase) || 0,
        requiere_confeccion: !!item.requiereConfeccion,
        servicios:           mapServicios(item),
        unidades:            mapUnidades(item),
      })),
      ...Object.entries(kitGrupos)
        .filter(([grupo]) => items.some(i => i.kitGrupo === grupo))
        .map(([grupo, meta]) => ({
          kit_id:        meta.kitId,
          cantidad_kits: meta.cantidadKits,
          componentes:   items.filter(i => i.kitGrupo === grupo).map(item => ({
            variante_id:          item.varianteId,
            precio_unitario_base: parseFloat(item.precioUnitarioBase) || 0,
            requiere_confeccion:  !!item.requiereConfeccion,
            servicios:            mapServicios(item),
            unidades:             mapUnidades(item),
          })),
        })),
    ];

    const { error: e } = await supabase.rpc('fn_crear_cotizacion', { p_pedido, p_items, p_solicitud_id: solicitudId ?? null });
    setGuardando(false);
    if (e) { setError(e.message); return; }
    onHecho();
  };

  return (
    <ModalBase
      titulo={pedidoInicial?.id ? `Editar cotización #${pedidoInicial.id}` : 'Nueva cotización'}
      onClose={onClose} ancho="920px" cerrarAlClickFuera={false}
    >
      <div className="ctz-dialog__body">
        <div className="ctz-ed">
          {error && <div className="ctz-alert ctz-alert--red ctz-ed__alert">{error}</div>}

          {/* ── Meta del pedido ── */}
          <div className="ctz-ed__meta-row">
            <div className="ctz-field ctz-field--grow" style={{ position: 'relative' }}>
              <label className="ctz-label">Cliente (opcional)</label>
              <div className="ctz-client-search">
                <FaUser className="ctz-client-search__icon" />
                <input
                  type="text" className="ctz-input ctz-client-search__input"
                  placeholder="Buscar cliente existente por nombre o teléfono…"
                  value={clienteQuery}
                  autoComplete="off"
                  onChange={e => { setClienteQuery(e.target.value); setClienteId(null); setShowDrop(true); }}
                  onFocus={() => setShowDrop(true)}
                  onBlur={() => setTimeout(() => setShowDrop(false), 180)}
                />
                {clienteId && <span className="ctz-client-check"><FaCheck /></span>}
              </div>
              {showDrop && clienteRes.length > 0 && (
                <div className="ctz-client-drop">
                  {clienteRes.map(c => (
                    <button key={c.id} className="ctz-client-drop__item"
                      onMouseDown={() => { setClienteId(c.id); setClienteQuery(c.nombre); setShowDrop(false); }}>
                      <span className="ctz-client-drop__name">{c.nombre}</span>
                      <span className="ctz-client-drop__tel">{c.telefono}</span>
                    </button>
                  ))}
                </div>
              )}
              <p className="ctz-hint-min">
                Si es un prospecto nuevo, déjalo en blanco — se completa (nombre, teléfono, canal
                y tipo de venta) en la pantalla de "Aceptar cotización".
              </p>
            </div>
          </div>

          {/* ── Items ── */}
          <div className="ctz-ed__items-head">
            <h4 className="ctz-ed__section-title">Productos y servicios</h4>
            <span className="ctz-ed__item-count">{items.length} línea{items.length !== 1 ? 's' : ''}</span>
          </div>

          <div className="ctz-ed__items">
            {items.map((item, idx) => {
              const esKitLinea = !!item.kitGrupo;
              const primeraDelGrupo = esKitLinea && (idx === 0 || items[idx - 1].kitGrupo !== item.kitGrupo);
              const grupoMeta = esKitLinea ? kitGrupos[item.kitGrupo] : null;
              const variantesDelProducto = esKitLinea
                ? todasVariantes.filter(v => v.productos?.id === item.productoId)
                : [];
              return (
              <React.Fragment key={item.tempId}>
              {primeraDelGrupo && (
                <div className="ctz-kit-head">
                  <span className="ctz-kit-head__badge">Kit</span>
                  <span className="ctz-kit-head__name">{grupoMeta?.kitNombre || 'Conjunto'}</span>
                  <div className="ctz-field-inline">
                    <label className="ctz-label-sm">N.º de kits</label>
                    <input type="number" min="1" className="ctz-input-sm"
                      value={grupoMeta?.cantidadKits ?? 1}
                      onChange={e => setCantidadKits(item.kitGrupo, e.target.value)}
                      style={{ width: 60 }} />
                  </div>
                  <button className="ctz-icon-btn ctz-icon-btn--red"
                    onClick={() => quitarGrupoKit(item.kitGrupo)} title="Quitar el kit completo">
                    <FaTrash />
                  </button>
                </div>
              )}
              <div className={`ctz-ed-item ${esKitLinea ? 'ctz-ed-item--kit' : ''}`}>
                <div className="ctz-ed-item__head">
                  {item.varianteInfo?.imagenUrl && (
                    <img src={item.varianteInfo.imagenUrl} alt="" className="ctz-ed-item__img" />
                  )}
                  <div className="ctz-ed-item__info">
                    <p className="ctz-ed-item__name">{item.varianteInfo?.productoNombre}</p>
                    {esKitLinea ? (
                      // Variante del componente: talla/tela pueden diferir entre kits.
                      <select className="ctz-input-sm ctz-kit-var-select"
                        value={item.varianteId ?? ''}
                        onChange={e => cambiarVarianteKit(item.tempId, e.target.value)}>
                        <option value="">— Elegir variante —</option>
                        {variantesDelProducto.map(v => (
                          <option key={v.id} value={v.id}>
                            {[v.sku, ...Object.values(v.atributos || {}).filter(Boolean)].filter(Boolean).join(' · ') || `Variante ${v.id}`}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <p className="ctz-ed-item__sku">
                        {item.varianteInfo?.sku}
                        {Object.entries(item.varianteInfo?.atributos || {})
                          .filter(([, v]) => v).map(([, v]) => ` · ${v}`).join('')}
                      </p>
                    )}
                  </div>
                  <div className="ctz-ed-item__stock">
                    {item.stockCombinado == null ? (
                      <span className="ctz-stock-pill ctz-stock-pill--pedido" title="Bajo pedido/confección: no tiene stock en tienda, se fabrica desde cero">
                        Bajo pedido
                      </span>
                    ) : (
                      <span className={`ctz-stock-pill ${item.stockCombinado > 0 ? 'ctz-stock-pill--ok' : 'ctz-stock-pill--zero'}`}>
                        disp. {item.stockCombinado}
                      </span>
                    )}
                  </div>
                  <div className="ctz-ed-item__qty-price">
                    <div className="ctz-field-inline">
                      <label className="ctz-label-sm">Cant.</label>
                      <input type="number" min="1" className="ctz-input-sm"
                        value={item.cantidad}
                        disabled={esKitLinea}
                        title={esKitLinea ? 'La cantidad se controla con el n.º de kits del grupo' : undefined}
                        onChange={e => actualizarItem(item.tempId, 'cantidad', e.target.value)}
                        style={{ width: 60 }} />
                    </div>
                    <div className="ctz-field-inline">
                      <label className="ctz-label-sm">Precio S/.</label>
                      <input type="number" min="0" step="0.01" className="ctz-input-sm"
                        value={item.precioUnitarioBase}
                        onChange={e => actualizarItem(item.tempId, 'precioUnitarioBase', e.target.value)}
                        style={{ width: 80 }} />
                    </div>
                    <label className="ctz-field-inline ctz-confeccion-check" title="Esta línea pasa por la etapa de Confección después de Planchado">
                      <input type="checkbox"
                        checked={!!item.requiereConfeccion}
                        onChange={e => actualizarItem(item.tempId, 'requiereConfeccion', e.target.checked)} />
                      <span className="ctz-label-sm">Confección</span>
                    </label>
                  </div>
                  <div className="ctz-ed-item__line-total">
                    {fmt((parseInt(item.cantidad) || 0) * (parseFloat(item.precioUnitarioBase) || 0))}
                  </div>
                  {!esKitLinea && (
                    <button className="ctz-icon-btn ctz-icon-btn--red" onClick={() => eliminarItem(item.tempId)} title="Quitar producto">
                      <FaTrash />
                    </button>
                  )}
                </div>

                {item.servicios.length > 0 && (
                  <div className="ctz-ed-item__svcs">
                    {item.servicios.map(sv => (
                      <div key={sv.tempId} className="ctz-ed-svc">
                        <span className="ctz-ed-svc__tipo">
                          {serviciosCatalogo.find(s => s.id === sv.servicioId)?.nombre || 'Servicio'}
                        </span>
                        <input type="text" className="ctz-input-sm ctz-ed-svc__desc" placeholder="Descripción"
                          value={sv.descripcion} onChange={e => actualizarServicio(item.tempId, sv.tempId, 'descripcion', e.target.value)} />
                        <input type="text" className="ctz-input-sm ctz-ed-svc__ubic" placeholder="Ubicación"
                          value={sv.ubicacion} onChange={e => actualizarServicio(item.tempId, sv.tempId, 'ubicacion', e.target.value)} />
                        <input type="text" className="ctz-input-sm ctz-ed-svc__tam" placeholder="Tamaño"
                          value={sv.tamano} onChange={e => actualizarServicio(item.tempId, sv.tempId, 'tamano', e.target.value)} />
                        <input type="number" min="0" step="0.01" className="ctz-input-sm ctz-ed-svc__monto" placeholder="S/."
                          value={sv.monto} onChange={e => actualizarServicio(item.tempId, sv.tempId, 'monto', e.target.value)} />
                        {serviciosCatalogo.find(s => s.id === sv.servicioId)?.tipo === 'estampado' && (parseInt(item.cantidad) || 0) > 1 && (
                          <span className="ctz-ed-svc__calc">× {item.cantidad} = {fmt(montoServicio(sv, item.cantidad))}</span>
                        )}
                        <button className="ctz-icon-btn ctz-icon-btn--gray" onClick={() => eliminarServicio(item.tempId, sv.tempId)} aria-label="Quitar servicio">
                          <FaTimes />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="ctz-ed-item__svc-add">
                  <FaPlus className="ctz-ed-item__svc-add-icon" />
                  {serviciosCatalogo.map(s => (
                    <button key={s.id} className="ctz-svc-chip" onClick={() => agregarServicio(item.tempId, s)}>
                      + {s.nombre}
                    </button>
                  ))}
                </div>

                {/* Unidades por ítem: viaja en el mismo guardado */}
                <div style={{ padding: '0.5rem 1rem 0.75rem' }}>
                  <UnidadesEditorItem
                    productoNombre={item.varianteInfo?.productoNombre}
                    cantidad={parseInt(item.cantidad) || 1}
                    unidades={item.unidades}
                    onChange={(u) => actualizarUnidades(item.tempId, u)}
                    hermanosUnidades={esKitLinea
                      ? items
                          .filter(i => i.kitGrupo === item.kitGrupo && i.tempId !== item.tempId)
                          .map(i => ({ nombre: i.varianteInfo?.productoNombre || 'componente', unidades: i.unidades }))
                      : []}
                  />
                </div>
              </div>
              </React.Fragment>
              );
            })}
          </div>

          {/* ── Búsqueda de variante ── */}
          <div className="ctz-ed__var-search-wrap">
            <div className="ctz-ed__var-search">
              <FaSearch className="ctz-ed__var-search-icon" />
              <input type="text" className="ctz-input ctz-ed__var-input"
                placeholder="Buscar producto por nombre, SKU o color/talla para agregar…"
                value={varQuery} onChange={e => setVarQuery(e.target.value)} />
            </div>
            {varQuery.length >= 2 && kitsCatalogo.filter(k => k.nombre.toLowerCase().includes(varQuery.toLowerCase())).length > 0 && (
              <div className="ctz-var-results">
                {kitsCatalogo
                  .filter(k => k.nombre.toLowerCase().includes(varQuery.toLowerCase()))
                  .map(k => (
                    <button key={`kit-${k.id}`} className="ctz-var-result-item" onClick={() => agregarKit(k)}>
                      {k.imagen_url && (
                        <img src={k.imagen_url} alt="" className="ctz-var-result-item__img" />
                      )}
                      <div>
                        <p className="ctz-var-result-item__name">{k.nombre}</p>
                        <p className="ctz-var-result-item__sku">
                          Kit · {(k.kit_componentes || []).map(c =>
                            `${c.componente?.nombre}${c.cantidad_por_kit > 1 ? ` ×${c.cantidad_por_kit}` : ''}`
                          ).join(' + ')}
                        </p>
                      </div>
                      <span className="ctz-var-result-item__price">Se cotiza</span>
                    </button>
                  ))}
              </div>
            )}
            {varFiltered.length > 0 && (
              <div className="ctz-var-results">
                {varFiltered.map(v => (
                  <button key={v.id} className="ctz-var-result-item" onClick={() => agregarVariante(v)}>
                    {v.productos?.imagen_url && (
                      <img src={v.productos.imagen_url} alt="" className="ctz-var-result-item__img" />
                    )}
                    <div>
                      <p className="ctz-var-result-item__name">{v.productos?.nombre}</p>
                      <p className="ctz-var-result-item__sku">
                        {v.sku}
                        {Object.entries(v.atributos || {}).filter(([, val]) => val).map(([, val]) => ` · ${val}`).join('')}
                      </p>
                    </div>
                    <span className="ctz-var-result-item__price">{fmt(v.precio_base)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* ── Notas + totales ── */}
          <div className="ctz-ed__foot-row">
            <div className="ctz-ed__notas-wrap">
              <label className="ctz-label">Notas del pedido</label>
              <textarea className="ctz-textarea ctz-textarea--sm" rows={3}
                placeholder="Fecha esperada, instrucciones especiales, tallas, etc."
                value={notas} onChange={e => setNotas(e.target.value)} />
            </div>
            <div className="ctz-ed__totales">
              <div className="ctz-ed-tot-row">
                <span className="ctz-ed-tot-row__k">Subtotal</span>
                <span className="ctz-ed-tot-row__v">{fmt(subtotal)}</span>
              </div>
              <div className="ctz-ed-tot-row">
                <span className="ctz-ed-tot-row__k">Descuento S/.</span>
                <input type="number" min="0" step="0.01" className="ctz-input-sm ctz-ed-tot-row__input"
                  value={descuento} onChange={e => setDescuento(e.target.value)} />
              </div>
              <div className="ctz-ed-tot-row ctz-ed-tot-row--total">
                <span className="ctz-ed-tot-row__k">TOTAL</span>
                <span className="ctz-ed-tot-row__v">{fmt(total)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="ctz-dialog__foot">
        <button className="ctz-btn ctz-btn--ghost" onClick={onClose}>Cancelar</button>
        <button className="ctz-btn ctz-btn--green" onClick={submit} disabled={guardando || items.length === 0}>
          {guardando
            ? <><FaSpinner className="ctz-spin" /> Guardando…</>
            : pedidoInicial?.id ? 'Actualizar cotización' : 'Crear cotización'}
        </button>
      </div>
    </ModalBase>
  );
};

// ── ModalCerrado: detalle solo lectura (rechazadas/canceladas) ──
const ModalCerrado = ({ pedidoId, onClose }) => {
  const [pedido, setPedido]   = useState(null);
  const [cierre, setCierre]   = useState(null); // { estado, fecha, usuario }

  useEffect(() => {
    const cargar = async () => {
      const [{ data }, { data: hist }] = await Promise.all([
        supabase
          .from('pedidos')
          .select(`
            id, estado_comercial, subtotal, descuento, total, notas, created_at, pagos(monto),
            clientes(nombre, telefono),
            pedido_items(
              id, cantidad, precio_unitario_base,
              pedido_item_servicios(id, descripcion, ubicacion, tamano, monto),
              producto_variantes(id, sku, atributos, productos(nombre))
            )
          `)
          .eq('id', pedidoId)
          .single(),
        supabase
          .from('historial_estados')
          .select('estado_nuevo, usuario_id, created_at')
          .eq('pedido_id', pedidoId)
          .eq('campo', 'estado_comercial')
          .order('created_at', { ascending: false })
          .limit(1),
      ]);
      setPedido(data);
      if (hist?.length) {
        const h = hist[0];
        // Nombre del usuario que cerró (si el perfil es legible para este rol)
        const { data: perfil } = await supabase
          .from('profiles').select('nombre').eq('id', h.usuario_id).maybeSingle();
        setCierre({ estado: h.estado_nuevo, fecha: h.created_at, usuario: perfil?.nombre ?? null });
      }
    };
    cargar();
  }, [pedidoId]);

  if (!pedido) {
    return (
      <ModalBase titulo={`Detalle #${pedidoId}`} onClose={onClose} ancho="640px">
        <div className="ctz-dialog__body"><div className="ctz-loading"><FaSpinner className="ctz-spin" /> Cargando…</div></div>
      </ModalBase>
    );
  }

  const est    = ESTADO_CONFIG[pedido.estado_comercial] || {};
  const motivo = motivoDe(pedido.notas);

  return (
    <ModalBase
      titulo={`${est.label ?? 'Detalle'} #${pedido.id} — solo lectura`}
      subtitulo={`${pedido.clientes?.nombre ?? '—'} · creada ${fmtDate(pedido.created_at)}`}
      onClose={onClose} ancho="640px"
    >
      <div className="ctz-dialog__body">
        <div className="ctz-info-row">
          <span className="ctz-info-row__k">Estado</span>
          <span className={`ctz-badge ${est.clase}`}>{est.label}</span>
        </div>
        {cierre && (
          <div className="ctz-info-row">
            <span className="ctz-info-row__k">Cerrada</span>
            <span className="ctz-info-row__v">
              {fmtDateTime(cierre.fecha)}{cierre.usuario ? ` · por ${cierre.usuario}` : ''}
            </span>
          </div>
        )}
        {motivo && (
          <div className="ctz-alert ctz-alert--amber ctz-motivo">
            <FaExclamationTriangle />
            <div><strong>Motivo:</strong> {motivo}</div>
          </div>
        )}

        <h4 className="ctz-cerrado__h">Items</h4>
        {(pedido.pedido_items ?? []).map(item => (
          <div key={item.id} className="ctz-cerrado__item">
            <div className="ctz-cerrado__item-info">
              <span className="ctz-strong">{item.producto_variantes?.productos?.nombre ?? 'Producto'}</span>
              {item.producto_variantes?.sku && <span className="ctz-cerrado__sku"> · {item.producto_variantes.sku}</span>}
              <span className="ctz-cerrado__qty"> × {item.cantidad}</span>
              {(item.pedido_item_servicios ?? []).map(sv => (
                <p key={sv.id} className="ctz-cerrado__svc">Servicio: {sv.descripcion || '—'} — {fmt(sv.monto)}</p>
              ))}
            </div>
            <span>{fmt(item.cantidad * parseFloat(item.precio_unitario_base || 0))}</span>
          </div>
        ))}

        <div className="ctz-info-row"><span className="ctz-info-row__k">Subtotal</span><span className="ctz-info-row__v">{fmt(pedido.subtotal)}</span></div>
        {parseFloat(pedido.descuento || 0) > 0 && (
          <div className="ctz-info-row"><span className="ctz-info-row__k">Descuento</span><span className="ctz-info-row__v">— {fmt(pedido.descuento)}</span></div>
        )}
        <div className="ctz-info-row ctz-info-row--highlight">
          <span className="ctz-info-row__k">Total</span>
          <span className="ctz-info-row__v ctz-strong">{fmt(pedido.total)}</span>
        </div>
        {pagadoDe(pedido) > 0 && (
          <div className="ctz-info-row"><span className="ctz-info-row__k">Pagado</span><span className="ctz-info-row__v">{fmt(pagadoDe(pedido))}</span></div>
        )}

        <div className="ctz-dialog__foot">
          <button className="ctz-btn ctz-btn--ghost" onClick={onClose}>Cerrar</button>
        </div>
      </div>
    </ModalBase>
  );
};

// ── Configuración por modo ──
// La pantalla se adapta (mismo registro `pedidos` en distintos estados): cotizaciones =
// abiertas+rechazadas; pedidos = aceptados+cancelados (boletas, pagos, cancelación).
const MODOS = {
  cotizaciones: {
    estados:  ['cotizacion', 'rechazado'],
    titulo:   'Cotizaciones',
    vacio:    'No hay cotizaciones aún. Crea la primera con el botón de arriba.',
    filtros: [
      { key: 'todos',      label: 'Todas' },
      { key: 'cotizacion', label: 'Abiertas' },
      { key: 'rechazado',  label: 'Rechazadas' },
    ],
  },
  pedidos: {
    estados:  ['aceptado', 'cancelado'],
    titulo:   'Pedidos aceptados',
    vacio:    'Aún no hay pedidos aceptados. Acepta una cotización para verla aquí.',
    filtros: [
      { key: 'todos',     label: 'Todos' },
      { key: 'aceptado',  label: 'Activos' },
      { key: 'deuda',     label: 'Con deuda' },
      { key: 'cancelado', label: 'Cancelados' },
    ],
  },
};

// Aceptado + saldo pendiente; filtro especial que usa estado_pago, no estado_comercial.
const tieneDeuda = (p) => p.estado_comercial === 'aceptado' && p.estado_pago !== 'cancelado_total';

// ── CotizacionesTab (componente principal, parametrizado por modo) ──
const CotizacionesTab = ({ modo = 'cotizaciones', onVerProduccion, onVerPedidos }) => {
  const { perfil } = useAuth();
  const cfg = MODOS[modo] ?? MODOS.cotizaciones;
  const esModoCotiz = modo === 'cotizaciones';
  const [pedidos, setPedidos]   = useState([]);
  const [cargando, setCargando] = useState(true);
  const [filtro, setFiltro]     = useState('todos');
  const [vendedorFiltro, setVendedorFiltro] = useState(''); // '' | 'mias' | id de vendedor
  const [fechaDesde, setFechaDesde] = useState(''); // filtro de rango — solo modo 'pedidos'
  const [fechaHasta, setFechaHasta] = useState('');
  const [staff, setStaff]                 = useState([]);
  const [serviciosCatalogo, setServicios] = useState([]);
  const [locales, setLocales]             = useState([]);
  const [adelantoPct, setAdelantoPct]     = useState(50);
  const [avisoDias, setAvisoDias]         = useState(3);

  const [modalEditor,   setModalEditor]   = useState(null);
  const [modalAceptar,  setModalAceptar]  = useState(null);
  const [modalBoleta,   setModalBoleta]   = useState(null);
  const [modalPago,     setModalPago]     = useState(null);
  const [modalRechazar, setModalRechazar] = useState(null);
  const [modalCancelar, setModalCancelar] = useState(null);
  const [modalCerrado,  setModalCerrado]  = useState(null);
  const [modalSeg,      setModalSeg]      = useState(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    const { data } = await supabase
      .from('pedidos')
      .select(`
        id, canal, tipo_venta, estado_comercial, estado_pago, estado_produccion,
        subtotal, descuento, total, pagos(monto), devoluciones(monto, efecto),
        numero_boleta, created_at, accepted_at, notas, updated_at,
        fecha_recojo_estimada, metodo_entrega, local_atencion_id,
        vendedor_id, profiles!pedidos_vendedor_id_fkey(nombre),
        clientes(id, nombre, telefono)
      `)
      .in('estado_comercial', cfg.estados)
      // POS tiene su propio historial (mejoras.txt §7); no se mezcla con Cotizaciones/Pedidos.
      .eq('origen_pos', false)
      .order('created_at', { ascending: false });
    setPedidos(data || []);
    setCargando(false);
  }, [cfg.estados]);

  useEffect(() => {
    cargar();
    supabase.from('servicios').select('id, nombre, tipo, precio_referencia').eq('activo', true)
      .then(({ data }) => setServicios(data || []));
    supabase.from('locales').select('id, nombre, es_almacen').eq('activo', true).order('id')
      .then(({ data }) => setLocales(data || []));
    // Porcentaje de adelanto mínimo (informativo; la validación vive en el servidor)
    supabase.from('empresa_config').select('adelanto_minimo_pct, cotizacion_aviso_dias').eq('id', 1).maybeSingle()
      .then(({ data }) => {
        setAdelantoPct(data?.adelanto_minimo_pct ?? 50);
        setAvisoDias(data?.cotizacion_aviso_dias ?? 3);
      });
    // Vendedores para el filtro (Bloque D)
    supabase.from('profiles').select('id, nombre').eq('activo', true).neq('rol', 'bot').order('nombre')
      .then(({ data }) => setStaff(data || []));
  }, [cargar]);

  const abrirEditor = async (pedido) => {
    const { data } = await supabase
      .from('pedidos')
      .select(`
        id, canal, tipo_venta, notas, descuento,
        clientes(id, nombre, telefono),
        pedido_items(
          id, variante_id, cantidad, precio_unitario_base, requiere_confeccion, kit_grupo, kit_id,
          pedido_item_servicios(id, servicio_id, descripcion, ubicacion, tamano, monto),
          pedido_item_unidades(id, nombre, sexo),
          producto_variantes(id, sku, atributos, precio_base, productos(id, nombre, imagen_url, controla_stock))
        )
      `)
      .eq('id', pedido.id)
      .single();
    setModalEditor(data);
  };

  // "Duplicar como nueva": misma carga que editar, pero sin id → fn_crear_cotizacion crea un borrador nuevo.
  const duplicarComoNueva = async (pedido) => {
    const { data } = await supabase
      .from('pedidos')
      .select(`
        canal, tipo_venta, notas, descuento,
        clientes(id, nombre, telefono),
        pedido_items(
          id, variante_id, cantidad, precio_unitario_base, requiere_confeccion, kit_grupo, kit_id,
          pedido_item_servicios(id, servicio_id, descripcion, ubicacion, tamano, monto),
          pedido_item_unidades(id, nombre, sexo),
          producto_variantes(id, sku, atributos, precio_base, productos(id, nombre, imagen_url, controla_stock))
        )
      `)
      .eq('id', pedido.id)
      .single();
    // id null → fn_crear_cotizacion toma la rama de creación; ids de items solo sirven de key local.
    setModalEditor({ ...data, id: null });
  };

  const abrirBoleta = async (pedido) => {
    const { data } = await supabase
      .from('pedidos')
      .select(`
        id, numero_boleta, accepted_at, fecha_recojo_estimada,
        metodo_entrega, local_atencion_id, subtotal, descuento, total, pagos(monto), notas,
        clientes(nombre, telefono),
        pedido_items(
          id, cantidad, precio_unitario_base,
          pedido_item_servicios(id, descripcion, ubicacion, tamano, monto),
          pedido_item_unidades(id, nombre, sexo),
          producto_variantes(id, sku, atributos, productos(nombre))
        )
      `)
      .eq('id', pedido.id)
      .single();
    setModalBoleta(data);
  };

  const filtrados = (filtro === 'todos' ? pedidos
      : filtro === 'deuda' ? pedidos.filter(tieneDeuda)
      : pedidos.filter(p => p.estado_comercial === filtro))
    .filter(p => {
      if (!vendedorFiltro) return true;
      if (vendedorFiltro === 'mias') return p.vendedor_id === perfil?.id;
      return p.vendedor_id === vendedorFiltro;
    })
    .filter(p => {
      if (modo !== 'pedidos') return true;
      const fecha = (p.accepted_at || p.created_at || '').slice(0, 10);
      if (fechaDesde && fecha < fechaDesde) return false;
      if (fechaHasta && fecha > fechaHasta) return false;
      return true;
    });
  const counts = { todos: pedidos.length, deuda: pedidos.filter(tieneDeuda).length };
  cfg.estados.forEach(e => {
    counts[e] = pedidos.filter(p => p.estado_comercial === e).length;
  });

  const hecho = () => { cargar(); };

  return (
    <div className="ctz">
      <div className="ctz-head">
        <div>
          <h2 className="ctz-title">{cfg.titulo}</h2>
          <p className="ctz-subtitle">{pedidos.length} registro{pedidos.length !== 1 ? 's' : ''}</p>
        </div>
        {esModoCotiz && (
          <button className="ctz-nueva-btn" onClick={() => setModalEditor({})}>
            <FaPlus /> Nueva cotización
          </button>
        )}
      </div>

      <div className="ctz-filtros">
        {cfg.filtros.map(f => (
          <button
            key={f.key}
            className={`ctz-filtro-btn ${filtro === f.key ? 'ctz-filtro-btn--on' : ''}`}
            onClick={() => setFiltro(f.key)}
          >
            {f.label}
            <span className="ctz-filtro-btn__count">{counts[f.key] || 0}</span>
          </button>
        ))}
        <select className="ctz-vendedor-select" aria-label="Filtrar por vendedor" value={vendedorFiltro} onChange={(e) => setVendedorFiltro(e.target.value)}>
          <option value="">Todos los vendedores</option>
          <option value="mias">Mías</option>
          {staff.map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}
        </select>
        {modo === 'pedidos' && (
          <div className="ctz-fecha-rango">
            <input type="date" className="ctz-input ctz-fecha-rango__input" aria-label="Desde"
              value={fechaDesde} onChange={(e) => setFechaDesde(e.target.value)} />
            <span className="ctz-fecha-rango__sep">–</span>
            <input type="date" className="ctz-input ctz-fecha-rango__input" aria-label="Hasta"
              value={fechaHasta} onChange={(e) => setFechaHasta(e.target.value)} />
            {(fechaDesde || fechaHasta) && (
              <button type="button" className="ctz-filtro-btn" onClick={() => { setFechaDesde(''); setFechaHasta(''); }}>
                Limpiar
              </button>
            )}
          </div>
        )}
      </div>

      {cargando ? (
        <div className="ctz-loading"><FaSpinner className="ctz-spin" /> Cargando…</div>
      ) : filtrados.length === 0 ? (
        <div className="ctz-empty">
          {filtro === 'todos'
            ? cfg.vacio
            : `Sin registros en "${cfg.filtros.find(f => f.key === filtro)?.label}".`}
        </div>
      ) : (
        <div className="ctz-list">
          <div className="ctz-row-header" role="presentation">
            <span>Pedido</span><span>Cliente</span><span>Canal</span><span>Total</span><span>Estado</span><span>Fecha</span><span>Acciones</span>
          </div>
          {filtrados.map(pedido => {
            const est      = ESTADO_CONFIG[pedido.estado_comercial] || {};
            const esCotiz  = pedido.estado_comercial === 'cotizacion';
            const esAcept  = pedido.estado_comercial === 'aceptado';
            const pagado   = pagadoDe(pedido);
            const total    = totalEfectivoDe(pedido);
            const pagoFull = pedido.estado_pago === 'cancelado_total';
            const pctPago  = total > 0 ? Math.min(pagado / total, 1) : 0;
            return (
              <div key={pedido.id} className={`ctz-row ${esAcept ? 'ctz-row--aceptado' : ''}`}>
                <div className="ctz-row__id">
                  <span className="ctz-row__num">#{pedido.id}</span>
                  {pedido.numero_boleta && (
                    <span className="ctz-row__boleta" title="Número de boleta">
                      <FaFileInvoice className="ctz-boleta-icon-mini" /> {pedido.numero_boleta}
                    </span>
                  )}
                </div>
                <div className="ctz-row__cliente">
                  <div className="ctz-avatar" style={{ backgroundColor: getAvatarColor(pedido.clientes?.nombre) }}>
                    {getInitials(pedido.clientes?.nombre)}
                  </div>
                  <div className="ctz-row__cliente-info">
                    <span className="ctz-row__nombre" title={pedido.clientes?.nombre}>{pedido.clientes?.nombre || '—'}</span>
                    {pedido.clientes?.telefono ? (
                      <a
                        href={`https://wa.me/51${pedido.clientes.telefono.replace(/\s+/g, '')}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ctz-row__tel ctz-whatsapp-link"
                        title="Enviar mensaje de WhatsApp"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <FaWhatsapp className="ctz-whatsapp-icon-mini" /> {pedido.clientes.telefono}
                      </a>
                    ) : (
                      <span className="ctz-row__tel">—</span>
                    )}
                  </div>
                </div>
                <div className="ctz-row__canal">
                  {renderCanalChip(pedido.canal, CANAL_LABEL)}
                </div>
                <div className="ctz-row__total">
                  <span className="ctz-total-amount">{fmt(pedido.total)}</span>
                  {/* En Pedidos: cuánto va pagado, de un vistazo */}
                  {modo === 'pedidos' && esAcept && (
                    pagoFull ? (
                      <span className="ctz-pago-badge ctz-pago-badge--full" title="Pago completado al 100%">
                        <FaCheck /> Pago Total
                      </span>
                    ) : (
                      <div className="ctz-pago-mini" title={`Pagado ${fmt(pagado)} de ${fmt(total)}`}>
                        <div className="ctz-pago-mini__bar">
                          <div
                            className="ctz-pago-mini__fill"
                            style={{ transform: `scaleX(${pctPago})` }}
                          />
                        </div>
                        <span className="ctz-pago-mini__txt">
                          {Math.round(pctPago * 100)}% ({fmt(pagado)})
                        </span>
                      </div>
                    )
                  )}
                </div>
                <div className="ctz-row__estado">
                  <span className={`ctz-badge ${est.clase}`}>{est.label}</span>
                  {esCotiz && (Date.now() - new Date(pedido.updated_at).getTime()) / 86_400_000 > avisoDias && (
                    <span className="ctz-edad-badge" title={`Sin actividad hace más de ${avisoDias} días`}>
                      <FaExclamationTriangle /> &gt;{avisoDias}d
                    </span>
                  )}
                </div>
                <div className="ctz-row__fecha">
                  {modo === 'pedidos' && esAcept && pedido.fecha_recojo_estimada ? (
                    <div className="ctz-fecha-entrega-group">
                      <span className="ctz-fecha-label">Entrega prometida</span>
                      <span className={`ctz-fecha-badge ${esAtrasado(pedido.fecha_recojo_estimada) ? 'ctz-fecha-badge--atrasado' : esHoy(pedido.fecha_recojo_estimada) ? 'ctz-fecha-badge--hoy' : 'ctz-fecha-badge--futuro'}`}>
                        {esAtrasado(pedido.fecha_recojo_estimada) ? <FaExclamationTriangle className="ctz-icon-alert" /> : <FaCalendarAlt className="ctz-icon-cal" />}
                        {fmtDateTime(pedido.fecha_recojo_estimada)}
                      </span>
                    </div>
                  ) : (
                    <div className="ctz-fecha-entrega-group">
                      <span className="ctz-fecha-label">Fecha creación</span>
                      <span className="ctz-fecha-badge ctz-fecha-badge--creado">
                        <FaCalendarAlt className="ctz-icon-cal" />
                        {fmtDate(pedido.created_at)}
                      </span>
                    </div>
                  )}
                </div>
                <div className="ctz-row__acciones">
                  {/* Vocabulario: la cotización se RECHAZA; el pedido aceptado se CANCELA */}
                  {esCotiz && <>
                    <button className="ctz-act-btn ctz-act-btn--blue"  onClick={() => abrirEditor(pedido)} title="Editar cotización" aria-label={`Editar cotización #${pedido.id}`}><FaEdit /></button>
                    <button className="ctz-act-btn ctz-act-btn--green" onClick={() => setModalAceptar(pedido)} title="Aceptar cotización" aria-label={`Aceptar cotización #${pedido.id}`}><FaCheck /></button>
                    <button className="ctz-act-btn ctz-act-btn--amber" onClick={() => setModalRechazar(pedido.id)} title="Rechazar cotización" aria-label={`Rechazar cotización #${pedido.id}`}><FaBan /></button>
                    <button className="ctz-act-btn ctz-act-btn--blue" onClick={() => setModalSeg(pedido)} title="Programar seguimiento" aria-label={`Programar seguimiento para #${pedido.id}`}><FaCalendarPlus /></button>
                  </>}
                  {esAcept && <>
                    <button className="ctz-act-btn ctz-act-btn--green" onClick={() => abrirBoleta(pedido)} title="Ver boleta" aria-label={`Ver boleta de #${pedido.id}`}><FaFileInvoice /></button>
                    {/* Sin saldo pendiente no hay nada que registrar */}
                    {!pagoFull && (
                      <button className="ctz-act-btn ctz-act-btn--blue" onClick={() => setModalPago(pedido)} title="Registrar pago" aria-label={`Registrar pago de #${pedido.id}`}><FaMoneyBill /></button>
                    )}
                    <button className="ctz-act-btn ctz-act-btn--red" onClick={() => setModalCancelar(pedido)} title="Cancelar pedido" aria-label={`Cancelar pedido #${pedido.id}`}><FaTimes /></button>
                  </>}
                  {(pedido.estado_comercial === 'rechazado' || pedido.estado_comercial === 'cancelado') && (
                    <>
                      <button className="ctz-act-btn ctz-act-btn--blue" onClick={() => setModalCerrado(pedido.id)} title="Ver detalle (solo lectura)" aria-label={`Ver detalle de #${pedido.id}`}><FaEye /></button>
                      <button className="ctz-act-btn ctz-act-btn--green" onClick={() => duplicarComoNueva(pedido)} title="Duplicar como nueva cotización" aria-label={`Duplicar #${pedido.id} como nueva cotización`}><FaCopy /></button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {modalEditor !== null && (
        <ModalEditor
          pedidoInicial={modalEditor?.id ? modalEditor : null}
          serviciosCatalogo={serviciosCatalogo}
          onClose={() => setModalEditor(null)}
          onHecho={() => { setModalEditor(null); hecho(); }}
        />
      )}
      {modalAceptar && (
        <ModalAceptar
          pedido={modalAceptar} locales={locales} adelantoPct={adelantoPct}
          onClose={() => setModalAceptar(null)}
          onHecho={() => { setModalAceptar(null); hecho(); }}
          onVerProduccion={onVerProduccion}
          onVerPedidos={onVerPedidos}
        />
      )}
      {modalCerrado && (
        <ModalCerrado pedidoId={modalCerrado} onClose={() => setModalCerrado(null)} />
      )}
      {modalBoleta && (
        <ModalBoleta
          pedido={modalBoleta} locales={locales}
          onClose={() => setModalBoleta(null)}
        />
      )}
      {modalPago && (
        <ModalPago
          pedido={modalPago}
          onClose={() => setModalPago(null)}
          onHecho={() => { setModalPago(null); hecho(); }}
        />
      )}
      {modalRechazar && (
        <ModalRechazar
          pedidoId={modalRechazar}
          onClose={() => setModalRechazar(null)}
          onHecho={() => { setModalRechazar(null); hecho(); }}
        />
      )}
      {modalCancelar && (
        <ModalCancelar
          pedido={modalCancelar}
          onClose={() => setModalCancelar(null)}
          onHecho={() => { setModalCancelar(null); hecho(); }}
        />
      )}
      {modalSeg && (
        <ModalSeguimiento
          cliente={{ id: modalSeg.clientes?.id ?? null, nombre: modalSeg.clientes?.nombre, telefono: modalSeg.clientes?.telefono }}
          pedidoId={modalSeg.id}
          contextoLabel={`Cotización #${modalSeg.id}`}
          onClose={() => setModalSeg(null)}
          onCreado={() => setModalSeg(null)}
        />
      )}
    </div>
  );
};

export default CotizacionesTab;
