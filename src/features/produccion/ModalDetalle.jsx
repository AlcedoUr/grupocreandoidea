import { useState, useEffect, useRef } from 'react';
import { FaTimes, FaCalendarAlt } from 'react-icons/fa';
import { useAuth } from '../../context/AuthContext';
import { resumenUnidades } from '../../api/unidades';
import { COLUMNAS, BADGE_PAGO, BADGE_CANAL } from '../../lib/constantes';
import { formatFecha, esAtrasado, esHoy, claseRecojo } from '../../lib/formato';
import { UnidadesVerificacion, HojaOperario } from '../../pages/UnidadesPanel';
import SeccionAvisoCliente from './SeccionAvisoCliente';
import SeccionDevoluciones from './SeccionDevoluciones';
import './Produccion.css';

// Exclusivo de este modal, a diferencia de BADGE_CANAL/BADGE_PAGO/COLUMNAS (lib/constantes).
const BADGE_ENTREGA = {
  recojo_tienda:    '🏪 Recojo en tienda',
  delivery_tercero: '🛵 Envío a domicilio',
};

// ── RenderPersonalizacion ────────────────────────────────────────────────────
const RenderPersonalizacion = ({ detalle }) => {
  if (!detalle) return <span className="ped-muted">Sin personalización</span>;

  if (Array.isArray(detalle) && detalle.length > 0) {
    const keys = Object.keys(detalle[0]).filter((k) => k !== 'cantidad');
    return (
      <div className="ped-perso-table-wrap">
        <table className="ped-perso-table">
          <thead>
            <tr>
              {keys.map((k) => <th key={k}>{k}</th>)}
              <th className="ped-center">Cant.</th>
            </tr>
          </thead>
          <tbody>
            {detalle.map((fila, i) => (
              <tr key={i}>
                {keys.map((k) => <td key={k}>{fila[k] || '—'}</td>)}
                <td className="ped-center ped-strong">{fila.cantidad ?? 1}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (typeof detalle === 'object') {
    const entradas = Object.entries(detalle).filter(([, v]) => v);
    if (entradas.length === 0) return <span className="ped-muted">Sin opciones</span>;
    return (
      <div className="ped-chips">
        {entradas.map(([k, v]) => (
          <span key={k} className="ped-chip">{k}: {v}</span>
        ))}
      </div>
    );
  }
  return null;
};

// ── ModalDetalle ──
// Extraído de Pedidos.jsx en el Bloque 12; sigue montándose solo dentro del Kanban.
const ModalDetalle = ({ pedido, onClose }) => {
  const { perfil } = useAuth();
  const [tabDetalle, setTabDetalle] = useState('detalle');
  const [resumen, setResumen]       = useState(null);
  const [subTab, setSubTab]         = useState('verif');

  useEffect(() => {
    if (!pedido?.id) return;
    setTabDetalle('detalle');
    resumenUnidades(pedido.id)
      .then(({ data }) => setResumen(data || { total: 0, pendientes: 0, verificadas: 0, estampadas: 0 }));
  }, [pedido?.id]);

  // Accesibilidad del modal: foco inicial, trampa de Tab y Escape para cerrar.
  const dialogRef = useRef(null);
  const focoPrevioRef = useRef(null);
  useEffect(() => {
    if (!pedido) return;
    focoPrevioRef.current = document.activeElement;
    const focusables = dialogRef.current?.querySelectorAll('input, select, textarea, button, [href]');
    focusables?.[0]?.focus();

    const onKeyDown = (e) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key === 'Tab' && focusables?.length) {
        const primero = focusables[0];
        const ultimo  = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === primero) {
          e.preventDefault(); ultimo.focus();
        } else if (!e.shiftKey && document.activeElement === ultimo) {
          e.preventDefault(); primero.focus();
        }
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      focoPrevioRef.current?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pedido]);

  if (!pedido) return null;

  const col       = COLUMNAS.find((c) => c.estado === pedido.estado_produccion);
  const badgePago = BADGE_PAGO[pedido.estado_pago] ?? {};
  const puedeVerif  = ['admin', 'disenador', 'vendedor'].includes(perfil?.rol);
  const puedeEstamp = ['admin', 'operario'].includes(perfil?.rol);
  const esAdmin     = perfil?.rol === 'admin';
  const total       = resumen?.total || 0;
  const pendientes  = resumen?.pendientes || 0;

  return (
    <div className="ped-modal" onClick={onClose}>
      <div className="ped-dialog" ref={dialogRef} role="dialog" aria-modal="true"
        aria-labelledby="ped-dialog-title" onClick={(e) => e.stopPropagation()}>
        <div className="ped-dialog__head">
          <div>
            <h2 className="ped-dialog__title" id="ped-dialog-title">
              Pedido <span style={{ color: col?.color }}>#{pedido.id}</span>
              {pedido.numero_boleta && (
                <span className="ped-dialog__boleta">{pedido.numero_boleta}</span>
              )}
            </h2>
            <div className="ped-badges">
              <span className="ped-badge" style={{ color: col?.color, borderColor: col?.color, background: `${col?.color}14` }}>
                {col?.emoji} {col?.label}
              </span>
              <span className={`ped-badge ${badgePago.clase ?? ''}`}>{badgePago.label}</span>
              <span className="ped-badge ped-badge--neutral">{BADGE_CANAL[pedido.canal]}</span>
            </div>
          </div>
          <button onClick={onClose} className="ped-dialog__close" aria-label="Cerrar"><FaTimes /></button>
        </div>

        {(puedeVerif || puedeEstamp) && (
          <div className="uni-modal-tabs">
            <button
              className={`uni-modal-tab ${tabDetalle === 'detalle' ? 'uni-modal-tab--on' : ''}`}
              onClick={() => setTabDetalle('detalle')}
            >
              Detalle
            </button>
            <button
              className={`uni-modal-tab ${tabDetalle === 'unidades' ? 'uni-modal-tab--on' : ''}`}
              onClick={() => setTabDetalle('unidades')}
            >
              Unidades
              {resumen !== null && total > 0 && (
                <span className={`uni-modal-tab__badge ${pendientes === 0 ? 'uni-modal-tab__badge--ok' : ''}`}>
                  {pendientes > 0 ? `${pendientes}` : '✓'}
                </span>
              )}
            </button>
          </div>
        )}

        {tabDetalle === 'detalle' && (
          <>
            <div className="ped-info">
              <div>
                <p className="ped-info__k">Cliente</p>
                <p className="ped-info__v ped-strong">{pedido.clientes?.nombre ?? '—'}</p>
              </div>
              <div>
                <p className="ped-info__k">WhatsApp</p>
                <p className="ped-info__v">{pedido.clientes?.telefono ?? '—'}</p>
              </div>
              <div>
                <p className="ped-info__k">Entrega</p>
                <p className="ped-info__v">{BADGE_ENTREGA[pedido.metodo_entrega]}</p>
              </div>
              {pedido.fecha_recojo_estimada && (
                <div>
                  <p className="ped-info__k">Fecha recojo</p>
                  <p className={`ped-info__v ${claseRecojo(pedido.fecha_recojo_estimada) === 'ped-card__recojo--late' ? 'ped-date--late' : claseRecojo(pedido.fecha_recojo_estimada) === 'ped-card__recojo--hoy' ? 'ped-date--hoy' : ''}`}>
                    <FaCalendarAlt style={{ marginRight: '0.3rem', fontSize: '0.7rem', opacity: 0.6 }} />
                    {formatFecha(pedido.fecha_recojo_estimada)}
                    {esAtrasado(pedido.fecha_recojo_estimada) && ' · Atrasado'}
                    {!esAtrasado(pedido.fecha_recojo_estimada) && esHoy(pedido.fecha_recojo_estimada) && ' · Hoy'}
                  </p>
                </div>
              )}
              <div>
                <p className="ped-info__k">Total</p>
                <p className="ped-info__v ped-total">S/. {parseFloat(pedido.total || 0).toFixed(2)}</p>
              </div>
            </div>

            <h4 className="ped-section">Artículos del pedido ({pedido.pedido_items?.length ?? 0})</h4>

            <div className="ped-items">
              {(pedido.pedido_items ?? []).map((item, i) => (
                <div key={item.id ?? i} className="ped-item">
                  <div className="ped-item__head">
                    <div className="ped-item__id">
                      {item.productos?.imagen_url && (
                        <img src={item.productos.imagen_url} alt={item.productos?.nombre ?? 'Producto'} className="ped-item__img"
                          width={46} height={46} loading="lazy" decoding="async" />
                      )}
                      <div>
                        <p className="ped-item__name">
                          {item.productos?.nombre ?? 'Producto'}
                          {item.requiere_confeccion && (
                            <span className="ped-tag-costura">🧵 confección</span>
                          )}
                        </p>
                        <p className="ped-item__qty">{item.cantidad} ud. × S/.{parseFloat(item.precio_unitario).toFixed(2)}</p>
                      </div>
                    </div>
                    <p className="ped-item__sub">S/.{parseFloat(item.subtotal).toFixed(2)}</p>
                  </div>
                  <div className="ped-item__perso">
                    <p className="ped-item__perso-k">Detalle de personalización</p>
                    <RenderPersonalizacion detalle={item.detalle_personalizacion} />
                  </div>
                  {(item.pedido_item_unidades ?? []).length > 0 && (
                    <div className="ped-item__perso">
                      <p className="ped-item__perso-k">Unidades</p>
                      <div className="ped-chips">
                        {item.pedido_item_unidades.map(u => (
                          <span key={u.id} className="ped-chip">
                            {u.nombre || 'Sin nombre'}{u.sexo ? ` (${u.sexo})` : ''}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>

            <SeccionAvisoCliente pedido={pedido} />

            <SeccionDevoluciones pedido={pedido} />

            {pedido.notas && (
              <div className="ped-notas">
                <p className="ped-notas__k">Notas</p>
                <p className="ped-notas__v">{pedido.notas}</p>
              </div>
            )}
          </>
        )}

        {tabDetalle === 'unidades' && (
          esAdmin ? (
            <>
              <div className="uni-subtabs">
                <button className={`uni-subtab ${subTab === 'verif' ? 'uni-subtab--on' : ''}`} onClick={() => setSubTab('verif')}>
                  Verificación
                </button>
                <button className={`uni-subtab ${subTab === 'oper' ? 'uni-subtab--on' : ''}`} onClick={() => setSubTab('oper')}>
                  Hoja Operario
                </button>
              </div>
              {subTab === 'verif' && <UnidadesVerificacion pedidoId={pedido.id} perfil={perfil} onResumenChange={setResumen} />}
              {subTab === 'oper'  && <HojaOperario         pedidoId={pedido.id} perfil={perfil} />}
            </>
          ) : puedeVerif ? (
            <UnidadesVerificacion pedidoId={pedido.id} perfil={perfil} onResumenChange={setResumen} />
          ) : (
            <HojaOperario pedidoId={pedido.id} perfil={perfil} />
          )
        )}
      </div>
    </div>
  );
};

export default ModalDetalle;
