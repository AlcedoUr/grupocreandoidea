import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { FaEnvelope, FaLock, FaEye, FaEyeSlash, FaSpinner, FaArrowLeft, FaShieldAlt } from 'react-icons/fa';
import { supabase } from '../supabase/client';
import { useAuth } from '../context/AuthContext';
import './Login.css';

const OTP_LENGTH = 6;

const Login = () => {
  const { marcarOtpVerificado } = useAuth();
  const [email, setEmail]             = useState('');
  const [password, setPassword]       = useState('');
  const [verPassword, setVerPassword] = useState(false);
  const [error, setError]             = useState('');
  const [mensaje, setMensaje]         = useState('');
  const [cargando, setCargando]       = useState(false);
  const [enviandoReset, setEnviandoReset] = useState(false);
  const navigate = useNavigate();

  // 2FA obligatorio: 'credenciales' → 'otp'. Código de 6 dígitos, uno por cuadro.
  const [paso, setPaso] = useState('credenciales');
  const [otpDigits, setOtpDigits] = useState(Array(OTP_LENGTH).fill(''));
  const otp = otpDigits.join('');
  const otpRefs = useRef([]);

  // Sesión con password validado pero OTP sin confirmar: se cierra y se reinicia
  // (no reenviar código automático para evitar spam de correo).
  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) return;
      const verificado = localStorage.getItem('civ_otp_ok') === session.user.id;
      if (verificado) { navigate('/dashboard'); return; }
      await supabase.auth.signOut();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setMensaje('');
    setCargando(true);

    const { error: authError } = await supabase.auth.signInWithPassword({ email, password });

    if (authError) {
      if (authError.status === 429) {
        setError('Demasiados intentos. Espera un momento antes de volver a intentarlo.');
      } else if (!authError.status) {
        setError('No pudimos conectar. Revisa tu conexión e inténtalo de nuevo.');
      } else {
        setError('Credenciales incorrectas. Verifica tu correo y contraseña.');
      }
      setCargando(false);
      return;
    }

    // Password correcto no basta: se exige además el código OTP al correo.
    const { error: otpError } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
    setCargando(false);
    if (otpError) {
      setError('No pudimos enviar el código a tu correo. Intenta de nuevo.');
      return;
    }
    setPaso('otp');
  };

  const handleVerificarOtp = async (e) => {
    e.preventDefault();
    setError('');
    setCargando(true);
    const { data, error: verifyError } = await supabase.auth.verifyOtp({ email, token: otp, type: 'email' });
    setCargando(false);
    if (verifyError) {
      setError('Código incorrecto o vencido. Verifica tu correo e intenta de nuevo.');
      setOtpDigits(Array(OTP_LENGTH).fill(''));
      otpRefs.current[0]?.focus();
      return;
    }
    marcarOtpVerificado(data?.user?.id);
    setMensaje('¡Verificado! Redirigiendo…');
    setTimeout(() => navigate('/dashboard'), 700);
  };

  const handleReenviarOtp = async () => {
    if (cargando) return;
    setError(''); setMensaje(''); setCargando(true);
    const { error: otpError } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
    setCargando(false);
    if (otpError) { setError('No pudimos reenviar el código. Intenta de nuevo.'); return; }
    setMensaje('Código reenviado. Revisa tu correo.');
  };

  // Cancelar cierra la sesión a medio abrir (evita dejar un AAL1 colgado).
  const handleCancelarOtp = async () => {
    await supabase.auth.signOut();
    setPaso('credenciales');
    setPassword('');
    setOtpDigits(Array(OTP_LENGTH).fill(''));
    setError('');
    setMensaje('');
  };

  // Un cuadro por dígito; si llega el código completo de un tirón (autofill/paste), se reparte.
  const handleOtpChange = (index, rawValue) => {
    const digitsOnly = rawValue.replace(/\D/g, '');
    if (digitsOnly.length > 1) {
      const chars = digitsOnly.slice(0, OTP_LENGTH).split('');
      const next = Array(OTP_LENGTH).fill('');
      chars.forEach((c, i) => { next[i] = c; });
      setOtpDigits(next);
      otpRefs.current[Math.min(chars.length, OTP_LENGTH - 1)]?.focus();
      return;
    }
    const next = [...otpDigits];
    next[index] = digitsOnly;
    setOtpDigits(next);
    if (digitsOnly && index < OTP_LENGTH - 1) otpRefs.current[index + 1]?.focus();
  };

  const handleOtpKeyDown = (index, e) => {
    if (e.key === 'Backspace' && !otpDigits[index] && index > 0) {
      otpRefs.current[index - 1]?.focus();
    }
  };

  // Recuperación real de contraseña vía Supabase (evita enlaces muertos).
  const handleReset = async () => {
    if (enviandoReset) return;
    if (!email) {
      setMensaje('');
      setError('Escribe tu correo arriba y te enviaremos el enlace de recuperación.');
      return;
    }
    setError('');
    setMensaje('');
    setEnviandoReset(true);
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/login`,
    });
    setEnviandoReset(false);
    if (resetError) {
      setError('No pudimos enviar el correo de recuperación. Inténtalo de nuevo.');
    } else {
      setMensaje('Te enviamos un enlace para restablecer tu contraseña. Revisa tu correo.');
    }
  };

  return (
    <div className="login-page">
      <main className="login-wrap">
        <Link to="/" className="login-back">
          <FaArrowLeft className="login-back__icon" aria-hidden="true" /> Volver al catálogo
        </Link>

        <div className="login-card">
          {paso === 'credenciales' ? (
            <>
              {/* Encabezado: marca como eyebrow + título y subtítulo */}
              <header className="login-header">
                <span className="login-eyebrow">Creando Ideas</span>
                <h1 className="login-title">Acceso administrativo</h1>
                <p className="login-subtitle">
                  Ingresa tus credenciales para gestionar el catálogo y los pedidos.
                </p>
              </header>

              <form onSubmit={handleLogin} className="login-form">
                <div className="login-field">
                  <label htmlFor="email" className="login-label">Correo electrónico</label>
                  <div className="login-input-wrap">
                    <FaEnvelope className="login-input-icon" aria-hidden="true" />
                    <input
                      id="email"
                      type="email"
                      placeholder="admin@grupocreandoideas.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      autoFocus
                      autoComplete="username"
                      className="login-input"
                    />
                  </div>
                </div>

                <div className="login-field">
                  <div className="login-label-row">
                    <label htmlFor="password" className="login-label">Contraseña</label>
                    <button type="button" onClick={handleReset} disabled={enviandoReset} className="login-link">
                      ¿Olvidaste tu contraseña?
                    </button>
                  </div>
                  <div className="login-input-wrap">
                    <FaLock className="login-input-icon" aria-hidden="true" />
                    <input
                      id="password"
                      type={verPassword ? 'text' : 'password'}
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      autoComplete="current-password"
                      className="login-input login-input--password"
                    />
                    <button
                      type="button"
                      onClick={() => setVerPassword((v) => !v)}
                      aria-label={verPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                      className="login-toggle"
                    >
                      {verPassword ? <FaEyeSlash /> : <FaEye />}
                    </button>
                  </div>
                </div>

                {error && (
                  <p className="login-alert login-alert--error" role="alert">{error}</p>
                )}
                {mensaje && (
                  <p className="login-alert login-alert--success" role="status">{mensaje}</p>
                )}

                <button type="submit" disabled={cargando} className="login-btn">
                  {cargando ? (
                    <><FaSpinner className="login-spinner" /> Verificando…</>
                  ) : (
                    'Ingresar al panel'
                  )}
                </button>
              </form>
            </>
          ) : (
            <>
              <header className="login-header">
                <span className="login-eyebrow"><FaShieldAlt aria-hidden="true" /> Verificación en dos pasos</span>
                <h1 className="login-title">Ingresa tu código</h1>
                <p className="login-subtitle">
                  Te enviamos un código a <strong>{email}</strong>. Escríbelo para ingresar.
                </p>
              </header>

              <form onSubmit={handleVerificarOtp} className="login-form">
                <div className="login-field">
                  <label className="login-label" id="otp-group-label">Código de verificación</label>
                  <div className="login-otp-boxes" role="group" aria-labelledby="otp-group-label">
                    {otpDigits.map((digit, i) => (
                      <input
                        key={i}
                        ref={(el) => (otpRefs.current[i] = el)}
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        maxLength={OTP_LENGTH}
                        value={digit}
                        onChange={(e) => handleOtpChange(i, e.target.value)}
                        onKeyDown={(e) => handleOtpKeyDown(i, e)}
                        autoFocus={i === 0}
                        autoComplete={i === 0 ? 'one-time-code' : 'off'}
                        aria-label={`Dígito ${i + 1} de ${OTP_LENGTH}`}
                        className="login-otp-box"
                      />
                    ))}
                  </div>
                </div>

                {error && (
                  <p className="login-alert login-alert--error" role="alert">{error}</p>
                )}
                {mensaje && (
                  <p className="login-alert login-alert--success" role="status">{mensaje}</p>
                )}

                <button type="submit" disabled={cargando || otp.length < OTP_LENGTH} className="login-btn">
                  {cargando ? (
                    <><FaSpinner className="login-spinner" /> Verificando…</>
                  ) : (
                    'Verificar e ingresar'
                  )}
                </button>
                <button type="button" onClick={handleReenviarOtp} disabled={cargando} className="login-link">
                  Reenviar código
                </button>
                <button type="button" onClick={handleCancelarOtp} className="login-link">
                  Cancelar y volver a intentar
                </button>
                <p className="login-hint">
                  ¿No te llegó el correo? Revisa spam o reenvía el código.
                </p>
              </form>
            </>
          )}
        </div>

        <p className="login-footer">
          © {new Date().getFullYear()} Grupo Creando Ideas · Comas, Lima — Perú
        </p>
      </main>
    </div>
  );
};

export default Login;
