import "@testing-library/jest-dom";
import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

const mockToastSuccess = jest.fn();
const mockToastError = jest.fn();

jest.mock("@/components/Toast", () => ({
  useToast: () => ({ toast: { success: mockToastSuccess, error: mockToastError } }),
}));

import ShareMenu from "../ShareMenu";

// jsdom starts with origin "http://localhost" — toAbsoluteUrl resolves against it
const EXPECTED_URL = "http://localhost/jobs/1";

beforeEach(() => {
  jest.clearAllMocks();
  delete (navigator as any).share;
});

describe("ShareMenu", () => {
  it("renders the Share button", () => {
    render(<ShareMenu title="Test Job" url="/jobs/1" />);
    expect(screen.getByRole("button", { name: /share/i })).toBeInTheDocument();
  });

  describe("when navigator.share is available (mobile)", () => {
    let shareMock: jest.Mock;

    beforeEach(() => {
      shareMock = jest.fn().mockResolvedValue(undefined);
      (navigator as any).share = shareMock;
    });

    afterEach(() => {
      delete (navigator as any).share;
    });

    it("calls navigator.share with title, text, and absolute URL", async () => {
      render(
        <ShareMenu title="Test Job" url="/jobs/1" description="Check it out" />,
      );

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /share/i }));
      });

      expect(shareMock).toHaveBeenCalledWith({
        title: "Test Job",
        text: "Check it out",
        url: EXPECTED_URL,
      });
    });

    it("does not fall back to clipboard when navigator.share succeeds", async () => {
      const clipboardMock = jest.fn().mockResolvedValue(undefined);
      (navigator as any).clipboard = { writeText: clipboardMock };

      render(<ShareMenu title="Test Job" url="/jobs/1" />);

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /share/i }));
      });

      expect(shareMock).toHaveBeenCalled();
      expect(clipboardMock).not.toHaveBeenCalled();
      expect(mockToastSuccess).not.toHaveBeenCalled();
    });
  });

  describe("when navigator.share is not available (desktop)", () => {
    let clipboardWriteText: jest.Mock;

    beforeEach(() => {
      clipboardWriteText = jest.fn().mockResolvedValue(undefined);
      (navigator as any).clipboard = { writeText: clipboardWriteText };
    });

    it("copies URL to clipboard and shows a success toast", async () => {
      render(<ShareMenu title="Test Job" url="/jobs/1" />);

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /share/i }));
      });

      await waitFor(() =>
        expect(clipboardWriteText).toHaveBeenCalledWith(EXPECTED_URL),
      );
      expect(mockToastSuccess).toHaveBeenCalledWith("Link copied!");
    });

    it("shows an error toast when clipboard write fails", async () => {
      clipboardWriteText = jest.fn().mockRejectedValue(new Error("denied"));
      (navigator as any).clipboard = { writeText: clipboardWriteText };

      render(<ShareMenu title="Test Job" url="/jobs/1" />);

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /share/i }));
      });

      await waitFor(() =>
        expect(mockToastError).toHaveBeenCalledWith("Could not copy the link."),
      );
    });
  });
});
