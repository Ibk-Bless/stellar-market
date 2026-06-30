import { render, screen } from "@testing-library/react";
import DepositRateInfo, { type DepositRateSnapshot } from "../DepositRateInfo";

const snapshot: DepositRateSnapshot = {
  twapPriceStroops: "10000000", // 1.0
  samples: 12,
  agreedValueStroops: "1000000000", // 100 XLM
  depositedValueStroops: "1000000000", // 100 XLM
  maxSlippageBps: 200,
  ledger: 42,
};

describe("DepositRateInfo", () => {
  it("renders the agreed value and slippage tolerance", () => {
    render(
      <DepositRateInfo agreedValueStroops="1000000000" maxSlippageBps={200} />,
    );
    expect(screen.getByText("Agreed value")).toBeInTheDocument();
    expect(screen.getByText("100 XLM")).toBeInTheDocument();
    expect(screen.getByText("2.00%")).toBeInTheDocument();
  });

  it("shows the TWAP rate and equivalent value when a snapshot is provided", () => {
    render(
      <DepositRateInfo
        agreedValueStroops="1000000000"
        maxSlippageBps={200}
        snapshot={snapshot}
      />,
    );
    expect(screen.getByText(/TWAP rate/)).toBeInTheDocument();
    expect(screen.getByText("Equivalent deposit value")).toBeInTheDocument();
  });

  it("warns when the live rate has drifted more than 1%", () => {
    render(
      <DepositRateInfo
        agreedValueStroops="1000000000"
        maxSlippageBps={200}
        snapshot={snapshot}
        liveTwapPriceStroops="10200000" // +2% vs snapshot 10000000
      />,
    );
    expect(screen.getByText(/live rate has moved/)).toBeInTheDocument();
    expect(screen.getByText(/\+2\.00%/)).toBeInTheDocument();
  });

  it("does not warn when drift is within 1%", () => {
    render(
      <DepositRateInfo
        agreedValueStroops="1000000000"
        maxSlippageBps={200}
        snapshot={snapshot}
        liveTwapPriceStroops="10050000" // +0.5%
      />,
    );
    expect(screen.queryByText(/live rate has moved/)).not.toBeInTheDocument();
  });
});
