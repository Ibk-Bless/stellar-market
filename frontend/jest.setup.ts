import "@testing-library/jest-dom";
import { webcrypto } from "crypto";

// jsdom does not implement SubtleCrypto. Polyfill it from Node's webcrypto so
// tests that compute SHA-256 integrity hashes can run.
//
// Realm-bridge fix (#880): Node's SubtleCrypto.digest validates that the input
// buffer belongs to the same JavaScript realm. jsdom Uint8Array/ArrayBuffer are
// from a different realm, so digest throws "2nd argument is not instance of
// ArrayBuffer, Buffer, TypedArray, or DataView." We wrap digest to re-create
// the buffer via Node's Buffer.from before passing to the native implementation.
if (typeof globalThis.crypto === "undefined") {
  // @ts-expect-error assigning the Node webcrypto implementation
  globalThis.crypto = webcrypto;
}

const subtleDescriptor = Object.getOwnPropertyDescriptor(
  globalThis.crypto,
  "subtle",
);
if (!subtleDescriptor || typeof subtleDescriptor.value === "undefined") {
  const origDigest = webcrypto.subtle.digest.bind(webcrypto.subtle);
  Object.defineProperty(globalThis.crypto, "subtle", {
    value: {
      digest: (algorithm: string, data: ArrayBuffer | Buffer | DataView | { buffer: ArrayBuffer }) => {
        const bridge = Buffer.from(data as ArrayBuffer);
        return origDigest(algorithm, bridge);
      },
    },
    configurable: true,
  });
}

// jsdom lacks structuredClone, which fake-indexeddb (and modern runtime code)
// relies on to clone stored values. Polyfill from Node.
if (typeof (globalThis as any).structuredClone === "undefined") {
  (globalThis as any).structuredClone = (globalThis as any).structuredClone || (require("crypto").structuredClone);
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
