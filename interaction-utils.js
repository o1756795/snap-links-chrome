const SnapInteractionUtils = {
  buttonToMask(button) {
    if (button === 0) return 1; // left
    if (button === 1) return 4; // middle
    if (button === 2) return 2; // right
    return 0;
  },

  isButtonPressed(button, buttonsMask) {
    const bit = this.buttonToMask(button);
    if (!bit || typeof buttonsMask !== "number") return false;
    return (buttonsMask & bit) !== 0;
  },

  shouldStartLasso(startX, startY, currentX, currentY, threshold) {
    const minDistance = typeof threshold === "number" ? threshold : 8;
    const dx = Math.abs((currentX ?? 0) - (startX ?? 0));
    const dy = Math.abs((currentY ?? 0) - (startY ?? 0));
    return dx >= minDistance || dy >= minDistance;
  },

  shouldStartLassoGesture(requiredModifier, mouseButton, startX, startY, currentX, currentY, threshold, evt) {
    return (
      this.isButtonPressed(mouseButton, evt?.buttons) &&
      this.isModifierSatisfied(requiredModifier, evt) &&
      this.shouldStartLasso(startX, startY, currentX, currentY, threshold)
    );
  },

  isModifierSatisfied(requiredModifier, evt) {
    const mode = (requiredModifier || "none").toLowerCase();
    if (mode === "none") return true;
    if (!evt) return false;
    if (mode === "alt") return !!evt.altKey;
    if (mode === "shift") return !!evt.shiftKey;
    if (mode === "ctrl") return !!evt.ctrlKey;
    return true;
  },
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = SnapInteractionUtils;
}
