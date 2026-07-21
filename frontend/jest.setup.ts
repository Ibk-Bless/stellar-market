import "@testing-library/jest-dom";
import { webcrypto, structuredClone as nodeStructuredClone } from "crypto";

// jsdom does not implement SubtleCrypto. Polyfill it from Node's webcrypto so
// tests that compute SHA-256 integrity hashes can run.
if (typeof globalThis.crypto === "undefined") {
  // @ts-expect-error assigning the Node webcrypto implementation
  globalThis.crypto = webcrypto;
} else if (typeof globalThis.crypto.subtle === "undefined") {
  Object.defineProperty(globalThis.crypto, "subtle", {
    value: webcrypto.subtle,
    configurable: true,
  });
}

// jsdom lacks structuredClone, which fake-indexeddb (and modern runtime code)
// relies on to clone stored values. Polyfill from Node.
if (typeof (globalThis as any).structuredClone === "undefined") {
  (globalThis as any).structuredClone = nodeStructuredClone;
}

class MockIntersectionObserver {
  observe = jest.fn();
  unobserve = jest.fn();
  disconnect = jest.fn();
}

Object.defineProperty(window, 'IntersectionObserver', {
  writable: true,
  configurable: true,
  value: MockIntersectionObserver,
});
