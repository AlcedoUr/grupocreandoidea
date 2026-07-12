// Celular peruano: 9 dígitos, mismo criterio que _normalizar_telefono() en la base.
// Validar en el formulario evita errores de tipeo antes de llegar al servidor.
export const esTelefonoValido = (telefono) => /^\d{9}$/.test((telefono || '').trim());

// Para el onChange: descarta lo que no sea dígito y corta a 9.
export const soloDigitos9 = (valor) => valor.replace(/\D/g, '').slice(0, 9);
