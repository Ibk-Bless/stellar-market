import type { Preview } from "@storybook/react";
import "../src/app/globals.css";
import { ToastProvider } from "../src/components/Toast";

const preview: Preview = {
  decorators: [
    (Story) => (
      <ToastProvider>
        <div className="min-h-screen bg-theme-bg p-6 text-theme-body">
          <Story />
        </div>
      </ToastProvider>
    ),
  ],
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
  },
};

export default preview;
