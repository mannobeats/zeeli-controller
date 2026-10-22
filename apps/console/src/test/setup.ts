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
