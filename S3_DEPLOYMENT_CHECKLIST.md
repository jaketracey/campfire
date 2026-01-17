# S3 Image Expiry Fix - Deployment Checklist

## Critical: Complete Before Deploying Code Changes

### ⚠️ DO THIS FIRST - Make S3 Bucket Public

**If you deploy the code changes BEFORE making the bucket public, all companion images will break!**

### Step 1: Update S3 Bucket Policy (5 minutes)

1. Log into AWS Console
2. Go to S3 → Select your media bucket (check `S3_MEDIA_BUCKET` env var)
3. Go to "Permissions" tab
4. Click "Block public access (bucket settings)" → Edit
5. **Uncheck** "Block all public access"
6. Save changes and confirm

7. Scroll down to "Bucket policy" → Edit
8. Add this policy (replace `YOUR-MEDIA-BUCKET` with your actual bucket name):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PublicReadCompanionImages",
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::YOUR-MEDIA-BUCKET/companions/*"
    },
    {
      "Sid": "PublicReadRenditions",
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::YOUR-MEDIA-BUCKET/renditions/*"
    }
  ]
}
```

9. Save policy

10. **Test**: Try accessing a companion image URL in your browser
    - Get URL from database: `SELECT asset_url FROM companion_avatars LIMIT 1;`
    - Remove any query parameters (`?X-Amz-*`)
    - Should load successfully

### Step 2: Deploy Code Changes

Now it's safe to deploy:

```bash
# Commit the changes
git add packages/gateway/src/routes/imagegen.ts
git commit -m "fix: remove S3 presigned URL expiry for companion images"

# Deploy
gh workflow run deploy.yml -f environment=staging -f services=gateway

# Test on staging first!
# Then deploy to prod
gh workflow run deploy.yml -f environment=prod -f services=gateway
```

### Step 3: Fix Existing Presigned URLs in Database (Optional)

Only needed if you have old presigned URLs in the database.

```sql
-- Connect to your production database
psql $DATABASE_URL

-- Check how many affected records
SELECT COUNT(*)
FROM companion_avatars
WHERE asset_url LIKE '%X-Amz-Signature%';

-- Update presigned URLs to direct URLs
-- ONLY if s3_key and s3_bucket are populated
UPDATE companion_avatars
SET asset_url = 'https://' || s3_bucket || '.s3.' || 'us-east-1' || '.amazonaws.com/' || s3_key
WHERE s3_key IS NOT NULL
  AND s3_bucket IS NOT NULL
  AND asset_url LIKE '%X-Amz-Signature%';

-- Verify
SELECT COUNT(*)
FROM companion_avatars
WHERE asset_url LIKE '%X-Amz-Signature%';
-- Should be 0 or only rows without s3_key

-- Check a few URLs
SELECT id, asset_url
FROM companion_avatars
LIMIT 5;
```

### Step 4: Test in Production

1. **Test old companions**:
   ```bash
   # Get a companion that was created before the fix
   curl https://api.campfire.com/api/v1/companions/{old-companion-id}

   # Check that avatar URLs load:
   # - Should NOT contain X-Amz-* parameters
   # - Should load successfully in browser
   ```

2. **Test new image generation**:
   ```bash
   # Create a new companion
   # Generate anchor images
   # Verify URLs are direct S3 URLs (no presigned parameters)
   ```

3. **Monitor for errors**:
   ```bash
   # Check logs for 403/404 errors on S3
   # Check error rate on image loading
   # Monitor user reports
   ```

### Step 5: Monitor (24-48 hours)

- Watch error rates for S3 403/404 errors
- Check user feedback for image loading issues
- Monitor CloudWatch metrics for S3 requests

### Rollback Plan

If issues occur:

1. **Revert code changes**:
   ```bash
   git revert <commit-hash>
   git push
   gh workflow run deploy.yml -f environment=prod -f services=gateway
   ```

2. **Re-enable bucket privacy** (if needed):
   - Go to S3 bucket → Permissions
   - Remove public bucket policy
   - Enable "Block all public access"

3. **Database rollback** (if you ran the UPDATE):
   - Not easily reversible
   - Old presigned URLs are already expired
   - New presigned URLs will be generated on next access

### Success Criteria

✅ No S3 403 or 404 errors on companion images
✅ Old companions load correctly
✅ New companions load correctly
✅ Image generation still works
✅ No increase in error rate

### Next Steps (Future)

- [ ] Set up CloudFront for better performance
- [ ] Add CDN caching
- [ ] Monitor bandwidth usage
- [ ] Consider image optimization

## Common Issues

### Issue: Images still showing 404

**Cause**: Bucket policy not applied correctly

**Fix**:
1. Check bucket policy is saved
2. Check "Block public access" is disabled
3. Wait 1-2 minutes for policy to propagate
4. Test with a direct S3 URL in browser

### Issue: Some images work, some don't

**Cause**: Mix of public and private images, or old presigned URLs in database

**Fix**:
1. Run the database UPDATE query (Step 3)
2. Or clear browser cache
3. Or wait for presigned URLs to expire and be regenerated

### Issue: Code deployed before bucket made public

**Cause**: Wrong order of operations

**Fix**:
1. Immediately make bucket public (Step 1)
2. Images should start working within 1-2 minutes
3. No code changes needed

## Security Notes

- ✅ Only companion images are public (under `/companions/*` path)
- ✅ User-generated content can remain private
- ✅ Webcam frames still use presigned URLs (7-day expiry)
- ✅ Consider using CloudFront signed URLs for additional security later

## Performance Notes

- Direct S3 URLs are **faster** (no presigned URL generation)
- CloudFront will provide **additional performance gains**
- S3 bucket should have proper CORS configuration for web access

## Support

If you encounter issues:
1. Check AWS CloudWatch logs
2. Check application logs for S3 errors
3. Test URLs manually in browser
4. Contact AWS support if bucket policy issues persist
