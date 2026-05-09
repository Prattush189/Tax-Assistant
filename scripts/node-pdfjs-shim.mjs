/**
 * Polyfill the browser globals pdfjs-dist (the modern build that
 * react-pdf imports) needs to load under Node. Loaded via
 * `node --import ./scripts/node-pdfjs-shim.mjs <script>` so the
 * shim runs before any user import.
 */

// Minimal DOMMatrix stand-in. pdfjs uses a few methods (multiplySelf,
// translateSelf, scaleSelf, transformPoint) for text-content
// transforms; the smoke test only triggers getTextContent / getDocument
// which use it to compose viewport scales. The simplified stub below
// covers the property-access + multiplySelf path enough for text
// extraction. If pdfjs ever calls a method we don't define it'll throw
// loudly — at which point we extend the stub.
if (typeof globalThis.DOMMatrix === 'undefined') {
  class DOMMatrixShim {
    constructor(init) {
      // Identity by default. pdfjs constructs `new DOMMatrix()` then
      // mutates via translate/scale/multiply.
      this.a = 1; this.b = 0; this.c = 0; this.d = 1; this.e = 0; this.f = 0;
      if (Array.isArray(init) && init.length === 6) {
        [this.a, this.b, this.c, this.d, this.e, this.f] = init;
      }
    }
    multiplySelf(other) {
      const a = this.a * other.a + this.c * other.b;
      const b = this.b * other.a + this.d * other.b;
      const c = this.a * other.c + this.c * other.d;
      const d = this.b * other.c + this.d * other.d;
      const e = this.a * other.e + this.c * other.f + this.e;
      const f = this.b * other.e + this.d * other.f + this.f;
      this.a = a; this.b = b; this.c = c; this.d = d; this.e = e; this.f = f;
      return this;
    }
    translateSelf(tx = 0, ty = 0) {
      this.e += this.a * tx + this.c * ty;
      this.f += this.b * tx + this.d * ty;
      return this;
    }
    scaleSelf(sx = 1, sy = sx) {
      this.a *= sx; this.b *= sx; this.c *= sy; this.d *= sy;
      return this;
    }
    transformPoint(point) {
      const x = (point?.x ?? 0), y = (point?.y ?? 0);
      return { x: this.a * x + this.c * y + this.e, y: this.b * x + this.d * y + this.f };
    }
  }
  globalThis.DOMMatrix = DOMMatrixShim;
}

if (typeof globalThis.DOMException === 'undefined') {
  globalThis.DOMException = class DOMException extends Error {
    constructor(msg, name) { super(msg); this.name = name ?? 'Error'; }
  };
}

if (typeof globalThis.ImageData === 'undefined') {
  globalThis.ImageData = class ImageData {
    constructor(data, width, height) {
      this.data = data; this.width = width; this.height = height;
    }
  };
}

// pdfjs warns about a missing worker in Node — it falls back to fake
// worker (single-threaded) which is exactly what we want for the
// smoke test. No polyfill needed for that path.
