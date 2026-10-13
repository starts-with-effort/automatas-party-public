// Libro de Excel (.xlsx) sin dependencias. Un .xlsx es un ZIP con unos pocos XML (Office Open XML):
// el índice de tipos, las relaciones, el libro, los estilos y una hoja por tabla.
//
//   toXlsx([{ name, rows, decimals? }]) → Buffer
//
// Cada hoja sale de filas como las de toCsv (objetos con las mismas claves): la primera fila son los
// nombres de las columnas, en negrita y fija al desplazar. Los números van como números (Excel los
// ordena y promedia), los booleanos como «Sí»/«No» y lo demás como texto. `decimals`:
// { columna: 1 | 2 } fija cuántos decimales muestra una columna (p. ej. la nota: 4,0 y no 4).
// `headers`: { columna: título } cambia el título de una columna (por defecto, su clave).
import { deflateRawSync } from 'node:zlib';

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const DOC_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const SHEET_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml';
export const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// Estilos de celda (índices de cellXfs en styles.xml).
const STYLE = { header: 1, decimals: { 1: 2, 2: 3 } };

// XML 1.0 no admite la mayoría de los caracteres de control: se quitan antes de escapar.
const escapeXml = (text) => String(text)
  .replace(/[^\x09\x0A\x0D\x20-퟿-�\u{10000}-\u{10FFFF}]/gu, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// 0 → A, 25 → Z, 26 → AA…
function columnName(index) {
  let name = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

// Excel no admite nombres de hoja de más de 31 caracteres, ni con [ ] : * ? / \, ni repetidos.
function sheetNames(sheets) {
  const used = new Set();
  return sheets.map(({ name }, index) => {
    const base = String(name ?? '').replace(/[[\]:*?/\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31).trim() || `Hoja ${index + 1}`;
    let unique = base;
    for (let n = 2; used.has(unique.toLowerCase()); n += 1) unique = `${base.slice(0, 31 - String(n).length - 1)} ${n}`;
    used.add(unique.toLowerCase());
    return unique;
  });
}

const textOf = (value) => (typeof value === 'boolean' ? (value ? 'Sí' : 'No') : String(value));

function cell(ref, value, style = 0) {
  if (value === null || value === undefined || value === '') return '';
  const s = style ? ` s="${style}"` : '';
  if (typeof value === 'number' && Number.isFinite(value)) return `<c r="${ref}"${s}><v>${value}</v></c>`;
  return `<c r="${ref}" t="inlineStr"${s}><is><t xml:space="preserve">${escapeXml(textOf(value))}</t></is></c>`;
}

function sheetXml({ rows, decimals = {}, headers = {} }, first) {
  const selected = first ? ' tabSelected="1"' : '';
  if (rows.length === 0) {
    return `${XML}<worksheet xmlns="${MAIN}"><sheetViews><sheetView${selected} workbookViewId="0"/></sheetViews>`
      + `<sheetData><row r="1">${cell('A1', 'Sin datos todavía.')}</row></sheetData></worksheet>`;
  }
  const columns = Object.keys(rows[0]);
  const title = (column) => headers[column] ?? column;
  // Ancho de cada columna según su texto más largo (con tope), para que no haya que ajustarlas.
  const widths = columns.map((column) => Math.min(60, Math.max(title(column).length, ...rows.map((row) => textOf(row[column] ?? '').length)) + 3));
  const cols = widths.map((width, i) => `<col min="${i + 1}" max="${i + 1}" width="${width}" customWidth="1"/>`).join('');
  const header = `<row r="1">${columns.map((column, i) => cell(`${columnName(i)}1`, title(column), STYLE.header)).join('')}</row>`;
  const body = rows.map((row, r) => `<row r="${r + 2}">${columns.map((column, i) => cell(`${columnName(i)}${r + 2}`, row[column], STYLE.decimals[decimals[column]] ?? 0)).join('')}</row>`).join('');
  return `${XML}<worksheet xmlns="${MAIN}">`
    + `<sheetViews><sheetView${selected} workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`
    + `<cols>${cols}</cols><sheetData>${header}${body}</sheetData></worksheet>`;
}

const STYLES_XML = `${XML}<styleSheet xmlns="${MAIN}">`
  + '<numFmts count="1"><numFmt numFmtId="164" formatCode="0.0"/></numFmts>'
  + '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
  + '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
  + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
  + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
  + '<cellXfs count="4">'
  + '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' // 0: normal
  + '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' // 1: encabezado
  + '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' // 2: un decimal
  + '<xf numFmtId="2" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' // 3: dos decimales
  + '</cellXfs>'
  + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
  + '</styleSheet>';

export function toXlsx(sheets, { date = new Date() } = {}) {
  const list = sheets.length > 0 ? sheets : [{ name: 'Datos', rows: [] }];
  const names = sheetNames(list);
  const files = [
    ['[Content_Types].xml', `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      + '<Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
      + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
      + list.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="${SHEET_TYPE}"/>`).join('')
      + '</Types>'],
    ['_rels/.rels', `${XML}<Relationships xmlns="${PKG_REL}">`
      + `<Relationship Id="rId1" Type="${DOC_REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ['xl/workbook.xml', `${XML}<workbook xmlns="${MAIN}" xmlns:r="${DOC_REL}"><bookViews><workbookView/></bookViews><sheets>`
      + names.map((name, i) => `<sheet name="${escapeXml(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')
      + '</sheets></workbook>'],
    ['xl/_rels/workbook.xml.rels', `${XML}<Relationships xmlns="${PKG_REL}">`
      + list.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${DOC_REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')
      + `<Relationship Id="rId${list.length + 1}" Type="${DOC_REL}/styles" Target="styles.xml"/></Relationships>`],
    ['xl/styles.xml', STYLES_XML],
    ...list.map((sheet, i) => [`xl/worksheets/sheet${i + 1}.xml`, sheetXml(sheet, i === 0)]),
  ];
  return zip(files.map(([name, text]) => ({ name, data: Buffer.from(text, 'utf8') })), date);
}

// ------------------------------------------------------------------ ZIP

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// Un ZIP con cada archivo comprimido (deflate): por archivo, una cabecera local y sus datos; al
// final, el directorio central y su cierre. Nombres en UTF-8 (bit 11 de las banderas).
function zip(files, date) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const day = (Math.max(0, date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  const locals = [];
  const central = [];
  let offset = 0;
  for (const { name, data } of files) {
    const nameBytes = Buffer.from(name, 'utf8');
    const packed = deflateRawSync(data);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // firma de la cabecera local
    local.writeUInt16LE(20, 4); // versión necesaria para extraer
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    locals.push(local, nameBytes, packed);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0); // firma del directorio central
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(8, 10);
    entry.writeUInt16LE(time, 12);
    entry.writeUInt16LE(day, 14);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(packed.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt32LE(offset, 42); // dónde empieza su cabecera local
    central.push(entry, nameBytes);
    offset += local.length + nameBytes.length + packed.length;
  }
  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); // cierre del directorio central
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...central, end]);
}
