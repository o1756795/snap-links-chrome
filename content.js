const state = {
  // Lasso selection
  lasso: {
    isSelecting: false,
    pending: false,
    startX: 0,
    startY: 0,
    pendingStartX: 0,
    pendingStartY: 0,
    div: null,
    counter: null,
  },

  // Selected links data
  // Fix 3.6 (BUG-LG-012): Removed dead property 'all' вЂ” it was set but never read.
  selection: {
    arr: [],
    unique: [],
    previous: new Set(),
    highlighted: null,
  },

  // Scroll during lasso
  scroll: {
    interval: null,
    lastX: 0,
    lastY: 0,
  },

  // Extension configuration
  config: {
    isEnabled: false,
    mouseButton: 0,
    activationModifier: "alt",
    defaultSelectionAction: "open_tabs",
    selectionMatchMode: "strict",
    dragThreshold: 8,
  },

  // Internal flags
  flags: {
    windowHasFocus: true,
    listenersAttached: false,
  },

  // DOM references
  ui: {
    overlay: null,
    modal: null,
  },

  // rAF throttle and link cache
  cache: {
    links: null,
    rafPending: false,
    lastMouseEvent: null,
    scrollHandler: null,
    domObserver: null,
    domRebuildPending: false,
  },

  // Outline style constants
  OUTLINE_STYLE: "yellow solid 5px",
};

const SUCCESSFUL_SELECTION_COUNT_KEY = "successfulSelectionCount";
const LEGACY_SUCCESS_KEY = "hasSuccessfulSelection";
const DEFAULT_SELECTION_ACTION_KEY = "defaultSelectionAction";
const SELECTION_MATCH_MODE_KEY = "selectionMatchMode";
const LAST_SELECTION_COUNT_KEY = "lastSelectionCount";
const BULK_ACTION_CONFIRM_THRESHOLD = 25;

function isExtensionContextValid() {
  try {
    return Boolean(chrome?.runtime?.id);
  } catch {
    return false;
  }
}

function isContextInvalidatedError(errLike) {
  const message = String(errLike?.message || errLike || "").toLowerCase();
  return message.includes("extension context invalidated");
}

function openLinksFallbackInPage(links) {
  let openedCount = 0;
  links.forEach((link) => {
    try {
      const opened = window.open(link, "_blank", "noopener,noreferrer");
      if (opened) openedCount += 1;
    } catch (err) {
      console.debug("content. fallback open err", err);
    }
  });
  return openedCount;
}

function sendRuntimeMessage(message) {
  return new Promise((resolve, reject) => {
    if (!isExtensionContextValid()) {
      reject(new Error("extension context invalidated"));
      return;
    }

    try {
      chrome.runtime.sendMessage(message, (response) => {
        const runtimeErr = chrome?.runtime?.lastError;
        if (runtimeErr) {
          reject(new Error(runtimeErr.message || String(runtimeErr)));
          return;
        }
        resolve(response || null);
      });
    } catch (err) {
      reject(err);
    }
  });
}

function normalizeSelectionAction(value) {
  const action = String(value || "").toLowerCase();
  if (action === "open_windows") return "open_windows";
  if (action === "open_window_with_tabs") return "open_window_with_tabs";
  return "open_tabs";
}

function normalizeSelectionMatchMode(value) {
  const mode = String(value || "").toLowerCase();
  if (mode === "touch") return "touch";
  return "strict";
}

function getSelectionActionLabel(action) {
  switch (normalizeSelectionAction(action)) {
    case "open_windows":
      return "open in new windows";
    case "open_window_with_tabs":
      return "open in one new window";
    default:
      return "open in new tabs";
  }
}

// Marker for update-time re-injection checks in background.js.
globalThis.__SNAP_LINKS_CONTENT_READY__ = true;

checkTrackingState();

// E2E helper (localhost only): expose runtime id for automated browser tests.
try {
  if (location.hostname === "127.0.0.1" || location.hostname === "localhost") {
    window.__SNAP_RUNTIME_ID = chrome.runtime.id;

    // E2E bridge for Playwright (localhost only).
    // Allows tests to set/get extension storage without knowing extension id.
    window.addEventListener("message", (event) => {
      if (event.source !== window && event.source !== null) return;
      const data = event.data || {};
      const reqId = data.__snapE2ERequest;
      if (!reqId) return;

      function respond(ok, result, error) {
        try {
          window.postMessage(
            {
              __snapE2EResponse: reqId,
              ok,
              result: result ?? null,
              error: error ? String(error) : null,
            },
            "*",
          );
        } catch (err) {
          console.debug("content. e2e bridge respond err", err);
        }
      }

      const type = String(data.type || "");
      if (type === "ping") {
        respond(true, { ready: true });
        return;
      }
      if (type === "getRuntimeId") {
        respond(true, { runtimeId: chrome.runtime.id });
        return;
      }
      if (type === "setStorage") {
        chrome.storage.local
          .set(data.payload || {})
          .then(() => respond(true, { saved: true }))
          .catch((err) => respond(false, null, err?.message || err));
        return;
      }
      if (type === "getStorage") {
        chrome.storage.local
          .get(data.payload || null)
          .then((values) => respond(true, values))
          .catch((err) => respond(false, null, err?.message || err));
        return;
      }

      respond(false, null, `Unknown E2E bridge type: ${type}`);
    });
  }
} catch (err) {
  console.debug("content. e2e runtime id export err", err);
}

// State checking
function checkTrackingState() {
  if (!isExtensionContextValid()) return;
  try {
    // Fix 2.1 (BUG-LG-010, BUG-AS-003, BUG-EC-001, BUG-SA-004): Also fetch mouseButton here
    // so handleMouseDown can read it synchronously вЂ” eliminating the async gap that caused
    // isSelecting to get permanently stuck at true when mouseup fired before .then() resolved.
    chrome.storage.local
      .get([
        "trackingEnabled",
        "mouseButton",
        "activationModifier",
        "safeMode",
        DEFAULT_SELECTION_ACTION_KEY,
        SELECTION_MATCH_MODE_KEY,
      ])
      .then((result) => {
      state.config.isEnabled = result.trackingEnabled ?? false;

      // Cache mouseButton synchronously for use in handleMouseDown.
      if (result.mouseButton === "left") state.config.mouseButton = 0;
      else if (result.mouseButton === "middle") state.config.mouseButton = 1;
      else if (result.mouseButton === "right") state.config.mouseButton = 2;
      else state.config.mouseButton = 0; // default: left

      // UF-2026-03-04: configurable modifier for lasso activation.
      // Backward compatibility: old safeMode=true maps to "alt".
      const storedModifier = (result.activationModifier || "").toLowerCase();
      if (
        storedModifier === "none" ||
        storedModifier === "alt" ||
        storedModifier === "shift" ||
        storedModifier === "ctrl"
      ) {
        state.config.activationModifier = storedModifier;
      } else if (result.safeMode === true) {
        state.config.activationModifier = "alt";
      } else if (result.safeMode === false) {
        state.config.activationModifier = "none";
      } else {
        state.config.activationModifier = "alt";
      }

      state.config.defaultSelectionAction = normalizeSelectionAction(
        result[DEFAULT_SELECTION_ACTION_KEY],
      );
      state.config.selectionMatchMode = normalizeSelectionMatchMode(
        result[SELECTION_MATCH_MODE_KEY],
      );

      document.getSelection().removeAllRanges();
      updateListeners();
      });
  } catch (err) {
    console.debug("checkTrackingState:", err?.message || err);
  }
}

function updateListeners() {
  if (state.config.isEnabled) {
    state.lasso.isSelecting = false;
    state.lasso.pending = false;
    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("auxclick", handleMouseDown);

    if (!state.flags.listenersAttached) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      state.flags.listenersAttached = true;
    }
  } else {
    state.lasso.isSelecting = false;
    state.lasso.pending = false;
    document.removeEventListener("mousedown", handleMouseDown);
    document.removeEventListener("auxclick", handleMouseDown);

    // Fix 2.3 (BUG-EC-011, BUG-AS-004): On disable, also remove mousemove/mouseup listeners
    // and clean up any active lasso. Previously these were never removed, leaving the lasso
    // frozen on screen and auto-scroll running indefinitely after disabling mid-drag.
    if (state.flags.listenersAttached) {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      state.flags.listenersAttached = false;
    }
    removeLassoUI();
    cleanupLassoState();
    stopScroll();
  }
}

// Check if this is a form element
function isFormElement(element) {
  const formTags = ["INPUT", "TEXTAREA", "SELECT", "BUTTON"];
  return formTags.includes(element.tagName) || element.isContentEditable;
}

function createLasso() {
  // Fix 2.2 (BUG-EC-008): Guard against null document.body on XML/SVG pages.
  if (!document.body) return;

  state.lasso.div = document.createElement("div");
  state.lasso.div.className = "snap-lasso";
  state.lasso.div.style.left = "10px";
  state.lasso.div.style.top = "10px";

  document.body.appendChild(state.lasso.div);
}

// Create counter element
function createCounter() {
  // Fix 2.2 (BUG-EC-008): Guard against null document.body on XML/SVG pages.
  if (!document.body) return;
  if (state.lasso.counter) return; // Prevent duplicates

  state.lasso.counter = document.createElement("div");
  state.lasso.counter.className = "snap-cursor-counter";
  // Fix 3.5 (BUG-AR-013): Initialize counter to "0", not "10".
  state.lasso.counter.textContent = "0";

  document.body.appendChild(state.lasso.counter);
}

// Build a cache of all link positions (absolute coordinates).
// Called once at mousedown to avoid repeated getBoundingClientRect() calls during mousemove.
function buildLinksCache() {
  const allLinks = document.querySelectorAll("a");
  return Array.from(allLinks)
    .map((link) => {
      const href = link.href ? link.href.trim() : "";
      if (!SnapSelectionUtils.isHttpUrl(href)) return null;

      // Fix (UF-2026-03-01): Use robust bounds extraction with descendants fallback.
      // Some sites render clickable anchors where the anchor itself has no useful rect.
      const rect = SnapSelectionUtils.getElementSelectionBounds(link);
      if (!rect) return null;

      return {
        el: link,
        href,
        // Store ABSOLUTE positions (viewport + scroll offset) so they don't change with scroll.
        left: rect.left + window.scrollX,
        right: rect.right + window.scrollX,
        top: rect.top + window.scrollY,
        bottom: rect.bottom + window.scrollY,
      };
    })
    .filter(Boolean);
}

function scheduleLinksCacheRebuild() {
  if (state.cache.domRebuildPending) return;
  state.cache.domRebuildPending = true;
  requestAnimationFrame(() => {
    state.cache.domRebuildPending = false;
    if (!state.lasso.isSelecting) return;
    state.cache.links = buildLinksCache();
  });
}

function setupSelectionObservers() {
  if (state.cache.domObserver) {
    state.cache.domObserver.disconnect();
    state.cache.domObserver = null;
  }

  if (!document.body || typeof MutationObserver === "undefined") return;

  // Fix (UF-2026-03-01): Keep link cache fresh on dynamic pages (YouTube, docs, SPAs).
  state.cache.domObserver = new MutationObserver(() => {
    if (state.lasso.isSelecting) {
      scheduleLinksCacheRebuild();
    }
  });

  state.cache.domObserver.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["href", "style", "class"],
  });
}

// Reset rAF throttle state and link position cache.
// Called from handleMouseUp and blur handler to prevent stale state.
function cleanupLassoState() {
  state.cache.rafPending = false;
  state.cache.lastMouseEvent = null;
  state.cache.links = null;
  if (state.cache.scrollHandler) {
    window.removeEventListener("scroll", state.cache.scrollHandler);
    state.cache.scrollHandler = null;
  }
  if (state.cache.domObserver) {
    state.cache.domObserver.disconnect();
    state.cache.domObserver = null;
  }
  state.cache.domRebuildPending = false;
}

// Remove lasso div and counter element from DOM.
// Called from handleMouseUp, handleMouseDown (button mismatch), and blur handler.
function removeLassoUI() {
  if (state.lasso.div && document.body && document.body.contains(state.lasso.div)) {
    try {
      document.body.removeChild(state.lasso.div);
    } catch (err) {
      console.debug("removeLassoUI: lasso remove err", err);
    }
    state.lasso.div = null;
  }
  if (state.lasso.counter) {
    state.lasso.counter.remove();
    state.lasso.counter = null;
  }
}

function clearNativeSelection() {
  const selection = document.getSelection();
  if (selection.rangeCount > 0) {
    selection.removeAllRanges();
  }
}

function handleMouseDown(e) {
  if (!document.body) return; // Fix (BUG-EH-005): guard body access on non-HTML docs.
  if (isFormElement(e.target)) return;

  if (document.hidden) return;
  // After popup auto-close, blur/focus timing may lag one click behind.
  // Allow the first trusted mousedown when the document is already focused.
  if (!state.flags.windowHasFocus) {
    if (typeof document.hasFocus === "function" && document.hasFocus()) {
      state.flags.windowHasFocus = true;
    } else {
      return;
    }
  }

  if (state.lasso.isSelecting) return;
  if (state.lasso.pending) return;

  if (
    !SnapInteractionUtils.isModifierSatisfied(
      state.config.activationModifier,
      e,
    )
  ) {
    return;
  }

  // Fix 2.1 (BUG-LG-010): Read mouseButton synchronously from cached state.config.mouseButton.
  // Previously, chrome.storage.local.get("mouseButton").then(...) created an async gap:
  // if mouseup fired before .then() resolved, mouseup saw isSelecting=false and returned early,
  // then .then() ran and set isSelecting=true with no mouseup to ever clear it.
  // Now mouseButton is cached in checkTrackingState() and read here without any async call.
  if (e.button !== undefined && e.button !== state.config.mouseButton) {
    state.lasso.isSelecting = false;
    removeLassoUI();
    return;
  }

  // Fix (UF-2026-03-03): Defer lasso start until drag threshold is passed.
  state.lasso.pending = true;
  state.lasso.pendingStartX = e.pageX;
  state.lasso.pendingStartY = e.pageY;
}

// Mousemove handler with rAF throttle (replaces per-frame querySelectorAll).
function handleMouseMove(e) {
  if (state.lasso.pending) {
    const shouldStart = SnapInteractionUtils.shouldStartLassoGesture(
      state.config.activationModifier,
      state.config.mouseButton,
      state.lasso.pendingStartX,
      state.lasso.pendingStartY,
      e.pageX,
      e.pageY,
      state.config.dragThreshold,
      e,
    );

    if (!shouldStart) {
      const buttonPressed = SnapInteractionUtils.isButtonPressed(
        state.config.mouseButton,
        e.buttons,
      );
      const modifierSatisfied = SnapInteractionUtils.isModifierSatisfied(
        state.config.activationModifier,
        e,
      );

      if (!buttonPressed || !modifierSatisfied) {
        state.lasso.pending = false;
      }
      return;
    }

    // UF-2026-03-11: only clear native text selection once the lasso actually starts.
    // This keeps system Copy/context menu behavior intact for right-click interactions
    // that never cross the drag threshold.
    clearNativeSelection();

    state.lasso.pending = false;
    state.lasso.isSelecting = true;
    state.lasso.startX = state.lasso.pendingStartX;
    state.lasso.startY = state.lasso.pendingStartY;
    state.selection.arr = [];
    state.selection.unique = [];
    state.selection.previous = new Set();
    createLasso();
    createCounter();

    // Build link position cache once at lasso start.
    state.cache.links = buildLinksCache();
    setupSelectionObservers();
    // Rebuild cache on scroll (positions change when page scrolls during lasso).
    state.cache.scrollHandler = function () {
      if (state.lasso.isSelecting) {
        state.cache.links = buildLinksCache();
      }
    };
    window.addEventListener("scroll", state.cache.scrollHandler);
  }

  if (!state.lasso.isSelecting) return;
  if (!state.lasso.div) return;

  // Fix (BUG-EC-009): If mouse button was released outside the browser window,
  // mouseup may be missed. When cursor returns and buttons===0, finalize selection.
  if (e.buttons === 0) {
    handleMouseUp();
    return;
  }

  state.cache.lastMouseEvent = e;
  e.preventDefault();

  // Update lasso visual position immediately (cheap operation).
  state.lasso.div.style.left = Math.min(state.lasso.startX, e.pageX) + "px";
  state.lasso.div.style.width = Math.abs(e.pageX - state.lasso.startX) + "px";
  state.lasso.div.style.top = Math.min(state.lasso.startY, e.pageY) + "px";
  state.lasso.div.style.height = Math.abs(e.pageY - state.lasso.startY) + "px";

  if (!state.cache.rafPending) {
    state.cache.rafPending = true;
    requestAnimationFrame(() => {
      state.cache.rafPending = false;
      if (state.cache.lastMouseEvent && state.lasso.isSelecting) {
        processMouseMove(state.cache.lastMouseEvent);
      }
    });
  }

  // Handle auto-scroll (must happen on every event for responsiveness).
  calculateScroll(e.clientX, e.clientY);
}

// Heavy link-matching logic, called via rAF (max once per frame).
function processMouseMove(e) {
  if (!state.cache.links) return;

  const lassoLeft = Math.min(state.lasso.startX, e.pageX);
  const lassoRight = Math.max(state.lasso.startX, e.pageX);
  const lassoTop = Math.min(state.lasso.startY, e.pageY);
  const lassoBottom = Math.max(state.lasso.startY, e.pageY);

  // Fix 3.4 (BUG-SA-019): Use === instead of loose == for coordinate comparison.
  let shiftCntLeft = lassoLeft === e.pageX ? -20 : 40;
  let shiftCntTop = lassoTop === e.pageY ? -20 : 40;

  const currentSelectedLinks = new Set();
  const lassoRect = {
    left: lassoLeft,
    right: lassoRight,
    top: lassoTop,
    bottom: lassoBottom,
  };

  // Use cached positions - NO getBoundingClientRect() calls.
  const shouldSelectLink = state.config.selectionMatchMode === "touch"
    ? (linkRect) => SnapSelectionUtils.intersectsRect(linkRect, lassoRect)
    : (linkRect) => SnapSelectionUtils.containsRect(lassoRect, linkRect);

  state.cache.links.forEach((cached) => {
    // Fix (BUG-EC-010): skip detached nodes to avoid ghost URLs in selection.
    if (!cached.el || !cached.el.isConnected) return;
    if (shouldSelectLink(cached)) {
      currentSelectedLinks.add(cached.el);
    }
  });

  // Add outline to newly selected links.
  currentSelectedLinks.forEach((link) => {
    if (!state.selection.previous.has(link)) {
      link.style.outline = state.OUTLINE_STYLE;
      state.selection.arr.push(link.href);
    }
  });

  // Remove outline from links that left the selection.
  state.selection.previous.forEach((link) => {
    if (!currentSelectedLinks.has(link)) {
      link.style.outline = "";
      // Fix 3.1 (BUG-EC-007, BUG-LG-011): Remove only the FIRST occurrence of this href.
      // Previously filter() removed ALL occurrences, so deselecting one link with a duplicate
      // href would remove the other identical link from the selection too.
      const idx = state.selection.arr.indexOf(link.href);
      if (idx !== -1) {
        state.selection.arr.splice(idx, 1);
      }
    }
  });

  // Ensure all currently selected links have outline.
  currentSelectedLinks.forEach((link) => {
    link.style.outline = state.OUTLINE_STYLE;
  });

  state.selection.previous = new Set(currentSelectedLinks);
  state.selection.unique = [...new Set(state.selection.arr)];

  if (state.lasso.counter) {
    state.lasso.counter.textContent = state.selection.unique.length;
    state.lasso.counter.style.left = e.clientX - shiftCntLeft + "px";
    state.lasso.counter.style.top = e.clientY - shiftCntTop + "px";
  }
}

// Global mouseup handler
function handleMouseUp() {
  if (state.lasso.pending) {
    state.lasso.pending = false;
    return;
  }

  // Always remove lasso UI immediately on mouseup.
  removeLassoUI();

  if (!state.lasso.isSelecting) return;

  state.lasso.isSelecting = false;

  // Fix (BUG-EC-010): remove URLs for links detached before mouseup.
  state.selection.previous.forEach((link) => {
    if (!link || !link.isConnected) {
      const idx = state.selection.arr.indexOf(link?.href);
      if (idx !== -1) {
        state.selection.arr.splice(idx, 1);
      }
    }
  });
  state.selection.unique = [...new Set(state.selection.arr)];

  cleanupLassoState();

  try {
    if (state.selection.unique.length >= 1) {
      recordSuccessfulSelection(state.selection.unique.length);
      executeDefaultSelectionAction(state.selection.unique);
    }
  } finally {
    resetLinks();
  }

  // Safety cleanup: remove lasso UI again in case it was recreated.
  removeLassoUI();
  stopScroll();
}

// Calculate scroll velocities based on cursor position.
function calculateScroll(clientX, clientY) {
  const scrollZone = 80;
  const windowHeight = window.innerHeight;
  const windowWidth = window.innerWidth;

  state.scroll.lastX = 0;
  state.scroll.lastY = 0;

  if (clientY > windowHeight - scrollZone) {
    const distanceFromBottom = windowHeight - clientY;
    state.scroll.lastY = ((scrollZone - distanceFromBottom) / scrollZone) * 5;
  } else if (clientY < scrollZone) {
    const distanceFromTop = clientY;
    state.scroll.lastY = (-(scrollZone - distanceFromTop) / scrollZone) * 5;
  }

  if (clientX > windowWidth - scrollZone) {
    const distanceFromRight = windowWidth - clientX;
    state.scroll.lastX = ((scrollZone - distanceFromRight) / scrollZone) * 5;
  } else if (clientX < scrollZone) {
    const distanceFromLeft = clientX;
    state.scroll.lastX = (-(scrollZone - distanceFromLeft) / scrollZone) * 5;
  }

  if (state.scroll.lastX !== 0 || state.scroll.lastY !== 0) {
    startScroll();
  } else {
    stopScroll();
  }
}

// Start continuous scrolling.
function startScroll() {
  if (state.scroll.interval) return;

  state.scroll.interval = setInterval(() => {
    if (state.scroll.lastX !== 0 || state.scroll.lastY !== 0) {
      window.scrollBy(state.scroll.lastX, state.scroll.lastY);
    }
  }, 16); // ~60fps
}

// Stop continuous scrolling.
function stopScroll() {
  if (state.scroll.interval) {
    clearInterval(state.scroll.interval);
    state.scroll.interval = null;
  }
}

function resetLinks() {
  state.selection.highlighted = document.querySelectorAll('[style*="outline"]');

  const outlineVariants = [
    "yellow solid 5px",
    "solid yellow 5px",
    "5px solid yellow",
    "5px yellow solid",
  ];

  state.selection.highlighted.forEach((hl) => {
    if (outlineVariants.includes(hl.style.outline)) {
      hl.style.outline = "";
    }
  });

  document.getSelection().removeAllRanges();

  if (document.body && document.body.contains(state.ui.overlay)) {
    state.ui.overlay.remove();
  }

  // Fix 3.6 (BUG-LG-012): Removed state.selection.all вЂ” it was a dead variable never read.
  state.selection.arr = [];
  state.selection.unique = [];
  state.lasso.startX = state.lasso.startY = null;
}

function recordSuccessfulSelection(selectionCount) {
  if (!isExtensionContextValid()) return;
  try {
    chrome.storage.local
      .get([SUCCESSFUL_SELECTION_COUNT_KEY, LEGACY_SUCCESS_KEY])
      .then((result) => {
        const rawCount = Number(result?.[SUCCESSFUL_SELECTION_COUNT_KEY]);
        const currentCount = Number.isFinite(rawCount) && rawCount >= 0
          ? rawCount
          : result?.[LEGACY_SUCCESS_KEY] === true
            ? 1
            : 0;

        return chrome.storage.local.set({
          [SUCCESSFUL_SELECTION_COUNT_KEY]: currentCount + 1,
          [LEGACY_SUCCESS_KEY]: true,
          [LAST_SELECTION_COUNT_KEY]: selectionCount,
        });
      })
      .catch((err) => {
        console.debug("content. recordSuccessfulSelection err", err);
      });
  } catch (err) {
    console.debug("content. recordSuccessfulSelection sync err", err);
  }
}

function showPageToast(message) {
  const TOAST_ID = "snap-action-toast";
  const STYLE_ID = "snap-action-toast-style";
  document.getElementById(TOAST_ID)?.remove();
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      #${TOAST_ID} {
        position: fixed;
        top: 56px;
        right: 16px;
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
        right: 18px;
        border: 7px solid transparent;
        border-top: 0;
        border-bottom: 7px solid #fff;
      }
    `;
    document.documentElement.appendChild(style);
  }
  const toast = document.createElement("div");
  toast.id = TOAST_ID;
  toast.textContent = message;
  document.documentElement.appendChild(toast);
  requestAnimationFrame(() => {
    toast.style.opacity = "1";
    setTimeout(() => {
      toast.style.transition = "opacity 0.3s ease";
      toast.style.opacity = "0";
      setTimeout(() => toast.remove(), 320);
    }, 1600);
  });
}

function executeDefaultSelectionAction(links) {
  if (!Array.isArray(links) || links.length === 0) return;

  const actionMode = normalizeSelectionAction(state.config.defaultSelectionAction);
  if (links.length >= BULK_ACTION_CONFIRM_THRESHOLD) {
    const actionLabel = getSelectionActionLabel(actionMode);
    const confirmed = window.confirm(
      `You selected ${links.length} links.\nContinue and ${actionLabel}?`,
    );
    if (!confirmed) {
      return;
    }
  }

  const linkCount = links.length;
  if (!isExtensionContextValid()) {
    const openedCount = openLinksFallbackInPage(links);
    if (openedCount > 0) {
      showPageToast(`${openedCount} link${openedCount === 1 ? "" : "s"} opened`);
    }
    return;
  }

  sendRuntimeMessage({
    action: "runSelectionAction",
    mode: actionMode,
    lnk_arr: links,
  })
    .then((response) => {
      if (response?.error) {
        console.debug("content. runSelectionAction error", response.error);
      } else {
        showPageToast(`${linkCount} link${linkCount === 1 ? "" : "s"} opened`);
      }
    })
    .catch((err) => {
      if (isContextInvalidatedError(err)) {
        const openedCount = openLinksFallbackInPage(links);
        if (openedCount > 0) {
          showPageToast(`${openedCount} link${openedCount === 1 ? "" : "s"} opened`);
          return;
        }
      }
      console.debug("content. runSelectionAction send err", err);
    });
}

try {
  if (isExtensionContextValid()) {
    chrome.storage.onChanged.addListener((changes) => {
      if (
        changes.trackingEnabled ||
        changes.mouseButton ||
        changes.safeMode ||
        changes.activationModifier ||
        changes.defaultSelectionAction ||
        changes.selectionMatchMode
      ) {
        checkTrackingState();
      }
    });
  }
} catch (err) {
  console.debug("content. storage.onChanged listener setup err", err);
}

// --- Theme-aware icon ---
// Content scripts have a window context, so we can use prefers-color-scheme and notify background.
(function () {
  try {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");

    function sendColorScheme(isDark) {
      if (!isExtensionContextValid()) return;
      try {
        const promise = chrome.runtime.sendMessage({
          action: "colorSchemeChanged",
          isDark: !!isDark,
        });
        if (promise && typeof promise.catch === "function") {
          promise.catch((err) => {
            console.debug("content. colorSchemeChanged send err", err);
          });
        }
      } catch (err) {
        console.debug("content. colorSchemeChanged send err", err);
      }
    }

    // Send current scheme on load.
    sendColorScheme(mq.matches);

    // Send updates instantly when the theme changes.
    mq.addEventListener("change", function (e) {
      sendColorScheme(e.matches);
    });

    // Allow background.js to request current scheme (e.g., on service worker startup).
    if (isExtensionContextValid()) {
      chrome.runtime.onMessage.addListener(
        function (request, sender, sendResponse) {
          if (request && request.action === "getColorScheme") {
            sendResponse({ isDark: !!mq.matches });
            return true;
          }
        },
      );
    }
  } catch (err) {
    console.debug("content. prefers-color-scheme setup err", err);
  }
})();

// Listen for blur/focus to prevent lasso drawing when window is inactive.
try {
  window.addEventListener("blur", () => {
    state.flags.windowHasFocus = false;
    // Force stop lasso selection if active
    if (state.lasso.isSelecting) {
      state.lasso.isSelecting = false;
      state.lasso.pending = false;
      cleanupLassoState();
      removeLassoUI();
      stopScroll();
    }
  });

  window.addEventListener("focus", () => {
    state.flags.windowHasFocus = true;
  });
} catch (err) {
  console.debug("content. blur/focus setup err", err);
}


