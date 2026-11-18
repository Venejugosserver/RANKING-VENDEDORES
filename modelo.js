/*
  Modelo de ranking comercial segmentado (Venejugos).
  Entrada: histórico procesado (historico-core.js), metas Rolling/activación (rolling.js) y configuración.
  Salida: puntaje por asesor, equipos y control de casos especiales.
*/
(function (root) {
  'use strict';

  var CONFIG_BASE = {
    unidades: { nestle: 'NESTLE', pepsico: 'PEPSICO', sanDomingo: 'SAN DOMINGO' },
    subcategoriasClave: ['CALDOS', 'SOPAS', 'GALLETAS', 'CHOCOLATES'],
    casosEspeciales: ['LILIANA ROMERO'],
    noVendedores: ['DIRECTO OFICINA', 'VENEJUGOS EMPLEADOS'],
    excluirEspecialesDeLaBase: true,
    mesesBase: 3,
    tope: 120,
    pesoModo: 'automatico',
    pesosManuales: { nestle: 35, pepsico: 10, sanDomingo: 5, resto: 50 },
    nestle: { rolling: 50, activacion: 50, metaRestoPct: 50,
      sub: { CALDOS: 21.25, SOPAS: 21.25, GALLETAS: 21.25, CHOCOLATES: 21.25, RESTO: 15 } },
    pepsico: { rolling: 50, activacion: 50 },
    sanDomingo: { rolling: 50, activacion: 50 },
    resto: { minMeses: 2, minPromedioUsd: 50 }
  };

  var BLOQUES = [
    { id: 'nestle', nombre: 'Nestlé' },
    { id: 'pepsico', nombre: 'PepsiCo' },
    { id: 'sanDomingo', nombre: 'Café San Domingo' },
    { id: 'resto', nombre: 'Otras líneas' }
  ];

  function norm(s) {
    return String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toUpperCase().replace(/\s+/g, ' ').trim();
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function mergeConfig(c) {
    var out = clone(CONFIG_BASE);
    (function deep(t, s) {
      if (!s) return;
      Object.keys(s).forEach(function (k) {
        if (s[k] && typeof s[k] === 'object' && !Array.isArray(s[k]) && t[k] && typeof t[k] === 'object') deep(t[k], s[k]);
        else t[k] = s[k];
      });
    })(out, c);
    return out;
  }

  /* Índices rápidos sobre el histórico */
  function indexar(hist) {
    var ventas = new Map(), act = new Map(), porUnidadMes = new Map(), activoMes = new Map();
    var A = hist.asesores.map(norm), U = hist.unidades.map(norm), S = hist.alcances.map(norm);
    hist.ventas.forEach(function (r) {
      var p = hist.periodos[r[0]], a = A[r[1]], u = U[r[2]];
      var k = p + '|' + a + '|' + u, cur = ventas.get(k) || [0, 0];
      cur[0] += r[3]; cur[1] += r[4]; ventas.set(k, cur);
      if (r[3] > 0) activoMes.set(p + '|' + a, true);
    });
    hist.activaciones.forEach(function (r) {
      var k = hist.periodos[r[0]] + '|' + A[r[1]] + '|' + S[r[2]];
      act.set(k, (act.get(k) || 0) + r[3]);
    });
    return {
      ventas: ventas, act: act, activoMes: activoMes,
      asesores: Array.from(new Set(A)), unidades: Array.from(new Set(U)), periodos: hist.periodos.slice()
    };
  }

  function periodosBase(periodos, evalP, n) {
    var prev = periodos.filter(function (p) { return p < evalP; });
    if (n > 0) prev = prev.slice(-n);
    return prev;
  }

  function cap(x, tope) { if (!isFinite(x) || x < 0) return 0; return Math.min(x, tope / 100); }

  function calcular(hist, rolling, cfgIn, evalP) {
    var cfg = mergeConfig(cfgIn);
    var ix = indexar(hist);
    var UN = { nestle: norm(cfg.unidades.nestle), pepsico: norm(cfg.unidades.pepsico), sanDomingo: norm(cfg.unidades.sanDomingo) };
    var principales = [UN.nestle, UN.pepsico, UN.sanDomingo];
    var especiales = cfg.casosEspeciales.map(norm), noVend = cfg.noVendedores.map(norm);
    if (!evalP) evalP = ix.periodos[ix.periodos.length - 1];
    var base = periodosBase(ix.periodos, evalP, +cfg.mesesBase || 0);
    var avisos = [];
    if (!base.length) { avisos.push('No hay meses anteriores al mes evaluado: el promedio se calcula con el mismo mes.'); base = [evalP]; }

    function v(p, a, u) { return ix.ventas.get(p + '|' + a + '|' + u) || [0, 0]; }
    function act(p, a, s) { return ix.act.get(p + '|' + a + '|' + s) || 0; }

    /* 1. Ponderación global por promedio de facturación */
    var totU = {}, mesesU = {};
    ix.ventas.forEach(function (val, k) {
      var p = +k.split('|')[0];
      if (base.indexOf(p) < 0) return;
      var parts = k.split('|'), a = parts[1], u = parts[2];
      if (cfg.excluirEspecialesDeLaBase && especiales.indexOf(a) >= 0) return;
      totU[u] = totU[u] || {}; totU[u][p] = (totU[u][p] || 0) + val[0];
    });
    var promU = {}, sumProm = 0;
    Object.keys(totU).forEach(function (u) {
      var ms = Object.keys(totU[u]).filter(function (p) { return totU[u][p] > 0; });
      var s = ms.reduce(function (t, p) { return t + totU[u][p]; }, 0);
      mesesU[u] = ms.length;
      promU[u] = ms.length ? s / ms.length : 0;
      if (promU[u] > 0) sumProm += promU[u];
    });
    var lineasResto = Object.keys(promU).filter(function (u) { return principales.indexOf(u) < 0 && promU[u] > 0; })
      .sort(function (a, b) { return promU[b] - promU[a]; });
    var promResto = lineasResto.reduce(function (t, u) { return t + promU[u]; }, 0);
    var pesosAuto = {
      nestle: sumProm ? (promU[UN.nestle] || 0) / sumProm * 100 : 0,
      pepsico: sumProm ? (promU[UN.pepsico] || 0) / sumProm * 100 : 0,
      sanDomingo: sumProm ? (promU[UN.sanDomingo] || 0) / sumProm * 100 : 0,
      resto: sumProm ? promResto / sumProm * 100 : 0
    };
    var pesos = cfg.pesoModo === 'manual' ? clone(cfg.pesosManuales) : pesosAuto;

    /* 2. Metas */
    var metas = {}, supervisores = {};
    if (rolling && rolling.vendedores) {
      Object.keys(rolling.vendedores).forEach(function (n) { metas[norm(n)] = rolling.vendedores[n]; });
      Object.keys(rolling.supervisores || {}).forEach(function (n) {
        supervisores[norm(n)] = rolling.supervisores[n].map(norm);
      });
    }
    Object.keys(supervisores).forEach(function (s) { if (noVend.indexOf(s) >= 0) delete supervisores[s]; });
    var equipoDe = {};
    Object.keys(supervisores).forEach(function (s) { supervisores[s].forEach(function (m) { if (!equipoDe[m]) equipoDe[m] = s; }); });

    var subsClave = cfg.subcategoriasClave.map(norm);
    var subPesos = {};
    subsClave.concat(['RESTO']).forEach(function (s) { subPesos[s] = +(cfg.nestle.sub[s] != null ? cfg.nestle.sub[s] : 0); });

    function bloqueRollingAct(roll, kg, metaAct, nAct, pr, pa) {
      var ind = [];
      if (roll > 0) ind.push({ id: 'rolling', nombre: 'Rolling (kg)', real: kg, meta: roll, cumpl: kg / roll, peso: pr });
      metaAct = Math.round(metaAct || 0);
      if (metaAct > 0) ind.push({ id: 'activacion', nombre: 'Activación (clientes)', real: nAct, meta: metaAct, cumpl: nAct / metaAct, peso: pa });
      return ind;
    }
    function puntuar(ind, tope) {
      var sw = 0, s = 0;
      ind.forEach(function (i) { i.cumplTope = cap(i.cumpl, tope); if (i.peso > 0) { sw += i.peso; s += i.peso * i.cumplTope; } });
      return sw > 0 ? s / sw : null;
    }

    function evaluarAsesor(a) {
      var m = metas[a] || {};
      var bloques = {};
      /* Nestlé */
      var mn = m.nestle || {};
      var kgN = v(evalP, a, UN.nestle)[1];
      var indN = [];
      if (mn.rolling > 0) indN.push({ id: 'rolling', nombre: 'Rolling Nestlé (kg)', real: kgN, meta: mn.rolling, cumpl: kgN / mn.rolling, peso: +cfg.nestle.rolling });
      var subInd = [];
      subsClave.forEach(function (s) {
        var meta = mn.subcategorias ? Math.round(mn.subcategorias[s] || 0) : null;
        if (meta > 0) {
          var n = act(evalP, a, UN.nestle + '::' + s);
          subInd.push({ id: 'act-' + s, nombre: 'Activación ' + s.charAt(0) + s.slice(1).toLowerCase(), real: n, meta: meta, cumpl: n / meta, peso: subPesos[s] });
        }
      });
      if (mn.cartera > 0 && Math.round(mn.cartera * cfg.nestle.metaRestoPct / 100) > 0) {
        var metaR = Math.round(mn.cartera * cfg.nestle.metaRestoPct / 100), nR = act(evalP, a, UN.nestle + '::RESTO');
        subInd.push({ id: 'act-RESTO', nombre: 'Activación otras marcas Nestlé', real: nR, meta: metaR, cumpl: nR / metaR, peso: subPesos.RESTO });
      }
      var scoreN = null;
      if (indN.length || subInd.length) {
        var sAct = puntuar(subInd, cfg.tope), sRoll = puntuar(indN, cfg.tope);
        var wr = indN.length ? +cfg.nestle.rolling : 0, wa = sAct != null ? +cfg.nestle.activacion : 0;
        scoreN = (wr + wa) > 0 ? ((wr * (sRoll || 0)) + (wa * (sAct || 0))) / (wr + wa) : null;
        subInd.forEach(function (i) { i.grupo = 'activacion'; });
      }
      bloques.nestle = { score: scoreN, indicadores: indN.concat(subInd), cartera: mn.cartera || 0,
        pesoRolling: +cfg.nestle.rolling, pesoActivacion: +cfg.nestle.activacion, ventaUsd: v(evalP, a, UN.nestle)[0] };

      ['pepsico', 'sanDomingo'].forEach(function (b) {
        var mb = m[b] || {}, u = UN[b], vv = v(evalP, a, u);
        var ind = bloqueRollingAct(mb.rolling, vv[1], mb.activacion, act(evalP, a, u), +cfg[b].rolling, +cfg[b].activacion);
        bloques[b] = { score: ind.length ? puntuar(ind, cfg.tope) : null, indicadores: ind, ventaUsd: vv[0] };
      });

      /* Otras líneas: cumplimiento financiero contra el promedio propio */
      var mesesActivo = base.filter(function (p) { return ix.activoMes.get(p + '|' + a); });
      var lineas = [];
      if (mesesActivo.length) {
        var minM = Math.min(+cfg.resto.minMeses || 1, mesesActivo.length);
        lineasResto.forEach(function (u) {
          var tot = 0, meses = 0;
          base.forEach(function (p) { var x = v(p, a, u)[0]; tot += x; if (x > 0) meses++; });
          var prom = tot / mesesActivo.length;
          if (meses >= minM && prom >= (+cfg.resto.minPromedioUsd || 0)) {
            var real = v(evalP, a, u)[0];
            lineas.push({ unidad: u, promedio: prom, real: real, cumpl: real / prom, cumplTope: cap(real / prom, cfg.tope), mesesConVenta: meses });
          }
        });
      }
      lineas.sort(function (x, y) { return y.promedio - x.promedio; });
      var scoreR = lineas.length ? lineas.reduce(function (t, l) { return t + l.cumplTope; }, 0) / lineas.length : null;
      bloques.resto = { score: scoreR, lineas: lineas, pesoPorLinea: lineas.length ? 1 / lineas.length : 0,
        ventaUsd: lineas.reduce(function (t, l) { return t + l.real; }, 0) };

      /* Total con renormalización por bloques aplicables */
      var sw = 0;
      BLOQUES.forEach(function (b) { if (bloques[b.id].score != null && pesos[b.id] > 0) sw += pesos[b.id]; });
      var total = 0;
      BLOQUES.forEach(function (b) {
        var bl = bloques[b.id];
        bl.pesoGlobal = pesos[b.id];
        bl.pesoAplicado = (bl.score != null && sw > 0 && pesos[b.id] > 0) ? pesos[b.id] / sw * 100 : 0;
        bl.puntos = bl.score != null ? bl.pesoAplicado * bl.score : 0;
        total += bl.puntos;
      });
      var ventaTotal = 0;
      ix.unidades.forEach(function (u) { ventaTotal += v(evalP, a, u)[0]; });
      return { asesor: a, equipo: equipoDe[a] || '', total: total, bloques: bloques, ventaTotal: ventaTotal,
        tieneMetas: !!metas[a], bloquesAplicados: BLOQUES.filter(function (b) { return bloques[b.id].score != null; }).length };
    }

    /* 3. Universo del ranking: asesores con metas en el Rolling (sin supervisores ni casos especiales) */
    var universo = Object.keys(metas).filter(function (a) { return noVend.indexOf(a) < 0 && especiales.indexOf(a) < 0; });
    if (!universo.length) {
      avisos.push('Sin archivo de Rolling: el ranking usa los asesores con venta en el mes y solo el bloque de otras líneas.');
      universo = ix.asesores.filter(function (a) {
        return noVend.indexOf(a) < 0 && especiales.indexOf(a) < 0 && a !== 'SIN ASESOR' && ix.activoMes.get(evalP + '|' + a);
      });
    }
    var sinVenta = [];
    var ranking = universo.map(evaluarAsesor).sort(function (x, y) { return y.total - x.total || y.ventaTotal - x.ventaTotal; });
    ranking.forEach(function (r, i) { r.posicion = i + 1; if (!ix.activoMes.get(evalP + '|' + r.asesor)) sinVenta.push(r.asesor); });
    if (sinVenta.length) avisos.push('Sin ventas en el mes evaluado: ' + sinVenta.join(', ') + '.');

    var fueraDeRolling = ix.asesores.filter(function (a) {
      return universo.indexOf(a) < 0 && noVend.indexOf(a) < 0 && especiales.indexOf(a) < 0 && a !== 'SIN ASESOR' && ix.activoMes.get(evalP + '|' + a);
    });

    /* 4. Equipos por supervisor (según subtotales del Rolling) */
    var equipos = Object.keys(supervisores).map(function (s) {
      var miembros = ranking.filter(function (r) { return r.equipo === s; });
      if (!miembros.length) return null;
      return { supervisor: s, miembros: miembros.map(function (r) { return r.asesor; }),
        promedio: miembros.reduce(function (t, r) { return t + r.total; }, 0) / miembros.length,
        venta: miembros.reduce(function (t, r) { return t + r.ventaTotal; }, 0) };
    }).filter(Boolean).sort(function (x, y) { return y.promedio - x.promedio; });

    /* 5. Casos especiales: control independiente, sin posición */
    var control = especiales.map(function (a) {
      var porUnidad = ix.unidades.map(function (u) {
        var real = v(evalP, a, u), tot = 0;
        base.forEach(function (p) { tot += v(p, a, u)[0]; });
        var prom = tot / base.length;
        return { unidad: u, venta: real[0], kg: real[1], promedio: prom, activaciones: act(evalP, a, u) };
      }).filter(function (x) { return Math.abs(x.venta) > 0.009 || x.promedio > 0.009; })
        .sort(function (x, y) { return y.venta - x.venta; });
      var venta = porUnidad.reduce(function (t, x) { return t + x.venta; }, 0);
      var prom = porUnidad.reduce(function (t, x) { return t + x.promedio; }, 0);
      return { asesor: a, venta: venta, promedio: prom, porUnidad: porUnidad, presente: porUnidad.length > 0,
        evaluacion: metas[a] ? evaluarAsesor(a) : null };
    });

    var ventaEmpresa = 0, ventaEspeciales = 0;
    ix.ventas.forEach(function (val, k) {
      var p = k.split('|');
      if (+p[0] !== evalP) return;
      ventaEmpresa += val[0];
      if (especiales.indexOf(p[1]) >= 0) ventaEspeciales += val[0];
    });

    return {
      periodo: evalP, base: base, config: cfg, pesos: pesos, pesosAuto: pesosAuto,
      promedioPorUnidad: promU, mesesPorUnidad: mesesU, lineasResto: lineasResto,
      ranking: ranking, equipos: equipos, control: control, fueraDeRolling: fueraDeRolling,
      ventaEmpresa: ventaEmpresa, ventaEspeciales: ventaEspeciales, avisos: avisos
    };
  }

  root.Modelo = { calcular: calcular, CONFIG_BASE: CONFIG_BASE, BLOQUES: BLOQUES, norm: norm, mergeConfig: mergeConfig };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.Modelo;
})(typeof self !== 'undefined' ? self : globalThis);
