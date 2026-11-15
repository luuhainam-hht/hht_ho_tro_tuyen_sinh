(function () {
  'use strict';
  Promise.all([apiClient.get('/api/handbook/guide'), hht.meta()]).then(([{ steps }, meta]) => {
    $('#guide').replaceChildren(...steps.map((s) => el('li', {}, el('h3', {}, s.title), el('p', {}, s.detail))));
    if (meta.config.OFFICIAL_REGISTER_URL) $('#official-register').href = meta.config.OFFICIAL_REGISTER_URL;
  }).catch((e) => toast(e.message, 'error'));
})();
