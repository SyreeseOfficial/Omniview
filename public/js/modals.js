// Toasts, the confirm/prompt dialogs, the lightbox, and focus handling shared by every overlay.

// ─── Toast ───────────────────────────────────────────────────────────────────
export function showToast(message, opts = {}) {
  const { type = 'info', duration = 3500, actionLabel, onAction } = opts;
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.setAttribute('role', type === 'error' ? 'alert' : 'status');

  const msg = document.createElement('span');
  msg.className = 'toast-msg';
  msg.textContent = message;
  toast.appendChild(msg);

  const dismiss = () => {
    clearTimeout(timer);
    toast.classList.add('toast-out');
    setTimeout(() => toast.remove(), 160);
  };

  if (actionLabel) {
    const action = document.createElement('button');
    action.type = 'button';
    action.className = 'toast-action';
    action.textContent = actionLabel;
    action.addEventListener('click', () => { onAction && onAction(); dismiss(); });
    toast.appendChild(action);
  }

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'toast-close';
  close.setAttribute('aria-label', 'Dismiss');
  close.textContent = '✕';
  close.addEventListener('click', dismiss);
  toast.appendChild(close);

  container.appendChild(toast);
  const timer = setTimeout(dismiss, duration);
}

export function toastSuccess(message) { showToast(message, { type: 'success' }); }
export function toastError(message) { showToast(message, { type: 'error', duration: 5000 }); }

// Runs a DOM update inside a view transition (a short cross-fade) where the browser has them.
// The update runs a frame late there, so only wrap calls nothing else depends on synchronously.
export function withTransition(update) {
  if (!document.startViewTransition || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return update();
  document.startViewTransition(update);
}

// ─── Modal a11y (focus trap + return) ────────────────────────────────────────
// Tracks nested overlays (e.g. the confirm modal opening on top of the detail
// modal) so closing the inner one restores focus to the outer one, not the page.
const modalStack = [];

export function isOpen(overlayId) {
  const el = document.getElementById(overlayId);
  return !!el && el.style.display !== 'none';
}

function focusableIn(container) {
  return [...container.querySelectorAll('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
    .filter(el => !el.disabled && el.offsetParent !== null);
}

export function openModalOverlay(overlayId) {
  const overlay = document.getElementById(overlayId);
  const returnFocusEl = document.activeElement;
  overlay.style.display = '';
  const modal = overlay.querySelector('.modal');
  const focusable = focusableIn(modal);
  (focusable[0] || modal).focus();

  const keydownHandler = e => {
    if (e.key !== 'Tab') return;
    const items = focusableIn(modal);
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  overlay.addEventListener('keydown', keydownHandler);
  modalStack.push({ overlayId, overlay, keydownHandler, returnFocusEl });
}

export function closeModalOverlay(overlayId) {
  const i = modalStack.findIndex(m => m.overlayId === overlayId);
  if (i === -1) return;
  const [m] = modalStack.splice(i, 1);
  m.overlay.style.display = 'none';
  m.overlay.removeEventListener('keydown', m.keydownHandler);
  if (m.returnFocusEl && m.returnFocusEl.isConnected) m.returnFocusEl.focus();
}

// ─── Confirm ─────────────────────────────────────────────────────────────────
let confirmCallback = null;

export function setupConfirmModal() {
  document.getElementById('confirm-cancel').addEventListener('click', () => {
    closeModalOverlay('confirm-overlay');
    confirmCallback = null;
  });
  document.getElementById('confirm-ok').addEventListener('click', () => {
    closeModalOverlay('confirm-overlay');
    if (confirmCallback) { confirmCallback(); confirmCallback = null; }
  });
}

export function confirm_(msg, cb, okLabel = 'Delete') {
  document.getElementById('confirm-body').textContent = msg;
  document.getElementById('confirm-ok').textContent = okLabel;
  openModalOverlay('confirm-overlay');
  confirmCallback = cb;
}

// ─── Prompt ──────────────────────────────────────────────────────────────────
// Styled stand-in for the browser's native prompt(), used anywhere the app
// needs a single text value (board names, new tag/type/found-via names).
let promptCallback = null;

export function setupPromptModal() {
  document.getElementById('prompt-cancel').addEventListener('click', () => {
    closeModalOverlay('prompt-overlay');
    promptCallback = null;
  });
  document.getElementById('prompt-form').addEventListener('submit', e => {
    e.preventDefault();
    const value = document.getElementById('prompt-input').value.trim();
    closeModalOverlay('prompt-overlay');
    if (promptCallback) { promptCallback(value); promptCallback = null; }
  });
}

export function prompt_(title, defaultValue, cb) {
  document.getElementById('prompt-title').textContent = title;
  const input = document.getElementById('prompt-input');
  input.value = defaultValue || '';
  openModalOverlay('prompt-overlay');
  input.select();
  promptCallback = cb;
}

// ─── Lightbox ────────────────────────────────────────────────────────────────
// Full-size screenshot. Wheel zooms around the cursor, drag pans, click toggles
// between fit-to-screen and actual size.
const MAX_ZOOM = 8;
let zoom = { scale: 1, x: 0, y: 0 };

function applyZoom() {
  const img = document.getElementById('lightbox-img');
  img.style.transform = zoom.scale === 1 ? '' : `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.scale})`;
  img.classList.toggle('zoomed', zoom.scale > 1);
}

// Zooms by `factor` keeping the point under (px, py) fixed on screen.
function zoomAt(factor, px, py) {
  const img = document.getElementById('lightbox-img');
  const r = img.getBoundingClientRect();
  const scale = Math.min(MAX_ZOOM, Math.max(1, zoom.scale * factor));
  const k = scale / zoom.scale;
  zoom = scale === 1 ? { scale, x: 0, y: 0 } : { scale, x: zoom.x + (px - (r.left + r.width / 2)) * (1 - k), y: zoom.y + (py - (r.top + r.height / 2)) * (1 - k) };
  applyZoom();
}

export function setupLightbox() {
  const overlay = document.getElementById('lightbox-overlay');
  const img = document.getElementById('lightbox-img');
  let drag = null;

  img.addEventListener('wheel', e => {
    e.preventDefault();
    zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY);
  }, { passive: false });
  img.addEventListener('pointerdown', e => {
    drag = { x: e.clientX, y: e.clientY, ox: zoom.x, oy: zoom.y, moved: false };
    img.setPointerCapture(e.pointerId);
  });
  img.addEventListener('pointermove', e => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.hypot(dx, dy) > 4) drag.moved = true;
    if (drag.moved && zoom.scale > 1) { zoom.x = drag.ox + dx; zoom.y = drag.oy + dy; applyZoom(); }
  });
  img.addEventListener('pointerup', () => {
    if (!drag) return;
    const wasDrag = drag.moved;
    drag = null;
    if (wasDrag) return;
    // Plain click: back to fit, or in to actual size (at least 2x) around the image center.
    if (zoom.scale > 1) zoomAt(1 / zoom.scale, 0, 0);
    else {
      const r = img.getBoundingClientRect();
      zoomAt(Math.max(2, img.naturalWidth / img.clientWidth), r.left + r.width / 2, r.top + r.height / 2);
    }
  });
  document.getElementById('lightbox-close').addEventListener('click', closeLightbox);
  overlay.addEventListener('click', e => { if (e.target === overlay) closeLightbox(); });
}

export function openLightbox(src) {
  setLightboxSrc(src);
  if (!isOpen('lightbox-overlay')) openModalOverlay('lightbox-overlay');
}

export function setLightboxSrc(src) {
  zoom = { scale: 1, x: 0, y: 0 };
  applyZoom();
  document.getElementById('lightbox-img').src = src;
}

export function closeLightbox() { closeModalOverlay('lightbox-overlay'); }
