// jsdom lacks the layout APIs React Flow and Radix measure with; these stand-ins report zero sizes.
class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= NoopResizeObserver;
globalThis.DOMMatrixReadOnly ??= class {
  m22 = 1;
} as unknown as typeof DOMMatrixReadOnly;
window.matchMedia ??= (query: string) =>
  ({ matches: false, media: query, addEventListener() {}, removeEventListener() {}, onchange: null }) as unknown as MediaQueryList;
Element.prototype.scrollIntoView ??= () => {};

// Lists draw more rows when a marker scrolls into view; `scrollToEnd()` (test/render.tsx) plays that scroll.
const watching = new Set<{ cb: IntersectionObserverCallback; els: Set<Element> }>();
globalThis.IntersectionObserver ??= class {
  #w = { cb: (() => {}) as IntersectionObserverCallback, els: new Set<Element>() };
  constructor(cb: IntersectionObserverCallback) {
    this.#w.cb = cb;
    watching.add(this.#w);
  }
  observe(el: Element) {
    this.#w.els.add(el);
  }
  unobserve(el: Element) {
    this.#w.els.delete(el);
  }
  disconnect() {
    watching.delete(this.#w);
  }
  takeRecords() {
    return [];
  }
} as unknown as typeof IntersectionObserver;
(globalThis as { scrollToEnd?: () => void }).scrollToEnd = () => {
  for (const w of [...watching])
    w.cb(
      [...w.els].map((target) => ({ target, isIntersecting: true }) as IntersectionObserverEntry),
      null as unknown as IntersectionObserver,
    );
};
