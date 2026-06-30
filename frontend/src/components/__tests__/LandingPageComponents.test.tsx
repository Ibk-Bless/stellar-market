import "@testing-library/jest-dom";
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import HeroSection from "@/components/landing/HeroSection";
import StatsSection from "@/components/landing/StatsSection";
import HowItWorksSection from "@/components/landing/HowItWorksSection";
import FeaturedJobsCarousel from "@/components/landing/FeaturedJobsCarousel";
import CTASection from "@/components/landing/CTASection";
import axios from "axios";

// Mock next/link
jest.mock("next/link", () => {
  const MockedLink = ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  );
  MockedLink.displayName = "Link";
  return MockedLink;
});

// Mock AuthContext
interface MockUser {
  id: string;
  role: "FREELANCER" | "CLIENT";
}
let mockUser: MockUser | null = null;
jest.mock("@/context/AuthContext", () => ({
  useAuth: () => ({
    user: mockUser,
  }),
}));

// Mock axios
jest.mock("axios");
const mockedAxios = axios as jest.Mocked<typeof axios>; // eslint-disable-line @typescript-eslint/no-unused-vars

describe("Landing Page Components", () => {
  beforeEach(() => {
    mockUser = null;
    jest.clearAllMocks();
  });

  describe("Hero Section", () => {
    it("renders headline and primary CTA without auth state", () => {
      render(<HeroSection />);
      expect(screen.getByText(/Work Without Borders/i)).toBeInTheDocument();
      expect(screen.getByText(/Post a Job/i)).toBeInTheDocument();
      expect(screen.queryByText(/Go to Dashboard/i)).not.toBeInTheDocument();
    });

    it("renders dashboard shortcut when auth state is provided", () => {
      mockUser = { id: "user1", role: "FREELANCER" };
      render(<HeroSection />);
      expect(screen.getByText(/Go to Dashboard/i)).toBeInTheDocument();
      expect(screen.queryByText(/Post a Job/i)).not.toBeInTheDocument();
    });
  });

  describe("CTA Section", () => {
    it("renders with correct action button for unauthenticated users", () => {
      render(<CTASection />);
      expect(screen.getByText(/Get Started Now/i)).toBeInTheDocument();
      expect(screen.getByText(/Log In/i)).toBeInTheDocument();
      expect(screen.queryByText(/Go to Dashboard/i)).not.toBeInTheDocument();
    });

    it("renders with correct action button for authenticated users", () => {
      mockUser = { id: "user1", role: "FREELANCER" };
      render(<CTASection />);
      expect(screen.getByText(/Go to Dashboard/i)).toBeInTheDocument();
      expect(screen.getByText(/Browse Jobs/i)).toBeInTheDocument();
      expect(screen.queryByText(/Get Started Now/i)).not.toBeInTheDocument();
    });
  });

  describe("How It Works Section", () => {
    it("renders all steps", () => {
      render(<HowItWorksSection />);
      expect(screen.getByText("Post a Job")).toBeInTheDocument();
      expect(screen.getByText("Get Applications")).toBeInTheDocument();
      expect(screen.getByText("Escrow Funded")).toBeInTheDocument();
      expect(screen.getByText("Work & Pay")).toBeInTheDocument();
    });
  });

  describe("Stats Section", () => {
    it("renders each stat label and value when data is provided", async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: {
          totalJobs: 1500,
          totalFreelancers: 5000,
          totalEscrowXlm: 2500000, // 2.5M
          resolvedDisputesPct: 99,
        },
      });

      render(<StatsSection />);
      
      await waitFor(() => {
        expect(screen.getByText(/1[,\s\xA0]500\+/)).toBeInTheDocument();
        expect(screen.getByText(/5[,\s\xA0]000\+/)).toBeInTheDocument();
        expect(screen.getByText("2.5M")).toBeInTheDocument();
        expect(screen.getByText("99%")).toBeInTheDocument();
      });
    });

    it("renders the error/fallback state when the API returns an error", async () => {
      mockedAxios.get.mockRejectedValueOnce(new Error("API Error"));

      render(<StatsSection />);
      
      await waitFor(() => {
        expect(screen.getByText("2,400+")).toBeInTheDocument();
        expect(screen.getByText("8,100+")).toBeInTheDocument();
        expect(screen.getByText("1.2M")).toBeInTheDocument();
        expect(screen.getByText("98%")).toBeInTheDocument();
      });
    });
  });

  describe("Featured Jobs Carousel", () => {
    it("renders a job card for each job in the mock data", async () => {
      const mockJobs = [
        {
          id: "job1",
          title: "Senior Rust Dev",
          budget: 5000,
          status: "OPEN",
          createdAt: new Date().toISOString(),
          client: { id: "c1", username: "stellar_corp" },
          skills: ["Rust", "Soroban"],
        },
        {
          id: "job2",
          title: "Frontend React Engineer",
          budget: 3000,
          status: "OPEN",
          createdAt: new Date().toISOString(),
          client: { id: "c2", username: "defidev" },
          skills: ["React"],
        },
      ];

      mockedAxios.get.mockResolvedValueOnce({
        data: { data: mockJobs, total: 2 },
      });

      render(<FeaturedJobsCarousel />);

      await waitFor(() => {
        expect(screen.getByText("Senior Rust Dev")).toBeInTheDocument();
        expect(screen.getByText("Frontend React Engineer")).toBeInTheDocument();
      });
    });

    it("renders the empty state when an empty array is returned", async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: { data: [], total: 0 },
      });

      render(<FeaturedJobsCarousel />);

      await waitFor(() => {
        expect(screen.getByText(/No featured jobs/i)).toBeInTheDocument();
      });
    });
  });
});
