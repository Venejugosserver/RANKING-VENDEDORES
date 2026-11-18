/* Ranking comercial Venejugos: estado, cargas, cálculo y tablero. */
(function () {
  'use strict';

  var LS_DATOS = 'ranking_vj_datos', LS_GH = 'ranking_vj_github';
  var MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  var CLASE = { nestle: 'c-nestle', pepsico: 'c-pepsico', sanDomingo: 'c-sd', resto: 'c-resto' };
  var VAR_COLOR = { nestle: '--s-nestle', pepsico: '--s-pepsico', sanDomingo: '--s-sd', resto: '--s-resto' };
  var TABLERO = ['ranking', 'bloques', 'grupos', 'control'], ADMIN = ['historico', 'rolling', 'modelo', 'github'];

  var S = {
    datos: { version: 1, actualizado: null, historico: null, rolling: null, config: {} },
    mes: null, grupo: 'TODOS', orden: 'total', bloque: 'nestle', origen: '', cargaInicial: true,
    cache: new Map(), anchos: {}, graficos: {}, vista: 'ranking', visible: [], primera: true, cuenta: 0
  };

  /* ---------- utilidades ---------- */
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  var fmtUsd = new Intl.NumberFormat('es-VE', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  var fmt0 = new Intl.NumberFormat('es-VE', { maximumFractionDigits: 0 });
  var fmt1 = new Intl.NumberFormat('es-VE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  function usd(x) { return fmtUsd.format(x || 0); }
  function pct(x) { return x == null || !isFinite(x) ? 'sin meta' : fmt0.format(x * 100) + ' %'; }
  function titulo(s) { return String(s).toLowerCase().replace(/(^|[\s(])([a-záéíóúñ])/g, function (m, a, b) { return a + b.toUpperCase(); }); }
  function corto(s) { var p = titulo(s).split(' '); return p.length > 1 ? p[0] + ' ' + p[1].charAt(0) + '.' : p[0]; }
  function nombreMes(p) { return MESES[(p % 100) - 1] + ' ' + Math.floor(p / 100); }
  function mesMin(p) { return MESES[(p % 100) - 1].toLowerCase(); }
  function rangoMeses(l) { if (!l.length) return ''; if (l.length === 1) return mesMin(l[0]); return 'de ' + mesMin(l[0]) + ' a ' + mesMin(l[l.length - 1]); }
  function fecha(iso) { try { return new Date(iso).toLocaleString('es-VE', { dateStyle: 'medium', timeStyle: 'short' }); } catch (e) { return iso || ''; } }
  function fechaCorta(iso) { try { return new Date(iso).toLocaleDateString('es-VE', { day: 'numeric', month: 'short', year: 'numeric' }); } catch (e) { return ''; } }
  /* Semáforo del tablero KPI: verde desde 100 %, ámbar desde 70 %, rojo debajo. Recibe fracción (1 = 100 %). */
  function sem(f) { return f == null || !isFinite(f) ? '' : (f >= 1 ? 'ok' : (f >= 0.7 ? 'med' : 'mal')); }
  function estado(el, html, tipo, base) { el.className = (base || 'estado') + (tipo ? ' ' + tipo : ''); el.innerHTML = html || ''; }
  function css(v) { return getComputedStyle(document.documentElement).getPropertyValue(v).trim(); }
  var reducido = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- almacenamiento ---------- */
  function leerLocal() {
    try { var d = JSON.parse(localStorage.getItem(LS_DATOS) || 'null'); if (d && d.version) return d; } catch (e) { /* datos dañados */ }
    return null;
  }
  function guardarLocal() {
    try { localStorage.setItem(LS_DATOS, JSON.stringify(S.datos)); return true; }
    catch (e) { registrar('No se pudo guardar en este navegador (espacio lleno). Publica en GitHub para no perder los datos.', true); return false; }
  }
  function ghCfg() { try { return JSON.parse(localStorage.getItem(LS_GH) || '{}'); } catch (e) { return {}; } }
  function ghListo(c) { c = c || ghCfg(); return !!(c.owner && c.repo && c.token); }
  function cambiosGuardados(motivo) {
    S.datos.actualizado = new Date().toISOString();
    S.cache.clear();
    guardarLocal();
    var c = ghCfg();
    if (c.auto && ghListo(c)) publicarGitHub(motivo);
  }

  /* ---------- cálculo con caché por mes ---------- */
  function calc(p) {
    if (!S.datos.historico) return null;
    if (!S.cache.has(p)) S.cache.set(p, window.Modelo.calcular(S.datos.historico, S.datos.rolling, S.datos.config, p));
    return S.cache.get(p);
  }
  function periodos() { return S.datos.historico ? S.datos.historico.periodos : []; }
  function mesAnterior(p) { var l = periodos(), i = l.indexOf(p); return i > 0 ? l[i - 1] : null; }
  function cfgActual() { return window.Modelo.mergeConfig(S.datos.config); }

  /* ---------- gráficos ---------- */
  var lineaCien = {
    id: 'lineaCien',
    afterDatasetsDraw: function (ch, args, o) {
      if (!o || o.valor == null) return;
      var esc = o.horizontal ? ch.scales.x : ch.scales.y; if (!esc) return;
      var p = esc.getPixelForValue(o.valor), a = ch.chartArea, ctx = ch.ctx;
      ctx.save(); ctx.strokeStyle = css('--marino'); ctx.setLineDash([5, 4]); ctx.lineWidth = 1.5; ctx.beginPath();
      if (o.horizontal) { ctx.moveTo(p, a.top); ctx.lineTo(p, a.bottom); } else { ctx.moveTo(a.left, p); ctx.lineTo(a.right, p); }
      ctx.stroke(); ctx.restore();
    }
  };
  function grafico(id, cfg) {
    var cv = $(id); if (!cv) return;
    if (S.graficos[id]) { S.graficos[id].destroy(); delete S.graficos[id]; }
    if (!window.Chart) {
      var p = cv.parentNode; if (!p.querySelector('.nota')) p.insertAdjacentHTML('beforeend', '<p class="nota">No se pudo cargar la librería de gráficos. Revisa la conexión y recarga la página; las tablas siguen disponibles.</p>');
      return;
    }
    cfg.options = cfg.options || {};
    cfg.options.maintainAspectRatio = false;
    cfg.options.responsive = true;
    if (reducido) cfg.options.animation = false;
    S.graficos[id] = new window.Chart(cv, cfg);
  }
  function prepararChart() {
    if (!window.Chart) return;
    window.Chart.defaults.font.family = "'Manrope', 'Segoe UI', Roboto, sans-serif";
    window.Chart.defaults.font.size = 12;
    window.Chart.defaults.color = css('--g-texto');
    window.Chart.defaults.plugins.legend.labels.boxWidth = 12;
    window.Chart.register(lineaCien);
  }

  /* ---------- navegación ---------- */
  var TEXTOS = {
    ranking: ['Ranking comercial de asesores.', 'Rolling en kilos, activación de cartera y venta por línea, en una sola tabla de posiciones.'],
    bloques: ['Cumplimiento por bloque.', 'Metas del Rolling, activados y lo que falta, por asesor y por grupo.'],
    grupos: ['Grupos del Rolling.', 'Puntaje promedio de cada grupo y la posición de cada asesor.'],
    control: ['Control independiente.', 'Casos con condiciones comerciales especiales: se auditan aquí y no ocupan posición.'],
    historico: ['Carga del histórico.', 'El archivo se procesa en este navegador y no se sube a ningún servidor.'],
    rolling: ['Carga del Rolling.', 'Metas de kilos y de activación por asesor para Nestlé, PepsiCo y San Domingo.'],
    modelo: ['Modelo y pesos.', 'Cómo se reparten los 100 puntos y las reglas de cada bloque.'],
    github: ['Conexión GitHub.', 'Publica los datos procesados para que todo el equipo vea el mismo ranking.']
  };
  function textos(R) {
    var t = TEXTOS[S.vista] || TEXTOS.ranking, extra = '';
    if (R && TABLERO.indexOf(S.vista) >= 0) extra = ' ' + nombreMes(R.periodo) + (S.datos.actualizado ? ', datos actualizados el ' + fechaCorta(S.datos.actualizado) : '') + '.';
    $('titular').textContent = t[0];
    $('bajada').textContent = t[1] + extra;
  }
  function aviso(msg, tipo) {
    var el = $('aviso');
    el.textContent = msg; el.className = 'aviso' + (tipo === 'error' ? ' error' : '');
    requestAnimationFrame(function () { el.classList.add('ver'); });
    clearTimeout(aviso.t); aviso.t = setTimeout(function () { el.classList.remove('ver'); }, 3800);
  }
  function conTransicion(fn) {
    if (document.startViewTransition && !reducido && !S.cargaInicial) document.startViewTransition(fn); else fn();
  }
  function irA() { conTransicion(mostrarVista); }
  function mostrarVista() {
    var v = (location.hash || '#ranking').slice(1);
    if (TABLERO.indexOf(v) < 0 && ADMIN.indexOf(v) < 0) v = 'ranking';
    S.vista = v;
    var admin = ADMIN.indexOf(v) >= 0;
    $('navTablero').hidden = admin; $('navAdmin').hidden = !admin;
    TABLERO.concat(ADMIN).forEach(function (x) { $('vista-' + x).hidden = x !== v; });
    document.querySelectorAll('.chips a.chip').forEach(function (a) {
      if (a.dataset.vista === v) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    document.querySelectorAll('.segmentos a').forEach(function (a) {
      if (a.dataset.seccion === (admin ? 'admin' : 'tablero')) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    textos(null);
    if (admin) {
      $('tablero').hidden = true; $('filtros').hidden = true; estado($('estadoGeneral'), '', '', 'estado-g');
      $('pieFuentes').textContent = textoFuentes();
      if (v === 'modelo') pintarModelo();
      if (v === 'historico') pintarResumenHist();
      if (v === 'rolling') pintarResumenRolling();
      if (v === 'github') pintarGitHub();
    } else pintarTablero();
  }

  /* Entrada escalonada de las tarjetas: solo la primera vez que se pinta el tablero */
  function aparecer(raiz) {
    if (!S.primera || reducido) return;
    raiz.querySelectorAll('.tarjeta').forEach(function (el) {
      if (el.offsetParent === null) return;
      el.classList.add('aparece'); el.style.setProperty('--i', S.cuenta++);
      el.addEventListener('animationend', function () { el.classList.remove('aparece'); }, { once: true });
    });
  }

  /* ================= TABLERO ================= */
  function pintarTablero() {
    var eg = $('estadoGeneral');
    $('pieFuentes').textContent = textoFuentes();
    if (!S.datos.historico) {
      $('tablero').hidden = true; $('filtros').hidden = true;
      textos(null);
      if (S.cargaInicial) { estado(eg, '<p class="cargando">Buscando los datos publicados del ranking.</p>', '', 'estado-g'); return; }
      estado(eg, '<h2>Carga los dos archivos para generar el ranking</h2><p>El histórico de ventas da la venta, los kilos y las activaciones de cada asesor. El Rolling da las metas de kilos y de activación de Nestlé, PepsiCo y San Domingo.</p>' +
        '<div class="acciones"><a class="btn btn-primario" href="#historico">Cargar histórico de ventas</a><a class="btn btn-borde" href="#rolling">Cargar Rolling y activaciones</a></div>', 'vacio', 'estado-g');
      return;
    }
    var R;
    try { var per = periodos(); if (!S.mes || per.indexOf(S.mes) < 0) S.mes = per[per.length - 1]; R = calc(S.mes); }
    catch (e) {
      $('tablero').hidden = true; $('filtros').hidden = true;
      estado(eg, '<h2>No se pudo calcular el ranking</h2><p>' + esc(e.message) + '</p><div class="acciones"><a class="btn btn-borde" href="#historico">Revisar el histórico</a></div>', 'error', 'estado-g');
      return;
    }
    estado(eg, '', '', 'estado-g');
    $('tablero').hidden = false; $('filtros').hidden = false;
    var pa = mesAnterior(R.periodo), Rp = pa ? calc(pa) : null;
    var posAnt = {}; if (Rp) Rp.ranking.forEach(function (r) { posAnt[r.asesor] = r.posicion; });
    R.ranking.forEach(function (r) { r.posAnterior = posAnt[r.asesor] || null; });

    pintarFiltros(R);
    var lista = filtrar(R);
    S.visible = lista;
    textos(R);

    pintarKpis(R, Rp, lista);
    pintarAvisos(R);
    if (S.vista === 'ranking') { pintarNarrativa(R, Rp, lista); pintarLista(R, lista); pintarReparto(R); pintarCumplBloques(R, lista); }
    if (S.vista === 'bloques') pintarBloque(R, lista);
    if (S.vista === 'grupos') pintarGrupos(R);
    if (S.vista === 'control') pintarControl(R);
    aparecer($('tablero'));
    S.primera = false;
  }

  function pintarFiltros(R) {
    $('selMes').innerHTML = periodos().slice().reverse().map(function (p) { return '<option value="' + p + '"' + (p === R.periodo ? ' selected' : '') + '>' + nombreMes(p) + '</option>'; }).join('');
    $('selBase').value = String(R.config.mesesBase);
    var grupos = R.equipos.map(function (e) { return e.supervisor; });
    if (S.grupo !== 'TODOS' && grupos.indexOf(S.grupo) < 0) S.grupo = 'TODOS';
    $('selGrupo').innerHTML = '<option value="TODOS">Todos los grupos</option>' + grupos.map(function (g) { return '<option value="' + esc(g) + '"' + (g === S.grupo ? ' selected' : '') + '>' + esc(titulo(g)) + '</option>'; }).join('');
    $('selOrden').value = S.orden;
  }

  function valorOrden(r) {
    if (S.orden === 'total') return r.total;
    if (S.orden === 'venta') return r.ventaTotal;
    return r.bloques[S.orden].puntos;
  }
  function filtrar(R) {
    var l = R.ranking.filter(function (r) { return S.grupo === 'TODOS' || r.equipo === S.grupo; });
    return l.slice().sort(function (a, b) { return valorOrden(b) - valorOrden(a) || a.posicion - b.posicion; });
  }

  function textoFuentes() {
    var d = S.datos, partes = [];
    if (d.historico) partes.push('Histórico: ' + (d.historico.fuente.archivo || 'sin nombre') + ' (' + fecha(d.historico.fuente.procesado) + ')');
    if (d.rolling) partes.push('Rolling: ' + (d.rolling.fuente.archivo || 'sin nombre') + ' (' + fecha(d.rolling.fuente.procesado) + ')');
    if (S.origen) partes.push('Origen de los datos: ' + S.origen);
    return partes.length ? partes.join('. ') + '.' : 'Sin datos cargados.';
  }

  /* ---------- KPI ---------- */
  function prom(l, f) { return l.length ? l.reduce(function (t, x) { return t + f(x); }, 0) / l.length : 0; }
  function pintarKpis(R, Rp, lista) {
    var avg = prom(lista, function (r) { return r.total; });
    var listaAnt = Rp ? Rp.ranking.filter(function (r) { return S.grupo === 'TODOS' || r.equipo === S.grupo; }) : [];
    var avgAnt = listaAnt.length ? prom(listaAnt, function (r) { return r.total; }) : null;
    var dif = avgAnt != null ? avg - avgAnt : null;
    var lider = lista.slice().sort(function (a, b) { return b.total - a.total; })[0];
    var n = { ok: 0, med: 0, mal: 0 };
    lista.forEach(function (r) { n[sem(r.total / 100)]++; });
    var venta = lista.reduce(function (t, r) { return t + r.ventaTotal; }, 0);
    var esp = R.control.filter(function (c) { return c.presente; });
    var movLider = '';
    if (lider && lider.posAnterior) {
      var d = lider.posAnterior - lider.posicion;
      movLider = d > 0 ? ' Subió ' + d + (d === 1 ? ' puesto' : ' puestos') + ' frente a ' + mesMin(Rp.periodo) + '.' : (d < 0 ? ' Bajó ' + (-d) + (d === -1 ? ' puesto' : ' puestos') + ' frente a ' + mesMin(Rp.periodo) + '.' : ' Repite el primer lugar.');
    }
    var html = '';
    html += '<article class="tarjeta kpi c3 ' + sem(avg / 100) + '"><p class="rot">Puntaje promedio' + (S.grupo === 'TODOS' ? ' de la fuerza de ventas' : ' del grupo') + '</p>' +
      '<p class="val">' + fmt1.format(avg) + '<small>de 100</small></p>' +
      '<div class="barrita"><span class="' + sem(avg / 100) + '" data-w="' + Math.min(100, avg) + '"></span></div>' +
      '<p class="pie">' + (dif == null ? 'Sin mes anterior para comparar.' : mesMin(Rp.periodo).charAt(0).toUpperCase() + mesMin(Rp.periodo).slice(1) + ': <b>' + fmt1.format(avgAnt) + '</b> (' + (dif >= 0 ? '+' : '') + fmt1.format(dif) + ' puntos).') + '</p></article>';
    html += '<article class="tarjeta kpi c3 ' + (lider ? sem(lider.total / 100) : '') + '"><p class="rot">Primer lugar</p>' +
      '<p class="val nombre">' + (lider ? esc(titulo(lider.asesor)) : 'Sin asesores') + '</p>' +
      '<p class="pie">' + (lider ? '<b>' + fmt1.format(lider.total) + ' puntos</b>' + (lider.equipo ? ', grupo ' + esc(titulo(lider.equipo)) : '') + '.' + movLider : '') + '</p></article>';
    var tot = lista.length || 1;
    html += '<article class="tarjeta kpi c3"><p class="rot">Asesores por semáforo</p>' +
      '<p class="val">' + n.ok + '<small>en verde, desde 100</small></p>' +
      '<div class="cintas" aria-hidden="true"><span class="ok" style="flex-grow:' + n.ok / tot + '"></span><span class="med" style="flex-grow:' + n.med / tot + '"></span><span class="mal" style="flex-grow:' + n.mal / tot + '"></span></div>' +
      '<p class="pie"><b>' + n.med + '</b> en ámbar (70 a 99) y <b>' + n.mal + '</b> en rojo (menos de 70).</p></article>';
    html += '<article class="tarjeta kpi c3"><p class="rot">Venta del mes de los asesores rankeados</p>' +
      '<p class="val">' + usd(venta) + '</p>' +
      '<p class="pie">' + (esp.length ? 'Fuera del ranking: ' + esp.map(function (c) { return esc(titulo(c.asesor)) + ' <b>' + usd(c.venta) + '</b>'; }).join(', ') + '.' : 'Sin casos especiales con venta en el mes.') + '</p></article>';
    $('kpis').innerHTML = html;
    animarAnchos($('kpis'));
  }
  function animarAnchos(raiz) {
    var els = raiz.querySelectorAll('[data-w]');
    requestAnimationFrame(function () { requestAnimationFrame(function () { els.forEach(function (e) { e.style.width = e.dataset.w + '%'; }); }); });
  }

  function pintarAvisos(R) {
    var av = R.avisos.slice();
    if (R.fueraDeRolling.length) av.push('Con venta en el mes pero sin metas en el Rolling (no se rankean): ' + R.fueraDeRolling.map(titulo).join(', ') + '.');
    if (S.datos.rolling && S.datos.rolling.avisos) av = av.concat(S.datos.rolling.avisos);
    if (!S.datos.rolling) av.unshift('Falta el archivo de Rolling: solo se mide la venta de otras líneas. Cárgalo en el panel administrativo.');
    $('avisos').innerHTML = av.length ? '<article class="tarjeta revisar c12"><h2>Para revisar</h2><ul>' + av.map(function (a) { return '<li>' + esc(a) + '</li>'; }).join('') + '</ul></article>' : '';
  }

  /* ---------- Narrativa: frases calculadas con los datos del mes ---------- */
  function pintarNarrativa(R, Rp, lista) {
    var p = [], orden = lista.slice().sort(function (a, b) { return b.total - a.total; });
    if (!orden.length) { $('narrativa').innerHTML = '<p>No hay asesores para mostrar con este filtro.</p>'; return; }
    var a = orden[0], b = orden[1];
    p.push('<b>' + esc(titulo(a.asesor)) + '</b> encabeza ' + mesMin(R.periodo) + ' con <b>' + fmt1.format(a.total) + ' puntos</b>' +
      (b ? ', ' + fmt1.format(a.total - b.total) + ' por encima de ' + esc(titulo(b.asesor)) + '.' : '.'));
    if (Rp) {
      var mov = lista.filter(function (r) { return r.posAnterior; }).map(function (r) { return { r: r, d: r.posAnterior - r.posicion }; });
      var sube = mov.slice().sort(function (x, y) { return y.d - x.d; })[0];
      var baja = mov.slice().sort(function (x, y) { return x.d - y.d; })[0];
      var t = [];
      if (sube && sube.d > 0) t.push('la mayor subida es de <b>' + esc(titulo(sube.r.asesor)) + '</b>, del puesto ' + sube.r.posAnterior + ' al ' + sube.r.posicion);
      if (baja && baja.d < 0) t.push('la mayor caída es de <b>' + esc(titulo(baja.r.asesor)) + '</b>, del ' + baja.r.posAnterior + ' al ' + baja.r.posicion);
      if (t.length) p.push('Frente a ' + mesMin(Rp.periodo) + ', ' + t.join(', y ') + '.');
    }
    var bl = window.Modelo.BLOQUES.map(function (bq) {
      var con = lista.filter(function (r) { return r.bloques[bq.id].score != null; });
      return { b: bq, v: con.length ? prom(con, function (r) { return r.bloques[bq.id].score; }) : null };
    }).filter(function (x) { return x.v != null; }).sort(function (x, y) { return x.v - y.v; });
    if (bl.length) {
      var bajo = bl[0], frase = 'El bloque con menor cumplimiento promedio es <b>' + esc(bajo.b.nombre) + '</b> (' + pct(bajo.v) + ').';
      var subs = {};
      lista.forEach(function (r) { r.bloques.nestle.indicadores.forEach(function (i) { if (i.grupo) { (subs[i.nombre] = subs[i.nombre] || []).push(i.cumpl); } }); });
      var peor = Object.keys(subs).map(function (k) { return { k: k, v: subs[k].reduce(function (t, x) { return t + x; }, 0) / subs[k].length }; }).sort(function (x, y) { return x.v - y.v; })[0];
      if (peor) frase += ' En Nestlé, la activación más rezagada es ' + esc(peor.k.replace('Activación ', '').toLowerCase()) + ', con ' + pct(peor.v) + ' de la meta en promedio.';
      p.push(frase);
    }
    if (S.grupo === 'TODOS' && R.equipos.length) {
      var e = R.equipos[0];
      p.push('El grupo de <b>' + esc(titulo(e.supervisor)) + '</b> tiene el mejor promedio: ' + fmt1.format(e.promedio) + ' puntos.');
    }
    $('narrativa').innerHTML = '<h2>Lectura del mes</h2>' + p.map(function (x) { return '<p>' + x + '</p>'; }).join('');
  }

  /* ---------- Posiciones con reordenamiento animado ---------- */
  function movHtml(r) {
    if (!r.posAnterior) return '<span class="mov nuevo" title="Sin posición el mes anterior">nuevo</span>';
    var d = r.posAnterior - r.posicion;
    if (d > 0) return '<span class="mov sube"><span aria-hidden="true">▲</span> ' + d + '<span class="sr"> puestos arriba</span></span>';
    if (d < 0) return '<span class="mov baja"><span aria-hidden="true">▼</span> ' + (-d) + '<span class="sr"> puestos abajo</span></span>';
    return '<span class="mov igual"><span aria-hidden="true">=</span><span class="sr">misma posición</span></span>';
  }
  function anchos(r, tope) { return window.Modelo.BLOQUES.map(function (b) { return Math.max(0, r.bloques[b.id].puntos || 0) / tope * 100; }); }
  function barraPts(r, tope, previos) {
    var w = anchos(r, tope);
    return '<span class="barra-pts" aria-hidden="true">' + window.Modelo.BLOQUES.map(function (b, i) {
      return '<i class="' + CLASE[b.id] + '" style="width:' + (previos ? previos[i] : 0).toFixed(2) + '%" data-w="' + w[i].toFixed(2) + '"></i>';
    }).join('') + '<span class="m100" style="left:' + (100 / tope * 100).toFixed(2) + '%"></span></span>';
  }
  function pintarLista(R, lista) {
    var ol = $('listaRanking');
    $('subPos').textContent = (S.grupo === 'TODOS' ? lista.length + ' asesores' : 'Grupo ' + titulo(S.grupo) + ', ' + lista.length + ' asesores') +
      '. Pesos y promedios ' + rangoMeses(R.base) + (R.config.pesoModo === 'manual' ? ', pesos fijados a mano' : '') + '. Toca un asesor para ver su detalle.';
    $('leyenda').innerHTML = window.Modelo.BLOQUES.map(function (b) { return '<span><i class="' + CLASE[b.id] + '"></i>' + esc(b.nombre) + '</span>'; }).join('') + '<span>La raya marca 100</span>';
    if (!lista.length) { ol.innerHTML = '<li class="nota">No hay asesores para rankear con este filtro.</li>'; return; }
    var antes = {};
    ol.querySelectorAll('.fila').forEach(function (li) { antes[li.dataset.a] = li.getBoundingClientRect().top; });
    ol.innerHTML = lista.map(function (r) {
      var desc = window.Modelo.BLOQUES.map(function (b) { return b.nombre + ' ' + fmt1.format(r.bloques[b.id].puntos); }).join(', ');
      return '<li class="fila" data-pos="' + r.posicion + '" data-a="' + esc(r.asesor) + '"><button type="button" class="fila-btn" data-a="' + esc(r.asesor) + '">' +
        '<span class="pos">' + r.posicion + '</span>' + movHtml(r) +
        '<span class="quien"><b>' + esc(titulo(r.asesor)) + '</b><small>' + (r.equipo ? 'Grupo ' + esc(titulo(r.equipo)) + '. ' : '') + usd(r.ventaTotal) + '</small></span>' +
        barraPts(r, R.config.tope, S.anchos[r.asesor]) +
        '<span class="puntaje"><span class="pill ' + sem(r.total / 100) + '">' + fmt1.format(r.total) + '</span></span>' +
        '<span class="sr">Puntos por bloque: ' + esc(desc) + '. Abrir detalle.</span></button></li>';
    }).join('');
    /* FLIP: cada fila parte de donde estaba y se desliza a su nueva posición */
    if (!reducido && ol.animate) {
      ol.querySelectorAll('.fila').forEach(function (li) {
        var y0 = antes[li.dataset.a];
        if (y0 == null) return;
        var dy = y0 - li.getBoundingClientRect().top;
        if (Math.abs(dy) > 1) li.animate([{ transform: 'translateY(' + dy + 'px)' }, { transform: 'none' }], { duration: 520, easing: 'cubic-bezier(.2,.7,.2,1)' });
      });
    }
    lista.forEach(function (r) { S.anchos[r.asesor] = anchos(r, R.config.tope); });
    animarAnchos(ol);
  }

  function pintarReparto(R) {
    var total = 0; window.Modelo.BLOQUES.forEach(function (b) { total += R.pesos[b.id] || 0; });
    var datos = window.Modelo.BLOQUES.map(function (b) { return total ? (R.pesos[b.id] || 0) / total * 100 : 0; });
    grafico('gReparto', {
      type: 'doughnut',
      data: { labels: window.Modelo.BLOQUES.map(function (b) { return b.nombre; }),
        datasets: [{ data: datos, backgroundColor: window.Modelo.BLOQUES.map(function (b) { return css(VAR_COLOR[b.id]); }), borderColor: '#fff', borderWidth: 2 }] },
      options: { cutout: '62%', plugins: { legend: { display: false }, tooltip: { callbacks: { label: function (c) { return c.label + ': ' + fmt1.format(c.raw) + ' puntos'; } } } } }
    });
    $('repartoLista').innerHTML = window.Modelo.BLOQUES.map(function (b, i) {
      var extra = b.id === 'resto' ? ' (' + R.lineasResto.length + ' líneas)' : '';
      return '<li><i class="' + CLASE[b.id] + '"></i><span>' + esc(b.nombre + extra) + '</span><b>' + fmt1.format(datos[i]) + '</b></li>';
    }).join('');
  }

  function pintarCumplBloques(R, lista) {
    $('cumplBloques').innerHTML = window.Modelo.BLOQUES.map(function (b) {
      var con = lista.filter(function (r) { return r.bloques[b.id].score != null; });
      if (!con.length) return '<li><div class="fila-cb"><span><i class="' + CLASE[b.id] + '"></i>' + esc(b.nombre) + '</span><span>sin metas</span></div></li>';
      var v = prom(con, function (r) { return r.bloques[b.id].score; });
      return '<li><div class="fila-cb"><span><i class="' + CLASE[b.id] + '"></i>' + esc(b.nombre) + '</span><span class="t-' + sem(v) + '">' + pct(v) + '</span></div>' +
        '<div class="barrita"><span class="' + sem(v) + '" data-w="' + Math.min(100, v * 100).toFixed(1) + '"></span></div></li>';
    }).join('');
    animarAnchos($('cumplBloques'));
  }

  /* ---------- Por bloque ---------- */
  function agrupar(lista, clave) {
    var grupos = {}, orden = [];
    lista.forEach(function (r) { var g = r.equipo || 'SIN GRUPO'; if (!grupos[g]) { grupos[g] = []; orden.push(g); } grupos[g].push(r); });
    orden.forEach(function (g) { grupos[g].sort(function (a, b) { return clave(b) - clave(a); }); });
    return { grupos: grupos, orden: orden };
  }
  function celdaAct(real, meta) {
    if (!(meta > 0)) return '<td class="bl">sin meta</td>';
    var c = real / meta, falta = Math.max(0, meta - real);
    return '<td class="bl"><span class="pill ' + sem(c) + '">' + pct(c) + '</span><small class="rotulo">' + fmt0.format(real) + ' de ' + fmt0.format(meta) + (falta > 0 ? ', falta ' + fmt0.format(falta) : '') + '</small></td>';
  }
  function celdaKg(real, meta) {
    if (!(meta > 0)) return '<td class="bl">sin meta</td>';
    var c = real / meta;
    return '<td class="bl"><span class="pill ' + sem(c) + '">' + pct(c) + '</span><small class="rotulo">' + fmt0.format(real) + ' de ' + fmt0.format(meta) + ' kg</small></td>';
  }
  function ind(r, b, id) { return r.bloques[b].indicadores.find(function (x) { return x.id === id; }); }
  function sumaInd(l, b, id) {
    var real = 0, meta = 0;
    l.forEach(function (r) { var i = ind(r, b, id); if (i) { real += i.real; meta += i.meta; } });
    return { real: real, meta: meta };
  }

  function pintarBloque(R, lista) {
    document.querySelectorAll('#selBloque .chip').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.b === S.bloque); });
    var b = S.bloque, nombre = window.Modelo.BLOQUES.find(function (x) { return x.id === b; }).nombre;
    var conBloque = lista.filter(function (r) { return r.bloques[b].score != null; });
    var orden = conBloque.slice().sort(function (x, y) { return y.bloques[b].score - x.bloques[b].score; });
    var labels = orden.map(function (r) { return corto(r.asesor); });
    var ds = [];
    if (b === 'resto') {
      ds.push({ label: 'Cumplimiento promedio de sus líneas', data: orden.map(function (r) { return r.bloques.resto.score * 100; }), backgroundColor: css('--azul'), borderRadius: 4 });
      $('t-gb').textContent = 'Otras líneas: cumplimiento contra el promedio propio';
      $('sub-gb').textContent = 'Venta del mes en cada línea asignada dividida entre el promedio ' + rangoMeses(R.base) + '. La línea punteada marca 100 %.';
    } else {
      ds.push({ label: 'Rolling en kilos', data: orden.map(function (r) { var i = ind(r, b, 'rolling'); return i ? Math.min(i.cumpl, 1.5) * 100 : null; }), backgroundColor: css('--azul'), borderRadius: 4 });
      ds.push({ label: 'Activación', data: orden.map(function (r) {
        var acts = r.bloques[b].indicadores.filter(function (i) { return i.id !== 'rolling'; });
        return acts.length ? Math.min(prom(acts, function (i) { return i.cumpl; }), 1.5) * 100 : null;
      }), backgroundColor: css('--rojo'), borderRadius: 4 });
      $('t-gb').textContent = nombre + ': Rolling en kilos y activación por asesor';
      $('sub-gb').textContent = 'Cumplimiento contra las metas del Rolling' + (b === 'nestle' ? '; la activación es el promedio de las subcategorías' : '') + '. La línea punteada marca 100 %.';
    }
    grafico('gBloque', {
      type: 'bar', data: { labels: labels, datasets: ds },
      options: { plugins: { lineaCien: { valor: 100 }, legend: { position: 'top', align: 'end' },
        tooltip: { callbacks: { label: function (c) { return c.dataset.label + ': ' + fmt0.format(c.raw) + ' %'; } } } },
        scales: { y: { beginAtZero: true, suggestedMax: 120, ticks: { callback: function (v) { return v + ' %'; } }, grid: { color: css('--g-linea') } }, x: { grid: { display: false } } } }
    });

    var ag = agrupar(conBloque, function (r) { return r.bloques[b].score; });
    var t = $('tablaBloque'), cab, filas = '', subs = cfgActual().subcategoriasClave;
    var fila, total;
    if (b === 'nestle') {
      $('t-tb').textContent = 'Nestlé por asesor y grupo';
      $('sub-tb').textContent = 'Cada celda muestra el cumplimiento y debajo activados de la meta, con lo que falta. En grupos y total la falta es la del equipo.';
      cab = '<tr><th>Asesor</th><th class="bl">Rolling kg</th>' + subs.map(function (s) { return '<th class="bl">' + esc(titulo(s)) + '</th>'; }).join('') + '<th class="bl">Otras marcas</th><th class="bl">Puntos</th></tr>';
      fila = function (l, etiqueta, clase) {
        var k = sumaInd(l, 'nestle', 'rolling');
        return '<tr class="' + (clase || '') + '"><td>' + etiqueta + '</td>' + celdaKg(k.real, k.meta) +
          subs.concat(['RESTO']).map(function (s) { var a = sumaInd(l, 'nestle', 'act-' + s); return celdaAct(a.real, a.meta); }).join('') +
          '<td class="bl">' + fmt1.format(prom(l, function (r) { return r.bloques.nestle.puntos; })) + (l.length > 1 ? '<small class="rotulo">promedio</small>' : '') + '</td></tr>';
      };
    } else if (b === 'resto') {
      $('t-tb').textContent = 'Otras líneas por asesor y grupo';
      $('sub-tb').textContent = 'Cada asesor se compara con su propio promedio en cada línea asignada; el bloque se reparte en partes iguales entre esas líneas.';
      cab = '<tr><th>Asesor</th><th class="bl">Líneas asignadas</th><th>Venta del mes</th><th>Promedio base</th><th class="bl">Cumplimiento</th><th>Líneas en verde</th><th>Líneas en rojo</th><th class="bl">Puntos</th></tr>';
      fila = function (l, etiqueta, clase) {
        var lin = [], v = 0, pr = 0;
        l.forEach(function (r) { r.bloques.resto.lineas.forEach(function (x) { lin.push(x); v += x.real; pr += x.promedio; }); });
        var sc = prom(l, function (r) { return r.bloques.resto.score; });
        return '<tr class="' + (clase || '') + '"><td>' + etiqueta + '</td><td class="bl">' + lin.length + '</td><td>' + usd(v) + '</td><td>' + usd(pr) + '</td>' +
          '<td class="bl"><span class="pill ' + sem(sc) + '">' + pct(sc) + '</span></td><td>' + lin.filter(function (x) { return x.cumpl >= 1; }).length + '</td><td>' + lin.filter(function (x) { return x.cumpl < 0.7; }).length + '</td>' +
          '<td class="bl">' + fmt1.format(prom(l, function (r) { return r.bloques.resto.puntos; })) + (l.length > 1 ? '<small class="rotulo">promedio</small>' : '') + '</td></tr>';
      };
    } else {
      $('t-tb').textContent = nombre + ' por asesor y grupo';
      $('sub-tb').textContent = 'Rolling en kilos y clientes activados contra las metas del Rolling. En grupos y total la falta es la del equipo.';
      cab = '<tr><th>Asesor</th><th class="bl">Rolling kg</th><th class="bl">Activación</th><th class="bl">Puntos</th></tr>';
      fila = function (l, etiqueta, clase) {
        var k = sumaInd(l, b, 'rolling'), a = sumaInd(l, b, 'activacion');
        return '<tr class="' + (clase || '') + '"><td>' + etiqueta + '</td>' + celdaKg(k.real, k.meta) + celdaAct(a.real, a.meta) +
          '<td class="bl">' + fmt1.format(prom(l, function (r) { return r.bloques[b].puntos; })) + (l.length > 1 ? '<small class="rotulo">promedio</small>' : '') + '</td></tr>';
      };
    }
    ag.orden.forEach(function (g) {
      filas += fila(ag.grupos[g], 'Grupo ' + esc(titulo(g)), 'grupo');
      ag.grupos[g].forEach(function (r) { filas += fila([r], esc(titulo(r.asesor))); });
    });
    total = conBloque.length ? fila(conBloque, 'Total', 'granTotal') : '';
    t.innerHTML = '<thead>' + cab + '</thead><tbody>' + (filas || '<tr><td colspan="9">Sin asesores con metas en este bloque.</td></tr>') + total + '</tbody>';
  }

  /* ---------- Grupos ---------- */
  function dona(valor, tam) {
    var r = (tam - 12) / 2, c = 2 * Math.PI * r, f = Math.max(0, Math.min(1, valor / 100));
    var color = css(f >= 1 ? '--verde-v' : (valor >= 70 ? '--ambar-v' : '--malo-v'));
    return '<svg class="dona" width="' + tam + '" height="' + tam + '" viewBox="0 0 ' + tam + ' ' + tam + '" role="img" aria-label="' + fmt1.format(valor) + ' puntos">' +
      '<circle class="pista" cx="' + tam / 2 + '" cy="' + tam / 2 + '" r="' + r + '" fill="none" stroke-width="10"/>' +
      '<circle class="arco" cx="' + tam / 2 + '" cy="' + tam / 2 + '" r="' + r + '" fill="none" stroke="' + color + '" stroke-width="10" stroke-linecap="round" stroke-dasharray="' + c.toFixed(1) + '" stroke-dashoffset="' + c.toFixed(1) + '" data-off="' + (c * (1 - f)).toFixed(1) + '" transform="rotate(-90 ' + tam / 2 + ' ' + tam / 2 + ')"/>' +
      '<text x="50%" y="50%" text-anchor="middle" dominant-baseline="central" font-size="' + Math.round(tam / 4.4) + '">' + fmt1.format(valor) + '</text></svg>';
  }
  function animarDonas(raiz) {
    var els = raiz.querySelectorAll('.arco[data-off]');
    requestAnimationFrame(function () { requestAnimationFrame(function () { els.forEach(function (e) { e.setAttribute('stroke-dashoffset', e.dataset.off); }); }); });
  }
  function pintarGrupos(R) {
    var cont = $('gruposTarjetas');
    var eqs = R.equipos.filter(function (e) { return S.grupo === 'TODOS' || e.supervisor === S.grupo; });
    if (!eqs.length) { cont.innerHTML = '<article class="tarjeta c12"><h2>Sin grupos</h2><p class="sub">El Rolling cargado no trae filas de subtotal por grupo.</p></article>'; return; }
    var html = '<article class="tarjeta c12"><h2>Puntos promedio por bloque y grupo</h2><p class="sub">Promedio de los asesores de cada grupo, según los subtotales del archivo de Rolling.</p><div class="grafico bajo"><canvas id="gGrupos" role="img" aria-label="Puntos promedio por bloque y grupo"></canvas></div></article>';
    html += eqs.map(function (e) {
      var miembros = R.ranking.filter(function (r) { return r.equipo === e.supervisor; });
      return '<article class="tarjeta c6"><div class="sup-cab">' + dona(e.promedio, 96) + '<div><p class="nom">' + esc(titulo(e.supervisor)) + '</p>' +
        '<p class="cifra">' + miembros.length + ' asesores. Venta ' + usd(e.venta) + '.<br>Puntaje promedio del grupo en ' + mesMin(R.periodo) + '.</p></div></div>' +
        '<ul class="equipo">' + miembros.map(function (r) {
          return '<li' + (r.total < 70 ? ' class="bajo"' : '') + '><button type="button" data-a="' + esc(r.asesor) + '"><i class="punto" style="background:' + css(r.total >= 100 ? '--verde-v' : (r.total >= 70 ? '--ambar-v' : '--malo-v')) + '"></i>' +
            '<span class="quien">' + esc(titulo(r.asesor)) + '</span><span class="par">puesto ' + r.posicion + '</span><span class="pill ' + sem(r.total / 100) + '">' + fmt1.format(r.total) + '</span></button></li>';
        }).join('') + '</ul></article>';
    }).join('');
    cont.innerHTML = html;
    animarDonas(cont);
    grafico('gGrupos', {
      type: 'bar',
      data: { labels: eqs.map(function (e) { return titulo(e.supervisor); }),
        datasets: window.Modelo.BLOQUES.map(function (b) {
          return { label: b.nombre, backgroundColor: css(VAR_COLOR[b.id]), data: eqs.map(function (e) {
            var m = R.ranking.filter(function (r) { return r.equipo === e.supervisor; });
            return prom(m, function (r) { return r.bloques[b.id].puntos; });
          }) };
        }) },
      options: { indexAxis: 'y', plugins: { lineaCien: { valor: 100, horizontal: true }, legend: { position: 'top', align: 'end' },
        tooltip: { callbacks: { label: function (c) { return c.dataset.label + ': ' + fmt1.format(c.raw) + ' puntos'; } } } },
        scales: { x: { stacked: true, max: R.config.tope, grid: { color: css('--g-linea') } }, y: { stacked: true, grid: { display: false } } } }
    });
  }

  /* ---------- Control especial ---------- */
  function ventasMensuales(asesor) {
    var h = S.datos.historico, n = window.Modelo.norm(asesor), iA = h.asesores.map(window.Modelo.norm).indexOf(n), out = h.periodos.map(function () { return 0; });
    if (iA < 0) return out;
    h.ventas.forEach(function (v) { if (v[1] === iA) out[v[0]] += v[3]; });
    return out;
  }
  function pintarControl(R) {
    var cont = $('controlTarjetas');
    if (!R.control.length) { cont.innerHTML = '<article class="tarjeta c12"><h2>Sin casos especiales</h2><p class="sub">Se agregan en Modelo y pesos del panel administrativo.</p></article>'; return; }
    cont.innerHTML = R.control.map(function (c, k) {
      if (!c.presente) return '<article class="tarjeta especial c12"><h2>' + esc(titulo(c.asesor)) + '</h2><p class="sub">Sin ventas en ' + mesMin(R.periodo) + ' ni en los meses base. Revisa que el nombre coincida con la columna ASESOR ACTUAL del histórico.</p></article>';
      var varc = c.promedio > 0 ? c.venta / c.promedio : null, part = R.ventaEmpresa > 0 ? c.venta / R.ventaEmpresa : 0;
      var filas = c.porUnidad.slice(0, 10).map(function (u) {
        var cu = u.promedio > 0 ? u.venta / u.promedio : null;
        return '<tr><td>' + esc(titulo(u.unidad)) + '</td><td>' + usd(u.venta) + '</td><td>' + usd(u.promedio) + '</td><td>' + (cu == null ? '<span class="pill ok">nueva</span>' : '<span class="pill ' + sem(cu) + '">' + pct(cu) + '</span>') + '</td><td>' + fmt0.format(u.kg) + '</td><td>' + fmt0.format(u.activaciones) + '</td></tr>';
      }).join('');
      return '<article class="tarjeta especial c12"><h2>' + esc(titulo(c.asesor)) + '<span class="etiqueta">fuera del ranking</span></h2>' +
        '<p class="sub">Condiciones comerciales especiales. Se audita aquí y no ocupa posición.</p>' +
        '<div class="cifras"><div><b>' + usd(c.venta) + '</b><span>Venta de ' + mesMin(R.periodo) + '</span></div><div><b>' + usd(c.promedio) + '</b><span>Promedio mensual ' + rangoMeses(R.base) + '</span></div>' +
        '<div><b class="t-' + sem(varc) + '">' + (varc == null ? 'sin base' : pct(varc)) + '</b><span>Mes contra promedio</span></div><div><b>' + fmt1.format(part * 100) + ' %</b><span>De la venta de la empresa</span></div></div>' +
        '<div class="rej"><div class="c5"><h2>Venta mensual</h2><p class="sub">Todos los meses del histórico.</p><div class="grafico linea"><canvas id="gEsp' + k + '" role="img" aria-label="Venta mensual de ' + esc(titulo(c.asesor)) + '"></canvas></div></div>' +
        '<div class="c7"><h2>Por unidad de negocio</h2><p class="sub">Las diez con más venta en el mes.</p><div class="tw"><table><thead><tr><th>Unidad</th><th>Venta mes</th><th>Promedio</th><th>Cumplimiento</th><th>Kg</th><th>Clientes</th></tr></thead><tbody>' + filas + '</tbody></table></div>' +
        (c.porUnidad.length > 10 ? '<p class="nota">Y ' + (c.porUnidad.length - 10) + ' unidades más con venta menor.</p>' : '') + '</div></div></article>';
    }).join('');
    R.control.forEach(function (c, k) {
      if (!c.presente) return;
      var serie = ventasMensuales(c.asesor), per = periodos();
      grafico('gEsp' + k, {
        type: 'line',
        data: { labels: per.map(function (p) { return MESES[(p % 100) - 1].slice(0, 3); }),
          datasets: [{ label: 'Venta', data: serie, borderColor: css('--azul'), backgroundColor: 'rgba(31,79,209,.12)', fill: true, tension: .3,
            pointBackgroundColor: per.map(function (p) { return p === R.periodo ? css('--rojo') : css('--azul'); }), pointRadius: per.map(function (p) { return p === R.periodo ? 6 : 3; }) }] },
        options: { plugins: { legend: { display: false }, tooltip: { callbacks: { label: function (x) { return usd(x.raw); } } } },
          scales: { y: { ticks: { callback: function (v) { return fmt0.format(v / 1000) + ' mil'; } }, grid: { color: css('--g-linea') } }, x: { grid: { display: false } } } }
      });
    });
  }

  /* ---------- Detalle del asesor ---------- */
  function abrirDetalle(asesor) {
    var R = calc(S.mes), r = R && R.ranking.find(function (x) { return x.asesor === asesor; });
    if (!r) return;
    $('dlgTitulo').textContent = r.posicion + '. ' + titulo(r.asesor);
    var mv = '';
    if (r.posAnterior) { var d = r.posAnterior - r.posicion; mv = d > 0 ? 'Subió ' + d + ' desde el puesto ' + r.posAnterior + '.' : (d < 0 ? 'Bajó ' + (-d) + ' desde el puesto ' + r.posAnterior + '.' : 'Mantiene el puesto.'); }
    var html = '<div class="det-cab">' + dona(r.total, 104) + '<div><p class="grande">Puesto ' + r.posicion + '<small>de ' + R.ranking.length + '</small></p>' +
      '<p>' + fmt1.format(r.total) + ' puntos en ' + mesMin(R.periodo) + (r.equipo ? ', grupo ' + esc(titulo(r.equipo)) : '') + '. ' + mv + '<br>Venta del mes ' + usd(r.ventaTotal) + '.</p></div></div>';
    html += '<section class="det-bloque"><h4>Evolución del puntaje<small>con las metas del Rolling cargado</small></h4><div class="grafico linea"><canvas id="gDet" role="img" aria-label="Puntaje por mes"></canvas></div></section>';
    window.Modelo.BLOQUES.forEach(function (b) {
      var bl = r.bloques[b.id];
      html += '<section class="det-bloque"><h4><span><i class="punto ' + CLASE[b.id] + '"></i>' + esc(b.nombre) + '</span><small>' +
        (bl.score == null ? 'no aplica' : fmt1.format(bl.puntos) + ' de ' + fmt1.format(bl.pesoAplicado) + ' puntos, ' + pct(bl.score)) + '</small></h4>';
      if (b.id === 'resto') {
        html += !bl.lineas.length ? '<p class="nota">Sin líneas asignadas en los meses base.</p>' :
          '<div class="tw"><table><thead><tr><th>Línea</th><th>Promedio</th><th>Venta del mes</th><th>Cumplimiento</th></tr></thead><tbody>' +
          bl.lineas.map(function (l) { return '<tr><td>' + esc(titulo(l.unidad)) + '</td><td>' + usd(l.promedio) + '</td><td>' + usd(l.real) + '</td><td><span class="pill ' + sem(l.cumpl) + '">' + pct(l.cumpl) + '</span></td></tr>'; }).join('') +
          '</tbody></table></div><p class="nota">' + bl.lineas.length + ' líneas, cada una vale ' + fmt1.format(bl.pesoAplicado / bl.lineas.length) + ' puntos.</p>';
      } else if (!bl.indicadores.length) {
        html += '<p class="nota">El Rolling no trae metas de este bloque para el asesor.</p>';
      } else {
        html += '<div class="tw"><table><thead><tr><th>Indicador</th><th>Meta</th><th>Real</th><th>Falta</th><th>Cumplimiento</th><th>Peso interno</th></tr></thead><tbody>' +
          bl.indicadores.map(function (x) {
            var kg = x.id === 'rolling', u = kg ? ' kg' : '';
            return '<tr><td>' + esc(x.nombre) + '</td><td>' + fmt0.format(x.meta) + u + '</td><td>' + fmt0.format(x.real) + u + '</td><td>' + fmt0.format(Math.max(0, x.meta - x.real)) + u + '</td><td><span class="pill ' + sem(x.cumpl) + '">' + pct(x.cumpl) + '</span></td><td>' + fmt1.format(x.peso) + '</td></tr>';
          }).join('') + '</tbody></table></div>';
        if (b.id === 'nestle') html += '<p class="nota">Rolling ' + fmt0.format(bl.pesoRolling) + ' % y activación ' + fmt0.format(bl.pesoActivacion) + ' % del bloque. Cartera Nestlé: ' + fmt0.format(bl.cartera) + ' clientes.</p>';
      }
      html += '</section>';
    });
    $('dlgCuerpo').innerHTML = html;
    var d = $('dlgDetalle');
    if (typeof d.showModal === 'function') d.showModal(); else d.setAttribute('open', '');
    animarDonas($('dlgCuerpo'));
    var per = periodos(), serie = per.map(function (p) { var x = calc(p); var y = x && x.ranking.find(function (z) { return z.asesor === asesor; }); return y ? +y.total.toFixed(1) : null; });
    grafico('gDet', {
      type: 'line',
      data: { labels: per.map(function (p) { return MESES[(p % 100) - 1].slice(0, 3); }),
        datasets: [{ label: 'Puntaje', data: serie, borderColor: css('--azul'), backgroundColor: 'rgba(31,79,209,.12)', fill: true, tension: .3, spanGaps: true,
          pointBackgroundColor: per.map(function (p) { return p === R.periodo ? css('--rojo') : css('--azul'); }), pointRadius: per.map(function (p) { return p === R.periodo ? 6 : 3; }) }] },
      options: { plugins: { lineaCien: { valor: 100 }, legend: { display: false }, tooltip: { callbacks: { label: function (x) { return fmt1.format(x.raw) + ' puntos'; } } } },
        scales: { y: { beginAtZero: true, suggestedMax: 110, grid: { color: css('--g-linea') } }, x: { grid: { display: false } } } }
    });
  }

  /* ---------- exportar ---------- */
  function descargarCsv() {
    var R = calc(S.mes); if (!R) return;
    var n2 = function (x) { return (Math.round(x * 100) / 100).toString().replace('.', ','); };
    var cab = ['Posicion', 'Movimiento', 'Asesor', 'Grupo', 'Puntaje total', 'Puntos Nestle', 'Puntos PepsiCo', 'Puntos San Domingo', 'Puntos otras lineas',
      'Cumplimiento Nestle %', 'Cumplimiento PepsiCo %', 'Cumplimiento San Domingo %', 'Cumplimiento otras lineas %', 'Venta USD'];
    var filas = S.visible.map(function (r) {
      var b = r.bloques, c = function (x) { return x.score == null ? '' : n2(x.score * 100); };
      return [r.posicion, r.posAnterior ? r.posAnterior - r.posicion : '', r.asesor, r.equipo, n2(r.total), n2(b.nestle.puntos), n2(b.pepsico.puntos), n2(b.sanDomingo.puntos), n2(b.resto.puntos),
        c(b.nestle), c(b.pepsico), c(b.sanDomingo), c(b.resto), n2(r.ventaTotal)];
    });
    var csv = '\ufeff' + [cab].concat(filas).map(function (f) { return f.map(function (v) { v = String(v); return /[;"\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(';'); }).join('\r\n');
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = 'ranking-' + R.periodo + '.csv';
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    aviso('CSV descargado: ' + a.download + '.');
  }

  /* ================= MODELO ================= */
  function pintarModelo() {
    var cfg = cfgActual(), f = $('formModelo'), R = null;
    if (S.datos.historico) { try { var per = periodos(); R = calc(S.mes || per[per.length - 1]); } catch (e) { R = null; } }
    estado($('mdEstado'), S.datos.historico ? '' : '<h2>Sin histórico cargado</h2><p>Los pesos automáticos salen del histórico de ventas. Puedes ajustar las reglas ahora y se aplicarán al cargarlo.</p><div class="acciones"><a class="btn btn-primario" href="#historico">Cargar histórico de ventas</a></div>');
    f.querySelectorAll('input[name="pesoModo"]').forEach(function (x) { x.checked = x.value === cfg.pesoModo; });
    ['nestle.rolling', 'nestle.activacion', 'nestle.metaRestoPct', 'pepsico.rolling', 'pepsico.activacion', 'sanDomingo.rolling', 'sanDomingo.activacion',
      'resto.minMeses', 'resto.minPromedioUsd', 'tope'].forEach(function (k) {
      var p = k.split('.'); f.elements[k].value = p.length === 2 ? cfg[p[0]][p[1]] : cfg[k];
    });
    f.elements.casosEspeciales.value = cfg.casosEspeciales.join('\n');
    f.elements.noVendedores.value = cfg.noVendedores.join('\n');
    f.elements.excluirEspecialesDeLaBase.checked = !!cfg.excluirEspecialesDeLaBase;
    $('camposSub').innerHTML = cfg.subcategoriasClave.concat(['RESTO']).map(function (s) {
      var et = s === 'RESTO' ? 'Otras marcas Nestlé' : titulo(s), id = 'sub-' + s.toLowerCase();
      return '<div class="campo"><label for="' + id + '">' + esc(et) + ' (%)</label><input id="' + id + '" type="number" min="0" max="100" step="0.25" name="sub.' + esc(s) + '" value="' + (cfg.nestle.sub[s] != null ? cfg.nestle.sub[s] : 0) + '"></div>';
    }).join('');
    var auto = R ? R.pesosAuto : null;
    $('tablaPesos').innerHTML = '<thead><tr><th>Bloque</th><th>Automático</th><th>Manual (%)</th></tr></thead><tbody>' +
      window.Modelo.BLOQUES.map(function (b) {
        return '<tr><td><i class="punto ' + CLASE[b.id] + '"></i>' + esc(b.nombre) + '</td><td>' + (auto ? fmt1.format(auto[b.id]) + ' %' : 'sin histórico') + '</td>' +
          '<td><label class="sr" for="pm-' + b.id + '">Peso manual de ' + esc(b.nombre) + '</label><input id="pm-' + b.id + '" type="number" min="0" max="100" step="0.5" name="pm.' + b.id + '" value="' + fmt1.format(cfg.pesosManuales[b.id]).replace(',', '.') + '"></td></tr>';
      }).join('') + '</tbody>';
    actualizarSumaManual();
    var tu = $('tablaUnidades');
    if (!R) { tu.innerHTML = ''; $('notaUnidades').textContent = 'Aparece al cargar el histórico.'; return; }
    var UN = {}; UN[window.Modelo.norm(cfg.unidades.nestle)] = 'Nestlé'; UN[window.Modelo.norm(cfg.unidades.pepsico)] = 'PepsiCo'; UN[window.Modelo.norm(cfg.unidades.sanDomingo)] = 'Café San Domingo';
    var unidades = Object.keys(R.promedioPorUnidad).filter(function (u) { return R.promedioPorUnidad[u] > 0; }).sort(function (a, b) { return R.promedioPorUnidad[b] - R.promedioPorUnidad[a]; });
    var suma = unidades.reduce(function (t, u) { return t + R.promedioPorUnidad[u]; }, 0);
    $('notaUnidades').textContent = 'Promedio de facturación ' + rangoMeses(R.base) + ', dividido entre los meses en que la unidad vendió' + (cfg.excluirEspecialesDeLaBase ? ', sin la venta de los casos especiales.' : '.') + ' ' + R.lineasResto.length + ' unidades forman el bloque de otras líneas.';
    tu.innerHTML = '<thead><tr><th>Unidad de negocio</th><th class="izq">Bloque</th><th>Promedio mensual</th><th>Meses con venta</th><th>Participación</th></tr></thead><tbody>' +
      unidades.map(function (u) { var p = R.promedioPorUnidad[u]; return '<tr><td>' + esc(titulo(u)) + '</td><td class="izq">' + (UN[u] || 'Otras líneas') + '</td><td>' + usd(p) + '</td><td>' + R.mesesPorUnidad[u] + '</td><td>' + fmt1.format(p / suma * 100) + ' %</td></tr>'; }).join('') + '</tbody>';
  }
  function actualizarSumaManual() {
    var f = $('formModelo'), s = 0, m = f.querySelector('input[name="pesoModo"]:checked');
    var manual = m && m.value === 'manual';
    window.Modelo.BLOQUES.forEach(function (b) { var el = f.elements['pm.' + b.id]; el.disabled = !manual; s += parseFloat(el.value) || 0; });
    $('sumaManual').textContent = manual ? 'Los pesos manuales suman ' + fmt1.format(s) + ' %.' + (Math.abs(s - 100) > 0.05 ? ' Se ajustan en proporción para completar 100 puntos.' : '') : 'Para editar los pesos elige Manual.';
  }
  function leerFormModelo() {
    var f = $('formModelo'), c = cfgActual();
    var num = function (n, min, max) {
      var el = f.elements[n], v = parseFloat(el.value);
      if (!isFinite(v) || v < min || (max != null && v > max)) {
        var lb = (el.labels && el.labels[0]); el.focus();
        throw new Error('Revisa "' + (lb ? lb.textContent.trim() : n) + '": debe ser un número entre ' + min + (max != null ? ' y ' + max : ' o mayor') + '.');
      }
      return v;
    };
    var modo = f.querySelector('input[name="pesoModo"]:checked'); c.pesoModo = modo ? modo.value : 'automatico';
    window.Modelo.BLOQUES.forEach(function (b) { c.pesosManuales[b.id] = num('pm.' + b.id, 0, 100); });
    if (c.pesoModo === 'manual') {
      var s = 0; window.Modelo.BLOQUES.forEach(function (b) { s += c.pesosManuales[b.id]; });
      if (s <= 0) throw new Error('Con pesos manuales, al menos un bloque debe tener peso mayor que cero.');
      window.Modelo.BLOQUES.forEach(function (b) { c.pesosManuales[b.id] = c.pesosManuales[b.id] / s * 100; });
    }
    c.nestle.rolling = num('nestle.rolling', 0, 100); c.nestle.activacion = num('nestle.activacion', 0, 100); c.nestle.metaRestoPct = num('nestle.metaRestoPct', 0, 100);
    c.subcategoriasClave.concat(['RESTO']).forEach(function (s) { c.nestle.sub[s] = num('sub.' + s, 0, 100); });
    c.pepsico.rolling = num('pepsico.rolling', 0, 100); c.pepsico.activacion = num('pepsico.activacion', 0, 100);
    c.sanDomingo.rolling = num('sanDomingo.rolling', 0, 100); c.sanDomingo.activacion = num('sanDomingo.activacion', 0, 100);
    c.resto.minMeses = Math.round(num('resto.minMeses', 1, 12)); c.resto.minPromedioUsd = num('resto.minPromedioUsd', 0);
    c.tope = num('tope', 100, 200);
    var lista = function (n) { return f.elements[n].value.split(/\n|,/).map(function (x) { return window.Modelo.norm(x); }).filter(Boolean); };
    c.casosEspeciales = lista('casosEspeciales'); c.noVendedores = lista('noVendedores');
    c.excluirEspecialesDeLaBase = f.elements.excluirEspecialesDeLaBase.checked;
    return c;
  }

  /* ================= HISTÓRICO ================= */
  function procesarHistorico(file) {
    var est = $('histEstado');
    if (!file) return;
    if (!/\.xlsx$/i.test(file.name)) { estado(est, '<h2>Formato no válido</h2><p>"' + esc(file.name) + '" no es un .xlsx. Guarda el histórico como libro de Excel (.xlsx) y vuelve a intentarlo.</p>', 'error'); return; }
    estado(est, ''); $('histResumen').innerHTML = ''; $('progHist').hidden = false;
    progreso({ stage: 'Abriendo ' + file.name, pct: 0 });
    var cfg = cfgActual(), opciones = { nestleUnit: cfg.unidades.nestle, keySubs: cfg.subcategoriasClave };
    var listo = function (res) {
      $('progHist').hidden = true;
      S.datos.historico = res; S.mes = res.periodos[res.periodos.length - 1]; S.origen = 'este navegador'; S.anchos = {};
      cambiosGuardados('Histórico ' + res.fuente.archivo);
      pintarResumenHist();
      estado(est, '<h2>Histórico procesado</h2><p>' + fmt0.format(res.fuente.filas) + ' filas leídas de la hoja ' + esc(res.fuente.hoja) + '.</p><div class="acciones"><a class="btn btn-primario" href="#ranking">Ver ranking</a>' +
        (S.datos.rolling ? '' : '<a class="btn btn-borde" href="#rolling">Cargar Rolling y activaciones</a>') + '</div>', 'ok');
    };
    var falla = function (msg) {
      $('progHist').hidden = true;
      estado(est, '<h2>No se pudo procesar el histórico</h2><p>' + esc(msg) + '</p><p class="nota">Revisa que el archivo tenga la hoja DINAMICA con las columnas ASESOR ACTUAL, UNIDAD NEGOCIO, SUBLINEA, mes, RIF REAL, total_venta_dolar y PESO REAL.</p>', 'error');
    };
    var w = null;
    try { w = new Worker('historico-worker.js'); } catch (e) { w = null; }
    function enHiloPrincipal() {
      progreso({ stage: 'Procesando en la página (puede congelarse unos segundos)', pct: 2 });
      window.HistoricoCore.parseHistorico(file, Object.assign({ fileName: file.name, onProgress: progreso }, opciones)).then(listo, function (e) { falla(e.message); });
    }
    if (!w) { enHiloPrincipal(); return; }
    var fallo = false;
    w.onmessage = function (e) {
      var d = e.data;
      if (d.type === 'progress') progreso(d.progress);
      else if (d.type === 'done') { w.terminate(); listo(d.result); }
      else if (d.type === 'error') { w.terminate(); falla(d.message); }
    };
    w.onerror = function (ev) { ev.preventDefault(); w.terminate(); if (!fallo) { fallo = true; enHiloPrincipal(); } };
    w.postMessage(Object.assign({ file: file }, opciones));
  }
  function progreso(p) {
    $('progHistBarra').style.width = (p.pct || 0) + '%';
    $('progHistTxt').textContent = p.stage + (p.rows ? ': ' + fmt0.format(p.rows) + ' filas' : '') + ' (' + (p.pct || 0) + ' %)';
  }
  function pintarResumenHist() {
    var h = S.datos.historico, box = $('histResumen');
    if (!h) { box.innerHTML = ''; return; }
    var porMes = {}; h.periodos.forEach(function (p) { porMes[p] = { usd: 0, kgN: 0, asesores: new Set() }; });
    var iN = h.unidades.indexOf(window.Modelo.norm(cfgActual().unidades.nestle));
    h.ventas.forEach(function (r) { var m = porMes[h.periodos[r[0]]]; m.usd += r[3]; if (r[2] === iN) m.kgN += r[4]; if (r[3] > 0) m.asesores.add(r[1]); });
    box.innerHTML = '<article class="tarjeta"><h2>Datos cargados</h2><p class="sub">Resumen del histórico guardado.</p><dl class="datos-carga">' +
      '<div><dt>Archivo</dt><dd>' + esc(h.fuente.archivo || 'sin nombre') + '</dd></div><div><dt>Procesado</dt><dd>' + esc(fecha(h.fuente.procesado)) + '</dd></div>' +
      '<div><dt>Filas de venta</dt><dd>' + fmt0.format(h.fuente.filas) + '</dd></div><div><dt>Meses</dt><dd>' + esc(rangoMeses(h.periodos)) + '</dd></div>' +
      '<div><dt>Asesores</dt><dd>' + h.asesores.length + '</dd></div><div><dt>Unidades de negocio</dt><dd>' + h.unidades.length + '</dd></div></dl>' +
      '<div class="tw"><table><thead><tr><th>Mes</th><th>Venta neta</th><th>Kilos Nestlé</th><th>Asesores con venta</th></tr></thead><tbody>' +
      h.periodos.slice().reverse().map(function (p) { var m = porMes[p]; return '<tr><td>' + nombreMes(p) + '</td><td>' + usd(m.usd) + '</td><td>' + fmt0.format(m.kgN) + '</td><td>' + m.asesores.size + '</td></tr>'; }).join('') +
      '</tbody></table></div></article>';
  }

  /* ================= ROLLING ================= */
  function procesarRolling(file) {
    var est = $('rollEstado');
    if (!file) return;
    if (!/\.xlsx?$/i.test(file.name)) { estado(est, '<h2>Formato no válido</h2><p>"' + esc(file.name) + '" no es un archivo de Excel.</p>', 'error'); return; }
    if (!window.XLSX) { estado(est, '<h2>No cargó el lector de Excel</h2><p>La librería SheetJS no se pudo descargar. Revisa la conexión a internet y recarga la página.</p>', 'error'); return; }
    estado(est, '<p class="cargando">Leyendo ' + esc(file.name) + '</p>');
    file.arrayBuffer().then(function (buf) {
      var wb = window.XLSX.read(buf, { type: 'array' });
      var hojas = wb.SheetNames.map(function (n) { return { name: n, rows: window.XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: null }) }; });
      var res = window.RollingParser.parseRolling(hojas, { fileName: file.name, subcategoriasClave: cfgActual().subcategoriasClave });
      S.datos.rolling = res; S.origen = 'este navegador';
      cambiosGuardados('Rolling ' + file.name);
      pintarResumenRolling();
      estado(est, '<h2>Rolling cargado</h2><p>' + Object.keys(res.vendedores).length + ' asesores con metas y ' + Object.keys(res.supervisores).length + ' grupos detectados.</p><div class="acciones"><a class="btn btn-primario" href="#ranking">Ver ranking</a>' +
        (S.datos.historico ? '' : '<a class="btn btn-borde" href="#historico">Cargar histórico de ventas</a>') + '</div>', 'ok');
    }).catch(function (e) { estado(est, '<h2>No se pudo leer el Rolling</h2><p>' + esc(e.message) + '</p>', 'error'); });
  }
  function pintarResumenRolling() {
    var r = S.datos.rolling, box = $('rollResumen');
    if (!r) { box.innerHTML = ''; return; }
    var subs = cfgActual().subcategoriasClave, noms = Object.keys(r.vendedores).sort();
    var porc = Object.keys(r.porcentajesNestle).map(function (s) { return titulo(s) + ' ' + fmt0.format(r.porcentajesNestle[s] * 100) + ' %'; }).join(', ');
    var v = function (x, d) { return x == null ? '' : (d ? fmt1.format(x) : fmt0.format(x)); };
    box.innerHTML = '<article class="tarjeta"><h2>Metas cargadas</h2><p class="sub">Resumen del Rolling guardado.</p><dl class="datos-carga">' +
      '<div><dt>Archivo</dt><dd>' + esc(r.fuente.archivo || 'sin nombre') + '</dd></div><div><dt>Procesado</dt><dd>' + esc(fecha(r.fuente.procesado)) + '</dd></div>' +
      '<div><dt>Asesores con metas</dt><dd>' + noms.length + '</dd></div><div><dt>Grupos (subtotales)</dt><dd>' + (Object.keys(r.supervisores).map(titulo).join(', ') || 'ninguno') + '</dd></div>' +
      (porc ? '<div><dt>Meta de activación Nestlé</dt><dd>' + esc(porc) + '</dd></div>' : '') + '</dl>' +
      (r.avisos && r.avisos.length ? '<p class="nota">' + r.avisos.map(esc).join(' ') + '</p>' : '') +
      '<div class="tw"><table><thead><tr><th>Asesor</th><th>Cartera Nestlé</th>' + subs.map(function (s) { return '<th>' + esc(titulo(s)) + '</th>'; }).join('') +
      '<th>Rolling Nestlé kg</th><th>Activación PepsiCo</th><th>Rolling PepsiCo kg</th><th>Activación San Domingo</th><th>Rolling San Domingo kg</th></tr></thead><tbody>' +
      noms.map(function (n) {
        var x = r.vendedores[n], ne = x.nestle || {}, pe = x.pepsico || {}, sd = x.sanDomingo || {};
        return '<tr><td>' + esc(titulo(n)) + '</td><td>' + v(ne.cartera) + '</td>' + subs.map(function (s) { return '<td>' + v(ne.subcategorias ? ne.subcategorias[s] : null, true) + '</td>'; }).join('') +
          '<td>' + v(ne.rolling) + '</td><td>' + v(pe.activacion) + '</td><td>' + v(pe.rolling) + '</td><td>' + v(sd.activacion) + '</td><td>' + v(sd.rolling) + '</td></tr>';
      }).join('') + '</tbody></table></div></article>';
  }

  /* ================= GITHUB ================= */
  function registrar(msg, error) {
    var li = document.createElement('li'); if (error) li.className = 'error';
    li.innerHTML = '<time>' + new Date().toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' }) + '</time>' + esc(msg);
    var ol = $('ghLog'); ol.insertBefore(li, ol.firstChild);
  }
  function pintarGitHub() {
    var c = ghCfg(), f = $('formGh');
    ['owner', 'repo', 'branch', 'path', 'token'].forEach(function (k) { f.elements[k].value = c[k] || ''; });
    if (!c.path) f.elements.path.value = 'ranking-data.json';
    if (!c.branch) f.elements.branch.value = 'main';
    f.elements.auto.checked = !!c.auto;
  }
  function leerFormGh() {
    var f = $('formGh');
    return { owner: f.elements.owner.value.trim(), repo: f.elements.repo.value.trim(), branch: f.elements.branch.value.trim() || 'main',
      path: f.elements.path.value.trim() || 'ranking-data.json', token: f.elements.token.value.trim(), auto: f.elements.auto.checked };
  }
  function botonesGh(on) { ['btnProbar', 'btnPublicar', 'btnTraer'].forEach(function (id) { $(id).disabled = !on; }); }
  var publicando = null;
  function publicarGitHub(motivo) {
    var c = ghCfg();
    if (!ghListo(c)) { estado($('ghEstado'), '<h2>Falta configurar la conexión</h2><p>Completa usuario, repositorio y token, y guarda.</p>', 'error'); return Promise.resolve(); }
    if (!S.datos.historico && !S.datos.rolling) { estado($('ghEstado'), '<h2>No hay datos para publicar</h2><p>Carga primero el histórico o el Rolling.</p>', 'error'); return Promise.resolve(); }
    if (publicando) return publicando;
    estado($('ghEstado'), '<p class="cargando">Publicando ' + esc(c.path) + ' en ' + esc(c.owner + '/' + c.repo) + '</p>');
    botonesGh(false);
    publicando = window.GitHubSync.publicar(c, S.datos, 'Ranking comercial: ' + (motivo || 'actualización de datos')).then(function (r) {
      estado($('ghEstado'), '<h2>Datos publicados</h2><p>' + esc(c.path) + ' (' + fmt0.format(r.bytes / 1024) + ' KB) quedó en ' + esc(c.owner + '/' + c.repo) + '. GitHub Pages puede tardar unos minutos en mostrar el cambio.</p>', 'ok');
      registrar('Publicado: ' + (motivo || 'datos del ranking') + '.');
      aviso('Datos publicados en GitHub para todo el equipo.');
    }).catch(function (e) {
      estado($('ghEstado'), '<h2>No se pudo publicar</h2><p>' + esc(e.message) + '</p>', 'error');
      registrar('Error al publicar: ' + e.message, true);
      aviso('No se pudo publicar en GitHub.', 'error');
    }).finally(function () { publicando = null; botonesGh(true); });
    return publicando;
  }

  /* ================= INICIO ================= */
  function aplicarDatos(d, origen) {
    S.datos = { version: 1, actualizado: d.actualizado || null, historico: d.historico || null, rolling: d.rolling || null, config: d.config || {} };
    S.origen = origen; S.mes = null; S.cache.clear(); S.anchos = {};
  }
  function cargarInicial() {
    var local = leerLocal();
    if (local) aplicarDatos(local, 'este navegador');
    return fetch('ranking-data.json', { cache: 'no-store' }).then(function (res) { return res.ok ? res.json() : null; }).then(function (pub) {
      if (pub && pub.version && (pub.historico || pub.rolling)) {
        var nuevo = !local || !local.actualizado || (pub.actualizado && pub.actualizado > local.actualizado);
        if (nuevo) { aplicarDatos(pub, 'el archivo publicado del sitio'); guardarLocal(); }
      }
    }).catch(function () { /* sin archivo publicado: se usa lo local */ });
  }
  function arrastrar(zona, input, fn) {
    ['dragenter', 'dragover'].forEach(function (ev) { zona.addEventListener(ev, function (e) { e.preventDefault(); zona.classList.add('sobre'); }); });
    ['dragleave', 'drop'].forEach(function (ev) { zona.addEventListener(ev, function (e) { e.preventDefault(); zona.classList.remove('sobre'); }); });
    zona.addEventListener('drop', function (e) { var f = e.dataTransfer.files && e.dataTransfer.files[0]; if (f) fn(f); });
    input.addEventListener('change', function () { fn(input.files[0]); input.value = ''; });
  }

  function iniciar() {
    prepararChart();
    window.addEventListener('hashchange', irA);
    $('selMes').addEventListener('change', function () { S.mes = +this.value; pintarTablero(); });
    $('selBase').addEventListener('change', function () {
      S.datos.config = Object.assign({}, S.datos.config, { mesesBase: +this.value });
      cambiosGuardados('meses base del promedio'); pintarTablero();
    });
    $('selGrupo').addEventListener('change', function () { S.grupo = this.value; pintarTablero(); });
    $('selOrden').addEventListener('change', function () { S.orden = this.value; pintarTablero(); });
    $('selBloque').addEventListener('click', function (e) { var b = e.target.closest('.chip'); if (b) { S.bloque = b.dataset.b; pintarTablero(); } });
    document.addEventListener('click', function (e) {
      var b = e.target.closest('#listaRanking .fila-btn, .equipo button');
      if (b) abrirDetalle(b.dataset.a);
    });
    $('dlgCerrar').addEventListener('click', function () { $('dlgDetalle').close(); });
    $('dlgDetalle').addEventListener('click', function (e) { if (e.target === this) this.close(); });
    $('btnCsv').addEventListener('click', descargarCsv);
    $('btnImprimir').addEventListener('click', function () { window.print(); });

    var fm = $('formModelo');
    fm.addEventListener('input', function (e) { if (/^pm\./.test(e.target.name)) actualizarSumaManual(); });
    fm.addEventListener('change', function (e) { if (e.target.name === 'pesoModo') actualizarSumaManual(); });
    fm.addEventListener('submit', function (e) {
      e.preventDefault();
      try { S.datos.config = leerFormModelo(); cambiosGuardados('cambio de pesos del modelo'); pintarModelo(); $('mdMsg').textContent = 'Modelo guardado. El ranking ya usa estos valores.'; aviso('Modelo guardado. El ranking ya usa estos valores.'); }
      catch (err) { $('mdMsg').textContent = err.message; aviso(err.message, 'error'); }
    });
    $('btnRestaurar').addEventListener('click', function () {
      S.datos.config = { mesesBase: S.datos.config.mesesBase };
      cambiosGuardados('valores iniciales del modelo'); pintarModelo();
      $('mdMsg').textContent = 'Se restauraron los valores iniciales.';
    });

    arrastrar($('zonaHist'), $('fileHist'), procesarHistorico);
    arrastrar($('zonaRoll'), $('fileRoll'), procesarRolling);

    $('formGh').addEventListener('submit', function (e) {
      e.preventDefault();
      var c = leerFormGh();
      try { localStorage.setItem(LS_GH, JSON.stringify(c)); } catch (err) { /* sin almacenamiento */ }
      estado($('ghEstado'), ghListo(c) ? '<h2>Conexión guardada</h2><p>Se usará ' + esc(c.owner + '/' + c.repo) + ', rama ' + esc(c.branch) + '.</p>' : '<h2>Conexión incompleta</h2><p>Faltan usuario, repositorio o token.</p>', ghListo(c) ? 'ok' : 'error');
      registrar('Conexión guardada para ' + (c.owner || '?') + '/' + (c.repo || '?') + '.');
      aviso(ghListo(c) ? 'Conexión guardada en este navegador.' : 'Faltan usuario, repositorio o token.', ghListo(c) ? '' : 'error');
    });
    $('btnProbar').addEventListener('click', function () {
      var c = leerFormGh();
      estado($('ghEstado'), '<p class="cargando">Probando acceso a ' + esc(c.owner + '/' + c.repo) + '</p>'); botonesGh(false);
      window.GitHubSync.probar(c).then(function (r) {
        estado($('ghEstado'), '<h2>Conexión correcta</h2><p>El token puede escribir en ' + esc(r.repo) + (r.privado ? ' (repositorio privado: GitHub Pages solo lo publica con plan de pago).' : '.') + '</p>', 'ok');
        registrar('Conexión probada con ' + r.repo + '.');
      }).catch(function (e) { estado($('ghEstado'), '<h2>La conexión falló</h2><p>' + esc(e.message) + '</p>', 'error'); registrar('Prueba fallida: ' + e.message, true); })
        .finally(function () { botonesGh(true); });
    });
    $('btnPublicar').addEventListener('click', function () { publicarGitHub('publicación manual'); });
    $('btnTraer').addEventListener('click', function () {
      var c = leerFormGh();
      estado($('ghEstado'), '<p class="cargando">Trayendo ' + esc(c.path) + '</p>'); botonesGh(false);
      window.GitHubSync.traer(c).then(function (d) {
        if (!d || !d.version) throw new Error('El archivo de GitHub no tiene el formato del ranking.');
        aplicarDatos(d, 'GitHub (' + c.owner + '/' + c.repo + ')'); guardarLocal();
        estado($('ghEstado'), '<h2>Datos traídos de GitHub</h2><p>Versión del ' + esc(fecha(d.actualizado)) + '.</p><div class="acciones"><a class="btn btn-primario" href="#ranking">Ver ranking</a></div>', 'ok');
        registrar('Datos traídos de GitHub (' + fecha(d.actualizado) + ').');
      }).catch(function (e) { estado($('ghEstado'), '<h2>No se pudieron traer los datos</h2><p>' + esc(e.message) + '</p>', 'error'); registrar('Error al traer: ' + e.message, true); })
        .finally(function () { botonesGh(true); });
    });
    $('btnOlvidar').addEventListener('click', function () {
      var c = ghCfg(); delete c.token;
      try { localStorage.setItem(LS_GH, JSON.stringify(c)); } catch (e) { /* sin almacenamiento */ }
      $('formGh').elements.token.value = '';
      estado($('ghEstado'), '<h2>Token borrado</h2><p>Este navegador ya no puede publicar hasta que guardes un token nuevo.</p>');
      registrar('Token borrado de este navegador.');
      aviso('Token borrado de este navegador.');
    });

    mostrarVista();
    cargarInicial().then(function () { mostrarVista(); S.cargaInicial = false; });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
})();
