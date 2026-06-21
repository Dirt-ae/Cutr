import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getOriginalPlaybackUrl, getSafePlaybackUrl } from "./videoUrls";

describe("videoUrls", () => {
  const previousWindow = globalThis.window;

  beforeAll(() => {
    globalThis.window = {
      location: {
        origin: "https://app.cutr.test",
      },
    };
  });

  afterAll(() => {
    globalThis.window = previousWindow;
  });

  describe("getSafePlaybackUrl", () => {
    it("returns an empty string when no URL is available", () => {
      expect(getSafePlaybackUrl({ id: "video-1" })).toBe("");
      expect(getSafePlaybackUrl(null)).toBe("");
    });

    it("returns non-HLS playlist URLs unchanged", () => {
      const url = "https://cdn.cutr.test/video.mp4";

      expect(getSafePlaybackUrl({ id: "video-1", url })).toBe(url);
    });

    it("keeps existing local HLS playlist URLs unchanged", () => {
      const url = "/hls/video-1/playlist.m3u8?token=abc";

      expect(getSafePlaybackUrl({ id: "video-1", url })).toBe(url);
    });

    it("rewrites external HLS playlist URLs through the local API route", () => {
      const url = "https://cdn.cutr.test/library/playlist.m3u8?token=abc";

      expect(getSafePlaybackUrl({ id: "video-1", url })).toBe(
        "/hls/video-1/playlist.m3u8?token=abc",
      );
    });

    it("falls back to the local HLS route when playlist URL parsing fails", () => {
      const url = "http://[::zz]/playlist.m3u8";

      expect(getSafePlaybackUrl({ id: "video-1", url })).toBe(
        "/hls/video-1/playlist.m3u8",
      );
    });

    it("returns the original playlist URL when the video has no id", () => {
      const url = "https://cdn.cutr.test/library/playlist.m3u8";

      expect(getSafePlaybackUrl({ url })).toBe(url);
    });
  });

  describe("getOriginalPlaybackUrl", () => {
    it("returns the explicit original URL when present", () => {
      expect(
        getOriginalPlaybackUrl({
          id: "video-1",
          originalUrl: "https://cdn.cutr.test/original.mov",
        }),
      ).toBe("https://cdn.cutr.test/original.mov");
    });

    it("returns the local stream fallback with the supplied query", () => {
      expect(getOriginalPlaybackUrl({ id: "video-1" }, "?download=1")).toBe(
        "/video-stream/video-1?download=1",
      );
    });

    it("returns an empty string when no original URL or id is available", () => {
      expect(getOriginalPlaybackUrl({})).toBe("");
      expect(getOriginalPlaybackUrl(null)).toBe("");
    });
  });
});
