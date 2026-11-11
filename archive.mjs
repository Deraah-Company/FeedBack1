const encoder = new TextEncoder();
const bytes = value => typeof value === 'string' ? encoder.encode(value) : value;
const crcTable = Array.from({length: 256}, (_, index) => {
  for (let bit = 0; bit < 8; bit++) index = index & 1 ? 0xedb88320 ^ (index >>> 1) : index >>> 1;
  return index >>> 0;
});
function crc32(data) {
  let result = 0xffffffff;
  for (const octet of data) result = crcTable[(result ^ octet) & 255] ^ (result >>> 8);
  return (result ^ 0xffffffff) >>> 0;
}
function header(size, fields) {
  const data = new Uint8Array(size);
  const view = new DataView(data.buffer);
  for (const [offset, value, long] of fields) {
    if (long) view.setUint32(offset, value, true);
    else view.setUint16(offset, value, true);
  }
  return data;
}
export class Zip {
  constructor(write) {
    this.write = write;
    this.offset = 0;
    this.directory = [];
  }
  async add(path, value) {
    const name = bytes(path);
    const data = bytes(value);
    const length = data.length;
    if (this.offset + length + name.length + 30 > 0xffffffff) throw Error('ZIP size limit');
    const crc = crc32(data);
    const local = header(30, [[0,0x04034b50,true],[4,20],[6,2048],[12,33],[14,crc,true],[18,length,true],[22,length,true],[26,name.length]]);
    const entry = header(46, [[0,0x02014b50,true],[4,20],[6,20],[8,2048],[14,33],[16,crc,true],[20,length,true],[24,length,true],[28,name.length],[42,this.offset,true]]);
    this.directory.push([entry, name]);
    this.offset += local.length + name.length + length;
    for (const part of [local, name, data]) await this.write(part);
  }
  async finish() {
    const length = this.directory.reduce((sum, [entry, name]) => sum + entry.length + name.length, 0);
    const count = this.directory.length;
    if (count > 65535 || this.offset + length + 22 > 0xffffffff) throw Error('ZIP directory limit');
    for (const [entry, name] of this.directory) {
      await this.write(entry);
      await this.write(name);
    }
    await this.write(header(22, [[0,0x06054b50,true],[8,count],[10,count],[12,length,true],[16,this.offset,true]]));
  }
}
const xml = text => String(text ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDFFF]/gu, '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const rels = 'http://schemas.openxmlformats.org/package/2006/relationships';
const office = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const sheet = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
export async function workbook(rows) {
  const parts = [];
  const zip = new Zip(data => parts.push(data));
  await zip.add('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>');
  await zip.add('_rels/.rels', `<Relationships xmlns="${rels}"><Relationship Id="rId1" Type="${office}/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  await zip.add('xl/_rels/workbook.xml.rels', `<Relationships xmlns="${rels}"><Relationship Id="rId1" Type="${office}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`);
  await zip.add('xl/workbook.xml', `<workbook xmlns="${sheet}" xmlns:r="${office}"><sheets><sheet name="Feedback" sheetId="1" r:id="rId1"/></sheets></workbook>`);
  const headings = ['رقم','النوع','العنوان','الوصف','الصفحة','التاريخ (UTC)','مسار الصورة','معرّف الملاحظة'];
  const body = [headings, ...rows].map((row, index) =>
    `<row r="${index + 1}">${row.map((cell, column) => `<c r="${String.fromCharCode(65 + column)}${index + 1}" t="inlineStr"><is><t xml:space="preserve">${xml(cell)}</t></is></c>`).join('')}</row>`).join('');
  await zip.add('xl/worksheets/sheet1.xml', `<worksheet xmlns="${sheet}"><sheetViews><sheetView rightToLeft="1" workbookViewId="0"><pane ySplit="1" topLeftCell="A2" state="frozen"/></sheetView></sheetViews><cols><col min="1" max="2" width="17"/><col min="3" max="3" width="34"/><col min="4" max="4" width="68"/><col min="5" max="8" width="30"/></cols><sheetData>${body}</sheetData><autoFilter ref="A1:H${rows.length + 1}"/></worksheet>`);
  await zip.finish();
  return new Uint8Array(await new Blob(parts).arrayBuffer());
}

