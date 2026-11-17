/**
 * Zero-dependency multipart/form-data parser for image and file uploads.
 */

function readBodyBuffer(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let aborted = false;

    req.on('data', (chunk) => {
      if (aborted) return;
      total += chunk.length;
      if (total > maxBytes) {
        aborted = true;
        const err = new Error(`Upload exceeds maximum allowed size of ${Math.round(maxBytes / (1024 * 1024))} MB.`);
        err.statusCode = 413;
        reject(err);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (!aborted) resolve(Buffer.concat(chunks));
    });

    req.on('error', (err) => {
      if (!aborted) reject(err);
    });
  });
}

function parseMultipart(buffer, contentType) {
  const match = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType || '');
  if (!match) {
    const err = new Error('Missing multipart boundary.');
    err.statusCode = 400;
    throw err;
  }
  const boundary = match[1] || match[2];
  const boundaryBuf = Buffer.from(`--${boundary}`);
  const headerSep = Buffer.from('\r\n\r\n');

  const fields = {};
  const files = [];

  let pos = buffer.indexOf(boundaryBuf);
  if (pos < 0) return { fields, files };

  while (pos >= 0) {
    pos += boundaryBuf.length;
    // Check for closing "--"
    if (buffer[pos] === 0x2d && buffer[pos + 1] === 0x2d) break;
    // Skip CRLF after boundary
    if (buffer[pos] === 0x0d && buffer[pos + 1] === 0x0a) pos += 2;

    const nextBoundary = buffer.indexOf(boundaryBuf, pos);
    if (nextBoundary < 0) break;

    // Part ends with \r\n before next boundary
    let partEnd = nextBoundary;
    if (buffer[partEnd - 2] === 0x0d && buffer[partEnd - 1] === 0x0a) {
      partEnd -= 2;
    }

    const headerEnd = buffer.indexOf(headerSep, pos);
    if (headerEnd < 0 || headerEnd > partEnd) {
      pos = nextBoundary;
      continue;
    }

    const headerStr = buffer.subarray(pos, headerEnd).toString('utf8');
    const bodyBuf = buffer.subarray(headerEnd + headerSep.length, partEnd);

    const dispMatch = /Content-Disposition:\s*form-data;\s*([^;\r\n]+(?:;\s*[^;\r\n]+)*)/i.exec(headerStr);
    if (dispMatch) {
      const nameMatch = /\bname="([^"]+)"/i.exec(headerStr);
      const filenameMatch = /\bfilename="([^"]*)"/i.exec(headerStr);
      const typeMatch = /Content-Type:\s*([^\r\n;]+)/i.exec(headerStr);

      const fieldName = nameMatch ? nameMatch[1] : 'field';
      if (filenameMatch) {
        const filename = filenameMatch[1];
        if (filename) {
          files.push({
            fieldName,
            filename,
            mimeType: typeMatch ? typeMatch[1].trim() : 'application/octet-stream',
            data: Buffer.from(bodyBuf)
          });
        }
      } else {
        fields[fieldName] = bodyBuf.toString('utf8');
      }
    }

    pos = nextBoundary;
  }

  return { fields, files };
}

module.exports = {
  readBodyBuffer,
  parseMultipart
};
