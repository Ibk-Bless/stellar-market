import nodemailer from "nodemailer";
import { config } from "../config";
import { logger } from "../lib/logger";
import { renderPasswordResetEmail } from "../templates/email/password-reset";
import { renderVerificationEmail } from "../templates/email/verification";
import { renderDisputeOpenedEmail } from "../templates/email/dispute-opened";
import { renderDisputeResolvedEmail } from "../templates/email/dispute-resolved";
import { renderMilestoneApprovedEmail } from "../templates/email/milestone-approved";
import { renderPaymentReleasedEmail } from "../templates/email/payment-released";
import { renderApplicationAcceptedEmail } from "../templates/email/application-accepted";

const transporter = nodemailer.createTransport({
  host: config.smtp.host,
  port: config.smtp.port,
  secure: config.smtp.port === 465,
  auth: {
    user: config.smtp.user,
    pass: config.smtp.pass,
  },
});

export class EmailService {
  static async sendVerificationEmail(to: string, token: string): Promise<void> {
    const verifyUrl = `${config.frontendUrl}/auth/verify-email?token=${token}`;
    await this.sendHtml({
      to,
      subject: "Verify Your Email - StellarMarket",
      html: renderVerificationEmail({ verifyUrl }),
    });
  }

  static async sendPasswordResetEmail(
    to: string,
    token: string,
  ): Promise<void> {
    const resetUrl = `${config.frontendUrl}/auth/reset-password?token=${token}`;
    await this.sendHtml({
      to,
      subject: "Reset Your Password - StellarMarket",
      html: renderPasswordResetEmail({ resetUrl }),
    });
  }

  static async sendEventEmail(params: {
    to: string;
    event:
      | "dispute.opened"
      | "dispute.resolved"
      | "milestone.approved"
      | "payment.released"
      | "application.accepted";
    title: string;
    message: string;
    outcome?: string;
    actionUrl?: string;
  }): Promise<void> {
    const { to, event, title, message, outcome, actionUrl } = params;

    const html = (() => {
      switch (event) {
        case "dispute.opened":
          return renderDisputeOpenedEmail({ title, message, actionUrl });
        case "dispute.resolved":
          return renderDisputeResolvedEmail({
            title,
            message,
            outcome,
            actionUrl,
          });
        case "milestone.approved":
          return renderMilestoneApprovedEmail({ title, message, actionUrl });
        case "payment.released":
          return renderPaymentReleasedEmail({ title, message, actionUrl });
        case "application.accepted":
          return renderApplicationAcceptedEmail({ title, message, actionUrl });
      }
    })();

    const subjectPrefix = "StellarMarket";
    await this.sendHtml({
      to,
      subject: `${subjectPrefix} - ${title}`,
      html,
    });
  }

  private static async sendHtml(params: {
    to: string;
    subject: string;
    html: string;
  }): Promise<void> {
    try {
      await transporter.sendMail({
        from: config.smtp.from,
        to: params.to,
        subject: params.subject,
        html: params.html,
      });
    } catch (error) {
      logger.error(
        { err: error, to: params.to, subject: params.subject },
        "Failed to send email",
      );
      throw error;
    }
  }
}
