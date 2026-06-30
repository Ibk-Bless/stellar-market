import { renderHook, act } from "@testing-library/react";
import { useMediaQuery } from "@/hooks/useMediaQuery";

type Listener = () => void;

function mockMatchMedia(initialMatches: boolean) {
  let matches = initialMatches;
  const listeners = new Set<Listener>();

  const mql = {
    get matches() {
      return matches;
    },
    media: "",
    addEventListener: (_: string, cb: Listener) => listeners.add(cb),
    removeEventListener: (_: string, cb: Listener) => listeners.delete(cb),
    // legacy API – not used by the hook but kept for completeness
    addListener: (cb: Listener) => listeners.add(cb),
    removeListener: (cb: Listener) => listeners.delete(cb),
    dispatchEvent: () => true,
  };

  window.matchMedia = jest.fn().mockImplementation((q: string) => {
    mql.media = q;
    return mql as unknown as MediaQueryList;
  });

  return {
    setMatches(next: boolean) {
      matches = next;
      listeners.forEach((cb) => cb());
    },
  };
}

describe("useMediaQuery", () => {
  it("returns true when the query matches on mount", () => {
    mockMatchMedia(true);
    const { result } = renderHook(() => useMediaQuery("(max-width: 374px)"));
    expect(result.current).toBe(true);
  });

  it("returns false when the query does not match on mount", () => {
    mockMatchMedia(false);
    const { result } = renderHook(() => useMediaQuery("(max-width: 374px)"));
    expect(result.current).toBe(false);
  });

  it("updates when the media query changes (e.g. viewport resize)", () => {
    const mm = mockMatchMedia(false);
    const { result } = renderHook(() => useMediaQuery("(max-width: 374px)"));
    expect(result.current).toBe(false);

    act(() => mm.setMatches(true));
    expect(result.current).toBe(true);
  });
});
