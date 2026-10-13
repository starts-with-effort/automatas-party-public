// Snapshot del estado completo en disco y log de eventos append-only (RNF-07, sección 3.4).
//   data/snapshot.json            → estado tras cada cambio (escritura atómica: tmp + rename)
//   data/events-<sala>.jsonl      → un evento por línea; base de las estadísticas (Fase 8)
import { createWriteStream, mkdirSync, readFileSync, renameSync } from 'node:fs';
import { rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { log } from './log.js';

export const SNAPSHOT_VERSION = 1;

export class Persistence {
  constructor(dir) {
    this.dir = dir;
    this.snapshotPath = join(dir, 'snapshot.json');
    this.pending = null; // último estado serializado que falta escribir
    this.writing = null; // promesa de la escritura en curso
    this.eventLog = null;
    mkdirSync(dir, { recursive: true });
  }

  loadSnapshot() {
    let raw;
    try {
      raw = readFileSync(this.snapshotPath, 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
    try {
      const state = JSON.parse(raw);
      if (state.version !== SNAPSHOT_VERSION) throw new Error(`versión ${state.version}`);
      return state;
    } catch (err) {
      // Un snapshot ilegible no debe impedir que el servidor arranque: se aparta y se empieza de cero.
      const aside = join(this.dir, `snapshot.invalid-${Date.now()}.json`);
      renameSync(this.snapshotPath, aside);
      log('error', 'snapshot inválido; se ignoró', { error: err.message, movedTo: aside });
      return null;
    }
  }

  // Las escrituras se encadenan: si llegan varios cambios seguidos, solo se escribe el último.
  saveSnapshot(state) {
    this.pending = JSON.stringify(state);
    this.writing ??= this.flush();
    return this.writing;
  }

  async flush() {
    while (this.pending !== null) {
      const data = this.pending;
      this.pending = null;
      const tmp = `${this.snapshotPath}.tmp`;
      try {
        await writeFile(tmp, data);
        await rename(tmp, this.snapshotPath);
      } catch (err) {
        log('error', 'no se pudo guardar el snapshot', { error: err.message });
      }
    }
    this.writing = null;
  }

  openEventLog(roomId) {
    this.eventLog?.end();
    this.eventLog = createWriteStream(join(this.dir, `events-${roomId}.jsonl`), { flags: 'a' });
  }

  // Eventos ya registrados de una sala (para las estadísticas tras un reinicio). Una línea dañada
  // (p. ej. cortada por un apagón) se salta.
  readEvents(roomId) {
    let raw;
    try {
      raw = readFileSync(join(this.dir, `events-${roomId}.jsonl`), 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
    return raw.split('\n').flatMap((line) => {
      if (!line.trim()) return [];
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
  }

  appendEvent(event) {
    this.eventLog?.write(`${JSON.stringify(event)}\n`);
  }

  async close() {
    await this.writing;
    if (this.eventLog) await new Promise((resolve) => this.eventLog.end(resolve));
  }
}
