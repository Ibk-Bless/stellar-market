import "@testing-library/jest-dom";
import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import ChatWindow, { ChatMessage } from "@/components/chat/ChatWindow";

// ─── jsdom shims ──────────────────────────────────────────────────────────────
window.HTMLElement.prototype.scrollIntoView = jest.fn();

// ─── Socket mock ──────────────────────────────────────────────────────────────
const mockHandlers: Record<string, ((...args: unknown[]) => void)[]> = {};
let mockIsConnected = true;
const mockSocket = {
  on: jest.fn((event: string, fn: (...args: unknown[]) => void) => {
    mockHandlers[event] = mockHandlers[event] ?? [];
    mockHandlers[event].push(fn);
  }),
  off: jest.fn((event: string, fn: (...args: unknown[]) => void) => {
    mockHandlers[event] = (mockHandlers[event] ?? []).filter((h) => h !== fn);
  }),
  emit: jest.fn(),
  _trigger: (event: string, ...args: unknown[]) => {
    mockHandlers[event]?.forEach((fn) => fn(...args));
  },
};

jest.mock("@/context/SocketContext", () => ({
  useSocket: () => ({ socket: mockSocket, isConnected: mockIsConnected }),
}));

// localStorage is used for the offline outbox; jsdom provides a real
// implementation, so just make sure each test starts from a clean slate.
function clearOutboxStorage() {
  Object.keys(window.localStorage).forEach((k) => {
    if (k.startsWith("stellar_chat_outbox:")) window.localStorage.removeItem(k);
  });
}

/** Grab the ack callback socket.emit("send_message", payload, ack) was called with. */
function getLastSendAck(): ((response: unknown) => void) | undefined {
  const calls = mockSocket.emit.mock.calls.filter((c) => c[0] === "send_message");
  const last = calls[calls.length - 1];
  return last?.[2] as ((response: unknown) => void) | undefined;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const baseProps = {
  currentUserId: "user-me",
  partnerId: "user-bob",
  partnerUsername: "Bob",
  initialMessages: [] as ChatMessage[],
};

const makeMessage = (overrides: Partial<ChatMessage> = {}): ChatMessage => ({
  id: `msg-${Math.random()}`,
  senderId: "user-bob",
  receiverId: "user-me",
  content: "Hello!",
  read: false,
  createdAt: new Date().toISOString(),
  sender: { id: "user-bob", username: "Bob", avatarUrl: null },
  ...overrides,
});

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  Object.keys(mockHandlers).forEach((k) => delete mockHandlers[k]);
  mockIsConnected = true;
  clearOutboxStorage();
});

afterEach(() => {
  jest.useRealTimers();
});

describe("ChatWindow", () => {
  it("renders initial message history", () => {
    const messages = [
      makeMessage({ id: "msg-1", content: "First message", senderId: "user-bob" }),
      makeMessage({ id: "msg-2", content: "My reply", senderId: "user-me" }),
    ];
    render(<ChatWindow {...baseProps} initialMessages={messages} />);

    expect(screen.getByText("First message")).toBeInTheDocument();
    expect(screen.getByText("My reply")).toBeInTheDocument();
  });

  it("displays a new real-time message from partner without refresh", async () => {
    render(<ChatWindow {...baseProps} />);

    const incoming = makeMessage({ content: "Hey there live!" });

    await act(async () => {
      mockSocket._trigger("new_message", incoming);
    });

    expect(screen.getByText("Hey there live!")).toBeInTheDocument();
  });

  it("emits send_message with a client id and ack callback on form submit", async () => {
    render(<ChatWindow {...baseProps} />);

    const textarea = screen.getByPlaceholderText(/message bob/i);
    fireEvent.change(textarea, { target: { value: "Hi Bob!" } });

    const sendBtn = screen.getByRole("button", { name: "" }); // Send icon button
    fireEvent.click(sendBtn);

    expect(mockSocket.emit).toHaveBeenCalledWith(
      "send_message",
      expect.objectContaining({ receiverId: "user-bob", content: "Hi Bob!" }),
      expect.any(Function)
    );
  });

  it("shows the message optimistically before the server acks it", async () => {
    render(<ChatWindow {...baseProps} />);

    const textarea = screen.getByPlaceholderText(/message bob/i);
    fireEvent.change(textarea, { target: { value: "Hi Bob!" } });
    fireEvent.click(screen.getByRole("button", { name: "" }));

    expect(screen.getByText("Hi Bob!")).toBeInTheDocument();
  });

  it("emits typing_start when user types and typing_stop after debounce", async () => {
    render(<ChatWindow {...baseProps} />);
    const textarea = screen.getByPlaceholderText(/message bob/i);

    fireEvent.change(textarea, { target: { value: "a" } });
    expect(mockSocket.emit).toHaveBeenCalledWith("typing_start", { receiverId: "user-bob" });

    // Advance past debounce
    await act(async () => {
      jest.advanceTimersByTime(1600);
    });

    expect(mockSocket.emit).toHaveBeenCalledWith("typing_stop", { receiverId: "user-bob" });
  });

  it("shows TypingIndicator when user_typing event received", async () => {
    render(<ChatWindow {...baseProps} />);

    await act(async () => {
      mockSocket._trigger("user_typing", { userId: "user-bob" });
    });

    expect(screen.getByText(/bob is typing/i)).toBeInTheDocument();
  });

  it("emits mark_read on mount", () => {
    render(<ChatWindow {...baseProps} />);
    expect(mockSocket.emit).toHaveBeenCalledWith("mark_read", { senderId: "user-bob" });
  });

  it("reconciles the optimistic message with the server-confirmed one on ack, without duplicating", async () => {
    render(<ChatWindow {...baseProps} />);

    fireEvent.change(screen.getByPlaceholderText(/message bob/i), {
      target: { value: "Confirmed please" },
    });
    fireEvent.click(screen.getByRole("button", { name: "" }));

    expect(screen.getAllByText("Confirmed please")).toHaveLength(1);

    const ack = getLastSendAck();
    const serverMessage = makeMessage({
      id: "server-msg-1",
      content: "Confirmed please",
      senderId: "user-me",
      receiverId: "user-bob",
    });

    await act(async () => {
      ack?.({ ok: true, message: serverMessage });
    });

    // Still exactly one bubble — the optimistic entry was replaced, not
    // duplicated alongside the server-confirmed message.
    expect(screen.getAllByText("Confirmed please")).toHaveLength(1);
  });

  it("marks a message failed after the ack times out, and retry re-sends it", async () => {
    render(<ChatWindow {...baseProps} />);

    fireEvent.change(screen.getByPlaceholderText(/message bob/i), {
      target: { value: "Will time out" },
    });
    fireEvent.click(screen.getByRole("button", { name: "" }));

    await act(async () => {
      jest.advanceTimersByTime(9000); // past the 8s ack timeout
    });

    expect(screen.getByText(/not delivered/i)).toBeInTheDocument();

    const sendCallsBefore = mockSocket.emit.mock.calls.filter((c) => c[0] === "send_message").length;

    fireEvent.click(screen.getByRole("button", { name: /retry/i }));

    const sendCallsAfter = mockSocket.emit.mock.calls.filter((c) => c[0] === "send_message").length;
    expect(sendCallsAfter).toBe(sendCallsBefore + 1);
  });

  it("queues a message sent while disconnected and shows a queued state", () => {
    mockIsConnected = false;
    render(<ChatWindow {...baseProps} />);

    fireEvent.change(screen.getByPlaceholderText(/message bob/i), {
      target: { value: "Offline message" },
    });
    fireEvent.click(screen.getByRole("button", { name: "" }));

    expect(screen.getByText("Offline message")).toBeInTheDocument();
    expect(screen.getByText(/queued/i)).toBeInTheDocument();
    expect(mockSocket.emit).not.toHaveBeenCalledWith(
      "send_message",
      expect.anything(),
      expect.anything()
    );
  });

  it("flushes a queued message automatically once the socket reconnects", async () => {
    mockIsConnected = false;
    const { rerender } = render(<ChatWindow {...baseProps} />);

    fireEvent.change(screen.getByPlaceholderText(/message bob/i), {
      target: { value: "Send me on reconnect" },
    });
    fireEvent.click(screen.getByRole("button", { name: "" }));

    expect(mockSocket.emit).not.toHaveBeenCalledWith(
      "send_message",
      expect.anything(),
      expect.anything()
    );

    mockIsConnected = true;
    await act(async () => {
      rerender(<ChatWindow {...baseProps} />);
    });

    expect(mockSocket.emit).toHaveBeenCalledWith(
      "send_message",
      expect.objectContaining({ receiverId: "user-bob", content: "Send me on reconnect" }),
      expect.any(Function)
    );
  });

  it("does not duplicate a message when new_message arrives for an already-acked send", async () => {
    render(<ChatWindow {...baseProps} />);

    fireEvent.change(screen.getByPlaceholderText(/message bob/i), {
      target: { value: "Echo test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "" }));

    const ack = getLastSendAck();
    const serverMessage = makeMessage({
      id: "server-msg-2",
      content: "Echo test",
      senderId: "user-me",
      receiverId: "user-bob",
    });

    await act(async () => {
      ack?.({ ok: true, message: serverMessage });
    });

    // Server also broadcasts new_message back to the sender's other tabs;
    // it carries the same id already reconciled via the ack.
    await act(async () => {
      mockSocket._trigger("new_message", serverMessage);
    });

    expect(screen.getAllByText("Echo test")).toHaveLength(1);
  });

  it("does not leak a pending message into a different conversation opened with the same component instance", async () => {
    mockIsConnected = false;
    const { rerender } = render(<ChatWindow {...baseProps} partnerId="user-bob" />);

    fireEvent.change(screen.getByPlaceholderText(/message bob/i), {
      target: { value: "For Bob only" },
    });
    fireEvent.click(screen.getByRole("button", { name: "" }));

    expect(screen.getByText("For Bob only")).toBeInTheDocument();

    // Switch to a different conversation (as would happen if the parent
    // didn't remount ChatWindow via a key change).
    await act(async () => {
      rerender(<ChatWindow {...baseProps} partnerId="user-carol" partnerUsername="Carol" />);
    });

    expect(screen.queryByText("For Bob only")).not.toBeInTheDocument();
  });
});
