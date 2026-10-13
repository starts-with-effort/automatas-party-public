// Token de sesión del dispositivo (RF-ACC-09): con él, al recargar o reconectar, el
// servidor le devuelve su equipo, su puesto y la vista actual.
const KEY = 'automatas-party.session';

export const session = {
  get() {
    try { return localStorage.getItem(KEY); } catch { return null; }
  },
  set(token) {
    try { localStorage.setItem(KEY, token); } catch { /* sin almacenamiento: se pierde al recargar */ }
  },
  clear() {
    try { localStorage.removeItem(KEY); } catch { /* nada que borrar */ }
  },
};
