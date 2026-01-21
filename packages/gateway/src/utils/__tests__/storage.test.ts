/**
 * Storage Utility Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the env before importing the module
vi.mock('../../env.js', () => ({
  env: {
    AWS_REGION: 'us-east-1',
    S3_MEDIA_BUCKET: 'test-media-bucket',
    S3_CDN_URL: 'https://cdn.example.com',
    NODE_ENV: 'test',
  },
}));

// Mock S3Client
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn().mockImplementation(() => ({
    destroy: vi.fn(),
  })),
}));

import {
  getS3Client,
  getMediaBucket,
  getCdnUrl,
  buildMediaUrl,
  closeS3Client,
} from '../storage.js';
import { S3Client } from '@aws-sdk/client-s3';

describe('Storage Utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the singleton for each test
    closeS3Client();
  });

  afterEach(() => {
    closeS3Client();
  });

  describe('getS3Client', () => {
    it('should return an S3 client instance', () => {
      const client = getS3Client();

      expect(client).toBeDefined();
      expect(S3Client).toHaveBeenCalled();
    });

    it('should return the same instance on subsequent calls (singleton)', () => {
      const client1 = getS3Client();
      const client2 = getS3Client();

      expect(client1).toBe(client2);
      // S3Client should only be constructed once
      expect(S3Client).toHaveBeenCalledTimes(1);
    });
  });

  describe('getMediaBucket', () => {
    it('should return the media bucket name from env', () => {
      const bucket = getMediaBucket();

      expect(bucket).toBe('test-media-bucket');
    });
  });

  describe('getCdnUrl', () => {
    it('should return the CDN URL from env', () => {
      const cdnUrl = getCdnUrl();

      expect(cdnUrl).toBe('https://cdn.example.com');
    });
  });

  describe('buildMediaUrl', () => {
    it('should build URL using CDN when configured', () => {
      const url = buildMediaUrl('images/test.jpg');

      expect(url).toBe('https://cdn.example.com/images/test.jpg');
    });
  });

  describe('closeS3Client', () => {
    it('should destroy the client and reset singleton', () => {
      const client = getS3Client();
      closeS3Client();

      // Getting a new client should create a new instance
      const newClient = getS3Client();
      expect(S3Client).toHaveBeenCalledTimes(2);
    });
  });
});
