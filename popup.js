const RATING_UNLOCK_SUCCESS_COUNT = 5;
const SUCCESSFUL_SELECTION_COUNT_KEY = "successfulSelectionCount";
const LEGACY_SUCCESS_KEY = "hasSuccessfulSelection";
const DEFAULT_SELECTION_ACTION_KEY = "defaultSelectionAction";
const OPEN_SPEED_MODE_KEY = "openSpeedMode";
const SELECTION_MATCH_MODE_KEY = "selectionMatchMode";
const SETUP_COMPLETED_KEY = "setupCompleted";
const ACTION_CYCLE_COMMAND = "cycle-default-selection-action";

const ACTION_ORDER = ["open_tabs", "open_windows", "open_window_with_tabs"];

const state = {
  isEnabled: false,
  mouseButton: "left",
  activationModifier: "alt",
  autoEnable: false,
  defaultSelectionAction: "open_tabs",
  openSpeedMode: "fast",
  selectionMatchMode: "strict",
  setupCompleted: true,
  successfulSelectionCount: 0,
};

const ui = {};
let storageChangeListenerAttached = false;

function normalizeMouseButton(value) {
  if (value === "middle" || value === "right") return value;
  return "left";
}

function normalizeModifier(value, safeMode) {
  const modifier = String(value || "").toLowerCase();
  if (modifier === "none" || modifier === "alt" || modifier === "shift" || modifier === "ctrl") {
    return modifier;
  }
  if (safeMode === true) return "alt";
  if (safeMode === false) return "none";
  return "alt";
}

function normalizeSelectionAction(value) {
  const action = String(value || "").toLowerCase();
  if (action === "open_windows") return "open_windows";
  if (action === "open_window_with_tabs") return "open_window_with_tabs";
  return "open_tabs";
}

function normalizeOpenSpeedMode(value) {
  const mode = String(value || "").toLowerCase();
  if (mode === "balanced" || mode === "safe") return mode;
  return "fast";
}

function normalizeSelectionMatchMode(value) {
  const mode = String(value || "").toLowerCase();
  if (mode === "touch") return "touch";
  return "strict";
}

function getSuccessfulSelectionCount(storedValues) {
  const rawCount = Number(storedValues?.[SUCCESSFUL_SELECTION_COUNT_KEY]);
  if (Number.isFinite(rawCount) && rawCount >= 0) {
    return rawCount;
  }
  return storedValues?.[LEGACY_SUCCESS_KEY] === true ? 1 : 0;
}

function getActionLabel(action) {
  switch (normalizeSelectionAction(action)) {
    case "open_windows":
      return "Open in new windows";
    case "open_window_with_tabs":
      return "Open one new window with tabs";
    default:
      return "Open in new tabs";
  }
}

function getActionVerb(action) {
  switch (normalizeSelectionAction(action)) {
    case "open_windows":
      return "open each selected link in a new browser window";
    case "open_window_with_tabs":
      return "open selected links in one new window with multiple tabs";
    default:
      return "open selected links in new background tabs";
  }
}

function getModifierLabel(modifier) {
  switch (modifier) {
    case "none":
      return "No modifier";
    case "shift":
      return "Shift";
    case "ctrl":
      return "Ctrl";
    default:
      return "Alt";
  }
}

function getMouseButtonLabel(button) {
  switch (button) {
    case "middle":
      return "middle mouse button";
    case "right":
      return "right mouse button";
    default:
      return "left mouse button";
  }
}

function getGestureText() {
  const buttonText = getMouseButtonLabel(state.mouseButton);
  if (state.activationModifier === "none") {
    return `drag with the ${buttonText}`;
  }
  return `hold ${getModifierLabel(state.activationModifier)}, then drag with the ${buttonText}`;
}

function updateRatingVisibility() {
  if (!ui.ratingBlock) return;
  const isUnlocked = state.successfulSelectionCount >= RATING_UNLOCK_SUCCESS_COUNT;
  ui.ratingBlock.classList.toggle("rating-block--hidden", !isUnlocked);
  ui.ratingBlock.classList.toggle("rating-block--muted", !isUnlocked);
  if (ui.ratingSubtitle) {
    ui.ratingSubtitle.textContent = isUnlocked
      ? "Thanks for using Snap Links."
      : `Available after ${RATING_UNLOCK_SUCCESS_COUNT} successful selections.`;
  }
}

function bold(text) {
  const el = document.createElement("strong");
  el.textContent = text;
  return el;
}

function getActionVerbParts(action) {
  switch (normalizeSelectionAction(action)) {
    case "open_windows":
      return { prefix: "open in ", highlight: "separate windows" };
    case "open_window_with_tabs":
      return { prefix: "open in ", highlight: "one new window with tabs" };
    default:
      return { prefix: "open in ", highlight: "new background tabs" };
  }
}

function buildSelectionHintNodes() {
  const modifier = state.activationModifier;
  const buttonLabel = getMouseButtonLabel(state.mouseButton);
  const { prefix, highlight } = getActionVerbParts(state.defaultSelectionAction);

  const nodes = [];

  nodes.push(document.createTextNode("On any web page, "));

  if (modifier === "none") {
    nodes.push(document.createTextNode("drag with the "));
    nodes.push(bold(buttonLabel));
  } else {
    nodes.push(document.createTextNode("hold "));
    nodes.push(bold(getModifierLabel(modifier)));
    nodes.push(document.createTextNode(", then drag with the "));
    nodes.push(bold(buttonLabel));
  }

  nodes.push(document.createTextNode(" to select links. Selected links will " + prefix));
  nodes.push(bold(highlight));
  nodes.push(document.createTextNode("."));

  return nodes;
}

function updateStatusUI() {
  if (ui.toggleButton) {
    ui.toggleButton.textContent = state.isEnabled ? "Turn off selection" : "Turn on selection";
    ui.toggleButton.style.background = state.isEnabled ? "#6a7280" : "#1f7a2f";
  }
  if (ui.selectionStatus) {
    ui.selectionStatus.textContent = state.isEnabled ? "Selection is ON" : "Selection is OFF";
    ui.selectionStatus.classList.toggle("selection-status--on", state.isEnabled);
    ui.selectionStatus.classList.toggle("selection-status--off", !state.isEnabled);
  }
  if (ui.selectionHint) {
    if (!state.setupCompleted) {
      ui.selectionHint.replaceChildren(
        document.createTextNode(
          "Choose your setup below. Saving setup will turn selection on so you can drag on the page."
        )
      );
    } else if (state.isEnabled) {
      ui.selectionHint.replaceChildren(...buildSelectionHintNodes());
    } else {
      ui.selectionHint.replaceChildren(
        document.createTextNode("Turn it on to select multiple links by dragging on the page.")
      );
    }
  }
  if (ui.defaultActionLabel) {
    if (ui.defaultActionValue) {
      ui.defaultActionValue.textContent = getActionLabel(state.defaultSelectionAction);
    } else {
      ui.defaultActionLabel.textContent = `Action: ${getActionLabel(state.defaultSelectionAction)}`;
    }
  }
}

function updateSettingsUI() {
  if (ui.activationModifierSelect) {
    ui.activationModifierSelect.value = state.activationModifier;
  }
  if (ui.autoEnableToggle) {
    ui.autoEnableToggle.checked = state.autoEnable;
  }
  if (ui.defaultSelectionActionSelect) {
    ui.defaultSelectionActionSelect.value = state.defaultSelectionAction;
  }
  if (ui.openSpeedModeSelect) {
    ui.openSpeedModeSelect.value = state.openSpeedMode;
  }
  if (ui.selectionMatchModeSelect) {
    ui.selectionMatchModeSelect.value = state.selectionMatchMode;
  }
  if (ui.mouseButtonRadios && ui.mouseButtonRadios.length) {
    ui.mouseButtonRadios.forEach((radio) => {
      radio.checked = radio.value === state.mouseButton;
    });
  }
}

function updateSetupUI() {
  const isSetupComplete = state.setupCompleted === true;
  if (ui.setupPanel) {
    ui.setupPanel.classList.toggle("setup-panel--hidden", isSetupComplete);
  }
  if (ui.settingsToggleButton) {
    ui.settingsToggleButton.style.display = isSetupComplete ? "inline-block" : "none";
  }
  if (!isSetupComplete && ui.settingsPanel) {
    ui.settingsPanel.classList.remove("settings-panel--hidden");
  }
  if (isSetupComplete && ui.setupStatus) {
    ui.setupStatus.textContent = "";
  }
}

function setSetupStatus(message) {
  if (!ui.setupStatus) return;
  ui.setupStatus.textContent = message;
}

function cycleSelectionAction() {
  const current = normalizeSelectionAction(state.defaultSelectionAction);
  const idx = ACTION_ORDER.indexOf(current);
  const next = ACTION_ORDER[(idx + 1) % ACTION_ORDER.length];
  state.defaultSelectionAction = next;
  chrome.storage.local.set({ [DEFAULT_SELECTION_ACTION_KEY]: next });
  updateStatusUI();
  updateSettingsUI();
}

function toggleSettingsPanel() {
  if (!ui.settingsPanel) return;
  const isHidden = ui.settingsPanel.classList.contains("settings-panel--hidden");
  ui.settingsPanel.classList.toggle("settings-panel--hidden", !isHidden);
}

async function applyThemeAwareActionIcon() {
  try {
    const result = await chrome.storage.local.get("trackingEnabled");
    const isEnabled = result.trackingEnabled ?? false;
    const isDark =
      window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: dark)").matches;

    if (isEnabled) {
      chrome.action.setIcon({ path: SnapIcons.ACTIVE });
    } else {
      chrome.action.setIcon({ path: SnapIcons.getInactiveIcon(isDark) });
    }

    chrome.runtime.sendMessage({
      action: "colorSchemeChanged",
      isDark: !!isDark,
    });
  } catch (err) {
    console.debug("popup. applyThemeAwareActionIcon err", err);
  }
}

async function loadCycleShortcutHint() {
  if (!chrome.commands || !chrome.commands.getAll || !ui.shortcutHint) return;
  try {
    const commands = await chrome.commands.getAll();
    const activateCmd = commands.find((cmd) => cmd.name === "_execute_action");
    const cycleCmd = commands.find((cmd) => cmd.name === ACTION_CYCLE_COMMAND);

    const nodes = [document.createTextNode("Shortcuts:")];
    if (activateCmd?.shortcut) {
      nodes.push(document.createElement("br"));
      const shortcutStrong = document.createElement("strong");
      shortcutStrong.textContent = activateCmd.shortcut;
      nodes.push(shortcutStrong);
      nodes.push(document.createTextNode(" to activate extension"));
    }
    if (cycleCmd?.shortcut) {
      nodes.push(document.createElement("br"));
      const shortcutStrong = document.createElement("strong");
      shortcutStrong.textContent = cycleCmd.shortcut;
      nodes.push(shortcutStrong);
      nodes.push(document.createTextNode(" to switch action quickly."));
    }
    if (nodes.length > 1) {
      ui.shortcutHint.replaceChildren(...nodes);
    }
  } catch (err) {
    console.debug("popup. loadCycleShortcutHint err", err);
  }
}

function bindElements() {
  ui.settingsToggleButton = document.getElementById("settingsToggleButton");
  ui.selectionStatus = document.getElementById("selectionStatus");
  ui.selectionHint = document.getElementById("selectionHint");
  ui.toggleButton = document.getElementById("toggleButton");
  ui.defaultActionLabel = document.getElementById("defaultActionLabel");
  ui.defaultActionValue = document.getElementById("defaultActionValue");
  ui.cycleActionButton = document.getElementById("cycleActionButton");
  ui.shortcutHint = document.getElementById("shortcutHint");
  ui.settingsPanel = document.getElementById("settingsPanel");
  ui.setupPanel = document.getElementById("setupPanel");
  ui.finishSetupButton = document.getElementById("finishSetupButton");
  ui.setupStatus = document.getElementById("setupStatus");
  ui.mouseButtonRadios = Array.from(document.querySelectorAll('input[name="side"]'));
  ui.activationModifierSelect = document.getElementById("activationModifier");
  ui.autoEnableToggle = document.getElementById("autoEnableToggle");
  ui.defaultSelectionActionSelect = document.getElementById("defaultSelectionAction");
  ui.openSpeedModeSelect = document.getElementById("openSpeedMode");
  ui.selectionMatchModeSelect = document.getElementById("selectionMatchMode");
  ui.ratingBlock = document.getElementById("ratingBlock");
  ui.ratingSubtitle = document.getElementById("ratingSubtitle");
  ui.updateBanner = document.getElementById("updateBanner");
  ui.updateBannerLink = document.getElementById("updateBannerLink");
  ui.updateBannerDismiss = document.getElementById("updateBannerDismiss");
  ui.whatsNewLink = document.getElementById("whatsNewLink");
  ui.helpLink = document.getElementById("helpLink");
  ui.infoModal = document.getElementById("infoModal");
  ui.infoOverlay = document.getElementById("infoOverlay");
  ui.infoCloseBtn = document.getElementById("infoCloseBtn");
  ui.infoContent = document.getElementById("infoContent");
  ui.infoModalHeader = document.getElementById("infoModalHeader");
}

function setupInfoModal() {
  if (
    !ui.whatsNewLink ||
    !ui.helpLink ||
    !ui.infoModal ||
    !ui.infoOverlay ||
    !ui.infoCloseBtn ||
    !ui.infoContent ||
    !ui.infoModalHeader
  ) {
    return;
  }

  function openInfoModal(title) {
    ui.infoModalHeader.textContent = title;
    ui.infoModal.classList.add("active");
    ui.infoOverlay.classList.add("active");
  }

  function closeInfoModal() {
    ui.infoModal.classList.remove("active");
    ui.infoOverlay.classList.remove("active");
  }

  function renderChangelog(version) {
    ui.infoContent.replaceChildren();

    const section = document.createElement("div");
    section.className = "whats-new-section";

    const h3 = document.createElement("h3");
    h3.textContent = `Version ${version.version}`;
    section.appendChild(h3);

    const dateP = document.createElement("p");
    dateP.className = "version-date";
    dateP.textContent = version.date;
    section.appendChild(dateP);

    function appendList(title, items) {
      if (!items || items.length === 0) return;
      const h4 = document.createElement("h4");
      h4.textContent = title;
      section.appendChild(h4);
      const ul = document.createElement("ul");
      items.forEach((item) => {
        const li = document.createElement("li");
        li.textContent = item;
        ul.appendChild(li);
      });
      section.appendChild(ul);
    }

    appendList("Added", version.sections.added);
    appendList("Improved", version.sections.improved);
    appendList("Fixed", version.sections.fixed);

    ui.infoContent.appendChild(section);
  }

  function renderHelpContent() {
    ui.infoContent.replaceChildren();

    const intro = document.createElement("p");
    intro.textContent = "How to use Snap Links (quick and detailed):";
    ui.infoContent.appendChild(intro);

    const checklist = document.createElement("ul");
    [
      `1) ${state.isEnabled ? "Selection is already ON." : "Turn selection ON in this popup."}`,
      `2) On any web page, ${getGestureText()}.`,
      "3) Keep dragging until the counter matches your target links, then release.",
      `4) Links will ${getActionVerb(state.defaultSelectionAction)}.`,
      '5) Use "Switch" or Alt+Shift+S to change action mode quickly.',
      "6) For tighter picking, set Selection precision to Strict in Settings.",
      "7) For old users: your saved button/modifier/action settings are preserved after update.",
    ].forEach((item) => {
      const li = document.createElement("li");
      li.textContent = item;
      checklist.appendChild(li);
    });
    ui.infoContent.appendChild(checklist);

    const guide = document.createElement("p");
    guide.appendChild(document.createTextNode("Need visuals? Open the "));
    const guideLink = document.createElement("a");
    guideLink.href = "https://o1756795.github.io/snap-links-chrome/";
    guideLink.target = "_blank";
    guideLink.rel = "noopener noreferrer";
    guideLink.textContent = "full welcome guide";
    guide.appendChild(guideLink);
    guide.appendChild(document.createTextNode("."));
    ui.infoContent.appendChild(guide);
  }

  ui.whatsNewLink.addEventListener("click", async () => {
    try {
      const response = await fetch("changelog.json");
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      renderChangelog(data.changelog[0]);
    } catch (error) {
      ui.infoContent.textContent = `Error loading changelog: ${error.message}`;
    }
    openInfoModal("What's New?");
  });

  ui.helpLink.addEventListener("click", () => {
    renderHelpContent();
    openInfoModal("Need help?");
  });

  ui.infoCloseBtn.addEventListener("click", closeInfoModal);
  ui.infoOverlay.addEventListener("click", () => closeInfoModal());
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && ui.infoModal.classList.contains("active")) {
      closeInfoModal();
    }
  });
}

async function setupUpdateBanner() {
  if (!ui.updateBanner || !ui.updateBannerLink || !ui.updateBannerDismiss) return;

  const result = await chrome.storage.local.get("pendingUpdateNotice");
  if (!result.pendingUpdateNotice) return;

  ui.updateBanner.classList.remove("update-banner--hidden");

  function dismissUpdateBanner() {
    ui.updateBanner.classList.add("update-banner--hidden");
    chrome.storage.local.remove("pendingUpdateNotice");
    chrome.runtime.sendMessage({ action: "clearUpdateBadge" }).catch(() => {});
  }

  ui.updateBannerLink.addEventListener("click", () => {
    dismissUpdateBanner();
    ui.whatsNewLink?.click();
  });

  ui.updateBannerDismiss.addEventListener("click", () => {
    dismissUpdateBanner();
  });
}

async function loadInitialState() {
  const result = await chrome.storage.local.get([
    "trackingEnabled",
    "mouseButton",
    "activationModifier",
    "safeMode",
    "autoEnable",
    DEFAULT_SELECTION_ACTION_KEY,
    OPEN_SPEED_MODE_KEY,
    SELECTION_MATCH_MODE_KEY,
    SETUP_COMPLETED_KEY,
    SUCCESSFUL_SELECTION_COUNT_KEY,
    LEGACY_SUCCESS_KEY,
  ]);

  state.isEnabled = result.trackingEnabled ?? false;
  state.mouseButton = normalizeMouseButton(result.mouseButton);
  state.activationModifier = normalizeModifier(result.activationModifier, result.safeMode);
  state.autoEnable = result.autoEnable ?? false;
  state.defaultSelectionAction = normalizeSelectionAction(result[DEFAULT_SELECTION_ACTION_KEY]);
  state.openSpeedMode = normalizeOpenSpeedMode(result[OPEN_SPEED_MODE_KEY]);
  state.selectionMatchMode = normalizeSelectionMatchMode(result[SELECTION_MATCH_MODE_KEY]);
  state.setupCompleted = result[SETUP_COMPLETED_KEY] !== false;
  state.successfulSelectionCount = getSuccessfulSelectionCount(result);
}

function applyStorageChanges(changes) {
  let shouldRefresh = false;

  if (changes.trackingEnabled) {
    state.isEnabled = changes.trackingEnabled.newValue ?? false;
    shouldRefresh = true;
  }
  if (changes.mouseButton) {
    state.mouseButton = normalizeMouseButton(changes.mouseButton.newValue);
    shouldRefresh = true;
  }
  if (changes.activationModifier || changes.safeMode) {
    const modifierValue = changes.activationModifier
      ? changes.activationModifier.newValue
      : state.activationModifier;
    const safeModeValue = changes.safeMode ? changes.safeMode.newValue : state.activationModifier === "alt";
    state.activationModifier = normalizeModifier(modifierValue, safeModeValue);
    shouldRefresh = true;
  }
  if (changes.autoEnable) {
    state.autoEnable = changes.autoEnable.newValue ?? false;
    shouldRefresh = true;
  }
  if (changes[DEFAULT_SELECTION_ACTION_KEY]) {
    state.defaultSelectionAction = normalizeSelectionAction(
      changes[DEFAULT_SELECTION_ACTION_KEY].newValue,
    );
    shouldRefresh = true;
  }
  if (changes[OPEN_SPEED_MODE_KEY]) {
    state.openSpeedMode = normalizeOpenSpeedMode(changes[OPEN_SPEED_MODE_KEY].newValue);
    shouldRefresh = true;
  }
  if (changes[SELECTION_MATCH_MODE_KEY]) {
    state.selectionMatchMode = normalizeSelectionMatchMode(changes[SELECTION_MATCH_MODE_KEY].newValue);
    shouldRefresh = true;
  }
  if (changes[SETUP_COMPLETED_KEY]) {
    state.setupCompleted = changes[SETUP_COMPLETED_KEY].newValue !== false;
    shouldRefresh = true;
  }
  if (changes[SUCCESSFUL_SELECTION_COUNT_KEY] || changes[LEGACY_SUCCESS_KEY]) {
    state.successfulSelectionCount = getSuccessfulSelectionCount({
      [SUCCESSFUL_SELECTION_COUNT_KEY]: changes[SUCCESSFUL_SELECTION_COUNT_KEY]?.newValue,
      [LEGACY_SUCCESS_KEY]: changes[LEGACY_SUCCESS_KEY]?.newValue,
    });
    shouldRefresh = true;
  }

  if (shouldRefresh) {
    updateStatusUI();
    updateSettingsUI();
    updateSetupUI();
    updateRatingVisibility();
  }
}

function attachStorageChangeListener() {
  if (storageChangeListenerAttached || !chrome.storage?.onChanged) return;
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;
    applyStorageChanges(changes);
  });
  storageChangeListenerAttached = true;
}

async function completeFirstRunSetup() {
  setSetupStatus("Saving setup...");
  if (ui.finishSetupButton) {
    ui.finishSetupButton.disabled = true;
  }

  state.setupCompleted = true;
  state.isEnabled = true;

  try {
    await chrome.storage.local.set({
      [SETUP_COMPLETED_KEY]: true,
      trackingEnabled: true,
      mouseButton: state.mouseButton,
      activationModifier: state.activationModifier,
      safeMode: state.activationModifier === "alt",
      autoEnable: state.autoEnable,
      [DEFAULT_SELECTION_ACTION_KEY]: state.defaultSelectionAction,
      [OPEN_SPEED_MODE_KEY]: state.openSpeedMode,
      [SELECTION_MATCH_MODE_KEY]: state.selectionMatchMode,
    });
    await chrome.runtime.sendMessage({
      action: "setTrackingState",
      enabled: true,
    }).catch((err) => {
      console.debug("popup. completeFirstRunSetup setTrackingState err", err);
    });

    updateSetupUI();
    updateStatusUI();
    updateSettingsUI();
    applyThemeAwareActionIcon();
    setSetupStatus("Setup saved. Returning you to the page...");

    setTimeout(() => {
      window.close();
    }, 180);
  } catch (err) {
    console.debug("popup. completeFirstRunSetup err", err);
    state.setupCompleted = false;
    state.isEnabled = false;
    updateSetupUI();
    updateStatusUI();
    setSetupStatus("Could not save setup. Please try again.");
    if (ui.finishSetupButton) {
      ui.finishSetupButton.disabled = false;
    }
  }
}

function bindEvents() {
  if (ui.settingsToggleButton) {
    ui.settingsToggleButton.addEventListener("click", () => {
      toggleSettingsPanel();
    });
  }

  if (ui.toggleButton) {
    ui.toggleButton.addEventListener("click", () => {
      state.isEnabled = !state.isEnabled;
      chrome.storage.local.set({ trackingEnabled: state.isEnabled });
      chrome.runtime.sendMessage({
        action: "setTrackingState",
        enabled: state.isEnabled,
      }).catch((err) => {
        console.debug("popup. setTrackingState err", err);
      });
      updateStatusUI();
      applyThemeAwareActionIcon();
      setTimeout(() => {
        window.close();
      }, 150);
    });
  }

  if (ui.cycleActionButton) {
    ui.cycleActionButton.addEventListener("click", () => {
      cycleSelectionAction();
    });
  }

  if (ui.defaultSelectionActionSelect) {
    ui.defaultSelectionActionSelect.addEventListener("change", (e) => {
      state.defaultSelectionAction = normalizeSelectionAction(e.target.value);
      chrome.storage.local.set({ [DEFAULT_SELECTION_ACTION_KEY]: state.defaultSelectionAction });
      updateStatusUI();
    });
  }

  if (ui.openSpeedModeSelect) {
    ui.openSpeedModeSelect.addEventListener("change", (e) => {
      state.openSpeedMode = normalizeOpenSpeedMode(e.target.value);
      chrome.storage.local.set({ [OPEN_SPEED_MODE_KEY]: state.openSpeedMode });
    });
  }

  if (ui.selectionMatchModeSelect) {
    ui.selectionMatchModeSelect.addEventListener("change", (e) => {
      state.selectionMatchMode = normalizeSelectionMatchMode(e.target.value);
      chrome.storage.local.set({ [SELECTION_MATCH_MODE_KEY]: state.selectionMatchMode });
    });
  }

  if (ui.activationModifierSelect) {
    ui.activationModifierSelect.addEventListener("change", (e) => {
      state.activationModifier = normalizeModifier(e.target.value, false);
      chrome.storage.local.set({
        activationModifier: state.activationModifier,
        safeMode: state.activationModifier === "alt",
      });
      updateStatusUI();
    });
  }

  if (ui.autoEnableToggle) {
    ui.autoEnableToggle.addEventListener("change", (e) => {
      state.autoEnable = !!e.target.checked;
      chrome.storage.local.set({ autoEnable: state.autoEnable });
    });
  }

  if (ui.mouseButtonRadios && ui.mouseButtonRadios.length) {
    ui.mouseButtonRadios.forEach((radio) => {
      radio.addEventListener("change", (e) => {
        state.mouseButton = normalizeMouseButton(e.target.value);
        chrome.storage.local.set({ mouseButton: state.mouseButton });
        updateStatusUI();
      });
    });
  }

  if (ui.finishSetupButton) {
    ui.finishSetupButton.addEventListener("click", () => {
      completeFirstRunSetup();
    });
  }
}

function setupPopupAutoClose() {
  try {
    let lastContextMenuTs = 0;

    window.addEventListener("contextmenu", () => {
      lastContextMenuTs = Date.now();
    });

    window.addEventListener("blur", () => {
      setTimeout(() => {
        const dt = Date.now() - lastContextMenuTs;
        const isProbablyInspect = dt >= 0 && dt < 1500;
        if (isProbablyInspect) return;
        window.close();
      }, 0);
    });

    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        setTimeout(() => {
          window.close();
        }, 0);
      }
    });
  } catch (err) {
    console.debug("popup. auto-close setup err", err);
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  bindElements();
  setupInfoModal();
  setupUpdateBanner().catch((err) => {
    console.debug("popup. setupUpdateBanner err", err);
  });
  setupPopupAutoClose();
  try {
    await loadInitialState();
  } catch (err) {
    console.debug("popup. loadInitialState err", err);
  }
  updateStatusUI();
  updateSettingsUI();
  updateSetupUI();
  updateRatingVisibility();
  attachStorageChangeListener();
  bindEvents();
  await loadCycleShortcutHint();
  applyThemeAwareActionIcon();

  try {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", () => {
      applyThemeAwareActionIcon();
    });
  } catch (err) {
    console.debug("popup. prefers-color-scheme listener err", err);
  }
});

