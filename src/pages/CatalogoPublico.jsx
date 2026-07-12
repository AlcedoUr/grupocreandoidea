import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  FaSearch, FaUser, FaThLarge, FaStar, FaWhatsapp,
  FaArrowRight, FaChevronDown, FaTimes, FaMapMarkerAlt,
  FaTshirt, FaMugHot, FaRedhat, FaPaintBrush,
  FaFacebook, FaInstagram,
} from 'react-icons/fa';
import { supabase } from '../supabase/client';
import './CatalogoPublico.css';

const ICONO_CATEGORIA = {
  'Polos': <FaTshirt />,
  'Tazas': <FaMugHot />,
  'Gorras': <FaRedhat />,
};

const WHATSAPP_FALLBACK = '51999999999';
const DIRECCION_FALLBACK = 'Lima, Perú';

const soloDigitos = (txt) => (txt ?? '').replace(/\D/g, '');

const precioDesde = (variantes) => {
  const activas = (variantes ?? []).filter(v => v.activo);
  if (!activas.length) return null;
  return Math.min(...activas.map(v => parseFloat(v.precio_base ?? 0)));
};

const imagenPortada = (imagenes) => {
  if (!imagenes?.length) return null;
  return [...imagenes].sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))[0].url;
};

const ORDENES = [
  { valor: 'relevancia',  etiqueta: 'Destacados primero' },
  { valor: 'precio-asc',  etiqueta: 'Precio: menor a mayor' },
  { valor: 'precio-desc', etiqueta: 'Precio: mayor a menor' },
  { valor: 'nombre',      etiqueta: 'Nombre (A–Z)' },
];

const ordenarProductos = (lista, criterio) => {
  const arr = [...lista];
  switch (criterio) {
    case 'precio-asc':
      return arr.sort((a, b) => (precioDesde(a.producto_variantes) ?? Infinity) - (precioDesde(b.producto_variantes) ?? Infinity));
    case 'precio-desc':
      return arr.sort((a, b) => (precioDesde(b.producto_variantes) ?? 0) - (precioDesde(a.producto_variantes) ?? 0));
    case 'nombre':
      return arr.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
    default:
      return arr.sort((a, b) => (b.es_destacado ? 1 : 0) - (a.es_destacado ? 1 : 0));
  }
};

// ── Tarjeta de producto — vitrina pura + CTA WhatsApp ──
const ProductoCard = ({ producto, whatsapp, onClick, agotado }) => {
  const cover = imagenPortada(producto.producto_imagenes);
  const desde = precioDesde(producto.producto_variantes);

  // Mensaje enriquecido: producto + link a la ficha (el asesor abre la foto desde ahí)
  const msgWa = [
    'Hola, quiero cotizar:',
    `*${producto.nombre}*`,
    `${window.location.origin}/producto/${producto.id}`,
  ].join('\n');
  const linkWa = `https://wa.me/${whatsapp}?text=${encodeURIComponent(msgWa)}`;

  return (
    <div className={`cat-card ${agotado ? 'cat-card--agotado' : ''}`}>
      <button type="button" onClick={onClick} className="cat-card__clickable">
        <div className="cat-card__media">
          {cover ? (
            <img src={cover} alt={producto.nombre} loading="lazy" className="cat-card__img" />
          ) : (
            <span className="cat-card__noimg">Sin foto</span>
          )}

          {producto.es_destacado && (
            <span className="cat-card__badge cat-card__badge--featured">
              <FaStar /> Destacado
            </span>
          )}
          {producto.es_personalizable && (
            <span className="cat-card__badge cat-card__badge--perso">
              <FaPaintBrush /> Personalizable
            </span>
          )}
          {agotado && (
            <span className="cat-card__badge cat-card__badge--agotado">
              Agotado
            </span>
          )}

          <span className="cat-card__overlay">
            Ver detalle <FaArrowRight />
          </span>
        </div>

        <div className="cat-card__body">
          <span className="cat-card__brand">{producto.categorias?.nombre ?? 'Creando Ideas'}</span>
          <h3 className="cat-card__name">{producto.nombre}</h3>
          {producto.tipo === 'kit' ? (
            <span className="cat-card__price cat-card__price--consult">Se cotiza</span>
          ) : desde != null ? (
            <span className="cat-card__price">
              <span className="cat-card__price-desde">Desde</span> S/ {desde.toFixed(2)}
            </span>
          ) : (
            <span className="cat-card__price cat-card__price--consult">Consultar precio</span>
          )}
        </div>
      </button>

      <a href={linkWa} target="_blank" rel="noopener noreferrer" className="cat-card__wabtn">
        <FaWhatsapp /> {agotado ? 'Consultar disponibilidad' : 'Cotizar por WhatsApp'}
      </a>
    </div>
  );
};

const SkeletonCard = () => (
  <div className="cat-skel" aria-hidden="true">
    <div className="cat-skel__media" />
    <div className="cat-skel__line cat-skel__line--sm" />
    <div className="cat-skel__line cat-skel__line--lg" />
    <div className="cat-skel__line cat-skel__line--price" />
    <div className="cat-skel__line cat-skel__line--btn" />
  </div>
);

// ── Página principal ──
const CatalogoPublico = () => {
  const [productos, setProductos]   = useState([]);
  const [categorias, setCategorias] = useState([]);
  const [filtro, setFiltro]         = useState('Todos');
  const [busqueda, setBusqueda]     = useState('');
  const [orden, setOrden]           = useState('relevancia');
  const [cargando, setCargando]     = useState(true);
  const [whatsapp, setWhatsapp]     = useState(WHATSAPP_FALLBACK);
  const [localPrincipal, setLocalPrincipal] = useState(null);
  const [busquedaMovil, setBusquedaMovil]   = useState(false);
  const [promos, setPromos]         = useState([]);
  const [agotadas, setAgotadas]     = useState({}); // variante_id → true si agotada
  const [error, setError]           = useState('');
  const navigate = useNavigate();

  const limpiarFiltros = () => { setFiltro('Todos'); setBusqueda(''); };

  useEffect(() => {
    const cargarDatos = async () => {
      try {
        const [{ data: cats }, { data: prods }, { data: config }, { data: local }, { data: banners }, { data: disp }] = await Promise.all([
          supabase.from('categorias').select('id, nombre').eq('activo', true).order('nombre'),
          supabase
            .from('productos')
            .select('id, nombre, tipo, es_personalizable, es_destacado, categorias(nombre), producto_variantes(id, precio_base, activo), producto_imagenes(url, orden)')
            .eq('activo', true),
          supabase.from('empresa_publica').select('whatsapp_oficial, nombre_empresa').maybeSingle(),
          supabase.from('locales').select('nombre, direccion, lat, lng').eq('id', 1).maybeSingle(),
          // RLS: anon solo ve promociones activas y vigentes
          supabase.from('promociones').select('id, titulo, imagen_url, link_url, orden').order('orden'),
          // Vista pública: solo booleano de agotado por variante, nunca cantidades
          supabase.from('catalogo_disponibilidad').select('variante_id, agotada'),
        ]);
        setCategorias(cats ?? []);
        setProductos(prods ?? []);
        const num = soloDigitos(config?.whatsapp_oficial);
        if (num) setWhatsapp(num);
        // Título del sitio y meta descripción desde la config (fallback: el del index.html)
        if (config?.nombre_empresa) {
          document.title = `${config.nombre_empresa} — Personalización & Catálogo`;
          let metaDesc = document.querySelector('meta[name="description"]');
          if (!metaDesc) {
            metaDesc = document.createElement('meta');
            metaDesc.name = 'description';
            document.head.appendChild(metaDesc);
          }
          metaDesc.content = `Catálogo oficial de ${config.nombre_empresa}. Personaliza polos, tazas y gorras con tus propios diseños. Estampado de alta calidad y envíos rápidos.`;
        }
        if (local) setLocalPrincipal(local);
        setPromos(banners ?? []);
        const mapa = {};
        (disp ?? []).forEach(d => { mapa[d.variante_id] = !!d.agotada; });
        setAgotadas(mapa);
      } catch {
        setError('No se pudo cargar el catálogo. Intenta recargar la página.');
      } finally {
        setCargando(false);
      }
    };
    cargarDatos();
  }, []);

  // Producto agotado = todas sus variantes activas agotadas (kits nunca: se cotizan)
  const estaAgotado = (p) => {
    if (p.tipo === 'kit') return false;
    const activas = (p.producto_variantes ?? []).filter(v => v.activo);
    return activas.length > 0 && activas.every(v => agotadas[v.id]);
  };

  const imagenPorCategoria = {};
  productos.forEach(p => {
    const nom = p.categorias?.nombre;
    const cover = imagenPortada(p.producto_imagenes);
    if (nom && cover && !imagenPorCategoria[nom]) imagenPorCategoria[nom] = cover;
  });

  const productosFiltrados = ordenarProductos(
    productos.filter(p => {
      const nombreCategoria = p.categorias?.nombre ?? '';
      const pasaCategoria = filtro === 'Todos' || nombreCategoria === filtro;
      const pasaBusqueda  = p.nombre.toLowerCase().includes(busqueda.toLowerCase());
      return pasaCategoria && pasaBusqueda;
    }),
    orden,
  );

  const destacados        = productos.filter(p => p.es_destacado);
  const mostrarDestacados = filtro === 'Todos' && busqueda.trim() === '' && destacados.length > 0;

  const linkWhatsapp   = `https://wa.me/${whatsapp}?text=${encodeURIComponent('¡Hola! Quisiera más información sobre sus productos personalizados.')}`;
  const direccionLocal = localPrincipal?.direccion || DIRECCION_FALLBACK;
  // Con coordenadas el pin es exacto; sin ellas, Google geocodea el texto (aproximado).
  const mapaQuery = (localPrincipal?.lat != null && localPrincipal?.lng != null)
    ? `${localPrincipal.lat},${localPrincipal.lng}`
    : direccionLocal;

  return (
    <div className="cat-page">

      {/* BARRA DE NAVEGACIÓN */}
      <header className="cat-nav">
        <div className="cat-nav__inner">
          <Link to="/" className="cat-logo" aria-label="Grupo Creando Ideas — inicio">
            <span className="cat-logo__a">CREANDO</span> <span className="cat-logo__b">IDEAS</span>
          </Link>

          <div className="cat-search">
            <FaSearch className="cat-search__icon" />
            <input
              type="text"
              placeholder="¿Qué quieres personalizar hoy?"
              aria-label="Buscar producto"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              className="cat-search__input"
            />
            {busqueda && (
              <button type="button" onClick={() => setBusqueda('')} aria-label="Limpiar búsqueda" className="cat-search__clear">
                <FaTimes />
              </button>
            )}
          </div>

          <div className="cat-nav__actions">
            <a href={linkWhatsapp} target="_blank" rel="noopener noreferrer" className="cat-wsp-nav">
              <FaWhatsapp /> <span>WhatsApp</span>
            </a>
            <Link to="/login" className="cat-login">
              <FaUser /> <span>Iniciar sesión</span>
            </Link>
            <button
              type="button"
              onClick={() => setBusquedaMovil(v => !v)}
              className="cat-iconbtn cat-iconbtn--mobile"
              aria-label="Buscar"
              aria-expanded={busquedaMovil}
            >
              <FaSearch />
            </button>
          </div>
        </div>

        {busquedaMovil && (
          <div className="cat-mobile-search">
            <div className="cat-search cat-search--mobile">
              <FaSearch className="cat-search__icon" />
              <input
                type="text"
                placeholder="¿Qué quieres personalizar?"
                aria-label="Buscar producto"
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                className="cat-search__input"
                autoFocus
              />
              {busqueda && (
                <button type="button" onClick={() => setBusqueda('')} aria-label="Limpiar búsqueda" className="cat-search__clear">
                  <FaTimes />
                </button>
              )}
            </div>
          </div>
        )}
      </header>

      <main className="cat-main">

        {error && <p className="cat-error" role="alert">{error}</p>}

        {/* HERO SECTION */}
        <section className="cat-hero">
          <div className="cat-hero__content">
            <h1 className="cat-hero__title">Personaliza tus ideas con nosotros</h1>
            <p className="cat-hero__subtitle">
              Elige tu producto favorito y recibe una personalización de alta calidad. Realizamos envíos rápidos y ofrecemos garantía total.
            </p>
            <div className="cat-hero__actions">
              <a href={linkWhatsapp} target="_blank" rel="noopener noreferrer" className="cat-hero__btn cat-hero__btn--primary">
                <FaWhatsapp /> Escríbenos por WhatsApp
              </a>
            </div>
          </div>
        </section>

        {/* CATEGORÍAS */}
        <section className="cat-categories" aria-label="Categorías">
          <div className="cat-cats-track">
            <button className="cat-cat" onClick={() => setFiltro('Todos')} aria-pressed={filtro === 'Todos'}>
              <span className={`cat-cat__circle${filtro === 'Todos' ? ' is-active' : ''}`}>
                <FaThLarge />
              </span>
              <span className="cat-cat__label">Todo</span>
            </button>
            {categorias.map(cat => (
              <button key={cat.id} className="cat-cat" onClick={() => setFiltro(cat.nombre)} aria-pressed={filtro === cat.nombre}>
                <span className={`cat-cat__circle${filtro === cat.nombre ? ' is-active' : ''}`}>
                  {imagenPorCategoria[cat.nombre] ? (
                    <img src={imagenPorCategoria[cat.nombre]} alt={cat.nombre} loading="lazy" className="cat-cat__img" />
                  ) : (
                    ICONO_CATEGORIA[cat.nombre] ?? <FaThLarge />
                  )}
                </span>
                <span className="cat-cat__label">{cat.nombre}</span>
              </button>
            ))}
          </div>
        </section>

        {/* BANNERS DE PROMOCIONES (solo si hay vigentes) */}
        {!cargando && promos.length > 0 && (
          <section className="cat-promos" aria-label="Promociones">
            {promos.map(promo => {
              const esInterno = promo.link_url?.startsWith('/');
              const contenido = (
                <img src={promo.imagen_url} alt={promo.titulo} loading="lazy" className="cat-promo__img" />
              );
              if (!promo.link_url) {
                return <div key={promo.id} className="cat-promo">{contenido}</div>;
              }
              return esInterno ? (
                <Link key={promo.id} to={promo.link_url} className="cat-promo" aria-label={promo.titulo}>
                  {contenido}
                </Link>
              ) : (
                <a key={promo.id} href={promo.link_url} target="_blank" rel="noopener noreferrer" className="cat-promo" aria-label={promo.titulo}>
                  {contenido}
                </a>
              );
            })}
          </section>
        )}

        {/* DESTACADOS */}
        {!cargando && mostrarDestacados && (
          <section className="cat-block">
            <div className="cat-block__head">
              <span className="cat-block__icon"><FaStar /></span>
              <h2 className="cat-block__title">Productos destacados</h2>
            </div>
            <div className="cat-grid">
              {destacados.map(p => (
                <ProductoCard
                  key={p.id}
                  producto={p}
                  whatsapp={whatsapp}
                  agotado={estaAgotado(p)}
                  onClick={() => navigate(`/producto/${p.id}`)}
                />
              ))}
            </div>
          </section>
        )}

        {/* CATÁLOGO COMPLETO */}
        <section className="cat-block">
          <div className="cat-toolbar">
            <div className="cat-toolbar__heading">
              <h2 className="cat-block__title">{filtro === 'Todos' ? 'Todo el catálogo' : filtro}</h2>
              {!cargando && <span className="cat-toolbar__count">{productosFiltrados.length} productos</span>}
            </div>
            <div className="cat-sort">
              <label htmlFor="orden-catalogo" className="cat-sr-only">Ordenar productos</label>
              <select
                id="orden-catalogo"
                value={orden}
                onChange={(e) => setOrden(e.target.value)}
                className="cat-sort__select"
              >
                {ORDENES.map(o => <option key={o.valor} value={o.valor}>{o.etiqueta}</option>)}
              </select>
              <FaChevronDown className="cat-sort__icon" />
            </div>
          </div>

          {cargando ? (
            <div className="cat-grid">
              {Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)}
            </div>
          ) : productosFiltrados.length === 0 ? (
            <div className="cat-empty">
              <span className="cat-empty__icon"><FaSearch /></span>
              <p className="cat-empty__title">Sin resultados</p>
              <p className="cat-empty__text">
                No encontramos productos
                {busqueda.trim() ? <> para «<strong>{busqueda.trim()}</strong>»</> : ' en esta categoría'}.
                Prueba con otra búsqueda o escríbenos por WhatsApp.
              </p>
              <div className="cat-empty__actions">
                <button type="button" onClick={limpiarFiltros} className="cat-btn cat-btn--primary">
                  Ver todo el catálogo
                </button>
                <a href={linkWhatsapp} target="_blank" rel="noopener noreferrer" className="cat-btn cat-btn--ghost">
                  <FaWhatsapp /> Consultar
                </a>
              </div>
            </div>
          ) : (
            <div className="cat-grid">
              {productosFiltrados.map(p => (
                <ProductoCard
                  key={p.id}
                  producto={p}
                  whatsapp={whatsapp}
                  agotado={estaAgotado(p)}
                  onClick={() => navigate(`/producto/${p.id}`)}
                />
              ))}
            </div>
          )}
        </section>

        {/* BANNER CTA */}
        <section className="cat-banner">
          <div className="cat-banner__inner">
            <div className="cat-banner__text">
              <p className="cat-banner__title">¿No encuentras lo que buscas?</p>
              <p className="cat-banner__sub">Personalizamos cualquier producto. Escríbenos y lo hacemos realidad.</p>
            </div>
            <a href={linkWhatsapp} target="_blank" rel="noopener noreferrer" className="cat-btn cat-btn--wsp">
              <FaWhatsapp /> Hablar con un asesor
            </a>
          </div>
        </section>
      </main>

      {/* CONTACTO / MAPA */}
      <section className="cat-contact">
        <div className="cat-contact__inner">
          <h2 className="cat-contact__title">Visítanos o escríbenos</h2>
          <p className="cat-contact__text">
            Visítanos en {direccionLocal} — a un mensaje de distancia por WhatsApp.
          </p>
          <div className="cat-map-wrap">
            <iframe
              title="Ubicación Grupo Creando Ideas"
              src={`https://maps.google.com/maps?q=${encodeURIComponent(mapaQuery)}&z=16&output=embed`}
              className="cat-map"
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              allowFullScreen
            />
            <div className="cat-contact-card">
              <div className="cat-contact-card__head">
                <span className="cat-contact-card__pin"><FaMapMarkerAlt /></span>
                <div>
                  <p className="cat-contact-card__name">{localPrincipal?.nombre ?? 'Grupo Creando Ideas'}</p>
                  <p className="cat-contact-card__addr">{direccionLocal}</p>
                  <p className="cat-contact-card__hours">Atención: Lun a Sáb · 9am – 6pm</p>
                </div>
              </div>
              <a href={linkWhatsapp} target="_blank" rel="noopener noreferrer" className="cat-btn cat-btn--primary cat-contact-card__cta">
                <FaWhatsapp /> Escríbenos por WhatsApp
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* PIE */}
      <footer className="cat-footer">
        <div className="cat-footer__inner">
          <div className="cat-footer__brand">
            <Link to="/" className="cat-logo" aria-label="Grupo Creando Ideas">
              <span className="cat-logo__a">CREANDO</span> <span className="cat-logo__b">IDEAS</span>
            </Link>
            <p className="cat-footer__tag">Personalización propia · Comas, Lima — Perú</p>
            <div className="cat-footer__socials">
              <a href="https://facebook.com" target="_blank" rel="noopener noreferrer" className="cat-footer__social-btn" aria-label="Facebook"><FaFacebook /></a>
              <a href="https://instagram.com" target="_blank" rel="noopener noreferrer" className="cat-footer__social-btn" aria-label="Instagram"><FaInstagram /></a>
              <a href={linkWhatsapp} target="_blank" rel="noopener noreferrer" className="cat-footer__social-btn" aria-label="WhatsApp"><FaWhatsapp /></a>
            </div>
          </div>

          <nav className="cat-footer__col" aria-label="Categorías">
            <p className="cat-footer__h">Categorías</p>
            <ul>
              {categorias.map(cat => (
                <li key={cat.id}>
                  <button
                    type="button"
                    className="cat-footer__link"
                    onClick={() => { setFiltro(cat.nombre); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                  >
                    {cat.nombre}
                  </button>
                </li>
              ))}
            </ul>
          </nav>

          <div className="cat-footer__col">
            <p className="cat-footer__h">Contacto</p>
            <ul>
              <li><a className="cat-footer__link" href={linkWhatsapp} target="_blank" rel="noopener noreferrer">WhatsApp</a></li>
              <li><Link className="cat-footer__link" to="/login">Acceso administrativo</Link></li>
            </ul>
          </div>
        </div>
        <p className="cat-footer__copy">© {new Date().getFullYear()} Grupo Creando Ideas · Comas, Lima — Perú</p>
      </footer>

      {/* WHATSAPP FLOTANTE */}
      <a
        href={linkWhatsapp}
        target="_blank"
        rel="noopener noreferrer"
        className="cat-wsp"
        aria-label="Habla con un asesor por WhatsApp"
      >
        <FaWhatsapp className="cat-wsp__icon" />
        <span className="cat-wsp__label">Habla con un asesor</span>
      </a>
    </div>
  );
};

export default CatalogoPublico;
