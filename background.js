// Website Time Cost — background service worker (MV3)
// Tracks per-domain time and open counts, responds to content script updates,
// and toggles overlay per domain via the toolbar action.

const DAY_KEY = () => new Date().toISOString().slice(0, 10); // YYYY-MM-DD

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
