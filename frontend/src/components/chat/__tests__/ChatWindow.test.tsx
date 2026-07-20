import "@testing-library/jest-dom";
import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import ChatWindow, { ChatMessage } from "@/components/chat/ChatWindow";

// ─── jsdom shims ──────────────────────────────────────────────────────────────
window.HTMLElement.prototype.scrollIntoView = jest.fn();

// ─── Socket mock ──────────────────────────────────────────────────────────────
const mockHandlers: Record<string, ((...args: unknown[]) => void)[]> = {};
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
  useSocket: () => ({ socket: mockSocket, isConnected: true }),
}));

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
});
