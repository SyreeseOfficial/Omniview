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
// Full-size screenshot; click the image to toggle between fit-to-screen and actual size.
export function setupLightbox() {
  const overlay = document.getElementById('lightbox-overlay');
  const img = document.getElementById('lightbox-img');
  img.addEventListener('click', () => img.classList.toggle('zoomed'));
  document.getElementById('lightbox-close').addEventListener('click', closeLightbox);
  overlay.addEventListener('click', e => { if (e.target === overlay) closeLightbox(); });
}

export function openLightbox(src) {
  setLightboxSrc(src);
  if (!isOpen('lightbox-overlay')) openModalOverlay('lightbox-overlay');
}

export function setLightboxSrc(src) {
  const img = document.getElementById('lightbox-img');
  img.classList.remove('zoomed');
  img.src = src;
}

export function closeLightbox() { closeModalOverlay('lightbox-overlay'); }
