const getSignedUrl = jest.fn();

jest.mock("@aws-sdk/s3-request-presigner", () => ({ getSignedUrl }));
jest.mock("../../config", () => ({
  config: {
    evidenceStorage: {
      bucket: "private-evidence",
      region: "us-east-1",
      endpoint: undefined,
      forcePathStyle: false,
    },
  },
}));

import {
  createEvidenceDownloadUrl,
  EVIDENCE_DOWNLOAD_EXPIRY_SECONDS,
} from "../evidence-storage.service";

describe("evidence download signing", () => {
  it("creates a new 60-second signed URL for every download request", async () => {
    getSignedUrl
      .mockResolvedValueOnce("https://signed.example/first")
      .mockResolvedValueOnce("https://signed.example/second");

    const first = await createEvidenceDownloadUrl({
      key: "disputes/dispute-1/file.pdf",
      filename: "file.pdf",
      contentType: "application/pdf",
    });
    const second = await createEvidenceDownloadUrl({
      key: "disputes/dispute-1/file.pdf",
      filename: "file.pdf",
      contentType: "application/pdf",
    });

    expect(first).not.toBe(second);
    expect(getSignedUrl).toHaveBeenCalledTimes(2);
    expect(getSignedUrl).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.anything(),
      { expiresIn: EVIDENCE_DOWNLOAD_EXPIRY_SECONDS },
    );
  });
});
