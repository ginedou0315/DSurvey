'use strict';
const DSurveyReports = (() => {
  const utf8 = value => new TextEncoder().encode(value);
  const crcTable = Array.from({length:256},(_,index) => {
    let value = index;
    for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
    return value;
  });
  function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
    return (crc ^ 0xffffffff) >>> 0;
  }
  function binary(size, fields) {
    const bytes = new Uint8Array(size);
    const view = new DataView(bytes.buffer);
    for (const [position,value,width] of fields) {
      if (width === 2) view.setUint16(position,value,true);
      else view.setUint32(position,value,true);
    }
    return bytes;
  }
  function zip(files) {
    const parts = [];
    const directory = [];
    let offset = 0;
    for (const [path,source] of Object.entries(files)) {
      const name = utf8(path);
      const data = utf8(source);
      const checksum = crc32(data);
      parts.push(binary(30,[[0,0x04034b50],[4,20,2],[12,33,2],[14,checksum],[18,data.length],
        [22,data.length],[26,name.length,2]]),name,data);
      directory.push(binary(46,[[0,0x02014b50],[4,20,2],[6,20,2],[14,33,2],[16,checksum],[20,data.length],
        [24,data.length],[28,name.length,2],[42,offset]]),name);
      offset += 30 + name.length + data.length;
    }
    const size = directory.reduce((total,part) => total + part.length,0);
    const entries = directory.length / 2;
    return [...parts,...directory,binary(22,[[0,0x06054b50],[8,entries,2],[10,entries,2],[12,size],[16,offset]])];
  }
  const xml = value => String(value)
    .replace(/[^\u0009\u000a\u000d\u0020-\ud7ff\ue000-\ufffd\u{10000}-\u{10ffff}]/gu,'')
    .replace(/_x[\da-f]{4}_/gi,match => '_x005F_' + match.slice(1))
    .replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
  const ns = 'http://schemas.openxmlformats.org';
  const spreadsheet = ns + '/spreadsheetml/2006/main';
  const office = ns + '/officeDocument/2006/relationships';
  const packageNs = ns + '/package/2006';
  function sheet(rows) {
    if (rows.length > 1048576) throw new Error('The response count exceeds the Excel worksheet limit.');
    return `<worksheet xmlns="${spreadsheet}"><sheetData>${rows.map((row,index) =>
      `<row r="${index + 1}">${row.map(value => typeof value === 'number' ? `<c><v>${value}</v></c>` :
        `<c t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`).join('')}</row>`).join('')}</sheetData></worksheet>`;
  }
  function workbook(responses,summary) {
    return new Blob(zip({
      '[Content_Types].xml':`<Types xmlns="${packageNs}/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/responses.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/summary.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
      '_rels/.rels':`<Relationships xmlns="${packageNs}/relationships"><Relationship Id="rId1" Type="${office}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
      'xl/workbook.xml':`<workbook xmlns="${spreadsheet}" xmlns:r="${office}"><sheets><sheet name="Responses" sheetId="1" r:id="rId1"/><sheet name="Summary" sheetId="2" r:id="rId2"/></sheets></workbook>`,
      'xl/_rels/workbook.xml.rels':`<Relationships xmlns="${packageNs}/relationships"><Relationship Id="rId1" Type="${office}/worksheet" Target="worksheets/responses.xml"/><Relationship Id="rId2" Type="${office}/worksheet" Target="worksheets/summary.xml"/></Relationships>`,
      'xl/worksheets/responses.xml':sheet(responses),
      'xl/worksheets/summary.xml':sheet(summary)
    }),{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  }
  function download(content,title,extension) {
    const link = document.createElement('a');
    const objectURL = URL.createObjectURL(content);
    link.href = objectURL;
    link.download = (title.replace(/[^\p{L}\p{N} -]/gu,'_').trim().slice(0,80) || 'DSurvey') + extension;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(objectURL),30000);
  }
  function pdfDocument(images,width,height) {
    const imageId = index => 3 + index * 3;
    const chunks = [];
    const offsets = [0];
    let size = 0;
    function append(value) {
      const bytes = typeof value === 'string' ? utf8(value) : value;
      chunks.push(bytes);
      size += bytes.length;
    }
    function object(number,...parts) {
      offsets[number] = size;
      append(number + ' 0 obj\n');
      for (const part of parts) append(part);
      append('\nendobj\n');
    }
    append('%PDF-1.4\n%âãÏÓ\n');
    object(1,'<< /Type /Catalog /Pages 2 0 R >>');
    object(2,`<< /Type /Pages /Count ${images.length} /Kids [${images.map((_,i) => (imageId(i) + 2) + ' 0 R').join(' ')}] >>`);
    for (const [index,image] of images.entries()) {
      const id = imageId(index);
      const commands = 'q 595 0 0 842 0 0 cm /PageImage Do Q\n';
      object(id,`<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.length} >>\nstream\n`,image,'\nendstream');
      object(id + 1,`<< /Length ${commands.length} >>\nstream\n`,commands,'endstream');
      object(id + 2,`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /PageImage ${id} 0 R >> >> /Contents ${id + 1} 0 R >>`);
    }
    const xref = size;
    append(`xref\n0 ${offsets.length}\n0000000000 65535 f \n`);
    for (const offset of offsets.slice(1)) append(String(offset).padStart(10,'0') + ' 00000 n \n');
    append(`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    return new Blob(chunks,{type:'application/pdf'});
  }
  function wrap(context,text,width) {
    const lines = [];
    for (const paragraph of String(text).split(/\r?\n/)) {
      let line = '';
      for (const word of paragraph.split(/(?<=\s)|(?=\s)/u)) {
        if (context.measureText(line + word).width <= width) {
          line += word;
          continue;
        }
        if (line) lines.push(line.trimEnd());
        line = '';
        if (context.measureText(word).width <= width) { line = word.trimStart(); continue; }
        for (const character of word) {
          if (context.measureText(line + character).width > width) {
            lines.push(line);
            line = '';
          }
          line += character;
        }
      }
      lines.push(line.trimEnd());
    }
    return lines;
  }
  async function pdf(title,responses,summary) {
    const canvas = document.createElement('canvas');
    canvas.width = 1190;
    canvas.height = 1684;
    const context = canvas.getContext('2d');
    context.scale(2,2);
    const images = [];
    const margin = 42;
    let y;
    function startPage() {
      context.fillStyle = '#fff';
      context.fillRect(0,0,595,842);
      context.font = 'bold 11px system-ui, sans-serif';
      context.fillStyle = '#4740be';
      context.fillText('DSurvey • Response report',margin,32);
      context.font = '10px system-ui, sans-serif';
      context.fillText('Page ' + (images.length + 1),margin,815);
      y = 62;
    }
    async function finishPage() {
      const image = await new Promise((resolve,reject) => canvas.toBlob(value =>
        value ? resolve(value) : reject(new Error('Could not render the PDF.')),'image/jpeg',0.88));
      images.push(new Uint8Array(await image.arrayBuffer()));
    }
    async function text(value,font = '12px system-ui, sans-serif',step = 17) {
      context.font = font;
      for (const line of wrap(context,value,595 - margin * 2)) {
        if (y > 782) { await finishPage(); startPage(); }
        context.fillStyle = '#1b213a';
        context.font = font;
        context.fillText(line,margin,y);
        y += step;
      }
    }
    startPage();
    await text(title,'bold 25px system-ui, sans-serif',32);
    await text('Summary','bold 16px system-ui, sans-serif',22);
    for (const [question,measure,count] of summary.slice(1)) {
      await text([question,measure,count].filter(value => value !== '').join(' · '));
    }
    y += 16;
    await text('Responses','bold 16px system-ui, sans-serif',22);
    for (const [index,row] of responses.slice(1).entries()) {
      if (y > 735) { await finishPage(); startPage(); }
      await text('Response ' + (index + 1) + ' · ' + row[0],'bold 12px system-ui, sans-serif');
      for (let column = 1; column < row.length; column++) {
        await text(responses[0][column] + ': ' + (row[column] || '—'));
      }
      y += 12;
    }
    await finishPage();
    download(pdfDocument(images,canvas.width,canvas.height),title,'.pdf');
  }
  return {excel:(title,responses,summary) => download(workbook(responses,summary),title,'.xlsx'),pdf};
})();
