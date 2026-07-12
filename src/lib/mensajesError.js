// Helper mínimo previo al mapa central de errores (Bloque 11). Cubre solo AAL2_REQUERIDO
// (Bloque 3); el resto de códigos se sigue traduciendo inline hasta completar el mapa.

export const MENSAJE_AAL2_REQUERIDO =
  'Esta acción requiere iniciar sesión con tu código 2FA. Cierra sesión y vuelve a entrar.';

export const esErrorAal2 = (err) => Boolean(err?.message?.includes('AAL2_REQUERIDO'));
