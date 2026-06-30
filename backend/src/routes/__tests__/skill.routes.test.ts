import request from "supertest";
import express from "express";

jest.mock("@prisma/client", () => {
  const mockPrisma = {
    skill: { findMany: jest.fn() },
  };
  return { PrismaClient: jest.fn(() => mockPrisma) };
});

import { PrismaClient } from "@prisma/client";
import skillRouter from "../skill.routes";

const prismaMock = new PrismaClient() as any;

const app = express();
app.use(express.json());
app.use("/api/skills", skillRouter);

beforeEach(() => {
  jest.clearAllMocks();
});

describe("GET /api/skills", () => {
  it("returns an empty list when q is omitted", async () => {
    const res = await request(app).get("/api/skills");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ skills: [] });
    expect(prismaMock.skill.findMany).not.toHaveBeenCalled();
  });

  it("returns matching skills up to the 10-result limit", async () => {
    prismaMock.skill.findMany.mockResolvedValue([
      { id: "1", name: "React", category: "Frontend" },
      { id: "2", name: "React Native", category: "Mobile" },
    ]);

    const res = await request(app).get("/api/skills?q=rea");

    expect(res.status).toBe(200);
    expect(res.body.skills).toHaveLength(2);
    expect(prismaMock.skill.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { name: { contains: "rea", mode: "insensitive" } },
        take: 10,
      }),
    );
  });
});
