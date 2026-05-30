import { render, act } from "@testing-library/react";
import { useInfiniteScroll } from "@/hooks/useInfiniteScroll";

let ioCallback: IntersectionObserverCallback | null = null;
let observeCount = 0;

beforeEach(() => {
  ioCallback = null;
  observeCount = 0;

  class MockIntersectionObserver {
    constructor(cb: IntersectionObserverCallback) {
      ioCallback = cb;
    }
    observe() {
      observeCount += 1;
    }
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  }

  (global as unknown as { IntersectionObserver: unknown }).IntersectionObserver =
    MockIntersectionObserver;
});

function Harness(props: {
  onLoadMore: () => void;
  hasMore: boolean;
  isLoading: boolean;
}) {
  const { sentinelRef } = useInfiniteScroll(props);
  return <div ref={sentinelRef} data-testid="sentinel" />;
}

function fireIntersection(isIntersecting: boolean) {
  act(() => {
    ioCallback?.(
      [{ isIntersecting } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    );
  });
}

describe("useInfiniteScroll (#545)", () => {
  it("observes the sentinel on mount", () => {
    render(<Harness onLoadMore={jest.fn()} hasMore isLoading={false} />);
    expect(observeCount).toBe(1);
  });

  it("calls onLoadMore when the sentinel intersects and more pages remain", () => {
    const onLoadMore = jest.fn();
    render(<Harness onLoadMore={onLoadMore} hasMore isLoading={false} />);
    fireIntersection(true);
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it("does not load more when there are no further pages", () => {
    const onLoadMore = jest.fn();
    render(<Harness onLoadMore={onLoadMore} hasMore={false} isLoading={false} />);
    fireIntersection(true);
    expect(onLoadMore).not.toHaveBeenCalled();
  });

  it("does not load more while a fetch is already in progress", () => {
    const onLoadMore = jest.fn();
    render(<Harness onLoadMore={onLoadMore} hasMore isLoading />);
    fireIntersection(true);
    expect(onLoadMore).not.toHaveBeenCalled();
  });

  it("ignores entries that are not intersecting", () => {
    const onLoadMore = jest.fn();
    render(<Harness onLoadMore={onLoadMore} hasMore isLoading={false} />);
    fireIntersection(false);
    expect(onLoadMore).not.toHaveBeenCalled();
  });
});
