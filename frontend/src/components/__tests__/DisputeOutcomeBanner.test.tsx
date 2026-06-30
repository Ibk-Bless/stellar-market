import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import DisputeOutcomeBanner from "@/components/DisputeOutcomeBanner";

describe("DisputeOutcomeBanner", () => {
  it("renders pending state for OPEN status", () => {
    render(<DisputeOutcomeBanner status="OPEN" />);
    expect(screen.getByText(/pending/i)).toBeInTheDocument();
    expect(screen.queryByTestId("dispute-outcome-banner")).not.toBeInTheDocument();
  });

  it("renders blue banner for client_win (RESOLVED_CLIENT)", () => {
    render(<DisputeOutcomeBanner status="RESOLVED_CLIENT" />);
    const banner = screen.getByTestId("dispute-outcome-banner");
    expect(banner).toBeInTheDocument();
    expect(banner.className).toMatch(/blue/);
    expect(screen.getByText("Client Dispute Won")).toBeInTheDocument();
  });

  it("renders green banner for freelancer_win (RESOLVED_FREELANCER)", () => {
    render(<DisputeOutcomeBanner status="RESOLVED_FREELANCER" />);
    const banner = screen.getByTestId("dispute-outcome-banner");
    expect(banner.className).toMatch(/green/);
    expect(screen.getByText("Freelancer Verdict")).toBeInTheDocument();
  });

  it("renders amber banner with percentage breakdown for split (RESOLVED_SPLIT)", () => {
    render(
      <DisputeOutcomeBanner
        status="RESOLVED_SPLIT"
        clientSplit={60}
        freelancerSplit={40}
      />,
    );
    const banner = screen.getByTestId("dispute-outcome-banner");
    expect(banner.className).toMatch(/amber/);
    expect(screen.getByText("Split Decision")).toBeInTheDocument();
    expect(screen.getByText(/60%/)).toBeInTheDocument();
    expect(screen.getByText(/40%/)).toBeInTheDocument();
  });

  it("renders pending state for VOTING status", () => {
    render(<DisputeOutcomeBanner status="VOTING" />);
    expect(screen.getByText(/pending/i)).toBeInTheDocument();
  });
});
