import { middleware } from "@/middleware";
import type { NextRequest } from "next/server";

// Mock next/server
jest.mock("next/server", () => {
  return {
    NextResponse: {
      next: jest.fn().mockReturnValue({ headers: new Map() }),
      redirect: jest.fn((url) => ({ headers: new Map([["Location", url.toString()]]) })),
    },
  };
});

describe("Middleware Routing", () => {
  it("allows unauthenticated access to / without redirecting", () => {
    const req = {
      nextUrl: { pathname: "/" },
      cookies: { get: () => undefined },
      url: "http://localhost:3000/",
    } as unknown as NextRequest;
    
    const res = middleware(req);
    expect(res.headers.get("Location")).toBeUndefined();
  });

  it("allows authenticated access to / without redirecting", () => {
    const req = {
      nextUrl: { pathname: "/" },
      cookies: { get: () => ({ value: "fake-token" }) },
      url: "http://localhost:3000/",
    } as unknown as NextRequest;
    
    const res = middleware(req);
    expect(res.headers.get("Location")).toBeUndefined();
  });

  it("redirects unauthenticated users from /dashboard to /auth/login", () => {
    const req = {
      nextUrl: { pathname: "/dashboard" },
      cookies: { get: () => undefined },
      url: "http://localhost:3000/dashboard",
    } as unknown as NextRequest;
    
    const res = middleware(req);
    expect(res.headers.get("Location")).toBe("http://localhost:3000/auth/login");
  });

  it("redirects authenticated users from /auth/login to /dashboard", () => {
    const req = {
      nextUrl: { pathname: "/auth/login" },
      cookies: { get: () => ({ value: "fake-token" }) },
      url: "http://localhost:3000/auth/login",
    } as unknown as NextRequest;
    
    const res = middleware(req);
    expect(res.headers.get("Location")).toBe("http://localhost:3000/dashboard");
  });
});
