import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  FaSpinner, FaChartLine, FaFunnelDollar, FaClock, FaCheckDouble,
} from 'react-icons/fa';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  BarChart, Bar, Cell, LabelList,
} from 'recharts';
import { supabase } from '../supabase/client';
import './Reportes.css';

const soles = (n) => `S/ ${Number(n ?? 0).toFixed(2)}`;

// Exporta un arreglo de filas a CSV y dispara la descarga (sin dependencias).
const exportarCSV = (nombreArchivo, columnas, filas) => {
  const escapar = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lineas = [
    columnas.map(([, etiqueta]) => escapar(etiqueta)).join(','),
    ...filas.map((fila) => columnas.map(([clave]) => escapar(fila[clave])).join(',')),
  ];
  const blob = new Blob([`﻿${lineas.join('\r\n')}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = nombreArchivo;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

const BotonExportar = ({ nombreArchivo, columnas, filas }) => (
  <button type="button" className="rep-export" onClick={() => exportarCSV(nombreArchivo, columnas, filas)}>
    Exportar CSV
  </button>
);

// Solo se vende por Presencial/WhatsApp; "web"/"b2b" son 3 filas de prueba reales que no se borran, se marcan como retiradas.
const CANAL_LABEL = { presencial: 'Presencial', whatsapp: 'WhatsApp', web: 'Web (canal retirado)', b2b: 'B2B (canal retirado)' };
// whatsapp_bot se retiró (doc §63); queda 1 fila histórica real, se marca "(retirado)" sin borrarla.
const ORIGEN_LABEL = { web_b2b: 'Web B2B', whatsapp_bot: 'WhatsApp Bot (retirado)', backoffice: 'Backoffice directo' };

// Paleta categórica CVD-safe, orden fijo (ver skill dataviz); contraste del ámbar se resuelve con etiquetas de valor visibles.
const SERIE = ['var(--rep-series-1)', 'var(--rep-series-2)', 'var(--rep-series-3)', 'var(--rep-series-4)'];

const hoyISO = () => new Date().toISOString().slice(0, 10);
const haceDiasISO = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};

const PRESETS = [
  { k: '7d',  label: '7 días',  desde: () => haceDiasISO(6) },
  { k: '30d', label: '30 días', desde: () => haceDiasISO(29) },
  { k: 'mes', label: 'Este mes', desde: () => { const d = new Date(); d.setDate(1); return d.toISOString().slice(0, 10); } },
];

const fmtFecha = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString('es-PE', { day: '2-digit', month: 'short' });

const TooltipDia = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="rep-tooltip">
      <p className="rep-tooltip__k">{fmtFecha(label)}</p>
      <p className="rep-tooltip__v">{soles(payload[0].value)}</p>
    </div>
  );
};

// ── Embudo de conversión (Bloque B CRM) ──
const ETAPAS_EMBUDO = [
  { k: 'recibidas',  label: 'Recibidas' },
  { k: 'atendidas',  label: 'Atendidas' },
  { k: 'convertidas', label: 'Convertidas' },
  { k: 'aceptadas',  label: 'Aceptadas' },
];

const FunnelBars = ({ totales }) => {
  const max = Math.max(1, totales?.recibidas ?? 0);
  return (
    <div className="rep-funnel">
      {ETAPAS_EMBUDO.map((etapa, i) => {
        const valor = totales?.[etapa.k] ?? 0;
        const anterior = i > 0 ? (totales?.[ETAPAS_EMBUDO[i - 1].k] ?? 0) : null;
        const tasa = anterior != null && anterior > 0 ? Math.round((valor / anterior) * 100) : null;
        return (
          <div key={etapa.k} className="rep-funnel__row">
            <span className="rep-funnel__label">{etapa.label}</span>
            <div className="rep-funnel__track">
              <div className="rep-funnel__fill" style={{ transform: `scaleX(${Math.max(0.04, valor / max)})` }} />
            </div>
            <span className="rep-funnel__valor">{valor}</span>
            {tasa != null && <span className="rep-funnel__tasa">{tasa}%</span>}
          </div>
        );
      })}
    </div>
  );
};

const EmbudoPanel = ({ desde, hasta }) => {
  const [data, setData] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [reintento, setReintento] = useState(0);

  useEffect(() => {
    let vigente = true;
    (async () => {
      setCargando(true); setError(null);
      const { data: rpt, error: e } = await supabase.rpc('fn_reporte_embudo', { p_desde: desde, p_hasta: hasta });
      if (!vigente) return; // el usuario ya cambió el rango/pestaña
      if (e) { setError(e.message); setCargando(false); return; }
      setData(rpt);
      setCargando(false);
    })();
    return () => { vigente = false; };
  }, [desde, hasta, reintento]);

  if (cargando) return <div className="rep-loading" aria-live="polite"><FaSpinner className="rep-spin" aria-hidden="true" /> Cargando embudo…</div>;
  if (error) return (
    <div className="rep-alert" role="alert">
      {error}
      <button type="button" className="rep-retry" onClick={() => setReintento((r) => r + 1)}>Reintentar</button>
    </div>
  );

  const totales = data?.totales ?? {};
  const porOrigen = data?.por_origen ?? [];
  const porVendedor = data?.por_vendedor ?? [];

  return (
    <>
      <div className="rep-kpis">
        <div className="rep-kpi">
          <p className="rep-kpi__k">Tasa de conversión</p>
          <p className="rep-kpi__v">{totales.tasa_conversion ?? '—'}%</p>
        </div>
        <div className="rep-kpi">
          <p className="rep-kpi__k">Tasa de cierre</p>
          <p className="rep-kpi__v">{totales.tasa_cierre ?? '—'}%</p>
        </div>
        <div className="rep-kpi">
          <p className="rep-kpi__k"><FaClock className="rep-kpi__icon" aria-hidden="true" /> Tiempo a primera atención</p>
          <p className="rep-kpi__v">{totales.horas_atencion_prom != null ? `${totales.horas_atencion_prom} h` : '—'}</p>
        </div>
        <div className="rep-kpi">
          <p className="rep-kpi__k"><FaCheckDouble className="rep-kpi__icon" aria-hidden="true" /> Tiempo de cierre</p>
          <p className="rep-kpi__v">{totales.dias_cierre_prom != null ? `${totales.dias_cierre_prom} d` : '—'}</p>
        </div>
      </div>

      <div className="rep-card">
        <h2 className="rep-card__title"><FaFunnelDollar aria-hidden="true" /> Embudo (periodo)</h2>
        <FunnelBars totales={totales} />
      </div>

      <div className="rep-card">
        <div className="rep-card__head">
          <h2 className="rep-card__title">Por origen</h2>
          {porOrigen.length > 0 && (
            <BotonExportar nombreArchivo={`embudo-por-origen_${desde}_${hasta}.csv`}
              columnas={[['origen', 'Origen'], ['recibidas', 'Recibidas'], ['atendidas', 'Atendidas'],
                ['convertidas', 'Convertidas'], ['aceptadas', 'Aceptadas'], ['rechazadas', 'Rechazadas'],
                ['abiertas', 'Abiertas'], ['monto_aceptado', 'Monto aceptado']]}
              filas={porOrigen.map((o) => ({ ...o, origen: ORIGEN_LABEL[o.origen] ?? o.origen }))} />
          )}
        </div>
        {porOrigen.length === 0 ? <p className="rep-empty">Sin datos en el periodo.</p> : (
          <table className="rep-table">
            <thead>
              <tr>
                <th>Origen</th><th className="rep-th--num">Recibidas</th><th className="rep-th--num">Atendidas</th>
                <th className="rep-th--num">Convertidas</th><th className="rep-th--num">Aceptadas</th>
                <th className="rep-th--num">Rechazadas</th><th className="rep-th--num">Abiertas</th>
                <th className="rep-th--num">Monto aceptado</th>
              </tr>
            </thead>
            <tbody>
              {porOrigen.map((o) => (
                <tr key={o.origen}>
                  <td>{ORIGEN_LABEL[o.origen] ?? o.origen}</td>
                  <td className="rep-th--num">{o.recibidas}</td>
                  <td className="rep-th--num">{o.atendidas ?? '—'}</td>
                  <td className="rep-th--num">{o.convertidas}</td>
                  <td className="rep-th--num">{o.aceptadas}</td>
                  <td className="rep-th--num">{o.rechazadas}</td>
                  <td className="rep-th--num">{o.abiertas}</td>
                  <td className="rep-th--num">{soles(o.monto_aceptado)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="rep-card">
        <div className="rep-card__head">
          <h2 className="rep-card__title">Por vendedor</h2>
          {porVendedor.length > 0 && (
            <BotonExportar nombreArchivo={`embudo-por-vendedor_${desde}_${hasta}.csv`}
              columnas={[['nombre', 'Vendedor'], ['creadas', 'Creadas'], ['aceptadas', 'Aceptadas'], ['monto_aceptado', 'Monto aceptado']]}
              filas={porVendedor} />
          )}
        </div>
        {porVendedor.length === 0 ? <p className="rep-empty">Sin cotizaciones con vendedor asignado en el periodo.</p> : (
          <table className="rep-table">
            <thead><tr><th>Vendedor</th><th className="rep-th--num">Creadas</th><th className="rep-th--num">Aceptadas</th><th className="rep-th--num">Monto aceptado</th></tr></thead>
            <tbody>
              {porVendedor.map((v) => (
                <tr key={v.vendedor_id}>
                  <td>{v.nombre}</td>
                  <td className="rep-th--num">{v.creadas}</td>
                  <td className="rep-th--num">{v.aceptadas}</td>
                  <td className="rep-th--num">{soles(v.monto_aceptado)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
};

const Reportes = () => {
  const [tab, setTab] = useState('ventas');
  const [preset, setPreset] = useState('30d');
  const [desde, setDesde]   = useState(haceDiasISO(29));
  const [hasta, setHasta]   = useState(hoyISO());
  const [data, setData]     = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError]   = useState(null);

  const cargaIdRef = useRef(0);
  const cargar = useCallback(async () => {
    const miCarga = ++cargaIdRef.current;
    setCargando(true); setError(null);
    const { data: rpt, error: e } = await supabase.rpc('fn_reporte_ventas', { p_desde: desde, p_hasta: hasta });
    if (miCarga !== cargaIdRef.current) return; // el rango cambió mientras esperábamos
    if (e) { setError(e.message); setCargando(false); return; }
    setData(rpt);
    setCargando(false);
  }, [desde, hasta]);

  useEffect(() => { cargar(); }, [cargar]);

  const elegirPreset = (p) => {
    setPreset(p.k);
    setDesde(p.desde());
    setHasta(hoyISO());
  };

  const resumen = data?.resumen ?? { total_ventas: 0, count_pedidos: 0, ticket_promedio: 0 };
  const devoluciones = data?.devoluciones ?? { reembolsado: 0, descontado: 0 };
  const servProd = data?.servicios_vs_productos ?? { productos: 0, servicios: 0 };
  const totalServProd = (servProd.productos || 0) + (servProd.servicios || 0);
  const pctProductos = totalServProd > 0 ? (servProd.productos / totalServProd) * 100 : 0;
  const pctServicios = 100 - pctProductos;

  const porCanal = (data?.ventas_por_canal ?? []).map((c) => ({ ...c, label: CANAL_LABEL[c.canal] ?? c.canal }));

  return (
    <div className="rep">
      <div className="rep-head">
        <div>
          <h1 className="rep-head__title">Reportes</h1>
          <p className="rep-head__sub">
            {tab === 'ventas'
              ? 'Ventas, productos y clientes del periodo. Sin márgenes (no hay costo de compra registrado).'
              : 'Dónde se pierden las ventas y cuánto tardamos en cerrarlas.'}
          </p>
        </div>
        <div className="rep-tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'ventas'} className={`rep-preset ${tab === 'ventas' ? 'rep-preset--on' : ''}`} onClick={() => setTab('ventas')}>Ventas</button>
          <button role="tab" aria-selected={tab === 'embudo'} className={`rep-preset ${tab === 'embudo' ? 'rep-preset--on' : ''}`} onClick={() => setTab('embudo')}>Embudo</button>
        </div>
        <div className="rep-rango">
          {PRESETS.map((p) => (
            <button key={p.k} className={`rep-preset ${preset === p.k ? 'rep-preset--on' : ''}`} onClick={() => elegirPreset(p)}>
              {p.label}
            </button>
          ))}
          <input type="date" className="rep-fecha" aria-label="Fecha de inicio" value={desde} max={hasta}
            onChange={(e) => { setPreset(null); setDesde(e.target.value); }} />
          <span className="rep-rango__sep" aria-hidden="true">–</span>
          <input type="date" className="rep-fecha" aria-label="Fecha de fin" value={hasta} min={desde} max={hoyISO()}
            onChange={(e) => { setPreset(null); setHasta(e.target.value); }} />
        </div>
      </div>

      {tab === 'embudo' ? (
        <EmbudoPanel desde={desde} hasta={hasta} />
      ) : (
        <div role="tabpanel">
      {error && (
        <div className="rep-alert" role="alert">
          {error}
          <button type="button" className="rep-retry" onClick={cargar}>Reintentar</button>
        </div>
      )}

      {cargando ? (
        <div className="rep-loading" aria-live="polite"><FaSpinner className="rep-spin" aria-hidden="true" /> Cargando reporte…</div>
      ) : (
        <>
          <div className="rep-kpis">
            <div className="rep-kpi">
              <p className="rep-kpi__k">Total vendido</p>
              <p className="rep-kpi__v">{soles(resumen.total_ventas)}</p>
            </div>
            <div className="rep-kpi">
              <p className="rep-kpi__k">Pedidos aceptados</p>
              <p className="rep-kpi__v">{resumen.count_pedidos}</p>
            </div>
            <div className="rep-kpi">
              <p className="rep-kpi__k">Ticket promedio</p>
              <p className="rep-kpi__v">{soles(resumen.ticket_promedio)}</p>
            </div>
            <div className="rep-kpi rep-kpi--devol">
              <p className="rep-kpi__k">Devoluciones del periodo</p>
              <p className="rep-kpi__v">
                {soles(devoluciones.reembolsado)} <span className="rep-kpi__hint">reembolsado</span>
              </p>
              <p className="rep-kpi__v2">
                {soles(devoluciones.descontado)} <span className="rep-kpi__hint">descontado de saldo</span>
              </p>
            </div>
          </div>

          <div className="rep-card">
            <h2 className="rep-card__title"><FaChartLine aria-hidden="true" /> Ventas por día</h2>
            {(data?.ventas_por_dia ?? []).length === 0 ? (
              <p className="rep-empty">Sin ventas en el periodo.</p>
            ) : (
              <div role="img" aria-label={`Gráfico de área: ventas diarias del ${fmtFecha(desde)} al ${fmtFecha(hasta)}, total ${soles(resumen.total_ventas)}.`}>
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={data.ventas_por_dia} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
                  <defs>
                    <linearGradient id="repFillDia" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--color-brand-500)" stopOpacity={0.28} />
                      <stop offset="100%" stopColor="var(--color-brand-500)" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke="var(--color-line)" />
                  <XAxis dataKey="fecha" tickFormatter={fmtFecha} tick={{ fontSize: 11, fill: 'var(--color-ink-500)' }} axisLine={{ stroke: 'var(--color-line-strong)' }} tickLine={false} />
                  <YAxis width={0} tick={false} axisLine={false} tickLine={false} />
                  <Tooltip content={<TooltipDia />} cursor={{ stroke: 'var(--color-line-strong)' }} />
                  <Area type="monotone" dataKey="total" stroke="var(--color-brand-500)" strokeWidth={2}
                    fill="url(#repFillDia)" activeDot={{ r: 4 }} />
                </AreaChart>
              </ResponsiveContainer>
              </div>
            )}
          </div>

          <div className="rep-card">
            <h2 className="rep-card__title">Ventas por canal</h2>
            {porCanal.length === 0 ? <p className="rep-empty">Sin datos.</p> : (
              <div role="img" aria-label={`Gráfico de barras: ventas por canal — ${porCanal.map((c) => `${c.label} ${soles(c.total)}`).join(', ')}.`}>
              <ResponsiveContainer width="100%" height={Math.max(120, porCanal.length * 46)}>
                <BarChart data={porCanal} layout="vertical" margin={{ top: 4, right: 44, left: 4, bottom: 4 }}>
                  <XAxis type="number" hide />
                  <YAxis type="category" dataKey="label" width={140} tick={{ fontSize: 12, fill: 'var(--color-ink-600)' }} axisLine={false} tickLine={false} />
                  <Bar dataKey="total" radius={[0, 4, 4, 0]} barSize={22}>
                    {porCanal.map((_, i) => <Cell key={i} fill={SERIE[i % SERIE.length]} />)}
                    <LabelList dataKey="total" position="right" formatter={soles}
                      style={{ fontSize: 12, fontWeight: 700, fill: 'var(--color-ink-800)' }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              </div>
            )}
          </div>

          <div className="rep-card">
            <h2 className="rep-card__title">Servicios vs. productos</h2>
            {totalServProd === 0 ? <p className="rep-empty">Sin datos.</p> : (
              <div className="rep-propbar">
                <div className="rep-propbar__track">
                  <div className="rep-propbar__seg rep-propbar__seg--a" style={{ width: `${pctProductos}%` }} />
                  <div className="rep-propbar__seg rep-propbar__seg--b" style={{ width: `${pctServicios}%` }} />
                </div>
                <div className="rep-propbar__legend">
                  <span className="rep-propbar__item"><i className="rep-propbar__dot rep-propbar__dot--a" />Productos — {soles(servProd.productos)} ({pctProductos.toFixed(0)}%)</span>
                  <span className="rep-propbar__item"><i className="rep-propbar__dot rep-propbar__dot--b" />Servicios — {soles(servProd.servicios)} ({pctServicios.toFixed(0)}%)</span>
                </div>
              </div>
            )}
          </div>

          <div className="rep-grid2">
            <div className="rep-card">
              <div className="rep-card__head">
                <h2 className="rep-card__title">Top productos</h2>
                {(data?.top_productos ?? []).length > 0 && (
                  <BotonExportar nombreArchivo={`top-productos_${desde}_${hasta}.csv`}
                    columnas={[['nombre', 'Producto'], ['unidades', 'Unidades'], ['importe', 'Importe']]}
                    filas={data.top_productos} />
                )}
              </div>
              {(data?.top_productos ?? []).length === 0 ? <p className="rep-empty">Sin datos.</p> : (
                <table className="rep-table">
                  <thead><tr><th>Producto</th><th className="rep-th--num">Unidades</th><th className="rep-th--num">Importe</th></tr></thead>
                  <tbody>
                    {data.top_productos.map((p) => (
                      <tr key={p.producto_id}>
                        <td>{p.nombre}</td>
                        <td className="rep-th--num">{p.unidades}</td>
                        <td className="rep-th--num">{soles(p.importe)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="rep-card">
              <div className="rep-card__head">
                <h2 className="rep-card__title">Top clientes</h2>
                {(data?.top_clientes ?? []).length > 0 && (
                  <BotonExportar nombreArchivo={`top-clientes_${desde}_${hasta}.csv`}
                    columnas={[['nombre', 'Cliente'], ['count', 'Pedidos'], ['total', 'Total']]}
                    filas={data.top_clientes} />
                )}
              </div>
              {(data?.top_clientes ?? []).length === 0 ? <p className="rep-empty">Sin datos.</p> : (
                <table className="rep-table">
                  <thead><tr><th>Cliente</th><th className="rep-th--num">Pedidos</th><th className="rep-th--num">Total</th></tr></thead>
                  <tbody>
                    {data.top_clientes.map((c) => (
                      <tr key={c.cliente_id}>
                        <td>{c.nombre}</td>
                        <td className="rep-th--num">{c.count}</td>
                        <td className="rep-th--num">{soles(c.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </>
      )}
        </div>
      )}
    </div>
  );
};

export default Reportes;
