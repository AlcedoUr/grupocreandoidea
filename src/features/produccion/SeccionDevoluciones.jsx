import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../supabase/client';
import { mensajeError } from '../../lib/errores';
import { METODOS_PAGO } from '../../lib/constantes';
import { registrarDevolucion } from '../../api/pedidos';

// ── SeccionDevoluciones ──
// Registra vía fn_registrar_devolucion (validación completa en servidor: cantidades
// netas, reingreso de stock, transacción). Extraído de Pedidos.jsx en el Bloque 12.
const EFECTO_LABEL = { reembolso: 'Reembolso', descuento_saldo: 'Descuento de saldo' };

const SeccionDevoluciones = ({ pedido }) => {
  const esEntregado = pedido.estado_produccion === 'entregado';

  const [devoluciones, setDevoluciones] = useState([]);
  const [locales, setLocales]           = useState([]);
  const [pagado, setPagado]             = useState(0);
  const [abierto, setAbierto]           = useState(false);
  const [motivo, setMotivo]             = useState('');
  const [efecto, setEfecto]             = useState(esEntregado ? 'reembolso' : 'descuento_saldo');
  const [monto, setMonto]               = useState('');
  const [metodoPago, setMetodoPago]     = useState('efectivo');
  const [filas, setFilas]               = useState({}); // itemId → {cantidad, reingresa, localId}
  const [enviando, setEnviando]         = useState(false);
  const [error, setError]               = useState(null);

  const cargar = useCallback(async () => {
    const [{ data: devs }, { data: locs }, { data: pagos }] = await Promise.all([
      supabase.from('devoluciones')
        .select('id, motivo, monto, efecto, metodo_pago, creado_en, devolucion_items(pedido_item_id, cantidad, reingresa_stock, local_id)')
        .eq('pedido_id', pedido.id)
        .order('creado_en', { ascending: false }),
      supabase.from('locales').select('id, nombre').eq('activo', true).order('id'),
      supabase.from('pagos').select('monto').eq('pedido_id', pedido.id),
    ]);
    setDevoluciones(devs || []);
    setLocales(locs || []);
    setPagado((pagos || []).reduce((s, p) => s + parseFloat(p.monto || 0), 0));
  }, [pedido.id]);

  useEffect(() => { cargar(); }, [cargar]);

  const descontadoPrevio = devoluciones
    .filter((d) => d.efecto === 'descuento_saldo')
    .reduce((s, d) => s + parseFloat(d.monto || 0), 0);
  const totalEfectivo = parseFloat(pedido.total || 0) - descontadoPrevio;
  const saldo = Math.max(0, totalEfectivo - pagado);

  // Cantidad ya devuelta por item (para mostrar el máximo restante)
  const devueltas = {};
  devoluciones.forEach((d) => (d.devolucion_items ?? []).forEach((di) => {
    devueltas[di.pedido_item_id] = (devueltas[di.pedido_item_id] ?? 0) + di.cantidad;
  }));

  const setFila = (itemId, campo, valor) =>
    setFilas((f) => ({ ...f, [itemId]: { cantidad: 0, reingresa: false, localId: locales[0]?.id ?? '', ...f[itemId], [campo]: valor } }));

  const registrar = async (e) => {
    e.preventDefault();
    const items = Object.entries(filas)
      .filter(([, v]) => parseInt(v.cantidad) > 0)
      .map(([itemId, v]) => ({
        pedido_item_id:  parseInt(itemId),
        cantidad:        parseInt(v.cantidad),
        reingresa_stock: !!v.reingresa,
        local_id:        v.reingresa ? parseInt(v.localId) : null,
      }));
    if (items.length === 0) { setError('Indica al menos un artículo con cantidad.'); return; }
    setEnviando(true); setError(null);
    const { error: err } = await registrarDevolucion({
      pedidoId:   pedido.id,
      motivo:     motivo.trim(),
      items,
      efecto,
      monto:      parseFloat(monto) || 0,
      metodoPago: efecto === 'reembolso' ? metodoPago : null,
    });
    setEnviando(false);
    if (err) {
      setError(mensajeError(err, {
        LOCAL_REQUERIDO:       'Elige el local al que reingresa el stock.',
        MONTO_EXCEDE_SALDO:    () => `El descuento supera el saldo pendiente (S/.${saldo.toFixed(2)}).`,
        METODO_PAGO_REQUERIDO: 'Indica por qué método se hizo el reembolso.',
      }));
      return;
    }
    setAbierto(false); setMotivo(''); setMonto(''); setFilas({}); setMetodoPago('efectivo');
    cargar();
  };

  return (
    <div className="ped-dev">
      <h4 className="ped-section">Devoluciones</h4>

      {devoluciones.length > 0 && (
        <div className="ped-dev__list">
          {devoluciones.map((d) => (
            <div key={d.id} className="ped-dev__row">
              <span className="ped-dev__motivo">{d.motivo}</span>
              <span className="ped-dev__qty">
                {(d.devolucion_items ?? []).reduce((s, i) => s + i.cantidad, 0)} ud.
                {(d.devolucion_items ?? []).some((i) => i.reingresa_stock) && ' · reingresó a stock'}
              </span>
              <span className="ped-dev__monto">
                S/.{parseFloat(d.monto).toFixed(2)} — {EFECTO_LABEL[d.efecto] ?? d.efecto}
                {d.metodo_pago && ` (${METODOS_PAGO.find((mp) => mp.m === d.metodo_pago)?.label ?? d.metodo_pago})`}
              </span>
              <span className="ped-dev__fecha">{new Date(d.creado_en).toLocaleDateString('es-PE')}</span>
            </div>
          ))}
        </div>
      )}

      {abierto ? (
        <form className="ped-dev__form" onSubmit={registrar}>
          {error && <div className="ped-consumo__error" role="alert">{error}</div>}
          <input className="ped-consumo__input" placeholder="Motivo de la devolución" aria-label="Motivo de la devolución"
            value={motivo} onChange={(e) => setMotivo(e.target.value)} required />

          <div className="ped-dev__efecto">
            <label className={`ped-dev__radio ${efecto === 'descuento_saldo' ? 'ped-dev__radio--on' : ''}`}>
              <input type="radio" name="efecto" checked={efecto === 'descuento_saldo'}
                onChange={() => setEfecto('descuento_saldo')} />
              Descontar del saldo {saldo > 0 ? `(pendiente S/.${saldo.toFixed(2)})` : '(sin saldo pendiente)'}
            </label>
            <label className={`ped-dev__radio ${!esEntregado ? 'ped-dev__radio--disabled' : ''} ${efecto === 'reembolso' ? 'ped-dev__radio--on' : ''}`}>
              <input type="radio" name="efecto" checked={efecto === 'reembolso'} disabled={!esEntregado}
                onChange={() => setEfecto('reembolso')} />
              Reembolsar {!esEntregado && '(solo si ya fue entregado)'}
            </label>
          </div>
          {efecto === 'reembolso' && (
            <select className="ped-consumo__input" aria-label="Método del reembolso"
              value={metodoPago} onChange={(e) => setMetodoPago(e.target.value)}>
              {METODOS_PAGO.map(({ m, label }) => <option key={m} value={m}>{label}</option>)}
            </select>
          )}
          {(pedido.pedido_items ?? []).map((item) => {
            const max  = item.cantidad - (devueltas[item.id] ?? 0);
            const fila = filas[item.id] ?? {};
            if (max <= 0) return null;
            return (
              <div key={item.id} className="ped-dev__item">
                <span className="ped-dev__item-name">
                  {item.productos?.nombre ?? 'Producto'} <span className="ped-muted">(máx. {max})</span>
                </span>
                <input className="ped-consumo__input ped-consumo__input--qty" type="number" min="0" max={max}
                  placeholder="0" aria-label={`Cantidad a devolver de ${item.productos?.nombre ?? 'producto'}`}
                  value={fila.cantidad ?? ''} onChange={(e) => setFila(item.id, 'cantidad', e.target.value)} />
                <label className="ped-dev__check">
                  <input type="checkbox" checked={!!fila.reingresa}
                    onChange={(e) => setFila(item.id, 'reingresa', e.target.checked)} />
                  Reingresa a stock
                </label>
                {fila.reingresa && (
                  <select className="ped-consumo__input" aria-label="Local de reingreso" value={fila.localId ?? ''}
                    onChange={(e) => setFila(item.id, 'localId', e.target.value)}>
                    {locales.map((l) => <option key={l.id} value={l.id}>{l.nombre}</option>)}
                  </select>
                )}
              </div>
            );
          })}
          <div className="ped-dev__foot">
            <input className="ped-consumo__input ped-consumo__input--qty" type="number" step="0.01" min="0"
              placeholder={efecto === 'reembolso' ? 'Monto reembolsado (S/.)' : 'Monto a descontar (S/.)'}
              aria-label={efecto === 'reembolso' ? 'Monto reembolsado' : 'Monto a descontar'}
              value={monto} onChange={(e) => setMonto(e.target.value)} />
            <button type="button" className="ped-consumo__open" onClick={() => setAbierto(false)}>Cancelar</button>
            <button type="submit" className="ped-consumo__btn" disabled={enviando}>
              {enviando ? '…' : 'Registrar devolución'}
            </button>
          </div>
          <p className="ped-muted">El reingreso solo aplica a prendas no personalizadas: la decisión es tuya.</p>
        </form>
      ) : (
        <button className="ped-consumo__open" onClick={() => setAbierto(true)}>
          + Registrar devolución
        </button>
      )}
    </div>
  );
};

export default SeccionDevoluciones;
