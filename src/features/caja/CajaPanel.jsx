import { useState, useEffect, useCallback } from 'react';
import { FaSpinner, FaCheckCircle, FaLock } from 'react-icons/fa';
import { supabase } from '../../supabase/client';
import { mensajeError } from '../../lib/errores';
import { cajaResumen, cerrarCaja as cerrarCajaApi } from '../../api/caja';
import { METODOS_PAGO } from '../../lib/constantes';
import './Caja.css';

// ── CajaPanel (P1.1 — cierre diario) ──
// Extraído de Pedidos.jsx en el Bloque 12: dominio ajeno al Kanban, sin estado compartido.
const hoyLima = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

const CajaPanel = ({ perfil }) => {
  const puedeCerrar = perfil?.rol === 'admin' || perfil?.rol === 'vendedor';

  const [locales, setLocales]   = useState([]);
  const [localId, setLocalId]   = useState('');
  const [fecha, setFecha]       = useState(hoyLima());
  const [resumen, setResumen]   = useState(null);
  const [cierre, setCierre]     = useState(null); // cierre ya existente para local+fecha
  const [historial, setHistorial] = useState([]);
  const [contados, setContados] = useState({});
  const [notas, setNotas]       = useState('');
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError]       = useState(null);

  useEffect(() => {
    supabase.from('locales').select('id, nombre').eq('activo', true).order('id')
      .then(({ data }) => {
        setLocales(data || []);
        setLocalId((prev) => prev || data?.[0]?.id || '');
      });
  }, []);

  const cargar = useCallback(async () => {
    if (!localId) return;
    setCargando(true);
    setError(null);
    const [{ data: resumenData }, { data: cierreData }, { data: histData }] = await Promise.all([
      cajaResumen(Number(localId), fecha),
      supabase.from('cierres_caja').select('*').eq('local_id', localId).eq('fecha', fecha).maybeSingle(),
      supabase.from('cierres_caja').select('*').eq('local_id', localId).order('fecha', { ascending: false }).limit(15),
    ]);
    setResumen(resumenData ?? null);
    setCierre(cierreData ?? null);
    setHistorial(histData ?? []);
    setContados({});
    setNotas('');
    setCargando(false);
  }, [localId, fecha]);

  useEffect(() => { cargar(); }, [cargar]);

  const diferenciaPreview = (metodo) => {
    const sistema = Number(resumen?.por_metodo?.[metodo] ?? 0);
    const contado = Number(contados[metodo] ?? 0);
    return contado - sistema;
  };

  const cerrarCaja = async () => {
    setGuardando(true); setError(null);
    const p_contados = Object.fromEntries(
      METODOS_PAGO.map(({ m }) => [m, Number(contados[m] ?? 0)])
    );
    const { error: e } = await cerrarCajaApi({
      localId: Number(localId),
      fecha,
      contados: p_contados,
      notas: notas || null,
    });
    setGuardando(false);
    if (e) { setError(mensajeError(e, { NO_AUTORIZADO: 'Tu rol no tiene permiso para cerrar caja.' })); return; }
    cargar();
  };

  return (
    <div className="ped-caja">
      <div className="ped-caja__filtros">
        <select className="ped-caja__select" aria-label="Local" value={localId} onChange={(e) => setLocalId(e.target.value)}>
          {locales.map((l) => <option key={l.id} value={l.id}>{l.nombre}</option>)}
        </select>
        <input
          type="date" className="ped-caja__fecha" aria-label="Fecha"
          value={fecha} onChange={(e) => setFecha(e.target.value)}
        />
      </div>

      {cargando ? (
        <div className="ped-loading" style={{ height: 'auto', padding: '3rem 0' }}>
          <FaSpinner className="ped-spin" /> Cargando caja…
        </div>
      ) : (
        <>
          {error && <div className="ped-caja__alert">{error}</div>}

          <div className="ped-caja__resumen">
            {METODOS_PAGO.map(({ m, label }) => (
              <div key={m} className="ped-caja__card">
                <span className="ped-caja__card-label">{label}</span>
                <span className="ped-caja__card-sistema">S/.{Number(resumen?.por_metodo?.[m] ?? 0).toFixed(2)}</span>
                {!cierre && (
                  <input
                    type="number" step="0.01" placeholder="Contado" aria-label={`Contado ${label}`}
                    className="ped-caja__card-input"
                    disabled={!puedeCerrar}
                    value={contados[m] ?? ''}
                    onChange={(e) => setContados((prev) => ({ ...prev, [m]: e.target.value }))}
                  />
                )}
                {!cierre && contados[m] !== undefined && contados[m] !== '' && (
                  <span className={`ped-caja__card-dif ${diferenciaPreview(m) !== 0 ? 'ped-caja__card-dif--off' : ''}`}>
                    {diferenciaPreview(m) >= 0 ? '+' : ''}{diferenciaPreview(m).toFixed(2)}
                  </span>
                )}
                {cierre && (
                  <span className={`ped-caja__card-dif ${Number(cierre.diferencia?.[m] ?? 0) !== 0 ? 'ped-caja__card-dif--off' : ''}`}>
                    contado S/.{Number(cierre.montos_contados?.[m] ?? 0).toFixed(2)} · dif {Number(cierre.diferencia?.[m] ?? 0) >= 0 ? '+' : ''}{Number(cierre.diferencia?.[m] ?? 0).toFixed(2)}
                  </span>
                )}
              </div>
            ))}
          </div>

          <div className="ped-caja__totales">
            <span>Total pagos: <strong>S/.{Number(resumen?.total_pagos ?? 0).toFixed(2)}</strong></span>
            <span>Reembolsos: <strong>−S/.{Number(resumen?.reembolsos ?? 0).toFixed(2)}</strong></span>
            <span>Neto: <strong>S/.{Number(resumen?.neto ?? 0).toFixed(2)}</strong></span>
          </div>
          {Number(resumen?.reembolsos_sin_metodo ?? 0) > 0 && (
            <p className="ped-muted">
              Reembolsos sin método (histórico): −S/.{Number(resumen.reembolsos_sin_metodo).toFixed(2)} — restan solo del neto, no de una tarjeta de método.
            </p>
          )}

          {cierre ? (
            <div className="ped-caja__cerrado">
              <FaCheckCircle /> Caja cerrada el {new Date(cierre.creado_en).toLocaleString('es-PE')}
              {cierre.notas && <p className="ped-caja__notas-txt">"{cierre.notas}"</p>}
            </div>
          ) : puedeCerrar ? (
            <div className="ped-caja__cierre">
              <textarea
                className="ped-caja__notas"
                placeholder="Notas del cierre (opcional)" aria-label="Notas del cierre"
                value={notas} onChange={(e) => setNotas(e.target.value)}
              />
              <button className="ped-caja__btn" disabled={guardando} onClick={cerrarCaja}>
                {guardando ? <><FaSpinner className="ped-spin" /> Cerrando…</> : <><FaLock /> Cerrar caja del día</>}
              </button>
            </div>
          ) : (
            <p className="ped-muted">Solo admin o vendedor pueden cerrar caja.</p>
          )}

          <h3 className="ped-caja__hist-title">Historial de cierres</h3>
          <div className="ped-caja__hist">
            {historial.length === 0 && <p className="ped-col__empty">Sin cierres registrados.</p>}
            {historial.map((c) => {
              const totalDif = Object.values(c.diferencia || {}).reduce((s, v) => s + Math.abs(Number(v)), 0);
              return (
                <div key={c.id} className="ped-caja__hist-row">
                  <span className="ped-caja__hist-fecha">{c.fecha}</span>
                  <span className={`ped-caja__hist-dif ${totalDif !== 0 ? 'ped-caja__hist-dif--off' : ''}`}>
                    {totalDif === 0 ? 'Cuadrado' : `Dif. S/.${totalDif.toFixed(2)}`}
                  </span>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
};

export default CajaPanel;
