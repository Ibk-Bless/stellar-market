import "@testing-library/jest-dom";
import type React from "react";
import { render, screen } from "@testing-library/react";
import MobileNavigation from "@/components/MobileNavigation";

let pathname = "/jobs";

jest.mock("next/navigation", () => ({
  usePathname: () => pathname,
}));

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

describe("MobileNavigation", () => {
  it("moves the active indicator after client-side navigation", () => {
    const { rerender } = render(<MobileNavigation />);

    expect(screen.getByRole("link", { name: "Jobs" })).toHaveAttribute("data-active", "true");
    expect(screen.getByRole("link", { name: "Disputes" })).toHaveAttribute("data-active", "false");

    pathname = "/disputes";
    rerender(<MobileNavigation />);

    expect(screen.getByRole("link", { name: "Jobs" })).toHaveAttribute("data-active", "false");
    expect(screen.getByRole("link", { name: "Disputes" })).toHaveAttribute("data-active", "true");
  });
});
