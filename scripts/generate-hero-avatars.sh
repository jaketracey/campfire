#!/bin/bash
# Generate attractive SFW hero avatars for homepage
# Uses ComfyUI API via SSH tunnel (localhost:8188)

COMFYUI_URL="http://localhost:8188"
OUTPUT_DIR="/Users/jake/Projects/campfire/packages/web/public/avatars"

mkdir -p "$OUTPUT_DIR"

generate_avatar() {
  local filename="$1"
  local prompt="$2"

  echo "Generating: $filename"

  local response=$(curl -s -X POST "$COMFYUI_URL/prompt" \
    -H "Content-Type: application/json" \
    -d '{
      "prompt": {
        "3": {
          "class_type": "KSampler",
          "inputs": {
            "seed": '$RANDOM$RANDOM',
            "steps": 25,
            "cfg": 7,
            "sampler_name": "euler",
            "scheduler": "normal",
            "denoise": 1,
            "model": ["4", 0],
            "positive": ["6", 0],
            "negative": ["7", 0],
            "latent_image": ["5", 0]
          }
        },
        "4": {
          "class_type": "CheckpointLoaderSimple",
          "inputs": {
            "ckpt_name": "Juggernaut-X-RunDiffusion-NSFW.safetensors"
          }
        },
        "5": {
          "class_type": "EmptyLatentImage",
          "inputs": {
            "width": 768,
            "height": 768,
            "batch_size": 1
          }
        },
        "6": {
          "class_type": "CLIPTextEncode",
          "inputs": {
            "text": "'"$prompt"'",
            "clip": ["4", 1]
          }
        },
        "7": {
          "class_type": "CLIPTextEncode",
          "inputs": {
            "text": "ugly, deformed, blurry, low quality, bad anatomy, watermark, text, nude, naked, nsfw, nipples, genitals",
            "clip": ["4", 1]
          }
        },
        "8": {
          "class_type": "VAEDecode",
          "inputs": {
            "samples": ["3", 0],
            "vae": ["4", 2]
          }
        },
        "9": {
          "class_type": "SaveImage",
          "inputs": {
            "filename_prefix": "hero_'"$filename"'",
            "images": ["8", 0]
          }
        }
      }
    }')

  local prompt_id=$(echo "$response" | jq -r '.prompt_id')
  echo "  Queued: $prompt_id"

  for i in {1..24}; do
    sleep 5
    local history=$(curl -s "$COMFYUI_URL/history/$prompt_id")
    local output_file=$(echo "$history" | jq -r ".\"$prompt_id\".outputs.\"9\".images[0].filename // empty")
    if [ -n "$output_file" ]; then
      echo "  Done: $output_file"
      curl -s -o "$OUTPUT_DIR/$filename.png" "$COMFYUI_URL/view?filename=$output_file&type=output"
      echo "  Saved: $OUTPUT_DIR/$filename.png"
      return 0
    fi
  done
  echo "  Timeout"
  return 1
}

echo "=== Generating Hero Avatars ==="

# Avatar 1: Stunning blonde
generate_avatar "avatar-1" "masterpiece, best quality, portrait of a gorgeous young woman, blonde wavy hair, blue eyes, flirty smile, glamorous makeup, wearing elegant off-shoulder top, soft studio lighting, bokeh background, looking at viewer, alluring, seductive gaze, professional photography, 8k"

# Avatar 2: Beautiful asian woman
generate_avatar "avatar-2" "masterpiece, best quality, portrait of a beautiful asian woman, long black silky hair, brown eyes, cute smile, natural makeup, wearing stylish casual outfit, warm lighting, cozy atmosphere, looking at viewer, charming, inviting expression, professional photography, 8k"

# Avatar 3: Gorgeous black woman
generate_avatar "avatar-3" "masterpiece, best quality, portrait of a stunning black woman, natural curly hair, dark skin, radiant smile, glowing skin, wearing chic outfit, golden hour lighting, warm tones, looking at viewer, confident and sexy, captivating, professional photography, 8k"

# Avatar 4: Attractive latina
generate_avatar "avatar-4" "masterpiece, best quality, portrait of an attractive latina woman, long dark wavy hair, olive skin, sultry expression, glamorous, wearing stylish top, dramatic lighting, looking at viewer, passionate, alluring smile, professional photography, 8k"

echo ""
echo "=== Copying to web app folder ==="
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cp "$OUTPUT_DIR"/*.png "${PROJECT_ROOT}/packages/web/public/avatars/"

echo "=== Done ==="
ls -la "$OUTPUT_DIR"
