import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  FaSearch, FaStore, FaTrash, FaPlus, FaMinus, FaReceipt,
  FaSpinner, FaBoxOpen, FaCheckCircle, FaCog, FaExclamationTriangle,
} from 'react-icons/fa';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabase/client';
import './PuntoVenta.css';

const METODOS_PAGO = [
  { val: 'efectivo', label: 'Efectivo' },
  { val: 'yape',     label: 'Yape' },
  { val: 'plin',     label: 'Plin' },
];

/* Formatea atributos de variante como "Talla: M · Color: Blanco" */
const fmtAtributos = (attrs) => {
  if (!attrs || typeof attrs !== 'object') return '';
  return Object.entries(attrs).map(([k, v]) => `${k}: ${v}`).join(' · ');
};

// Id de línea único incluso si se agrega la misma variante dos veces en el mismo ms
const nuevoLineId = (varianteId) =>
  (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? `${varianteId}-${crypto.randomUUID()}`
    : `${varianteId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const PuntoVenta = () => {
  const navigate = useNavigate();

  const [productos, setProductos] = useState([]);   // productos simples activos
  const [variantes, setVariantes] = useState([]);    // variantes con stock
  const [locales,   setLocales]   = useState([]);
  const [cargando,  setCargando]  = useState(true);

  const [busqueda, setBusqueda]   = useState('');
  const [localId,  setLocalId]    = useState('');

  // Producto seleccionado → mostrar sus variantes
  const [selProducto, setSelProducto] = useState(null);

  // Variante en proceso de agregar
  const [selVariante, setSelVariante] = useState(null);
  const [notasItem, setNotasItem]     = useState('');
  const [cantidadSel, setCantSel]     = useState(1);

  // POS es venta de mostrador sin captura de cliente (mejoras.txt §7): queda a nombre de "Público General".
  const CLIENTE_DEFAULT = { dni: '', nombre: 'Público General', telefono: '' };
  const [items, setItems]               = useState([]);
  const [descuento, setDescuento]       = useState('');
  const [metodoPago, setMetodoPago]     = useState('efectivo');

  const [enviando, setEnviando]   = useState(false);
  const [error, setError]         = useState('');
  const [exito, setExito]         = useState(null); // { id }
  const [confirmando, setConfirmando] = useState(false);
  // Historial POS (mejoras.txt §7): misma tabla `pedidos`, filtrada por `origen_pos = true`.
  const [vista, setVista]         = useState('venta'); // 'venta' | 'historial'
  const [historial, setHistorial] = useState([]);
  const [cargandoHist, setCargandoHist] = useState(false);
  const [histDesde, setHistDesde] = useState('');
  const [histHasta, setHistHasta] = useState('');

  // ── Carga inicial ──
  useEffect(() => {
    const cargar = async () => {
      const [{ data: prods, error: errProds }, { data: locs, error: errLocs }] = await Promise.all([
        supabase.from('productos')
          .select('id, nombre, imagen_url, tipo, controla_stock')
          .eq('activo', true).order('nombre'),
        supabase.from('locales').select('id, nombre').eq('activo', true).order('id'),
      ]);
      if (errProds || errLocs) setError('No se pudo cargar el catálogo o los locales. Recarga la página.');
      setProductos(prods ?? []);
      setLocales(locs ?? []);
      if (locs?.length) setLocalId(String(locs[0].id));
      setCargando(false);
    };
    cargar();
  }, []);

  // Cambiar de local invalida la selección en curso: el stock/precio mostrado era del local anterior.
  const cambiarLocal = (nuevoId) => {
    setLocalId(nuevoId);
    setSelProducto(null);
    setSelVariante(null);
  };

  // ── Cargar variantes + stock cuando cambia el local ──
  const cargarVariantes = useCallback(async (lid) => {
    if (!lid) return;
    // Traer todas las variantes activas con su stock en el local seleccionado
    const { data } = await supabase
      .from('producto_variantes')
      .select('id, sku, atributos, precio_base, producto_id, productos(id, nombre, imagen_url, tipo)')
      .eq('activo', true);

    if (!data) { setVariantes([]); return; }

    // Traer stock del local seleccionado
    const { data: stockRows } = await supabase
      .from('stock_variantes')
      .select('variante_id, cantidad_disponible')
      .eq('local_id', parseInt(lid));

    const stockMap = {};
    (stockRows || []).forEach(r => { stockMap[r.variante_id] = r.cantidad_disponible ?? 0; });

    // Enriquecer variantes con disponible
    const enriched = data
      .filter(v => v.productos?.tipo === 'simple') // Solo productos simples
      .map(v => ({
        ...v,
        disponible: stockMap[v.id] ?? 0,
      }));

    setVariantes(enriched);
  }, []);

  useEffect(() => {
    if (localId) cargarVariantes(localId);
  }, [localId, cargarVariantes]);

  // ── Filtro de productos ──
  const productosFiltrados = useMemo(() => {
    const term = busqueda.toLowerCase();
    return productos.filter((p) => p.nombre.toLowerCase().includes(term));
  }, [productos, busqueda]);

  // ── Precio "desde" por producto (mínimo de sus variantes activas) ──
  const precioDesde = useCallback((productoId) => {
    const del = variantes.filter(v => v.producto_id === productoId);
    if (!del.length) return null;
    return Math.min(...del.map(v => parseFloat(v.precio_base) || 0));
  }, [variantes]);

  // ── Variantes del producto seleccionado ──
  const variantesDelProducto = useMemo(() => {
    if (!selProducto) return [];
    return variantes
      .filter(v => v.producto_id === selProducto.id)
      .sort((a, b) => {
        // Poner las disponibles primero
        if (a.disponible > 0 && b.disponible === 0) return -1;
        if (a.disponible === 0 && b.disponible > 0) return 1;
        return (a.sku || '').localeCompare(b.sku || '');
      });
  }, [selProducto, variantes]);

  // ── Elegir producto ──
  // Kits y productos bajo pedido (controla_stock=false) no se agregan al POS: cada caso abre su propio aviso en vez del panel de variantes
  // (antes los kits quedaban muertos: se cortaba antes de fijar selProducto y el aviso nunca se mostraba).
  const elegirProducto = (p) => {
    setSelProducto(p);
    setSelVariante(null);
    setNotasItem('');
    setCantSel(1);
  };

  // ── Elegir variante ──
  const elegirVariante = (v) => {
    if (v.disponible <= 0) return;
    setSelVariante(v);
    setCantSel(1);
  };

  // ── Agregar al pedido ──
  const agregarAlPedido = () => {
    if (!selVariante) return;
    const precio = parseFloat(selVariante.precio_base) || 0;
    const maxDisp = selVariante.disponible;
    const cant = Math.max(1, Math.min(parseInt(cantidadSel) || 1, maxDisp));

    setItems((prev) => [...prev, {
      lineId:          nuevoLineId(selVariante.id),
      variante_id:     selVariante.id,
      producto_id:     selVariante.producto_id,
      nombre:          selVariante.productos?.nombre || '—',
      sku:             selVariante.sku,
      atributos:       selVariante.atributos,
      imagen_url:      selVariante.productos?.imagen_url,
      precio_unitario: precio,
      cantidad:        cant,
      subtotal:        +(precio * cant).toFixed(2),
      notas_produccion: notasItem.trim() || null,
      disponible:      maxDisp,
    }]);

    // Reducir disponible visual
    setVariantes(prev => prev.map(v =>
      v.id === selVariante.id ? { ...v, disponible: v.disponible - cant } : v
    ));

    setSelProducto(null);
    setSelVariante(null);
  };

  // ── Cambiar cantidad en ticket ──
  const cambiarCantidad = (lineId, delta) => {
    setItems((prev) => prev.map((it) => {
      if (it.lineId !== lineId) return it;
      // Buscar el disponible actual de la variante + lo que ya está en el ticket
      const otrosEnTicket = prev
        .filter(x => x.variante_id === it.variante_id && x.lineId !== lineId)
        .reduce((s, x) => s + x.cantidad, 0);
      const varActual = variantes.find(v => v.id === it.variante_id);
      const maxTotal = (varActual?.disponible ?? 0) + it.cantidad; // disponible + lo que ya tiene esta línea
      const maxPermitido = maxTotal - otrosEnTicket;

      const cant = Math.max(1, Math.min(it.cantidad + delta, maxPermitido));
      return { ...it, cantidad: cant, subtotal: +(it.precio_unitario * cant).toFixed(2) };
    }));
  };

  // ── Quitar item del ticket ──
  const quitarItem = (lineId) => {
    const item = items.find(it => it.lineId === lineId);
    if (item) {
      // Devolver disponible visual
      setVariantes(prev => prev.map(v =>
        v.id === item.variante_id ? { ...v, disponible: v.disponible + item.cantidad } : v
      ));
    }
    setItems((prev) => prev.filter((it) => it.lineId !== lineId));
  };

  // ── Totales ──
  const subtotal = items.reduce((s, it) => s + it.subtotal, 0);
  const desc     = Math.max(0, parseFloat(descuento) || 0);
  const total    = Math.max(0, subtotal - desc);

  // ── Generar pedido ──
  // Modal propio en vez de window.confirm: Chrome lo auto-suprime tras varios usos y el botón dejaba de responder (bug mejoras.txt §7).
  const pedirConfirmacion = () => {
    setError('');
    setExito(null);
    if (items.length === 0) { setError('Agrega al menos un producto.'); return; }
    if (!localId)           { setError('Selecciona el local de venta.'); return; }
    setConfirmando(true);
  };

  const generarPedido = async () => {
    setConfirmando(false);
    setEnviando(true);
    const { data: pedidoId, error: rpcError } = await supabase.rpc('fn_pos_venta', {
      p_nombre:          CLIENTE_DEFAULT.nombre,
      p_telefono:        CLIENTE_DEFAULT.telefono,
      p_dni:             CLIENTE_DEFAULT.dni,
      p_local_id:        parseInt(localId),
      p_metodo_pago:     metodoPago,
      p_items:           items.map(({ variante_id, cantidad, notas_produccion }) => ({
        variante_id,
        cantidad,
        notas_produccion: notas_produccion || undefined,
      })),
      p_descuento:       desc,
      p_referencia:      null,
      // mejoras.txt §7: venta de mostrador es producto ya listo, sin etapa de diseño.
      p_pasa_produccion: false,
    });
    setEnviando(false);

    if (rpcError) {
      console.error('Error en venta POS:', rpcError);
      const msg = rpcError.message || '';
      if (msg.includes('STOCK_INSUFICIENTE')) {
        const match = msg.match(/STOCK_INSUFICIENTE:\s*(.+)/);
        setError(match ? match[1] : 'Stock insuficiente en el local seleccionado.');
      } else if (msg.includes('NO_AUTORIZADO')) {
        setError('No tienes permisos para usar el Punto de Venta.');
      } else if (msg.includes('VARIANTE_INVALIDA')) {
        setError('Una de las variantes seleccionadas ya no está disponible.');
      } else if (msg.includes('PRODUCTO_ES_KIT')) {
        setError('Uno de los productos es un kit y debe cotizarse.');
      } else if (msg.includes('PRODUCTO_BAJO_PEDIDO')) {
        setError('Uno de los productos es bajo pedido/confección y debe cotizarse.');
      } else {
        setError('No se pudo generar el pedido. Revisa la consola (F12).');
      }
      return;
    }

    setExito({ id: pedidoId });
    setItems([]);
    setDescuento('');
    setMetodoPago('efectivo');
    cargarVariantes(localId);
  };

  // ── Historial de ventas POS (separado de Pedidos regulares) ──
  const cargarHistorial = useCallback(async () => {
    setCargandoHist(true);
    let q = supabase
      .from('pedidos')
      .select(`
        id, total, created_at, numero_boleta,
        clientes(nombre, telefono),
        pagos(monto, metodo_pago),
        pedido_items(cantidad)
      `)
      .eq('origen_pos', true)
      .order('created_at', { ascending: false })
      .limit(200);
    if (histDesde) q = q.gte('created_at', `${histDesde}T00:00:00`);
    if (histHasta) q = q.lte('created_at', `${histHasta}T23:59:59`);
    const { data } = await q;
    setHistorial(data ?? []);
    setCargandoHist(false);
  }, [histDesde, histHasta]);

  useEffect(() => {
    if (vista === 'historial') cargarHistorial();
  }, [vista, cargarHistorial]);

  // ── Navegar a cotizaciones con kit ──
  const irACotizar = () => {
    navigate('/dashboard/pedidos');
  };

  if (cargando) {
    return <div className="pos-loading"><FaSpinner className="pos-spin" /> Cargando punto de venta…</div>;
  }

  return (
    <div className="pos">
      {/* Ventas de mostrador vs. historial — separado de Pedidos regulares (mejoras.txt §7) */}
      <div className="pos-vista-switch">
        <button type="button" className={`pos-vista-btn ${vista === 'venta' ? 'pos-vista-btn--on' : ''}`} onClick={() => setVista('venta')}>
          Nueva venta
        </button>
        <button type="button" className={`pos-vista-btn ${vista === 'historial' ? 'pos-vista-btn--on' : ''}`} onClick={() => setVista('historial')}>
          Historial POS
        </button>
      </div>

      {vista === 'historial' ? (
        <section className="pos-historial">
          <div className="pos-historial__filtros">
            <input type="date" className="pos-input" aria-label="Desde" value={histDesde} onChange={(e) => setHistDesde(e.target.value)} />
            <span>–</span>
            <input type="date" className="pos-input" aria-label="Hasta" value={histHasta} onChange={(e) => setHistHasta(e.target.value)} />
          </div>
          {cargandoHist ? (
            <div className="pos-loading"><FaSpinner className="pos-spin" /> Cargando historial…</div>
          ) : historial.length === 0 ? (
            <p className="pos-grid__empty">Sin ventas de mostrador en el rango seleccionado.</p>
          ) : (
            <div className="pos-historial__list">
              {historial.map((v) => {
                const unidades = (v.pedido_items ?? []).reduce((s, i) => s + i.cantidad, 0);
                const pagado   = (v.pagos ?? []).reduce((s, p) => s + parseFloat(p.monto || 0), 0);
                return (
                  <div key={v.id} className="pos-historial__row">
                    <span className="pos-historial__id">#{v.id}{v.numero_boleta ? ` · ${v.numero_boleta}` : ''}</span>
                    <span>{v.clientes?.nombre ?? 'Público General'}</span>
                    <span>{unidades} ud.</span>
                    <span>{(v.pagos ?? []).map(p => p.metodo_pago).join(', ') || '—'}</span>
                    <span className="pos-historial__total">S/ {pagado.toFixed(2)}</span>
                    <span className="pos-historial__fecha">{new Date(v.created_at).toLocaleString('es-PE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      ) : (
      <div className="pos-body">
      {/* ===== CATÁLOGO ===== */}
      <section className="pos-catalog">
        <div className="pos-search">
          <FaSearch className="pos-search__icon" />
          <input
            type="text" placeholder="Buscar producto…" aria-label="Buscar producto"
            value={busqueda} onChange={(e) => setBusqueda(e.target.value)}
            className="pos-search__input"
          />
        </div>

        <div className="pos-grid">
          {productosFiltrados.map((p) => (
            <button
              key={p.id}
              className={`pos-prod ${selProducto?.id === p.id ? 'pos-prod--on' : ''} ${p.tipo === 'kit' || p.controla_stock === false ? 'pos-prod--kit' : ''}`}
              onClick={() => elegirProducto(p)}
            >
              <div className="pos-prod__media">
                {p.imagen_url ? <img src={p.imagen_url} alt={p.nombre} loading="lazy" decoding="async" /> : <FaBoxOpen className="pos-prod__noimg" />}
              </div>
              <span className="pos-prod__name">{p.nombre}</span>
              {p.tipo === 'kit' ? (
                <span className="pos-prod__badge-kit"><FaCog /> Se cotiza</span>
              ) : (
                <span className="pos-prod__price">
                  {precioDesde(p.id) != null ? `Desde S/ ${precioDesde(p.id).toFixed(2)}` : 'Sin variantes'}
                </span>
              )}
              {p.controla_stock === false && (
                <span className="pos-prod__badge-kit"><FaExclamationTriangle /> Bajo pedido</span>
              )}
            </button>
          ))}
          {productosFiltrados.length === 0 && <p className="pos-grid__empty">Sin productos.</p>}
        </div>

        {/* Panel de variantes del producto seleccionado */}
        {selProducto && selProducto.tipo === 'simple' && selProducto.controla_stock !== false && (
          <div className="pos-customize">
            <h3 className="pos-customize__title">
              {selVariante ? `Agregar: ${selProducto.nombre}` : `Variantes de: ${selProducto.nombre}`}
            </h3>

            {!selVariante ? (
              /* Lista de variantes */
              <div className="pos-variantes">
                {variantesDelProducto.length === 0 && (
                  <p className="pos-variantes__empty">Este producto no tiene variantes activas en este local.</p>
                )}
                {variantesDelProducto.map((v) => (
                  <button
                    key={v.id}
                    className={`pos-var ${v.disponible <= 0 ? 'pos-var--agotada' : ''}`}
                    onClick={() => elegirVariante(v)}
                    disabled={v.disponible <= 0}
                  >
                    <div className="pos-var__info">
                      {v.sku && <span className="pos-var__sku">{v.sku}</span>}
                      <span className="pos-var__attrs">{fmtAtributos(v.atributos) || 'Sin atributos'}</span>
                    </div>
                    <div className="pos-var__meta">
                      <span className="pos-var__price">S/ {Number(v.precio_base).toFixed(2)}</span>
                      <span className={`pos-var__stock ${v.disponible <= 0 ? 'pos-var__stock--out' : v.disponible <= 3 ? 'pos-var__stock--low' : ''}`}>
                        {v.disponible <= 0 ? 'Agotado' : `${v.disponible} disp.`}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              /* Detalle de variante seleccionada */
              <div className="pos-customize__body">
                <div className="pos-var-selected">
                  <span className="pos-var-selected__label">Variante:</span>
                  <span className="pos-var-selected__value">
                    {fmtAtributos(selVariante.atributos)}
                    {selVariante.sku && <span className="pos-var-selected__sku"> ({selVariante.sku})</span>}
                  </span>
                  <span className="pos-var-selected__price">S/ {Number(selVariante.precio_base).toFixed(2)}</span>
                  <span className={`pos-var__stock ${selVariante.disponible <= 3 ? 'pos-var__stock--low' : ''}`}>
                    {selVariante.disponible} disponibles
                  </span>
                </div>
                <label className="pos-flabel">Cantidad
                  <input type="number" min="1" max={selVariante.disponible} value={cantidadSel}
                    onChange={(e) => setCantSel(Math.min(parseInt(e.target.value) || 1, selVariante.disponible))}
                    className="pos-input" />
                </label>
                <label className="pos-flabel pos-flabel--full">Notas de producción
                  <textarea rows="2" placeholder="Ej. logo centrado al pecho…"
                    value={notasItem} onChange={(e) => setNotasItem(e.target.value)} className="pos-input" />
                </label>
              </div>
            )}

            <div className="pos-customize__foot">
              <button className="pos-btn pos-btn--ghost" onClick={() => {
                if (selVariante) { setSelVariante(null); } else { setSelProducto(null); }
              }}>
                {selVariante ? 'Volver' : 'Cancelar'}
              </button>
              {selVariante && (
                <button className="pos-btn pos-btn--primary" onClick={agregarAlPedido}>
                  <FaPlus /> Añadir al pedido
                </button>
              )}
            </div>
          </div>
        )}

        {/* Aviso para kits */}
        {selProducto && selProducto.tipo === 'kit' && (
          <div className="pos-customize pos-customize--kit">
            <h3 className="pos-customize__title">
              <FaExclamationTriangle className="pos-kit-warn" /> {selProducto.nombre}
            </h3>
            <p className="pos-kit-msg">
              Este producto es un <strong>kit/conjunto</strong> y requiere cotización personalizada.
            </p>
            <div className="pos-customize__foot">
              <button className="pos-btn pos-btn--ghost" onClick={() => setSelProducto(null)}>Cerrar</button>
              <button className="pos-btn pos-btn--primary" onClick={irACotizar}>
                <FaReceipt /> Ir a Cotizaciones
              </button>
            </div>
          </div>
        )}

        {/* Aviso para productos bajo pedido/confección (sin stock en tienda) */}
        {selProducto && selProducto.tipo === 'simple' && selProducto.controla_stock === false && (
          <div className="pos-customize pos-customize--kit">
            <h3 className="pos-customize__title">
              <FaExclamationTriangle className="pos-kit-warn" /> {selProducto.nombre}
            </h3>
            <p className="pos-kit-msg">
              Este producto es <strong>bajo pedido / confección</strong>: se fabrica desde cero,
              no tiene stock físico en tienda. Se vende por cotización.
            </p>
            <div className="pos-customize__foot">
              <button className="pos-btn pos-btn--ghost" onClick={() => setSelProducto(null)}>Cerrar</button>
              <button className="pos-btn pos-btn--primary" onClick={irACotizar}>
                <FaReceipt /> Ir a Cotizaciones
              </button>
            </div>
          </div>
        )}
      </section>

      {/* ===== TICKET ===== */}
      <aside className="pos-ticket">
        <div className="pos-ticket__local">
          <label className="pos-flabel" htmlFor="pos-local-select"><FaStore /> Local de venta</label>
          <select id="pos-local-select" className="pos-input pos-input--local" value={localId} onChange={(e) => cambiarLocal(e.target.value)}>
            {locales.map((l) => <option key={l.id} value={l.id}>{l.nombre}</option>)}
          </select>
        </div>

        <div className="pos-ticket__items">
          <h3 className="pos-ticket__label">Pedido actual</h3>
          {items.length === 0 && <p className="pos-ticket__empty">Aún no hay productos en el ticket.</p>}
          {items.map((it) => (
            <div key={it.lineId} className="pos-line">
              <div className="pos-line__info">
                <p className="pos-line__name">{it.nombre}</p>
                <p className="pos-line__detail">
                  {fmtAtributos(it.atributos)}
                  {it.sku && <span className="pos-line__sku"> · {it.sku}</span>}
                </p>
                {it.notas_produccion && (
                  <p className="pos-line__notas">{it.notas_produccion}</p>
                )}
              </div>
              <div className="pos-line__right">
                <span className="pos-line__sub">S/ {it.subtotal.toFixed(2)}</span>
                <div className="pos-qty">
                  <button onClick={() => cambiarCantidad(it.lineId, -1)} aria-label="Restar"><FaMinus /></button>
                  <span>{it.cantidad}</span>
                  <button onClick={() => cambiarCantidad(it.lineId, 1)} aria-label="Sumar"><FaPlus /></button>
                </div>
              </div>
              <button className="pos-line__del" onClick={() => quitarItem(it.lineId)} aria-label="Eliminar"><FaTrash /></button>
            </div>
          ))}
        </div>

        <div className="pos-ticket__foot">
          <div className="pos-sumrow"><span>Subtotal</span><span>S/ {subtotal.toFixed(2)}</span></div>
          <div className="pos-sumrow">
            <span>Descuento</span>
            <span className="pos-desc">- S/ <input type="number" min="0" step="0.01" value={descuento}
              aria-label="Descuento" onChange={(e) => setDescuento(e.target.value)} placeholder="0.00" className="pos-desc__input" /></span>
          </div>
          {parseFloat(descuento) > subtotal && (
            <p className="pos-desc__warn" role="alert">El descuento supera el subtotal: se aplicará como S/ {subtotal.toFixed(2)}.</p>
          )}
          <div className="pos-sumrow pos-sumrow--total"><span>Total</span><span>S/ {total.toFixed(2)}</span></div>

          <div className="pos-field">
            <span className="pos-flabel">Método de pago</span>
            <div className="pos-methods-grid">
              {METODOS_PAGO.map((m) => (
                <button
                  key={m.val}
                  type="button"
                  className={`pos-method-btn ${metodoPago === m.val ? 'pos-method-btn--active' : ''}`}
                  onClick={() => setMetodoPago(m.val)}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {error && <p className="pos-error" role="alert">{error}</p>}
          {exito && (
            <p className="pos-ok">
              <FaCheckCircle /> Venta #{exito.id} registrada.
            </p>
          )}

          <button className="pos-generar" onClick={pedirConfirmacion} disabled={enviando || items.length === 0}>
            {enviando ? <><FaSpinner className="pos-spin" /> Generando…</> : <><FaReceipt /> Generar pedido</>}
          </button>
        </div>
      </aside>

      {confirmando && (
        <div className="pos-confirm-overlay" onClick={() => setConfirmando(false)}>
          <div className="pos-confirm" onClick={(e) => e.stopPropagation()}>
            <h3 className="pos-confirm__title">Confirmar venta</h3>
            <p className="pos-confirm__text">¿Cobrar S/ {total.toFixed(2)} por {METODOS_PAGO.find(m => m.val === metodoPago)?.label}?</p>
            <div className="pos-confirm__actions">
              <button type="button" className="pos-confirm__btn" onClick={() => setConfirmando(false)}>Cancelar</button>
              <button type="button" className="pos-confirm__btn pos-confirm__btn--primary" onClick={generarPedido}>Confirmar</button>
            </div>
          </div>
        </div>
      )}
      </div>
      )}
    </div>
  );
};

export default PuntoVenta;
