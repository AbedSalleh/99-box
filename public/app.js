'use strict';

const grid = document.getElementById('grid');
const clockEl = document.getElementById('clock');
const clockTimeEl = document.getElementById('clock-time');
const overlay = document.getElementById('overlay');
const modalTitle = document.getElementById('modal-title');
const modalBody = document.getElementById('modal-body');
const modalClose = document.getElementById('modal-close');

let state = {
  boxCount: 99,
  filled: new Set(),
  cycleEndsAt: 0,
  // Offset between the server clock and this browser's clock, so the countdown
  // stays accurate even if the local clock is skewed.
  clockSkew: 0,
};

// --------------------------------------------------------------------------
// API helpers
// --------------------------------------------------------------------------
async function api(url, options) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  let data = {};
  try {
    data = await res.json();
  } catch {
    /* no body */
  }
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status}).`);
  }
  return data;
}

async function refreshState() {
  const data = await api('/api/state');
  const prevEndsAt = state.cycleEndsAt;
  state.boxCount = data.boxCount;
  state.filled = new Set(data.filled);
  state.cycleEndsAt = data.cycleEndsAt;
  state.clockSkew = data.serverNow - Date.now();

  // If the wall was wiped (new cycle), close any open modal.
  if (prevEndsAt && data.cycleEndsAt !== prevEndsAt) {
    closeModal();
  }
  renderGrid();
}

// --------------------------------------------------------------------------
// Grid
// --------------------------------------------------------------------------
function renderGrid() {
  if (grid.childElementCount !== state.boxCount) {
    grid.innerHTML = '';
    for (let i = 1; i <= state.boxCount; i++) {
      const btn = document.createElement('button');
      btn.className = 'box';
      btn.textContent = i;
      btn.dataset.id = String(i);
      btn.addEventListener('click', () => openBoxModal(i));
      grid.appendChild(btn);
    }
  }
  for (const btn of grid.children) {
    const id = Number(btn.dataset.id);
    btn.classList.toggle('filled', state.filled.has(id));
  }
}

// --------------------------------------------------------------------------
// Modal
// --------------------------------------------------------------------------
function openModal() {
  overlay.classList.remove('hidden');
}
function closeModal() {
  overlay.classList.add('hidden');
  modalBody.innerHTML = '';
}

modalClose.addEventListener('click', closeModal);
overlay.addEventListener('click', (e) => {
  if (e.target === overlay) closeModal();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModal();
});

function openBoxModal(id) {
  if (state.filled.has(id)) {
    renderOpenForm(id);
  } else {
    renderFillForm(id);
  }
  openModal();
}

function renderFillForm(id) {
  modalTitle.textContent = `Lock box #${id}`;
  modalBody.innerHTML = `
    <label for="fill-text">Secret text</label>
    <textarea id="fill-text" maxlength="5000" placeholder="What goes in the box?"></textarea>
    <label for="fill-pass">Password to lock it</label>
    <input type="password" id="fill-pass" placeholder="Choose a password" />
    <button class="primary" id="fill-btn">Lock it</button>
    <div class="msg" id="fill-msg"></div>
  `;
  const textEl = document.getElementById('fill-text');
  const passEl = document.getElementById('fill-pass');
  const btn = document.getElementById('fill-btn');
  const msg = document.getElementById('fill-msg');

  textEl.focus();
  btn.addEventListener('click', async () => {
    const text = textEl.value.trim();
    const password = passEl.value;
    if (!text) return setMsg(msg, 'Enter some text first.', 'error');
    if (!password) return setMsg(msg, 'Choose a password.', 'error');

    btn.disabled = true;
    setMsg(msg, 'Locking…', '');
    try {
      await api(`/api/boxes/${id}/fill`, {
        method: 'POST',
        body: JSON.stringify({ text, password }),
      });
      setMsg(msg, 'Locked! Anyone with the password can open it.', 'ok');
      await refreshState();
      setTimeout(closeModal, 900);
    } catch (err) {
      btn.disabled = false;
      setMsg(msg, err.message, 'error');
      if (/taken/i.test(err.message)) await refreshState();
    }
  });
}

function renderOpenForm(id) {
  modalTitle.textContent = `Open box #${id}`;
  modalBody.innerHTML = `
    <label for="open-pass">Password</label>
    <input type="password" id="open-pass" placeholder="Enter the box's password" />
    <button class="primary" id="open-btn">Open</button>
    <div class="msg" id="open-msg"></div>
  `;
  const passEl = document.getElementById('open-pass');
  const btn = document.getElementById('open-btn');
  const msg = document.getElementById('open-msg');

  passEl.focus();
  const submit = async () => {
    const password = passEl.value;
    if (!password) return setMsg(msg, 'Enter the password.', 'error');

    btn.disabled = true;
    setMsg(msg, 'Opening…', '');
    try {
      const data = await api(`/api/boxes/${id}/open`, {
        method: 'POST',
        body: JSON.stringify({ password }),
      });
      modalBody.innerHTML = `
        <p class="msg ok">Box #${id} unlocked.</p>
        <div class="revealed"></div>
      `;
      modalBody.querySelector('.revealed').textContent = data.text;
    } catch (err) {
      btn.disabled = false;
      setMsg(msg, err.message, 'error');
      if (/empty/i.test(err.message)) await refreshState();
    }
  };
  btn.addEventListener('click', submit);
  passEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submit();
  });
}

function setMsg(el, text, kind) {
  el.textContent = text;
  el.className = `msg ${kind}`;
}

// --------------------------------------------------------------------------
// Countdown clock
// --------------------------------------------------------------------------
function formatRemaining(ms) {
  if (ms < 0) ms = 0;
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

let lastTickWasExpired = false;
function tickClock() {
  const now = Date.now() + state.clockSkew;
  const remaining = state.cycleEndsAt - now;
  clockTimeEl.textContent = formatRemaining(remaining);
  clockEl.classList.toggle('urgent', remaining <= 10000);

  // When the cycle expires, pull fresh state so the wipe + new clock show up.
  if (remaining <= 0) {
    if (!lastTickWasExpired) {
      lastTickWasExpired = true;
      refreshState();
    }
  } else {
    lastTickWasExpired = false;
  }
}

// --------------------------------------------------------------------------
// Boot
// --------------------------------------------------------------------------
refreshState();
setInterval(tickClock, 250);
// Periodically sync filled state so other users' boxes appear.
setInterval(refreshState, 5000);
