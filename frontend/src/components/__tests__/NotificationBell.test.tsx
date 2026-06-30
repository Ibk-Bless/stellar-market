import "@testing-library/jest-dom";
import React from "react";
import { render, screen, act, waitFor, fireEvent } from "@testing-library/react";
import NotificationBell from "@/components/NotificationBell";
import axios from "axios";

const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();

// Route axios.get responses by URL so the unread-count poll and the dropdown
// list fetch can both be served in a single test.
function mockAxiosByUrl(opts: { count?: number; notifications?: unknown[] } = {}) {
  const { count = 0, notifications = [] } = opts;
  (axios.get as jest.Mock).mockImplementation((url: string) => {
    if (url.includes("/unread-count")) return Promise.resolve({ data: { count } });
    if (url.includes("/notifications")) {
      return Promise.resolve({
        data: { data: notifications, total: notifications.length, page: 1, totalPages: 1 },
      });
    }
    return Promise.resolve({ data: {} });
  });
}

// ─── Mock axios ───────────────────────────────────────────────────────────────
jest.mock("axios");
const mockAxios = axios as jest.Mocked<typeof axios>;

// ─── Mock AuthContext ─────────────────────────────────────────────────────────
jest.mock("@/context/AuthContext", () => ({
  useAuth: () => ({
    token: "mock-token",
    user: { id: "1", username: "testuser" },
  }),
}));


// ─── Mock SocketContext ───────────────────────────────────────────────────────
const mockSocketHandlers: Record<string, ((...args: any[]) => void)[]> = {};
const mockSocket = {
  on: jest.fn((event: string, fn: (...args: any[]) => void) => {
    mockSocketHandlers[event] = mockSocketHandlers[event] ?? [];
    mockSocketHandlers[event].push(fn);
  }),
  off: jest.fn(),
  _trigger: (event: string, ...args: any[]) => {
    mockSocketHandlers[event]?.forEach((fn) => fn(...args));
  },
};

jest.mock("@/context/SocketContext", () => ({
  useSocket: () => ({ socket: mockSocket }),
}));

// ─── next/link stub ───────────────────────────────────────────────────────────
jest.mock("next/link", () => {
  return ({ children, href, ...rest }: { children: React.ReactNode; href: string; [key: string]: unknown }) => (
    <a href={href} {...rest}>{children}</a>
  );
});

describe("NotificationBell", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Object.keys(mockSocketHandlers).forEach((k) => delete mockSocketHandlers[k]);
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("renders the bell icon", async () => {
    mockAxios.get.mockResolvedValueOnce({ data: { count: 0 } });
    await act(async () => {
      render(<NotificationBell />);
    });
    expect(screen.getByLabelText("Notifications")).toBeInTheDocument();
  });

  it("fetches initial unread count on mount", async () => {
    mockAxios.get.mockResolvedValueOnce({ data: { count: 5 } });
    
    await act(async () => {
      render(<NotificationBell />);
    });

    expect(mockAxios.get).toHaveBeenCalledWith(expect.stringContaining("/notifications/unread-count"), expect.anything());
    await waitFor(() => {
      expect(screen.getByText("5")).toBeInTheDocument();
    });
  });

  it("updates count when notification:new socket event fires", async () => {
    mockAxios.get.mockResolvedValueOnce({ data: { count: 2 } });

    await act(async () => {
      render(<NotificationBell />);
    });

    await waitFor(() => {
      expect(screen.getByText("2")).toBeInTheDocument();
    });

    await act(async () => {
      mockSocket._trigger("notification:new", { id: "new-1" });
    });

    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("resets count when notifications:read socket event fires", async () => {
    mockAxios.get.mockResolvedValueOnce({ data: { count: 4 } });

    await act(async () => {
      render(<NotificationBell />);
    });

    await waitFor(() => {
      expect(screen.getByText("4")).toBeInTheDocument();
    });

    await act(async () => {
      mockSocket._trigger("notifications:read");
    });

    expect(screen.queryByText("4")).not.toBeInTheDocument();
  });

  it("polls for unread count every 30 seconds", async () => {
    mockAxios.get.mockResolvedValueOnce({ data: { count: 1 } }); // Initial mount

    await act(async () => {
      render(<NotificationBell />);
    });

    expect(mockAxios.get).toHaveBeenCalledTimes(1);

    // Fast-forward 30 seconds
    mockAxios.get.mockResolvedValueOnce({ data: { count: 10 } });
    await act(async () => {
      jest.advanceTimersByTime(30000);
    });

    expect(mockAxios.get).toHaveBeenCalledTimes(2);
    await waitFor(() => {
      expect(screen.getByText("10")).toBeInTheDocument();
    });
  });

  it("opens a dropdown listing recent notifications when the bell is clicked", async () => {
    mockAxiosByUrl({
      count: 2,
      notifications: [
        { id: "n1", userId: "1", type: "NEW_MESSAGE", title: "New message", message: "Hi", read: false, createdAt: daysAgo(1), metadata: { jobId: "j1" } },
      ],
    });

    await act(async () => {
      render(<NotificationBell />);
    });

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Notifications"));
    });

    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
    expect(screen.getByText("New message")).toBeInTheDocument();
  });

  it("hides notifications older than 30 days", async () => {
    mockAxiosByUrl({
      count: 1,
      notifications: [
        { id: "fresh", userId: "1", type: "NEW_MESSAGE", title: "Fresh note", message: "x", read: false, createdAt: daysAgo(2), metadata: {} },
        { id: "stale", userId: "1", type: "NEW_MESSAGE", title: "Stale note", message: "x", read: false, createdAt: daysAgo(40), metadata: {} },
      ],
    });

    await act(async () => {
      render(<NotificationBell />);
    });
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Notifications"));
    });

    await waitFor(() => expect(screen.getByText("Fresh note")).toBeInTheDocument());
    expect(screen.queryByText("Stale note")).not.toBeInTheDocument();
  });

  it("marks all as read and clears the badge", async () => {
    mockAxiosByUrl({
      count: 3,
      notifications: [
        { id: "n1", userId: "1", type: "NEW_MESSAGE", title: "One", message: "x", read: false, createdAt: daysAgo(1), metadata: {} },
      ],
    });
    (axios.put as jest.Mock).mockResolvedValue({ data: {} });

    await act(async () => {
      render(<NotificationBell />);
    });
    await waitFor(() => expect(screen.getByText("3")).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Notifications"));
    });
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByText("Mark all as read"));
    });

    expect(axios.put).toHaveBeenCalledWith(
      expect.stringContaining("/notifications/read-all"),
      {},
      expect.anything(),
    );
    expect(screen.queryByText("3")).not.toBeInTheDocument();
  });

  it("closes the dropdown on Escape", async () => {
    mockAxiosByUrl({ count: 0, notifications: [] });

    await act(async () => {
      render(<NotificationBell />);
    });
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Notifications"));
    });
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());

    await act(async () => {
      fireEvent.keyDown(document, { key: "Escape" });
    });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
