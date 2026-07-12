import React, { useState, useEffect, useCallback } from 'react';
import {
  FaSpinner, FaCheck, FaTimes, FaWarehouse, FaExchangeAlt,
  FaPlus, FaSlidersH, FaHistory, FaTruck, FaBoxOpen,
  FaSearch, FaBan, FaStore,
} from 'react-icons/fa';
import { supabase } from '../supabase/client';
import { MENSAJE_AAL2_REQUERIDO, esErrorAal2 } from '../lib/mensajesError';
import './Inventario.css';

// ─── Helpers ──
const fmt = (d) =>
  d ? new Date(d).toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short' }) : '—';

const nivelDisp = (n) => {
  if (n <= 0)  return 'inv-lvl--out';
  if (n <= 5)  return 'inv-lvl--crit';
  if (n <= 15) return 'inv-lvl--low';
  return 'inv-lvl--ok';
};

const atributosStr = (obj) =>
  Object.entries(obj || {}).map(([k, v]) => `${k}: ${v}`).join(' · ') || '—';

const ESTADO_META = {
  solicitado: { label: 'Solicitado',   cls: 'inv-badge--blue'  },
  despachado: { label: 'En tránsito',  cls: 'inv-badge--amber' },
  recibido:   { label: 'Recibido',     cls: 'inv-badge--green' },
  cancelado:  { label: 'Cancelado',    cls: 'inv-badge--gray'  },
};

const TIPO_META = {
  ingreso:    { label: 'Ingreso',     cls: 'inv-tipo--green'  },
  salida:     { label: 'Salida',      cls: 'inv-tipo--red'    },
  traslado:   { label: 'Traslado',    cls: 'inv-tipo--blue'   },
  ajuste:     { label: 'Ajuste',      cls: 'inv-tipo--amber'  },
  reserva:    { label: 'Reserva',     cls: 'inv-tipo--purple' },
  liberacion: { label: 'Liberación',  cls: 'inv-tipo--gray'   },
};

// ─── MinimoInput ── edita localmente, guarda al perder foco (o Enter) solo si cambió.
const MinimoInput = ({ minimo, onGuardar, step }) => {
  const [valor, setValor] = useState(minimo);
  useEffect(() => { setValor(minimo); }, [minimo]);

  const guardar = () => {
    const n = parseFloat(valor);
    if (!isNaN(n) && n >= 0 && n !== minimo) onGuardar(n);
    else setValor(minimo);
  };

  return (
    <input
      type="number" min="0" step={step ?? 1} className="inv-min-input"
      value={valor} onChange={(e) => setValor(e.target.value)}
      onBlur={guardar}
      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      onClick={(e) => e.stopPropagation()}
      title="Mínimo antes de alertar"
    />
  );
};

// ─── StockMiniCell ──
const StockMiniCell = ({ fisica, reservada, disponible, minimo, onGuardarMinimo }) => {
  const bajoMinimo = minimo > 0 && disponible < minimo;
  return (
    <div className={`inv-mini ${bajoMinimo ? 'inv-mini--bajo-minimo' : ''}`}>
      <div className="inv-mini__row">
        <span className="inv-mini__lbl">Físico</span>
        <span className="inv-mini__val">{fisica}</span>
      </div>
      {reservada > 0 && (
        <div className="inv-mini__row" title="Reservado: ya está apartado para pedidos aceptados (adelanto pagado), aunque físicamente siga en el local hasta pasar por Planchado.">
          <span className="inv-mini__lbl">Res.</span>
          <span className="inv-mini__val inv-mini__val--res">{reservada}</span>
        </div>
      )}
      <div className={`inv-mini__disp ${nivelDisp(disponible)}`} title="Disponible: físico menos lo reservado — lo que realmente se puede vender u ofrecer ahora.">
        <span className="inv-mini__lbl">Disp.</span>
        <span className="inv-mini__val">{disponible}</span>
      </div>
      <div className="inv-mini__row">
        <span className="inv-mini__lbl">Mín.</span>
        <MinimoInput minimo={minimo} onGuardar={onGuardarMinimo} />
      </div>
      {bajoMinimo && <span className="inv-mini__alerta">⚠ Bajo mínimo</span>}
    </div>
  );
};

// ─── BaseModal ──
const BaseModal = ({ title, icon: Icon, onClose, children }) => (
  <div className="inv-modal" onClick={onClose}>
    <div className="inv-dialog" onClick={(e) => e.stopPropagation()}>
      <div className="inv-dialog__head">
        <h3 className="inv-dialog__title">{Icon && <Icon />} {title}</h3>
        <button onClick={onClose} className="inv-dialog__close" aria-label="Cerrar">
          <FaTimes />
        </button>
      </div>
      {children}
    </div>
  </div>
);

const VarianteProd = ({ fila }) => (
  <div className="inv-dialog__prod">
    {fila.imagenUrl
      ? <img src={fila.imagenUrl} alt={fila.productoNombre} className="inv-dialog__img" />
      : <div className="inv-dialog__img inv-dialog__img--empty" />}
    <div>
      <p className="inv-dialog__name">{fila.productoNombre}</p>
      <p className="inv-dialog__total">{atributosStr(fila.atributos)}</p>
    </div>
  </div>
);

// ─── ModalIngreso ──
const ModalIngreso = ({ fila, locales, onClose, onHecho }) => {
  const [localId, setLocalId]   = useState(String(locales[0]?.id ?? ''));
  const [cantidad, setCantidad] = useState('');
  const [motivo, setMotivo]     = useState('');
  const [proveedor, setProveedor] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError]       = useState('');

  const enviar = async (e) => {
    e.preventDefault();
    setError('');
    const n = parseInt(cantidad);
    if (!n || n <= 0) { setError('La cantidad debe ser un número positivo.'); return; }

    setEnviando(true);
    const { error: rpcError } = await supabase.rpc('fn_ingresar_stock', {
      p_variante_id: fila.varianteId,
      p_local_id:    parseInt(localId),
      p_cantidad:    n,
      p_motivo:      motivo || null,
      p_proveedor:   proveedor || null,
    });
    setEnviando(false);
    if (rpcError) { setError(esErrorAal2(rpcError) ? MENSAJE_AAL2_REQUERIDO : rpcError.message); return; }
    onHecho();
  };

  return (
    <BaseModal title="Ingresar stock" icon={FaPlus} onClose={onClose}>
      <VarianteProd fila={fila} />
      <form onSubmit={enviar} className="inv-form">
        <label className="inv-flabel">Local de destino
          <select value={localId} onChange={(e) => setLocalId(e.target.value)} className="inv-input">
            {locales.map((l) => <option key={l.id} value={l.id}>{l.nombre}</option>)}
          </select>
          <span className="inv-hint">
            Físico actual: {fila.stock[parseInt(localId)]?.fisica ?? 0} ud.
          </span>
        </label>
        <label className="inv-flabel">Cantidad a ingresar
          <input type="number" min="1" value={cantidad}
            onChange={(e) => setCantidad(e.target.value)}
            className="inv-input" placeholder="Ej. 20" />
        </label>
        <label className="inv-flabel">Motivo
          <input type="text" value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            className="inv-input" placeholder="Ej. Compra de tela, restock" />
        </label>
        <label className="inv-flabel">Proveedor (opcional)
          <input type="text" value={proveedor}
            onChange={(e) => setProveedor(e.target.value)}
            className="inv-input" placeholder="Ej. Textiles del Norte SAC" />
        </label>
        {error && <p className="inv-error">{error}</p>}
        <div className="inv-form__foot">
          <button type="button" onClick={onClose} disabled={enviando} className="inv-btn inv-btn--ghost">
            Cancelar
          </button>
          <button type="submit" disabled={enviando} className="inv-btn inv-btn--primary">
            {enviando ? <><FaSpinner className="inv-spin" /> Guardando…</> : <><FaCheck /> Confirmar ingreso</>}
          </button>
        </div>
      </form>
    </BaseModal>
  );
};

// ─── ModalAjuste ──
const ModalAjuste = ({ fila, locales, onClose, onHecho }) => {
  const [localId, setLocalId]   = useState(String(locales[0]?.id ?? ''));
  const [cantReal, setCantReal] = useState('');
  const [motivo, setMotivo]     = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError]       = useState('');

  const lid = parseInt(localId);
  const actual = fila.stock[lid]?.fisica ?? 0;
  const delta  = cantReal !== '' ? (parseInt(cantReal) || 0) - actual : null;

  const enviar = async (e) => {
    e.preventDefault();
    setError('');
    const n = parseInt(cantReal);
    if (isNaN(n) || n < 0) { setError('Ingresa un conteo real válido (≥ 0).'); return; }
    const deltaFinal = n - actual;
    if (deltaFinal !== 0 && !window.confirm(
      `Vas a cambiar el físico de ${actual} a ${n} ud. (delta ${deltaFinal > 0 ? '+' : ''}${deltaFinal}). ¿Confirmar ajuste?`
    )) return;

    setEnviando(true);
    const { error: rpcError } = await supabase.rpc('fn_ajustar_stock', {
      p_variante_id:   fila.varianteId,
      p_local_id:      lid,
      p_cantidad_real: n,
      p_motivo:        motivo || null,
    });
    setEnviando(false);
    if (rpcError) { setError(esErrorAal2(rpcError) ? MENSAJE_AAL2_REQUERIDO : rpcError.message); return; }
    onHecho();
  };

  return (
    <BaseModal title="Ajustar stock" icon={FaSlidersH} onClose={onClose}>
      <VarianteProd fila={fila} />
      <form onSubmit={enviar} className="inv-form">
        <label className="inv-flabel">Local
          <select value={localId}
            onChange={(e) => { setLocalId(e.target.value); setCantReal(''); }}
            className="inv-input">
            {locales.map((l) => <option key={l.id} value={l.id}>{l.nombre}</option>)}
          </select>
        </label>
        <div className="inv-ajuste-actual">
          <span>Físico registrado actualmente</span>
          <strong>{actual} ud.</strong>
        </div>
        <label className="inv-flabel">Conteo real (nuevo valor físico)
          <input type="number" min="0" value={cantReal}
            onChange={(e) => setCantReal(e.target.value)}
            className="inv-input" placeholder={`Actual: ${actual}`} />
          {delta !== null && (
            <span className={`inv-hint inv-hint--delta ${delta > 0 ? 'inv-hint--pos' : delta < 0 ? 'inv-hint--neg' : ''}`}>
              Delta: {delta > 0 ? '+' : ''}{delta} ud.
            </span>
          )}
        </label>
        <label className="inv-flabel">Motivo del ajuste
          <input type="text" value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            className="inv-input" placeholder="Ej. Conteo físico, merma, corrección" />
        </label>
        {error && <p className="inv-error">{error}</p>}
        <div className="inv-form__foot">
          <button type="button" onClick={onClose} disabled={enviando} className="inv-btn inv-btn--ghost">
            Cancelar
          </button>
          <button type="submit" disabled={enviando} className="inv-btn inv-btn--primary">
            {enviando ? <><FaSpinner className="inv-spin" /> Ajustando…</> : <><FaCheck /> Confirmar ajuste</>}
          </button>
        </div>
      </form>
    </BaseModal>
  );
};

// ─── ModalSolicitarTraslado ──
const ModalSolicitarTraslado = ({ fila, locales, onClose, onHecho }) => {
  const [origenId,  setOrigenId]  = useState(String(locales[0]?.id ?? ''));
  const [destinoId, setDestinoId] = useState(String(locales[1]?.id ?? locales[0]?.id ?? ''));
  const [cantidad,  setCantidad]  = useState('');
  const [nota,      setNota]      = useState('');
  const [enviando,  setEnviando]  = useState(false);
  const [error,     setError]     = useState('');

  const dispOrigen = fila.stock[parseInt(origenId)]?.disponible ?? 0;
  const localNombre = (id) => locales.find((l) => String(l.id) === String(id))?.nombre ?? '—';

  const enviar = async (e) => {
    e.preventDefault();
    setError('');
    if (origenId === destinoId) { setError('Origen y destino deben ser distintos.'); return; }
    const n = parseInt(cantidad);
    if (!n || n <= 0) { setError('La cantidad debe ser positiva.'); return; }
    if (n > dispOrigen) { setError(`Solo hay ${dispOrigen} ud. disponibles en el origen.`); return; }

    setEnviando(true);
    const { error: rpcError } = await supabase.rpc('fn_solicitar_traslado', {
      p_variante_id:      fila.varianteId,
      p_cantidad:         n,
      p_local_origen_id:  parseInt(origenId),
      p_local_destino_id: parseInt(destinoId),
      p_nota:             nota || null,
    });
    setEnviando(false);
    if (rpcError) { setError(rpcError.message); return; }
    onHecho();
  };

  return (
    <BaseModal title="Solicitar traslado" icon={FaExchangeAlt} onClose={onClose}>
      <VarianteProd fila={fila} />
      <form onSubmit={enviar} className="inv-form">
        <label className="inv-flabel">Origen (local que despacha)
          <select value={origenId} onChange={(e) => setOrigenId(e.target.value)} className="inv-input">
            {locales.map((l) => <option key={l.id} value={l.id}>{l.nombre}</option>)}
          </select>
          <span className={`inv-hint ${dispOrigen <= 5 ? 'inv-hint--warn' : ''}`}>
            Disponible en origen: {dispOrigen} ud.
          </span>
        </label>
        <div className="inv-arrow"><FaExchangeAlt /></div>
        <label className="inv-flabel">Destino (local que recibe)
          <select value={destinoId} onChange={(e) => setDestinoId(e.target.value)} className="inv-input">
            {locales.map((l) => <option key={l.id} value={l.id}>{l.nombre}</option>)}
          </select>
          <span className="inv-hint">
            Físico actual en destino: {fila.stock[parseInt(destinoId)]?.fisica ?? 0} ud.
          </span>
        </label>
        <label className="inv-flabel">Cantidad a trasladar
          <input type="number" min="1" max={dispOrigen} value={cantidad}
            onChange={(e) => setCantidad(e.target.value)} className="inv-input" />
        </label>
        <label className="inv-flabel">Nota (opcional)
          <input type="text" value={nota}
            onChange={(e) => setNota(e.target.value)}
            className="inv-input" placeholder="Ej. Reposición semanal tienda" />
        </label>
        {error && <p className="inv-error">{error}</p>}
        <div className="inv-form__foot">
          <button type="button" onClick={onClose} disabled={enviando} className="inv-btn inv-btn--ghost">
            Cancelar
          </button>
          <button type="submit" disabled={enviando} className="inv-btn inv-btn--primary">
            {enviando ? <><FaSpinner className="inv-spin" /> Enviando…</> : <><FaCheck /> Solicitar traslado</>}
          </button>
        </div>
        <p className="inv-form__note">{localNombre(origenId)} → {localNombre(destinoId)}</p>
      </form>
    </BaseModal>
  );
};

// ─── TabExistencias ──
const TabExistencias = ({ locales }) => {
  const [filas,      setFilas]      = useState([]);
  const [cargando,   setCargando]   = useState(true);
  const [busqueda,   setBusqueda]   = useState('');
  const [filtroStock, setFiltroStock] = useState('todos');
  const [modal,      setModal]      = useState(null);
  const [errorMinimo, setErrorMinimo] = useState('');

  const cargar = useCallback(async () => {
    setCargando(true);
    const [{ data: variantesData }, { data: stockData }] = await Promise.all([
      supabase.from('producto_variantes')
        .select('id, sku, atributos, producto_id, productos(id, nombre, imagen_url, controla_stock)')
        .eq('activo', true)
        .order('producto_id'),
      supabase.from('stock_variantes')
        .select('variante_id, local_id, cantidad_fisica, cantidad_reservada, cantidad_disponible, minimo'),
    ]);

    const vMap = {};
    (variantesData || []).forEach((v) => {
      // Bajo pedido/confección no entra a Inventario aunque queden filas sueltas de stock_variantes: se depende del flag, no de las filas.
      if (v.productos?.controla_stock === false) return;
      vMap[v.id] = {
        sku:            v.sku,
        atributos:      v.atributos || {},
        productoId:     v.producto_id,
        productoNombre: v.productos?.nombre || '—',
        imagenUrl:      v.productos?.imagen_url || null,
      };
    });

    const pivot = {};
    (stockData || []).forEach(({ variante_id, local_id, cantidad_fisica, cantidad_reservada, cantidad_disponible, minimo }) => {
      if (!pivot[variante_id]) pivot[variante_id] = {};
      pivot[variante_id][local_id] = {
        fisica:     cantidad_fisica    ?? 0,
        reservada:  cantidad_reservada ?? 0,
        disponible: cantidad_disponible ?? 0,
        minimo:     minimo             ?? 0,
      };
    });

    const lista = Object.entries(pivot)
      .map(([vid, stock]) => {
        const info = vMap[parseInt(vid)];
        if (!info) return null;
        const totalDisp = locales.reduce((s, l) => s + (stock[l.id]?.disponible ?? 0), 0);
        return { varianteId: parseInt(vid), ...info, stock, totalDisp };
      })
      .filter(Boolean)
      .sort((a, b) => a.productoNombre.localeCompare(b.productoNombre));

    setFilas(lista);
    setCargando(false);
  }, [locales]);

  useEffect(() => { cargar(); }, [cargar]);

  const handleHecho = () => { setModal(null); cargar(); };

  const guardarMinimo = async (varianteId, localId, valor) => {
    const { error } = await supabase.rpc('fn_set_stock_minimo', {
      p_tipo: 'variante', p_entidad_id: varianteId, p_local_id: localId, p_minimo: valor,
    });
    if (error) { setErrorMinimo(esErrorAal2(error) ? MENSAJE_AAL2_REQUERIDO : error.message); return; }
    setErrorMinimo('');
    cargar();
  };

  const tabla = filas.filter((f) => {
    const q = busqueda.toLowerCase();
    const ok = f.productoNombre.toLowerCase().includes(q) ||
      (f.sku || '').toLowerCase().includes(q) ||
      JSON.stringify(f.atributos).toLowerCase().includes(q);
    if (!ok) return false;
    if (filtroStock === 'agotado') return f.totalDisp <= 0;
    if (filtroStock === 'critico') return f.totalDisp > 0 && f.totalDisp <= 5;
    return true;
  });

  const kpiTotal    = filas.length;
  const kpiAgotados = filas.filter((f) => f.totalDisp <= 0).length;
  const kpiCriticos = filas.filter((f) => f.totalDisp > 0 && f.totalDisp <= 5).length;

  if (cargando) return (
    <div className="inv-table-skel">
      <div className="inv-table-skel__header" />
      {[1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="inv-table-skel__row">
          <div className="inv-table-skel__cell inv-table-skel__cell--main" />
          <div className="inv-table-skel__cell" />
          <div className="inv-table-skel__cell" />
          <div className="inv-table-skel__cell" />
        </div>
      ))}
    </div>
  );

  return (
    <>
      {errorMinimo && <div className="inv-alert" role="alert">{errorMinimo}</div>}
      {/* KPIs */}
      <div className="inv-kpis">
        <div className="inv-kpi inv-kpi--blue">
          <p className="inv-kpi__k">Variantes activas</p>
          <p className="inv-kpi__v">{kpiTotal}</p>
        </div>
        <div className="inv-kpi inv-kpi--red">
          <p className="inv-kpi__k">Agotadas (disp = 0)</p>
          <p className="inv-kpi__v">{kpiAgotados}</p>
        </div>
        <div className="inv-kpi inv-kpi--amber">
          <p className="inv-kpi__k">Críticas (disp ≤ 5)</p>
          <p className="inv-kpi__v">{kpiCriticos}</p>
        </div>
      </div>

      {/* Toolbar */}
      <div className="inv-toolbar">
        <div className="inv-search">
          <FaSearch className="inv-search__icon" />
          <input type="text" placeholder="Buscar producto, talla, tela, SKU…"
            value={busqueda} onChange={(e) => setBusqueda(e.target.value)}
            className="inv-search__input" />
        </div>
        <div className="inv-filters">
          {[
            { k: 'todos',   l: 'Todos' },
            { k: 'agotado', l: 'Agotados' },
            { k: 'critico', l: 'Stock crítico' },
          ].map(({ k, l }) => (
            <button key={k} onClick={() => setFiltroStock(k)}
              className={`inv-filter ${filtroStock === k ? 'inv-filter--on' : ''}`}>
              {l}
            </button>
          ))}
        </div>
      </div>

      {/* Tabla */}
      <div className="inv-card">
        <div className="inv-table-wrap">
          <table className="inv-table">
            <thead>
              <tr>
                <th className="inv-th--prod">Variante</th>
                {locales.map((loc) => (
                  <th key={loc.id} className="inv-th--local">
                    <span className="inv-th__icon-wrap">
                      {loc.es_almacen ? <FaWarehouse /> : <FaStore />}
                    </span>
                    {loc.nombre}
                    <span className="inv-th__sub">físico · res. · disp.</span>
                  </th>
                ))}
                <th className="inv-th--center">Total disp.</th>
                <th className="inv-th--actions">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {tabla.length === 0 && (
                <tr>
                  <td colSpan={locales.length + 3} className="inv-empty">
                    No hay variantes que coincidan con los filtros.
                  </td>
                </tr>
              )}
              {tabla.map((fila) => (
                <tr key={fila.varianteId}>
                  <td>
                    <div className="inv-prod">
                      {fila.imagenUrl
                        ? <img src={fila.imagenUrl} alt={fila.productoNombre} className="inv-prod__img" />
                        : <div className="inv-prod__img inv-prod__img--empty" />}
                      <div>
                        <span className="inv-prod__name">{fila.productoNombre}</span>
                        {fila.sku && <span className="inv-prod__sku">{fila.sku}</span>}
                        <div className="inv-prod__attrs">
                          {Object.entries(fila.atributos).map(([k, v]) => (
                            <span key={k} className="inv-chip">{k}: {v}</span>
                          ))}
                        </div>
                      </div>
                    </div>
                  </td>

                  {locales.map((loc) => {
                    const s = fila.stock[loc.id] || { fisica: 0, reservada: 0, disponible: 0, minimo: 0 };
                    return (
                      <td key={loc.id} className="inv-td--stock">
                        <span className="inv-td-mobile-label">{loc.nombre}</span>
                        <StockMiniCell {...s}
                          onGuardarMinimo={(valor) => guardarMinimo(fila.varianteId, loc.id, valor)} />
                      </td>
                    );
                  })}

                  <td className="inv-td--center">
                    <span className="inv-td-mobile-label">Total Disp.</span>
                    <div>
                      <span className={`inv-total ${nivelDisp(fila.totalDisp)}`}>{fila.totalDisp}</span>
                      {fila.totalDisp <= 0 && <span className="inv-agotado">AGOTADO</span>}
                    </div>
                  </td>

                  <td className="inv-td--actions">
                    <button onClick={() => setModal({ tipo: 'ingreso', fila })}
                      className="inv-act-btn inv-act-btn--green" title="Ingresar stock">
                      <FaPlus /> Ingreso
                    </button>
                    <button onClick={() => setModal({ tipo: 'ajuste', fila })}
                      className="inv-act-btn inv-act-btn--amber" title="Ajustar stock por conteo">
                      <FaSlidersH /> Ajuste
                    </button>
                    <button onClick={() => setModal({ tipo: 'traslado', fila })}
                      disabled={locales.length < 2}
                      className="inv-act-btn inv-act-btn--blue"
                      title={locales.length < 2 ? 'Se necesitan al menos 2 locales' : 'Solicitar traslado'}>
                      <FaExchangeAlt /> Traslado
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {modal?.tipo === 'ingreso' && (
        <ModalIngreso fila={modal.fila} locales={locales}
          onClose={() => setModal(null)} onHecho={handleHecho} />
      )}
      {modal?.tipo === 'ajuste' && (
        <ModalAjuste fila={modal.fila} locales={locales}
          onClose={() => setModal(null)} onHecho={handleHecho} />
      )}
      {modal?.tipo === 'traslado' && (
        <ModalSolicitarTraslado fila={modal.fila} locales={locales}
          onClose={() => setModal(null)} onHecho={handleHecho} />
      )}
    </>
  );
};

// ─── TabTraslados ──
const TabTraslados = ({ locales, varianteMap }) => {
  const [traslados,    setTraslados]    = useState([]);
  const [cargando,     setCargando]     = useState(true);
  const [filtroEstado, setFiltroEstado] = useState('todos');
  const [procesando,   setProcesando]   = useState(null);
  const [error,        setError]        = useState('');

  const localesMap = Object.fromEntries(locales.map((l) => [l.id, l.nombre]));

  const cargar = useCallback(async () => {
    setCargando(true);
    const { data } = await supabase
      .from('traslados')
      .select('*')
      .not('variante_id', 'is', null)
      .order('solicitado_at', { ascending: false });
    setTraslados(data || []);
    setCargando(false);
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const accion = async (rpcName, id) => {
    setProcesando(id);
    const { error: rpcError } = await supabase.rpc(rpcName, { p_traslado_id: id });
    setProcesando(null);
    if (rpcError) { setError(esErrorAal2(rpcError) ? MENSAJE_AAL2_REQUERIDO : rpcError.message); return; }
    setError('');
    cargar();
  };

  const lista = traslados.filter(
    (t) => filtroEstado === 'todos' || t.estado === filtroEstado,
  );
  const enTransito = traslados.filter((t) => t.estado === 'despachado').length;

  if (cargando) return (
    <div className="inv-table-skel">
      <div className="inv-table-skel__header" />
      {[1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="inv-table-skel__row">
          <div className="inv-table-skel__cell inv-table-skel__cell--main" />
          <div className="inv-table-skel__cell" />
          <div className="inv-table-skel__cell" />
          <div className="inv-table-skel__cell" />
        </div>
      ))}
    </div>
  );

  return (
    <>
      {error && <div className="inv-alert" role="alert">{error}</div>}
      <div className="inv-filters inv-filters--bar">
        {['todos', 'solicitado', 'despachado', 'recibido', 'cancelado'].map((e) => {
          const count = e === 'todos'
            ? traslados.length
            : traslados.filter((t) => t.estado === e).length;
          return (
            <button key={e} onClick={() => setFiltroEstado(e)}
              className={`inv-filter ${filtroEstado === e ? 'inv-filter--on' : ''}`}>
              {e === 'todos' ? 'Todos' : (ESTADO_META[e]?.label ?? e)}
              <span className="inv-filter__cnt">{count}</span>
            </button>
          );
        })}
      </div>

      {enTransito > 0 && (
        <div className="inv-alert inv-alert--amber">
          <FaTruck />
          <span>
            {enTransito} traslado{enTransito > 1 ? 's' : ''} en tránsito — pendiente{enTransito > 1 ? 's' : ''} de confirmación.
          </span>
        </div>
      )}

      <div className="inv-card">
        {lista.length === 0 ? (
          <div className="inv-empty">
            No hay traslados con el filtro seleccionado.
          </div>
        ) : (
          <div className="inv-tlist">
            {lista.map((t) => {
              const v    = varianteMap[t.variante_id];
              const meta = ESTADO_META[t.estado] || {};
              const proc = procesando === t.id;
              return (
                <div key={t.id} className="inv-titem">
                  <div className="inv-titem__body">
                    <div className="inv-titem__prod">
                      <span className="inv-titem__name">{v?.productoNombre ?? '—'}</span>
                      {v?.sku && <span className="inv-titem__sku">{v.sku}</span>}
                      <div className="inv-titem__attrs">
                        {Object.entries(v?.atributos || {}).map(([k, val]) => (
                          <span key={k} className="inv-chip inv-chip--sm">{k}: {val}</span>
                        ))}
                      </div>
                    </div>
                    <div className="inv-titem__ruta">
                      <span className="inv-titem__local">{localesMap[t.local_origen_id] ?? '—'}</span>
                      <FaExchangeAlt className="inv-titem__arrow" />
                      <span className="inv-titem__local">{localesMap[t.local_destino_id] ?? '—'}</span>
                      <span className="inv-titem__cant">{t.cantidad} ud.</span>
                    </div>
                    <div className="inv-titem__meta">
                      <span className={`inv-badge ${meta.cls ?? ''}`}>{meta.label ?? t.estado}</span>
                      <span className="inv-titem__fecha">{fmt(t.solicitado_at)}</span>
                      {t.nota && <span className="inv-titem__nota">"{t.nota}"</span>}
                    </div>
                  </div>
                  <div className="inv-titem__actions">
                    {t.estado === 'solicitado' && (
                      <>
                        <button onClick={() => accion('fn_despachar_traslado', t.id)}
                          disabled={proc} className="inv-btn inv-btn--amber inv-btn--sm">
                          {proc ? <FaSpinner className="inv-spin" /> : <FaTruck />} Despachar
                        </button>
                        <button onClick={() => accion('fn_cancelar_traslado', t.id)}
                          disabled={proc} className="inv-btn inv-btn--ghost inv-btn--sm">
                          <FaBan /> Cancelar
                        </button>
                      </>
                    )}
                    {t.estado === 'despachado' && (
                      <>
                        <button onClick={() => accion('fn_recibir_traslado', t.id)}
                          disabled={proc} className="inv-btn inv-btn--primary inv-btn--sm">
                          {proc ? <FaSpinner className="inv-spin" /> : <FaCheck />} Confirmar recepción
                        </button>
                        <button onClick={() => accion('fn_cancelar_traslado', t.id)}
                          disabled={proc} className="inv-btn inv-btn--ghost inv-btn--sm">
                          <FaBan /> Cancelar
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
};

// ─── TabHistorial ── motivos técnicos → etiqueta legible (los ya redactados se muestran tal cual)
const traducirMotivo = (motivo) => {
  if (!motivo) return '—';
  if (motivo === 'devolucion') return 'Devolución de cliente';
  if (motivo === 'consumo_produccion') return 'Consumo en producción';
  if (motivo.startsWith('Venta POS')) return motivo.replace('Venta POS', 'Venta en tienda —');
  return motivo;
};

const PAGINA_HIST = 50;

const TabHistorial = ({ varianteMap, locales }) => {
  const [varianteId,  setVarianteId]  = useState('');
  const [localId,     setLocalId]     = useState('');
  const [tipo,        setTipo]        = useState('');
  const [desde,       setDesde]       = useState('');
  const [hasta,       setHasta]       = useState('');
  const [pagina,      setPagina]      = useState(0);
  const [total,       setTotal]       = useState(0);
  const [movimientos, setMovimientos] = useState([]);
  const [cargando,    setCargando]    = useState(false);
  const [perfilesMap, setPerfilesMap] = useState({});

  const localesMap = Object.fromEntries(locales.map((l) => [l.id, l.nombre]));

  const varianteEntries = Object.entries(varianteMap)
    .map(([id, v]) => ({ id, ...v }))
    .sort((a, b) => a.productoNombre.localeCompare(b.productoNombre));

  useEffect(() => {
    supabase.from('profiles').select('id, nombre').then(({ data }) =>
      setPerfilesMap(Object.fromEntries((data ?? []).map((p) => [p.id, p.nombre]))));
  }, []);

  // Cualquier cambio de filtro vuelve a la primera página
  useEffect(() => { setPagina(0); }, [varianteId, localId, tipo, desde, hasta]);

  useEffect(() => {
    const cargar = async () => {
      setCargando(true);
      let query = supabase
        .from('movimientos_stock')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(pagina * PAGINA_HIST, pagina * PAGINA_HIST + PAGINA_HIST - 1);
      if (varianteId) query = query.eq('variante_id', parseInt(varianteId));
      if (localId)    query = query.eq('local_id', parseInt(localId));
      if (tipo)       query = query.eq('tipo', tipo);
      if (desde)      query = query.gte('created_at', `${desde}T00:00:00`);
      if (hasta)      query = query.lte('created_at', `${hasta}T23:59:59`);
      const { data, count } = await query;
      setMovimientos(data || []);
      setTotal(count ?? 0);
      setCargando(false);
    };
    cargar();
  }, [varianteId, localId, tipo, desde, hasta, pagina]);

  const totalPaginas = Math.max(1, Math.ceil(total / PAGINA_HIST));

  return (
    <>
      <div className="inv-hist-bar inv-hist-bar--filtros">
        <label className="inv-flabel">Producto / variante
          <select value={varianteId} onChange={(e) => setVarianteId(e.target.value)} className="inv-input">
            <option value="">Todas las variantes</option>
            {varianteEntries.map(({ id, productoNombre, sku, atributos }) => (
              <option key={id} value={id}>
                {productoNombre}{sku ? ` [${sku}]` : ''} · {atributosStr(atributos)}
              </option>
            ))}
          </select>
        </label>
        <label className="inv-flabel">Local
          <select value={localId} onChange={(e) => setLocalId(e.target.value)} className="inv-input">
            <option value="">Todos</option>
            {locales.map((l) => <option key={l.id} value={l.id}>{l.nombre}</option>)}
          </select>
        </label>
        <label className="inv-flabel">Tipo
          <select value={tipo} onChange={(e) => setTipo(e.target.value)} className="inv-input">
            <option value="">Todos</option>
            {Object.entries(TIPO_META).map(([val, m]) => <option key={val} value={val}>{m.label}</option>)}
          </select>
        </label>
        <label className="inv-flabel">Desde
          <input type="date" className="inv-input" value={desde} onChange={(e) => setDesde(e.target.value)} />
        </label>
        <label className="inv-flabel">Hasta
          <input type="date" className="inv-input" value={hasta} onChange={(e) => setHasta(e.target.value)} />
        </label>
      </div>

      {cargando ? (
        <div className="inv-loading"><FaSpinner className="inv-spin" /> Cargando movimientos…</div>
      ) : (
        <div className="inv-card">
          {movimientos.length === 0 ? (
            <div className="inv-empty" style={{ padding: '2.5rem', textAlign: 'center' }}>
              Sin movimientos para los filtros elegidos.
            </div>
          ) : (
            <>
              <div className="inv-table-wrap">
                <table className="inv-table">
                  <thead>
                    <tr>
                      <th style={{ minWidth: 170 }}>Producto</th>
                      <th style={{ minWidth: 100 }}>Tipo</th>
                      <th className="inv-th--center" style={{ minWidth: 90 }}>Cantidad</th>
                      <th style={{ minWidth: 110 }}>Local</th>
                      <th style={{ minWidth: 90 }}>Afecta</th>
                      <th style={{ minWidth: 180 }}>Motivo</th>
                      <th style={{ minWidth: 130 }}>Proveedor</th>
                      <th style={{ minWidth: 110 }}>Usuario</th>
                      <th style={{ minWidth: 140 }}>Fecha</th>
                    </tr>
                  </thead>
                  <tbody>
                    {movimientos.map((m) => {
                      const tMeta = TIPO_META[m.tipo] || { label: m.tipo, cls: '' };
                      const v     = varianteMap[m.variante_id];
                      return (
                        <tr key={m.id}>
                          <td>
                            <span className="inv-td-name">{v?.productoNombre ?? `Variante ${m.variante_id}`}</span>
                            {v && <span className="inv-td--muted"> · {atributosStr(v.atributos)}</span>}
                          </td>
                          <td><span className={`inv-tipo ${tMeta.cls}`}>{tMeta.label}</span></td>
                          <td className="inv-td--center">
                            <span className={`inv-delta ${m.cantidad >= 0 ? 'inv-delta--pos' : 'inv-delta--neg'}`}>
                              {m.cantidad > 0 ? '+' : ''}{m.cantidad}
                            </span>
                          </td>
                          <td>{localesMap[m.local_id] ?? m.local_id}</td>
                          <td>
                            <span className={`inv-afecta ${m.afecta === 'reservada' ? 'inv-afecta--res' : ''}`}>
                              {m.afecta ?? '—'}
                            </span>
                          </td>
                          <td className="inv-td--muted">{traducirMotivo(m.motivo)}</td>
                          <td className="inv-td--muted">{m.proveedor ?? '—'}</td>
                          <td className="inv-td--muted">{perfilesMap[m.usuario_id] ?? '—'}</td>
                          <td className="inv-td--muted">{fmt(m.created_at)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="inv-hist-pag">
                <button className="inv-btn inv-btn--sm" disabled={pagina === 0}
                  onClick={() => setPagina((p) => p - 1)}>← Anterior</button>
                <span className="inv-hist-pag__info">
                  Página {pagina + 1} de {totalPaginas} · {total} movimientos
                </span>
                <button className="inv-btn inv-btn--sm" disabled={pagina + 1 >= totalPaginas}
                  onClick={() => setPagina((p) => p + 1)}>Siguiente →</button>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
};

// ─── Inventario (raíz) ──
const Inventario = () => {
  const [tab,          setTab]          = useState('existencias');
  const [locales,      setLocales]      = useState([]);
  const [varianteMap,  setVarianteMap]  = useState({});
  const [cargandoBase, setCargandoBase] = useState(true);

  useEffect(() => {
    const init = async () => {
      const [{ data: localesData }, { data: variantesData }] = await Promise.all([
        supabase.from('locales').select('id, nombre, es_almacen').eq('activo', true).order('id'),
        supabase.from('producto_variantes')
          .select('id, sku, atributos, producto_id, productos(id, nombre, imagen_url)')
          .eq('activo', true),
      ]);
      setLocales(localesData || []);
      const vMap = {};
      (variantesData || []).forEach((v) => {
        vMap[v.id] = {
          sku:            v.sku,
          atributos:      v.atributos || {},
          productoId:     v.producto_id,
          productoNombre: v.productos?.nombre || '—',
          imagenUrl:      v.productos?.imagen_url || null,
        };
      });
      setVarianteMap(vMap);
      setCargandoBase(false);
    };
    init();
  }, []);

  const TABS = [
    { key: 'existencias', label: 'Existencias',   Icon: FaWarehouse   },
    { key: 'traslados',   label: 'Traslados',     Icon: FaExchangeAlt },
    { key: 'historial',   label: 'Historial',     Icon: FaHistory     },
  ];

  if (cargandoBase) return (
    <div className="inv-loading"><FaSpinner className="inv-spin" /> Cargando inventario…</div>
  );

  return (
    <div className="inv">
      <div className="inv-head">
        <h2 className="inv-title"><FaWarehouse /> Control de Inventario</h2>
        <p className="inv-subtitle">
          Stock por variante y local · traslados entre sedes · historial de movimientos
        </p>
      </div>

      <div className="inv-tabs" role="tablist">
        {TABS.map(({ key, label, Icon }) => (
          <button key={key} role="tab" aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`inv-tab ${tab === key ? 'inv-tab--on' : ''}`}>
            <Icon aria-hidden="true" /> {label}
          </button>
        ))}
      </div>

      <div className="inv-tab-panel">
        {tab === 'existencias' && <TabExistencias locales={locales} />}
        {tab === 'traslados'   && <TabTraslados   locales={locales} varianteMap={varianteMap} />}
        {tab === 'historial'   && <TabHistorial   locales={locales} varianteMap={varianteMap} />}
      </div>
    </div>
  );
};

export default Inventario;
