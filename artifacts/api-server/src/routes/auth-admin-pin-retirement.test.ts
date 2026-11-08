import express from "express";
import request from "supertest";
import { expect, it } from "vitest";
import authRouter from "./auth";

const app = express();
app.use(express.json());
app.use("/api", authRouter);

it("does not expose the retired admin PIN endpoint", async () => {
  expect((await request(app).get("/api/auth/admin-pin")).status).toBe(404);
  expect((await request(app).post("/api/auth/admin-pin").send({ action: "verify", pin: "1234" })).status).toBe(404);
});
