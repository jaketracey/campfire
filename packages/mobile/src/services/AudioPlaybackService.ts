import { Audio, AVPlaybackStatus } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';

interface QueuedAudio {
  base64Data: string;
  resolve: () => void;
  reject: (error: Error) => void;
}

class AudioPlaybackService {
  private sound: Audio.Sound | null = null;
  private isPlaying = false;
  private queue: QueuedAudio[] = [];
  private isProcessingQueue = false;

  constructor() {
    // Configure audio mode for playback
    this.configureAudioMode();
  }

  private async configureAudioMode(): Promise<void> {
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
      });
    } catch (error) {
      console.error('[AudioPlayback] Mode config error:', error);
    }
  }

  /**
   * Play base64 encoded MP3 audio
   * Returns a promise that resolves when playback is complete
   */
  async playAudio(base64Mp3: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.queue.push({ base64Data: base64Mp3, resolve, reject });
      this.processQueue();
    });
  }

  /**
   * Process the audio queue
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessingQueue || this.queue.length === 0) {
      return;
    }

    this.isProcessingQueue = true;

    while (this.queue.length > 0) {
      const item = this.queue.shift();
      if (!item) break;

      try {
        await this.playAudioInternal(item.base64Data);
        item.resolve();
      } catch (error) {
        item.reject(error instanceof Error ? error : new Error('Playback failed'));
      }
    }

    this.isProcessingQueue = false;
  }

  /**
   * Internal method to play audio
   */
  private async playAudioInternal(base64Mp3: string): Promise<void> {
    // Clean up any existing sound
    await this.unloadSound();

    try {
      // Write base64 data to a temporary file
      const tempUri = `${FileSystem.cacheDirectory}temp_audio_${Date.now()}.mp3`;
      await FileSystem.writeAsStringAsync(tempUri, base64Mp3, {
        encoding: FileSystem.EncodingType.Base64,
      });

      // Create and load the sound
      const { sound } = await Audio.Sound.createAsync(
        { uri: tempUri },
        { shouldPlay: true },
        this.onPlaybackStatusUpdate.bind(this)
      );

      this.sound = sound;
      this.isPlaying = true;

      // Wait for playback to complete
      await new Promise<void>((resolve, reject) => {
        const checkStatus = async () => {
          try {
            const status = await sound.getStatusAsync();
            if (status.isLoaded && !status.isPlaying && status.didJustFinish) {
              resolve();
            } else if (!status.isLoaded) {
              reject(new Error('Sound unloaded'));
            } else {
              setTimeout(checkStatus, 100);
            }
          } catch {
            reject(new Error('Status check failed'));
          }
        };
        checkStatus();
      });

      // Clean up
      await this.unloadSound();
      await FileSystem.deleteAsync(tempUri, { idempotent: true });

      console.log('[AudioPlayback] Playback complete');
    } catch (error) {
      console.error('[AudioPlayback] Play error:', error);
      await this.unloadSound();
      throw error;
    }
  }

  /**
   * Playback status update handler
   */
  private onPlaybackStatusUpdate(status: AVPlaybackStatus): void {
    if (!status.isLoaded) {
      this.isPlaying = false;
      return;
    }

    if (status.didJustFinish) {
      this.isPlaying = false;
    }
  }

  /**
   * Stop current playback and clear the queue
   */
  async stopAudio(): Promise<void> {
    // Clear the queue
    const pendingItems = this.queue.splice(0, this.queue.length);
    pendingItems.forEach((item) => item.resolve());

    // Stop current playback
    await this.unloadSound();

    console.log('[AudioPlayback] Stopped');
  }

  /**
   * Unload the current sound
   */
  private async unloadSound(): Promise<void> {
    if (this.sound) {
      try {
        await this.sound.stopAsync();
        await this.sound.unloadAsync();
      } catch {
        // Ignore errors during cleanup
      }
      this.sound = null;
      this.isPlaying = false;
    }
  }

  /**
   * Check if currently playing
   */
  getIsPlaying(): boolean {
    return this.isPlaying;
  }
}

// Export singleton instance
export const audioPlaybackService = new AudioPlaybackService();
