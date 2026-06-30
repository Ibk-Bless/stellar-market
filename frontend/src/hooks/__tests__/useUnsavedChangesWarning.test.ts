import { renderHook, act } from "@testing-library/react";
import { useUnsavedChangesWarning } from "../useUnsavedChangesWarning";
import { useRouter } from "next/navigation";

jest.mock("next/navigation", () => ({
  useRouter: jest.fn(),
}));

describe("useUnsavedChangesWarning", () => {
  let mockPush: jest.Mock;

  beforeEach(() => {
    mockPush = jest.fn();
    (useRouter as jest.Mock).mockReturnValue({ push: mockPush });
    // Reset window.location mock for safe parsing
    delete (window as any).location;
    window.location = new URL("http://localhost") as any;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("isDirty = false + navigation: no guard", () => {
    const { result } = renderHook(() => useUnsavedChangesWarning(false));

    const anchor = document.createElement("a");
    anchor.href = "http://localhost/dashboard";
    document.body.appendChild(anchor);

    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    act(() => {
      anchor.dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(false);
    expect(result.current.showModal).toBe(false);

    document.body.removeChild(anchor);
  });

  it("isDirty = true + navigation: guard modal appears", () => {
    const { result } = renderHook(() => useUnsavedChangesWarning(true));

    const anchor = document.createElement("a");
    anchor.href = "http://localhost/dashboard";
    document.body.appendChild(anchor);

    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    act(() => {
      anchor.dispatchEvent(event);
    });

    // Should prevent default and show modal
    expect(event.defaultPrevented).toBe(true);
    expect(result.current.showModal).toBe(true);

    // Confirm leave
    act(() => {
      result.current.confirmLeave();
    });

    expect(result.current.showModal).toBe(false);
    expect(mockPush).toHaveBeenCalledWith("http://localhost/dashboard");

    document.body.removeChild(anchor);
  });

  it("Successful save clears the guard", () => {
    const { result, rerender } = renderHook(({ isDirty }) => useUnsavedChangesWarning(isDirty), {
      initialProps: { isDirty: true },
    });

    // Rerender as if form was saved and isDirty became false
    rerender({ isDirty: false });

    const anchor = document.createElement("a");
    anchor.href = "http://localhost/dashboard";
    document.body.appendChild(anchor);

    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    act(() => {
      anchor.dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(false);
    expect(result.current.showModal).toBe(false);

    document.body.removeChild(anchor);
  });
});
