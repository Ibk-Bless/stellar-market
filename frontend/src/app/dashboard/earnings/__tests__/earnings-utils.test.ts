import { fillWeeklyGaps, movingAverage, buildSeries } from "../earnings-utils";

describe("fillWeeklyGaps", () => {
  it("returns empty for empty input", () => {
    expect(fillWeeklyGaps([])).toEqual([]);
  });

  it("inserts zero-value weeks for gaps", () => {
    const result = fillWeeklyGaps([
      { week: "2026-05-04", earnings: 100 },
      { week: "2026-05-25", earnings: 300 }, // 3 weeks later
    ]);
    expect(result).toEqual([
      { week: "2026-05-04", earnings: 100 },
      { week: "2026-05-11", earnings: 0 },
      { week: "2026-05-18", earnings: 0 },
      { week: "2026-05-25", earnings: 300 },
    ]);
  });

  it("sorts unsorted input", () => {
    const result = fillWeeklyGaps([
      { week: "2026-05-11", earnings: 200 },
      { week: "2026-05-04", earnings: 100 },
    ]);
    expect(result.map((w) => w.week)).toEqual(["2026-05-04", "2026-05-11"]);
  });
});

describe("movingAverage", () => {
  it("uses a partial window for the first three weeks", () => {
    const weekly = [
      { week: "w1", earnings: 100 },
      { week: "w2", earnings: 200 },
      { week: "w3", earnings: 300 },
      { week: "w4", earnings: 400 },
      { week: "w5", earnings: 500 },
    ];
    const avg = movingAverage(weekly);
    // Partial windows: [100], [100,200], [100,200,300], then full 4-week windows.
    expect(avg[0]).toBe(100);
    expect(avg[1]).toBe(150);
    expect(avg[2]).toBe(200);
    expect(avg[3]).toBe(250); // (100+200+300+400)/4
    expect(avg[4]).toBe(350); // (200+300+400+500)/4
  });
});

describe("buildSeries", () => {
  it("fills gaps and attaches the moving average", () => {
    const series = buildSeries([
      { week: "2026-05-04", earnings: 100 },
      { week: "2026-05-18", earnings: 300 },
    ]);
    expect(series).toHaveLength(3);
    expect(series[1]).toEqual({ week: "2026-05-11", earnings: 0, movingAvg: 50 });
    expect(series[2].movingAvg).toBeCloseTo((100 + 0 + 300) / 3, 2);
  });
});
