# S3 Image Expiry Fix

## Problem

Companion images are returning 404 errors in production for old companions due to presigned S3 URLs expiring.

## Root Cause Analysis

### Found Issues

1. **`packages/gateway/src/routes/imagegen.ts` (Line 202-209)**
   - Generates presigned URLs with 1-hour expiry for identity anchors
   - These URLs are stored in database and returned to users
   - When users access old companions, URLs have expired

2. **`packages/gateway/src/utils/webcam-storage.ts` (Line 60-64)**
   - Generates presigned URLs with 7-day expiry for webcam frames
   - Less critical but same issue

3. **Direct S3 URLs (CORRECT APPROACH)**
   - `packages/gateway/src/utils/companion-assets.ts` correctly uses direct S3 URLs
   - `packages/workers/src/image/worker.ts` correctly builds direct URLs (line 208-209)

## Solution

### Option 1: Make S3 Bucket Public (Recommended for Media)

**Pros:**
- No URL expiry issues
- Better performance (no presigned URL generation)
- Simpler code
- Can use CDN/CloudFront

**Cons:**
- All media in bucket becomes publicly accessible

### Option 2: Generate Presigned URLs On-Demand

**Pros:**
- Keep bucket private
- More control over access

**Cons:**
- Performance overhead for every image request
- More complex code
- Still have short-lived URLs

### Option 3: Use CloudFront (Best for Production)

**Pros:**
- CDN performance benefits
- Can use signed CloudFront URLs with longer expiry (days/weeks)
- Can keep S3 bucket private
- Better scalability

**Cons:**
- Requires CloudFront setup

## Recommended Approach

**For Immediate Fix:** Option 1 (Make bucket public) + CloudFront later

1. Make S3 media bucket publicly readable for companion images
2. Remove all presigned URL generation for stored images
3. Use direct S3 URLs (already working for variations)
4. Add CloudFront in front of S3 for better performance

## Implementation Plan

### Phase 1: Immediate Fix (15 minutes)

1. ✅ Make S3 bucket publicly readable
2. ✅ Remove presigned URL generation from image routes
3. ✅ Update all code to use direct S3 URLs
4. ✅ Test with old companions

### Phase 2: Long-term Solution (1-2 hours)

1. Set up CloudFront distribution for S3 bucket
2. Update all URLs to use CloudFront domain
3. Configure caching and compression
4. Update environment variables

## Files to Modify

1. **`packages/gateway/src/routes/imagegen.ts`**
   - Remove `getSignedUrl` for stored images
   - Use direct S3 URLs

2. **`packages/gateway/src/utils/webcam-storage.ts`**
   - Optional: Remove presigned URLs for webcam frames (or keep 7-day for privacy)

3. **AWS S3 Bucket Policy**
   - Add public read access for media bucket

4. **Environment variables**
   - Add `CLOUDFRONT_DOMAIN` (Phase 2)

## Code Changes

See `S3_EXPIRY_FIX_IMPLEMENTATION.md` for detailed code changes.

## Testing Checklist

- [ ] Old companion images load correctly
- [ ] New companion images save correctly
- [ ] Image generation still works
- [ ] No 404 errors on companion avatars
- [ ] Performance is acceptable
