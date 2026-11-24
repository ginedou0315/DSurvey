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
  function pdfDocument(images,imageWidth,imageHeight,pageWidth,pageHeight) {
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
      const commands = `q ${pageWidth} 0 0 ${pageHeight} 0 0 cm /PageImage Do Q\n`;
      object(id,`<< /Type /XObject /Subtype /Image /Width ${imageWidth} /Height ${imageHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.length} >>\nstream\n`,image,'\nendstream');
      object(id + 1,`<< /Length ${commands.length} >>\nstream\n`,commands,'endstream');
      object(id + 2,`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /XObject << /PageImage ${id} 0 R >> >> /Contents ${id + 1} 0 R >>`);
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
    const pageWidth = 842;
    const pageHeight = 595;
    canvas.width = pageWidth * 2;
    canvas.height = pageHeight * 2;
    const context = canvas.getContext('2d');
    context.scale(2,2);
    const images = [];
    const margin = 42;
    const bottom = 552;
    let y;
    function startPage() {
      context.fillStyle = '#fff';
      context.fillRect(0,0,pageWidth,pageHeight);
      context.font = 'bold 11px system-ui, sans-serif';
      context.fillStyle = '#4740be';
      context.fillText('DSurvey • Response report',margin,32);
      context.font = '10px system-ui, sans-serif';
      context.fillText('Page ' + (images.length + 1),margin,pageHeight - 14);
      y = 54;
    }
    async function finishPage() {
      const image = await new Promise((resolve,reject) => canvas.toBlob(value =>
        value ? resolve(value) : reject(new Error('Could not render the PDF.')),'image/jpeg',0.88));
      images.push(new Uint8Array(await image.arrayBuffer()));
    }
    async function text(value,font = '12px system-ui, sans-serif',step = 17) {
      context.font = font;
      for (const line of wrap(context,value,pageWidth - margin * 2)) {
        if (y > bottom) { await finishPage(); startPage(); }
        context.fillStyle = '#1b213a';
        context.font = font;
        context.fillText(line,margin,y);
        y += step;
      }
    }
    async function table(label,rows) {
      if (!rows.length) return;
      const headers = rows[0].map(value => String(value));
      const availableWidth = pageWidth - margin * 2;
      const bodyFont = '8px system-ui, sans-serif';
      const headerFont = 'bold 8px system-ui, sans-serif';
      const lineHeight = 10;
      const cellPadding = 4;
      const maxChunkLines = 46;
      context.font = bodyFont;
      const widths = headers.map((header,column) => {
        context.font = headerFont;
        let widest = context.measureText(header).width;
        context.font = bodyFont;
        for (const row of rows.slice(1)) {
          widest = Math.max(widest,context.measureText(String(row[column] ?? '')).width);
        }
        return Math.max(70,Math.min(190,widest + cellPadding * 2));
      });
      const groups = [[0]];
      let groupWidth = widths[0];
      for (let column = 1; column < headers.length; column++) {
        if (groupWidth + widths[column] > availableWidth) {
          groups.push([0]);
          groupWidth = widths[0];
        }
        groups.at(-1).push(column);
        groupWidth += widths[column];
      }

      function wrappedCells(row,columns) {
        return columns.map((column,index) => {
          context.font = row === headers ? headerFont : bodyFont;
          return wrap(context,String(row[column] ?? ''),widths[column] - cellPadding * 2);
        });
      }
      function drawRow(lines,columns,top,header = false,shade = false) {
        const height = Math.max(1,...lines.map(cell => cell.length)) * lineHeight + cellPadding * 2;
        const totalWidth = columns.reduce((total,column) => total + widths[column],0);
        context.fillStyle = header ? '#e9e9f4' : shade ? '#f7f7fa' : '#fff';
        context.fillRect(margin,top,totalWidth,height);
        context.strokeStyle = '#c9cad4';
        context.lineWidth = 0.5;
        let x = margin;
        for (const [index,column] of columns.entries()) {
          context.strokeRect(x,top,widths[column],height);
          context.fillStyle = '#1b213a';
          context.font = header ? headerFont : bodyFont;
          lines[index].forEach((line,lineIndex) =>
            context.fillText(line,x + cellPadding,top + cellPadding + 7 + lineIndex * lineHeight));
          x += widths[column];
        }
        return height;
      }
      async function tablePage(columns) {
        const headerLines = wrappedCells(headers,columns);
        const headerHeight = Math.max(1,...headerLines.map(cell => cell.length)) * lineHeight + cellPadding * 2;
        if (y + 12 + headerHeight > bottom) { await finishPage(); startPage(); }
        context.fillStyle = '#1b213a';
        context.font = 'bold 13px system-ui, sans-serif';
        const groupLabel = groups.length > 1
          ? label + ' · columns ' + (columns[1] + 1) + '–' + columns.at(-1) + ' of ' + headers.length
          : label;
        context.fillText(groupLabel,margin,y);
        y += 12;
        y += drawRow(headerLines,columns,y,true);
      }

      for (const columns of groups) {
        await tablePage(columns);
        for (const [rowIndex,row] of rows.slice(1).entries()) {
          const lines = wrappedCells(row,columns);
          const lineCount = Math.max(1,...lines.map(cell => cell.length));
          for (let offset = 0; offset < lineCount; offset += maxChunkLines) {
            const chunk = lines.map((cell,columnIndex) => {
              const content = cell.slice(offset,offset + maxChunkLines);
              if (offset > 0 && columnIndex === 0 && content.length) {
                content[0] = content[0] + ' (continued)';
              }
              return content;
            });
            const height = Math.min(maxChunkLines,lineCount - offset) * lineHeight + cellPadding * 2;
            if (y + height > bottom) {
              await finishPage();
              startPage();
              await tablePage(columns);
            }
            y += drawRow(chunk,columns,y,false,rowIndex % 2 === 1);
          }
        }
        y += 16;
      }
    }
    startPage();
    await text(title,'bold 25px system-ui, sans-serif',32);
    await text('Summary','bold 16px system-ui, sans-serif',22);
    await table('Summary',summary);
    y += 16;
    await table('Responses',responses);
    await finishPage();
    download(pdfDocument(images,canvas.width,canvas.height,pageWidth,pageHeight),title,'.pdf');
  }
  return {excel:(title,responses,summary) => download(workbook(responses,summary),title,'.xlsx'),pdf};
})();
