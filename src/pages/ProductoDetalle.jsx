import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  FaArrowLeft, FaStar, FaWhatsapp, FaPaintBrush, FaChevronRight,
  FaMinus, FaPlus,
} from 'react-icons/fa';
import { supabase } from '../supabase/client';
import './ProductoDetalle.css';

const WHATSAPP_FALLBACK = '51999999999';
const soloDigitos = (txt) => (txt ?? '').replace(/\D/g, '');

const precioDesde = (variantes) => {
  const activas = (variantes ?? []).filter(v => v.activo);
  if (!activas.length) return null;
  return Math.min(...activas.map(v => parseFloat(v.precio_base ?? 0)));
};

/* Formatea atributos como "Talla: M · Color: Blanco" */
const fmtAtributos = (attrs) => {
  if (!attrs || typeof attrs !== 'object') return '';
  return Object.entries(attrs).map(([k, v]) => `${k}: ${v}`).join(' · ');
};

const ProductoDetalle = () => {
  const { id } = useParams();
  const navigate = useNavigate();

  const [producto, setProducto]   = useState(null);
  const [error, setError]         = useState(null);
  const [imgActiva, setImgActiva] = useState(0);
  const [whatsapp, setWhatsapp]   = useState(WHATSAPP_FALLBACK);
  const [agotadas, setAgotadas]   = useState({}); // variante_id → true
  // Selector por etiquetas (mejoras.txt §3): un grupo de botones por atributo, no por combinación cruzada.
  const [seleccion, setSeleccion] = useState({});
  const [cantidad, setCantidad]   = useState(1);

  const cargaIdRef = useRef(0);
  useEffect(() => {
    const miCarga = ++cargaIdRef.current;
    const cargar = async () => {
      const [{ data, error: err }, { data: cfg }, { data: disp }] = await Promise.all([
        supabase
          .from('productos')
          .select('*, categorias(nombre), producto_variantes(id, precio_base, atributos, activo), producto_imagenes(url, orden), kit_componentes!kit_id(cantidad_por_kit, orden, componente:productos!componente_id(id, nombre))')
          .eq('id', id)
          .single(),
        supabase.from('empresa_publica').select('whatsapp_oficial').maybeSingle(),
        // Vista pública: solo booleano de agotado, nunca cantidades
        supabase.from('catalogo_disponibilidad').select('variante_id, agotada'),
      ]);
      if (miCarga !== cargaIdRef.current) return; // el usuario ya navegó a otro producto
      if (err) { setError('No se pudo cargar el producto.'); return; }
      setProducto(data);
      setImgActiva(0);
      setSeleccion({});
      setCantidad(1);
      if (data) {
        document.title = `${data.nombre} | Grupo Creando Ideas`;
        let metaDesc = document.querySelector('meta[name="description"]');
        if (!metaDesc) {
          metaDesc = document.createElement('meta');
          metaDesc.name = 'description';
          document.head.appendChild(metaDesc);
        }
        metaDesc.content = `${data.descripcion || ''} - Personaliza este producto con tus propios diseños en Grupo Creando Ideas.`;
      }
      const num = soloDigitos(cfg?.whatsapp_oficial);
      if (num) setWhatsapp(num);
      const mapa = {};
      (disp ?? []).forEach(d => { mapa[d.variante_id] = !!d.agotada; });
      setAgotadas(mapa);
    };
    cargar();
  }, [id]);

  if (error)     return <div className="pd-page"><div className="pd-state pd-state--error">{error}</div></div>;
  if (!producto) return <div className="pd-page"><div className="pd-state">Cargando…</div></div>;

  // Galería desde producto_imagenes ordenada por `orden`; fallback a imagen_url
  const galeria = producto.producto_imagenes?.length
    ? [...producto.producto_imagenes].sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0)).map(i => i.url)
    : (producto.imagen_url ? [producto.imagen_url] : []);

  const imagenMostrada = galeria[imgActiva] ?? null;
  const desde          = precioDesde(producto.producto_variantes);
  const esKit          = producto.tipo === 'kit';

  const variantes = (producto.producto_variantes ?? []).filter(v => v.activo);

  // Atributos como facetas (talla, color…): valores posibles por atributo, no por combinación cruzada.
  const atributoKeys = [];
  variantes.forEach(v => Object.keys(v.atributos || {}).forEach(k => {
    if (!atributoKeys.includes(k)) atributoKeys.push(k);
  }));
  const valoresPorAtributo = {};
  atributoKeys.forEach(k => {
    valoresPorAtributo[k] = [];
    variantes.forEach(v => {
      const val = v.atributos?.[k];
      if (val && !valoresPorAtributo[k].includes(val)) valoresPorAtributo[k].push(val);
    });
  });

  // Variante que calza exacto con lo elegido; precio se recalcula en cada render.
  const seleccionCompleta = atributoKeys.every(k => seleccion[k]);
  const selVariante = seleccionCompleta
    ? variantes.find(v => atributoKeys.every(k => v.atributos?.[k] === seleccion[k])) ?? null
    : null;

  // Valor alcanzable junto con lo ya elegido en los demás atributos; si no, se deshabilita.
  const valorDisponible = (atributo, valor) => variantes.some(v =>
    v.atributos?.[atributo] === valor &&
    atributoKeys.every(k => k === atributo || !seleccion[k] || v.atributos?.[k] === seleccion[k])
  );
  const valorAgotado = (atributo, valor) => !variantes.some(v =>
    v.atributos?.[atributo] === valor &&
    !agotadas[v.id] &&
    atributoKeys.every(k => k === atributo || !seleccion[k] || v.atributos?.[k] === seleccion[k])
  );

  const elegirValor = (atributo, valor) =>
    setSeleccion(prev => ({ ...prev, [atributo]: prev[atributo] === valor ? undefined : valor }));

  // Mensaje enriquecido: producto + variante elegida + cantidad + link a la ficha
  const msgWa = [
    'Hola, quiero cotizar:',
    `*${producto.nombre}*`,
    selVariante ? `Variante: ${fmtAtributos(selVariante.atributos) || 'única'}` : '',
    selVariante ? `Cantidad: ${cantidad}` : '',
    `${window.location.origin}/producto/${producto.id}`,
  ].filter(Boolean).join('\n');
  const linkWa = `https://wa.me/${whatsapp}?text=${encodeURIComponent(msgWa)}`;
  const necesitaVariante = !esKit && variantes.length > 0 && !selVariante;

  return (
    <div className="pd-page">
      <div className="pd-container">
        <button className="pd-back" onClick={() => navigate('/')}>
          <FaArrowLeft /> Volver al Catálogo
        </button>

        <nav className="pd-crumbs" aria-label="Ruta de navegación">
          <Link to="/" className="pd-crumbs__link">Inicio</Link>
          <FaChevronRight className="pd-crumbs__sep" />
          <span>{producto.categorias?.nombre ?? 'Catálogo'}</span>
          <FaChevronRight className="pd-crumbs__sep" />
          <span className="pd-crumbs__current">{producto.nombre}</span>
        </nav>

        <div className="pd-layout">

          {/* GALERÍA */}
          <div className="pd-media">
            <div className="pd-media__main">
              {imagenMostrada
                ? <img src={imagenMostrada} alt={producto.nombre} className="pd-media__img" loading="lazy" />
                : <div className="pd-media__noimg">Sin imagen</div>
              }
              {producto.es_destacado && (
                <div className="pd-badge pd-badge--featured"><FaStar /> Producto Destacado</div>
              )}
              {producto.es_personalizable && (
                <div className="pd-badge pd-badge--perso"><FaPaintBrush /> Personalizable</div>
              )}
            </div>

            {galeria.length > 1 && (
              <div className="pd-thumbs">
                {galeria.map((url, i) => (
                  <button
                    key={url + i}
                    type="button"
                    className={`pd-thumb${i === imgActiva ? ' is-active' : ''}`}
                    onClick={() => setImgActiva(i)}
                    aria-label={`Ver imagen ${i + 1}`}
                    aria-pressed={i === imgActiva}
                  >
                    <img src={url} alt={`${producto.nombre} — imagen ${i + 1}`} loading="lazy" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* INFO */}
          <div className="pd-info">
            <span className="pd-categoria">{producto.categorias?.nombre}</span>
            <h1 className="pd-titulo">{producto.nombre}</h1>
            <p className="pd-desc">{producto.descripcion}</p>

            {/* Precio exacto de la variante, o "desde" si falta completar selección (mejoras.txt §3) */}
            <div className="pd-precio">
              {selVariante ? (
                <div className="pd-precio__num-wrap">
                  <span className="pd-precio__desde">Precio</span>
                  <span className="pd-precio__num">S/ {Number(selVariante.precio_base).toFixed(2)}</span>
                </div>
              ) : desde != null ? (
                <>
                  <div className="pd-precio__num-wrap">
                    <span className="pd-precio__desde">Desde</span>
                    <span className="pd-precio__num">S/ {desde.toFixed(2)}</span>
                  </div>
                  <p className="pd-precio__nota">Precios referenciales — el precio final se cotiza según el estampado/diseño.</p>
                </>
              ) : (
                <span className="pd-precio__consult">Consultar precio</span>
              )}
            </div>

            {/* Composición del kit (producto compuesto) */}
            {(producto.kit_componentes ?? []).length > 0 && (
              <div className="pd-atributos">
                <div className="pd-atributo">
                  <span className="pd-atributo__clave">El conjunto incluye</span>
                  <span className="pd-atributo__vals">
                    {[...producto.kit_componentes]
                      .sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))
                      .map(c => `${c.componente?.nombre}${c.cantidad_por_kit > 1 ? ` ×${c.cantidad_por_kit}` : ''}`)
                      .join(' · ')}
                  </span>
                </div>
              </div>
            )}

            {/* Selector por etiquetas: un grupo de botones por atributo (mejoras.txt §3) */}
            {!esKit && variantes.length > 0 && (
              <div className="pd-variantes" id="pd-variantes-title">
                {atributoKeys.map(atributo => (
                  <div key={atributo} className="pd-var-grupo">
                    <p className="pd-variantes__title" id={`pd-var-title-${atributo}`}>
                      {atributo.charAt(0).toUpperCase() + atributo.slice(1)}
                    </p>
                    <div className="pd-variantes__list" role="group" aria-labelledby={`pd-var-title-${atributo}`}>
                      {valoresPorAtributo[atributo].map(valor => {
                        const disponible = valorDisponible(atributo, valor);
                        const agotado    = valorAgotado(atributo, valor);
                        const activo     = seleccion[atributo] === valor;
                        return (
                          <button
                            key={valor}
                            type="button"
                            className={`pd-var${activo ? ' is-active' : ''}${agotado ? ' pd-var--agotada' : ''}`}
                            onClick={() => { elegirValor(atributo, valor); setCantidad(1); }}
                            disabled={!disponible}
                            aria-pressed={activo}
                          >
                            <span className="pd-var__attrs">{valor}</span>
                            {agotado && <span className="pd-var__meta"><span className="pd-var__stock">Agotado</span></span>}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
                {selVariante && agotadas[selVariante.id] && (
                  <p className="pd-var__aviso">Variante sujeta a disponibilidad — consultar por WhatsApp.</p>
                )}
                {selVariante && (
                  <div className="pd-cantidad">
                    <span className="pd-cantidad__label" id="pd-cantidad-label">Cantidad</span>
                    <div className="pd-cantidad__ctrl" role="group" aria-labelledby="pd-cantidad-label">
                      <button type="button" onClick={() => setCantidad(c => Math.max(1, c - 1))} aria-label="Restar"><FaMinus /></button>
                      <span className="pd-cantidad__num" role="status" aria-live="polite">{cantidad}</span>
                      <button type="button" onClick={() => setCantidad(c => c + 1)} aria-label="Sumar"><FaPlus /></button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {producto.es_personalizable && (
              <div className="pd-perso-note">
                <FaPaintBrush className="pd-perso-note__icon" />
                <p>Este producto se personaliza con tu diseño, logo o estampado. Envíanos tu referencia por WhatsApp.</p>
              </div>
            )}

            {/* CTA principal */}
            <div className="pd-cta-container">
              {necesitaVariante ? (
                <button
                  type="button"
                  className="pd-cta-wa pd-cta-wa--disabled"
                  onClick={() => document.getElementById('pd-variantes-title')?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
                >
                  <FaWhatsapp /> Elige una variante primero
                </button>
              ) : (
                <a href={linkWa} target="_blank" rel="noopener noreferrer" className="pd-cta-wa">
                  <FaWhatsapp /> Cotizar por WhatsApp
                </a>
              )}
            </div>
            <p className="pd-cta-hint">Respondemos en minutos · Lun a Sáb · 9am – 6pm</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProductoDetalle;
