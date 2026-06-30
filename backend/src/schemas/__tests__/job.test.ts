import { createJobSchema } from "../job";

describe("createJobSchema", () => {
  const validJob = {
    title: "Build Stellar escrow flow",
    description: "Implement backend validation for escrow initialization and job creation.",
    budget: 500,
    skills: ["TypeScript"],
    category: "Development",
    deadline: "2026-03-01T00:00:00Z",
  };

  it("requires deadline", () => {
    const result = createJobSchema.safeParse({
      title: "Build Stellar escrow flow",
      description: "Implement backend validation for escrow initialization and job creation.",
      budget: 500,
      skills: ["TypeScript"],
      category: "Development",
    });

    expect(result.success).toBe(false);
    if (result.success) {
      throw new Error("Expected createJobSchema to reject a missing deadline.");
    }

    expect(result.error.issues.some(issue => issue.path.includes("deadline"))).toBe(true);
  });

  it("rejects a zero budget with the platform minimum message", () => {
    const result = createJobSchema.safeParse({ ...validJob, budget: 0 });

    expect(result.success).toBe(false);
    if (result.success) throw new Error("Expected zero budget to be rejected.");
    expect(result.error.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ["budget"],
          message: "Budget must be at least 1 XLM",
        }),
      ]),
    );
  });
});
