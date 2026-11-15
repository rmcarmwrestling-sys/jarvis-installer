(() => {
  'use strict';

  let deferredInstallPrompt = null;
  const $ = selector => document.querySelector(selector);

  const toast = message => {
    const node = $('#toast');
    if (!node) return;
    node.textContent = message;
    node.classList.add('visible');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => node.classList.remove('visible'), 4200);
  };

  const platform = (() => {
    const ua = navigator.userAgent || '';
    if (/android/i.test(ua)) return 'android';
    if (/windows/i.test(ua)) return 'windows';
    if (/iphone|ipad|ipod/i.test(ua)) return 'ios';
    return 'other';
  })();

  function renderDetectedPlatform() {
    const banner = $('#detectedBanner');
    const text = $('#detectedText');
    if (!banner || !text) return;
    document.querySelectorAll('.platform-card').forEach(card => card.classList.toggle('detected', card.dataset.platform === platform));
    const labels = {
      android: 'Estás en Android · la opción recomendada es instalar la PWA.',
      windows: 'Estás en Windows · la descarga portable está lista para ti.',
      ios: 'Estás en iPhone o iPad · abre el menú Compartir y elige «Añadir a pantalla de inicio».',
      other: 'Puedes elegir Windows para descargar Jarvis o Android para instalar la versión web.',
    };
    text.textContent = labels[platform];
  }

  async function installAndroid() {
    window.location.href = 'jarvis/';
  }

  function setupMenu() {
    const menu = $('.site-nav');
    const button = $('#menuButton');
    if (!menu || !button) return;
    button.addEventListener('click', () => {
      const open = menu.classList.toggle('open');
      button.setAttribute('aria-expanded', String(open));
    });
    menu.querySelectorAll('a').forEach(link => link.addEventListener('click', () => {
      menu.classList.remove('open');
      button.setAttribute('aria-expanded', 'false');
    }));
  }

  document.addEventListener('DOMContentLoaded', () => {
    renderDetectedPlatform();
    setupMenu();
    $('#androidInstall')?.addEventListener('click', installAndroid);
  });
})();
