// Capa api/ (Bloque 11, auditoría) — dominio unidades.
import { supabase } from '../supabase/client';

export const resumenUnidades = (pedidoId) =>
  supabase.rpc('fn_unidades_resumen', { p_pedido_id: pedidoId });
