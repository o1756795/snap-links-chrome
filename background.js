importScripts("shared.js");

const DEFAULT_SELECTION_ACTION_KEY = "defaultSelectionAction";
const SETUP_COMPLETED_KEY = "setupCompleted";
const LAST_SELECTION_COUNT_KEY = "lastSelectionCount";
const OPEN_SPEED_MODE_KEY = "openSpeedMode";
const SELECTION_MATCH_MODE_KEY = "selectionMatchMode";
const ACTION_CYCLE_COMMAND = "cycle-default-selection-action";
const ACTION_ORDER = ["open_tabs", "open_windows", "open_window_with_tabs"];
const FIRST_RUN_WELCOME_URL = "https://o1756795.github.io/snap-links-chrome/";
const OPEN_SPEED_PRESETS = {
  fast: { baseDelay: 100, mediumDelay: 140, heavyDelay: 180 },
  balanced: { baseDelay: 140, mediumDelay: 180, heavyDelay: 220 },
  safe: { baseDelay: 180, mediumDelay: 240, heavyDelay: 300 },
};
const MEDIUM_SELECTION_COUNT = 80;
const HEAVY_SELECTION_COUNT = 150;

function normalizeSelectionAction(value) {
  const action = String(value || "").toLowerCase();
  if (action === "open_windows") return "open_windows";
  if (action === "open_window_with_tabs") return "open_window_with_tabs";
  return "open_tabs";
}

function getNextSelectionAction(current) {
  const normalized = normalizeSelectionAction(current);
  const index = ACTION_ORDER.indexOf(normalized);
  if (index === -1) return ACTION_ORDER[0];
  return ACTION_ORDER[(index + 1) % ACTION_ORDER.length];
}

function normalizeOpenSpeedMode(value) {
  const mode = String(value || "").toLowerCase();
  if (mode === "balanced" || mode === "safe") return mode;
  return "fast";
}
function normalizeLegacyActivationModifier(activationModifier, safeMode) {
  const modifier = String(activationModifier || "").toLowerCase();
  if (modifier === "none" || modifier === "alt" || modifier === "shift" || modifier === "ctrl") {
    return modifier;
  }
  if (safeMode === true) return "alt";
  if (safeMode === false) return "none";
  return "alt";
}

function normalizeSelectionMatchMode(value) {
  const mode = String(value || "").toLowerCase();
  if (mode === "touch") return "touch";
  return "strict";
}

function getDelayForCount(mode, linkCount) {
  const normalizedMode = normalizeOpenSpeedMode(mode);
  const preset = OPEN_SPEED_PRESETS[normalizedMode] || OPEN_SPEED_PRESETS.fast;
  if (linkCount >= HEAVY_SELECTION_COUNT) return preset.heavyDelay;
  if (linkCount >= MEDIUM_SELECTION_COUNT) return preset.mediumDelay;
  return preset.baseDelay;
}

function sanitizeLinks(rawLinks) {
  if (!Array.isArray(rawLinks)) return [];
  return rawLinks.filter((link) => {
    if (typeof link !== "string") return false;
    return link.startsWith("http://") || link.startsWith("https://");
  });
}

function openLinksInTabs(links, delay = 100, targetWindowId = null) {
  links.forEach((link, currentIndex) => {
    setTimeout(() => {
      const createOptions = { url: link, active: false };
      if (typeof targetWindowId === "number") {
        createOptions.windowId = targetWindowId;
      }
      chrome.tabs.create(createOptions);
    }, delay * currentIndex);
  });
}

function openLinksInWindows(links, delay = 100) {
  links.forEach((link, currentIndex) => {
    setTimeout(() => {
      chrome.windows.create({ url: link, focused: currentIndex === 0 });
    }, delay * currentIndex);
  });
}

async function openLinksInOneWindowWithTabs(links, delay = 100) {
  if (!Array.isArray(links) || links.length === 0) return;
  const firstWindow = await chrome.windows.create({
    url: links[0],
    focused: true,
  });
  const windowId = firstWindow?.id;
  if (!windowId) return;

  links.slice(1).forEach((link, currentIndex) => {
    setTimeout(() => {
      chrome.tabs.create({
        windowId,
        url: link,
        active: false,
      });
    }, delay * (currentIndex + 1));
  });
}

async function runSelectionAction(mode, links, delay = 100, context = {}) {
  const action = normalizeSelectionAction(mode);
  if (action === "open_windows") {
    openLinksInWindows(links, delay);
    return;
  }
  if (action === "open_window_with_tabs") {
    await openLinksInOneWindowWithTabs(links, delay);
    return;
  }
  openLinksInTabs(links, delay, context.targetWindowId ?? null);
}

async function ensureSelectionDefaultsAfterUpdate() {
  const values = await chrome.storage.local.get([
    DEFAULT_SELECTION_ACTION_KEY,
    SETUP_COMPLETED_KEY,
    LAST_SELECTION_COUNT_KEY,
    OPEN_SPEED_MODE_KEY,
    "activationModifier",
    "safeMode",
    SELECTION_MATCH_MODE_KEY,
  ]);
  const patch = {};

  if (
    values[DEFAULT_SELECTION_ACTION_KEY] !== "open_tabs" &&
    values[DEFAULT_SELECTION_ACTION_KEY] !== "open_windows" &&
    values[DEFAULT_SELECTION_ACTION_KEY] !== "open_window_with_tabs"
  ) {
    patch[DEFAULT_SELECTION_ACTION_KEY] = "open_tabs";
  }
  if (typeof values[SETUP_COMPLETED_KEY] !== "boolean") {
    patch[SETUP_COMPLETED_KEY] = true;
  }
  if (typeof values[LAST_SELECTION_COUNT_KEY] !== "number") {
    patch[LAST_SELECTION_COUNT_KEY] = 0;
  }
  if (
    values[OPEN_SPEED_MODE_KEY] !== "fast" &&
    values[OPEN_SPEED_MODE_KEY] !== "balanced" &&
    values[OPEN_SPEED_MODE_KEY] !== "safe"
  ) {
    patch[OPEN_SPEED_MODE_KEY] = "fast";
  }

  const migratedModifier = normalizeLegacyActivationModifier(
    values.activationModifier,
    values.safeMode,
  );
  if (values.activationModifier !== migratedModifier) {
    patch.activationModifier = migratedModifier;
    patch.safeMode = migratedModifier === "alt";
  }

  const matchMode = normalizeSelectionMatchMode(values[SELECTION_MATCH_MODE_KEY]);
  if (values[SELECTION_MATCH_MODE_KEY] !== matchMode) {
    patch[SELECTION_MATCH_MODE_KEY] = matchMode;
  }

  if (Object.keys(patch).length > 0) {
    await chrome.storage.local.set(patch);
  }
}

// Fix 1.1 (BUG-SA-001, BUG-LG-001, BUG-AS-001): Removed first onStartup listener that
// hardcoded INACTIVE_LIGHT (ignored dark theme) and raced with the theme-aware listener below.

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === chrome.runtime.OnInstalledReason.INSTALL) {
    __snapQueueThemeSync(0);
    __snapApplyActionIconByState();

    // First-run onboarding is hosted on Tilda.
    chrome.tabs.create({
      url: FIRST_RUN_WELCOME_URL,
    });

    // Fix 1.2 (BUG-LG-002): Only reset trackingEnabled on first install, not on updates.
    // Previously this line was OUTSIDE all if/else branches and ran on every update,
    // silently wiping the user's activation state after each extension update.
    // Auto-enable on first install so the user can start selecting immediately
    // without opening the popup. autoEnable=true keeps it on across browser restarts.
    chrome.storage.local.set({
      trackingEnabled: true,
      autoEnable: true,
      mouseButton: "left",
      activationModifier: "alt",
      safeMode: true,
      [DEFAULT_SELECTION_ACTION_KEY]: "open_tabs",
      [OPEN_SPEED_MODE_KEY]: "fast",
      [SELECTION_MATCH_MODE_KEY]: "strict",
      [SETUP_COMPLETED_KEY]: true,
      [LAST_SELECTION_COUNT_KEY]: 0,
    });

    // Ensure default Alt + left drag works immediately after fresh install
    // on already open tabs without requiring manual page refresh.
    injectIntoExistingTabsOnUpdate().catch((err) => {
      console.debug("background. install tab inject err", err);
    });

  } else if (details.reason === chrome.runtime.OnInstalledReason.UPDATE) {
    // Fix (UF-2026-03-06): Do not reload user tabs on update.
    // Mass reload is disruptive and was reported as "all tabs refreshed" behavior.
    // UF-2026-03-08: Re-inject runtime scripts/CSS into existing tabs without reload.
    injectIntoExistingTabsOnUpdate().catch((err) => {
      console.debug("background. injectIntoExistingTabsOnUpdate err", err);
    });
    ensureSelectionDefaultsAfterUpdate().catch((err) => {
      console.debug("background. ensureSelectionDefaultsAfterUpdate err", err);
    });
    // Notify existing users about behavioral changes in this update.
    chrome.action.setBadgeText({ text: "!" });
    chrome.action.setBadgeBackgroundColor({ color: "#E67E22" });
    chrome.storage.local.set({ pendingUpdateNotice: true });
  }
  // No action needed for CHROME_UPDATE or SHARED_MODULE_UPDATE.
});

function canInjectToUrl(url) {
  if (!url || typeof url !== "string") return false;
  return /^(https?|file):\/\//i.test(url);
}

async function isContentScriptLoaded(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => Boolean(globalThis.__SNAP_LINKS_CONTENT_READY__),
    });
    return Boolean(result?.[0]?.result);
  } catch {
    return false;
  }
}

async function injectIntoExistingTabsOnUpdate() {
  const tabs = await chrome.tabs.query({});

  for (const tab of tabs) {
    const tabId = tab?.id;
    if (!tabId || !canInjectToUrl(tab.url)) continue;

    try {
      const loaded = await isContentScriptLoaded(tabId);
      if (loaded) continue;

      await chrome.scripting.insertCSS({
        target: { tabId, allFrames: true },
        files: ["modal-styles.css"],
      });

      await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        files: ["selection-utils.js", "interaction-utils.js", "content.js"],
      });
    } catch (err) {
      // Skip pages where Chrome blocks script injection or frame access.
      console.debug("background. tab re-inject skipped", tabId, err?.message || err);
    }
  }
}

const UNINSTALL_URL =
  "https://docs.google.com/forms/d/e/1FAIpQLSdeVB-nrC2NFcEXBT_0eCbzpATeV1QOre6Id4eeiNIbv2GhBg/viewform?usp=sharing&ouid=101765204489637828509";
chrome.runtime.setUninstallURL(UNINSTALL_URL);

// --- Theme-aware icon ---
// MV3 service workers have no window/matchMedia; current color scheme is provided by content/popup.
let __snapIsDarkTheme = false;
let __snapThemeSyncTimer = null;

async function __snapApplyActionIconByState() {
  try {
    const data = await chrome.storage.local.get("trackingEnabled");
    const isEnabled = data.trackingEnabled ?? false;

    if (isEnabled) {
      chrome.action.setIcon({ path: SnapIcons.ACTIVE });
    } else {
      chrome.action.setIcon({
        path: SnapIcons.getInactiveIcon(__snapIsDarkTheme),
      });
    }
  } catch (err) {
    console.debug("background. __snapApplyActionIconByState. err", err);
  }
}

async function __snapRequestThemeFromActiveTab() {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tabId = tabs && tabs[0] && tabs[0].id;
    if (!tabId) return;

    const resp = await chrome.tabs
      .sendMessage(tabId, { action: "getColorScheme" })
      .catch(() => null);

    if (resp && typeof resp.isDark === "boolean") {
      __snapIsDarkTheme = resp.isDark;
      await __snapApplyActionIconByState();
    }
  } catch (err) {
    console.debug("background. __snapRequestThemeFromActiveTab. err", err);
  }
}

function __snapQueueThemeSync(delayMs = 120) {
  try {
    if (__snapThemeSyncTimer) {
      clearTimeout(__snapThemeSyncTimer);
    }
    __snapThemeSyncTimer = setTimeout(() => {
      __snapThemeSyncTimer = null;
      __snapRequestThemeFromActiveTab();
    }, delayMs);
  } catch (err) {
    console.debug("background. __snapQueueThemeSync. err", err);
  }
}

// Fix 1.1: Single theme-aware onStartup listener (the old non-theme-aware one is removed above).
async function syncTrackingStateOnStartup() {
  const data = await chrome.storage.local.get(["autoEnable"]);
  await chrome.storage.local.set({
    trackingEnabled: data.autoEnable === true,
  });
}

chrome.runtime.onStartup.addListener(function () {
  syncTrackingStateOnStartup()
    .catch((err) => {
      console.debug("background. syncTrackingStateOnStartup err", err);
    })
    .finally(() => {
      __snapQueueThemeSync(0);
    });
});

chrome.tabs.onActivated.addListener(() => {
  __snapQueueThemeSync();
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo?.status === "complete") {
    __snapQueueThemeSync();
  }
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  __snapQueueThemeSync();
});

// Keep icon in sync when trackingEnabled changes in storage.
chrome.storage.onChanged.addListener(function (changes, areaName) {
  try {
    if (areaName !== "local") return;
    if (changes.trackingEnabled) {
      __snapApplyActionIconByState();
    }
  } catch (err) {
    console.debug("background. storage.onChanged err", err);
  }
});

function getActionToastLabel(action) {
  switch (normalizeSelectionAction(action)) {
    case "open_windows":
      return "Action: New windows";
    case "open_window_with_tabs":
      return "Action: One window + tabs";
    default:
      return "Action: New tabs";
  }
}

async function __snapShowActionToast(action) {
  const label = getActionToastLabel(action);
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs?.[0];
  if (!tab?.id || !canInjectToUrl(tab.url)) return;
  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: (toastLabel) => {
      const TOAST_ID = "snap-action-toast";
      const STYLE_ID = "snap-action-toast-style";
      document.getElementById(TOAST_ID)?.remove();

      if (!document.getElementById(STYLE_ID)) {
        const style = document.createElement("style");
        style.id = STYLE_ID;
        style.textContent = `
          #${TOAST_ID} {
            position: fixed;
            top: 44px;
            right: 104px;
            background: #fff;
            color: #111;
            font: 600 13px/1.4 -apple-system, sans-serif;
            padding: 6px 14px;
            border-radius: 8px;
            box-shadow: 0 2px 12px rgba(0,0,0,0.18);
            z-index: 2147483647;
            white-space: nowrap;
            opacity: 0;
            transition: opacity 0.15s ease;
            pointer-events: none;
          }
          #${TOAST_ID}::before {
            content: '';
            position: absolute;
            top: -7px;
            right: 24px;
            border: 7px solid transparent;
            border-top: 0;
            border-bottom: 7px solid #fff;
          }
        `;
        document.documentElement.appendChild(style);
      }

      const toast = document.createElement("div");
      toast.id = TOAST_ID;
      toast.textContent = toastLabel;
      document.documentElement.appendChild(toast);

      requestAnimationFrame(() => {
        toast.style.opacity = "1";
        setTimeout(() => {
          toast.style.transition = "opacity 0.3s ease";
          toast.style.opacity = "0";
          setTimeout(() => toast.remove(), 320);
        }, 1600);
      });
    },
    args: [label],
  }).catch((err) => {
    console.debug("background. __snapShowActionToast err", err);
  });
}

chrome.commands.onCommand.addListener((command) => {
  if (command !== ACTION_CYCLE_COMMAND) return;

  chrome.storage.local
    .get([DEFAULT_SELECTION_ACTION_KEY])
    .then((values) => {
      const nextAction = getNextSelectionAction(values[DEFAULT_SELECTION_ACTION_KEY]);
      return chrome.storage.local
        .set({ [DEFAULT_SELECTION_ACTION_KEY]: nextAction })
        .then(() => __snapShowActionToast(nextAction));
    })
    .catch((err) => {
      console.debug("background. commands.onCommand err", err);
    });
});

// Fix 1.3 (BUG-SA-003, BUG-AS-002, BUG-AR-003, BUG-AR-004): Single unified onMessage listener.
// Previously there were two listeners: the first handled tab/window actions but never called
// sendResponse for them; the second always called sendResponse for every message including
// those already handled by the first, causing double-response errors on every message.
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Fix (BUG-SEC-002): Reject messages not coming from this extension.
  if (sender?.id && sender.id !== chrome.runtime.id) {
    sendResponse({ error: "unauthorized sender" });
    return false;
  }

  const links_arr = request.lnk_arr;
  switch (request.action) {
    case "newTabs":
      if (sender?.id !== chrome.runtime.id) {
        sendResponse({ error: "unauthorized sender" });
        return false;
      }
      {
        const links = sanitizeLinks(links_arr);
        if (links.length === 0) {
          sendResponse({ error: "no links" });
          return false;
        }
        chrome.storage.local
          .get([OPEN_SPEED_MODE_KEY])
          .then((values) => {
            const delay = getDelayForCount(values[OPEN_SPEED_MODE_KEY], links.length);
            openLinksInTabs(links, delay, sender?.tab?.windowId ?? null);
            sendResponse({ success: true });
          })
          .catch((err) => {
            sendResponse({ error: String(err?.message || err) });
          });
        return true;
      }

    case "newWindows":
      if (sender?.id !== chrome.runtime.id) {
        sendResponse({ error: "unauthorized sender" });
        return false;
      }
      {
        const links = sanitizeLinks(links_arr);
        if (links.length === 0) {
          sendResponse({ error: "no links" });
          return false;
        }
        chrome.storage.local
          .get([OPEN_SPEED_MODE_KEY])
          .then((values) => {
            const delay = getDelayForCount(values[OPEN_SPEED_MODE_KEY], links.length);
            openLinksInWindows(links, delay);
            sendResponse({ success: true });
          })
          .catch((err) => {
            sendResponse({ error: String(err?.message || err) });
          });
        return true;
      }

    case "runSelectionAction":
      {
        if (sender?.id !== chrome.runtime.id) {
          sendResponse({ error: "unauthorized sender" });
          return false;
        }
        const links = sanitizeLinks(links_arr);
        if (links.length === 0) {
          sendResponse({ error: "no links" });
          return false;
        }
        const targetWindowId = sender?.tab?.windowId;
        chrome.storage.local
          .get([OPEN_SPEED_MODE_KEY])
          .then((values) => {
            const delay = getDelayForCount(values[OPEN_SPEED_MODE_KEY], links.length);
            return runSelectionAction(request.mode, links, delay, { targetWindowId });
          })
          .then(() => {
            sendResponse({ success: true });
          })
          .catch((err) => {
            sendResponse({ error: String(err?.message || err) });
          });
        return true;
      }

    case "setTrackingState":
      if (sender?.id !== chrome.runtime.id) {
        sendResponse({ error: "unauthorized sender" });
        return false;
      }
      chrome.storage.local.set({ trackingEnabled: request.enabled });
      sendResponse({ success: true });
      return false;

    case "setMouseButton":
      if (sender?.id !== chrome.runtime.id) {
        sendResponse({ error: "unauthorized sender" });
        return false;
      }
      chrome.storage.local.set({ mouseButton: request.button });
      sendResponse({ success: true });
      return false;

    // Fix 1.3: colorSchemeChanged merged from the old second listener.
    case "colorSchemeChanged":
      __snapIsDarkTheme = !!request.isDark;
      __snapApplyActionIconByState();
      sendResponse({ success: true });
      return false;

    case "clearUpdateBadge":
      chrome.action.setBadgeText({ text: "" });
      sendResponse({ success: true });
      return false;

    default:
      sendResponse({ success: true });
      return false;
  }
});


