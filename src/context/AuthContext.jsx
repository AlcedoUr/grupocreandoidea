import { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '../supabase/client';

const AuthContext = createContext(null);

// localStorage: user.id que ya verificó su código de correo en esta sesión
// (2FA por correo obligatorio para todos los roles, sin enrolamiento — mejoras.txt §4).
const CLAVE_OTP_OK = 'civ_otp_ok';

export const AuthProvider = ({ children }) => {
    // undefined = verificando | null = sin sesión | objeto = sesión activa
    const [sesion, setSesion]   = useState(undefined);
    const [perfil, setPerfil]   = useState(null); // { id, nombre, rol }
    const [modulos, setModulos] = useState(null); // Set<string> — módulos visibles del rol (P2.3)

    // Password OK pero código de correo aún no confirmado en esta sesión.
    const [otpVerificado, setOtpVerificado] = useState(false);

    const cargarPerfil = async (userId) => {
        const { data } = await supabase
            .from('profiles')
            .select('id, nombre, rol')
            .eq('id', userId)
            .single();
        setPerfil(data ?? null);

        // Matriz rol_modulos: solo navegación/UX (P2.3); la seguridad real es RLS+RPCs.
        if (data?.rol && data.rol !== 'admin') {
            const { data: filas } = await supabase
                .from('rol_modulos')
                .select('modulo')
                .eq('rol', data.rol);
            setModulos(new Set((filas ?? []).map((f) => f.modulo)));
        } else {
            setModulos(null); // admin (o sin perfil aún): bypass, siempre todo
        }
    };

    // admin ve todo siempre (bypass hardcodeado, no depende de la matriz)
    const puedeVer = (modulo) => perfil?.rol === 'admin' || !!modulos?.has(modulo);

    // Defensa en profundidad: si algo llega a una ruta protegida sin el código
    // de correo verificado, se lo regresa al login (Login.jsx ya no navega antes).
    const mfaPendiente = !!(sesion && !otpVerificado);

    // Login.jsx llama esto justo después de un verifyOtp exitoso.
    const marcarOtpVerificado = (userId) => {
        if (!userId) return;
        localStorage.setItem(CLAVE_OTP_OK, userId);
        setOtpVerificado(true);
    };

    useEffect(() => {
        // Sesión inicial al montar la app
        supabase.auth.getSession().then(({ data: { session } }) => {
            setSesion(session);
            if (session?.user) {
                cargarPerfil(session.user.id);
                setOtpVerificado(localStorage.getItem(CLAVE_OTP_OK) === session.user.id);
            }
        });

        // Escuchar login / logout en tiempo real (incluyendo otras pestañas)
        const { data: { subscription } } = supabase.auth.onAuthStateChange(
            (_event, session) => {
                setSesion(session);
                if (session?.user) {
                    cargarPerfil(session.user.id);
                    setOtpVerificado(localStorage.getItem(CLAVE_OTP_OK) === session.user.id);
                } else {
                    setPerfil(null);
                    setOtpVerificado(false);
                    localStorage.removeItem(CLAVE_OTP_OK);
                }
            }
        );

        return () => subscription.unsubscribe();
    }, []);

    return (
        <AuthContext.Provider value={{
            sesion,
            perfil,
            puedeVer,
            cargando: sesion === undefined,
            mfaPendiente,
            marcarOtpVerificado,
        }}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => useContext(AuthContext);
