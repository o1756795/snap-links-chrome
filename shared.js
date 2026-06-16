// shared.js — Shared constants and helpers for Snap Links extension
// Loaded via importScripts() in background.js and <script> in popup.html

const SnapIcons = {
  ACTIVE: "icons/icon16.png",
  INACTIVE_LIGHT: "icons/icon16-mono.png",
  INACTIVE_DARK: "icons/icon16-mono-light.png",

  getInactiveIcon(isDark) {
    return isDark ? this.INACTIVE_DARK : this.INACTIVE_LIGHT;
  },
};
