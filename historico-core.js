/*
  Lectura en streaming del HISTORICO de Venejugos (.xlsx).
  El archivo pesa ~200 MB y la hoja DINAMICA ocupa ~700 MB de XML descomprimido,
  por eso no se usa SheetJS: se descomprime la hoja por partes y se acumulan
  totales sin guardar filas en memoria. Funciona en un Web Worker y en Node 20+.
*/
(function (root) {
  'use strict';

  var MESES = { ENERO: 1, FEBRERO: 2, MARZO: 3, ABRIL: 4, MAYO: 5, JUNIO: 6, JULIO: 7,
    AGOSTO: 8, SEPTIEMBRE: 9, SETIEMBRE: 9, OCTUBRE: 10, NOVIEMBRE: 11, DICIEMBRE: 12 };

  /* ---------- ZIP ---------- */
  async function readU8(blob, start, end) {
    return new Uint8Array(await blob.slice(start, end).arrayBuffer());
  }
  function dv(u8) { return new DataView(u8.buffer, u8.byteOffset, u8.byteLength); }
  function u64(view, off) { return view.getUint32(off, true) + view.getUint32(off + 4, true) * 4294967296; }

  async function readZipDirectory(blob) {
    var tailSize = Math.min(blob.size, 65557);
    var tail = await readU8(blob, blob.size - tailSize, blob.size);
    var tv = dv(tail);
    var eocd = -1;
    for (var i = tail.length - 22; i >= 0; i--) {
      if (tv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('El archivo no es un .xlsx válido (no se encontró el índice del ZIP).');
    var cdSize = tv.getUint32(eocd + 12, true);
    var cdOffset = tv.getUint32(eocd + 16, true);
    if (cdOffset === 0xFFFFFFFF || cdSize === 0xFFFFFFFF) {
      var loc = eocd - 20;
      if (loc >= 0 && tv.getUint32(loc, true) === 0x07064b50) {
        var z64off = u64(tv, loc + 8);
        var z = dv(await readU8(blob, z64off, z64off + 56));
        cdSize = u64(z, 40); cdOffset = u64(z, 48);
      }
    }
    var cd = await readU8(blob, cdOffset, cdOffset + cdSize);
    var v = dv(cd), p = 0, entries = {};
    var dec = new TextDecoder();
    while (p + 46 <= cd.length && v.getUint32(p, true) === 0x02014b50) {
      var method = v.getUint16(p + 10, true);
      var comp = v.getUint32(p + 20, true);
      var uncomp = v.getUint32(p + 24, true);
      var nameLen = v.getUint16(p + 28, true);
      var extraLen = v.getUint16(p + 30, true);
      var commentLen = v.getUint16(p + 32, true);
      var offset = v.getUint32(p + 42, true);
      var name = dec.decode(cd.subarray(p + 46, p + 46 + nameLen));
      var ex = p + 46 + nameLen, exEnd = ex + extraLen;
      while (ex + 4 <= exEnd) {
        var id = v.getUint16(ex, true), sz = v.getUint16(ex + 2, true), q = ex + 4;
        if (id === 1) {
          if (uncomp === 0xFFFFFFFF) { uncomp = u64(v, q); q += 8; }
          if (comp === 0xFFFFFFFF) { comp = u64(v, q); q += 8; }
          if (offset === 0xFFFFFFFF) { offset = u64(v, q); q += 8; }
        }
        ex += 4 + sz;
      }
      entries[name] = { name: name, method: method, comp: comp, uncomp: uncomp, offset: offset };
      p += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
  }

  async function entryTextStream(blob, entry) {
    var lh = dv(await readU8(blob, entry.offset, entry.offset + 30));
    var start = entry.offset + 30 + lh.getUint16(26, true) + lh.getUint16(28, true);
    var raw = blob.slice(start, start + entry.comp).stream();
    if (entry.method === 8) raw = raw.pipeThrough(new DecompressionStream('deflate-raw'));
    else if (entry.method !== 0) throw new Error('Compresión ZIP no soportada (método ' + entry.method + ').');
    return raw.pipeThrough(new TextDecoderStream('utf-8'));
  }

  async function entryText(blob, entry) {
    var reader = (await entryTextStream(blob, entry)).getReader(), parts = [];
    for (;;) { var r = await reader.read(); if (r.done) break; parts.push(r.value); }
    return parts.join('');
  }

  /* ---------- XML ---------- */
  function decodeXml(s) {
    if (s.indexOf('&') < 0) return s;
    return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, function (m, e) {
      if (e === 'amp') return '&'; if (e === 'lt') return '<'; if (e === 'gt') return '>';
      if (e === 'quot') return '"'; if (e === 'apos') return "'";
      if (e[1] === 'x') return String.fromCodePoint(parseInt(e.slice(2), 16));
      return String.fromCodePoint(parseInt(e.slice(1), 10));
    }).replace(/_x([0-9A-Fa-f]{4})_/g, function (m, h) { return String.fromCharCode(parseInt(h, 16)); });
  }

  function parseSharedStrings(xml) {
    var out = [], pos = 0, tRe = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g;
    for (;;) {
      var s = xml.indexOf('<si', pos); if (s < 0) break;
      var e = xml.indexOf('</si>', s); if (e < 0) break;
      var block = xml.slice(s, e), txt = '', m;
      var rph = block.indexOf('<rPh'); if (rph >= 0) block = block.slice(0, rph);
      tRe.lastIndex = 0;
      while ((m = tRe.exec(block))) txt += m[1];
      out.push(decodeXml(txt));
      pos = e + 5;
    }
    return out;
  }

  function colToIdx(c) { var n = 0; for (var i = 0; i < c.length; i++) n = n * 26 + (c.charCodeAt(i) - 64); return n - 1; }

  async function findSheet(blob, entries, preferred) {
    var wb = await entryText(blob, entries['xl/workbook.xml']);
    var relsEntry = entries['xl/_rels/workbook.xml.rels'];
    var rels = relsEntry ? await entryText(blob, relsEntry) : '';
    var relMap = {}, m, re = /<Relationship\b[^>]*>/g;
    while ((m = re.exec(rels))) {
      var id = /Id="([^"]+)"/.exec(m[0]), tg = /Target="([^"]+)"/.exec(m[0]);
      if (id && tg) relMap[id[1]] = tg[1];
    }
    var sheets = [], sre = /<sheet\b[^>]*>/g;
    while ((m = sre.exec(wb))) {
      var nm = /name="([^"]+)"/.exec(m[0]), rid = /r:id="([^"]+)"/.exec(m[0]);
      if (!nm || !rid || !relMap[rid[1]]) continue;
      var t = relMap[rid[1]].replace(/^\/?xl\//, '').replace(/^\//, '');
      sheets.push({ name: decodeXml(nm[1]), path: 'xl/' + t });
    }
    var pick = null;
    preferred.forEach(function (p) {
      if (pick) return;
      pick = sheets.find(function (s) { return s.name.trim().toUpperCase() === p; }) || null;
    });
    if (!pick) {
      sheets.forEach(function (s) {
        var e = entries[s.path];
        if (e && (!pick || e.uncomp > entries[pick.path].uncomp)) pick = s;
      });
    }
    if (!pick || !entries[pick.path]) throw new Error('No se encontró la hoja de ventas (DINAMICA) en el archivo.');
    return { name: pick.name, entry: entries[pick.path], all: sheets.map(function (s) { return s.name; }) };
  }

  /* ---------- Procesamiento ---------- */
  var NEEDED = {
    asesor: ['ASESOR ACTUAL', 'ASESOR', 'nomvend'],
    unidad: ['UNIDAD NEGOCIO', 'unidad_negocio'],
    sub: ['SUBLINEA', 'sublinea5'],
    mes: ['mes'], mesReal: ['mes real'], anio: ['año', 'ANO', 'AÑO'],
    rif: ['RIF REAL', 'rif'], cliente: ['nomclie'],
    usd: ['total_venta_dolar'], kg: ['PESO REAL', 'total_peso'],
    tipo: ['TIPOVTA']
  };

  function mapHeader(headerCells) {
    var byName = {};
    headerCells.forEach(function (h, idx) {
      if (h == null) return;
      var k = String(h).trim().toUpperCase();
      if (!(k in byName)) byName[k] = idx;
    });
    var map = {}, missing = [];
    Object.keys(NEEDED).forEach(function (key) {
      var found = -1;
      NEEDED[key].some(function (n) { var i = byName[n.toUpperCase()]; if (i != null) { found = i; return true; } return false; });
      map[key] = found;
    });
    ['asesor', 'unidad', 'usd'].forEach(function (k) { if (map[k] < 0) missing.push(NEEDED[k][0]); });
    if (map.mes < 0 && map.mesReal < 0) missing.push('mes');
    return { map: map, missing: missing };
  }

  function up(v) { return v == null ? '' : String(v).trim().toUpperCase(); }
  function num(v) { if (typeof v === 'number') return v; var n = parseFloat(v); return isFinite(n) ? n : 0; }

  async function parseHistorico(blob, opts) {
    opts = opts || {};
    var onProgress = opts.onProgress || function () {};
    var nestleUnit = up(opts.nestleUnit || 'NESTLE');
    var keySubs = (opts.keySubs || ['CALDOS', 'SOPAS', 'GALLETAS', 'CHOCOLATES']).map(up);

    onProgress({ stage: 'Leyendo índice del archivo', pct: 1 });
    var entries = await readZipDirectory(blob);
    if (!entries['xl/workbook.xml']) throw new Error('El archivo no parece un libro de Excel (.xlsx).');
    var sheet = await findSheet(blob, entries, ['DINAMICA', 'DINÁMICA']);

    onProgress({ stage: 'Leyendo textos compartidos', pct: 3 });
    var sst = entries['xl/sharedStrings.xml'] ? parseSharedStrings(await entryText(blob, entries['xl/sharedStrings.xml'])) : [];

    var header = null, colOf = null, needCols = null, maxCol = 0;
    var sales = new Map(), clients = new Map();
    var rows = 0, skipped = 0, consumed = 0, lastPct = 0;
    var total = sheet.entry.uncomp || 1;
    var cellRe = /<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;

    function cellValue(attrs, inner) {
      if (inner == null) return null;
      var tm = / t="([a-zA-Z]+)"/.exec(attrs), t = tm ? tm[1] : 'n';
      var vs = inner.indexOf('<v>'), v = null;
      if (vs >= 0) v = inner.slice(vs + 3, inner.indexOf('</v>', vs));
      if (t === 's') return v == null ? null : sst[+v];
      if (t === 'inlineStr') { var tt = /<t[^>]*>([\s\S]*?)<\/t>/.exec(inner); return tt ? decodeXml(tt[1]) : ''; }
      if (t === 'str' || t === 'e') return v == null ? null : decodeXml(v);
      if (t === 'b') return v === '1';
      return v == null ? null : +v;
    }

    function addClient(key, usd) { clients.set(key, (clients.get(key) || 0) + usd); }

    function handleRow(seg) {
      var m, vals;
      cellRe.lastIndex = 0;
      if (!header) {
        var cells = [];
        while ((m = cellRe.exec(seg))) cells[colToIdx(m[1])] = cellValue(m[2], m[3]);
        if (cells.filter(function (x) { return x != null && x !== ''; }).length < 3) return;
        header = cells;
        var mh = mapHeader(cells);
        if (mh.missing.length) throw new Error('A la hoja "' + sheet.name + '" le faltan columnas: ' + mh.missing.join(', ') + '.');
        colOf = mh.map;
        needCols = {};
        Object.keys(colOf).forEach(function (k) { if (colOf[k] >= 0) { needCols[colOf[k]] = k; if (colOf[k] > maxCol) maxCol = colOf[k]; } });
        return;
      }
      vals = {};
      var any = false;
      while ((m = cellRe.exec(seg))) {
        var ci = colToIdx(m[1]);
        if (ci > maxCol) break;
        var k = needCols[ci];
        if (k) { vals[k] = cellValue(m[2], m[3]); any = true; }
      }
      if (!any) return;
      var unidad = up(vals.unidad);
      var mes = num(vals.mes);
      if (!(mes >= 1 && mes <= 12)) mes = MESES[up(vals.mesReal)] || 0;
      if (!mes || !unidad) { skipped++; return; }
      var anio = num(vals.anio) || 2026;
      var per = anio * 100 + mes;
      var asesor = up(vals.asesor) || 'SIN ASESOR';
      var usd = num(vals.usd), kg = num(vals.kg);
      rows++;
      var sk = per + '|' + asesor + '|' + unidad;
      var s = sales.get(sk);
      if (!s) { s = [0, 0]; sales.set(sk, s); }
      s[0] += usd; s[1] += kg;

      var rif = up(vals.rif) || up(vals.cliente);
      if (!rif) return;
      var base = per + '|' + asesor + '|';
      addClient(base + unidad + '|' + rif, usd);
      if (unidad === nestleUnit) {
        var sub = up(vals.sub);
        if (sub && sub !== '0' && sub !== 'NAN') {
          addClient(base + unidad + '::' + sub + '|' + rif, usd);
          if (keySubs.indexOf(sub) < 0) addClient(base + unidad + '::RESTO|' + rif, usd);
        }
      }
    }

    onProgress({ stage: 'Procesando ventas de la hoja ' + sheet.name, pct: 5 });
    var reader = (await entryTextStream(blob, sheet.entry)).getReader();
    var buf = '';
    for (;;) {
      var r = await reader.read();
      if (r.done) break;
      consumed += r.value.length;
      buf += r.value;
      var pos = 0, end;
      while ((end = buf.indexOf('</row>', pos)) !== -1) {
        handleRow(buf.slice(pos, end));
        pos = end + 6;
      }
      buf = buf.slice(pos);
      /* Las filas vacías vienen autocerradas (<row .../>): todo lo anterior al último <row se puede descartar */
      var lastRow = buf.lastIndexOf('<row');
      if (lastRow > 0) buf = buf.slice(lastRow);
      var pct = 5 + Math.min(94, Math.floor(consumed / total * 94));
      if (pct !== lastPct) { lastPct = pct; onProgress({ stage: 'Procesando ventas de la hoja ' + sheet.name, pct: pct, rows: rows }); }
    }
    if (!header) throw new Error('La hoja "' + sheet.name + '" está vacía.');

    /* Compactar */
    var periods = new Set(), asesores = new Set(), unidades = new Set(), scopes = new Set();
    sales.forEach(function (v, k) { var p = k.split('|'); periods.add(+p[0]); asesores.add(p[1]); unidades.add(p[2]); });
    var act = new Map();
    clients.forEach(function (net, k) {
      if (!(net > 0.009)) return;
      var p = k.split('|');
      var ak = p[0] + '|' + p[1] + '|' + p[2];
      act.set(ak, (act.get(ak) || 0) + 1);
    });
    act.forEach(function (v, k) { scopes.add(k.split('|')[2]); });
    var P = Array.from(periods).sort(function (a, b) { return a - b; });
    var A = Array.from(asesores).sort(), U = Array.from(unidades).sort(), S = Array.from(scopes).sort();
    var iP = new Map(P.map(function (x, i) { return [x, i]; })), iA = new Map(A.map(function (x, i) { return [x, i]; }));
    var iU = new Map(U.map(function (x, i) { return [x, i]; })), iS = new Map(S.map(function (x, i) { return [x, i]; }));
    var ventas = [], activaciones = [];
    sales.forEach(function (v, k) {
      var p = k.split('|');
      ventas.push([iP.get(+p[0]), iA.get(p[1]), iU.get(p[2]), Math.round(v[0] * 100) / 100, Math.round(v[1] * 1000) / 1000]);
    });
    act.forEach(function (n, k) {
      var p = k.split('|');
      activaciones.push([iP.get(+p[0]), iA.get(p[1]), iS.get(p[2]), n]);
    });
    onProgress({ stage: 'Listo', pct: 100, rows: rows });
    return {
      tipo: 'historico', version: 1,
      fuente: { archivo: opts.fileName || '', tamano: blob.size, hoja: sheet.name, filas: rows, omitidas: skipped,
        procesado: new Date().toISOString(), subcategoriasClave: keySubs, unidadNestle: nestleUnit },
      periodos: P, asesores: A, unidades: U, alcances: S, ventas: ventas, activaciones: activaciones
    };
  }

  root.HistoricoCore = { parseHistorico: parseHistorico };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.HistoricoCore;
})(typeof self !== 'undefined' ? self : globalThis);
