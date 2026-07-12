import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  FaSearch, FaSpinner, FaUser, FaBuilding, FaPhoneAlt, FaEnvelope,
  FaMapMarkerAlt, FaIdCard, FaEdit, FaCheckCircle, FaTimes, FaPlus,
  FaFileInvoiceDollar, FaClipboardList, FaMoneyBillWave, FaUndoAlt,
  FaCalendarPlus, FaBan, FaStickyNote, FaExclamationCircle,
  FaTag, FaWhatsapp, FaShoppingBag,
} from 'react-icons/fa';
import { supabase } from '../supabase/client';
import ModalSeguimiento from '../components/ModalSeguimiento';
import { etiquetaRelacion } from '../lib/constantes';
import { esTelefonoValido, soloDigitos9 } from '../lib/telefono';
import './Clientes.css';

const fmtFechaCorta = (iso) =>
  new Date(iso).toLocaleDateString('es-PE', { day: 'numeric', month: 'short', year: 'numeric' });
const estaVencido = (iso) => new Date(iso) < new Date();

const fmtFecha = (iso) =>
  new Date(iso).toLocaleString('es-PE', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const fmtMonto = (n) => `S/ ${parseFloat(n ?? 0).toFixed(2)}`;

const ETIQUETA_COMERCIAL = {
  cotizacion: 'Cotización',
  aceptado:   'Pedido aceptado',
  rechazada:  'Cotización rechazada',
  cancelado:  'Pedido cancelado',
};
const ETIQUETA_ORIGEN = {
  web_b2b:      'Formulario web',
  whatsapp_bot: 'Bot de WhatsApp',
  backoffice:   'Backoffice',
};

const CLIENTE_VACIO = {
  nombre: '', telefono: '', tipo: 'persona', dni: '', ruc: '',
  razon_social: '', email: '', direccion: '', notas: '', etiquetas: [],
};

const soles = (n) => `S/ ${Number(n ?? 0).toFixed(2)}`;
const diasDesde = (iso) => Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);

// Campos de perfil que vale la pena completar en un cliente que ya compró.
const camposFaltantes = (c) => {
  const faltan = [];
  if (!c.email) faltan.push('correo');
  if (!c.direccion) faltan.push('dirección');
  if (c.tipo === 'empresa' ? !c.ruc : !c.dni) faltan.push(c.tipo === 'empresa' ? 'RUC' : 'DNI');
  return faltan;
};

// ── Línea de tiempo: solicitudes + pedidos + pagos + devoluciones ──
const cargarTimeline = async (clienteId) => {
  const eventos = [];

  const { data: solicitudes } = await supabase
    .from('cotizaciones')
    .select('id, codigo, estado, origen, created_at')
    .eq('cliente_id', clienteId);
  (solicitudes ?? []).forEach((s) => eventos.push({
    key: `sol-${s.id}`, fecha: s.created_at, tipo: 'solicitud', icono: FaClipboardList,
    titulo: `Solicitud ${s.codigo} (${ETIQUETA_ORIGEN[s.origen] ?? s.origen})`,
    detalle: `Estado: ${s.estado}`,
  }));

  const { data: pedidos } = await supabase
    .from('pedidos')
    .select('id, estado_comercial, estado_produccion, estado_pago, total, numero_boleta, canal, created_at')
    .eq('cliente_id', clienteId);
  const pedidoIds = (pedidos ?? []).map((p) => p.id);
  (pedidos ?? []).forEach((p) => eventos.push({
    key: `ped-${p.id}`, fecha: p.created_at, tipo: 'pedido', icono: FaFileInvoiceDollar,
    titulo: `${ETIQUETA_COMERCIAL[p.estado_comercial] ?? p.estado_comercial} #${p.id}${p.numero_boleta ? ` · ${p.numero_boleta}` : ''}`,
    detalle: `${fmtMonto(p.total)} · producción: ${p.estado_produccion} · pago: ${p.estado_pago}`,
    pedidoId: p.id,
  }));

  if (pedidoIds.length > 0) {
    const { data: pagos } = await supabase
      .from('pagos')
      .select('id, pedido_id, monto, metodo_pago, created_at')
      .in('pedido_id', pedidoIds);
    (pagos ?? []).forEach((pg) => eventos.push({
      key: `pag-${pg.id}`, fecha: pg.created_at, tipo: 'pago', icono: FaMoneyBillWave,
      titulo: `Pago de ${fmtMonto(pg.monto)} (${pg.metodo_pago})`,
      detalle: `Pedido #${pg.pedido_id}`,
      pedidoId: pg.pedido_id,
    }));

    const { data: devoluciones } = await supabase
      .from('devoluciones')
      .select('id, pedido_id, motivo, monto, efecto, metodo_pago, creado_en')
      .in('pedido_id', pedidoIds);
    (devoluciones ?? []).forEach((d) => eventos.push({
      key: `dev-${d.id}`, fecha: d.creado_en, tipo: 'devolucion', icono: FaUndoAlt,
      titulo: d.efecto === 'descuento_saldo'
        ? `Devolución — ${fmtMonto(d.monto)} descontado del saldo`
        : `Devolución — ${fmtMonto(d.monto)} reembolsado${d.metodo_pago ? ` (${d.metodo_pago})` : ''}`,
      detalle: `Pedido #${d.pedido_id} · ${d.motivo}`,
      pedidoId: d.pedido_id,
    }));
  }

  return eventos.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
};

// ── Seguimientos y bitácora de contacto (Bloque A CRM) ──
const cargarSeguimientos = async (clienteId) => {
  const { data } = await supabase
    .from('seguimientos')
    .select('id, nota, vence_en, estado, hecho_en')
    .eq('cliente_id', clienteId)
    .order('vence_en', { ascending: true });
  return data ?? [];
};

const cargarNotasContacto = async (clienteId) => {
  const { data } = await supabase
    .from('cliente_notas')
    .select('id, nota, creado_en, profiles!cliente_notas_creado_por_fkey(nombre)')
    .eq('cliente_id', clienteId)
    .order('creado_en', { ascending: false });
  return data ?? [];
};

// ── Formulario de cliente (crear/editar vía fn_guardar_cliente) ──
const FormCliente = ({ inicial, onGuardado, onCancelar }) => {
  const [form, setForm]           = useState({ ...CLIENTE_VACIO, ...inicial });
  const [nuevaEtiqueta, setNuevaEtiqueta] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError]         = useState('');

  const set = (campo, valor) => setForm((f) => ({ ...f, [campo]: valor }));

  const agregarEtiqueta = (e) => {
    e.preventDefault();
    const limpia = nuevaEtiqueta.trim();
    if (!limpia || (form.etiquetas ?? []).includes(limpia)) { setNuevaEtiqueta(''); return; }
    set('etiquetas', [...(form.etiquetas ?? []), limpia]);
    setNuevaEtiqueta('');
  };
  const quitarEtiqueta = (tag) => set('etiquetas', (form.etiquetas ?? []).filter((t) => t !== tag));

  const guardar = async (e) => {
    e.preventDefault();
    if (!esTelefonoValido(form.telefono)) {
      setError('El teléfono debe tener 9 dígitos (celular de Perú).');
      return;
    }
    setGuardando(true);
    setError('');
    const { data, error: err } = await supabase.rpc('fn_guardar_cliente', {
      p_cliente: { ...form, id: inicial?.id ?? null },
    });
    setGuardando(false);
    if (err) {
      setError(err.message?.includes('TELEFONO_DUPLICADO')
        ? 'Ya existe un cliente con ese teléfono.'
        : 'No se pudo guardar el cliente.');
      return;
    }
    onGuardado(data);
  };

  return (
    <form className="cli-form" onSubmit={guardar}>
      <div className="cli-form__grid">
        <label className="cli-flabel">Nombre *
          <input className="cli-input" value={form.nombre} onChange={(e) => set('nombre', e.target.value)} required />
        </label>
        <label className="cli-flabel">Teléfono *
          <input className="cli-input" type="tel" inputMode="numeric" maxLength={9}
            value={form.telefono} onChange={(e) => set('telefono', soloDigitos9(e.target.value))} required />
        </label>
        <label className="cli-flabel">Tipo
          <select className="cli-input" value={form.tipo} onChange={(e) => set('tipo', e.target.value)}>
            <option value="persona">Persona</option>
            <option value="empresa">Empresa</option>
          </select>
        </label>
        <label className="cli-flabel">DNI
          <input className="cli-input" value={form.dni ?? ''} onChange={(e) => set('dni', e.target.value)} />
        </label>
        {form.tipo === 'empresa' && (
          <>
            <label className="cli-flabel">RUC
              <input className="cli-input" value={form.ruc ?? ''} onChange={(e) => set('ruc', e.target.value)} />
            </label>
            <label className="cli-flabel">Razón social
              <input className="cli-input" value={form.razon_social ?? ''} onChange={(e) => set('razon_social', e.target.value)} />
            </label>
          </>
        )}
        <label className="cli-flabel">Correo
          <input className="cli-input" type="email" value={form.email ?? ''} onChange={(e) => set('email', e.target.value)} />
        </label>
        <label className="cli-flabel">Dirección
          <input className="cli-input" value={form.direccion ?? ''} onChange={(e) => set('direccion', e.target.value)} />
        </label>
      </div>
      <label className="cli-flabel">Notas
        <textarea className="cli-input cli-input--area" rows={3} value={form.notas ?? ''} onChange={(e) => set('notas', e.target.value)} />
      </label>
      <div className="cli-flabel">Etiquetas
        <div className="cli-chips">
          {(form.etiquetas ?? []).map((tag) => (
            <span key={tag} className="cli-chip">
              {tag}
              <button type="button" onClick={() => quitarEtiqueta(tag)} aria-label={`Quitar ${tag}`}><FaTimes /></button>
            </span>
          ))}
          <input
            className="cli-chip-input"
            placeholder="colegio, mayorista, vip…"
            value={nuevaEtiqueta}
            onChange={(e) => setNuevaEtiqueta(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') agregarEtiqueta(e); }}
          />
        </div>
      </div>
      {error && <p className="cli-error">{error}</p>}
      <div className="cli-form__foot">
        <button type="button" className="cli-btn" onClick={onCancelar} disabled={guardando}>Cancelar</button>
        <button type="submit" className="cli-btn cli-btn--primary" disabled={guardando}>
          {guardando ? <><FaSpinner className="cli-spin" /> Guardando…</> : <><FaCheckCircle /> Guardar</>}
        </button>
      </div>
    </form>
  );
};

// ── Recontacto manual por WhatsApp (Bloque C: mensaje editable) ──
const ModalRecontacto = ({ cliente, miEmpresa, onClose }) => {
  const [mensaje, setMensaje] = useState(
    `Hola ${cliente.nombre}, en ${miEmpresa || 'nuestra tienda'} tenemos novedades…`
  );
  const numero = (cliente.telefono ?? '').replace(/\D/g, '');
  const wa = `https://wa.me/51${numero}?text=${encodeURIComponent(mensaje)}`;

  // Accesibilidad del modal: foco inicial, trampa de Tab y Escape para cerrar.
  const dialogRef = useRef(null);
  const focoPrevioRef = useRef(null);
  useEffect(() => {
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
  }, []);

  return (
    <div className="cli-modal-overlay" onClick={onClose}>
      <div className="cli-modal-dialog" ref={dialogRef} role="dialog" aria-modal="true"
        aria-labelledby="cli-modal-title" onClick={(e) => e.stopPropagation()}>
        <div className="cli-modal-head">
          <h3 className="cli-modal-title" id="cli-modal-title"><FaWhatsapp /> Recontactar a {cliente.nombre}</h3>
          <button className="cli-modal-close" onClick={onClose} aria-label="Cerrar"><FaTimes /></button>
        </div>
        <label className="cli-flabel">Mensaje
          <textarea
            className="cli-input cli-input--area" rows={4}
            value={mensaje} onChange={(e) => setMensaje(e.target.value)}
          />
        </label>
        <div className="cli-form__foot">
          <button className="cli-btn" onClick={onClose}>Cancelar</button>
          <a
            className="cli-btn cli-btn--primary"
            href={wa} target="_blank" rel="noopener noreferrer"
            onClick={onClose}
          >
            <FaWhatsapp /> Enviar por WhatsApp
          </a>
        </div>
      </div>
    </div>
  );
};

const Clientes = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [busqueda, setBusqueda]         = useState('');
  const [etiquetaFiltro, setEtiquetaFiltro] = useState('');
  const [diasInactivo, setDiasInactivo] = useState('');
  const [resultados, setResultados]     = useState([]);
  const [cargandoLista, setCargandoLista] = useState(true);
  const [recontacto, setRecontacto]     = useState(null); // cliente para wa.me
  const [miEmpresa, setMiEmpresa]       = useState('');
  const [seleccionado, setSeleccionado] = useState(null);
  const [timeline, setTimeline]         = useState([]);
  const [cargandoTl, setCargandoTl]     = useState(false);
  const [editando, setEditando]         = useState(false);
  const [creando, setCreando]           = useState(false);

  // Seguimientos + bitácora de contacto (Bloque A del CRM)
  const [seguimientos, setSeguimientos] = useState([]);
  const [notasContacto, setNotasContacto] = useState([]);
  const [modalSeguimiento, setModalSeguimiento] = useState(false);
  const [completando, setCompletando]   = useState(null); // seguimiento en curso de completarse
  const [notaResultado, setNotaResultado] = useState('');
  const [cancelando, setCancelando]     = useState(null); // seguimiento en curso de cancelarse
  const [motivoCancelacion, setMotivoCancelacion] = useState('');
  const [notaNueva, setNotaNueva]       = useState('');
  const [guardandoAccion, setGuardandoAccion] = useState(false);
  const [accionError, setAccionError]   = useState('');
  const peticionFichaRef = useRef(0);

  const buscar = useCallback(async (q, etiqueta, dias) => {
    setCargandoLista(true);
    const { data } = await supabase.rpc('fn_clientes_lista', {
      p_busqueda: q.trim() || null,
      p_etiqueta: etiqueta.trim() || null,
      p_dias_inactivo: dias ? parseInt(dias, 10) : null,
      p_limit: 30,
    });
    setResultados(data ?? []);
    setCargandoLista(false);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => buscar(busqueda, etiquetaFiltro, diasInactivo), 300);
    return () => clearTimeout(t);
  }, [busqueda, etiquetaFiltro, diasInactivo, buscar]);

  useEffect(() => {
    supabase.from('empresa_config').select('nombre_empresa').eq('id', 1).maybeSingle()
      .then(({ data }) => setMiEmpresa(data?.nombre_empresa ?? ''));
  }, []);

  const abrirFicha = async (cliente) => {
    const hayCambios = editando || creando || completando || cancelando || notaNueva.trim();
    if (hayCambios && !window.confirm('Hay cambios sin guardar en la ficha actual. ¿Descartarlos y continuar?')) return;

    const miPeticion = ++peticionFichaRef.current;
    setSeleccionado(cliente);
    setEditando(false);
    setCreando(false);
    setCompletando(null);
    setCancelando(null);
    setNotaNueva('');
    setAccionError('');
    setCargandoTl(true);
    try {
      const [tl, seg, notas] = await Promise.all([
        cargarTimeline(cliente.id),
        cargarSeguimientos(cliente.id),
        cargarNotasContacto(cliente.id),
      ]);
      if (miPeticion !== peticionFichaRef.current) return; // el usuario ya abrió otra ficha
      setTimeline(tl);
      setSeguimientos(seg);
      setNotasContacto(notas);
    } catch {
      if (miPeticion === peticionFichaRef.current) setAccionError('No se pudo cargar el historial completo del cliente.');
    } finally {
      if (miPeticion === peticionFichaRef.current) setCargandoTl(false);
    }
  };

  const recargarCliente = async (id) => {
    const { data } = await supabase.from('clientes').select('*').eq('id', id).single();
    if (data) {
      setSeleccionado(data);
      buscar(busqueda, etiquetaFiltro, diasInactivo);
    }
  };

  // Deep-link ?cliente=ID — usado por el widget "Pendientes de hoy" y la campanita.
  useEffect(() => {
    const idParam = searchParams.get('cliente');
    if (!idParam) return;
    (async () => {
      const { data } = await supabase.from('clientes').select('*').eq('id', idParam).single();
      if (data) abrirFicha(data);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const recargarSeguimientosYNotas = async () => {
    if (!seleccionado) return;
    const [seg, notas] = await Promise.all([
      cargarSeguimientos(seleccionado.id),
      cargarNotasContacto(seleccionado.id),
    ]);
    setSeguimientos(seg);
    setNotasContacto(notas);
  };

  const completarSeguimiento = async (id) => {
    setGuardandoAccion(true);
    const { error } = await supabase.rpc('fn_completar_seguimiento', {
      p_id: id, p_nota_resultado: notaResultado.trim() || null,
    });
    setGuardandoAccion(false);
    if (error) { setAccionError('No se pudo completar el seguimiento.'); return; }
    setAccionError('');
    setCompletando(null);
    setNotaResultado('');
    recargarSeguimientosYNotas();
  };

  const cancelarSeguimiento = async (id) => {
    if (!motivoCancelacion.trim()) return;
    setGuardandoAccion(true);
    const { error } = await supabase.rpc('fn_cancelar_seguimiento', {
      p_id: id, p_motivo: motivoCancelacion.trim(),
    });
    setGuardandoAccion(false);
    if (error) { setAccionError('No se pudo cancelar el seguimiento.'); return; }
    setAccionError('');
    setCancelando(null);
    setMotivoCancelacion('');
    recargarSeguimientosYNotas();
  };

  const agregarNota = async (e) => {
    e.preventDefault();
    if (!notaNueva.trim() || !seleccionado) return;
    setGuardandoAccion(true);
    const { error } = await supabase.rpc('fn_agregar_nota_cliente', {
      p_cliente_id: seleccionado.id, p_nota: notaNueva.trim(),
    });
    setGuardandoAccion(false);
    if (error) { setAccionError('No se pudo guardar la nota.'); return; }
    setAccionError('');
    setNotaNueva('');
    recargarSeguimientosYNotas();
  };

  const seguimientosPendientes = seguimientos.filter((s) => s.estado === 'pendiente');
  const seguimientosCerrados   = seguimientos.filter((s) => s.estado !== 'pendiente');

  return (
    <div className="cli">
      <div className="cli-head">
        <div>
          <h2 className="cli-title">Clientes</h2>
          <p className="cli-subtitle">Seguimiento de punta a punta: el teléfono es el identificador.</p>
        </div>
        <button className="cli-btn cli-btn--primary" onClick={() => {
          const hayCambios = editando || creando || completando || cancelando || notaNueva.trim();
          if (hayCambios && !window.confirm('Hay cambios sin guardar en la ficha actual. ¿Descartarlos y continuar?')) return;
          setCreando(true); setSeleccionado(null); setEditando(false);
        }}>
          <FaPlus /> Nuevo cliente
        </button>
      </div>

      <div className="cli-layout">
        {/* Columna izquierda: buscador y lista */}
        <div className="cli-lista">
          <div className="cli-search">
            <FaSearch className="cli-search__icon" />
            <input
              className="cli-search__input"
              placeholder="Buscar por teléfono o nombre…"
              aria-label="Buscar por teléfono o nombre"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
            />
          </div>
          <div className="cli-filtros">
            <div className="cli-filtro-tag">
              <FaTag className="cli-filtro-tag__icon" />
              <input
                className="cli-filtro-tag__input"
                placeholder="Filtrar por etiqueta…"
                aria-label="Filtrar por etiqueta"
                value={etiquetaFiltro}
                onChange={(e) => setEtiquetaFiltro(e.target.value)}
              />
            </div>
            <select className="cli-filtro-select" aria-label="Filtrar por inactividad" value={diasInactivo} onChange={(e) => setDiasInactivo(e.target.value)}>
              <option value="">Todos</option>
              <option value="30">Inactivos +30 días</option>
              <option value="60">Inactivos +60 días</option>
              <option value="90">Inactivos +90 días</option>
              <option value="180">Inactivos +180 días</option>
            </select>
          </div>
          {cargandoLista ? (
            <div className="cli-loading"><FaSpinner className="cli-spin" /> Buscando…</div>
          ) : resultados.length === 0 ? (
            <p className="cli-hint">Sin resultados{busqueda ? ` para "${busqueda}"` : ''}.</p>
          ) : (
            <ul className="cli-items">
              {resultados.map((c) => (
                <li key={c.id} className="cli-item-row">
                  <button
                    className={`cli-item ${seleccionado?.id === c.id ? 'cli-item--on' : ''}`}
                    onClick={() => abrirFicha(c)}
                  >
                    <span className="cli-item__avatar">
                      {c.tipo === 'empresa' ? <FaBuilding /> : (c.nombre?.charAt(0).toUpperCase() ?? '?')}
                    </span>
                    <span className="cli-item__meta">
                      <span className="cli-item__nombre">
                        {c.nombre}
                        {etiquetaRelacion(c.num_pedidos) && (
                          <span className={`cli-relacion ${etiquetaRelacion(c.num_pedidos).clase}`}>
                            {etiquetaRelacion(c.num_pedidos).label}
                          </span>
                        )}
                      </span>
                      <span className="cli-item__tel">{c.telefono}</span>
                      <span className="cli-item__stats">
                        {c.ultima_compra
                          ? <><FaShoppingBag /> {fmtFechaCorta(c.ultima_compra)} · {c.num_pedidos} ped. · {soles(c.total_historico)}</>
                          : <span className="cli-item__stats--sin">Sin compras</span>}
                      </span>
                      {(c.etiquetas ?? []).length > 0 && (
                        <span className="cli-item__tags">
                          {c.etiquetas.map((tag) => <span key={tag} className="cli-chip cli-chip--sm">{tag}</span>)}
                        </span>
                      )}
                    </span>
                  </button>
                  {c.telefono && (
                    <button className="cli-item__wa" title="Recontactar por WhatsApp"
                      aria-label={`Recontactar a ${c.nombre} por WhatsApp`} onClick={() => setRecontacto(c)}>
                      <FaWhatsapp />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Columna derecha: ficha */}
        <div className="cli-ficha">
          {creando && (
            <div className="cli-card">
              <h3 className="cli-card__title"><FaPlus /> Nuevo cliente</h3>
              <FormCliente
                inicial={null}
                onCancelar={() => setCreando(false)}
                onGuardado={(id) => { setCreando(false); recargarCliente(id); }}
              />
            </div>
          )}

          {!creando && !seleccionado && (
            <div className="cli-vacio">
              <FaUser className="cli-vacio__icon" />
              <p>Busca un cliente para ver su ficha y su historial completo.</p>
            </div>
          )}

          {!creando && seleccionado && (
            <>
              {accionError && <p className="cli-error" role="alert">{accionError}</p>}
              <div className="cli-card">
                <div className="cli-ficha__head">
                  <div className="cli-ficha__id">
                    <span className="cli-ficha__avatar">
                      {seleccionado.tipo === 'empresa' ? <FaBuilding /> : (seleccionado.nombre?.charAt(0).toUpperCase() ?? '?')}
                    </span>
                    <div>
                      <h3 className="cli-ficha__nombre">
                        {seleccionado.nombre}
                        {etiquetaRelacion(timeline.filter((e) => e.tipo === 'pedido').length) && (
                          <span className={`cli-relacion ${etiquetaRelacion(timeline.filter((e) => e.tipo === 'pedido').length).clase}`}>
                            {etiquetaRelacion(timeline.filter((e) => e.tipo === 'pedido').length).label}
                          </span>
                        )}
                      </h3>
                      <span className="cli-ficha__tipo">{seleccionado.tipo === 'empresa' ? 'Empresa' : 'Persona'}</span>
                    </div>
                  </div>
                  {!editando && (
                    <div className="cli-ficha__acciones">
                      <button className="cli-btn" onClick={() => setModalSeguimiento(true)}>
                        <FaCalendarPlus /> Programar seguimiento
                      </button>
                      <button className="cli-btn" onClick={() => setEditando(true)}><FaEdit /> Editar</button>
                    </div>
                  )}
                </div>

                {editando ? (
                  <FormCliente
                    inicial={seleccionado}
                    onCancelar={() => setEditando(false)}
                    onGuardado={(id) => { setEditando(false); recargarCliente(id); }}
                  />
                ) : (
                  <div className="cli-datos">
                    <span className="cli-dato"><FaPhoneAlt /> {seleccionado.telefono}</span>
                    {seleccionado.dni && <span className="cli-dato"><FaIdCard /> DNI {seleccionado.dni}</span>}
                    {seleccionado.ruc && <span className="cli-dato"><FaIdCard /> RUC {seleccionado.ruc}</span>}
                    {seleccionado.razon_social && <span className="cli-dato"><FaBuilding /> {seleccionado.razon_social}</span>}
                    {seleccionado.email && <span className="cli-dato"><FaEnvelope /> {seleccionado.email}</span>}
                    {seleccionado.direccion && <span className="cli-dato"><FaMapMarkerAlt /> {seleccionado.direccion}</span>}
                    {(seleccionado.etiquetas ?? []).length > 0 && (
                      <span className="cli-chips">
                        {seleccionado.etiquetas.map((tag) => <span key={tag} className="cli-chip">{tag}</span>)}
                      </span>
                    )}
                    {seleccionado.notas && <p className="cli-notas">{seleccionado.notas}</p>}
                    {timeline.some((e) => e.tipo === 'pedido') && camposFaltantes(seleccionado).length > 0 && (
                      <p className="cli-perfil-incompleto">
                        <FaExclamationCircle /> Perfil incompleto — faltan: {camposFaltantes(seleccionado).join(', ')}.
                      </p>
                    )}
                  </div>
                )}
              </div>

              <div className="cli-card">
                <h3 className="cli-card__title">Seguimientos</h3>
                {seguimientosPendientes.length === 0 && seguimientosCerrados.length === 0 ? (
                  <p className="cli-hint">Sin seguimientos programados. Usa "Programar seguimiento" para no perder el contacto.</p>
                ) : (
                  <ul className="cli-seg-list">
                    {seguimientosPendientes.map((s) => {
                      const vencido = estaVencido(s.vence_en);
                      return (
                        <li key={s.id} className={`cli-seg ${vencido ? 'cli-seg--vencido' : ''}`}>
                          <div className="cli-seg__cabeza">
                            {vencido && <FaExclamationCircle className="cli-seg__alerta" />}
                            <span className="cli-seg__fecha">{fmtFecha(s.vence_en)}</span>
                          </div>
                          <p className="cli-seg__nota">{s.nota}</p>
                          {completando === s.id ? (
                            <div className="cli-seg__form">
                              <textarea
                                className="cli-input cli-input--area" rows={2}
                                placeholder="Resultado (opcional): qué se acordó…"
                                value={notaResultado}
                                onChange={(e) => setNotaResultado(e.target.value)}
                              />
                              <div className="cli-seg__form-acciones">
                                <button className="cli-btn" onClick={() => { setCompletando(null); setNotaResultado(''); }} disabled={guardandoAccion}>Volver</button>
                                <button className="cli-btn cli-btn--primary" onClick={() => completarSeguimiento(s.id)} disabled={guardandoAccion}>
                                  {guardandoAccion ? <FaSpinner className="cli-spin" /> : <FaCheckCircle />} Confirmar
                                </button>
                              </div>
                            </div>
                          ) : cancelando === s.id ? (
                            <div className="cli-seg__form">
                              <textarea
                                className="cli-input cli-input--area" rows={2}
                                placeholder="Motivo de cancelación (obligatorio)…"
                                value={motivoCancelacion}
                                onChange={(e) => setMotivoCancelacion(e.target.value)}
                                required
                              />
                              <div className="cli-seg__form-acciones">
                                <button className="cli-btn" onClick={() => { setCancelando(null); setMotivoCancelacion(''); }} disabled={guardandoAccion}>Volver</button>
                                <button className="cli-btn cli-btn--danger" onClick={() => cancelarSeguimiento(s.id)} disabled={guardandoAccion || !motivoCancelacion.trim()}>
                                  {guardandoAccion ? <FaSpinner className="cli-spin" /> : <FaBan />} Confirmar cancelación
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="cli-seg__acciones">
                              <button className="cli-btn cli-btn--sm" onClick={() => setCompletando(s.id)}><FaCheckCircle /> Completar</button>
                              <button className="cli-btn cli-btn--sm" onClick={() => setCancelando(s.id)}><FaBan /> Cancelar</button>
                            </div>
                          )}
                        </li>
                      );
                    })}
                    {seguimientosCerrados.map((s) => (
                      <li key={s.id} className="cli-seg cli-seg--cerrado">
                        <div className="cli-seg__cabeza">
                          <span className={`cli-seg__badge cli-seg__badge--${s.estado}`}>{s.estado === 'hecho' ? 'Hecho' : 'Cancelado'}</span>
                          <span className="cli-seg__fecha">{fmtFechaCorta(s.hecho_en ?? s.vence_en)}</span>
                        </div>
                        <p className="cli-seg__nota">{s.nota}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="cli-card">
                <h3 className="cli-card__title"><FaStickyNote /> Notas de contacto</h3>
                <form className="cli-nota-form" onSubmit={agregarNota}>
                  <textarea
                    className="cli-input cli-input--area" rows={2}
                    placeholder="Ej: Llamé, queda en confirmar el viernes…"
                    value={notaNueva}
                    onChange={(e) => setNotaNueva(e.target.value)}
                  />
                  <button className="cli-btn cli-btn--primary" type="submit" disabled={guardandoAccion || !notaNueva.trim()}>
                    {guardandoAccion ? <FaSpinner className="cli-spin" /> : <FaPlus />} Agregar
                  </button>
                </form>
                {notasContacto.length === 0 ? (
                  <p className="cli-hint">Sin notas de contacto todavía.</p>
                ) : (
                  <ul className="cli-nota-list">
                    {notasContacto.map((n) => (
                      <li key={n.id} className="cli-nota-item">
                        <p className="cli-nota-item__texto">{n.nota}</p>
                        <span className="cli-nota-item__meta">
                          {n.profiles?.nombre ?? 'Staff'} · {fmtFecha(n.creado_en)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="cli-card">
                <h3 className="cli-card__title">Línea de tiempo</h3>
                {cargandoTl ? (
                  <div className="cli-loading"><FaSpinner className="cli-spin" /> Cargando historial…</div>
                ) : timeline.length === 0 ? (
                  <p className="cli-hint">Este cliente aún no tiene actividad registrada.</p>
                ) : (
                  <ul className="cli-tl">
                    {timeline.map((ev) => {
                      const Icono = ev.icono;
                      return (
                        <li key={ev.key} className={`cli-tl__item cli-tl__item--${ev.tipo}`}>
                          <span className="cli-tl__icon"><Icono /></span>
                          <div className="cli-tl__body">
                            {ev.pedidoId ? (
                              <button
                                className="cli-tl__titulo cli-tl__titulo--link"
                                onClick={() => navigate(`/dashboard/pedidos?tab=produccion&pedido=${ev.pedidoId}`)}
                              >
                                {ev.titulo}
                              </button>
                            ) : (
                              <span className="cli-tl__titulo">{ev.titulo}</span>
                            )}
                            <span className="cli-tl__detalle">{ev.detalle}</span>
                            <span className="cli-tl__fecha">{fmtFecha(ev.fecha)}</span>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {modalSeguimiento && seleccionado && (
        <ModalSeguimiento
          cliente={seleccionado}
          contextoLabel={`Ficha de ${seleccionado.nombre}`}
          onClose={() => setModalSeguimiento(false)}
          onCreado={() => { setModalSeguimiento(false); recargarSeguimientosYNotas(); }}
        />
      )}
      {recontacto && (
        <ModalRecontacto cliente={recontacto} miEmpresa={miEmpresa} onClose={() => setRecontacto(null)} />
      )}
    </div>
  );
};

export default Clientes;
