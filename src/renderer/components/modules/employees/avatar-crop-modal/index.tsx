import { t } from "@shared/l10n";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "../../../button";
import { Modal } from "../../../modal";
import "./index.css";

const VIEWPORT_SIZE = 320;
const CROP_SIZE = 240;
const CROP_MARGIN = (VIEWPORT_SIZE - CROP_SIZE) / 2; // 40px
const CROP_RADIUS = 20;
const OUTPUT_SIZE = 512;
const MIN_ZOOM = 1.0;
const MAX_ZOOM = 4.0;

export interface AvatarCropModalProps {
  open: boolean;
  imageFile: File | null;
  onClose: () => void;
  onConfirm: (croppedData: Uint8Array) => Promise<void>;
}

/**
 * 交互式图片平移、缩放与正方形区域裁切并导出头像数据的模态对话框。
 */
export function AvatarCropModal({
  open,
  imageFile,
  onClose,
  onConfirm,
}: AvatarCropModalProps): React.JSX.Element | null {
  const [loadedImg, setLoadedImg] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1.0);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const miniCanvasRef = useRef<HTMLCanvasElement>(null);

  const stateRef = useRef({
    zoom: 1.0,
    offset: { x: 0, y: 0 },
    baseScale: 1.0,
    img: null as HTMLImageElement | null,
  });

  const dragRef = useRef<{
    isDragging: boolean;
    lastX: number;
    lastY: number;
  }>({
    isDragging: false,
    lastX: 0,
    lastY: 0,
  });

  // Calculate base scale so image covers the crop box at 1.0x zoom.
  const getBaseScale = useCallback((img: HTMLImageElement) => {
    return Math.max(
      CROP_SIZE / img.naturalWidth,
      CROP_SIZE / img.naturalHeight,
    );
  }, []);

  // Clamp offset so the image strictly and completely covers the crop box.
  const clampOffset = useCallback(
    (x: number, y: number, currentScale: number, img: HTMLImageElement) => {
      const renderW = img.naturalWidth * currentScale;
      const renderH = img.naturalHeight * currentScale;
      const minX = CROP_MARGIN + CROP_SIZE - renderW;
      const maxX = CROP_MARGIN;
      const minY = CROP_MARGIN + CROP_SIZE - renderH;
      const maxY = CROP_MARGIN;
      return {
        x: Math.min(maxX, Math.max(minX, x)),
        y: Math.min(maxY, Math.max(minY, y)),
      };
    },
    [],
  );

  // Redraw main viewport canvas.
  const redrawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const img = stateRef.current.img;
    if (!canvas || !img) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const currentScale = stateRef.current.baseScale * stateRef.current.zoom;
    const currentOffset = stateRef.current.offset;

    const renderW = img.naturalWidth * currentScale;
    const renderH = img.naturalHeight * currentScale;

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, VIEWPORT_SIZE, VIEWPORT_SIZE);

    // 1. Dark canvas background
    ctx.fillStyle = "#121212";
    ctx.fillRect(0, 0, VIEWPORT_SIZE, VIEWPORT_SIZE);

    // 2. Draw image with guaranteed aspect ratio
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(
      img,
      currentOffset.x,
      currentOffset.y,
      renderW,
      renderH,
    );

    // 3. Draw semi-transparent mask outside crop area
    ctx.fillStyle = "rgba(0, 0, 0, 0.65)";
    ctx.beginPath();
    ctx.rect(0, 0, VIEWPORT_SIZE, VIEWPORT_SIZE);
    if (typeof ctx.roundRect === "function") {
      ctx.roundRect(
        CROP_MARGIN,
        CROP_MARGIN,
        CROP_SIZE,
        CROP_SIZE,
        CROP_RADIUS,
      );
    } else {
      ctx.rect(CROP_MARGIN, CROP_MARGIN, CROP_SIZE, CROP_SIZE);
    }
    ctx.fill("evenodd");

    // 4. Draw crop rounded border
    ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    if (typeof ctx.roundRect === "function") {
      ctx.roundRect(
        CROP_MARGIN,
        CROP_MARGIN,
        CROP_SIZE,
        CROP_SIZE,
        CROP_RADIUS,
      );
    } else {
      ctx.rect(CROP_MARGIN, CROP_MARGIN, CROP_SIZE, CROP_SIZE);
    }
    ctx.stroke();

    // 5. Draw faint circular guide
    ctx.strokeStyle = "rgba(255, 255, 255, 0.28)";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.arc(
      VIEWPORT_SIZE / 2,
      VIEWPORT_SIZE / 2,
      CROP_SIZE / 2,
      0,
      Math.PI * 2,
    );
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.restore();

    // 6. Draw mini preview
    const mini = miniCanvasRef.current;
    if (mini) {
      const miniCtx = mini.getContext("2d");
      if (miniCtx) {
        miniCtx.clearRect(0, 0, mini.width, mini.height);
        const srcX = (CROP_MARGIN - currentOffset.x) / currentScale;
        const srcY = (CROP_MARGIN - currentOffset.y) / currentScale;
        const srcW = CROP_SIZE / currentScale;
        const srcH = CROP_SIZE / currentScale;

        miniCtx.imageSmoothingEnabled = true;
        miniCtx.imageSmoothingQuality = "high";
        miniCtx.drawImage(
          img,
          srcX,
          srcY,
          srcW,
          srcH,
          0,
          0,
          mini.width,
          mini.height,
        );
      }
    }
  }, []);

  // Load image when opened.
  useEffect(() => {
    if (!open || !imageFile) {
      setLoadedImg(null);
      stateRef.current.img = null;
      setError(null);
      return;
    }

    const objectUrl = URL.createObjectURL(imageFile);
    const img = new Image();

    img.onload = () => {
      const baseScale = getBaseScale(img);
      const initialW = img.naturalWidth * baseScale;
      const initialH = img.naturalHeight * baseScale;

      const initialOffset = clampOffset(
        CROP_MARGIN + (CROP_SIZE - initialW) / 2,
        CROP_MARGIN + (CROP_SIZE - initialH) / 2,
        baseScale,
        img,
      );

      stateRef.current = {
        img,
        baseScale,
        zoom: 1.0,
        offset: initialOffset,
      };

      setLoadedImg(img);
      setZoom(1.0);
      setOffset(initialOffset);

      // Set canvas backing dimensions for HiDPI
      const canvas = canvasRef.current;
      if (canvas) {
        const dpr = window.devicePixelRatio || 1;
        canvas.width = VIEWPORT_SIZE * dpr;
        canvas.height = VIEWPORT_SIZE * dpr;
      }

      redrawCanvas();
    };

    img.onerror = () => {
      setError(t("Failed to load image."));
    };

    img.src = objectUrl;

    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [open, imageFile, getBaseScale, clampOffset, redrawCanvas]);

  // Redraw when offset or zoom changes.
  useEffect(() => {
    stateRef.current.zoom = zoom;
    stateRef.current.offset = offset;
    redrawCanvas();
  }, [zoom, offset, redrawCanvas]);

  // Pointer dragging.
  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    if (!stateRef.current.img) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      isDragging: true,
      lastX: e.clientX,
      lastY: e.clientY,
    };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    if (!dragRef.current.isDragging || !stateRef.current.img) return;
    const dx = e.clientX - dragRef.current.lastX;
    const dy = e.clientY - dragRef.current.lastY;
    dragRef.current.lastX = e.clientX;
    dragRef.current.lastY = e.clientY;

    const img = stateRef.current.img;
    const currentScale = stateRef.current.baseScale * stateRef.current.zoom;

    setOffset((prev) => {
      const next = clampOffset(prev.x + dx, prev.y + dy, currentScale, img);
      stateRef.current.offset = next;
      redrawCanvas();
      return next;
    });
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    if (!dragRef.current.isDragging) return;
    dragRef.current.isDragging = false;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // Ignore
    }
  };

  // Zoom centered on crop frame center (160, 160).
  const applyZoom = useCallback(
    (targetZoom: number): void => {
      const img = stateRef.current.img;
      if (!img) return;

      const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, targetZoom));
      const oldZoom = stateRef.current.zoom;
      if (Math.abs(nextZoom - oldZoom) < 0.001) return;

      const oldScale = stateRef.current.baseScale * oldZoom;
      const nextScale = stateRef.current.baseScale * nextZoom;
      const ratio = nextScale / oldScale;

      const center = { x: VIEWPORT_SIZE / 2, y: VIEWPORT_SIZE / 2 };
      const currentOffset = stateRef.current.offset;

      const nextX = center.x - (center.x - currentOffset.x) * ratio;
      const nextY = center.y - (center.y - currentOffset.y) * ratio;

      const clamped = clampOffset(nextX, nextY, nextScale, img);

      stateRef.current.zoom = nextZoom;
      stateRef.current.offset = clamped;

      setZoom(nextZoom);
      setOffset(clamped);
      redrawCanvas();
    },
    [clampOffset, redrawCanvas],
  );

  const onWheel = (e: React.WheelEvent<HTMLCanvasElement>): void => {
    e.preventDefault();
    const delta = -e.deltaY * 0.003;
    applyZoom(stateRef.current.zoom + delta);
  };

  const handleConfirm = async (): Promise<void> => {
    const img = stateRef.current.img;
    if (!img) return;

    setSaving(true);
    setError(null);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = OUTPUT_SIZE;
      canvas.height = OUTPUT_SIZE;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Could not create canvas context.");

      const currentScale = stateRef.current.baseScale * stateRef.current.zoom;
      const currentOffset = stateRef.current.offset;

      const srcX = (CROP_MARGIN - currentOffset.x) / currentScale;
      const srcY = (CROP_MARGIN - currentOffset.y) / currentScale;
      const srcW = CROP_SIZE / currentScale;
      const srcH = CROP_SIZE / currentScale;

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE);

      const blob = await new Promise<Blob | null>((res) =>
        canvas.toBlob(res, "image/png"),
      );
      if (!blob) throw new Error("Could not encode image.");

      const buffer = await blob.arrayBuffer();
      await onConfirm(new Uint8Array(buffer));
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("Crop avatar")}
      sub={t("Drag to position and zoom to crop avatar.")}
      error={error}
      actions={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            {t("Cancel")}
          </Button>
          <Button
            variant="primary"
            onClick={() => void handleConfirm()}
            disabled={saving || !loadedImg}
          >
            {saving ? t("Saving…") : t("Confirm")}
          </Button>
        </>
      }
    >
      <div className="imb-avatar-crop-body">
        <div className="imb-crop-viewport">
          <canvas
            ref={canvasRef}
            className="imb-crop-canvas"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onWheel={onWheel}
          />
        </div>

        {/* Zoom slider */}
        <div className="imb-crop-controls">
          <span>{t("Zoom")}</span>
          <input
            type="range"
            className="imb-crop-slider"
            min={MIN_ZOOM}
            max={MAX_ZOOM}
            step={0.02}
            value={zoom}
            onChange={(e) => applyZoom(parseFloat(e.target.value))}
            aria-label={t("Zoom")}
          />
        </div>

        {/* Live preview */}
        <div className="imb-crop-preview-wrap">
          <div className="imb-crop-mini-preview">
            <canvas ref={miniCanvasRef} width={48} height={48} />
          </div>
          <span>{t("Preview")}</span>
        </div>
      </div>
    </Modal>
  );
}
