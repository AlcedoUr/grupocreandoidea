import React, { useState } from 'react';
import { FaCalendarPlus, FaSpinner, FaTimes, FaUser, FaFileInvoice, FaClipboardList } from 'react-icons/fa';
import { supabase } from '../supabase/client';
import { esTelefonoValido, soloDigitos9 } from '../lib/telefono';
import './ModalSeguimiento.css';

// Redondea a la próxima hora en punto, útil como default del datetime-local.
const proximaHoraISO = () => {
  const d = new Date();
  d.setHours(d.getHours() + 1, 0, 0, 0);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const MENSAJE_ERROR = {
  CLIENTE_REQUERIDO:  'Indica el cliente (nombre y teléfono) para el seguimiento.',
  ASIGNADO_INVALIDO:  'El usuario asignado no es válido.',
  NOTA_REQUERIDA:      'La nota es obligatoria.',
  FECHA_PASADA:        'La fecha debe ser futura.',
  NO_AUTORIZADO:       'No tienes permiso para crear seguimientos.',
};

// Modal reutilizable: programa un seguimiento comercial desde la bandeja de
// solicitudes, cotización o ficha del cliente. Asignado = usuario actual (Bloque A del CRM).
const ModalSeguimiento = ({ cliente, pedidoId, cotizacionId, contextoLabel, onClose, onCreado }) => {
  const [nombre, setNombre]     = useState(cliente?.nombre ?? '');
  const [telefono, setTelefono] = useState(cliente?.telefono ?? '');
  const [nota, setNota]         = useState('');
  const [venceEn, setVenceEn]   = useState(proximaHoraISO());
  const [guardando, setGuardando] = useState(false);
  const [error, setError]       = useState('');

  const necesitaDatosCliente = !cliente?.id;

  const submit = async (e) => {
    e.preventDefault();
    if (necesitaDatosCliente && !esTelefonoValido(telefono)) {
      setError('El teléfono debe tener 9 dígitos (celular de Perú).');
      return;
    }
    setGuardando(true);
    setError('');

    const p_seguimiento = {
      cliente_id:       cliente?.id ?? null,
      cliente_nombre:   necesitaDatosCliente ? nombre.trim() : null,
      cliente_telefono: necesitaDatosCliente ? telefono.trim() : null,
      pedido_id:        pedidoId ?? null,
      cotizacion_id:    cotizacionId ?? null,
      nota:             nota.trim(),
      vence_en:         new Date(venceEn).toISOString(),
    };

    const { data, error: err } = await supabase.rpc('fn_crear_seguimiento', { p_seguimiento });
    setGuardando(false);
    if (err) {
      const codigo = Object.keys(MENSAJE_ERROR).find((c) => err.message?.includes(c));
      setError(codigo ? MENSAJE_ERROR[codigo] : 'No se pudo crear el seguimiento.');
      return;
    }
    onCreado?.(data);
  };

  return (
    <div className="segm-overlay" onClick={onClose}>
      <div className="segm-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="segm-head">
          <h3 className="segm-title"><FaCalendarPlus /> Programar seguimiento</h3>
          <button className="segm-close" onClick={onClose} aria-label="Cerrar"><FaTimes /></button>
        </div>

        <form className="segm-body" onSubmit={submit}>
          {contextoLabel && (
            <div className="segm-contexto">
              {pedidoId ? <FaFileInvoice /> : cotizacionId ? <FaClipboardList /> : <FaUser />}
              <span>{contextoLabel}</span>
            </div>
          )}

          {error && <p className="segm-error">{error}</p>}

          {necesitaDatosCliente ? (
            <div className="segm-grid2">
              <label className="segm-label">Cliente *
                <input className="segm-input" value={nombre} onChange={(e) => setNombre(e.target.value)} required />
              </label>
              <label className="segm-label">Teléfono *
                <input className="segm-input" type="tel" inputMode="numeric" maxLength={9}
                  value={telefono} onChange={(e) => setTelefono(soloDigitos9(e.target.value))} required />
              </label>
            </div>
          ) : (
            <div className="segm-cliente-fijo"><FaUser /> {cliente.nombre}</div>
          )}

          <label className="segm-label">Nota *
            <textarea
              className="segm-input segm-input--area"
              rows={3}
              placeholder="Ej: Llamar para confirmar tallas y adelanto…"
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              required
            />
          </label>

          <label className="segm-label">Vence *
            <input
              className="segm-input"
              type="datetime-local"
              value={venceEn}
              onChange={(e) => setVenceEn(e.target.value)}
              required
            />
          </label>

          <div className="segm-foot">
            <button type="button" className="segm-btn" onClick={onClose} disabled={guardando}>Cancelar</button>
            <button type="submit" className="segm-btn segm-btn--primary" disabled={guardando}>
              {guardando ? <><FaSpinner className="segm-spin" /> Guardando…</> : <><FaCalendarPlus /> Programar</>}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ModalSeguimiento;
