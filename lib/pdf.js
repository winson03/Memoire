'use strict';

// Render a PDF into one JPEG per page using Ghostscript (`gs`), which is
// already on the machine. No fragile native node bindings.

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const GS_BIN = process.env.GS_BIN || 'gs';

function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* ignore */ }
}

// Is Ghostscript available? (used for graceful fallback)
function hasGhostscript() {
  return new Promise((resolve) => {
    const ps = spawn(GS_BIN, ['--version']);
    ps.on('error', () => resolve(false));
    ps.on('close', (code) => resolve(code === 0));
  });
}

/**
 * Convert a PDF buffer to an array of JPEG page buffers (in page order).
 * @param {Buffer} buffer  the PDF bytes
 * @param {{dpi?:number, maxPages?:number, quality?:number}} opts
 * @returns {Promise<Buffer[]>}
 */
function pdfToImages(buffer, opts = {}) {
  const dpi = opts.dpi || 150;
  const maxPages = opts.maxPages || 100;
  const quality = opts.quality || 85;

  return new Promise((resolve, reject) => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf2img-'));
    const inFile = path.join(tmp, 'in.pdf');
    const outPat = path.join(tmp, 'page-%04d.jpg');
    try { fs.writeFileSync(inFile, buffer); } catch (e) { cleanup(tmp); return reject(e); }

    const args = [
      '-dSAFER', '-dBATCH', '-dNOPAUSE', '-dQUIET',
      '-sDEVICE=jpeg', `-r${dpi}`, `-dJPEGQ=${quality}`,
      '-dFirstPage=1', `-dLastPage=${maxPages}`,
      `-sOutputFile=${outPat}`, inFile,
    ];
    const ps = spawn(GS_BIN, args);
    let err = '';
    ps.stderr.on('data', (d) => { err += d.toString(); });
    ps.on('error', (e) => { cleanup(tmp); reject(e); });
    ps.on('close', (code) => {
      if (code !== 0) { cleanup(tmp); return reject(new Error('ghostscript failed (' + code + ')' + (err ? ': ' + err.slice(0, 200) : ''))); }
      try {
        const pages = fs.readdirSync(tmp)
          .filter((f) => /^page-\d+\.jpg$/.test(f))
          .sort()
          .map((f) => fs.readFileSync(path.join(tmp, f)));
        cleanup(tmp);
        if (!pages.length) return reject(new Error('no pages rendered'));
        resolve(pages);
      } catch (e) { cleanup(tmp); reject(e); }
    });
  });
}

module.exports = { pdfToImages, hasGhostscript };
