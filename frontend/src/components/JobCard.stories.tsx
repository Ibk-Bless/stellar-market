import type { Meta, StoryObj } from "@storybook/react";
import JobCard from "./JobCard";

const meta: Meta<typeof JobCard> = {
  title: "Components/JobCard",
  component: JobCard,
  tags: ["autodocs"],
  decorators: [(Story) => <div className="max-w-md"><Story /></div>],
  argTypes: {
    job: { control: "object" },
    index: { control: "number" },
    viewer: { control: "object" },
  },
};

export default meta;
type Story = StoryObj<typeof JobCard>;

export const Default: Story = {
  args: {
    index: 0,
    viewer: { id: "freelancer-1", role: "FREELANCER" },
    job: {
      id: "job-1",
      title: "Build a Stellar escrow dashboard",
      description: "Create a responsive dashboard for managing escrow-backed freelance milestones.",
      budget: 1200,
      category: "Development",
      skills: ["Next.js", "Stellar", "Tailwind"],
      deadline: "2026-06-30T00:00:00Z",
      status: "OPEN",
      escrowStatus: "UNFUNDED",
      createdAt: "2026-05-28T10:00:00Z",
      client: {
        id: "client-1",
        username: "stellarfoundry",
        walletAddress: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        role: "CLIENT",
      },
      milestones: [],
      _count: { applications: 7 },
    },
  },
};
