const DEFAULT_MAX_WIDTH = 1024;
const DEFAULT_MAX_HEIGHT = 1280;
const DEFAULT_JPEG_QUALITY = 0.8;

function scaledDimensions(
  width: number,
  height: number,
  maxWidth: number,
  maxHeight: number
) {
  if (width <= 0 || height <= 0) {
    throw new Error("Video dimensions are invalid");
  }

  const scale = Math.min(maxWidth / width, maxHeight / height, 1);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export async function captureVideoFrameBlob(
  video: HTMLVideoElement,
  options?: {
    maxWidth?: number;
    maxHeight?: number;
    type?: "image/jpeg" | "image/png";
    quality?: number;
  }
): Promise<Blob> {
  const maxWidth = options?.maxWidth ?? DEFAULT_MAX_WIDTH;
  const maxHeight = options?.maxHeight ?? DEFAULT_MAX_HEIGHT;
  const type = options?.type ?? "image/jpeg";
  const quality = options?.quality ?? DEFAULT_JPEG_QUALITY;

  const { width, height } = scaledDimensions(
    video.videoWidth,
    video.videoHeight,
    maxWidth,
    maxHeight
  );

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Failed to create canvas context");
  }

  ctx.drawImage(video, 0, 0, width, height);

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, type, quality);
  });

  if (!blob) {
    throw new Error("Failed to encode camera frame");
  }

  return blob;
}
