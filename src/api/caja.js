// Capa api/ (Bloque 11, auditoría) — dominio caja (resumen diario y cierre).
import { supabase } from '../supabase/client';

export const cajaResumen = (localId, fecha) =>
  supabase.rpc('fn_caja_resumen', { p_local: localId, p_fecha: fecha });

export const cerrarCaja = ({ localId, fecha, contados, notas }) =>
  supabase.rpc('fn_cerrar_caja', {
    p_local:    localId,
    p_fecha:    fecha,
    p_contados: contados,
    p_notas:    notas,
  });
