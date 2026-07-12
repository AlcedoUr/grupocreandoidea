import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

/**
 * Protege rutas por sesión y opcionalmente por rol o módulo.
 * Props:
 *   rolesPermitidos: string[] — si se pasa, solo esos roles pueden entrar (si no, cualquier autenticado).
 *   modulo: string — alternativa vía matriz rol_modulos (P2.3, solo UX; la seguridad real es RLS+RPCs).
 *   redireccionSinRol: string — ruta cuando el rol no cumple (default: /dashboard)
 */
const ProtectedRoute = ({ children, rolesPermitidos, modulo, redireccionSinRol = '/dashboard' }) => {
    const { sesion, perfil, puedeVer, cargando, mfaPendiente } = useAuth();

    if (cargando) return null;

    if (!sesion) return <Navigate to="/login" replace />;

    // P2.4: password OK pero falta el código TOTP (AAL2) — Login.jsx retoma el paso de código.
    if (mfaPendiente) return <Navigate to="/login" replace />;

    // El perfil (y con él, la matriz de módulos) aún está cargando — esperamos
    if ((rolesPermitidos || modulo) && !perfil) return null;

    if (modulo && !puedeVer(modulo)) {
        return <Navigate to={redireccionSinRol} replace />;
    }
    if (rolesPermitidos && !rolesPermitidos.includes(perfil.rol)) {
        return <Navigate to={redireccionSinRol} replace />;
    }

    return children;
};

export default ProtectedRoute;
