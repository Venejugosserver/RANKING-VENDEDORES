/*
  Lectura del archivo de metas: ROLLING NESTLE, PEPSICO, SAN DOMINGO y ACTIVACIONES.
  Recibe las hojas como matrices de celdas (sheet_to_json con header:1) y devuelve
  las metas por asesor. Las filas de supervisor se reconocen porque suman a los
  asesores que tienen arriba; se guardan como equipos y no entran al ranking.
*/
(function (root) {
  'use strict';

  function txt(v) { return v == null ? '' : String(v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ').trim(); }
  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function n(v) { return isNum(v) ? v : (isFinite(parseFloat(v)) ? parseFloat(v) : 0); }

  function cerca(a, b) { return Math.abs(a - b) <= 0.05 + Math.abs(b) * 1e-6; }

  /* Separa filas de detalle y subtotales de supervisor dentro de una hoja */
  function clasificarFilas(filas) {
    var detalle = [], sup = [], grupo = [];
    filas.forEach(function (f) {
      var esSub = false;
      if (grupo.length >= 2 && f.valores.some(function (x) { return x !== 0; })) {
        esSub = f.valores.every(function (x, i) {
          var s = grupo.reduce(function (t, g) { return t + (g.valores[i] || 0); }, 0);
          return cerca(x, s);
        });
      }
      if (esSub) { sup.push({ nombre: f.nombre, miembros: grupo.map(function (g) { return g.nombre; }) }); grupo = []; }
      else { detalle.push(f); grupo.push(f); }
    });
    return { detalle: detalle, supervisores: sup };
  }

  function filaEncabezado(rows, test, maxR) {
    for (var r = 0; r < Math.min(rows.length, maxR || 15); r++) {
      var row = rows[r] || [];
      for (var c = 0; c < row.length; c++) if (test(txt(row[c]))) return r;
    }
    return -1;
  }

  function columnaNombre(rows, hr) {
    for (var r = 0; r <= hr; r++) {
      var row = rows[r] || [];
      for (var c = 0; c < row.length; c++) if (/^(ASESOR|VENDEDOR)/.test(txt(row[c]))) return c;
    }
    return 0;
  }

  function filasDatos(rows, hr, cn, cols) {
    var out = [];
    for (var r = hr + 1; r < rows.length; r++) {
      var row = rows[r] || [], nombre = txt(row[cn]);
      if (!nombre) continue;
      if (/^TOTAL/.test(nombre)) break;
      var valores = cols.map(function (c) { return n(row[c]); });
      out.push({ nombre: nombre, valores: valores });
    }
    return out;
  }

  function parseRolling(hojas, opts) {
    opts = opts || {};
    var subsClave = (opts.subcategoriasClave || ['CALDOS', 'SOPAS', 'GALLETAS', 'CHOCOLATES']).map(txt);
    var res = { tipo: 'rolling', version: 1, fuente: { archivo: opts.fileName || '', procesado: new Date().toISOString(), hojas: [] },
      vendedores: {}, supervisores: {}, porcentajesNestle: {}, totales: {} };
    var avisos = [];

    function vend(nm) { return res.vendedores[nm] || (res.vendedores[nm] = {}); }

    hojas.forEach(function (h) {
      var rows = h.rows;
      /* Hoja Nestlé: CART + subcategorías + ROLLING NESTLE */
      var hrN = filaEncabezado(rows, function (t) { return t === 'CART' || t === 'CARTERA'; });
      if (hrN >= 0) {
        var head = (rows[hrN] || []).map(txt), cn = columnaNombre(rows, hrN);
        var cCart = head.findIndex(function (t) { return t === 'CART' || t === 'CARTERA'; });
        var cRoll = head.findIndex(function (t) { return /ROLLING/.test(t); });
        var cSubs = {};
        subsClave.forEach(function (s) { var i = head.indexOf(s); if (i < 0) i = head.indexOf(s.replace(/S$/, '')); if (i >= 0) cSubs[s] = i; });
        var orden = Object.keys(cSubs);
        var cols = [cCart].concat(orden.map(function (s) { return cSubs[s]; })).concat(cRoll >= 0 ? [cRoll] : []);
        var cl = clasificarFilas(filasDatos(rows, hrN, cn, cols));
        var pctRow = rows[hrN - 1] || [];
        orden.forEach(function (s) { var p = n(pctRow[cSubs[s]]); if (p > 0 && p <= 1) res.porcentajesNestle[s] = p; });
        cl.detalle.forEach(function (f) {
          var o = { cartera: f.valores[0], subcategorias: {}, rolling: cRoll >= 0 ? f.valores[f.valores.length - 1] : 0 };
          orden.forEach(function (s, i) { o.subcategorias[s] = f.valores[i + 1]; });
          if (!vend(f.nombre).nestle) vend(f.nombre).nestle = o;
        });
        cl.supervisores.forEach(function (s) { res.supervisores[s.nombre] = (res.supervisores[s.nombre] || []).concat(s.miembros); });
        res.fuente.hojas.push({ hoja: h.name, tipo: 'Nestlé', asesores: cl.detalle.length, supervisores: cl.supervisores.map(function (s) { return s.nombre; }) });
        if (cRoll < 0) avisos.push('La hoja "' + h.name + '" no tiene columna ROLLING NESTLE.');
        if (orden.length < subsClave.length) avisos.push('En "' + h.name + '" faltan subcategorías: ' + subsClave.filter(function (s) { return orden.indexOf(s) < 0; }).join(', ') + '.');
        return;
      }
      /* Hoja PepsiCo / San Domingo: columnas ROLLING <MARCA> con TOTAL CLIENTES a la izquierda */
      var hrP = filaEncabezado(rows, function (t) { return /^ROLLING (PEPSICO|SAN DOMINGO)/.test(t); });
      if (hrP >= 0) {
        var headP = (rows[hrP] || []).map(txt), cnP = columnaNombre(rows, hrP);
        var marcas = [];
        headP.forEach(function (t, c) {
          var m = /^ROLLING (PEPSICO|SAN DOMINGO)/.exec(t);
          if (!m) return;
          var ca = -1;
          for (var k = c - 1; k >= 0; k--) { if (/TOTAL CLIENTES|ACTIVAC/.test(headP[k])) { ca = k; break; } if (/^ROLLING/.test(headP[k])) break; }
          marcas.push({ id: m[1] === 'PEPSICO' ? 'pepsico' : 'sanDomingo', cRoll: c, cAct: ca });
        });
        var colsP = [];
        marcas.forEach(function (m) { if (m.cAct >= 0) colsP.push(m.cAct); colsP.push(m.cRoll); });
        var clP = clasificarFilas(filasDatos(rows, hrP, cnP, colsP));
        clP.detalle.forEach(function (f) {
          var i = 0;
          marcas.forEach(function (m) {
            var o = { activacion: m.cAct >= 0 ? f.valores[i++] : 0, rolling: f.valores[i++] };
            if (!vend(f.nombre)[m.id]) vend(f.nombre)[m.id] = o;
          });
        });
        clP.supervisores.forEach(function (s) { res.supervisores[s.nombre] = (res.supervisores[s.nombre] || []).concat(s.miembros); });
        res.fuente.hojas.push({ hoja: h.name, tipo: marcas.map(function (m) { return m.id === 'pepsico' ? 'PepsiCo' : 'San Domingo'; }).join(' y '),
          asesores: clP.detalle.length, supervisores: clP.supervisores.map(function (s) { return s.nombre; }) });
        return;
      }
      avisos.push('La hoja "' + h.name + '" no se reconoció (no tiene CART ni ROLLING PEPSICO / SAN DOMINGO).');
    });

    Object.keys(res.supervisores).forEach(function (s) {
      res.supervisores[s] = Array.from(new Set(res.supervisores[s]));
      if (res.vendedores[s] && !res.vendedores[s].nestle && !res.vendedores[s].pepsico) delete res.vendedores[s];
    });
    if (!Object.keys(res.vendedores).length) throw new Error('No se encontraron asesores con metas. Revise que el archivo tenga las hojas NESTLE y PEPSICO Y SAN DOMINGO.');
    res.avisos = avisos;
    return res;
  }

  root.RollingParser = { parseRolling: parseRolling };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.RollingParser;
})(typeof self !== 'undefined' ? self : globalThis);
