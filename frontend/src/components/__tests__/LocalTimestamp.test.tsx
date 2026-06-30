import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import LocalTimestamp, {
  formatLocalTimestamp,
  formatUtcTimestamp,
} from "@/components/LocalTimestamp";

const ISO = "2026-06-15T14:32:00Z";

describe("formatUtcTimestamp", () => {
  it("formats UTC time as 'UTC: YYYY-MM-DD HH:MM'", () => {
    expect(formatUtcTimestamp(ISO)).toBe("UTC: 2026-06-15 14:32");
  });

  it("zero-pads month, day, hours and minutes", () => {
    expect(formatUtcTimestamp("2026-01-05T03:07:00Z")).toBe(
      "UTC: 2026-01-05 03:07",
    );
  });
});

describe("formatLocalTimestamp in UTC+1 context", () => {
  const RealDateTimeFormat = Intl.DateTimeFormat;

  beforeEach(() => {
    // Simulate a UTC+1, en-GB browser by forcing Europe/London (BST in June =
    // UTC+1) and the en-GB locale. Pinning the locale keeps the formatted output
    // deterministic regardless of the CI runner's default locale.
    jest
      .spyOn(global.Intl, "DateTimeFormat")
      .mockImplementation(
        (_locale?: string | string[], options?: Intl.DateTimeFormatOptions) =>
          new RealDateTimeFormat("en-GB", {
            ...options,
            timeZone: "Europe/London",
          }),
      );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("shows 15 Jun 2026, 3:32 PM for UTC 14:32 in a UTC+1 context", () => {
    const result = formatLocalTimestamp(ISO);
    // BST (UTC+1) shifts 14:32 → 15:32 = 3:32 PM
    expect(result).toMatch(/15 Jun 2026/);
    expect(result).toMatch(/3:32/);
    expect(result.toLowerCase()).toMatch(/pm/);
  });
});

describe("LocalTimestamp component", () => {
  const RealDateTimeFormat = Intl.DateTimeFormat;

  beforeEach(() => {
    // Pin both timezone (UTC+1) and locale (en-GB) so the formatted output is
    // deterministic regardless of the CI runner's default locale.
    jest
      .spyOn(global.Intl, "DateTimeFormat")
      .mockImplementation(
        (_locale?: string | string[], options?: Intl.DateTimeFormatOptions) =>
          new RealDateTimeFormat("en-GB", {
            ...options,
            timeZone: "Europe/London",
          }),
      );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("renders localised time text for UTC+1", () => {
    render(<LocalTimestamp isoString={ISO} />);
    const el = screen.getByRole("time");
    expect(el.textContent).toMatch(/15 Jun 2026/);
    expect(el.textContent).toMatch(/3:32/);
    expect(el.textContent!.toLowerCase()).toMatch(/pm/);
  });

  it("tooltip shows UTC time", () => {
    render(<LocalTimestamp isoString={ISO} />);
    const el = screen.getByRole("time");
    expect(el).toHaveAttribute("title", "UTC: 2026-06-15 14:32");
  });

  it("sets dateTime attribute to the original ISO string", () => {
    render(<LocalTimestamp isoString={ISO} />);
    expect(screen.getByRole("time")).toHaveAttribute("dateTime", ISO);
  });

  it("forwards className to the time element", () => {
    render(<LocalTimestamp isoString={ISO} className="text-xs" />);
    expect(screen.getByRole("time")).toHaveClass("text-xs");
  });
});
