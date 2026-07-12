import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { FaBell, FaCheckDouble, FaExclamationCircle } from 'react-icons/fa';
import { supabase } from '../supabase/client';
import { useAuth } from '../context/AuthContext';
import './CampanaNotificaciones.css';

// "hace 5 min", "hace 2 h", "ayer", fecha corta
const tiempoRelativo = (iso) => {
  const seg = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seg < 60) return 'hace un momento';
  if (seg < 3600) return `hace ${Math.floor(seg / 60)} min`;
  if (seg < 86400) return `hace ${Math.floor(seg / 3600)} h`;
  if (seg < 172800) return 'ayer';
  return new Date(iso).toLocaleDateString('es-PE', { day: 'numeric', month: 'short' });
};

// Reproduce un sonido de notificación premium (doble chime sintetizado por Web Audio)
const playNotificationSound = () => {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(587.33, ctx.currentTime);
    gain1.gain.setValueAtTime(0.08, ctx.currentTime);
    gain1.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(880.00, ctx.currentTime + 0.08);
    gain2.gain.setValueAtTime(0, ctx.currentTime);
    gain2.gain.setValueAtTime(0.12, ctx.currentTime + 0.08);
    gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.55);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    
    osc1.start(ctx.currentTime);
    osc1.stop(ctx.currentTime + 0.35);
    osc2.start(ctx.currentTime + 0.08);
    osc2.stop(ctx.currentTime + 0.55);
  } catch (err) {
    console.warn('Web Audio check / play blocked:', err);
  }
};

// segVencidos no tiene fila en `notificaciones` (fallback sin pg_cron) ni `leida_por` en DB;
// se persiste "ya visto" en localStorage por id para que sobreviva a logout/login.
const CLAVE_VISTOS_SEG = 'civ_noti_seg_vistos';

const leerVistos = (clave) => {
  try { return new Set(JSON.parse(localStorage.getItem(clave) || '[]')); }
  catch { return new Set(); }
};
const agregarVistos = (clave, ids) => {
  const vistos = leerVistos(clave);
  ids.forEach((id) => vistos.add(id));
  localStorage.setItem(clave, JSON.stringify([...vistos]));
  return vistos;
};

// Campanita del topbar: badge de no-leídas + dropdown + toast en vivo.
// La barrera real por rol es la policy de SELECT (RLS); el filtro en Realtime es solo UX.
const CampanaNotificaciones = () => {
  const { perfil }  = useAuth();
  const navigate    = useNavigate();
  const [items, setItems]     = useState([]);
  const [segVencidos, setSegVencidos] = useState([]);
  const [vistosSeg, setVistosSeg]     = useState(() => leerVistos(CLAVE_VISTOS_SEG));
  const [abierto, setAbierto] = useState(false);
  const [toast, setToast]     = useState(null);
  const raizRef    = useRef(null);
  const toastTimer = useRef(null);

  const cargar = useCallback(async () => {
    const { data } = await supabase
      .from('notificaciones')
      .select('*')
      .order('creado_en', { ascending: false })
      .limit(20);
    setItems(data ?? []);
  }, []);

  // Sin pg_cron no hay job que avise de vencidos: la campanita los computa al cargar
  // (fallback documentado en instrucciones_crm_ventas.md — Bloque A).
  const cargarSeguimientosVencidos = useCallback(async (rol, userId) => {
    let query = supabase
      .from('seguimientos')
      .select('id, cliente_id, nota, vence_en, clientes(nombre)')
      .eq('estado', 'pendiente')
      .lte('vence_en', new Date().toISOString())
      .order('vence_en', { ascending: true });
    if (rol !== 'admin') query = query.eq('asignado_a', userId);
    const { data } = await query;
    setSegVencidos(data ?? []);
  }, []);

  // Carga inicial + suscripción Realtime (INSERT)
  useEffect(() => {
    if (!perfil) return;
    cargar();
    cargarSeguimientosVencidos(perfil.rol, perfil.id);
    const canal = supabase
      .channel('notificaciones_live')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notificaciones' }, (payload) => {
        const n = payload.new;
        const esParaMi = n.rol_destino === perfil.rol || perfil.rol === 'admin' || n.user_destino === perfil.id;
        if (!esParaMi) return;

        playNotificationSound();

        setItems((prev) => [n, ...prev.filter((x) => x.id !== n.id)].slice(0, 20));
        setToast(n);
        clearTimeout(toastTimer.current);
        toastTimer.current = setTimeout(() => setToast(null), 5000);
      })
      .subscribe();
    return () => {
      supabase.removeChannel(canal);
      clearTimeout(toastTimer.current);
    };
  }, [perfil, cargar, cargarSeguimientosVencidos]);

  // Cerrar el dropdown al hacer click fuera
  useEffect(() => {
    if (!abierto) return;
    const fuera = (e) => {
      if (raizRef.current && !raizRef.current.contains(e.target)) setAbierto(false);
    };
    document.addEventListener('mousedown', fuera);
    return () => document.removeEventListener('mousedown', fuera);
  }, [abierto]);

  const esLeida  = (n) => (n.leida_por ?? []).includes(perfil?.id);
  const noLeidas = items.filter((n) => !esLeida(n)).length
    + segVencidos.filter((s) => !vistosSeg.has(s.id)).length;

  const abrirSeguimiento = (s) => {
    setAbierto(false);
    setVistosSeg(agregarVistos(CLAVE_VISTOS_SEG, [s.id]));
    navigate(`/dashboard/clientes?cliente=${s.cliente_id}`);
  };

  const abrirPedido = (n) => {
    setAbierto(false);
    setToast(null);
    if (!esLeida(n)) {
      setItems((prev) => prev.map((x) =>
        x.id === n.id ? { ...x, leida_por: [...(x.leida_por ?? []), perfil.id] } : x));
      supabase.rpc('fn_marcar_notificacion_leida', { p_id: n.id });
    }
    // Las alertas de stock mínimo no pertenecen a un pedido (pedido_id null) — van a Inventario.
    if (n.pedido_id == null) {
      navigate('/dashboard/inventario');
      return;
    }
    navigate(`/dashboard/pedidos?tab=produccion&pedido=${n.pedido_id}`);
  };

  const marcarTodas = async () => {
    setItems((prev) => prev.map((x) =>
      esLeida(x) ? x : { ...x, leida_por: [...(x.leida_por ?? []), perfil.id] }));
    setVistosSeg(agregarVistos(CLAVE_VISTOS_SEG, segVencidos.map((s) => s.id)));
    await supabase.rpc('fn_marcar_todas_leidas');
  };

  if (!perfil) return null;

  return (
    <div className="noti" ref={raizRef}>
      <button
        className="noti-btn"
        onClick={() => setAbierto((v) => !v)}
        aria-label={`Notificaciones${noLeidas ? ` (${noLeidas} sin leer)` : ''}`}
      >
        <FaBell />
        {noLeidas > 0 && <span className="noti-badge">{noLeidas > 9 ? '9+' : noLeidas}</span>}
      </button>

      {abierto && (
        <div className="noti-panel">
          <div className="noti-panel__head">
            <span className="noti-panel__title">Notificaciones</span>
            {noLeidas > 0 && (
              <button className="noti-panel__todas" onClick={marcarTodas}>
                <FaCheckDouble /> Marcar todas como leídas
              </button>
            )}
          </div>
          <ul className="noti-list">
            {items.length === 0 && segVencidos.length === 0 && (
              <li className="noti-empty">Sin notificaciones por ahora.</li>
            )}
            {segVencidos.map((s) => (
              <li key={`seg-${s.id}`}>
                <button
                  className={`noti-item noti-item--seg ${vistosSeg.has(s.id) ? '' : 'noti-item--nueva'}`}
                  onClick={() => abrirSeguimiento(s)}
                >
                  <FaExclamationCircle className="noti-item__dot noti-item__dot--seg" aria-hidden="true" />
                  <span className="noti-item__body">
                    <span className="noti-item__titulo">Seguimiento vencido: {s.clientes?.nombre ?? 'Cliente'}</span>
                    <span className="noti-item__cuerpo">{s.nota}</span>
                    <span className="noti-item__hace">{tiempoRelativo(s.vence_en)}</span>
                  </span>
                </button>
              </li>
            ))}
            {items.map((n) => (
              <li key={n.id}>
                <button
                  className={`noti-item ${esLeida(n) ? '' : 'noti-item--nueva'}`}
                  onClick={() => abrirPedido(n)}
                >
                  <span className="noti-item__dot" aria-hidden="true" />
                  <span className="noti-item__body">
                    <span className="noti-item__titulo">{n.titulo}</span>
                    {n.cuerpo && <span className="noti-item__cuerpo">👤 {n.cuerpo}</span>}
                    <span className="noti-item__hace">{tiempoRelativo(n.creado_en)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Toast discreto al llegar una notificación en vivo */}
      {toast && (
        <button className="noti-toast" onClick={() => abrirPedido(toast)}>
          <FaBell className="noti-toast__icon" />
          <span className="noti-toast__body">
            <span className="noti-toast__titulo">{toast.titulo}</span>
            {toast.cuerpo && <span className="noti-toast__cuerpo">{toast.cuerpo}</span>}
          </span>
        </button>
      )}
    </div>
  );
};

export default CampanaNotificaciones;
