/* Conexión con GitHub: publica y trae ranking-data.json del repositorio del sitio. */
(function (root) {
  'use strict';
  var API = 'https://api.github.com';

  function headers(cfg, raw) {
    var h = { 'Accept': raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
    if (cfg.token) h.Authorization = 'Bearer ' + cfg.token;
    return h;
  }
  function url(cfg) {
    return API + '/repos/' + encodeURIComponent(cfg.owner) + '/' + encodeURIComponent(cfg.repo) + '/contents/' +
      cfg.path.split('/').map(encodeURIComponent).join('/');
  }
  function b64(str) {
    var bytes = new TextEncoder().encode(str), bin = '', step = 0x8000;
    for (var i = 0; i < bytes.length; i += step) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + step));
    return btoa(bin);
  }
  async function explicar(res) {
    var msg = '';
    try { msg = (await res.json()).message || ''; } catch (e) { /* sin cuerpo */ }
    if (res.status === 401) return 'GitHub rechazó el token (401). Genera uno nuevo con permiso de escritura en "Contents".';
    if (res.status === 403) return 'El token no tiene permiso sobre este repositorio (403). ' + msg;
    if (res.status === 404) return 'No se encontró el repositorio, la rama o el archivo (404). Revisa usuario, repositorio y rama.';
    if (res.status === 409) return 'Conflicto al guardar (409): alguien actualizó el archivo. Vuelve a publicar.';
    if (res.status === 422) return 'GitHub no aceptó los datos (422). ' + msg;
    return 'Error de GitHub ' + res.status + '. ' + msg;
  }
  function validar(cfg) {
    if (!cfg.owner || !cfg.repo) throw new Error('Completa el usuario y el repositorio.');
    if (!cfg.token) throw new Error('Falta el token de acceso.');
    if (!cfg.path) cfg.path = 'ranking-data.json';
    if (!cfg.branch) cfg.branch = 'main';
  }

  async function probar(cfg) {
    validar(cfg);
    var res = await fetch(API + '/repos/' + encodeURIComponent(cfg.owner) + '/' + encodeURIComponent(cfg.repo), { headers: headers(cfg) });
    if (!res.ok) throw new Error(await explicar(res));
    var repo = await res.json();
    if (repo.permissions && !repo.permissions.push) throw new Error('El token puede leer el repositorio pero no escribir en él.');
    var br = await fetch(API + '/repos/' + encodeURIComponent(cfg.owner) + '/' + encodeURIComponent(cfg.repo) + '/branches/' + encodeURIComponent(cfg.branch), { headers: headers(cfg) });
    if (!br.ok) throw new Error('La rama "' + cfg.branch + '" no existe en ' + repo.full_name + '.');
    return { repo: repo.full_name, privado: repo.private, pages: repo.has_pages };
  }

  async function shaActual(cfg) {
    var res = await fetch(url(cfg) + '?ref=' + encodeURIComponent(cfg.branch), { headers: headers(cfg) });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(await explicar(res));
    return (await res.json()).sha || null;
  }

  async function publicar(cfg, datos, mensaje) {
    validar(cfg);
    var contenido = JSON.stringify(datos);
    for (var intento = 0; intento < 2; intento++) {
      var sha = await shaActual(cfg);
      var body = { message: mensaje || 'Actualiza datos del ranking comercial', content: b64(contenido), branch: cfg.branch };
      if (sha) body.sha = sha;
      var res = await fetch(url(cfg), { method: 'PUT', headers: Object.assign({ 'Content-Type': 'application/json' }, headers(cfg)), body: JSON.stringify(body) });
      if (res.ok) { var j = await res.json(); return { commit: j.commit && j.commit.html_url, bytes: contenido.length }; }
      if (res.status !== 409 || intento === 1) throw new Error(await explicar(res));
    }
  }

  async function traer(cfg) {
    validar(cfg);
    var res = await fetch(url(cfg) + '?ref=' + encodeURIComponent(cfg.branch), { headers: headers(cfg, true), cache: 'no-store' });
    if (!res.ok) throw new Error(await explicar(res));
    return JSON.parse(await res.text());
  }

  root.GitHubSync = { probar: probar, publicar: publicar, traer: traer };
})(typeof self !== 'undefined' ? self : globalThis);
