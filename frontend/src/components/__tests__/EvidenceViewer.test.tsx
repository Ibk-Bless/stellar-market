import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import axios from "axios";
import EvidenceViewer from "@/components/EvidenceViewer";

jest.mock("axios", () => ({ get: jest.fn() }));
const mockGet = axios.get as jest.Mock;

describe("EvidenceViewer", () => {
  beforeEach(() => {
    localStorage.setItem("token", "test-token");
    Object.defineProperty(URL, "createObjectURL", { value: jest.fn(() => "blob:download"), writable: true });
    Object.defineProperty(URL, "revokeObjectURL", { value: jest.fn(), writable: true });
    jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    mockGet.mockResolvedValue({ data: new Blob(["evidence"]) });
  });

  afterEach(() => {
    localStorage.clear();
    jest.restoreAllMocks();
  });

  it("requests the protected signed-download endpoint", async () => {
    render(
      <EvidenceViewer
        disputeId="dispute-1"
        evidence={[{
          id: "evidence-1",
          fileName: "contract.pdf",
          fileType: "application/pdf",
          sizeFormatted: "42 KB",
          uploadedAt: "2026-01-01T00:00:00.000Z",
        }]}
      />,
    );

    expect(screen.getByText("application/pdf")).toBeInTheDocument();
    expect(screen.getByText("42 KB")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Download contract.pdf" }));

    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith(
        "http://localhost:5000/api/disputes/dispute-1/evidence/evidence-1/download",
        expect.objectContaining({ responseType: "blob" }),
      );
    });
  });
});
