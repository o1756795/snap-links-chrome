const SnapSelectionUtils = {
  isHttpUrl(url) {
    return typeof url === "string" && /^(https?):\/\//i.test(url.trim());
  },

  intersectsRect(a, b) {
    if (!a || !b) return false;
    return (
      a.right >= b.left &&
      a.left <= b.right &&
      a.bottom >= b.top &&
      a.top <= b.bottom
    );
  },

  containsRect(outer, inner) {
    if (!outer || !inner) return false;
    return (
      inner.left >= outer.left &&
      inner.right <= outer.right &&
      inner.top >= outer.top &&
      inner.bottom <= outer.bottom
    );
  },

  getCombinedRectFromRects(rects) {
    const list = Array.isArray(rects) ? rects : Array.from(rects || []);
    const valid = list.filter((r) => r && r.width > 0 && r.height > 0);
    if (valid.length === 0) return null;

    let left = valid[0].left;
    let right = valid[0].right;
    let top = valid[0].top;
    let bottom = valid[0].bottom;

    valid.forEach((r) => {
      if (r.left < left) left = r.left;
      if (r.right > right) right = r.right;
      if (r.top < top) top = r.top;
      if (r.bottom > bottom) bottom = r.bottom;
    });

    return {
      left,
      right,
      top,
      bottom,
      width: right - left,
      height: bottom - top,
    };
  },

  getElementSelectionBounds(element) {
    if (!element) return null;

    const ownRects =
      typeof element.getClientRects === "function"
        ? element.getClientRects()
        : [];
    const ownBounds = this.getCombinedRectFromRects(ownRects);
    if (ownBounds) return ownBounds;

    const descendants =
      typeof element.querySelectorAll === "function"
        ? element.querySelectorAll("*")
        : [];

    let merged = null;
    Array.from(descendants || []).forEach((child) => {
      if (typeof child.getClientRects !== "function") return;
      const childBounds = this.getCombinedRectFromRects(child.getClientRects());
      if (!childBounds) return;

      if (!merged) {
        merged = { ...childBounds };
        return;
      }

      if (childBounds.left < merged.left) merged.left = childBounds.left;
      if (childBounds.right > merged.right) merged.right = childBounds.right;
      if (childBounds.top < merged.top) merged.top = childBounds.top;
      if (childBounds.bottom > merged.bottom) merged.bottom = childBounds.bottom;
      merged.width = merged.right - merged.left;
      merged.height = merged.bottom - merged.top;
    });

    return merged;
  },
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = SnapSelectionUtils;
}

