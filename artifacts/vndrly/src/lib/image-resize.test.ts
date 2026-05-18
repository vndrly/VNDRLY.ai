// Tests for the logo-upload normalizer. jsdom doesn't ship a real
// canvas implementation, so we stub the bare minimum of the
// HTMLImageElement and HTMLCanvasElement APIs the helper touches.
// These tests verify the *shape* of the contract — what gets passed
// through unchanged, what gets renamed, what dimensions land on the
// canvas — rather than pixel-level rendering, which is the browser's
// job.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  compressMainLogo,
  cropToSquare,
  fitImageIntoSquare,
  isSquareWithinTolerance,
} from "./image-resize";

type DrawCall = {
  width: number;
  height: number;
  // For the 5-arg drawImage(img, dx, dy, dw, dh) form these are the
  // destination coords; for the 9-arg drawImage(img, sx, sy, sw, sh,
  // dx, dy, dw, dh) form `src*` are populated and `draw*` are the
  // destination coords. We collapse both forms into one shape so the
  // tests can match either.
  drawX: number;
  drawY: number;
  drawW: number;
  drawH: number;
  srcX?: number;
  srcY?: number;
  srcW?: number;
  srcH?: number;
};

let drawCalls: DrawCall[] = [];

function installCanvasStub(width: number, height: number) {
  drawCalls = [];
  const origCreateElement = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
    if (tag !== "canvas") return origCreateElement(tag);
    const canvas = origCreateElement("canvas") as HTMLCanvasElement;
    let w = 0;
    let h = 0;
    Object.defineProperty(canvas, "width", {
      configurable: true,
      get: () => w,
      set: (v: number) => {
        w = v;
      },
    });
    Object.defineProperty(canvas, "height", {
      configurable: true,
      get: () => h,
      set: (v: number) => {
        h = v;
      },
    });
    canvas.getContext = vi.fn(() => ({
      imageSmoothingEnabled: true,
      imageSmoothingQuality: "high",
      clearRect: vi.fn(),
      drawImage: vi.fn((..._args: number[]) => {
        const args = _args as unknown as [unknown, ...number[]];
        if (args.length === 5) {
          const [, drawX, drawY, drawW, drawH] = args as unknown as [
            unknown,
            number,
            number,
            number,
            number,
          ];
          drawCalls.push({ width: w, height: h, drawX, drawY, drawW, drawH });
        } else if (args.length === 9) {
          const [, srcX, srcY, srcW, srcH, drawX, drawY, drawW, drawH] =
            args as unknown as [
              unknown,
              number,
              number,
              number,
              number,
              number,
              number,
              number,
              number,
            ];
          drawCalls.push({
            width: w,
            height: h,
            drawX,
            drawY,
            drawW,
            drawH,
            srcX,
            srcY,
            srcW,
            srcH,
          });
        }
      }),
    })) as unknown as HTMLCanvasElement["getContext"];
    canvas.toBlob = vi.fn((cb: BlobCallback) => {
      cb(new Blob(["fake-png-bytes"], { type: "image/png" }));
    });
    return canvas;
  });

  // jsdom's Image fires onerror because it can't decode anything.
  // Replace it with a constructor that resolves to fixed dimensions.
  const RealImage = window.Image;
  class FakeImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    naturalWidth = width;
    naturalHeight = height;
    set src(_v: string) {
      queueMicrotask(() => this.onload?.());
    }
  }
  // @ts-expect-error overriding global for the duration of the test
  window.Image = FakeImage;
  return () => {
    window.Image = RealImage;
  };
}

beforeEach(() => {
  // jsdom lacks createObjectURL/revokeObjectURL by default.
  if (!URL.createObjectURL) {
    URL.createObjectURL = vi.fn(() => "blob:mock");
    URL.revokeObjectURL = vi.fn();
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fitImageIntoSquare", () => {
  it("passes SVG inputs through unchanged", async () => {
    const svg = new File(["<svg/>"], "logo.svg", { type: "image/svg+xml" });
    const result = await fitImageIntoSquare(svg);
    expect(result).toBe(svg);
  });

  it("centers a wide image with vertical padding", async () => {
    const restore = installCanvasStub(1000, 500);
    try {
      const file = new File(["x"], "wide.png", { type: "image/png" });
      const out = await fitImageIntoSquare(file, 512);
      expect(drawCalls).toHaveLength(1);
      const call = drawCalls[0]!;
      // width fills the canvas, height is letterboxed
      expect(call.drawW).toBe(512);
      expect(call.drawH).toBe(256);
      expect(call.drawX).toBe(0);
      expect(call.drawY).toBe(128);
      expect(out.type).toBe("image/png");
      expect(out.name).toMatch(/\.png$/);
    } finally {
      restore();
    }
  });

  it("centers a tall image with horizontal padding", async () => {
    const restore = installCanvasStub(500, 1000);
    try {
      const file = new File(["x"], "tall.jpg", { type: "image/jpeg" });
      const out = await fitImageIntoSquare(file, 512);
      const call = drawCalls[0]!;
      expect(call.drawW).toBe(256);
      expect(call.drawH).toBe(512);
      expect(call.drawX).toBe(128);
      expect(call.drawY).toBe(0);
      expect(out.name).toMatch(/-square-512\.png$/);
    } finally {
      restore();
    }
  });

  it("downscales a square image to the target size", async () => {
    const restore = installCanvasStub(2000, 2000);
    try {
      const file = new File(["x"], "big.png", { type: "image/png" });
      await fitImageIntoSquare(file, 256);
      const call = drawCalls[0]!;
      expect(call.width).toBe(256);
      expect(call.height).toBe(256);
      expect(call.drawW).toBe(256);
      expect(call.drawH).toBe(256);
      expect(call.drawX).toBe(0);
      expect(call.drawY).toBe(0);
    } finally {
      restore();
    }
  });

  it("rejects images with no decoded dimensions", async () => {
    const restore = installCanvasStub(0, 0);
    try {
      const file = new File(["x"], "broken.png", { type: "image/png" });
      await expect(fitImageIntoSquare(file)).rejects.toThrow(
        /no dimensions/,
      );
    } finally {
      restore();
    }
  });

  it("sanitizes the original filename stem", async () => {
    const restore = installCanvasStub(100, 100);
    try {
      const file = new File(["x"], "weird name!@#.jpg", { type: "image/jpeg" });
      const out = await fitImageIntoSquare(file, 64);
      // " " + "!" + "@" + "#" → 4 underscores; the trailing "-square-..." stays.
      expect(out.name).toBe("weird_name___-square-64.png");
    } finally {
      restore();
    }
  });
});

describe("compressMainLogo", () => {
  it("passes SVG inputs through unchanged", async () => {
    const svg = new File(["<svg/>"], "logo.svg", { type: "image/svg+xml" });
    const result = await compressMainLogo(svg);
    expect(result).toBe(svg);
  });

  it("scales a wide image so its longest edge equals maxLongestEdge while preserving aspect ratio", async () => {
    const restore = installCanvasStub(4000, 1000);
    try {
      const file = new File(["x"], "wide.png", { type: "image/png" });
      const out = await compressMainLogo(file, 1024);
      expect(drawCalls).toHaveLength(1);
      const call = drawCalls[0]!;
      // longest = 4000 → scale = 1024/4000 = 0.256 → 1024 × 256
      expect(call.width).toBe(1024);
      expect(call.height).toBe(256);
      expect(call.drawW).toBe(1024);
      expect(call.drawH).toBe(256);
      expect(out.type).toBe("image/png");
      expect(out.name).toMatch(/-main-1024\.png$/);
    } finally {
      restore();
    }
  });

  it("scales a tall image down to the longest-edge cap", async () => {
    const restore = installCanvasStub(800, 3200);
    try {
      const file = new File(["x"], "tall.jpg", { type: "image/jpeg" });
      await compressMainLogo(file, 1024);
      const call = drawCalls[0]!;
      // longest = 3200 → scale = 1024/3200 = 0.32 → 256 × 1024
      expect(call.width).toBe(256);
      expect(call.height).toBe(1024);
    } finally {
      restore();
    }
  });

  it("never upscales an image already within the cap", async () => {
    const restore = installCanvasStub(400, 200);
    try {
      const file = new File(["x"], "small.png", { type: "image/png" });
      await compressMainLogo(file, 1024);
      const call = drawCalls[0]!;
      // already within cap → keep original dimensions
      expect(call.width).toBe(400);
      expect(call.height).toBe(200);
    } finally {
      restore();
    }
  });

  it("rejects images with no decoded dimensions", async () => {
    const restore = installCanvasStub(0, 0);
    try {
      const file = new File(["x"], "broken.png", { type: "image/png" });
      await expect(compressMainLogo(file)).rejects.toThrow(/no dimensions/);
    } finally {
      restore();
    }
  });
});

describe("cropToSquare", () => {
  it("passes SVG inputs through unchanged", async () => {
    const svg = new File(["<svg/>"], "logo.svg", { type: "image/svg+xml" });
    const result = await cropToSquare(svg, { x: 0, y: 0, width: 100, height: 100 });
    expect(result).toBe(svg);
  });

  it("draws the requested source region into a 512×512 canvas", async () => {
    const restore = installCanvasStub(2000, 1000);
    try {
      const file = new File(["x"], "wide.png", { type: "image/png" });
      const out = await cropToSquare(
        file,
        { x: 500, y: 100, width: 800, height: 800 },
        512,
      );
      expect(drawCalls).toHaveLength(1);
      const call = drawCalls[0]!;
      expect(call.width).toBe(512);
      expect(call.height).toBe(512);
      expect(call.srcX).toBe(500);
      expect(call.srcY).toBe(100);
      expect(call.srcW).toBe(800);
      expect(call.srcH).toBe(800);
      expect(call.drawX).toBe(0);
      expect(call.drawY).toBe(0);
      expect(call.drawW).toBe(512);
      expect(call.drawH).toBe(512);
      expect(out.name).toMatch(/-square-512\.png$/);
    } finally {
      restore();
    }
  });
});

describe("isSquareWithinTolerance", () => {
  it("returns true for SVG without decoding", async () => {
    const svg = new File(["<svg/>"], "logo.svg", { type: "image/svg+xml" });
    expect(await isSquareWithinTolerance(svg)).toBe(true);
  });

  it("returns true for an exactly-square image", async () => {
    const restore = installCanvasStub(500, 500);
    try {
      const file = new File(["x"], "sq.png", { type: "image/png" });
      expect(await isSquareWithinTolerance(file)).toBe(true);
    } finally {
      restore();
    }
  });

  it("returns true within the default 2% tolerance", async () => {
    const restore = installCanvasStub(500, 510); // ratio ≈ 0.98
    try {
      const file = new File(["x"], "near.png", { type: "image/png" });
      expect(await isSquareWithinTolerance(file)).toBe(true);
    } finally {
      restore();
    }
  });

  it("returns false for a clearly wide image", async () => {
    const restore = installCanvasStub(1000, 300);
    try {
      const file = new File(["x"], "wide.png", { type: "image/png" });
      expect(await isSquareWithinTolerance(file)).toBe(false);
    } finally {
      restore();
    }
  });
});

describe("canvas.toBlob failure handling", () => {
  // Reinstall the canvas stub but make toBlob hand back null so we
  // can verify each helper rejects with a meaningful error rather
  // than calling its callback with `undefined` (which would crash
  // downstream as a fake "File").
  function installNullToBlobStub(width: number, height: number) {
    drawCalls = [];
    const origCreateElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      if (tag !== "canvas") return origCreateElement(tag);
      const canvas = origCreateElement("canvas") as HTMLCanvasElement;
      let w = 0;
      let h = 0;
      Object.defineProperty(canvas, "width", {
        configurable: true,
        get: () => w,
        set: (v: number) => {
          w = v;
        },
      });
      Object.defineProperty(canvas, "height", {
        configurable: true,
        get: () => h,
        set: (v: number) => {
          h = v;
        },
      });
      canvas.getContext = vi.fn(() => ({
        imageSmoothingEnabled: true,
        imageSmoothingQuality: "high",
        clearRect: vi.fn(),
        drawImage: vi.fn(),
      })) as unknown as HTMLCanvasElement["getContext"];
      canvas.toBlob = vi.fn((cb: BlobCallback) => {
        cb(null);
      });
      return canvas;
    });
    const RealImage = window.Image;
    class FakeImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      naturalWidth = width;
      naturalHeight = height;
      set src(_v: string) {
        queueMicrotask(() => this.onload?.());
      }
    }
    // @ts-expect-error overriding global for the duration of the test
    window.Image = FakeImage;
    return () => {
      window.Image = RealImage;
    };
  }

  it("fitImageIntoSquare rejects when toBlob returns null", async () => {
    const restore = installNullToBlobStub(100, 100);
    try {
      const file = new File(["x"], "x.png", { type: "image/png" });
      await expect(fitImageIntoSquare(file)).rejects.toThrow(
        /toBlob returned null/,
      );
    } finally {
      restore();
    }
  });

  it("compressMainLogo rejects when toBlob returns null", async () => {
    const restore = installNullToBlobStub(2000, 1000);
    try {
      const file = new File(["x"], "x.png", { type: "image/png" });
      await expect(compressMainLogo(file)).rejects.toThrow(
        /toBlob returned null/,
      );
    } finally {
      restore();
    }
  });

  it("cropToSquare rejects when toBlob returns null", async () => {
    const restore = installNullToBlobStub(1000, 1000);
    try {
      const file = new File(["x"], "x.png", { type: "image/png" });
      await expect(
        cropToSquare(file, { x: 0, y: 0, width: 100, height: 100 }),
      ).rejects.toThrow(/toBlob returned null/);
    } finally {
      restore();
    }
  });
});
