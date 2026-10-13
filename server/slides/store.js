// Disco de la presentación:
//   data/slides-state.json   → la posición actual (escritura atómica: tmp + rename)
//   data/slides-log.jsonl    → cada cambio de posición, cronómetro y pantalla negra, para medir
//                              cuánto duró cada diapositiva en un ensayo (npm run slides:tiempos)
import { appendFile, rename, writeFile } from 'node:fs/promises';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { log } from '../core/log.js';

export class SlidesStore {
  constructor(dir) {
    this.statePath = join(dir, 'slides-state.json');
    this.logPath = join(dir, 'slides-log.jsonl');
    this.pending = null;
    this.writing = null;
    this.appending = Promise.resolve();
    mkdirSync(dir, { recursive: true });
  }

  load() {
    try {
      return JSON.parse(readFileSync(this.statePath, 'utf8'));
    } catch (err) {
      if (err.code !== 'ENOENT') log('warn', 'no se pudo leer la posición de la presentación', { error: err.message });
      return null;
    }
  }

  // Si llegan varios cambios seguidos, solo se escribe el último.
  save(state) {
    this.pending = JSON.stringify(state);
    this.writing ??= this.flush();
    return this.writing;
  }

  async flush() {
    while (this.pending !== null) {
      const data = this.pending;
      this.pending = null;
      const tmp = `${this.statePath}.tmp`;
      try {
        await writeFile(tmp, data);
        await rename(tmp, this.statePath);
      } catch (err) {
        log('error', 'no se pudo guardar la posición de la presentación', { error: err.message });
      }
    }
    this.writing = null;
  }

  append(event) {
    this.appending = this.appending
      .then(() => appendFile(this.logPath, `${JSON.stringify(event)}\n`))
      .catch((err) => log('error', 'no se pudo escribir el log de la presentación', { error: err.message }));
    return this.appending;
  }

  async close() {
    await this.writing;
    await this.appending;
  }
}
