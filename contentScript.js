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
      // No paused state — always track when visible/focused

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
      'flex-wrap: wrap',
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

    const detailsLink = document.createElement('a');
    detailsLink.href = '#';
    detailsLink.textContent = 'View details';
    detailsLink.setAttribute('style', [
      'color: #9bdcff',
      'text-decoration: underline',
      'font-size: 11px'
    ].join(';'));
    detailsLink.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleDetailsPanel();
    });

    actions.appendChild(hideBtn);
    actions.appendChild(detailsLink);

    root.appendChild(icon);
    root.appendChild(text);
    root.appendChild(actions);

    document.documentElement.appendChild(root);

    // Details panel lives inside root for easy anchoring
    const panel = document.createElement('div');
    panel.id = '__wtc_details_panel__';
    panel.setAttribute('style', [
      'position: absolute',
      'right: 0',
      'top: calc(100% + 8px)',
      'min-width: 280px',
      'max-width: 360px',
      'background: rgba(0,0,0,0.92)',
      'color: #fff',
      'padding: 12px',
      'border-radius: 10px',
      'box-shadow: 0 10px 24px rgba(0,0,0,0.35)',
      'border: 1px solid rgba(255,255,255,0.12)',
      'display: none',
      'backdrop-filter: saturate(120%) blur(8px)'
    ].join(';'));

    const head = document.createElement('div');
    head.setAttribute('style', 'display:flex; align-items:center; justify-content:space-between; margin-bottom:8px;');
    const title = document.createElement('div');
    title.textContent = `Details for ${domain}`;
    title.setAttribute('style', 'font-weight:600; font-size:12px; opacity:0.95;');
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.setAttribute('style', [
      'background: transparent', 'color: #fff', 'border: none', 'cursor: pointer', 'font-size: 12px'
    ].join(';'));
    closeBtn.addEventListener('click', () => { panel.style.display = 'none'; });
    head.appendChild(title); head.appendChild(closeBtn);

    const grid = document.createElement('div');
    grid.id = '__wtc_details_grid__';
    grid.setAttribute('style', [
      'display: grid',
      'grid-template-columns: repeat(2, minmax(0,1fr))',
      'gap: 8px',
      'margin-bottom: 10px'
    ].join(';'));

    const chart = document.createElement('div');
    chart.id = '__wtc_details_chart__';
    chart.setAttribute('style', [
      'height: 56px',
      'display: flex',
      'align-items: flex-end',
      'gap: 3px',
      'margin-top: 6px',
      'opacity: 0.9'
    ].join(';'));

    const chartCaption = document.createElement('div');
    chartCaption.setAttribute('style', 'font-size: 10px; opacity: 0.7; margin-top: 4px;');
    chartCaption.textContent = 'Last 30 days (daily)';

    panel.appendChild(head);
    panel.appendChild(grid);
    panel.appendChild(chart);
    panel.appendChild(chartCaption);

    // Panel footer brand link
    const foot = document.createElement('div');
    foot.setAttribute('style', [
      'margin-top: 8px',
      'font-size: 10px',
      'opacity: 0.8',
      'text-align: right'
    ].join(';'));
    const footText = document.createElement('span');
    footText.textContent = 'website screen time by ';
    const footLink = document.createElement('a');
    footLink.href = 'https://hnetechnologies.com';
    footLink.target = '_blank';
    footLink.rel = 'noopener noreferrer';
    footLink.textContent = 'hnetechnologies';
    footLink.setAttribute('style', 'color: #9bdcff; text-decoration: underline;');
    foot.appendChild(footText);
    foot.appendChild(footLink);
    panel.appendChild(foot);
    root.appendChild(panel);

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

  async function toggleDetailsPanel() {
    const panel = document.getElementById('__wtc_details_panel__');
    if (!panel) return;
    const visible = panel.style.display !== 'none';
    if (visible) {
      panel.style.display = 'none';
      return;
    }
    // Fetch details and render
    panel.style.display = 'block';
    try {
      const res = await sendMsg({ type: 'getDetails', domain });
      const details = res?.details;
      if (details) renderDetails(details);
    } catch {}
  }

  function renderDetails(details) {
    // Fill the stats grid
    const grid = document.getElementById('__wtc_details_grid__');
    if (!grid) return;
    grid.innerHTML = '';

    const stats = [
      { icon: '📅', label: 'Today', value: details.todayMs },
      { icon: '🗓️', label: 'Last 7 days', value: details.last7DaysMs },
      { icon: '📆', label: 'This month', value: details.thisMonthMs },
      { icon: '📊', label: 'Last month', value: details.lastMonthMs },
      { icon: '📈', label: 'This year', value: details.thisYearMs },
      { icon: '📉', label: 'Last year', value: details.lastYearMs },
    ];

    for (const s of stats) {
      const card = document.createElement('div');
      card.setAttribute('style', [
        'border: 1px solid rgba(255,255,255,0.12)',
        'border-radius: 8px',
        'padding: 8px',
        'display:flex',
        'gap:8px',
        'align-items:center',
        'background: rgba(255,255,255,0.03)'
      ].join(';'));
      const icon = document.createElement('div');
      icon.textContent = s.icon;
      icon.setAttribute('style', 'font-size: 14px;');
      const labels = document.createElement('div');
      labels.innerHTML = `<div style="font-size:10px; opacity:0.75">${s.label}</div><div style="font-weight:600; font-size:12px">${formatDuration(s.value)}</div>`;
      card.appendChild(icon);
      card.appendChild(labels);
      grid.appendChild(card);
    }

    // Render simple bar chart for last 30 days
    const chart = document.getElementById('__wtc_details_chart__');
    if (!chart) return;
    chart.innerHTML = '';
    const series = details.byDayLast30 || [];
    const max = details.maxMsLast30 || 1;
    for (const pt of series) {
      const pct = Math.max(0.05, (pt.ms / max) || 0); // keep tiny bar visible
      const bar = document.createElement('div');
      bar.setAttribute('title', `${pt.day}: ${formatDuration(pt.ms)}`);
      bar.setAttribute('style', [
        'width: 7px',
        `height: ${Math.round(8 + 48 * pct)}px`,
        'background: linear-gradient(180deg, #6ee7ff, #1fb6ff)',
        'border-radius: 3px 3px 0 0'
      ].join(';'));
      chart.appendChild(bar);
    }
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
