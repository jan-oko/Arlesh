import { describe, expect, it } from "vitest";
import { sha1, uuidV5 } from "@/utils/uuid-v5";

const DNS_NAMESPACE = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

describe("sha1", () => {
  it("hashes the FIPS 180 test vectors", () => {
    expect(hex(sha1(new TextEncoder().encode("abc")))).toBe("a9993e364706816aba3e25717850c26c9cd0d89d");
    expect(hex(sha1(new Uint8Array()))).toBe("da39a3ee5e6b4b0d3255bfef95601890afd80709");
    // Two blocks: the padding spills over the first.
    expect(hex(sha1(new TextEncoder().encode("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"))))
      .toBe("84983e441c3bd26ebaae4aa1f95129e5e54670f1");
  });
});

describe("uuidV5", () => {
  it("matches the well-known DNS-namespace vector", () => {
    expect(uuidV5("www.example.com", DNS_NAMESPACE)).toBe("2ed6657d-e927-568b-95e1-2665a8aea6a2");
  });

  it("is deterministic and separates names", () => {
    expect(uuidV5("expectation/1", DNS_NAMESPACE)).toBe(uuidV5("expectation/1", DNS_NAMESPACE));
    expect(uuidV5("expectation/1", DNS_NAMESPACE)).not.toBe(uuidV5("expectation/2", DNS_NAMESPACE));
  });

  it("refuses a namespace that is not a UUID", () => {
    expect(() => uuidV5("x", "not-a-uuid")).toThrow();
  });
});
