// Website Time Cost — content overlay + per-tab time tracking

(function () {
  const domain = normalizeDomain(location.hostname);
  const state = {
    lastTick: Date.now(),
    accumulatedMsSincePush: 0,
    summary: null,
    trackingStarted: false
  };

  // Build UI early, but default hidden to prevent flash
  const ui = buildOverlay();

  init();

  async function init() {
    // Initial summary + check if disabled
    const initSummary = await sendMsg({ type: "getSummary", domain }).catch(() => null);
    state.summary = initSummary?.summary || null;
    updateVisibility();
    if (!state.summary?.disabled) {
      updateOverlayText();
      startTracking();
    }
  }

  function startTracking() {
    if (state.trackingStarted) return;
    state.trackingStarted = true;
    const interval = 1000; // 1s resolution
    setInterval(() => {
      const now = Date.now();
      let delta = now - state.lastTick;
      state.lastTick = now;

      // Only count time when visible and has focus to approximate attention
      const visible = document.visibilityState === 'visible' && document.hasFocus();
      if (!visible) return;

      // Cap a runaway delta (sleep/wake etc.)
      if (delta > 5000) delta = 1000;

      state.accumulatedMsSincePush += delta;
      // Optimistic local UI update so the timer feels live
      if (state.summary) {
        state.summary.todayMs = (state.summary.todayMs || 0) + delta;
        state.summary.lifetimeMs = (state.summary.lifetimeMs || 0) + delta;
      }
      updateOverlayText();

      // Batch writes to background every ~5s
      if (state.accumulatedMsSincePush >= 5000) {
        const toPush = state.accumulatedMsSincePush;
        state.accumulatedMsSincePush = 0;
        sendMsg({ type: 'incrementTime', domain, deltaMs: toPush })
          .then((res) => {
            state.summary = res?.summary || state.summary;
            updateOverlayText();
          })
          .catch(() => {});
      }
    }, interval);
  }

  function buildOverlay() {
    const root = document.createElement('div');
    root.id = '__wtc_overlay_root__';
    root.setAttribute('style', [
      'position: fixed',
      'z-index: 9999999999',
      'right: 16px',
      'top: 16px',
      'font-family: ui-sans-serif, -apple-system, Segoe UI, Roboto, sans-serif',
      'background: rgba(0,0,0,0.75)',
      'color: #fff',
      'padding: 8px 12px',
      'border-radius: 8px',
      'box-shadow: 0 4px 14px rgba(0,0,0,0.2)',
      'backdrop-filter: saturate(120%) blur(6px)',
      'display: none',
      'align-items: center',
      'gap: 10px',
      'pointer-events: auto'
    ].join(';'));

    const icon = document.createElement('span');
    icon.textContent = '⏱';
    icon.setAttribute('style', 'font-size: 16px');

    const text = document.createElement('div');
    text.id = '__wtc_overlay_text__';
    text.setAttribute('style', 'font-size: 13px; line-height: 1.25;');
    text.textContent = '…';

    const actions = document.createElement('div');
    actions.setAttribute('style', 'display:flex; gap:8px; align-items:center;');

    const hideBtn = document.createElement('button');
    hideBtn.textContent = 'Hide here';
    hideBtn.setAttribute('title', 'Hide overlay on this site');
    hideBtn.setAttribute('style', [
      'background: transparent',
      'color: #fff',
      'border: 1px solid rgba(255,255,255,0.35)',
      'padding: 2px 6px',
      'border-radius: 6px',
      'font-size: 11px',
      'cursor: pointer',
    ].join(';'));
    hideBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      try {
        const res = await sendMsg({ type: 'toggleDomain', domain });
        state.summary = res?.summary || state.summary;
        updateVisibility();
      } catch {}
    });

    actions.appendChild(hideBtn);

    root.appendChild(icon);
    root.appendChild(text);
    root.appendChild(actions);

    document.documentElement.appendChild(root);
    return root;
  }

  function updateVisibility() {
    const disabled = state.summary?.disabled;
    const el = document.getElementById('__wtc_overlay_root__');
    if (!el) return;
    el.style.display = disabled ? 'none' : 'flex';
  }

  function formatDuration(ms) {
    let totalSec = Math.max(0, Math.floor(ms / 1000));
    const SECS_PER_DAY = 86400;
    const SECS_PER_YEAR = 365 * SECS_PER_DAY; // approximate
    const y = Math.floor(totalSec / SECS_PER_YEAR);
    totalSec %= SECS_PER_YEAR;
    const d = Math.floor(totalSec / SECS_PER_DAY);
    totalSec %= SECS_PER_DAY;
    const h = Math.floor(totalSec / 3600);
    totalSec %= 3600;
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;

    const parts = [
      { v: y, u: 'y' },
      { v: d, u: 'd' },
      { v: h, u: 'h' },
      { v: m, u: 'm' },
      { v: s, u: 's' },
    ];

    // Find first non-zero unit (except seconds which can be zero if all zero)
    let start = parts.findIndex((p, idx) => p.v > 0 && idx < parts.length - 1);
    if (start === -1) start = parts.length - 1; // all zero until seconds

    return parts.slice(start).map(p => `${p.v}${p.u}`).join(' ');
  }

  function chooseMessage(summary) {
    const lifeMs = summary?.lifetimeMs || 0;
    return `This page already consumed: ${formatDuration(lifeMs)} of your life`;
  }

  function updateOverlayText() {
    const text = document.getElementById('__wtc_overlay_text__');
    if (!text || !state.summary) return;
    text.textContent = chooseMessage(state.summary);
  }

  function normalizeDomain(host) {
    return String(host || '').replace(/^www\./i, '').toLowerCase();
  }

  function sendMsg(payload) {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage(payload, (res) => {
          const err = chrome.runtime.lastError;
          if (err) return reject(err);
          resolve(res);
        });
      } catch (e) {
        reject(e);
      }
    });
  }

  // React to toolbar toggles
  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg) return;
    if (msg.type === 'overlayVisibilityChanged') {
      // Refresh summary and apply
      sendMsg({ type: 'getSummary', domain }).then((res) => {
        state.summary = res?.summary || state.summary;
        updateVisibility();
        if (!state.summary?.disabled) startTracking();
      }).catch(() => {});
    }
  });
})();
