import type { Meta, StoryObj } from "@storybook/react";
import DisputeVoteProgress from "./DisputeVoteProgress";

const meta: Meta<typeof DisputeVoteProgress> = {
  title: "Components/DisputeVoteProgress",
  component: DisputeVoteProgress,
  tags: ["autodocs"],
  argTypes: {
    disputeId: { control: "text" },
    showVoterDetails: { control: "boolean" },
    initialDispute: { control: "object" },
  },
};

export default meta;
type Story = StoryObj<typeof DisputeVoteProgress>;

export const Default: Story = {
  args: {
    disputeId: "dispute-1",
    showVoterDetails: true,
    initialDispute: {
      status: "IN_PROGRESS",
      votesForClient: 3,
      votesForFreelancer: 2,
      minVotes: 7,
      votes: [
        { id: "1", choice: "CLIENT", voter: { walletAddress: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" } },
        { id: "2", choice: "FREELANCER", voter: { walletAddress: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB" } },
      ],
    },
  },
};
