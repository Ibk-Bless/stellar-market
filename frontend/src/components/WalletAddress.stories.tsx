import type { Meta, StoryObj } from "@storybook/react";
import WalletAddress from "./WalletAddress";

const meta: Meta<typeof WalletAddress> = {
  title: "Components/WalletAddress",
  component: WalletAddress,
  tags: ["autodocs"],
  argTypes: {
    address: { control: "text" },
    className: { control: "text" },
  },
};

export default meta;
type Story = StoryObj<typeof WalletAddress>;

export const Default: Story = {
  args: {
    address: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  },
};
