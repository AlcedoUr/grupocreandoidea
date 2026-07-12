import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import { FaCheckCircle, FaExclamationCircle, FaInfoCircle, FaTimes } from 'react-icons/fa';

const ToastContext = createContext(null);

export const ToastProvider = ({ children }) => {
  const [toasts, setToasts] = useState([]);
  const idRef = useRef(0);

  const addToast = useCallback((mensaje, tipo = 'info', duracion = 4000) => {
    idRef.current += 1;
    const id = idRef.current;
    
    setToasts((prev) => [...prev, { id, mensaje, tipo }]);

    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, duracion);
  }, []);

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toastSuccess = useCallback((msg, dur) => addToast(msg, 'success', dur), [addToast]);
  const toastError = useCallback((msg, dur) => addToast(msg, 'error', dur), [addToast]);
  const toastInfo = useCallback((msg, dur) => addToast(msg, 'info', dur), [addToast]);

  return (
    <ToastContext.Provider value={{ addToast, removeToast, toastSuccess, toastError, toastInfo }}>
      {children}
      <div className="toast-container">
        {toasts.map((t) => {
          let Icon = FaInfoCircle;
          if (t.tipo === 'success') Icon = FaCheckCircle;
          if (t.tipo === 'error') Icon = FaExclamationCircle;

          return (
            <div key={t.id} className={`toast toast--${t.tipo}`}>
              <Icon className="toast__icon" />
              <span className="toast__message">{t.mensaje}</span>
              <button onClick={() => removeToast(t.id)} className="toast__close" aria-label="Cerrar">
                <FaTimes />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
};

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast debe ser utilizado dentro de un ToastProvider');
  }
  return context;
};
