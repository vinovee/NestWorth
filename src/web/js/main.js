// @ts-check
/** Start-up and routing. Routes: #/dashboard, #/homes, #/homes/<id>, #/profile. */
import { $, mount, h } from './dom.js';
import { ui } from './ui.js';
import { subscribe, getState, saveError } from './store.js';
import * as api from './api.js';
import { renderDashboard } from './views/dashboard.js';
import { renderHomes, homesKeydown } from './views/homes.js';
import { renderProfile, refreshSummary } from './views/profile.js';
import { wireAddButton } from './views/add-home.js';
import { startScheduler } from './refresh.js';

function parseRoute() {
  const parts = location.hash.replace(/^#\/?/, '').split('/');
  const route = ['dashboard', 'homes', 'profile'].includes(parts[0]) ? parts[0] : 'dashboard';
  /** @type {string | null} */
  let id = null;
  try {
    if (parts[1]) id = decodeURIComponent(parts[1]);
  } catch {
    // malformed id: ignore it
  }
  return { route, id };
}

function render() {
  const { route, id } = parseRoute();
  const changedRoute = route !== ui.route;
  ui.route = route;
  if (route === 'homes' && id && getState().homes[id]) ui.currentId = id;
  document.querySelectorAll('[data-route]').forEach((a) => {
    if (/** @type {HTMLElement} */ (a).dataset.route === route) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  const main = $('main');
  if (route !== 'homes') $('pager').hidden = true;
  if (route === 'dashboard') renderDashboard(main);
  else if (route === 'homes') renderHomes(main);
  else renderProfile(main);
  document.body.dataset.route = route;
  if (changedRoute) {
    window.scrollTo({ top: 0 });
    main.focus({ preventScroll: true });
  }
  showBanner();
}
ui.rerender = render;

function showBanner() {
  const el = $('banner');
  const msg = saveError() || (ui.health?.demo ? 'Demo mode: assessments use simple keyword rules, not AI. Add an API key on the server for real assessments.' : '') || (ui.healthError ? `Server: ${ui.healthError}` : '');
  el.hidden = !msg;
  el.textContent = msg;
}

subscribe((reason) => {
  if (reason === 'saved') {
    showBanner();
    return;
  }
  // The profile form updates its own summary, so typing never loses focus.
  if (reason === 'profile' && ui.route === 'profile') {
    refreshSummary();
    return;
  }
  render();
});

window.addEventListener('hashchange', render);
document.addEventListener('keydown', homesKeydown);
let resizeTimer = 0;
window.addEventListener('resize', () => {
  window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => {
    if (ui.route === 'homes') render();
  }, 200);
});

wireAddButton();
render();

api.health().then((health) => {
  ui.health = health;
  ui.healthError = '';
  mount($('serverInfo'), h('span', null, health.demo
    ? `Running in demo mode · version ${health.version}`
    : `AI: ${health.provider}, ${health.model} · prompt ${health.promptVersion} · version ${health.version}`));
  render();
  startScheduler();
}).catch((err) => {
  ui.healthError = err instanceof api.ApiError ? err.message : 'Couldn’t reach the server.';
  render();
});
