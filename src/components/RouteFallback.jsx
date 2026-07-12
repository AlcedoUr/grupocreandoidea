// Fallback del Suspense raíz (Bloque 10): se ve solo en la primera carga fría de cada ruta.
const RouteFallback = () => (
  <div className="route-fallback">
    <div className="route-fallback__stack">
      <div className="route-fallback__bar" />
      <div className="route-fallback__bar" />
      <div className="route-fallback__bar" />
    </div>
  </div>
);

export default RouteFallback;
