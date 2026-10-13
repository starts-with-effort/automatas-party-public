// Logs estructurados (RNF-15): una línea JSON por evento en stdout; en la VM los guarda journald.
// LOG_LEVEL=debug|info|warn|error|silent (por defecto info; las pruebas usan silent).
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

export function log(level, msg, fields = {}) {
  if (LEVELS[level] < (LEVELS[process.env.LOG_LEVEL] ?? LEVELS.info)) return;
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...fields });
  if (level === 'error') console.error(line);
  else console.log(line);
}
