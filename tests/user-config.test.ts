import { describe, expect, it } from "vitest";

import {
  parseBooleanConfigValue,
  parseStyleCommitCount,
  parseUserConfig,
  resolveStyleCommitCount,
} from "../src/config/user-config.js";

describe("user config", () => {
  it("parses non-negative style commit counts", () => {
    expect(parseStyleCommitCount(undefined)).toBe(5);
    expect(parseStyleCommitCount("0")).toBe(0);
    expect(parseStyleCommitCount("10")).toBe(10);
  });

  it("rejects invalid style commit counts", () => {
    expect(() => parseStyleCommitCount("-1")).toThrow(
      "--style-commits must be a non-negative integer.",
    );
    expect(() => parseStyleCommitCount("1.5")).toThrow(
      "--style-commits must be a non-negative integer.",
    );
    expect(() => parseStyleCommitCount("abc")).toThrow(
      "--style-commits must be a non-negative integer.",
    );
  });

  it("parses boolean config values", () => {
    expect(parseBooleanConfigValue("true")).toBe(true);
    expect(parseBooleanConfigValue("YES")).toBe(true);
    expect(parseBooleanConfigValue("0")).toBe(false);
    expect(parseBooleanConfigValue("off")).toBe(false);
  });

  it("validates parsed user config shape", () => {
    expect(parseUserConfig('{"styleCommits":3,"styleMatch":false}')).toEqual({
      styleCommits: 3,
      styleMatch: false,
    });

    expect(() => parseUserConfig("[]")).toThrow("Invalid config");
    expect(() => parseUserConfig('{"styleCommits":-1}')).toThrow(
      "Config value styleCommits must be a non-negative integer.",
    );
    expect(() => parseUserConfig('{"styleMatch":"false"}')).toThrow(
      "Config value styleMatch must be true or false.",
    );
  });

  it("resolves style commit count with CLI options taking precedence", () => {
    expect(resolveStyleCommitCount({}, {})).toBe(5);
    expect(resolveStyleCommitCount({}, { styleCommits: 8 })).toBe(8);
    expect(resolveStyleCommitCount({}, { styleMatch: false, styleCommits: 8 })).toBe(0);
    expect(resolveStyleCommitCount({ styleCommits: "2" }, { styleCommits: 8 })).toBe(2);
    expect(resolveStyleCommitCount({ styleMatch: false, styleCommits: "2" }, {})).toBe(0);
  });
});
