import React, { useState, useEffect, useCallback } from 'react';
import {
  FaCheck, FaSpinner, FaPlus, FaTrash, FaFileImport,
} from 'react-icons/fa';
import { GiShirt } from 'react-icons/gi';
import { supabase } from '../supabase/client';
import './UnidadesPanel.css';

// ── Parsear texto pegado de Excel (tab o comma-separated) ──
// Talla y Tela viven en la variante de la línea; aquí solo lo que difiere por persona: nombre y sexo.
function parsearTexto(texto) {
  const lineas = texto.trim().split('\n').filter(l => l.trim());
  if (lineas.length === 0) return [];
  const sep = lineas[0].includes('\t') ? '\t' : ',';
  const primeraCelda = lineas[0].split(sep)[0].toLowerCase().trim();
  const tieneHeader  = ['nombre', 'sexo', 'name'].includes(primeraCelda);
  const datos = tieneHeader ? lineas.slice(1) : lineas;
  return datos.map(l => {
    const cols = l.split(sep).map(c => c.trim().replace(/^["']|["']$/g, ''));
    return { nombre: cols[0] || '', sexo: cols[1] || '' };
  }).filter(u => u.nombre || u.sexo);
}

const UNI_ESTADO = {
  pendiente:  { label: 'Pendiente',  clase: 'uni-badge--pend' },
  verificado: { label: 'Verificado', clase: 'uni-badge--verif' },
  estampado:  { label: 'Estampado',  clase: 'uni-badge--stamp' },
};

// ── Editor de unidades para una línea (dentro ModalEditor cotización) ──
// Controlado por el padre: unidades/onChange viven en el mismo state `items` que cantidad/precio, para no perder
// datos de un ítem recién agregado sin id todavía (bug histórico: tenía su propio fetch+RPC y se perdía al guardar).
// hermanosUnidades: otras líneas del mismo kit (state local del padre), para copiar nombre/sexo sin ir a la DB.
export const UnidadesEditorItem = ({ productoNombre, cantidad, unidades, onChange, hermanosUnidades = [] }) => {
  const [abierto, setAbierto]       = useState(false);
  const [importText, setImportText] = useState('');
  const [modoImport, setModoImport] = useState(false);

  // No tiene sentido cargar más unidades que lo pedido en la línea.
  const tope = parseInt(cantidad) || 0;
  const enTope = tope > 0 && unidades.length >= tope;

  const agregarFila = () => {
    if (enTope) return;
    onChange([...unidades, { _key: crypto.randomUUID(), nombre: '', sexo: '' }]);
  };

  const actualizarFila = (key, campo, valor) =>
    onChange(unidades.map(u => u._key === key ? { ...u, [campo]: valor } : u));

  const eliminarFila = (key) =>
    onChange(unidades.filter(u => u._key !== key));

  const importar = () => {
    const parsed = parsearTexto(importText);
    if (parsed.length === 0) return;
    const combinado = [...unidades, ...parsed.map(p => ({ ...p, _key: crypto.randomUUID() }))];
    onChange(tope > 0 ? combinado.slice(0, tope) : combinado);
    setImportText(''); setModoImport(false);
  };

  // Copia nombre/sexo de otro componente del kit; rellena filas existentes por posición y crea las que falten.
  const copiarDeHermano = (hermano) => {
    const next = [...unidades];
    hermano.unidades.forEach((h, i) => {
      if (tope > 0 && i >= tope) return;
      if (next[i]) {
        next[i] = { ...next[i], nombre: h.nombre || next[i].nombre, sexo: h.sexo || next[i].sexo };
      } else {
        next.push({ _key: crypto.randomUUID(), nombre: h.nombre || '', sexo: h.sexo || '' });
      }
    });
    onChange(next);
  };

  const filasParsed = parsearTexto(importText);

  return (
    <div className="uni-editor-item">
      <button className="uni-editor-toggle" onClick={() => setAbierto(p => !p)}
        aria-expanded={abierto} aria-controls="uni-editor-body">
        <span className="uni-editor-toggle__name">{productoNombre}</span>
        <span className="uni-editor-toggle__info">
          {unidades.length > 0
            ? `${unidades.length} unidad${unidades.length !== 1 ? 'es' : ''}`
            : `cap. ${cantidad}`}
        </span>
        <span className={`uni-editor-toggle__arrow ${abierto ? 'uni-editor-toggle__arrow--open' : ''}`} aria-hidden="true">▾</span>
      </button>

      {abierto && (
        <div className="uni-editor-body" id="uni-editor-body">
          <div className="uni-col-hint">
            <span>Nombre</span><span>Sexo</span><span />
          </div>

          <div className="uni-rows">
            {unidades.length === 0 && (
              <p className="uni-empty">Sin unidades. Agrega manualmente o pega desde Excel.</p>
            )}
            {unidades.map((u, idx) => (
              <div key={u._key} className="uni-row">
                <span className="uni-row__n">{idx + 1}</span>
                <input className="uni-input uni-input--wide" placeholder="Juan Pérez" aria-label={`Nombre, unidad ${idx + 1}`}
                  value={u.nombre} onChange={e => actualizarFila(u._key, 'nombre', e.target.value)} />
                <select className="uni-input uni-input--sm" aria-label={`Sexo, unidad ${idx + 1}`}
                  value={u.sexo} onChange={e => actualizarFila(u._key, 'sexo', e.target.value)}>
                  <option value="">—</option>
                  <option value="F">F</option>
                  <option value="M">M</option>
                </select>
                <button className="uni-del-btn" onClick={() => eliminarFila(u._key)} aria-label={`Eliminar unidad ${idx + 1}`}>
                  <FaTrash />
                </button>
              </div>
            ))}
          </div>

          {modoImport ? (
            <div className="uni-import">
              <p className="uni-import__hint">
                Pega filas de Excel. Orden: nombre | sexo
              </p>
              <textarea
                className="uni-import__ta" rows={4}
                placeholder={"Juan Pérez\tM\nMaría García\tF"}
                value={importText}
                onChange={e => setImportText(e.target.value)}
              />
              <div className="uni-import__actions">
                <button className="uni-btn uni-btn--ghost" onClick={() => setModoImport(false)}>Cancelar</button>
                <button
                  className="uni-btn uni-btn--green"
                  onClick={importar}
                  disabled={filasParsed.length === 0}
                >
                  <FaFileImport /> Importar {filasParsed.length} fila{filasParsed.length !== 1 ? 's' : ''}
                </button>
              </div>
            </div>
          ) : (
            <div className="uni-editor-actions">
              <button className="uni-btn uni-btn--ghost" onClick={agregarFila} disabled={enTope}
                title={enTope ? `Ya hay ${tope} unidad${tope !== 1 ? 'es' : ''}, igual a la cantidad pedida` : undefined}>
                <FaPlus /> Fila
              </button>
              <button className="uni-btn uni-btn--ghost" onClick={() => setModoImport(true)} disabled={enTope}>
                <FaFileImport /> Pegar Excel
              </button>
              {enTope && <span className="uni-hint-save">Cantidad completa ({tope})</span>}
              {hermanosUnidades.map(h => (
                <button key={h.nombre} className="uni-btn uni-btn--ghost"
                  title="Copia nombre y sexo de las unidades de ese componente"
                  onClick={() => copiarDeHermano(h)}>
                  <FaFileImport /> Copiar de {h.nombre}
                </button>
              ))}
              <span className="uni-editor-actions__sep" />
              <span className="uni-hint-save">Se guarda junto con la cotización</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ── Vista de verificación (admin / disenador / vendedor) ──
export const UnidadesVerificacion = ({ pedidoId, perfil, onResumenChange }) => {
  const [grupos, setGrupos]         = useState([]);
  const [resumen, setResumen]       = useState(null);
  const [cargando, setCargando]     = useState(true);
  const [error, setError]           = useState(null);
  const [notaEdit, setNotaEdit]     = useState({});
  const [trabajando, setTrabajando] = useState(null);

  const puedeVerificar = ['admin', 'disenador', 'vendedor'].includes(perfil?.rol);

  const cargar = useCallback(async () => {
    setCargando(true); setError(null);
    const [{ data: unis, error: eUnis }, { data: resData, error: eRes }] = await Promise.all([
      supabase
        .from('pedido_item_unidades')
        .select(`
          id, talla, nombre, sexo, tela, estado_verificacion, nota, pedido_item_id,
          pedido_items!inner(id, pedido_id, kit_grupo, kit_id,
            producto_variantes(sku, productos(nombre)))
        `)
        .eq('pedido_items.pedido_id', pedidoId)
        .order('pedido_item_id')
        .order('id'),
      supabase.rpc('fn_unidades_resumen', { p_pedido_id: pedidoId }),
    ]);
    if (eUnis || eRes) { setError('No se pudieron cargar las unidades del pedido.'); setCargando(false); return; }

    const map = {};
    (unis || []).forEach(u => {
      const pid = u.pedido_item_id;
      if (!map[pid]) {
        map[pid] = {
          itemId: pid,
          productoNombre: u.pedido_items?.producto_variantes?.productos?.nombre || `Item #${pid}`,
          sku: u.pedido_items?.producto_variantes?.sku,
          kitGrupo: u.pedido_items?.kit_grupo || null,
          unidades: [],
        };
      }
      map[pid].unidades.push(u);
    });
    // Las líneas del mismo kit se muestran juntas
    setGrupos(Object.values(map).sort((a, b) =>
      String(a.kitGrupo || `z${a.itemId}`).localeCompare(String(b.kitGrupo || `z${b.itemId}`))
    ));
    const res = resData || { total: 0, pendientes: 0, verificadas: 0, estampadas: 0 };
    setResumen(res);
    onResumenChange?.(res);
    setCargando(false);
  }, [pedidoId, onResumenChange]);

  useEffect(() => { cargar(); }, [cargar]);

  const verificarUna = async (unidadId) => {
    setTrabajando(unidadId);
    const { error: e } = await supabase.rpc('fn_verificar_unidad', { p_unidad_id: unidadId });
    if (e) setError(e.message); else await cargar();
    setTrabajando(null);
  };

  const verificarTodo = async () => {
    if (!window.confirm(`¿Verificar las ${pendientes} unidades pendientes de este pedido? No se puede deshacer.`)) return;
    setTrabajando('all');
    const { error: e } = await supabase.rpc('fn_verificar_pedido', { p_pedido_id: pedidoId });
    if (e) setError(e.message); else await cargar();
    setTrabajando(null);
  };

  const guardarNota = async (unidadId, nota) => {
    // Escritura vía RPC: la tabla no acepta UPDATE directo (baseline RLS).
    await supabase.rpc('fn_actualizar_nota_unidad', { p_unidad_id: unidadId, p_nota: nota });
    setNotaEdit(prev => { const n = { ...prev }; delete n[unidadId]; return n; });
    await cargar();
  };

  if (cargando) return <div className="uni-loading"><FaSpinner className="uni-spin" /> Cargando unidades…</div>;

  const total      = resumen?.total || 0;
  const verificadas = (resumen?.verificadas || 0) + (resumen?.estampadas || 0);
  const pendientes  = resumen?.pendientes || 0;
  const scaleX      = total > 0 ? verificadas / total : 0;
  const pct         = Math.round(scaleX * 100);

  return (
    <div className="uni-verif">
      <div className="uni-progress-bar-wrap">
        <div className="uni-progress-labels">
          <span className="uni-progress-label">
            {pendientes > 0
              ? <><span className="uni-dot uni-dot--pend" /> {pendientes} pendiente{pendientes !== 1 ? 's' : ''}</>
              : <><span className="uni-dot uni-dot--ok" /> Todas verificadas</>}
          </span>
          <span className="uni-progress-pct">{verificadas}/{total} ({pct}%)</span>
        </div>
        <div className="uni-progress-bar">
          <div className="uni-progress-fill" style={{ transform: `scaleX(${scaleX})` }} />
        </div>
      </div>

      {error && <div className="uni-alert">{error}</div>}
      {total === 0 && <p className="uni-empty-msg">Este pedido no tiene unidades cargadas.</p>}

      {grupos.map(g => (
        <div key={g.itemId} className={`uni-grupo ${g.kitGrupo ? 'uni-grupo--kit' : ''}`}>
          <div className="uni-grupo__head">
            {g.kitGrupo && <span className="uni-kit-badge">Kit</span>}
            <span className="uni-grupo__name">{g.productoNombre}</span>
            {g.sku && <span className="uni-grupo__sku">{g.sku}</span>}
            <span className="uni-grupo__count">{g.unidades.length} ud.</span>
          </div>
          <div className="uni-verif-table-wrap">
            <table className="uni-table">
              <thead>
                <tr>
                  <th className="uni-th uni-th--n">#</th>
                  <th className="uni-th">Talla</th>
                  <th className="uni-th uni-th--wide">Nombre</th>
                  <th className="uni-th">Sexo</th>
                  <th className="uni-th">Tela</th>
                  <th className="uni-th">Estado</th>
                  <th className="uni-th">Nota</th>
                  {puedeVerificar && <th className="uni-th">Acción</th>}
                </tr>
              </thead>
              <tbody>
                {g.unidades.map((u, idx) => {
                  const est         = UNI_ESTADO[u.estado_verificacion];
                  const editandoNota = notaEdit[u.id] !== undefined;
                  return (
                    <tr key={u.id} className={`uni-tr ${u.estado_verificacion === 'pendiente' ? 'uni-tr--pend' : ''}`}>
                      <td className="uni-td uni-td--n">{idx + 1}</td>
                      <td className="uni-td"><span className="uni-talla">{u.talla || '—'}</span></td>
                      <td className="uni-td uni-td--nombre">{u.nombre || '—'}</td>
                      <td className="uni-td">{u.sexo || '—'}</td>
                      <td className="uni-td">{u.tela || '—'}</td>
                      <td className="uni-td">
                        <span className={`uni-badge ${est?.clase}`}>{est?.label}</span>
                      </td>
                      <td className="uni-td">
                        {editandoNota ? (
                          <div className="uni-nota-edit">
                            <input
                              className="uni-input uni-input--nota" autoFocus
                              value={notaEdit[u.id]}
                              onChange={e => setNotaEdit(prev => ({ ...prev, [u.id]: e.target.value }))}
                              onKeyDown={e => {
                                if (e.key === 'Enter')  guardarNota(u.id, notaEdit[u.id]);
                                if (e.key === 'Escape') setNotaEdit(prev => { const n = { ...prev }; delete n[u.id]; return n; });
                              }}
                            />
                            <button className="uni-nota-save" onClick={() => guardarNota(u.id, notaEdit[u.id])} aria-label="Guardar nota">✓</button>
                          </div>
                        ) : (
                          <button
                            className={`uni-nota-btn ${u.nota ? 'uni-nota-btn--has' : ''}`}
                            onClick={() => puedeVerificar && setNotaEdit(prev => ({ ...prev, [u.id]: u.nota || '' }))}
                            disabled={!puedeVerificar}
                          >
                            {u.nota || (puedeVerificar ? '+ nota' : '—')}
                          </button>
                        )}
                      </td>
                      {puedeVerificar && (
                        <td className="uni-td">
                          {u.estado_verificacion === 'pendiente' ? (
                            <button
                              className="uni-verif-btn"
                              onClick={() => verificarUna(u.id)}
                              disabled={trabajando === u.id}
                            >
                              {trabajando === u.id
                                ? <FaSpinner className="uni-spin" />
                                : <><FaCheck /> Verificar</>}
                            </button>
                          ) : (
                            <span className="uni-done-chip"><FaCheck /></span>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {puedeVerificar && pendientes > 0 && (
        <div className="uni-verif-foot">
          <button className="uni-btn uni-btn--green" onClick={verificarTodo} disabled={trabajando === 'all'}>
            {trabajando === 'all'
              ? <><FaSpinner className="uni-spin" /> Verificando…</>
              : <><FaCheck /> Verificar todo el pedido</>}
          </button>
        </div>
      )}
    </div>
  );
};

// ── Hoja del operario ──
export const HojaOperario = ({ pedidoId, perfil }) => {
  const [grupos, setGrupos]         = useState([]);
  const [resumen, setResumen]       = useState(null);
  const [cargando, setCargando]     = useState(true);
  const [trabajando, setTrabajando] = useState(null);
  const [error, setError]           = useState(null);

  const puedeEstampar = ['admin', 'operario'].includes(perfil?.rol);

  const cargar = useCallback(async () => {
    setCargando(true); setError(null);
    const [{ data: unis, error: eUnis }, { data: res, error: eRes }] = await Promise.all([
      supabase
        .from('pedido_item_unidades')
        .select(`
          id, talla, nombre, sexo, tela, estado_verificacion, pedido_item_id,
          pedido_items!inner(id, pedido_id, kit_grupo, kit_id,
            producto_variantes(sku, productos(nombre)))
        `)
        .eq('pedido_items.pedido_id', pedidoId)
        .in('estado_verificacion', ['verificado', 'estampado'])
        .order('pedido_item_id')
        .order('id'),
      supabase.rpc('fn_unidades_resumen', { p_pedido_id: pedidoId }),
    ]);
    if (eUnis || eRes) { setError('No se pudieron cargar las unidades del pedido.'); setCargando(false); return; }

    const map = {};
    (unis || []).forEach(u => {
      const pid = u.pedido_item_id;
      if (!map[pid]) {
        map[pid] = {
          itemId: pid,
          productoNombre: u.pedido_items?.producto_variantes?.productos?.nombre || `Item #${pid}`,
          sku: u.pedido_items?.producto_variantes?.sku,
          kitGrupo: u.pedido_items?.kit_grupo || null,
          unidades: [],
        };
      }
      map[pid].unidades.push(u);
    });
    setGrupos(Object.values(map).sort((a, b) =>
      String(a.kitGrupo || `z${a.itemId}`).localeCompare(String(b.kitGrupo || `z${b.itemId}`))
    ));
    setResumen(res || { total: 0, pendientes: 0, verificadas: 0, estampadas: 0 });
    setCargando(false);
  }, [pedidoId]);

  useEffect(() => { cargar(); }, [cargar]);

  const estampar = async (unidadId) => {
    setTrabajando(unidadId); setError(null);
    const { error: e } = await supabase.rpc('fn_marcar_estampada', { p_unidad_id: unidadId });
    if (e) setError(e.message.includes('UNIDAD_NO_VERIFICADA') ? 'La unidad debe estar verificada primero.' : e.message);
    else await cargar();
    setTrabajando(null);
  };

  if (cargando) return <div className="uni-loading"><FaSpinner className="uni-spin" /> Cargando hoja…</div>;

  const total      = resumen?.total || 0;
  const estampadas = resumen?.estampadas || 0;
  const pendVerif  = resumen?.pendientes || 0;
  const scaleX     = total > 0 ? estampadas / total : 0;
  const pct        = Math.round(scaleX * 100);

  return (
    <div className="uni-hoja">
      <div className="uni-progress-bar-wrap uni-progress-bar-wrap--stamp">
        <div className="uni-progress-labels">
          <span className="uni-progress-label">
            <GiShirt className="uni-hoja-icon" />
            {estampadas}/{total} estampadas
          </span>
          <span className="uni-progress-pct uni-progress-pct--stamp">{pct}%</span>
        </div>
        <div className="uni-progress-bar uni-progress-bar--stamp">
          <div className="uni-progress-fill uni-progress-fill--stamp"
            style={{ transform: `scaleX(${scaleX})` }} />
        </div>
      </div>

      {pendVerif > 0 && (
        <div className="uni-hoja-warning">
          <span aria-hidden="true">⚠</span> {pendVerif} unidad{pendVerif !== 1 ? 'es' : ''} aún en revisión — no aparece{pendVerif !== 1 ? 'n' : ''} aquí hasta ser verificada{pendVerif !== 1 ? 's' : ''}.
        </div>
      )}
      {error && <div className="uni-alert">{error}</div>}
      {grupos.length === 0 && (
        <p className="uni-empty-msg">No hay unidades verificadas para estampar aún.</p>
      )}

      {grupos.map(g => {
        const porEstampar = g.unidades.filter(u => u.estado_verificacion === 'verificado');
        const yaEstamp    = g.unidades.filter(u => u.estado_verificacion === 'estampado');
        return (
          <div key={g.itemId} className={`uni-grupo ${g.kitGrupo ? 'uni-grupo--kit' : ''}`}>
            <div className="uni-grupo__head">
              {g.kitGrupo && <span className="uni-kit-badge">Kit</span>}
              <span className="uni-grupo__name">{g.productoNombre}</span>
              {g.sku && <span className="uni-grupo__sku">{g.sku}</span>}
              <span className="uni-grupo__count">{yaEstamp.length}/{g.unidades.length} estampadas</span>
            </div>

            {porEstampar.length > 0 && (
              <div className="uni-hoja-grid">
                {porEstampar.map((u, idx) => (
                  <div key={u.id} className="uni-hoja-card">
                    <div className="uni-hoja-card__num">{idx + 1}</div>
                    <div className="uni-hoja-card__talla">{u.talla || '—'}</div>
                    <div className="uni-hoja-card__nombre">{u.nombre || 'Sin nombre'}</div>
                    <div className="uni-hoja-card__meta">
                      {u.sexo && <span className="uni-hoja-card__sexo">{u.sexo}</span>}
                      {u.tela && <span className="uni-hoja-card__tela">{u.tela}</span>}
                    </div>
                    {puedeEstampar && (
                      <button
                        className="uni-stamp-btn"
                        onClick={() => estampar(u.id)}
                        disabled={trabajando === u.id}
                      >
                        {trabajando === u.id
                          ? <FaSpinner className="uni-spin" />
                          : <><FaCheck /> Estampado</>}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {yaEstamp.length > 0 && (
              <div className="uni-hoja-done">
                <p className="uni-hoja-done__label">Ya estampadas ({yaEstamp.length})</p>
                <div className="uni-hoja-done__row">
                  {yaEstamp.map(u => (
                    <span key={u.id} className="uni-hoja-done__chip">
                      <FaCheck className="uni-done-icon" /> {u.talla} {u.nombre}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
