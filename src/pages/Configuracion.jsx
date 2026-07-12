import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  FaStore, FaWhatsapp, FaUsers, FaTags, FaPlus, FaTrash, FaMapMarkerAlt,
  FaSpinner, FaCheckCircle, FaUserPlus, FaBullhorn, FaEdit, FaImage,
  FaTasks, FaHistory, FaShieldAlt,
} from 'react-icons/fa';
import { supabase } from '../supabase/client';
import { useAuth } from '../context/AuthContext';
import { MENSAJE_AAL2_REQUERIDO, esErrorAal2 } from '../lib/mensajesError';
import { mensajeError } from '../lib/errores';
import './Configuracion.css';

const BUCKET = 'productos_uploads';

const ETIQUETA_ROL = { admin: 'Administrador', disenador: 'Diseñador', operario: 'Operario' };

const TABS_VALIDOS = ['empresa', 'redes', 'usuarios', 'categorias', 'promos', 'roles', 'actividad'];

const Configuracion = () => {
  const [searchParams] = useSearchParams();
  const tabInicial = TABS_VALIDOS.includes(searchParams.get('tab')) ? searchParams.get('tab') : 'empresa';
  const [tab, setTab] = useState(tabInicial);

  return (
    <div className="cfg">
      <div className="cfg-head">
        <h2 className="cfg-title">Configuración del sistema</h2>
        <p className="cfg-subtitle">Administra el perfil de la empresa, integraciones y el equipo de trabajo.</p>
      </div>

      <div className="cfg-tabs">
        <button className={`cfg-tab ${tab === 'empresa' ? 'cfg-tab--on' : ''}`} onClick={() => setTab('empresa')}>
          <FaStore /> Perfil de empresa
        </button>
        <button className={`cfg-tab ${tab === 'redes' ? 'cfg-tab--on' : ''}`} onClick={() => setTab('redes')}>
          <FaWhatsapp /> Redes y WhatsApp
        </button>
        <button className={`cfg-tab ${tab === 'usuarios' ? 'cfg-tab--on' : ''}`} onClick={() => setTab('usuarios')}>
          <FaUsers /> Usuarios y roles
        </button>
        <button className={`cfg-tab ${tab === 'categorias' ? 'cfg-tab--on' : ''}`} onClick={() => setTab('categorias')}>
          <FaTags /> Categorías
        </button>
        <button className={`cfg-tab ${tab === 'promos' ? 'cfg-tab--on' : ''}`} onClick={() => setTab('promos')}>
          <FaBullhorn /> Promociones
        </button>
        <button className={`cfg-tab ${tab === 'roles' ? 'cfg-tab--on' : ''}`} onClick={() => setTab('roles')}>
          <FaTasks /> Roles, etapas y módulos
        </button>
        <button className={`cfg-tab ${tab === 'actividad' ? 'cfg-tab--on' : ''}`} onClick={() => setTab('actividad')}>
          <FaHistory /> Actividad
        </button>
      </div>

      {tab === 'empresa'    && <><TabEmpresa /><TabLocalPrincipal /></>}
      {tab === 'redes'      && <TabRedes />}
      {tab === 'usuarios'   && <TabUsuarios etiquetaRol={ETIQUETA_ROL} />}
      {tab === 'categorias' && <TabCategorias />}
      {tab === 'promos'     && <TabPromociones />}
      {tab === 'roles'      && <><TabRolesEtapas /><TabModulos /></>}
      {tab === 'actividad'  && <TabActividad />}
    </div>
  );
};

// ── Helper de carga de empresa_config (id=1) ──
const useEmpresaConfig = () => {
  const [config, setConfig] = useState(null);
  useEffect(() => {
    supabase.from('empresa_config').select('*').eq('id', 1).maybeSingle()
      .then(({ data }) => setConfig(data ?? { id: 1 }));
  }, []);
  return [config, setConfig];
};

// ── TAB: PERFIL DE EMPRESA ──
const TabEmpresa = () => {
  const [config, setConfig] = useEmpresaConfig();
  const [guardando, setGuardando] = useState(false);
  const [ok, setOk]               = useState(false);

  if (!config) return <div className="cfg-loading"><FaSpinner className="cfg-spin" /> Cargando…</div>;

  const set = (campo, valor) => setConfig((c) => ({ ...c, [campo]: valor }));

  const guardar = async (e) => {
    e.preventDefault();
    setGuardando(true);
    setOk(false);
    // Escritura vía RPC (SECURITY DEFINER): las tablas no aceptan UPDATE directo.
    const { error } = await supabase.rpc('fn_admin_guardar_config', {
      p_config: {
        nombre_empresa:        config.nombre_empresa,
        razon_social:          config.razon_social,
        ruc:                   config.ruc,
        adelanto_minimo_pct:   config.adelanto_minimo_pct ?? 50,
        cotizacion_aviso_dias: config.cotizacion_aviso_dias ?? 3,
      },
    });
    setGuardando(false);
    if (error) { console.error(error); alert(esErrorAal2(error) ? MENSAJE_AAL2_REQUERIDO : 'No se pudo guardar. ¿Tienes permisos de admin?'); return; }
    setOk(true);
  };

  return (
    <form className="cfg-card cfg-empresa" onSubmit={guardar}>
      <div className="cfg-fields">
        <div className="cfg-grid2">
          <label className="cfg-flabel">Nombre comercial
            <input className="cfg-input" value={config.nombre_empresa ?? ''} onChange={(e) => set('nombre_empresa', e.target.value)} required />
          </label>
          <label className="cfg-flabel">Razón social
            <input className="cfg-input" value={config.razon_social ?? ''} onChange={(e) => set('razon_social', e.target.value)} />
          </label>
        </div>
        <label className="cfg-flabel">RUC
          <input className="cfg-input" value={config.ruc ?? ''} onChange={(e) => set('ruc', e.target.value)} />
        </label>
        <label className="cfg-flabel">Adelanto mínimo para aceptar cotizaciones (%)
          <input className="cfg-input" type="number" min="0" max="100"
            value={config.adelanto_minimo_pct ?? 50}
            onChange={(e) => set('adelanto_minimo_pct', e.target.value === '' ? '' : parseInt(e.target.value))} />
          <span className="cfg-hint">0 = aceptar sin exigir pago inicial. La regla se valida en el servidor al aceptar.</span>
        </label>
        <label className="cfg-flabel">Aviso: cotización sin actividad (días)
          <input className="cfg-input" type="number" min="1"
            value={config.cotizacion_aviso_dias ?? 3}
            onChange={(e) => set('cotizacion_aviso_dias', e.target.value === '' ? '' : parseInt(e.target.value))} />
          <span className="cfg-hint">Badge de alerta en cotizaciones abiertas.</span>
        </label>
      </div>

      <div className="cfg-card__foot">
        {ok && <span className="cfg-ok"><FaCheckCircle /> Cambios guardados</span>}
        <button type="submit" className="cfg-btn cfg-btn--primary" disabled={guardando}>
          {guardando ? <><FaSpinner className="cfg-spin" /> Guardando…</> : 'Guardar cambios'}
        </button>
      </div>
    </form>
  );
};

// Local Principal (id=1): su dirección alimenta el mapa del catálogo público; antes no era editable desde el panel.
const TabLocalPrincipal = () => {
  const [local, setLocal]         = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [ok, setOk]               = useState(false);
  const [error, setError]         = useState('');

  useEffect(() => {
    supabase.from('locales').select('id, nombre, direccion, lat, lng').eq('id', 1).maybeSingle()
      .then(({ data }) => setLocal(data));
  }, []);

  if (!local) return <div className="cfg-loading"><FaSpinner className="cfg-spin" /> Cargando…</div>;

  const set = (campo, valor) => setLocal((l) => ({ ...l, [campo]: valor }));

  const guardar = async (e) => {
    e.preventDefault();
    setGuardando(true);
    setOk(false);
    setError('');
    const { error: err } = await supabase.rpc('fn_admin_editar_local', {
      p_id: local.id, p_nombre: local.nombre, p_direccion: local.direccion,
      p_lat: local.lat === '' ? null : local.lat,
      p_lng: local.lng === '' ? null : local.lng,
    });
    setGuardando(false);
    if (err) { setError(esErrorAal2(err) ? MENSAJE_AAL2_REQUERIDO : 'No se pudo guardar (requiere admin).'); return; }
    setOk(true);
  };

  return (
    <form className="cfg-card" onSubmit={guardar}>
      <h3 className="cfg-card__title"><FaMapMarkerAlt /> Ubicación del local</h3>
      <p className="cfg-hint">
        La dirección se muestra en el catálogo. Las coordenadas ubican el pin exacto en el mapa —
        búscalas en Google Maps: click derecho sobre el punto exacto y copia el par que aparece arriba.
      </p>
      <div className="cfg-grid2">
        <label className="cfg-flabel">Nombre del local
          <input className="cfg-input" value={local.nombre ?? ''} onChange={(e) => set('nombre', e.target.value)} required />
        </label>
        <label className="cfg-flabel">Dirección
          <input className="cfg-input" value={local.direccion ?? ''} onChange={(e) => set('direccion', e.target.value)} required />
        </label>
        <label className="cfg-flabel">Latitud
          <input className="cfg-input" type="number" step="any" placeholder="-11.863808"
            value={local.lat ?? ''} onChange={(e) => set('lat', e.target.value === '' ? '' : parseFloat(e.target.value))} />
        </label>
        <label className="cfg-flabel">Longitud
          <input className="cfg-input" type="number" step="any" placeholder="-77.076860"
            value={local.lng ?? ''} onChange={(e) => set('lng', e.target.value === '' ? '' : parseFloat(e.target.value))} />
        </label>
      </div>
      {error && <p className="cfg-error">{error}</p>}
      <div className="cfg-card__foot">
        {ok && <span className="cfg-ok"><FaCheckCircle /> Cambios guardados</span>}
        <button type="submit" className="cfg-btn cfg-btn--primary" disabled={guardando}>
          {guardando ? <><FaSpinner className="cfg-spin" /> Guardando…</> : 'Guardar cambios'}
        </button>
      </div>
    </form>
  );
};

// ── TAB: REDES Y WHATSAPP ──
const TabRedes = () => {
  const [config, setConfig] = useEmpresaConfig();
  const [guardando, setGuardando] = useState(false);
  const [ok, setOk] = useState(false);

  if (!config) return <div className="cfg-loading"><FaSpinner className="cfg-spin" /> Cargando…</div>;

  const redes = config.redes_sociales ?? {};
  const setRed = (k, v) => setConfig((c) => ({ ...c, redes_sociales: { ...(c.redes_sociales ?? {}), [k]: v } }));

  const guardar = async (e) => {
    e.preventDefault();
    setGuardando(true);
    setOk(false);
    // Escritura vía RPC (SECURITY DEFINER): las tablas no aceptan UPDATE directo.
    const { error } = await supabase.rpc('fn_admin_guardar_config', {
      p_config: {
        whatsapp_oficial: config.whatsapp_oficial,
        redes_sociales:   config.redes_sociales ?? {},
      },
    });
    setGuardando(false);
    if (error) { console.error(error); alert(esErrorAal2(error) ? MENSAJE_AAL2_REQUERIDO : 'No se pudo guardar. ¿Permisos de admin?'); return; }
    setOk(true);
  };

  return (
    <form className="cfg-card" onSubmit={guardar}>
      <label className="cfg-flabel cfg-flabel--wsp">Número de WhatsApp para ventas
        <input
          className="cfg-input" type="tel" placeholder="Ej. 51999888777"
          value={config.whatsapp_oficial ?? ''}
          onChange={(e) => setConfig((c) => ({ ...c, whatsapp_oficial: e.target.value }))}
        />
        <span className="cfg-hint">Incluye el código de país (51 para Perú). Es el número al que se redirige el cierre por WhatsApp del catálogo.</span>
      </label>

      <div className="cfg-grid2">
        <label className="cfg-flabel">Instagram
          <input className="cfg-input" placeholder="@usuario o URL" value={redes.instagram ?? ''} onChange={(e) => setRed('instagram', e.target.value)} />
        </label>
        <label className="cfg-flabel">Facebook
          <input className="cfg-input" placeholder="URL de la página" value={redes.facebook ?? ''} onChange={(e) => setRed('facebook', e.target.value)} />
        </label>
        <label className="cfg-flabel">TikTok
          <input className="cfg-input" placeholder="@usuario o URL" value={redes.tiktok ?? ''} onChange={(e) => setRed('tiktok', e.target.value)} />
        </label>
      </div>

      <div className="cfg-card__foot">
        {ok && <span className="cfg-ok"><FaCheckCircle /> Cambios guardados</span>}
        <button type="submit" className="cfg-btn cfg-btn--primary" disabled={guardando}>
          {guardando ? <><FaSpinner className="cfg-spin" /> Guardando…</> : 'Guardar cambios'}
        </button>
      </div>
    </form>
  );
};

// ── TAB: USUARIOS Y ROLES ──
const TabUsuarios = ({ etiquetaRol }) => {
  const { perfil } = useAuth();
  const [usuarios, setUsuarios] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError]       = useState('');
  const [nuevo, setNuevo]       = useState({ nombre: '', email: '', password: '', rol: 'operario' });
  const [creando, setCreando]   = useState(false);
  // Editar nombre / restablecer contraseña (mejoras.txt §11, antes no existía forma de hacerlo).
  const [editando, setEditando]     = useState(null); // usuario en edición
  const [formEdit, setFormEdit]     = useState({ nombre: '', email: '', password: '' });
  const [guardandoEdit, setGuardandoEdit] = useState(false);
  const [errorEdit, setErrorEdit]   = useState('');
  // Eliminar = borrado real (distinto de "Desactivar"); bloqueado en servidor si tiene historial (fn_admin_eliminar_usuario).
  const [eliminando, setEliminando] = useState(null); // usuario a confirmar
  const [borrando, setBorrando]     = useState(false);
  const [errorEliminar, setErrorEliminar] = useState('');

  const cargar = async () => {
    const { data, error: err } = await supabase.rpc('fn_admin_list_usuarios');
    if (err) setError(esErrorAal2(err) ? MENSAJE_AAL2_REQUERIDO : 'No se pudo cargar la lista de usuarios (requiere admin).');
    else setUsuarios(data ?? []);
    setCargando(false);
  };
  useEffect(() => { cargar(); }, []);

  const cambiar = async (u, campo, valor) => {
    if (u.id === perfil?.id && !window.confirm(
      campo === 'activo' && !valor
        ? 'Estás por desactivar tu propia cuenta. Perderás acceso de inmediato. ¿Continuar?'
        : 'Estás por cambiar tu propio rol o estado. ¿Continuar?'
    )) return;
    const rol    = campo === 'rol'    ? valor : u.rol;
    const activo = campo === 'activo' ? valor : u.activo;
    setUsuarios((prev) => prev.map((x) => x.id === u.id ? { ...x, rol, activo } : x));
    const { error: err } = await supabase.rpc('fn_admin_set_usuario', { p_id: u.id, p_rol: rol, p_activo: activo });
    if (err) { alert(esErrorAal2(err) ? MENSAJE_AAL2_REQUERIDO : 'No se pudo actualizar el usuario.'); cargar(); }
  };

  const abrirEditar = (u) => {
    setEditando(u);
    setFormEdit({ nombre: u.nombre ?? '', email: u.email ?? '', password: '' });
    setErrorEdit('');
  };

  const guardarEdicion = async (e) => {
    e.preventDefault();
    setGuardandoEdit(true); setErrorEdit('');
    const body = { id: editando.id, nombre: formEdit.nombre.trim() };
    if (formEdit.email.trim() && formEdit.email.trim() !== editando.email) body.email = formEdit.email.trim();
    if (formEdit.password.trim()) body.password = formEdit.password.trim();
    const { data, error: err } = await supabase.functions.invoke('admin-editar-usuario', { body });
    setGuardandoEdit(false);
    if (err || data?.error) {
      const MENSAJE_ERR_EDICION = {
        PASSWORD_MUY_CORTA: 'La contraseña debe tener al menos 6 caracteres.',
        EMAIL_INVALIDO: 'El correo no tiene un formato válido.',
      };
      setErrorEdit(MENSAJE_ERR_EDICION[data?.error] ?? `No se pudo guardar: ${data?.error ?? err.message}`);
      return;
    }
    setEditando(null);
    cargar();
  };

  const eliminarUsuario = async () => {
    if (!eliminando) return;
    setBorrando(true); setErrorEliminar('');
    const { error: err } = await supabase.rpc('fn_admin_eliminar_usuario', { p_id: eliminando.id });
    setBorrando(false);
    if (err) { setErrorEliminar(esErrorAal2(err) ? MENSAJE_AAL2_REQUERIDO : mensajeError(err)); return; }
    setEliminando(null);
    cargar();
  };

  const crear = async (e) => {
    e.preventDefault();
    setCreando(true);
    setError('');
    const { data, error: err } = await supabase.functions.invoke('admin-crear-usuario', { body: nuevo });
    setCreando(false);
    if (err || data?.error) {
      setError(`No se pudo crear: ${data?.error ?? err.message}`);
      return;
    }
    setNuevo({ nombre: '', email: '', password: '', rol: 'operario' });
    cargar();
  };

  return (
    <div className="cfg-usuarios">
      {/* 2FA es automático y obligatorio: va como nota, no como pestaña propia */}
      <p className="cfg-hint cfg-hint--2fa">
        <FaShieldAlt /> Verificación en dos pasos (2FA) activa para todo el equipo: cada inicio de
        sesión pide un código de 6 dígitos enviado al correo de la cuenta.
      </p>

      {/* Crear usuario */}
      <form className="cfg-card cfg-newuser" onSubmit={crear}>
        <h3 className="cfg-card__title"><FaUserPlus /> Crear usuario</h3>
        <div className="cfg-grid2">
          <label className="cfg-flabel">Nombre
            <input className="cfg-input" value={nuevo.nombre} onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })} required />
          </label>
          <label className="cfg-flabel">Correo
            <input className="cfg-input" type="email" value={nuevo.email} onChange={(e) => setNuevo({ ...nuevo, email: e.target.value })} required />
          </label>
          <label className="cfg-flabel">Contraseña
            <input className="cfg-input" type="password" minLength={6} value={nuevo.password} onChange={(e) => setNuevo({ ...nuevo, password: e.target.value })} required />
          </label>
          <label className="cfg-flabel">Rol
            <select className="cfg-input" value={nuevo.rol} onChange={(e) => setNuevo({ ...nuevo, rol: e.target.value })}>
              <option value="operario">Operario</option>
              <option value="disenador">Diseñador</option>
              <option value="admin">Administrador</option>
            </select>
          </label>
        </div>
        {error && <p className="cfg-error">{error}</p>}
        <div className="cfg-card__foot">
          <button type="submit" className="cfg-btn cfg-btn--primary" disabled={creando}>
            {creando ? <><FaSpinner className="cfg-spin" /> Creando…</> : <><FaUserPlus /> Crear usuario</>}
          </button>
        </div>
      </form>

      {/* Lista de usuarios */}
      <div className="cfg-card">
        <h3 className="cfg-card__title"><FaUsers /> Equipo</h3>
        {cargando ? (
          <div className="cfg-loading"><FaSpinner className="cfg-spin" /> Cargando…</div>
        ) : (
          <table className="cfg-table">
            <thead>
              <tr><th>Usuario</th><th>Rol</th><th className="cfg-th--center">Activo</th><th className="cfg-th--center">Acciones</th></tr>
            </thead>
            <tbody>
              {usuarios.map((u) => (
                <tr key={u.id}>
                  <td className="cfg-user">
                    <span className="cfg-user__avatar">{u.nombre?.charAt(0).toUpperCase() ?? '?'}</span>
                    <span className="cfg-user__info">
                      <span className="cfg-user__name">{u.nombre}</span>
                      <span className="cfg-user__email">{u.email}</span>
                    </span>
                  </td>
                  <td>
                    <select className="cfg-rol" value={u.rol} onChange={(e) => cambiar(u, 'rol', e.target.value)}>
                      {Object.entries(etiquetaRol).map(([val, label]) => <option key={val} value={val}>{label}</option>)}
                    </select>
                  </td>
                  <td className="cfg-th--center">
                    <button
                      className={`cfg-switch ${u.activo ? 'cfg-switch--on' : ''}`}
                      onClick={() => cambiar(u, 'activo', !u.activo)}
                      aria-label={u.activo ? 'Desactivar' : 'Activar'}
                    >
                      <span className="cfg-switch__dot" />
                    </button>
                  </td>
                  <td className="cfg-th--center">
                    <div className="cfg-row-actions">
                      <button type="button" className="cfg-btn" onClick={() => abrirEditar(u)} aria-label={`Editar ${u.nombre}`}>
                        <FaEdit />
                      </button>
                      <button
                        type="button"
                        className="cfg-btn cfg-btn--danger"
                        onClick={() => setEliminando(u)}
                        disabled={u.id === perfil?.id}
                        title={u.id === perfil?.id ? 'No puedes eliminar tu propia cuenta' : undefined}
                        aria-label={`Eliminar ${u.nombre}`}
                      >
                        <FaTrash />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {usuarios.length === 0 && <tr><td colSpan={4} className="cfg-empty">Sin usuarios.</td></tr>}
            </tbody>
          </table>
        )}
      </div>

      {editando && (
        <div className="cfg-modal-overlay" onClick={() => setEditando(null)}>
          <form className="cfg-card cfg-modal" onClick={(e) => e.stopPropagation()} onSubmit={guardarEdicion}>
            <h3 className="cfg-card__title"><FaEdit /> Editar a {editando.nombre}</h3>
            <label className="cfg-flabel">Nombre
              <input className="cfg-input" value={formEdit.nombre}
                onChange={(e) => setFormEdit((f) => ({ ...f, nombre: e.target.value }))} required />
            </label>
            <label className="cfg-flabel">Correo
              <input className="cfg-input" type="email" value={formEdit.email}
                onChange={(e) => setFormEdit((f) => ({ ...f, email: e.target.value }))} required />
            </label>
            <label className="cfg-flabel">Nueva contraseña (opcional)
              <input className="cfg-input" type="password" minLength={6} placeholder="Dejar en blanco para no cambiarla"
                value={formEdit.password} onChange={(e) => setFormEdit((f) => ({ ...f, password: e.target.value }))} />
            </label>
            {errorEdit && <p className="cfg-error">{errorEdit}</p>}
            <div className="cfg-card__foot">
              <button type="button" className="cfg-btn" onClick={() => setEditando(null)} disabled={guardandoEdit}>Cancelar</button>
              <button type="submit" className="cfg-btn cfg-btn--primary" disabled={guardandoEdit}>
                {guardandoEdit ? <><FaSpinner className="cfg-spin" /> Guardando…</> : 'Guardar'}
              </button>
            </div>
          </form>
        </div>
      )}

      {eliminando && (
        <div className="cfg-modal-overlay" onClick={() => !borrando && setEliminando(null)}>
          <div className="cfg-card cfg-modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="cfg-card__title"><FaTrash /> Eliminar a {eliminando.nombre}</h3>
            <p className="cfg-hint">
              Esta acción no se puede deshacer. Si el usuario tiene historial (pedidos, pagos,
              movimientos, etc.) no se podrá eliminar — usa "Desactivar" en ese caso.
            </p>
            {errorEliminar && <p className="cfg-error">{errorEliminar}</p>}
            <div className="cfg-card__foot">
              <button type="button" className="cfg-btn" onClick={() => setEliminando(null)} disabled={borrando}>Cancelar</button>
              <button type="button" className="cfg-btn cfg-btn--danger" onClick={eliminarUsuario} disabled={borrando}>
                {borrando ? <><FaSpinner className="cfg-spin" /> Eliminando…</> : 'Eliminar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ── TAB: CATEGORÍAS ──
const nuevaFilaAtributo = () => ({
  _key: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `f${Date.now()}-${Math.random()}`,
  clave: '', valores: '',
});

const TabCategorias = () => {
  const [categorias, setCategorias] = useState([]);
  const [cargando, setCargando]     = useState(true);
  const [nombre, setNombre]         = useState('');
  const [atributos, setAtributos]   = useState([nuevaFilaAtributo()]);
  const [guardando, setGuardando]   = useState(false);

  const cargar = async () => {
    setCargando(true);
    const { data } = await supabase.from('categorias').select('*').order('nombre');
    setCategorias(data ?? []);
    setCargando(false);
  };
  useEffect(() => { cargar(); }, []);

  const setFila = (key, campo, val) => setAtributos((a) => a.map((f) => f._key === key ? { ...f, [campo]: val } : f));
  const addFila = () => setAtributos((a) => [...a, nuevaFilaAtributo()]);
  const delFila = (key) => setAtributos((a) => a.filter((f) => f._key !== key));

  const guardar = async (e) => {
    e.preventDefault();
    if (!nombre.trim()) return;
    const obj = {};
    atributos.forEach((at) => {
      if (at.clave.trim() && at.valores.trim()) {
        obj[at.clave.toLowerCase().trim()] = at.valores.split(',').map((v) => v.trim()).filter(Boolean);
      }
    });
    setGuardando(true);
    const { error } = await supabase.rpc('fn_admin_crear_categoria', { p_nombre: nombre.trim(), p_atributos: obj });
    setGuardando(false);
    if (error) {
      alert(esErrorAal2(error) ? MENSAJE_AAL2_REQUERIDO : error.code === '23505' ? 'Ya existe una categoría con ese nombre.' : 'Error al guardar.');
      return;
    }
    setNombre('');
    setAtributos([nuevaFilaAtributo()]);
    cargar();
  };

  const eliminar = async (id) => {
    if (!window.confirm('¿Eliminar esta categoría? Afectará a productos futuros.')) return;
    const { error } = await supabase.rpc('fn_admin_eliminar_categoria', { p_id: id });
    if (error) { alert(esErrorAal2(error) ? MENSAJE_AAL2_REQUERIDO : 'No se pudo eliminar.'); return; }
    cargar();
  };

  return (
    <div className="cfg-cats">
      {/* Creador */}
      <form className="cfg-card cfg-cats__form" onSubmit={guardar}>
        <h3 className="cfg-card__title"><FaPlus /> Nueva categoría</h3>
        <label className="cfg-flabel">Nombre (ej. Polos, Tazas)
          <input className="cfg-input" value={nombre} onChange={(e) => setNombre(e.target.value)} required />
        </label>

        <div className="cfg-attr-head">
          <span className="cfg-flabel">Atributos dinámicos</span>
          <button type="button" className="cfg-addrow" onClick={addFila}><FaPlus /> Fila</button>
        </div>
        {atributos.map((at) => (
          <div key={at._key} className="cfg-attr-card-row">
            <div className="cfg-attr-card-field">
              <span className="cfg-attr-card-label">Nombre del atributo</span>
              <input className="cfg-input cfg-attr-card-input-key" placeholder="Ej. tallas, color" value={at.clave} onChange={(e) => setFila(at._key, 'clave', e.target.value)} />
            </div>
            <div className="cfg-attr-card-field cfg-attr-card-field--grow">
              <span className="cfg-attr-card-label">Valores separados por comas</span>
              <input className="cfg-input cfg-attr-card-input-val" placeholder="Ej. S, M, L o Rojo, Azul" value={at.valores} onChange={(e) => setFila(at._key, 'valores', e.target.value)} />
            </div>
            <button type="button" className="cfg-attr-card-del" onClick={() => delFila(at._key)} aria-label="Quitar"><FaTrash /></button>
          </div>
        ))}
        <p className="cfg-hint">Escribe la clave del atributo y sus valores posibles separados por comas (,).</p>

        <div className="cfg-card__foot">
          <button type="submit" className="cfg-btn cfg-btn--primary" disabled={guardando}>
            {guardando ? <><FaSpinner className="cfg-spin" /> Guardando…</> : 'Guardar categoría'}
          </button>
        </div>
      </form>

      {/* Lista */}
      <div className="cfg-cats__list">
        {cargando && <div className="cfg-loading"><FaSpinner className="cfg-spin" /> Cargando…</div>}
        {!cargando && categorias.map((cat) => (
          <div key={cat.id} className="cfg-card cfg-catcard">
            <div className="cfg-catcard__head">
              <h4 className="cfg-catcard__name"><FaTags /> {cat.nombre}</h4>
              <button className="cfg-attr-del" onClick={() => eliminar(cat.id)} aria-label="Eliminar"><FaTrash /></button>
            </div>
            <div className="cfg-catcard__attrs">
              {Object.entries(cat.atributos ?? {}).map(([clave, valores]) => (
                <div key={clave} className="cfg-attr-group">
                  <span className="cfg-attr-group__k">{clave}</span>
                  <div className="cfg-attr-group__vals">
                    {Array.isArray(valores) && valores.map((v) => <span key={v} className="cfg-attr-pill">{v}</span>)}
                  </div>
                </div>
              ))}
              {Object.keys(cat.atributos ?? {}).length === 0 && <span className="cfg-hint">Sin atributos.</span>}
            </div>
          </div>
        ))}
        {!cargando && categorias.length === 0 && <p className="cfg-hint">Aún no hay categorías.</p>}
      </div>
    </div>
  );
};

// ── TAB: ROLES Y ETAPAS ──
// Matriz rol × etapa (desde qué etapas puede AVANZAR cada rol); el enforcement real vive en fn_avanzar_produccion.
const ROLES_ASIGNABLES = [
  { valor: 'disenador', label: 'Diseñador' },
  { valor: 'operario',  label: 'Operario' },
  { valor: 'vendedor',  label: 'Vendedor' },
];

// 'entregado' es estado final: no hay avance desde ahí, no es asignable.
const ETAPAS_ASIGNABLES = [
  { valor: 'pendiente',    label: 'Pendiente' },
  { valor: 'en_diseno',    label: 'Diseño' },
  { valor: 'en_impresion', label: 'Impresión' },
  { valor: 'en_planchado', label: 'Planchado' },
  { valor: 'en_costura',   label: 'Costura' },
  { valor: 'listo',        label: 'Listo' },
];

const TabRolesEtapas = () => {
  const [matriz, setMatriz]       = useState(null); // { rol: Set(etapas) }
  const [guardando, setGuardando] = useState(false);
  const [ok, setOk]               = useState(false);
  const [error, setError]         = useState('');

  useEffect(() => {
    supabase.rpc('fn_admin_get_rol_etapas').then(({ data, error: err }) => {
      if (err) { setError(esErrorAal2(err) ? MENSAJE_AAL2_REQUERIDO : 'No se pudo cargar la matriz (requiere admin).'); return; }
      const m = Object.fromEntries(ROLES_ASIGNABLES.map((r) => [r.valor, new Set()]));
      (data ?? []).forEach(({ rol, etapa }) => m[rol]?.add(etapa));
      setMatriz(m);
    });
  }, []);

  const toggle = (rol, etapa) => {
    setOk(false);
    setMatriz((m) => {
      const set = new Set(m[rol]);
      set.has(etapa) ? set.delete(etapa) : set.add(etapa);
      return { ...m, [rol]: set };
    });
  };

  const guardar = async () => {
    setGuardando(true);
    setOk(false);
    setError('');
    try {
      for (const { valor: rol } of ROLES_ASIGNABLES) {
        const { error: err } = await supabase.rpc('fn_admin_set_rol_etapas', {
          p_rol: rol, p_etapas: [...matriz[rol]],
        });
        if (err) throw err;
      }
      setOk(true);
    } catch (err) {
      console.error(err);
      setError(esErrorAal2(err)
        ? MENSAJE_AAL2_REQUERIDO
        : err.message?.includes('NO_AUTORIZADO')
          ? 'Solo un administrador puede modificar la matriz.'
          : 'No se pudo guardar la matriz.');
    } finally {
      setGuardando(false);
    }
  };

  if (error && !matriz) return <div className="cfg-card"><p className="cfg-error">{error}</p></div>;
  if (!matriz) return <div className="cfg-loading"><FaSpinner className="cfg-spin" /> Cargando…</div>;

  return (
    <div className="cfg-card">
      <h3 className="cfg-card__title"><FaTasks /> Etapas de producción por rol</h3>
      <p className="cfg-hint">
        Marca desde qué etapas puede avanzar cada rol. El administrador siempre puede todo.
        Los cambios rigen de inmediato.
      </p>

      <div className="cfg-roles-wrap">
        <table className="cfg-table cfg-roles-table">
          <thead>
            <tr>
              <th>Rol</th>
              {ETAPAS_ASIGNABLES.map((e) => <th key={e.valor} className="cfg-th--center">{e.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {ROLES_ASIGNABLES.map((r) => (
              <tr key={r.valor}>
                <td className="cfg-roles-rol">{r.label}</td>
                {ETAPAS_ASIGNABLES.map((e) => (
                  <td key={e.valor} className="cfg-th--center">
                    <input
                      type="checkbox"
                      className="cfg-roles-check"
                      checked={matriz[r.valor].has(e.valor)}
                      onChange={() => toggle(r.valor, e.valor)}
                      aria-label={`${r.label} puede avanzar desde ${e.label}`}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {error && <p className="cfg-error">{error}</p>}
      <div className="cfg-card__foot">
        {ok && <span className="cfg-ok"><FaCheckCircle /> Matriz guardada</span>}
        <button type="button" className="cfg-btn cfg-btn--primary" onClick={guardar} disabled={guardando}>
          {guardando ? <><FaSpinner className="cfg-spin" /> Guardando…</> : 'Guardar cambios'}
        </button>
      </div>
    </div>
  );
};

// P2.3: visibilidad de módulos del sidebar por rol — es navegación/UX, la seguridad real vive en RLS+RPCs.
const MODULOS_ASIGNABLES = [
  { valor: 'productos',     label: 'Productos' },
  { valor: 'pos',           label: 'Punto de venta' },
  { valor: 'pedidos',       label: 'Pedidos' },
  { valor: 'clientes',      label: 'Clientes' },
  { valor: 'inventario',    label: 'Inventario' },
  { valor: 'reportes',      label: 'Reportes' },
  { valor: 'configuracion', label: 'Configuración' },
];

const TabModulos = () => {
  const [matriz, setMatriz]       = useState(null); // { rol: Set(modulos) }
  const [guardando, setGuardando] = useState(false);
  const [ok, setOk]               = useState(false);
  const [error, setError]         = useState('');

  useEffect(() => {
    supabase.rpc('fn_admin_get_rol_modulos').then(({ data, error: err }) => {
      if (err) { setError(esErrorAal2(err) ? MENSAJE_AAL2_REQUERIDO : 'No se pudo cargar la matriz (requiere admin).'); return; }
      const m = Object.fromEntries(ROLES_ASIGNABLES.map((r) => [r.valor, new Set()]));
      (data ?? []).forEach(({ rol, modulo }) => m[rol]?.add(modulo));
      setMatriz(m);
    });
  }, []);

  const toggle = (rol, modulo) => {
    setOk(false);
    setMatriz((m) => {
      const set = new Set(m[rol]);
      set.has(modulo) ? set.delete(modulo) : set.add(modulo);
      return { ...m, [rol]: set };
    });
  };

  const guardar = async () => {
    setGuardando(true);
    setOk(false);
    setError('');
    try {
      for (const { valor: rol } of ROLES_ASIGNABLES) {
        const { error: err } = await supabase.rpc('fn_admin_set_rol_modulos', {
          p_rol: rol, p_modulos: [...matriz[rol]],
        });
        if (err) throw err;
      }
      setOk(true);
    } catch (err) {
      console.error(err);
      if (esErrorAal2(err)) { setError(MENSAJE_AAL2_REQUERIDO); return; }
      setError(err.message?.includes('NO_AUTORIZADO')
        ? 'Solo un administrador puede modificar la matriz.'
        : 'No se pudo guardar la matriz.');
    } finally {
      setGuardando(false);
    }
  };

  if (error && !matriz) return <div className="cfg-card"><p className="cfg-error">{error}</p></div>;
  if (!matriz) return <div className="cfg-loading"><FaSpinner className="cfg-spin" /> Cargando…</div>;

  return (
    <div className="cfg-card">
      <h3 className="cfg-card__title"><FaTasks /> Módulos visibles por rol</h3>
      <p className="cfg-hint">
        Marca qué entradas del menú lateral ve cada rol. El administrador siempre ve todo.
        Esto es solo navegación: cada pantalla y cada acción siguen validándose en el servidor.
      </p>

      <div className="cfg-roles-wrap">
        <table className="cfg-table cfg-roles-table">
          <thead>
            <tr>
              <th>Rol</th>
              {MODULOS_ASIGNABLES.map((m) => <th key={m.valor} className="cfg-th--center">{m.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {ROLES_ASIGNABLES.map((r) => (
              <tr key={r.valor}>
                <td className="cfg-roles-rol">{r.label}</td>
                {MODULOS_ASIGNABLES.map((m) => (
                  <td key={m.valor} className="cfg-th--center">
                    <input
                      type="checkbox"
                      className="cfg-roles-check"
                      checked={matriz[r.valor].has(m.valor)}
                      onChange={() => toggle(r.valor, m.valor)}
                      aria-label={`${r.label} ve ${m.label}`}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {error && <p className="cfg-error">{error}</p>}
      <div className="cfg-card__foot">
        {ok && <span className="cfg-ok"><FaCheckCircle /> Matriz guardada</span>}
        <button type="button" className="cfg-btn cfg-btn--primary" onClick={guardar} disabled={guardando}>
          {guardando ? <><FaSpinner className="cfg-spin" /> Guardando…</> : 'Guardar cambios'}
        </button>
      </div>
    </div>
  );
};

// ── TAB: ACTIVIDAD ── auditoría unificada (solo admin, RPC valida rol en servidor).
const TIPOS_ACTIVIDAD = [
  { valor: 'login',      label: 'Inicio de sesión' },
  { valor: 'estado',     label: 'Cambios de estado' },
  { valor: 'stock',      label: 'Stock' },
  { valor: 'pago',       label: 'Pagos' },
  { valor: 'traslado',   label: 'Traslados' },
  { valor: 'devolucion', label: 'Devoluciones' },
];

const hoyISO       = () => new Date().toISOString().slice(0, 10);
const hace30dISO   = () => new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

// Bloque 5 (auditoría P1): la subida al bucket cotizaciones_b2b (form B2B anónimo) y el registro de metadatos son pasos separados,
// así que puede quedar un archivo subido sin registrar. Esta tarjeta muestra los que llevan >24h así y los limpia vía Edge Function.
const TabArchivosHuerfanos = () => {
  const [filas, setFilas]       = useState([]);
  const [cargando, setCargando] = useState(true);
  const [limpiando, setLimpiando] = useState(false);
  const [error, setError]       = useState('');
  const [ok, setOk]             = useState('');

  const cargar = useCallback(async () => {
    setCargando(true); setError('');
    const { data, error: err } = await supabase.rpc('fn_admin_archivos_huerfanos');
    if (err) setError(esErrorAal2(err) ? MENSAJE_AAL2_REQUERIDO : 'No se pudo cargar (requiere admin).');
    else setFilas(data ?? []);
    setCargando(false);
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const totalBytes = filas.reduce((s, f) => s + (f.tamano_bytes || 0), 0);
  const totalMb = (totalBytes / (1024 * 1024)).toFixed(2);

  const limpiar = async () => {
    if (!window.confirm(`¿Eliminar ${filas.length} archivo(s) huérfano(s) (${totalMb} MB)? Esta acción no se puede deshacer.`)) return;
    setLimpiando(true); setError(''); setOk('');
    const { data, error: err } = await supabase.functions.invoke('admin-limpiar-huerfanos');
    setLimpiando(false);
    if (err) { setError('No se pudo limpiar. Intenta de nuevo.'); return; }
    setOk(`Se eliminaron ${data.eliminados} archivo(s) (${(data.liberado_bytes / (1024 * 1024)).toFixed(2)} MB liberados).`);
    cargar();
  };

  return (
    <div className="cfg-card">
      <h3 className="cfg-card__title"><FaTrash /> Archivos huérfanos</h3>
      <p className="cfg-hint">
        Archivos subidos al formulario de cotización B2B que nunca se registraron a una solicitud
        (subida interrumpida o abandonada) y llevan más de 24 horas así.
      </p>
      {error && <p className="cfg-error">{error}</p>}
      {ok && <p className="cfg-ok"><FaCheckCircle /> {ok}</p>}
      {cargando ? (
        <div className="cfg-loading"><FaSpinner className="cfg-spin" /> Cargando…</div>
      ) : filas.length === 0 ? (
        <p className="cfg-hint">Sin archivos huérfanos por ahora.</p>
      ) : (
        <>
          <p className="cfg-hint">{filas.length} archivo(s) — {totalMb} MB en total.</p>
          <ul className="cfg-huerfanos-list">
            {filas.map((f) => (
              <li key={f.storage_path} className="cfg-huerfanos-item">
                <span className="cfg-huerfanos-item__path">{f.storage_path}</span>
                <span className="cfg-huerfanos-item__meta">{(f.tamano_bytes / 1024).toFixed(0)} KB · hace {Math.round(f.edad_horas)} h</span>
              </li>
            ))}
          </ul>
          <div className="cfg-card__foot">
            <button type="button" className="cfg-btn cfg-btn--danger" onClick={limpiar} disabled={limpiando}>
              {limpiando ? <><FaSpinner className="cfg-spin" /> Limpiando…</> : 'Limpiar ahora'}
            </button>
          </div>
        </>
      )}
    </div>
  );
};

// Fusiona la antigua pestaña "Seguridad" (inicios de sesión) dentro de Actividad: mismo filtro fecha/usuario,
// "Inicio de sesión" cambia de RPC pero se normaliza a las mismas columnas. Archivos huérfanos al final, solo admin.
const TabActividad = () => {
  const navigate = useNavigate();
  const { perfil } = useAuth();
  const [desde, setDesde]       = useState(hace30dISO());
  const [hasta, setHasta]       = useState(hoyISO());
  const [usuario, setUsuario]   = useState('');
  const [tipo, setTipo]         = useState('');
  const [usuarios, setUsuarios] = useState([]);
  const [filas, setFilas]       = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError]       = useState('');

  useEffect(() => {
    supabase.rpc('fn_admin_list_usuarios').then(({ data }) => setUsuarios(data ?? []));
  }, []);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError('');
    const p_desde = desde ? `${desde}T00:00:00` : null;
    const p_hasta = hasta ? `${hasta}T23:59:59` : null;
    const p_usuario = usuario || null;

    // "Inicio de sesión" viene de fn_admin_eventos_seguridad (sin columna tipo); se normaliza a la fila de fn_actividad.
    const { data, error: err } = tipo === 'login'
      ? await supabase.rpc('fn_admin_eventos_seguridad', { p_desde, p_hasta, p_usuario })
      : await supabase.rpc('fn_actividad', { p_desde, p_hasta, p_usuario, p_tipo: tipo || null });

    if (err) {
      setError(esErrorAal2(err) ? MENSAJE_AAL2_REQUERIDO : 'No se pudo cargar la actividad (requiere admin).');
    } else if (tipo === 'login') {
      setFilas((data ?? []).map((f) => ({ fecha: f.creado_en, usuario: f.usuario, tipo: 'login', descripcion: null, pedido_id: null })));
    } else {
      setFilas(data ?? []);
    }
    setCargando(false);
  }, [desde, hasta, usuario, tipo]);

  useEffect(() => { cargar(); }, [cargar]);

  const etiquetaTipo = (t) => TIPOS_ACTIVIDAD.find((x) => x.valor === t)?.label ?? t;

  return (
    <>
    <div className="cfg-card">
      <h3 className="cfg-card__title"><FaHistory /> Actividad del sistema</h3>

      <div className="cfg-act-filtros">
        <label className="cfg-flabel">Desde
          <input className="cfg-input" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
        </label>
        <label className="cfg-flabel">Hasta
          <input className="cfg-input" type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
        </label>
        <label className="cfg-flabel">Usuario
          <select className="cfg-input" value={usuario} onChange={(e) => setUsuario(e.target.value)}>
            <option value="">Todos</option>
            {usuarios.map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}
          </select>
        </label>
        <label className="cfg-flabel">Tipo
          <select className="cfg-input" value={tipo} onChange={(e) => setTipo(e.target.value)}>
            <option value="">Todos</option>
            {TIPOS_ACTIVIDAD.map((t) => <option key={t.valor} value={t.valor}>{t.label}</option>)}
          </select>
        </label>
      </div>

      {error && <p className="cfg-error">{error}</p>}
      {cargando ? (
        <div className="cfg-loading"><FaSpinner className="cfg-spin" /> Cargando…</div>
      ) : filas.length === 0 ? (
        <p className="cfg-hint">Sin actividad en el rango seleccionado.</p>
      ) : (
        <div className="cfg-act-wrap">
          <table className="cfg-table">
            <thead>
              <tr><th>Fecha</th><th>Usuario</th><th>Tipo</th><th>Descripción</th><th>Pedido</th></tr>
            </thead>
            <tbody>
              {filas.map((f, i) => (
                <tr key={`${f.fecha}-${f.usuario}-${f.tipo}-${i}`}>
                  <td className="cfg-act-fecha">
                    {new Date(f.fecha).toLocaleString('es-PE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </td>
                  <td>{f.usuario}</td>
                  <td><span className={`cfg-act-tipo cfg-act-tipo--${f.tipo}`}>{etiquetaTipo(f.tipo)}</span></td>
                  <td className="cfg-act-desc">{f.descripcion || '—'}</td>
                  <td>
                    {f.pedido_id ? (
                      <button
                        className="cfg-act-link"
                        onClick={() => navigate(`/dashboard/pedidos?tab=produccion&pedido=${f.pedido_id}`)}
                      >
                        #{f.pedido_id}
                      </button>
                    ) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="cfg-hint">Se muestran hasta 500 registros del rango; acota los filtros si necesitas más detalle.</p>
        </div>
      )}
    </div>
    {perfil?.rol === 'admin' && <TabArchivosHuerfanos />}
    </>
  );
};

// ── TAB: PROMOCIONES ── banners de la vitrina; RLS deja al público solo las activas y vigentes, escrituras vía RPCs de admin.
const PROMO_INICIAL = { titulo: '', link_url: '', vigente_desde: '', vigente_hasta: '', orden: 0, activo: true };

const TabPromociones = () => {
  const [promos, setPromos]       = useState([]);
  const [cargando, setCargando]   = useState(true);
  const [form, setForm]           = useState(PROMO_INICIAL);
  const [idEdicion, setIdEdicion] = useState(null);
  const [imgFile, setImgFile]     = useState(null);
  const [imgActual, setImgActual] = useState(null); // url existente al editar
  const [guardando, setGuardando] = useState(false);
  const [error, setError]         = useState('');

  const hoy = new Date().toISOString().slice(0, 10);
  const vigente = (p) => p.activo && p.vigente_desde <= hoy && hoy <= p.vigente_hasta;

  const cargar = async () => {
    const { data } = await supabase
      .from('promociones')
      .select('*')
      .order('orden')
      .order('id');
    setPromos(data ?? []);
    setCargando(false);
  };
  useEffect(() => { cargar(); }, []);

  const set = (campo, valor) => setForm((f) => ({ ...f, [campo]: valor }));

  const limpiar = () => {
    setForm(PROMO_INICIAL);
    setIdEdicion(null);
    setImgFile(null);
    setImgActual(null);
    setError('');
  };

  const editar = (p) => {
    setIdEdicion(p.id);
    setForm({
      titulo: p.titulo, link_url: p.link_url ?? '',
      vigente_desde: p.vigente_desde, vigente_hasta: p.vigente_hasta,
      orden: p.orden, activo: p.activo,
    });
    setImgActual(p.imagen_url);
    setImgFile(null);
    setError('');
  };

  const guardar = async (e) => {
    e.preventDefault();
    setError('');
    if (!form.vigente_hasta) { setError('Indica la fecha de fin de vigencia.'); return; }
    if (!imgFile && !imgActual) { setError('Sube la imagen del banner.'); return; }
    setGuardando(true);
    try {
      let imagen_url = imgActual;
      if (imgFile) {
        const ext = imgFile.name.split('.').pop();
        const path = `promos/banner-${Date.now()}.${ext}`;
        const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, imgFile, { upsert: false });
        if (upErr) throw upErr;
        imagen_url = supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
      }
      const { error: err } = await supabase.rpc('fn_admin_guardar_promocion', {
        p_promocion: {
          ...(idEdicion ? { id: idEdicion } : {}),
          titulo:        form.titulo,
          imagen_url,
          link_url:      form.link_url || null,
          vigente_desde: form.vigente_desde || hoy,
          vigente_hasta: form.vigente_hasta,
          orden:         parseInt(form.orden) || 0,
          activo:        form.activo,
        },
      });
      if (err) throw err;
      limpiar();
      cargar();
    } catch (err) {
      console.error(err);
      setError(esErrorAal2(err)
        ? MENSAJE_AAL2_REQUERIDO
        : err.message?.includes('NO_AUTORIZADO')
          ? 'Solo un administrador puede gestionar promociones.'
          : 'No se pudo guardar la promoción.');
    } finally {
      setGuardando(false);
    }
  };

  const eliminar = async (p) => {
    if (!window.confirm(`¿Eliminar el banner "${p.titulo}"?`)) return;
    const { data: url, error: err } = await supabase.rpc('fn_admin_eliminar_promocion', { p_id: p.id });
    if (err) { alert(esErrorAal2(err) ? MENSAJE_AAL2_REQUERIDO : 'No se pudo eliminar (¿permisos de admin?).'); return; }
    // Limpiar el archivo del bucket
    const ruta = (url ?? '').split(`/${BUCKET}/`)[1];
    if (ruta) await supabase.storage.from(BUCKET).remove([ruta]);
    if (idEdicion === p.id) limpiar();
    cargar();
  };

  return (
    <div className="cfg-promos">
      {/* Formulario crear/editar */}
      <form className="cfg-card" onSubmit={guardar}>
        <h3 className="cfg-card__title">
          <FaBullhorn /> {idEdicion ? 'Editar promoción' : 'Nueva promoción'}
        </h3>
        <div className="cfg-grid2">
          <label className="cfg-flabel">Título
            <input className="cfg-input" value={form.titulo} onChange={(e) => set('titulo', e.target.value)} required />
          </label>
          <label className="cfg-flabel">Enlace (opcional)
            <input className="cfg-input" placeholder="/producto/12 o /cotizar" value={form.link_url} onChange={(e) => set('link_url', e.target.value)} />
          </label>
          <label className="cfg-flabel">Vigente desde
            <input className="cfg-input" type="date" value={form.vigente_desde} onChange={(e) => set('vigente_desde', e.target.value)} />
          </label>
          <label className="cfg-flabel">Vigente hasta
            <input className="cfg-input" type="date" value={form.vigente_hasta} onChange={(e) => set('vigente_hasta', e.target.value)} required />
          </label>
          <label className="cfg-flabel">Orden
            <input className="cfg-input" type="number" value={form.orden} onChange={(e) => set('orden', e.target.value)} />
          </label>
          <label className="cfg-flabel">Imagen del banner
            <input className="cfg-input" type="file" accept="image/*" onChange={(e) => setImgFile(e.target.files[0] ?? null)} />
          </label>
        </div>
        <label className="cfg-promo-activo">
          <input type="checkbox" checked={form.activo} onChange={(e) => set('activo', e.target.checked)} />
          <span>Activa (además debe estar dentro de la vigencia para mostrarse)</span>
        </label>
        {error && <p className="cfg-error">{error}</p>}
        <div className="cfg-card__foot">
          {idEdicion && (
            <button type="button" className="cfg-btn" onClick={limpiar} disabled={guardando}>Cancelar edición</button>
          )}
          <button type="submit" className="cfg-btn cfg-btn--primary" disabled={guardando}>
            {guardando ? <><FaSpinner className="cfg-spin" /> Guardando…</> : (idEdicion ? 'Actualizar' : 'Crear promoción')}
          </button>
        </div>
      </form>

      {/* Lista */}
      <div className="cfg-card">
        <h3 className="cfg-card__title"><FaImage /> Banners</h3>
        {cargando ? (
          <div className="cfg-loading"><FaSpinner className="cfg-spin" /> Cargando…</div>
        ) : promos.length === 0 ? (
          <p className="cfg-hint">Aún no hay promociones. La vitrina no muestra nada mientras no haya banners vigentes.</p>
        ) : (
          <ul className="cfg-promo-list">
            {promos.map((p) => (
              <li key={p.id} className="cfg-promo-item">
                <img src={p.imagen_url} alt={p.titulo} className="cfg-promo-item__img" />
                <div className="cfg-promo-item__info">
                  <p className="cfg-promo-item__title">{p.titulo}</p>
                  <p className="cfg-promo-item__meta">
                    {p.vigente_desde} → {p.vigente_hasta}
                    {p.link_url && <> · {p.link_url}</>}
                  </p>
                  <span className={`cfg-promo-badge ${vigente(p) ? 'cfg-promo-badge--on' : ''}`}>
                    {vigente(p) ? 'Visible en vitrina' : (p.activo ? 'Fuera de vigencia' : 'Inactiva')}
                  </span>
                </div>
                <div className="cfg-promo-item__actions">
                  <button type="button" className="cfg-addrow" onClick={() => editar(p)} aria-label="Editar"><FaEdit /></button>
                  <button type="button" className="cfg-attr-del" onClick={() => eliminar(p)} aria-label="Eliminar"><FaTrash /></button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

export default Configuracion;
