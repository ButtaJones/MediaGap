import { describe, expect, it } from "vitest";
import { createZip } from "../src/server/services/zip";

describe("createZip", () => {
  it("creates a basic zip file with central directory", () => {
    const zip = createZip([{ filename: "test.nzb", bytes: Buffer.from("<nzb />") }]);

    expect(zip.readUInt32LE(0)).toBe(0x04034b50);
    expect(zip.includes(Buffer.from("test.nzb"))).toBe(true);
    expect(zip.readUInt32LE(zip.length - 22)).toBe(0x06054b50);
  });
});
