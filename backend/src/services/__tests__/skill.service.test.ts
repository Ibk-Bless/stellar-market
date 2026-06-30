jest.mock("@prisma/client", () => {
  const mockPrisma = {
    skill: { findMany: jest.fn() },
  };
  return { PrismaClient: jest.fn(() => mockPrisma) };
});

import { PrismaClient } from "@prisma/client";
import { normalizeSkills } from "../skill.service";

const prismaMock = new PrismaClient() as any;

beforeEach(() => {
  jest.clearAllMocks();
  prismaMock.skill.findMany.mockResolvedValue([
    { name: "React", aliases: ["ReactJS", "React.js", "react.js"] },
    { name: "Node.js", aliases: ["NodeJS", "Node"] },
  ]);
});

describe("normalizeSkills", () => {
  it("maps alias spellings to the canonical skill name", async () => {
    const result = await normalizeSkills(["ReactJS", "react.js", "NodeJS"]);
    expect(result).toEqual(["React", "Node.js"]);
  });

  it("is case-insensitive when matching the canonical name itself", async () => {
    const result = await normalizeSkills(["react"]);
    expect(result).toEqual(["React"]);
  });

  it("passes through skills with no canonical match unchanged", async () => {
    const result = await normalizeSkills(["Astro", "React"]);
    expect(result).toEqual(["Astro", "React"]);
  });

  it("trims and dedupes the submitted list", async () => {
    const result = await normalizeSkills([" ReactJS ", "react.js", "", "  "]);
    expect(result).toEqual(["React"]);
  });

  it("returns an empty array for an empty submission", async () => {
    const result = await normalizeSkills([]);
    expect(result).toEqual([]);
    expect(prismaMock.skill.findMany).not.toHaveBeenCalled();
  });
});
