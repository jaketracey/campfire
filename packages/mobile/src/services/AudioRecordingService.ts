import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';
import * as Haptics from 'expo-haptics';

/**
 * Recording configuration matching web app expectations
 * Web app uses 16kHz mono PCM
 */
const RECORDING_OPTIONS: Audio.RecordingOptions = {
  android: {
    extension: '.wav',
    outputFormat: Audio.AndroidOutputFormat.DEFAULT,
    audioEncoder: Audio.AndroidAudioEncoder.DEFAULT,
    sampleRate: 16000,
    numberOfChannels: 1,
    bitRate: 256000,
  },
  ios: {
    extension: '.wav',
    outputFormat: Audio.IOSOutputFormat.LINEARPCM,
    audioQuality: Audio.IOSAudioQuality.HIGH,
    sampleRate: 16000,
    numberOfChannels: 1,
    bitRate: 256000,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  web: {},
};

export interface RecordingResult {
  /** Base64 encoded 16-bit PCM audio data (no WAV header) */
  audioData: string;
  /** Duration in milliseconds */
  duration: number;
}

class AudioRecordingService {
  private recording: Audio.Recording | null = null;
  private isRecording = false;
  private startTime = 0;

  /**
   * Request microphone permission
   */
  async requestPermission(): Promise<boolean> {
    try {
      const { granted } = await Audio.requestPermissionsAsync();
      return granted;
    } catch (error) {
      console.error('[AudioRecording] Permission error:', error);
      return false;
    }
  }

  /**
   * Start recording audio
   */
  async startRecording(): Promise<void> {
    if (this.isRecording) {
      console.warn('[AudioRecording] Already recording');
      return;
    }

    try {
      // Request permission if not already granted
      const hasPermission = await this.requestPermission();
      if (!hasPermission) {
        throw new Error('Microphone permission denied');
      }

      // Configure audio mode for recording
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
      });

      // Create and start recording
      const { recording } = await Audio.Recording.createAsync(RECORDING_OPTIONS);
      this.recording = recording;
      this.isRecording = true;
      this.startTime = Date.now();

      // Haptic feedback on recording start
      try {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      } catch {
        // Haptics may not be available on all devices
      }

      console.log('[AudioRecording] Recording started');
    } catch (error) {
      console.error('[AudioRecording] Start error:', error);
      this.isRecording = false;
      throw error;
    }
  }

  /**
   * Stop recording and return the audio data
   */
  async stopRecording(): Promise<RecordingResult> {
    if (!this.isRecording || !this.recording) {
      console.warn('[AudioRecording] Not recording');
      return { audioData: '', duration: 0 };
    }

    try {
      const duration = Date.now() - this.startTime;

      // Stop the recording
      await this.recording.stopAndUnloadAsync();
      const uri = this.recording.getURI();

      // Reset audio mode
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
      });

      if (!uri) {
        throw new Error('No recording URI');
      }

      // Read the WAV file and extract PCM data
      const audioData = await this.extractPCMFromWav(uri);

      // Clean up the temporary file
      await FileSystem.deleteAsync(uri, { idempotent: true });

      this.recording = null;
      this.isRecording = false;

      // Haptic feedback on recording stop
      try {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch {
        // Haptics may not be available on all devices
      }

      console.log('[AudioRecording] Recording stopped, duration:', duration);

      return { audioData, duration };
    } catch (error) {
      console.error('[AudioRecording] Stop error:', error);
      this.recording = null;
      this.isRecording = false;
      throw error;
    }
  }

  /**
   * Cancel recording without returning data
   */
  async cancelRecording(): Promise<void> {
    if (!this.isRecording || !this.recording) {
      return;
    }

    try {
      await this.recording.stopAndUnloadAsync();
      const uri = this.recording.getURI();
      if (uri) {
        await FileSystem.deleteAsync(uri, { idempotent: true });
      }
    } catch (error) {
      console.error('[AudioRecording] Cancel error:', error);
    } finally {
      this.recording = null;
      this.isRecording = false;
    }
  }

  /**
   * Check if currently recording
   */
  getIsRecording(): boolean {
    return this.isRecording;
  }

  /**
   * Extract raw PCM data from WAV file and encode as base64
   * WAV header is 44 bytes for standard PCM format
   */
  private async extractPCMFromWav(uri: string): Promise<string> {
    try {
      // Read the file as base64
      const base64Wav = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });

      // Decode base64 to get raw bytes
      const binaryString = atob(base64Wav);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      // WAV header is 44 bytes - skip it to get raw PCM
      const pcmData = bytes.slice(44);

      // Re-encode PCM data as base64
      let binary = '';
      for (let i = 0; i < pcmData.length; i++) {
        binary += String.fromCharCode(pcmData[i]);
      }

      return btoa(binary);
    } catch (error) {
      console.error('[AudioRecording] PCM extraction error:', error);
      throw error;
    }
  }
}

// Export singleton instance
export const audioRecordingService = new AudioRecordingService();
