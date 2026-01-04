/**
 * Audio-Video Combiner Utility
 * Client-side combining of video and audio using Web APIs.
 *
 * Uses:
 * - canvas.captureStream() for video
 * - Web Audio API for audio
 * - MediaRecorder for combining and encoding
 */

import { post } from './api/client';

/**
 * Combine a video file (muted) with an audio file into a single video.
 * This runs entirely client-side using browser APIs.
 *
 * @param videoUrl - URL of the source video (will be muted)
 * @param audioUrl - URL of the audio track
 * @returns Promise<Blob> - The combined video as a WebM blob
 */
export async function combineVideoAndAudio(
  videoUrl: string,
  audioUrl: string
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    // Create video element
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.muted = true; // Mute original video audio
    video.playsInline = true;

    // Create audio element
    const audio = new Audio();
    audio.crossOrigin = 'anonymous';

    // Create canvas for capturing video frames
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      reject(new Error('Failed to get canvas context'));
      return;
    }

    // Audio context for combining audio
    let audioContext: AudioContext | null = null;
    let audioSource: MediaElementAudioSourceNode | null = null;
    let audioDestination: MediaStreamAudioDestinationNode | null = null;

    // MediaRecorder chunks
    const chunks: Blob[] = [];
    let mediaRecorder: MediaRecorder | null = null;

    const cleanup = () => {
      if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        try {
          mediaRecorder.stop();
        } catch {
          // Ignore
        }
      }
      if (audioContext) {
        try {
          audioContext.close();
        } catch {
          // Ignore
        }
      }
      video.pause();
      audio.pause();
      video.src = '';
      audio.src = '';
    };

    const handleError = (error: Error | string) => {
      cleanup();
      reject(typeof error === 'string' ? new Error(error) : error);
    };

    // Wait for both video and audio to be loaded
    let videoLoaded = false;
    let audioLoaded = false;

    const startRecording = () => {
      if (!videoLoaded || !audioLoaded) return;

      try {
        // Set canvas dimensions to match video
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;

        // Create audio context and nodes
        audioContext = new AudioContext();
        audioSource = audioContext.createMediaElementSource(audio);
        audioDestination = audioContext.createMediaStreamDestination();
        audioSource.connect(audioDestination);

        // Get video stream from canvas
        const videoStream = canvas.captureStream(30); // 30 FPS

        // Combine video and audio streams
        const combinedStream = new MediaStream([
          ...videoStream.getVideoTracks(),
          ...audioDestination.stream.getAudioTracks(),
        ]);

        // Create MediaRecorder
        const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
          ? 'video/webm;codecs=vp9,opus'
          : MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')
            ? 'video/webm;codecs=vp8,opus'
            : 'video/webm';

        mediaRecorder = new MediaRecorder(combinedStream, {
          mimeType,
          videoBitsPerSecond: 5000000, // 5 Mbps
        });

        mediaRecorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            chunks.push(event.data);
          }
        };

        mediaRecorder.onstop = () => {
          const blob = new Blob(chunks, { type: mimeType });
          cleanup();
          resolve(blob);
        };

        mediaRecorder.onerror = (event) => {
          handleError(new Error(`MediaRecorder error: ${event}`));
        };

        // Start recording
        mediaRecorder.start(100); // Collect data every 100ms

        // Draw video frames to canvas
        const drawFrame = () => {
          if (video.paused || video.ended) {
            // Stop recording when video ends
            if (mediaRecorder && mediaRecorder.state === 'recording') {
              mediaRecorder.stop();
            }
            return;
          }
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          requestAnimationFrame(drawFrame);
        };

        // Handle video end
        video.onended = () => {
          if (mediaRecorder && mediaRecorder.state === 'recording') {
            // Give a small delay for last frames
            setTimeout(() => {
              if (mediaRecorder && mediaRecorder.state === 'recording') {
                mediaRecorder.stop();
              }
            }, 200);
          }
        };

        // Start playback
        video.play().catch(handleError);
        audio.play().catch(handleError);
        drawFrame();
      } catch (error) {
        handleError(error as Error);
      }
    };

    // Video event handlers
    video.onloadeddata = () => {
      videoLoaded = true;
      startRecording();
    };

    video.onerror = () => {
      handleError(new Error('Failed to load video'));
    };

    // Audio event handlers
    audio.oncanplaythrough = () => {
      audioLoaded = true;
      startRecording();
    };

    audio.onerror = () => {
      handleError(new Error('Failed to load audio'));
    };

    // Start loading
    video.src = videoUrl;
    audio.src = audioUrl;
    video.load();
    audio.load();
  });
}

/**
 * Upload a combined video blob to S3 via the backend.
 *
 * @param blob - The video blob to upload
 * @param creativeId - The creative ID for naming
 * @returns Promise with the S3 URL and key
 */
export async function uploadCombinedToS3(
  blob: Blob,
  creativeId: string
): Promise<{ url: string; s3Key: string }> {
  // First, get a presigned upload URL from the backend
  const presignRes = await post('/admin/creatives/presign-upload', {
    creativeId,
    contentType: blob.type,
    fileSize: blob.size,
  }) as { success: boolean; data?: { uploadUrl: string; s3Key: string; publicUrl: string }; error?: string };

  if (!presignRes.success || !presignRes.data) {
    throw new Error(presignRes.error || 'Failed to get upload URL');
  }

  const { uploadUrl, s3Key, publicUrl } = presignRes.data;

  // Upload directly to S3 using the presigned URL
  const uploadResponse = await fetch(uploadUrl, {
    method: 'PUT',
    body: blob,
    headers: {
      'Content-Type': blob.type,
    },
  });

  if (!uploadResponse.ok) {
    throw new Error(`S3 upload failed: ${uploadResponse.statusText}`);
  }

  return {
    url: publicUrl,
    s3Key,
  };
}

/**
 * Helper to convert a Blob to base64 (if needed for smaller files)
 */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      // Remove the data URL prefix to get just the base64
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
