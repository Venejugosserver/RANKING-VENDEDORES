/* Procesa el histórico fuera del hilo principal para que la página no se congele. */
importScripts('historico-core.js');

self.onmessage = async function (e) {
  var d = e.data || {};
  try {
    var out = await self.HistoricoCore.parseHistorico(d.file, {
      fileName: d.file && d.file.name,
      nestleUnit: d.nestleUnit,
      keySubs: d.keySubs,
      onProgress: function (p) { self.postMessage({ type: 'progress', progress: p }); }
    });
    self.postMessage({ type: 'done', result: out });
  } catch (err) {
    self.postMessage({ type: 'error', message: (err && err.message) || String(err) });
  }
};
