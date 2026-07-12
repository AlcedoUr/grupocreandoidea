import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  FaCashRegister, FaClipboardList, FaFileInvoiceDollar, FaBoxOpen,
  FaArrowRight, FaStar, FaTrophy, FaReceipt, FaCalendarDay,
  FaIndustry, FaCheckCircle, FaExclamationTriangle, FaCalendarCheck,
  FaExclamationCircle, FaRedo,
} from 'react-icons/fa';
import { supabase } from '../supabase/client';
import { useAuth } from '../context/AuthContext';
import './Inicio.css';

// Inicio del día (medianoche local) en ISO, para filtrar lo de "hoy".
const inicioDeHoyISO = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
};

// Fin del día (23:59:59 local) en ISO — "vencidos y de hoy" del widget de seguimientos.
const finDeHoyISO = () => {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d.toISOString();
};

const formatoSoles = new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN' });
const soles = (n) => formatoSoles.format(Number(n ?? 0));

const formatoRelativo = new Intl.RelativeTimeFormat('es-PE', { numeric: 'auto' });
const haceTiempo = (iso) => {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'recién';
  if (min < 60) return formatoRelativo.format(-min, 'minute');
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return formatoRelativo.format(-hrs, 'hour');
  const dias = Math.floor(hrs / 24);
  return formatoRelativo.format(-dias, 'day');
};

const ETIQUETA_CANAL = {
  web: 'Pedido web',
  whatsapp: 'Pedido WhatsApp',
  presencial: 'Venta presencial (POS)',
  b2b: 'Pedido corporativo',
};

// Progresión de color (tokens semánticos index.css): rojo → ámbar/azul (en curso) → verde, más oscuro cuanto más cerca de "listo".
const ETAPAS_PROD = {
  pendiente:    { label: 'Pendiente',   color: 'var(--color-danger)' },
  en_diseno:    { label: 'Diseño',      color: 'var(--color-warning)' },
  en_impresion: { label: 'Impresión',   color: 'var(--color-info)' },
  en_planchado: { label: 'Planchado',   color: 'var(--color-brand-400)' },
  en_costura:   { label: 'Costura',     color: 'var(--color-brand-600)' },
  listo:        { label: 'Listo',       color: 'var(--color-brand-800)' },
};

const Inicio = () => {
  const { perfil } = useAuth();

  const [cargando, setCargando] = useState(true);
  const [error, setError]       = useState(null);
  const [reloadToken, setReloadToken] = useState(0); // el botón "Reintentar" incrementa esto para re-disparar el efecto
  const [stats, setStats] = useState({
    ingresosHoy: 0,
    pedidosPendientes: 0,
    cotizacionesNuevas: 0,
    productosActivos: 0,
  });
  const [cajaPorMetodo, setCajaPorMetodo] = useState([]); // [{metodo, monto}]
  const [topVendidos, setTopVendidos]     = useState([]); // productos destacados
  const [ultimosPedidos, setUltimosPedidos] = useState([]);
  const [kpisProd, setKpisProd]           = useState(null);
  const [segHoy, setSegHoy]               = useState([]);

  useEffect(() => {
    const cargar = async () => {
      setCargando(true);
      setError(null);
      const hoy = inicioDeHoyISO();
      try {
        const [
          resPagosHoy,
          resPendientes,
          resCotsNuevas,
          resProductos,
          resTop,
          resUltimos,
          resKpis,
          resSegHoy,
        ] = await Promise.all([
          supabase.from('pagos').select('monto, metodo_pago').gte('created_at', hoy),
          supabase.from('pedidos').select('id', { count: 'exact', head: true }).eq('estado_produccion', 'pendiente'),
          supabase.from('cotizaciones').select('id', { count: 'exact', head: true }).eq('estado', 'nueva'),
          supabase.from('productos').select('id', { count: 'exact', head: true }).eq('activo', true),
          supabase.from('productos')
            .select('id, nombre, imagen_url, categorias(nombre), producto_variantes(precio_base, activo)')
            .eq('activo', true).eq('es_destacado', true)
            .limit(5),
          supabase.from('pedidos')
            .select('id, total, canal, estado_produccion, created_at, clientes(nombre)')
            .order('created_at', { ascending: false }).limit(5),
          supabase.rpc('fn_kpis_produccion'),
          perfil
            ? supabase.from('seguimientos')
                .select('id, cliente_id, nota, vence_en, clientes(nombre)')
                .eq('asignado_a', perfil.id).eq('estado', 'pendiente')
                .lte('vence_en', finDeHoyISO())
                .order('vence_en', { ascending: true })
                .limit(8)
            : Promise.resolve({ data: [] }),
        ]);

        // Agregar pagos de hoy: total + desglose por método.
        const pagos = resPagosHoy.data ?? [];
        const totalHoy = pagos.reduce((s, p) => s + Number(p.monto ?? 0), 0);
        const mapa = {};
        for (const p of pagos) {
          mapa[p.metodo_pago] = (mapa[p.metodo_pago] ?? 0) + Number(p.monto ?? 0);
        }
        const desglose = Object.entries(mapa)
          .map(([metodo, monto]) => ({ metodo, monto }))
          .sort((a, b) => b.monto - a.monto);

        setStats({
          ingresosHoy: totalHoy,
          pedidosPendientes: resPendientes.count ?? 0,
          cotizacionesNuevas: resCotsNuevas.count ?? 0,
          productosActivos: resProductos.count ?? 0,
        });
        setCajaPorMetodo(desglose);
        setTopVendidos(resTop.data ?? []);
        setUltimosPedidos(resUltimos.data ?? []);
        setKpisProd(resKpis.data ?? null);
        setSegHoy(resSegHoy.data ?? []);
      } catch (err) {
        console.error('Error al cargar el dashboard:', err);
        setError('No se pudieron cargar los datos del panel.');
      } finally {
        setCargando(false);
      }
    };
    cargar();
  }, [perfil, reloadToken]);

  const reintentar = () => setReloadToken((t) => t + 1);

  const primerNombre = perfil?.nombre?.split(' ')[0] ?? 'equipo';
  const maxCaja = Math.max(1, ...cajaPorMetodo.map(c => c.monto));

  const kpis = [
    {
      etiqueta: 'Ingresos de hoy',
      valor: soles(stats.ingresosHoy),
      icono: <FaCashRegister aria-hidden="true" />, tono: 'dash-kpi__icon--brand',
      to: '/dashboard/pedidos',
    },
    {
      etiqueta: 'Pedidos pendientes',
      valor: stats.pedidosPendientes,
      icono: <FaClipboardList aria-hidden="true" />, tono: 'dash-kpi__icon--warn',
      to: '/dashboard/pedidos',
    },
    {
      etiqueta: 'Cotizaciones nuevas',
      valor: stats.cotizacionesNuevas,
      icono: <FaFileInvoiceDollar aria-hidden="true" />, tono: 'dash-kpi__icon--info',
      to: '/dashboard/pedidos',
    },
    {
      etiqueta: 'Productos activos',
      valor: stats.productosActivos,
      icono: <FaBoxOpen aria-hidden="true" />, tono: 'dash-kpi__icon--ink',
      to: '/dashboard/productos',
    },
  ];

  return (
    <div className="dash" aria-live="polite" aria-busy={cargando}>

      {/* Encabezado */}
      <div className="dash-head">
        <div>
          <h1 className="dash-head__title">Panel de rendimiento</h1>
          <p className="dash-head__sub">Hola, {primerNombre}. Este es el resumen de tus operaciones de hoy.</p>
        </div>
        <span className="dash-head__date">
          <FaCalendarDay aria-hidden="true" /> {new Date().toLocaleDateString('es-PE', { weekday: 'long', day: 'numeric', month: 'long' })}
        </span>
      </div>

      {/* Error de carga — distinto de los estados vacíos, no debe verse como "hoy no hubo datos" */}
      {error && (
        <div className="dash-error-banner" role="alert">
          <FaExclamationTriangle className="dash-error-banner__icon" aria-hidden="true" />
          <p className="dash-error-banner__text">{error}</p>
          <button type="button" className="btn btn--ghost dash-error-banner__retry" onClick={reintentar}>
            <FaRedo aria-hidden="true" /> Reintentar
          </button>
        </div>
      )}

      {/* Pendientes de hoy — pantalla de arranque del vendedor (Bloque A del CRM) */}
      {perfil && segHoy.length > 0 && (
        <div className="dash-mid">
          <div className="dash-card">
            <div className="dash-card__head">
              <h2 className="dash-card__title"><FaCalendarCheck aria-hidden="true" /> Mis seguimientos de hoy</h2>
              <Link to="/dashboard/clientes" className="dash-card__link">Ver clientes</Link>
            </div>
            {segHoy.length === 0 ? (
              <div className="dash-empty">Sin seguimientos vencidos ni para hoy. 🎉</div>
            ) : (
              <div className="dash-pend-list">
                {segHoy.map((s) => {
                  const vencido = new Date(s.vence_en) < new Date();
                  return (
                    <Link
                      key={s.id}
                      to={`/dashboard/clientes?cliente=${s.cliente_id}`}
                      className={`dash-pend-row ${vencido ? 'dash-pend-row--vencido' : ''}`}
                    >
                      {vencido && (
                        <>
                          <span className="sr-only">Vencido: </span>
                          <FaExclamationCircle className="dash-pend-row__alerta" aria-hidden="true" />
                        </>
                      )}
                      <span className="dash-pend-row__main">
                        <span className="dash-pend-row__titulo">{s.clientes?.nombre ?? 'Cliente'}</span>
                        <span className="dash-pend-row__nota">{s.nota}</span>
                      </span>
                      <span className="dash-pend-row__hora">
                        {new Date(s.vence_en).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* KPIs */}
      <div className="dash-kpis">
        {cargando
          ? Array.from({ length: 4 }).map((_, i) => <div key={i} className="dash-skel dash-skel--kpi" />)
          : kpis.map((k) => (
            <Link key={k.etiqueta} to={k.to} className="dash-kpi">
              <div className="dash-kpi__top">
                <span className={`dash-kpi__icon ${k.tono}`}>{k.icono}</span>
                <FaArrowRight className="dash-kpi__arrow" aria-hidden="true" />
              </div>
              <div>
                <p className="dash-kpi__label">{k.etiqueta}</p>
                <p className="dash-kpi__value">{k.valor}</p>
              </div>
            </Link>
          ))
        }
      </div>

      {/* Top 5 + Cierre de caja */}
      <div className="dash-mid">

        <div className="dash-card">
          <div className="dash-card__head">
            <h2 className="dash-card__title"><FaTrophy aria-hidden="true" /> Top 5 más vendidos</h2>
            <Link to="/dashboard/productos" className="dash-card__link">Gestionar</Link>
          </div>
          {cargando ? (
            <div className="dash-skel-list">
              {Array.from({ length: 3 }).map((_, i) => <div key={i} className="dash-skel dash-skel--row" />)}
            </div>
          ) : topVendidos.length === 0 ? (
            <div className="dash-empty">
              Marca productos como <strong>Destacado</strong> en el catálogo para verlos aquí.
            </div>
          ) : (
            <div className="dash-top">
              {topVendidos.map((p, i) => (
                <Link
                  key={p.id}
                  to="/dashboard/productos"
                  className="dash-top__row"
                >
                  <span className={`dash-top__rank ${i === 0 ? 'dash-top__rank--1' : ''}`}>{i + 1}</span>
                  <span className="dash-top__thumb">
                    {p.imagen_url
                      ? <img src={p.imagen_url} alt={p.nombre} width={44} height={44} loading="lazy" />
                      : <span className="dash-top__thumb-no"><FaBoxOpen aria-hidden="true" /></span>}
                  </span>
                  <span className="dash-top__info">
                    <p className="dash-top__name">{p.nombre}</p>
                    <p className="dash-top__meta">{p.categorias?.nombre ?? 'Sin categoría'}</p>
                  </span>
                  <span className="badge-status badge-status--exito dash-top__badge"><FaStar aria-hidden="true" /> Destacado</span>
                  <span className="dash-top__price">
                    {(() => {
                      // Precio "desde" por variante activa (productos.precio_base es legacy)
                      const activas = (p.producto_variantes ?? []).filter(v => v.activo);
                      return activas.length
                        ? soles(Math.min(...activas.map(v => Number(v.precio_base) || 0)))
                        : 'Se cotiza';
                    })()}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className="dash-card">
          <div className="dash-card__head">
            <h2 className="dash-card__title"><FaReceipt aria-hidden="true" /> Cierre de caja · hoy</h2>
          </div>
          <div className="dash-caja">
            <p className="dash-caja__total-label">Total cobrado hoy</p>
            <p className="dash-caja__total">{soles(stats.ingresosHoy)}</p>

            {cajaPorMetodo.length === 0 ? (
              <p className="dash-caja__empty">Aún no hay pagos registrados hoy.</p>
            ) : (
              <div className="dash-caja__list">
                {cajaPorMetodo.map((c) => (
                  <div key={c.metodo}>
                    <div className="dash-caja__item-head">
                      <span className="dash-caja__metodo">{c.metodo}</span>
                      <span className="dash-caja__monto">{soles(c.monto)}</span>
                    </div>
                    <div className="dash-caja__bar">
                      <div className="dash-caja__fill" style={{ width: `${(c.monto / maxCaja) * 100}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="dash-card">
        <div className="dash-card__head">
          <h2 className="dash-card__title"><FaClipboardList aria-hidden="true" /> Actividad reciente</h2>
          <Link to="/dashboard/pedidos" className="dash-card__link">Ver pedidos</Link>
        </div>
        {cargando ? (
          <div className="dash-skel-list">
            {Array.from({ length: 3 }).map((_, i) => <div key={i} className="dash-skel dash-skel--row" />)}
          </div>
        ) : ultimosPedidos.length === 0 ? (
          <div className="dash-empty">Todavía no hay pedidos registrados.</div>
        ) : (
          <div className="dash-feed">
            {ultimosPedidos.map((p) => (
              <div key={p.id} className="dash-feed__row">
                <span className="dash-feed__icon"><FaReceipt aria-hidden="true" /></span>
                <div className="dash-feed__main">
                  <p className="dash-feed__text">
                    {ETIQUETA_CANAL[p.canal] ?? 'Pedido'} de <strong>{p.clientes?.nombre ?? 'Cliente'}</strong> · {soles(p.total)}
                  </p>
                  <p className="dash-feed__time">{haceTiempo(p.created_at)}</p>
                </div>
                <span className={`dash-feed__state dash-feed__state--${p.estado_produccion}`}>
                  {p.estado_produccion?.replace(/_/g, ' ')}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* KPIs de producción */}
      <div className="dash-mid">

        <div className="dash-card">
          <div className="dash-card__head">
            <h2 className="dash-card__title"><FaIndustry aria-hidden="true" /> Trabajo en curso (WIP)</h2>
            <Link to="/dashboard/pedidos" className="dash-card__link">Ver tablero</Link>
          </div>
          {cargando ? (
            <div className="dash-skel-list">
              {Array.from({ length: 4 }).map((_, i) => <div key={i} className="dash-skel dash-skel--row" />)}
            </div>
          ) : !kpisProd || (kpisProd.wip ?? []).length === 0 ? (
            <div className="dash-empty">Sin pedidos activos en producción.</div>
          ) : (
            <div className="dash-wip">
              {(() => {
                const wip = kpisProd.wip ?? [];
                const maxCnt = Math.max(1, ...wip.map((i) => i.count));
                return wip.map((item) => {
                  const etapa = ETAPAS_PROD[item.estado] ?? { label: item.estado, color: 'var(--color-ink-400)' };
                  return (
                    <div key={item.estado} className="dash-wip__row">
                      <span className="dash-wip__label">{etapa.label}</span>
                      <div className="dash-wip__bar-wrap">
                        <div
                          className="dash-wip__bar"
                          style={{ transform: `scaleX(${item.count / maxCnt})`, backgroundColor: etapa.color }}
                        />
                      </div>
                      <span className="dash-wip__count">{item.count}</span>
                    </div>
                  );
                });
              })()}
            </div>
          )}
        </div>

        {/* Cumplimiento + Throughput + Atrasados */}
        <div className="dash-card">
          <div className="dash-card__head">
            <h2 className="dash-card__title"><FaCheckCircle aria-hidden="true" /> Rendimiento de entregas</h2>
          </div>
          {cargando ? (
            <div className="dash-skel-list">
              {Array.from({ length: 2 }).map((_, i) => <div key={i} className="dash-skel dash-skel--row" />)}
            </div>
          ) : (
            <div className="dash-metricas">
              <div className="dash-metrica">
                <p className="dash-metrica__label">Cumplimiento de fecha de recojo</p>
                <p className="dash-metrica__val">
                  {kpisProd?.cumplimiento != null
                    ? <><span className="dash-metrica__big">{kpisProd.cumplimiento}</span><span className="dash-metrica__unit"> %</span></>
                    : <span className="dash-metrica__na">Sin historial aún</span>}
                </p>
              </div>

              {(kpisProd?.atrasados ?? []).length > 0 && (
                <div className="dash-atrasados">
                  <p className="dash-atrasados__title">
                    <FaExclamationTriangle aria-hidden="true" />
                    {kpisProd.atrasados.length} pedido{kpisProd.atrasados.length !== 1 ? 's' : ''} con fecha vencida
                  </p>
                  <div className="dash-atrasados__list">
                    {kpisProd.atrasados.slice(0, 4).map((a) => (
                      <div key={a.id} className="dash-atrasados__row">
                        <span className="dash-atrasados__id">#{a.id}</span>
                        <span className="dash-atrasados__cli">{a.cliente}</span>
                        <span className="dash-atrasados__fecha">{a.fecha}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {(kpisProd?.throughput ?? []).length > 0 && (
                <div className="dash-throughput">
                  <p className="dash-throughput__label">Pedidos entregados por semana</p>
                  <div className="dash-throughput__weeks">
                    {kpisProd.throughput.slice(-6).map((w) => (
                      <div key={w.semana} className="dash-throughput__week">
                        <span className="dash-throughput__cnt">{w.count}</span>
                        <span className="dash-throughput__sem">{w.semana.slice(5)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {!kpisProd && (
                <div className="dash-empty">Sin datos de producción todavía.</div>
              )}
            </div>
          )}
        </div>
      </div>

    </div>
  );
};

export default Inicio;
