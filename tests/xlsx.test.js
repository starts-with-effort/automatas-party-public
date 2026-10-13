// Libro de Excel de la exportación: un ZIP con los XML de un .xlsx, escrito sin dependencias.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { inflateRawSync } from 'node:zlib';
import { createApp } from '../server/app.js';
import { XLSX_TYPE, crc32, toXlsx } from '../server/domain/xlsx.js';
import { silentLogger, testConfig } from './support/helpers.js';

process.env.LOG_LEVEL = 'silent';

// Lee un ZIP como lo haría cualquier programa: el cierre al final, el directorio central y, desde
// ahí, cada archivo. Comprueba tamaños y CRC. Devuelve { nombre: texto }, en el orden del directorio.
function unzip(buffer) {
  const end = buffer.length - 22;
  assert.equal(buffer.readUInt32LE(end), 0x06054b50, 'cierre del directorio central');
  const count = buffer.readUInt16LE(end + 10);
  const size = buffer.readUInt32LE(end + 12);
  let at = buffer.readUInt32LE(end + 16);
  assert.equal(at + size, end, 'el directorio central termina justo antes del cierre');
  const files = {};
  for (let i = 0; i < count; i += 1) {
    assert.equal(buffer.readUInt32LE(at), 0x02014b50, 'entrada del directorio central');
    const [method, crc, packedSize, fullSize, nameLength] = [buffer.readUInt16LE(at + 10), buffer.readUInt32LE(at + 16), buffer.readUInt32LE(at + 20), buffer.readUInt32LE(at + 24), buffer.readUInt16LE(at + 28)];
    const local = buffer.readUInt32LE(at + 42);
    const name = buffer.toString('utf8', at + 46, at + 46 + nameLength);
    assert.equal(buffer.readUInt32LE(local), 0x04034b50, `cabecera local de ${name}`);
    assert.equal(buffer.toString('utf8', local + 30, local + 30 + buffer.readUInt16LE(local + 26)), name);
    assert.equal(method, 8, 'deflate');
    const dataAt = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    const data = inflateRawSync(buffer.subarray(dataAt, dataAt + packedSize));
    assert.equal(data.length, fullSize, `tamaño de ${name}`);
    assert.equal(crc32(data), crc, `CRC de ${name}`);
    files[name] = data.toString('utf8');
    at += 46 + nameLength;
  }
  return files;
}

describe('libro de Excel', () => {
  const rows = [
    { estudiante: 'Ana Gómez', equipo: 'Los <Pilas> & Cía', aciertos: 9, nota: 4.1, taller: true },
    { estudiante: 'Luis "el bueno"', equipo: 'Otro\u0001', aciertos: 11, nota: 5, taller: false },
  ];

  test('es un ZIP con las partes de un .xlsx, una hoja por tabla', () => {
    const files = unzip(toXlsx([{ name: 'Estudiantes', rows, decimals: { nota: 1 } }, { name: 'Equipos', rows: [{ equipo: 'Uno', total: 1200 }] }]));
    assert.deepEqual(Object.keys(files), [
      '[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml',
      'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml',
    ]);
    assert.match(files['xl/workbook.xml'], /<sheet name="Estudiantes" sheetId="1" r:id="rId1"\/><sheet name="Equipos" sheetId="2" r:id="rId2"\/>/);
    assert.match(files['xl/_rels/workbook.xml.rels'], /Id="rId2"[^>]*Target="worksheets\/sheet2\.xml"/);
    assert.match(files['xl/_rels/workbook.xml.rels'], /Id="rId3"[^>]*Target="styles\.xml"/);
    assert.match(files['[Content_Types].xml'], /PartName="\/xl\/worksheets\/sheet2\.xml"/);
    for (const text of Object.values(files)) assert.ok(text.startsWith('<?xml version="1.0" encoding="UTF-8"'));
  });

  test('encabezados en negrita y fijos, números como números, texto escapado y la nota con un decimal', () => {
    const sheet = unzip(toXlsx([{ name: 'Estudiantes', rows, decimals: { nota: 1 } }]))['xl/worksheets/sheet1.xml'];
    assert.match(sheet, /<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"\/>/);
    assert.match(sheet, /<c r="A1" t="inlineStr" s="1"><is><t xml:space="preserve">estudiante<\/t><\/is><\/c>/);
    assert.match(sheet, /<c r="B2" t="inlineStr"><is><t xml:space="preserve">Los &lt;Pilas&gt; &amp; Cía<\/t><\/is><\/c>/);
    assert.match(sheet, /<c r="A3" t="inlineStr"><is><t xml:space="preserve">Luis &quot;el bueno&quot;<\/t><\/is><\/c>/);
    assert.match(sheet, /<c r="B3" t="inlineStr"><is><t xml:space="preserve">Otro<\/t><\/is><\/c>/, 'sin caracteres de control');
    assert.match(sheet, /<c r="C2"><v>9<\/v><\/c>/);
    assert.match(sheet, /<c r="D2" s="2"><v>4\.1<\/v><\/c>/);
    assert.match(sheet, /<c r="D3" s="2"><v>5<\/v><\/c>/, 'un 5 se muestra 5,0');
    assert.match(sheet, /<c r="E2" t="inlineStr"><is><t xml:space="preserve">Sí<\/t><\/is><\/c>/);
    assert.match(sheet, /<c r="E3" t="inlineStr"><is><t xml:space="preserve">No<\/t><\/is><\/c>/);
    assert.equal((sheet.match(/<col /g) ?? []).length, 5, 'un ancho por columna');
  });

  test('celdas vacías, tablas sin filas, muchas columnas y nombres de hoja que Excel no admite', () => {
    const wide = Object.fromEntries(Array.from({ length: 28 }, (_, i) => [`c${i}`, i === 0 ? '' : i]));
    const files = unzip(toXlsx([
      { name: 'Respuestas/por [equipo]: todas las de la partida', rows: [wide] },
      { name: 'Vacía', rows: [] },
      { name: 'vacía', rows: [] },
    ]));
    const sheet = files['xl/worksheets/sheet1.xml'];
    assert.doesNotMatch(sheet, /<c r="A2"/, 'una celda vacía no se escribe');
    assert.match(sheet, /<c r="Z2"><v>25<\/v><\/c><c r="AA2"><v>26<\/v><\/c><c r="AB2"><v>27<\/v><\/c>/);
    assert.match(files['xl/worksheets/sheet2.xml'], /Sin datos todavía\./);
    const names = [...files['xl/workbook.xml'].matchAll(/<sheet name="([^"]*)"/g)].map((m) => m[1]);
    assert.deepEqual(names, ['Respuestas por equipo todas las', 'Vacía', 'vacía 2']);
    assert.ok(names.every((name) => name.length <= 31));
    assert.equal(Object.keys(unzip(toXlsx([]))).filter((name) => name.includes('sheet')).length, 1, 'sin tablas, una hoja');
  });

  test('crc32 es el de ZIP', () => {
    assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
    assert.equal(crc32(Buffer.alloc(0)), 0);
  });
});

describe('exportación a Excel', () => {
  const HOST_TOKEN = 'token-de-prueba-0123456789abcdef';
  let server;
  let baseUrl;

  before(async () => {
    server = createApp({ hostToken: HOST_TOKEN, config: testConfig(), logger: silentLogger });
    await new Promise((resolve) => server.httpServer.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.httpServer.address().port}`;
  });

  after(() => server.close());

  test('GET /api/export?format=xlsx entrega el libro con las notas en la primera hoja', async () => {
    const { engine } = server;
    engine.createRoom({ teamCount: 2, workshop: true });
    const devices = Array.from({ length: 4 }, () => engine.registerDevice().deviceId);
    engine.registerTeam(devices[0], { name: 'Los Pilas', members: ['Zoe Ruiz', 'Ana Gómez'] });
    engine.join(devices[1], 't1');
    engine.registerTeam(devices[2], { name: 'Otro', members: ['Luis Pérez', 'Sara Lozano'] });
    engine.join(devices[3], 't2');
    engine.start();
    // Primera pregunta: Los Pilas aciertan y el otro equipo no responde.
    const { questionId } = engine.room.phase.data;
    const correct = testConfig().questionBank.find((q) => q.id === questionId).correct;
    for (const deviceId of devices.slice(0, 2)) engine.action(deviceId, { type: 'answer', questionId, option: correct });
    engine.skip();

    assert.equal((await fetch(`${baseUrl}/api/export?format=xlsx`)).status, 401);
    const res = await fetch(`${baseUrl}/api/export?format=xlsx`, { headers: { Authorization: `Bearer ${HOST_TOKEN}` } });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), XLSX_TYPE);
    assert.match(res.headers.get('content-disposition'), /attachment; filename="automatas-party-.+-estadisticas\.xlsx"/);
    const files = unzip(Buffer.from(await res.arrayBuffer()));
    const names = [...files['xl/workbook.xml'].matchAll(/<sheet name="([^"]*)"/g)].map((m) => m[1]);
    assert.deepEqual(names, ['Estudiantes', 'Equipos', 'Taller', 'Preguntas', 'Respuestas', 'Ranking', 'Minijuegos', 'Objetos']);
    const students = files['xl/worksheets/sheet1.xml'];
    const texts = [...students.matchAll(/<t xml:space="preserve">([^<]*)<\/t>/g)].map((m) => m[1]);
    assert.deepEqual(texts.slice(0, 7), ['Estudiante', 'Equipo', 'Preguntas', 'Aciertos', '% de aciertos', 'Nota', 'Taller']);
    assert.match(files['xl/worksheets/sheet2.xml'], /<t xml:space="preserve">pct_aciertos<\/t>/, 'las demás hojas conservan las claves de los CSV');
    assert.deepEqual(texts.filter((text) => /Gómez|Pérez|Lozano|Ruiz/.test(text)), ['Ana Gómez', 'Luis Pérez', 'Sara Lozano', 'Zoe Ruiz']);
    assert.match(students, /<c r="F2" s="2"><v>5<\/v><\/c>/, 'Ana Gómez: 1 de 1, nota 5');
    assert.match(students, /<c r="F3" s="2"><v>0<\/v><\/c>/, 'Luis Pérez: 0 de 1, nota 0');

    const csv = await (await fetch(`${baseUrl}/api/export?format=csv&table=estudiantes&sep=,`, { headers: { Authorization: `Bearer ${HOST_TOKEN}` } })).text();
    assert.equal(csv.replace(/^﻿/, '').split('\r\n')[1], 'Ana Gómez,Los Pilas,1,1,100,5,sin terminar');
  });
});
