// Website Time Cost — background service worker (MV3)
// Tracks per-domain time and open counts, responds to content script updates,
// and toggles overlay per domain via the toolbar action.

function localDayKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`; // YYYY-MM-DD in local time
}

const DAY_KEY = () => localDayKey(new Date());

function dayKeyFromDate(d) {
  try {
    return localDayKey(new Date(d));
  } catch (e) {
    return DAY_KEY();
  }
}

function normalizeDomain(urlOrHost) {
  try {
    const host = urlOrHost.includes("/") ? new URL(urlOrHost).hostname : urlOrHost;
    return host.replace(/^www\./, "").toLowerCase();
  } catch (e) {
    return String(urlOrHost || "").replace(/^www\./, "").toLowerCase();
  }
}

async function getStore(keys) {
  return await chrome.storage.local.get(keys);
}

async function setStore(obj) {
  return await chrome.storage.local.set(obj);
}

function ensure(obj, path, defVal) {
  const parts = Array.isArray(path) ? path : String(path).split(".");
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i];
    if (!cur[k] || typeof cur[k] !== "object") cur[k] = {};
    cur = cur[k];
  }
  const last = parts[parts.length - 1];
  if (cur[last] === undefined) cur[last] = defVal;
  return cur[last];
}

async function incrementTime(domainRaw, deltaMs) {
  const domain = normalizeDomain(domainRaw);
  const day = DAY_KEY();
  const state = await getStore(["usageByDay", "totalMsByDomain"]);
  const usageByDay = state.usageByDay || {};
  const totalMsByDomain = state.totalMsByDomain || {};

  ensure(usageByDay, [day, "domains", domain], { ms: 0 });
  usageByDay[day].domains[domain].ms += deltaMs;

  totalMsByDomain[domain] = (totalMsByDomain[domain] || 0) + deltaMs;

  await setStore({ usageByDay, totalMsByDomain });

  return {
    day,
    todayMs: usageByDay[day].domains[domain].ms,
    lifetimeMs: totalMsByDomain[domain]
  };
}

async function getSummary(domainRaw) {
  const domain = normalizeDomain(domainRaw);
  const day = DAY_KEY();
  const state = await getStore([
    "usageByDay",
    "totalMsByDomain",
    "disabledDomains"
  ]);
  const usageByDay = state.usageByDay || {};
  const totalMsByDomain = state.totalMsByDomain || {};
  const disabledDomains = state.disabledDomains || {};

  const todayMs = usageByDay?.[day]?.domains?.[domain]?.ms || 0;
  const lifetimeMs = totalMsByDomain?.[domain] || 0;
  const disabled = Boolean(disabledDomains[domain]);

  return { day, todayMs, lifetimeMs, disabled };
}

async function getDetails(domainRaw) {
  const domain = normalizeDomain(domainRaw);
  const state = await getStore(["usageByDay"]);
  const usageByDay = state.usageByDay || {};

  const now = new Date();
  const todayKey = DAY_KEY();
  const yesterday = new Date(now.getTime() - 86400 * 1000);
  const yesterdayKey = dayKeyFromDate(yesterday);
  const yearPrefix = String(now.getFullYear());
  const monthPrefix = `${yearPrefix}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  // Previous month prefix (handles year boundary)
  const prevMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevMonthPrefix = `${prevMonthDate.getFullYear()}-${String(prevMonthDate.getMonth() + 1).padStart(2, '0')}`;

  let todayMs = 0;
  let yesterdayMs = 0;
  let thisMonthMs = 0;
  let lastMonthMs = 0;
  let thisYearMs = 0;
  let lastYearMs = 0;
  let last7DaysMs = 0;

  // Precompute last-7 and last-30 keys
  const last7Keys = [];
  const last30Keys = [];
  for (let i = 0; i < 30; i++) {
    const d = new Date(now.getTime() - i * 86400 * 1000);
    const k = dayKeyFromDate(d);
    if (i < 7) last7Keys.push(k);
    last30Keys.push(k);
  }

  const byDayLast30 = [];
  let maxMsLast30 = 0;

  // Walk the last30 in reverse to build chronological order later
  for (let i = last30Keys.length - 1; i >= 0; i--) {
    const k = last30Keys[i];
    const ms = usageByDay?.[k]?.domains?.[domain]?.ms || 0;
    byDayLast30.push({ day: k, ms });
    if (ms > maxMsLast30) maxMsLast30 = ms;
  }

  // Aggregate selected windows and calendar periods
  todayMs = usageByDay?.[todayKey]?.domains?.[domain]?.ms || 0;
  yesterdayMs = usageByDay?.[yesterdayKey]?.domains?.[domain]?.ms || 0;

  const lastYearPrefix = String(now.getFullYear() - 1);
  Object.keys(usageByDay).forEach((k) => {
    const bucket = usageByDay[k]?.domains?.[domain];
    if (!bucket) return;
    const ms = bucket.ms || 0;
    if (k.startsWith(yearPrefix)) thisYearMs += ms;
    if (k.startsWith(lastYearPrefix)) lastYearMs += ms;
    if (k.startsWith(monthPrefix)) thisMonthMs += ms;
    if (k.startsWith(prevMonthPrefix)) lastMonthMs += ms;
  });

  last7DaysMs = last7Keys.reduce((sum, k) => sum + (usageByDay?.[k]?.domains?.[domain]?.ms || 0), 0);

  return {
    todayMs,
    yesterdayMs,
    last7DaysMs,
    thisMonthMs,
    lastMonthMs,
    thisYearMs,
    lastYearMs,
    byDayLast30,
    maxMsLast30
  };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "incrementTime") {
      const res = await incrementTime(msg.domain, msg.deltaMs || 0);
      const summary = await getSummary(msg.domain);
      sendResponse({ ok: true, ...res, summary });
    } else if (msg.type === "getSummary") {
      const summary = await getSummary(msg.domain);
      sendResponse({ ok: true, summary });
    } else if (msg.type === "getDetails") {
      const details = await getDetails(msg.domain);
      sendResponse({ ok: true, details });
    } else if (msg.type === "toggleDomain") {
      const domain = normalizeDomain(msg.domain);
      const st = await getStore(["disabledDomains"]);
      const disabledDomains = st.disabledDomains || {};
      if (disabledDomains[domain]) delete disabledDomains[domain];
      else disabledDomains[domain] = true;
      await setStore({ disabledDomains });
      const summary = await getSummary(domain);
      sendResponse({ ok: true, summary });
    }
  })();
  return true; // keep port open for async sendResponse
});

// Toolbar icon click toggles overlay for the active tab's domain
chrome.action.onClicked.addListener(async (tab) => {
  try {
    if (!tab || !tab.id || !tab.url) return;
    const domain = normalizeDomain(tab.url);
    const st = await getStore(["disabledDomains"]);
    const disabledDomains = st.disabledDomains || {};
    if (disabledDomains[domain]) delete disabledDomains[domain];
    else disabledDomains[domain] = true;
    await setStore({ disabledDomains });

    // Notify the current tab to update visibility
    chrome.tabs.sendMessage(tab.id, { type: "overlayVisibilityChanged" }).catch(() => {});
  } catch (e) {
    // no-op
  }
});
