import { lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider }  from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import ProtectedRoute    from './components/ProtectedRoute';
import RouteFallback     from './components/RouteFallback';

// P3.1 (Bloque 10): cada página en su propio chunk (code splitting por ruta).
// AuthContext/ToastContext quedan fuera porque los usan rutas públicas y privadas.
const Login              = lazy(() => import('./pages/Login'));
const Dashboard          = lazy(() => import('./pages/Dashboard'));
const Inicio             = lazy(() => import('./pages/Inicio'));
const Productos          = lazy(() => import('./pages/Productos'));
const Configuracion      = lazy(() => import('./pages/Configuracion'));
const CatalogoPublico    = lazy(() => import('./pages/CatalogoPublico'));
const ProductoDetalle    = lazy(() => import('./pages/ProductoDetalle'));
const Pedidos            = lazy(() => import('./pages/Pedidos'));
const Inventario         = lazy(() => import('./pages/Inventario'));
const PuntoVenta         = lazy(() => import('./pages/PuntoVenta'));
const Clientes           = lazy(() => import('./pages/Clientes'));
const Reportes           = lazy(() => import('./pages/Reportes'));

function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <Router>
          <Suspense fallback={<RouteFallback />}>
            <Routes>
              {/* RUTAS PÚBLICAS */}
              <Route path="/"                element={<CatalogoPublico />} />
              <Route path="/producto/:id"    element={<ProductoDetalle />} />
              <Route path="/login"           element={<Login />} />

              {/* RUTAS PROTEGIDAS — cualquier empleado autenticado */}
              <Route
                path="/dashboard"
                element={<ProtectedRoute><Dashboard /></ProtectedRoute>}
              >
                <Route index element={<Inicio />} />

                {/* P2.3: visibilidad por rol vía matriz rol_modulos (solo UX; la seguridad real es RLS+RPCs) */}
                <Route path="productos" element={<ProtectedRoute modulo="productos"><Productos /></ProtectedRoute>} />
                <Route path="pos"       element={<ProtectedRoute modulo="pos"><PuntoVenta /></ProtectedRoute>} />
                <Route path="pedidos"   element={<ProtectedRoute modulo="pedidos"><Pedidos /></ProtectedRoute>} />
                <Route path="clientes"  element={<ProtectedRoute modulo="clientes"><Clientes /></ProtectedRoute>} />
                <Route path="reportes"  element={<ProtectedRoute modulo="reportes"><Reportes /></ProtectedRoute>} />
                <Route path="inventario" element={<ProtectedRoute modulo="inventario"><Inventario /></ProtectedRoute>} />
                <Route path="configuracion" element={<ProtectedRoute modulo="configuracion"><Configuracion /></ProtectedRoute>} />
              </Route>

              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </Router>
      </ToastProvider>
    </AuthProvider>
  );
}

export default App;
