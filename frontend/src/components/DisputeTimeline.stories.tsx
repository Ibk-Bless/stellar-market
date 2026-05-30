import type { Meta, StoryObj } from "@storybook/react";
import DisputeTimeline from "./DisputeTimeline";

const meta: Meta<typeof DisputeTimeline> = {
  title: "Components/DisputeTimeline",
  component: DisputeTimeline,
  tags: ["autodocs"],
  argTypes: {
    events: { control: "object" },
  },
};

export default meta;
type Story = StoryObj<typeof DisputeTimeline>;

export const Default: Story = {
  args: {
    events: [
      { id: "1", title: "Dispute raised", actor: "Client", timestamp: "2026-05-27T12:00:00Z", status: "open" },
      { id: "2", title: "Freelancer response submitted", actor: "Freelancer", timestamp: "2026-05-27T15:30:00Z", status: "pending" },
      { id: "3", title: "Resolution proposed", actor: "Moderator", timestamp: "2026-05-28T09:15:00Z", status: "resolved" },
    ],
  },
};
