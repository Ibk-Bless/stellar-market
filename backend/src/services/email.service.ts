import nodemailer from "nodemailer";
import { config } from "../config";
import { logger } from "../lib/logger";
import { renderEmailTemplate } from "../utils/emailTemplateRenderer";

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
    
    // Render the email body
    const bodyHtml = renderEmailTemplate("verification", { verifyUrl });
    
    // Render the full layout
    const html = renderEmailTemplate("layout", {
      title: "Verify your email",
      preheader: "Confirm your email address to finish setting up your account.",
      bodyHtml,
      actionUrl: verifyUrl,
      actionLabel: "Verify email",
    });
    
    await this.sendHtml({
      to,
      subject: "Verify Your Email - StellarMarket",
      html,
    });
  }

  static async sendPasswordResetEmail(
    to: string,
    token: string,
  ): Promise<void> {
    const resetUrl = `${config.frontendUrl}/auth/reset-password?token=${token}`;
    
    // Render the email body
    const bodyHtml = renderEmailTemplate("password-reset", { resetUrl });
    
    // Render the full layout
    const html = renderEmailTemplate("layout", {
      title: "Reset your password",
      preheader: "Use this link to reset your StellarMarket password.",
      bodyHtml,
      actionUrl: resetUrl,
      actionLabel: "Reset password",
    });
    
    await this.sendHtml({
      to,
      subject: "Reset Your Password - StellarMarket",
      html,
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

    let bodyHtml: string;
    let preheader: string;
    let actionLabel: string | undefined;

    switch (event) {
      case "dispute.opened":
        bodyHtml = renderEmailTemplate("dispute-opened", { message, actionUrl });
        preheader = "A dispute was opened on your job.";
        actionLabel = actionUrl ? "View dispute" : undefined;
        break;
      case "dispute.resolved":
        const outcomeText =
          outcome === "CLIENT"
            ? "The dispute was resolved in favor of the client."
            : outcome === "FREELANCER"
              ? "The dispute was resolved in favor of the freelancer."
              : "The dispute has been resolved.";
        bodyHtml = renderEmailTemplate("dispute-resolved", {
          message,
          outcomeText,
          actionUrl,
        });
        preheader = "Your dispute has been resolved.";
        actionLabel = actionUrl ? "View job details" : undefined;
        break;
      case "milestone.approved":
        bodyHtml = renderEmailTemplate("milestone-approved", { message, actionUrl });
        preheader = "A milestone was approved.";
        actionLabel = actionUrl ? "View job" : undefined;
        break;
      case "payment.released":
        bodyHtml = renderEmailTemplate("payment-released", { message, actionUrl });
        preheader = "A payment was released to you.";
        actionLabel = actionUrl ? "View details" : undefined;
        break;
      case "application.accepted":
        bodyHtml = renderEmailTemplate("application-accepted", { message, actionUrl });
        preheader = "Your application was accepted.";
        actionLabel = actionUrl ? "Open StellarMarket" : undefined;
        break;
    }

    const html = renderEmailTemplate("layout", {
      title,
      preheader,
      bodyHtml,
      actionUrl,
      actionLabel,
    });

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
