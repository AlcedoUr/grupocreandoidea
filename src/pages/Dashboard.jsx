import React, { useState, Suspense } from 'react';
import { useNavigate, Outlet, NavLink } from 'react-router-dom';
import {
  PiHouseBold, PiPackageBold, PiClipboardTextBold, PiWarehouseBold, PiGearBold,
  PiSignOutBold, PiListBold, PiXBold, PiCashRegisterBold, PiUsersBold, PiChartBarBold,
} from 'react-icons/pi';
import { supabase } from '../supabase/client';
import { useAuth } from '../context/AuthContext';
import CampanaNotificaciones from '../components/CampanaNotificaciones';
import './Dashboard.css';

const ETIQUETA_ROL = {
  admin:     'Administrador',
  disenador: 'Diseñador',
  operario:  'Operario',
  vendedor:  'Vendedor',
};

// Clases del NavLink según estado activo (CSS plano, sin Tailwind).
const navLinkClase = ({ isActive }) =>
  isActive ? 'shell-link shell-link--active' : 'shell-link';

// Orden del sidebar (Bloque E CRM ventas): comercial arriba, catálogo/almacén
// al medio, administración al final. Filtrado por rol_modulos vía puedeVer (UX, no seguridad).
const MODULOS_NAV = [
  { modulo: 'pedidos',       to: '/dashboard/pedidos',       label: 'Pedidos',        icon: PiClipboardTextBold },
  { modulo: 'pos',           to: '/dashboard/pos',           label: 'Punto de venta', icon: PiCashRegisterBold },
  { modulo: 'clientes',      to: '/dashboard/clientes',      label: 'Clientes',       icon: PiUsersBold },
  { modulo: 'reportes',      to: '/dashboard/reportes',      label: 'Reportes',       icon: PiChartBarBold },
  { modulo: 'productos',     to: '/dashboard/productos',     label: 'Productos',      icon: PiPackageBold },
  { modulo: 'inventario',    to: '/dashboard/inventario',    label: 'Inventario',     icon: PiWarehouseBold },
  { modulo: 'configuracion', to: '/dashboard/configuracion', label: 'Configuración',  icon: PiGearBold },
];

// Fallback del Suspense interno (Bloque 10) — solo se ve en la primera carga
// de cada página del panel, mientras baja su chunk.
const DashboardSkel = () => (
  <div className="shell-canvas__skel">
    <div className="shell-canvas__skel-bar" />
    <div className="shell-canvas__skel-bar" />
    <div className="shell-canvas__skel-bar" />
  </div>
);

const Dashboard = () => {
  const navigate    = useNavigate();
  const { perfil, puedeVer } = useAuth();
  const [menuAbierto, setMenuAbierto] = useState(false);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate('/login');
  };

  const cerrarMenu = () => setMenuAbierto(false);

  return (
    <div className="shell">

      {/* Velo del drawer en móvil */}
      {menuAbierto && (
        <div className="shell-overlay" onClick={cerrarMenu} aria-hidden="true" />
      )}

      {/* === SIDEBAR === */}
      <aside className={`shell-sidebar ${menuAbierto ? 'shell-sidebar--open' : ''}`}>
        {/* Encabezado: marca + cierre en móvil */}
        <div className="shell-brand">
          <div className="shell-brand__logo">
            <span className="shell-brand__name">
              CREANDO <span className="shell-brand__accent">IDEAS</span>
            </span>
          </div>
          <button
            onClick={cerrarMenu}
            className="shell-close"
            aria-label="Cerrar menú"
          >
            <PiXBold />
          </button>
        </div>

        {/* Navegación — orden fijo del backlog, filtrado por rol_modulos */}
        <nav className="shell-nav">
          <div className="shell-group">
            <NavLink to="/dashboard" end className={navLinkClase} onClick={cerrarMenu}>
              <PiHouseBold className="shell-link__icon" /> <span className="shell-link__text">Inicio</span>
            </NavLink>
            {MODULOS_NAV.filter((m) => puedeVer(m.modulo)).map((m) => (
              <NavLink key={m.modulo} to={m.to} className={navLinkClase} onClick={cerrarMenu}>
                <m.icon className="shell-link__icon" /> <span className="shell-link__text">{m.label}</span>
              </NavLink>
            ))}
          </div>
        </nav>

        <div className="shell-foot">
          <button onClick={handleLogout} className="shell-logout">
            <PiSignOutBold /> <span className="shell-logout__text">Cerrar sesión</span>
          </button>
        </div>
      </aside>

      {/* === ÁREA PRINCIPAL === */}
      <div className="shell-main">
        <header className="shell-topbar">
          <button
            onClick={() => setMenuAbierto(true)}
            className="shell-burger"
            aria-label="Abrir menú"
          >
            <PiListBold />
          </button>

          <div className="shell-actions">
            <CampanaNotificaciones />
            <div className="shell-profile">
              <div className="shell-profile__meta">
                <p className="shell-profile__name">{perfil?.nombre ?? '…'}</p>
                <p className="shell-profile__role">{ETIQUETA_ROL[perfil?.rol] ?? '…'}</p>
              </div>
              <div className="shell-profile__avatar">
                {perfil?.nombre?.charAt(0).toUpperCase() ?? '?'}
              </div>
            </div>
          </div>
        </header>

        <main className="shell-canvas">
          <Suspense fallback={<DashboardSkel />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  );
};

export default Dashboard;
