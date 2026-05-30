import type { Meta, StoryObj } from "@storybook/react";
import MilestoneTracker from "./MilestoneTracker";

const meta: Meta<typeof MilestoneTracker> = {
  title: "Components/MilestoneTracker",
  component: MilestoneTracker,
  tags: ["autodocs"],
  argTypes: {
    milestones: { control: "object" },
  },
};

export default meta;
type Story = StoryObj<typeof MilestoneTracker>;

export const Default: Story = {
  args: {
    milestones: [
      { id: "1", title: "Design handoff", amount: 250, status: "APPROVED" },
      { id: "2", title: "Frontend implementation", amount: 700, status: "IN_PROGRESS" },
      { id: "3", title: "Launch support", amount: 300, status: "PENDING" },
    ],
  },
};
