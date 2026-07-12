import React, { useState, useEffect, useRef } from 'react';
import {
  FaPlus, FaEdit, FaImage, FaSpinner, FaTimes,
  FaEye, FaEyeSlash, FaTrash,
} from 'react-icons/fa';
import { supabase } from '../supabase/client';
import { MENSAJE_AAL2_REQUERIDO, esErrorAal2 } from '../lib/mensajesError';
import './Productos.css';

const BUCKET = 'productos_uploads';

// Clave estable para reconciliar combinaciones: "Talla=S|Tela=Algodón"
function claveVariante(atributos) {
  return Object.entries(atributos)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('|');
}

// Producto cartesiano de las opciones seleccionadas
// { Talla:['S','M'], Tela:['Algodón'] } → [{Talla:'S',Tela:'Algodón'},{Talla:'M',Tela:'Algodón'}]
function productoCartesiano(opciones) {
  const keys = Object.keys(opciones).filter(k => (opciones[k] ?? []).length > 0);
  if (keys.length === 0) return [{}]; // sin atributos → una variante única
  const combinar = (idx) => {
    if (idx === keys.length) return [{}];
    const resto = combinar(idx + 1);
    const key = keys[idx];
    const result = [];
    for (const val of opciones[key]) {
      for (const combo of resto) result.push({ [key]: val, ...combo });
    }
    return result;
  };
  return combinar(0);
}

// Id local para reconciliar filas de componentes de kit (nunca viaja al RPC)
const nuevoUid = () =>
  (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `k${Date.now()}-${Math.random()}`;

const ESTADO_INICIAL = {
  nombre: '', categoria_id: '', descripcion: '',
  es_personalizable: false,
  tipo: 'simple',
  controla_stock: true,
  imagenesExistentes: [], imagenesNuevas: [],
};

const Productos = () => {
  const [productos, setProductos]                 = useState([]);
  const [error, setError]                         = useState('');
  const [cargando, setCargando]                   = useState(false);
  const [cargandoLista, setCargandoLista]         = useState(true);
  const [busqueda, setBusqueda]                   = useState('');
  const [mostrarModal, setMostrarModal]           = useState(false);
  const [modoEdicion, setModoEdicion]             = useState(false);
  const [idEdicion, setIdEdicion]                 = useState(null);
  const [categoriasConfig, setCategoriasConfig]   = useState([]);
  const [productoActual, setProductoActual]       = useState(ESTADO_INICIAL);
  const [opcionesDinamicas, setOpcionesDinamicas] = useState({});
  const [variantes, setVariantes]                 = useState([]);
  // Composición del kit: [{ componente_id, cantidad_por_kit }] (orden = posición)
  const [componentesKit, setComponentesKit]       = useState([]);
  // variante_id → true si agotada (disponible combinado = 0 en todos los locales)
  const [agotadas, setAgotadas]                   = useState({});

  const esKit = productoActual.tipo === 'kit';

  // Incluye producto_variantes para mostrar rango de precios en la tabla
  const cargarProductos = async () => {
    setCargandoLista(true);
    try {
      const { data, error: err } = await supabase
        .from('productos')
        .select('*, categorias(nombre), producto_variantes(id, atributos, precio_base, activo), kit_componentes!kit_id(componente_id, cantidad_por_kit, orden), producto_imagenes(url, orden)')
        .order('id');
      if (err) throw err;
      setProductos(data ?? []);
      // Estado agotado derivado (booleano por variante, vista pública)
      const { data: disp } = await supabase
        .from('catalogo_disponibilidad')
        .select('variante_id, agotada');
      const mapa = {};
      (disp ?? []).forEach(d => { mapa[d.variante_id] = !!d.agotada; });
      setAgotadas(mapa);
    } catch {
      setError('Hubo un problema al cargar el catálogo.');
    } finally {
      setCargandoLista(false);
    }
  };

  const cargarCategorias = async () => {
    try {
      const { data, error: err } = await supabase
        .from('categorias')
        .select('id, nombre, atributos')
        .eq('activo', true)
        .order('nombre');
      if (err) throw err;
      setCategoriasConfig(data ?? []);
    } catch {
      setError(prev => prev || 'No se pudieron cargar las categorías.');
    }
  };

  useEffect(() => { cargarProductos(); cargarCategorias(); }, []);

  const productosFiltrados = productos.filter(p => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return true;
    return p.nombre.toLowerCase().includes(q) || (p.categorias?.nombre ?? '').toLowerCase().includes(q);
  });

  const subirImagen = async (archivo) => {
    const ext      = archivo.name.split('.').pop();
    const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(fileName, archivo, { cacheControl: '3600', upsert: false });
    if (uploadError) throw uploadError;
    const { data } = supabase.storage.from(BUCKET).getPublicUrl(fileName);
    return data.publicUrl;
  };

  // Regenera la grilla conservando precios para combinaciones que no cambiaron
  const regenerarVariantes = (opciones) => {
    const combinaciones = productoCartesiano(opciones);
    setVariantes(prev => {
      const prevMap = {};
      prev.forEach(v => { prevMap[v.key] = v; });
      return combinaciones.map(atributos => {
        const key = claveVariante(atributos);
        return prevMap[key] ?? { key, atributos, precio_base: '', sku: '', activo: true };
      });
    });
  };

  const actualizarVariante = (idx, campo, valor) =>
    setVariantes(prev => prev.map((v, i) => i === idx ? { ...v, [campo]: valor } : v));

  // CREATE / UPDATE → RPC transaccional fn_guardar_producto
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (esKit) {
      const compsValidos = componentesKit.filter(c => c.componente_id);
      if (compsValidos.length === 0) {
        alert('Un kit necesita al menos un componente.');
        return;
      }
      const ids = compsValidos.map(c => c.componente_id);
      if (new Set(ids).size !== ids.length) {
        alert('Hay componentes repetidos en el kit.');
        return;
      }
    } else if (variantes.filter(v => v.activo).some(v => !v.precio_base || parseFloat(v.precio_base) <= 0)) {
      alert('Todas las variantes activas deben tener un precio mayor a 0.');
      return;
    }
    setCargando(true);
    try {
      const urlsNuevas = [];
      for (const archivo of productoActual.imagenesNuevas) {
        urlsNuevas.push(await subirImagen(archivo));
      }
      const galeria = [...productoActual.imagenesExistentes, ...urlsNuevas];

      const pProducto = {
        nombre:                    productoActual.nombre,
        categoria_id:              productoActual.categoria_id || null,
        descripcion:               productoActual.descripcion,
        tipo:                      productoActual.tipo,
        activo:                    true,
        es_personalizable:         productoActual.es_personalizable,
        controla_stock:            esKit ? true : productoActual.controla_stock,
        ...(esKit ? {
          componentes: componentesKit
            .filter(c => c.componente_id)
            .map((c, idx) => ({
              componente_id:    c.componente_id,
              cantidad_por_kit: Math.max(1, parseInt(c.cantidad_por_kit) || 1),
              orden:            idx,
            })),
        } : {}),
        ...(modoEdicion ? { id: idEdicion } : {}),
      };

      const pVariantes = esKit ? [] : variantes.map(v => ({
        atributos:   v.atributos,
        precio_base: parseFloat(v.precio_base) || 0,
        sku:         v.sku || null,
        activo:      v.activo,
      }));

      const { error: err } = await supabase.rpc('fn_guardar_producto', {
        p_producto:  pProducto,
        p_variantes: pVariantes,
        p_imagenes:  galeria,
      });
      if (err) throw err;

      cerrarModal();
      cargarProductos();
    } catch (err) {
      console.error('Error al guardar producto:', err);
      alert(esErrorAal2(err) ? MENSAJE_AAL2_REQUERIDO : 'Error al guardar el producto. Revisa la consola (F12) para más detalles.');
    } finally {
      setCargando(false);
    }
  };

  // Eliminación definitiva: solo admin y solo productos SIN historia
  // (sin pedidos/movimientos/kits). La regla vive en fn_eliminar_producto.
  const eliminarProducto = async (producto) => {
    if (!window.confirm(`¿Eliminar "${producto.nombre}" definitivamente? Se borrarán sus variantes e imágenes. Esta acción no se puede deshacer.`)) return;
    try {
      const { data: urls, error: err } = await supabase
        .rpc('fn_eliminar_producto', { p_id: producto.id });
      if (err) throw err;
      // Limpiar del bucket los archivos de imágenes que devolvió la RPC
      const rutas = (urls ?? [])
        .map(u => u.split(`/${BUCKET}/`)[1])
        .filter(Boolean);
      if (rutas.length) await supabase.storage.from(BUCKET).remove(rutas);
      cargarProductos();
    } catch (err) {
      const msg = err.message || '';
      if (msg.includes('STOCK_DISTINTO_DE_CERO')) {
        alert('Solo se puede eliminar un producto con stock físico en 0. Ajusta el stock o usa "Ocultar" para sacarlo del catálogo.');
      } else if (msg.includes('PRODUCTO_CON_HISTORIA')) {
        alert('Este producto tiene pedidos, movimientos o forma parte de un kit: no se puede eliminar. Usa "Ocultar" para sacarlo del catálogo.');
      } else if (esErrorAal2(err)) {
        alert(MENSAJE_AAL2_REQUERIDO);
      } else if (msg.includes('NO_AUTORIZADO')) {
        alert('Solo un administrador puede eliminar productos.');
      } else {
        alert('No se pudo eliminar el producto.');
        console.error(err);
      }
    }
  };

  // Toggle de visibilidad en catálogo público
  const alternarVisibilidad = async (producto) => {
    try {
      const { error: err } = await supabase
        .rpc('fn_set_producto_activo', { p_id: producto.id, p_activo: !producto.activo });
      if (err) throw err;
      setProductos(prev =>
        prev.map(p => p.id === producto.id ? { ...p, activo: !p.activo } : p)
      );
    } catch (err) {
      alert(esErrorAal2(err) ? MENSAJE_AAL2_REQUERIDO : 'No se pudo cambiar la visibilidad del producto');
      console.error(err);
    }
  };

  const abrirModalCrear = () => {
    setModoEdicion(false);
    setIdEdicion(null);
    setProductoActual({ ...ESTADO_INICIAL, categoria_id: categoriasConfig[0]?.id ?? '' });
    setOpcionesDinamicas({});
    // Una variante única inicial (sin atributos) hasta que el usuario seleccione opciones
    setVariantes([{ key: '', atributos: {}, precio_base: '', sku: '', activo: true }]);
    setComponentesKit([]);
    setMostrarModal(true);
  };

  const agregarFilaKit = () =>
    setComponentesKit(prev => [...prev, { _uid: nuevoUid(), componente_id: '', cantidad_por_kit: 1 }]);

  const abrirModalEditar = (producto) => {
    setModoEdicion(true);
    setIdEdicion(producto.id);
    // Galería desde producto_imagenes (fuente única, ver Bloque 8); fallback a imagen_url
    const existentes = producto.producto_imagenes?.length
      ? [...producto.producto_imagenes].sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0)).map((i) => i.url)
      : (producto.imagen_url ? [producto.imagen_url] : []);
    setProductoActual({
      nombre:                    producto.nombre,
      categoria_id:              producto.categoria_id,
      descripcion:               producto.descripcion ?? '',
      es_personalizable:         producto.es_personalizable ?? false,
      tipo:                      producto.tipo ?? 'simple',
      controla_stock:            producto.controla_stock ?? true,
      imagenesExistentes:        existentes,
      imagenesNuevas:            [],
    });
    // Composición del kit (si aplica), respetando el orden guardado
    setComponentesKit(
      (producto.kit_componentes ?? [])
        .slice()
        .sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))
        .map(c => ({ _uid: nuevoUid(), componente_id: c.componente_id, cantidad_por_kit: c.cantidad_por_kit }))
    );
    // Reconstruir opcionesDinamicas desde variantes activas
    const opts = {};
    (producto.producto_variantes ?? []).filter(v => v.activo).forEach(v => {
      Object.entries(v.atributos ?? {}).forEach(([k, val]) => {
        if (!opts[k]) opts[k] = [];
        if (!opts[k].includes(val)) opts[k].push(val);
      });
    });
    setOpcionesDinamicas(opts);
    // Cargar variantes activas con precios existentes
    const variantesExistentes = (producto.producto_variantes ?? [])
      .filter(v => v.activo)
      .map(v => ({
        id:          v.id,
        key:         claveVariante(v.atributos ?? {}),
        atributos:   v.atributos ?? {},
        precio_base: v.precio_base ?? '',
        sku:         v.sku ?? '',
        activo:      true,
      }));
    setVariantes(variantesExistentes.length
      ? variantesExistentes
      : [{ key: '', atributos: {}, precio_base: '', sku: '', activo: true }]
    );
    setMostrarModal(true);
  };

  const cerrarModal = () => { if (!cargando) setMostrarModal(false); };

  const agregarArchivos = (fileList) => {
    const arr = Array.from(fileList ?? []);
    if (!arr.length) return;
    setProductoActual(p => ({ ...p, imagenesNuevas: [...p.imagenesNuevas, ...arr] }));
  };
  const quitarExistente = (url) =>
    setProductoActual(p => ({ ...p, imagenesExistentes: p.imagenesExistentes.filter(u => u !== url) }));
  const quitarNueva = (idx) =>
    setProductoActual(p => ({ ...p, imagenesNuevas: p.imagenesNuevas.filter((_, i) => i !== idx) }));

  // Previsualizaciones: se generan una vez por archivo y se liberan al reemplazar/desmontar (evita fugas de memoria).
  const [previewsNuevas, setPreviewsNuevas] = useState([]);
  useEffect(() => {
    const urls = productoActual.imagenesNuevas.map(f => URL.createObjectURL(f));
    setPreviewsNuevas(urls);
    return () => { urls.forEach(u => URL.revokeObjectURL(u)); };
  }, [productoActual.imagenesNuevas]);

  // Accesibilidad del modal: foco inicial, trampa de Tab y Escape para cerrar.
  const dialogRef = useRef(null);
  const focoPrevioRef = useRef(null);
  useEffect(() => {
    if (!mostrarModal) return;
    focoPrevioRef.current = document.activeElement;
    const focusables = dialogRef.current?.querySelectorAll('input, select, textarea, button, [href]');
    focusables?.[0]?.focus();

    const onKeyDown = (e) => {
      if (e.key === 'Escape') { cerrarModal(); return; }
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
  }, [mostrarModal]);

  const rangoPrecio = (producto) => {
    const precios = (producto.producto_variantes ?? [])
      .filter(v => v.activo)
      .map(v => Number(v.precio_base))
      .filter(p => p > 0);
    if (!precios.length) return '—';
    const mn = Math.min(...precios);
    const mx = Math.max(...precios);
    return mn === mx ? `S/ ${mn.toFixed(2)}` : `S/ ${mn.toFixed(2)} – ${mx.toFixed(2)}`;
  };

  return (
    <div className="prod">
      <div className="prod-head">
        <div>
          <h2 className="prod-title">Catálogo de Productos</h2>
          <p className="prod-subtitle">Gestiona artículos, variantes, visibilidad e imágenes.</p>
        </div>
        <button type="button" onClick={abrirModalCrear} className="prod-new">
          <FaPlus /> Nuevo producto
        </button>
      </div>

      {error && <p className="prod-error" role="alert">{error}</p>}

      <label className="prod-search">
        <span className="prod-visually-hidden">Buscar producto</span>
        <input type="search" className="prod-input" placeholder="Buscar por nombre o categoría…"
          value={busqueda} onChange={e => setBusqueda(e.target.value)}
        />
      </label>

      <div className="prod-card">
        <table className="prod-table">
          <thead>
            <tr>
              <th className="prod-th--img">Imagen</th>
              <th>Nombre</th>
              <th>Categoría</th>
              <th>Precio</th>
              <th>Variantes</th>
              <th className="prod-th--center">Catálogo</th>
              <th className="prod-th--center">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {cargandoLista && (
              <tr><td colSpan={7} className="prod-empty">Cargando catálogo…</td></tr>
            )}
            {!cargandoLista && productosFiltrados.map((producto) => {
              const esFilaKit  = (producto.tipo ?? 'simple') === 'kit';
              const varsActivas = (producto.producto_variantes ?? []).filter(v => v.activo);
              const nVariantes = varsActivas.length;
              const nComps     = (producto.kit_componentes ?? []).length;
              // Agotado derivado: todas las variantes activas sin disponible (kits no aplican)
              const esAgotado  = !esFilaKit && nVariantes > 0 && varsActivas.every(v => agotadas[v.id]);
              return (
                <tr key={producto.id} className={producto.activo ? '' : 'prod-row--hidden'}>
                  <td>
                    {producto.imagen_url ? (
                      <img src={producto.imagen_url} alt={producto.nombre} className="prod-thumb"
                        width={48} height={48} loading="lazy" decoding="async" />
                    ) : (
                      <div className="prod-thumb prod-thumb--empty"><FaImage /></div>
                    )}
                  </td>
                  <td className="prod-name">
                    {producto.nombre}
                    {esFilaKit && <span className="prod-tag prod-tag--kit">Kit</span>}
                    {esAgotado && <span className="prod-tag prod-tag--agotado">Agotado</span>}
                  </td>
                  <td><span className="prod-tag">{producto.categorias?.nombre ?? '—'}</span></td>
                  <td className="prod-price-cell">{esFilaKit ? 'Se cotiza' : rangoPrecio(producto)}</td>
                  <td>
                    {esFilaKit ? (
                      <span className={`prod-count ${nComps === 0 ? 'prod-count--warn' : ''}`}>
                        {nComps} {nComps === 1 ? 'componente' : 'componentes'}
                      </span>
                    ) : (
                      <span className={`prod-count ${nVariantes === 0 ? 'prod-count--warn' : ''}`}>
                        {nVariantes} {nVariantes === 1 ? 'variante' : 'variantes'}
                      </span>
                    )}
                  </td>
                  <td className="prod-th--center">
                    <span className={`prod-state ${producto.activo ? 'prod-state--on' : 'prod-state--off'}`}>
                      {producto.activo ? 'Visible' : 'Oculto'}
                    </span>
                  </td>
                  <td className="prod-th--center">
                    <div className="prod-actions">
                      <button type="button" onClick={() => alternarVisibilidad(producto)} className="prod-act prod-act--eye"
                        title={producto.activo ? 'Ocultar del catálogo' : 'Mostrar en catálogo'}
                        aria-label={producto.activo ? `Ocultar ${producto.nombre} del catálogo` : `Mostrar ${producto.nombre} en catálogo`}>
                        {producto.activo ? <FaEye /> : <FaEyeSlash />}
                      </button>
                      <button type="button" onClick={() => abrirModalEditar(producto)} className="prod-act prod-act--edit"
                        title="Editar información" aria-label={`Editar ${producto.nombre}`}>
                        <FaEdit />
                      </button>
                      <button type="button" onClick={() => eliminarProducto(producto)} className="prod-act prod-act--del"
                        title="Eliminar definitivamente (solo sin historial)" aria-label={`Eliminar ${producto.nombre}`}>
                        <FaTrash />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {!cargandoLista && productosFiltrados.length === 0 && (
              <tr>
                <td colSpan={7} className="prod-empty">
                  {productos.length === 0
                    ? 'Aún no hay productos. Crea el primero con "Nuevo producto".'
                    : `Sin resultados para "${busqueda}".`}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* MODAL CREAR / EDITAR */}
      {mostrarModal && (
        <div className="prod-modal" onClick={cerrarModal}>
          <div className="prod-dialog" ref={dialogRef} role="dialog" aria-modal="true"
            aria-labelledby="prod-dialog-title" onClick={e => e.stopPropagation()}>
            <div className="prod-dialog__head">
              <h3 id="prod-dialog-title">{modoEdicion ? 'Editar producto' : 'Registrar nuevo producto'}</h3>
              <button type="button" className="prod-dialog__close" onClick={cerrarModal} aria-label="Cerrar">
                <FaTimes />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="prod-form">

              <label className="prod-flabel">Nombre del producto
                <input type="text" placeholder="Ej. Polo personalizado" required
                  value={productoActual.nombre}
                  onChange={e => setProductoActual({ ...productoActual, nombre: e.target.value })}
                  className="prod-input"
                />
              </label>

              {/* Tipo de producto: solo se elige al crear (cambiarlo luego afectaría historial) */}
              {!modoEdicion && (
                <div className="prod-opts__group prod-tipo">
                  <span className="prod-opts__label">Tipo de producto</span>
                  <div className="prod-pills">
                    <button type="button"
                      className={`prod-pill ${!esKit ? 'prod-pill--on' : ''}`}
                      onClick={() => setProductoActual({ ...productoActual, tipo: 'simple' })}>
                      Producto simple
                    </button>
                    <button type="button"
                      className={`prod-pill ${esKit ? 'prod-pill--on' : ''}`}
                      onClick={() => setProductoActual({ ...productoActual, tipo: 'kit' })}>
                      Kit / conjunto
                    </button>
                  </div>
                  {esKit && (
                    <p className="prod-gallery__hint">
                      El kit es una plantilla de catálogo: no tiene variantes ni stock propios;
                      al cotizarlo se convierte en líneas normales por componente.
                    </p>
                  )}
                </div>
              )}

              {!esKit && (
                <div className="prod-opts__group">
                  <span className="prod-opts__label">Stock en tienda</span>
                  <div className="prod-pills">
                    <button type="button"
                      className={`prod-pill ${productoActual.controla_stock !== false ? 'prod-pill--on' : ''}`}
                      onClick={() => setProductoActual({ ...productoActual, controla_stock: true })}>
                      Controla stock
                    </button>
                    <button type="button"
                      className={`prod-pill ${productoActual.controla_stock === false ? 'prod-pill--on' : ''}`}
                      onClick={() => setProductoActual({ ...productoActual, controla_stock: false })}>
                      Bajo pedido / Confección
                    </button>
                  </div>
                  {productoActual.controla_stock === false && (
                    <p className="prod-gallery__hint">
                      No entra a Inventario ni se vende por el POS (se fabrica desde cero, sin
                      unidad física en tienda) — sigue visible en el catálogo con su precio normal.
                    </p>
                  )}
                </div>
              )}

              <label className="prod-flabel">Categoría
                {productoActual.id ? (
                  // mejoras.txt §9: categoría bloqueada al editar (cambiarla regenera variantes y rompe precios ya vendidos).
                  <input
                    className="prod-input"
                    value={categoriasConfig.find(c => c.id === productoActual.categoria_id)?.nombre ?? '—'}
                    disabled
                    readOnly
                    title="La categoría no se puede cambiar al editar un producto existente"
                  />
                ) : (
                  <select value={productoActual.categoria_id}
                    onChange={e => {
                      const catId = parseInt(e.target.value) || '';
                      setProductoActual({ ...productoActual, categoria_id: catId });
                      const nuevasOpciones = {};
                      setOpcionesDinamicas(nuevasOpciones);
                      regenerarVariantes(nuevasOpciones);
                    }}
                    className="prod-input"
                  >
                    <option value="">— Selecciona una categoría —</option>
                    {categoriasConfig.map(cat => (
                      <option key={cat.id} value={cat.id}>{cat.nombre}</option>
                    ))}
                  </select>
                )}
              </label>

              {/* Editor de composición del kit */}
              {esKit && (
                <div className="prod-vgrid">
                  <div className="prod-vgrid__hdr">
                    <p className="prod-vgrid__title">Componentes del conjunto</p>
                    <button type="button" className="prod-pill" onClick={agregarFilaKit}>
                      <FaPlus /> Añadir componente
                    </button>
                  </div>
                  {componentesKit.length === 0 && (
                    <p className="prod-gallery__hint">Añade los productos simples que forman el conjunto (ej. camiseta, short, medias).</p>
                  )}
                  {componentesKit.map((c, idx) => (
                    <div key={c._uid} className="prod-kit__row">
                      <select className="prod-input" value={c.componente_id}
                        onChange={e => setComponentesKit(prev => prev.map((x, i) =>
                          i === idx ? { ...x, componente_id: parseInt(e.target.value) || '' } : x))}>
                        <option value="">— Producto componente —</option>
                        {productos
                          .filter(p => (p.tipo ?? 'simple') === 'simple' && p.activo)
                          .map(p => (
                            <option key={p.id} value={p.id}>{p.nombre}</option>
                          ))}
                      </select>
                      <input type="number" min="1" className="prod-input prod-kit__qty"
                        title="Cantidad por kit"
                        value={c.cantidad_por_kit}
                        onChange={e => setComponentesKit(prev => prev.map((x, i) =>
                          i === idx ? { ...x, cantidad_por_kit: e.target.value } : x))}
                      />
                      <button type="button" className="prod-act prod-act--del" aria-label="Quitar componente"
                        onClick={() => setComponentesKit(prev => prev.filter((_, i) => i !== idx))}>
                        <FaTimes />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Atributos dinámicos de la categoría (tallas, telas, etc.) */}
              {!esKit && categoriasConfig
                .filter(cat => cat.id === productoActual.categoria_id)
                .map(cat => {
                  const atributos = cat.atributos ?? {};
                  if (Object.keys(atributos).length === 0) return null;
                  return (
                    <div key={cat.id} className="prod-opts">
                      <p className="prod-opts__title">Opciones para {cat.nombre}</p>
                      {Object.entries(atributos).map(([key, valores]) => (
                        <div key={key} className="prod-opts__group">
                          <span className="prod-opts__label">{key}</span>
                          <div className="prod-pills">
                            {valores.map(valor => {
                              const sel = (opcionesDinamicas[key] || []).includes(valor);
                              return (
                                <button type="button" key={valor}
                                  className={`prod-pill ${sel ? 'prod-pill--on' : ''}`}
                                  onClick={() => {
                                    const actuales = opcionesDinamicas[key] || [];
                                    const nuevas   = sel
                                      ? actuales.filter(v => v !== valor)
                                      : [...actuales, valor];
                                    const nuevasOpciones = { ...opcionesDinamicas, [key]: nuevas };
                                    setOpcionesDinamicas(nuevasOpciones);
                                    regenerarVariantes(nuevasOpciones);
                                  }}
                                >
                                  {valor}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })}

              {/* Grilla de variantes — precio por combinación (solo producto simple) */}
              {!esKit && (
              <div className="prod-vgrid">
                <div className="prod-vgrid__hdr">
                  <p className="prod-vgrid__title">Precios por variante</p>
                  <span className="prod-vgrid__badge">
                    {variantes.filter(v => v.activo).length} activas
                  </span>
                </div>
                <div className="prod-vgrid__table">
                  <div className="prod-vgrid__thead">
                    <span>Combinación</span>
                    <span>Precio (S/)</span>
                    <span>SKU</span>
                    <span>Activa</span>
                  </div>
                  {variantes.map((v, idx) => (
                    <div key={v.key !== undefined ? v.key : idx}
                      className={`prod-vgrid__row ${!v.activo ? 'prod-vgrid__row--off' : ''}`}>
                      <span className="prod-vgrid__combo">
                        {Object.values(v.atributos).join(' / ') || '(única)'}
                        {v.id && agotadas[v.id] && <span className="prod-tag prod-tag--agotado">Agotada</span>}
                      </span>
                      <input type="number" step="0.01" placeholder="0.00"
                        className={`prod-input prod-vgrid__price ${
                          v.activo && (!v.precio_base || parseFloat(v.precio_base) <= 0)
                            ? 'prod-input--error' : ''
                        }`}
                        value={v.precio_base}
                        onChange={e => actualizarVariante(idx, 'precio_base', e.target.value)}
                      />
                      <input type="text" placeholder="SKU (opc.)"
                        className="prod-input prod-vgrid__sku"
                        value={v.sku}
                        onChange={e => actualizarVariante(idx, 'sku', e.target.value)}
                      />
                      <label className="prod-vgrid__toggle">
                        <input type="checkbox" checked={v.activo}
                          aria-label={`Variante activa: ${Object.values(v.atributos).join(' / ') || 'única'}`}
                          onChange={e => actualizarVariante(idx, 'activo', e.target.checked)}
                        />
                      </label>
                    </div>
                  ))}
                </div>
              </div>
              )}

              <label className="prod-flabel">Descripción
                <textarea placeholder="Descripción corta" required rows="3"
                  value={productoActual.descripcion}
                  onChange={e => setProductoActual({ ...productoActual, descripcion: e.target.value })}
                  className="prod-input prod-textarea"
                />
              </label>

              {/* Galería de imágenes */}
              <div className="prod-gallery">
                <p className="prod-gallery__title">Imágenes del producto</p>
                <p className="prod-gallery__hint">La primera imagen será la portada en el catálogo.</p>
                <div className="prod-thumbs">
                  {productoActual.imagenesExistentes.map(url => (
                    <div key={url} className="prod-pic">
                      <img src={url} alt="imagen del producto" />
                      <button type="button" onClick={() => quitarExistente(url)} aria-label="Quitar imagen">
                        <FaTimes />
                      </button>
                    </div>
                  ))}
                  {productoActual.imagenesNuevas.map((file, idx) => (
                    <div key={`${file.name}-${file.lastModified}-${idx}`} className="prod-pic prod-pic--new">
                      <img src={previewsNuevas[idx]} alt={file.name} />
                      <button type="button" onClick={() => quitarNueva(idx)} aria-label="Quitar imagen">
                        <FaTimes />
                      </button>
                    </div>
                  ))}
                  <label className="prod-addpic">
                    <FaPlus />
                    <span>Añadir</span>
                    <input type="file" accept="image/*" multiple
                      onChange={e => { agregarArchivos(e.target.files); e.target.value = ''; }}
                    />
                  </label>
                </div>
              </div>

              <div className="prod-form__foot">
                <button type="button" onClick={cerrarModal} disabled={cargando} className="prod-btn prod-btn--ghost">
                  Cancelar
                </button>
                <button type="submit" disabled={cargando} className="prod-btn prod-btn--primary">
                  {cargando
                    ? <><FaSpinner className="prod-spin" /> Guardando…</>
                    : (modoEdicion ? 'Actualizar' : 'Guardar producto')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Productos;
