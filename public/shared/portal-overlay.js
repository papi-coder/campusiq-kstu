// public/shared/portal-overlay.js
// Reusable portal overlay system for CampusIQ
// Opens portals (Student Portal, Admin Backend, Career Hub) in a beautiful
// overlay with backdrop blur, smooth animations, and independent scrolling.

const PortalOverlay = (() => {
  let backdrop = null;
  let overlay = null;
  let panel = null;
  let frame = null;
  let titleEl = null;
  let closeBtn = null;
  let currentUrl = '';
  let savedScrollY = 0;

  function init() {
    if (document.getElementById('portal-overlay-backdrop')) return;

    backdrop = document.createElement('div');
    backdrop.id = 'portal-overlay-backdrop';
    backdrop.className = 'portal-overlay-backdrop';

    overlay = document.createElement('div');
    overlay.id = 'portal-overlay';
    overlay.className = 'portal-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Portal');

    panel = document.createElement('div');
    panel.className = 'portal-overlay-panel';

    const header = document.createElement('div');
    header.className = 'portal-overlay-header';

    titleEl = document.createElement('div');
    titleEl.className = 'portal-overlay-title';

    closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'portal-overlay-close';
    closeBtn.textContent = '✕ Close';
    closeBtn.setAttribute('aria-label', 'Close portal');

    header.appendChild(titleEl);
    header.appendChild(closeBtn);
    panel.appendChild(header);

    frame = document.createElement('iframe');
    frame.className = 'portal-overlay-frame';
    frame.setAttribute('allow', 'camera; microphone; geolocation');
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups allow-modals');
    panel.appendChild(frame);

    overlay.appendChild(panel);
    document.body.appendChild(backdrop);
    document.body.appendChild(overlay);

    closeBtn.addEventListener('click', close);
    backdrop.addEventListener('click', close);

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && overlay.classList.contains('open')) {
        close();
      }
    });

    overlay.addEventListener('transitionend', () => {
      if (!overlay.classList.contains('open') && frame.src) {
        frame.src = '';
      }
    });
  }

  function open(url, title) {
    init();
    currentUrl = url;
    savedScrollY = window.scrollY;

    titleEl.innerHTML = `<img src="logo-icon.svg" alt=""> ${title || 'Portal'}`;
    frame.src = url;

    document.body.style.overflow = 'hidden';
    document.body.style.position = 'fixed';
    document.body.style.top = `-${savedScrollY}px`;
    document.body.style.width = '100%';

    requestAnimationFrame(() => {
      backdrop.classList.add('open');
      overlay.classList.add('open');
    });
  }

  function close() {
    if (!overlay || !overlay.classList.contains('open')) return;

    overlay.classList.remove('open');
    backdrop.classList.remove('open');

    document.body.style.overflow = '';
    document.body.style.position = '';
    document.body.style.top = '';
    document.body.style.width = '';

    window.scrollTo(0, savedScrollY);

    setTimeout(() => {
      if (frame) frame.src = '';
      currentUrl = '';
    }, 350);
  }

  function isOpen() {
    return overlay && overlay.classList.contains('open');
  }

  return { open, close, isOpen };
})();

window.PortalOverlay = PortalOverlay;
