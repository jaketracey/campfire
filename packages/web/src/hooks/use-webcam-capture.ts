'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import type { CampfireWebSocket } from '@/lib/ws';

interface UseWebcamCaptureOptions {
  captureInterval?: number; // Default 10000ms (10 seconds)
  targetWidth?: number; // Default 640
  targetHeight?: number; // Default 480
  quality?: number; // JPEG quality 0-1, default 0.75
}

interface UseWebcamCaptureReturn {
  isEnabled: boolean;
  isCapturing: boolean;
  isPermissionGranted: boolean;
  error: string | null;
  latestFrame: string | null;
  enableWebcam: () => Promise<void>;
  disableWebcam: () => void;
  requestPermission: () => Promise<boolean>;
}

/**
 * Hook for webcam capture
 * Captures frames at a regular interval and sends them via WebSocket
 */
export function useWebcamCapture(
  wsRef: React.RefObject<CampfireWebSocket | null>,
  options: UseWebcamCaptureOptions = {}
): UseWebcamCaptureReturn {
  const {
    captureInterval = 10000,
    targetWidth = 640,
    targetHeight = 480,
    quality = 0.75,
  } = options;

  const [isEnabled, setIsEnabled] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [isPermissionGranted, setIsPermissionGranted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [latestFrame, setLatestFrame] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const captureIntervalRef = useRef<number | null>(null);

  /**
   * Capture a frame from the video stream
   */
  const captureFrame = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) return;
    if (!wsRef.current?.isConnected) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Draw video frame to canvas
    ctx.drawImage(video, 0, 0, targetWidth, targetHeight);

    // Convert to JPEG base64
    const dataUrl = canvas.toDataURL('image/jpeg', quality);
    // Remove data URL prefix to get just the base64 data
    const base64Data = dataUrl.replace(/^data:image\/jpeg;base64,/, '');

    // Update preview
    setLatestFrame(dataUrl);

    // Send via WebSocket
    wsRef.current.sendWebcamFrame(base64Data, targetWidth, targetHeight);

    // Visual feedback for capture
    setIsCapturing(true);
    setTimeout(() => setIsCapturing(false), 200);
  }, [wsRef, targetWidth, targetHeight, quality]);

  /**
   * Request camera permission
   */
  const requestPermission = useCallback(async (): Promise<boolean> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      stream.getTracks().forEach((track) => track.stop());
      setIsPermissionGranted(true);
      setError(null);
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Camera permission denied';
      setError(message);
      setIsPermissionGranted(false);
      return false;
    }
  }, []);

  /**
   * Enable webcam capture
   */
  const enableWebcam = useCallback(async () => {
    if (isEnabled) return;
    setError(null);

    try {
      // Get camera stream
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: targetWidth },
          height: { ideal: targetHeight },
          facingMode: 'user',
        },
      });
      mediaStreamRef.current = stream;
      setIsPermissionGranted(true);

      // Create hidden video element
      const video = document.createElement('video');
      video.srcObject = stream;
      video.autoplay = true;
      video.playsInline = true;
      video.muted = true;
      videoRef.current = video;

      // Create canvas for frame capture
      const canvas = document.createElement('canvas');
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      canvasRef.current = canvas;

      // Wait for video to be ready
      await new Promise<void>((resolve) => {
        video.onloadedmetadata = () => {
          video.play();
          resolve();
        };
      });

      // Signal webcam enabled to server
      wsRef.current?.enableWebcam();

      // Capture first frame immediately
      captureFrame();

      // Start capture interval
      captureIntervalRef.current = window.setInterval(captureFrame, captureInterval);

      setIsEnabled(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start webcam';
      setError(message);
      console.error('[WebcamCapture] Error starting:', err);
    }
  }, [isEnabled, wsRef, targetWidth, targetHeight, captureInterval, captureFrame]);

  /**
   * Disable webcam capture
   */
  const disableWebcam = useCallback(() => {
    if (!isEnabled) return;

    // Stop capture interval
    if (captureIntervalRef.current) {
      clearInterval(captureIntervalRef.current);
      captureIntervalRef.current = null;
    }

    // Signal webcam disabled to server
    wsRef.current?.disableWebcam();

    // Stop media stream
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }

    // Cleanup video element
    if (videoRef.current) {
      videoRef.current.srcObject = null;
      videoRef.current = null;
    }

    // Cleanup canvas
    canvasRef.current = null;

    // Clear state
    setLatestFrame(null);
    setIsEnabled(false);
    setIsCapturing(false);
  }, [isEnabled, wsRef]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (captureIntervalRef.current) {
        clearInterval(captureIntervalRef.current);
      }
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  return {
    isEnabled,
    isCapturing,
    isPermissionGranted,
    error,
    latestFrame,
    enableWebcam,
    disableWebcam,
    requestPermission,
  };
}
