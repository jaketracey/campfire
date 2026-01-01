#!/bin/bash
# Generate diverse companion portraits for onboarding flow
# Uses ComfyUI API via SSH tunnel (localhost:8188)

COMFYUI_URL="http://localhost:8188"
OUTPUT_DIR="/Users/jake/Projects/campfire/packages/web/public/images/companions"

mkdir -p "$OUTPUT_DIR"

# Function to generate an image
generate_image() {
  local filename="$1"
  local prompt="$2"
  local negative="$3"
  local checkpoint="${4:-Juggernaut-X-RunDiffusion-NSFW.safetensors}"

  echo "Generating: $filename"

  # Queue the prompt
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
            "ckpt_name": "'"$checkpoint"'"
          }
        },
        "5": {
          "class_type": "EmptyLatentImage",
          "inputs": {
            "width": 768,
            "height": 1024,
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
            "text": "'"$negative"'",
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
            "filename_prefix": "companion_'"$filename"'",
            "images": ["8", 0]
          }
        }
      }
    }')

  local prompt_id=$(echo "$response" | jq -r '.prompt_id')
  echo "  Queued: $prompt_id"

  # Wait for completion (max 120 seconds)
  for i in {1..24}; do
    sleep 5
    local history=$(curl -s "$COMFYUI_URL/history/$prompt_id")
    local output_file=$(echo "$history" | jq -r ".\"$prompt_id\".outputs.\"9\".images[0].filename // empty")
    if [ -n "$output_file" ]; then
      echo "  Done: $output_file"
      # Download the image
      curl -s -o "$OUTPUT_DIR/$filename.png" "$COMFYUI_URL/view?filename=$output_file&type=output"
      echo "  Saved: $OUTPUT_DIR/$filename.png"
      return 0
    fi
  done
  echo "  Timeout waiting for $filename"
  return 1
}

# Base prompt components
BASE_QUALITY="masterpiece, best quality, highly detailed, professional photography, perfect lighting, 8k uhd"
PORTRAIT_STYLE="portrait, beautiful woman, looking at viewer, soft smile, confident expression, elegant"
NEGATIVE="ugly, deformed, blurry, low quality, bad anatomy, bad hands, missing fingers, extra limbs, disfigured, watermark, text, signature, amateur"

echo "=== Generating Companion Portraits ==="
echo ""

# East Asian variations
generate_image "east-asian-1" "$BASE_QUALITY, $PORTRAIT_STYLE, east asian woman, korean beauty, long black hair, slim body, delicate features, fair skin, brown eyes" "$NEGATIVE"
generate_image "east-asian-2" "$BASE_QUALITY, $PORTRAIT_STYLE, east asian woman, japanese, short bob haircut, athletic body, natural makeup, warm skin tone" "$NEGATIVE"
generate_image "east-asian-3" "$BASE_QUALITY, $PORTRAIT_STYLE, east asian woman, chinese, wavy brown hair, curvy figure, glamorous, red lips" "$NEGATIVE"

# South Asian variations
generate_image "south-asian-1" "$BASE_QUALITY, $PORTRAIT_STYLE, south asian woman, indian beauty, long dark hair, athletic body, golden brown skin, dark eyes, elegant" "$NEGATIVE"
generate_image "south-asian-2" "$BASE_QUALITY, $PORTRAIT_STYLE, south asian woman, brown skin, wavy black hair, curvy body, beautiful features, warm expression" "$NEGATIVE"

# Black/African variations
generate_image "black-1" "$BASE_QUALITY, $PORTRAIT_STYLE, black woman, african american, natural curly hair, athletic body, dark skin, beautiful features, radiant" "$NEGATIVE"
generate_image "black-2" "$BASE_QUALITY, $PORTRAIT_STYLE, black woman, dark skin, long braided hair, curvy body, gorgeous, confident, glowing skin" "$NEGATIVE"
generate_image "black-3" "$BASE_QUALITY, $PORTRAIT_STYLE, black woman, caramel skin tone, short natural hair, slim body, elegant features, stunning" "$NEGATIVE"

# Caucasian variations
generate_image "caucasian-1" "$BASE_QUALITY, $PORTRAIT_STYLE, caucasian woman, european, long blonde hair, slim body, blue eyes, fair skin, natural beauty" "$NEGATIVE"
generate_image "caucasian-2" "$BASE_QUALITY, $PORTRAIT_STYLE, caucasian woman, brunette, wavy brown hair, athletic body, green eyes, light skin" "$NEGATIVE"
generate_image "caucasian-3" "$BASE_QUALITY, $PORTRAIT_STYLE, caucasian woman, redhead, long red hair, curvy body, freckles, pale skin, striking" "$NEGATIVE"

# Latina variations
generate_image "latina-1" "$BASE_QUALITY, $PORTRAIT_STYLE, latina woman, hispanic, long dark wavy hair, curvy body, olive skin, brown eyes, passionate" "$NEGATIVE"
generate_image "latina-2" "$BASE_QUALITY, $PORTRAIT_STYLE, latina woman, brazilian, caramel skin, athletic body, dark hair, beautiful features" "$NEGATIVE"

# Middle Eastern variations
generate_image "middle-eastern-1" "$BASE_QUALITY, $PORTRAIT_STYLE, middle eastern woman, persian beauty, long dark hair, olive skin, dark eyes, elegant features" "$NEGATIVE"
generate_image "middle-eastern-2" "$BASE_QUALITY, $PORTRAIT_STYLE, middle eastern woman, arab beauty, wavy black hair, curvy body, golden skin, striking" "$NEGATIVE"

# Mixed/Ambiguous variations
generate_image "mixed-1" "$BASE_QUALITY, $PORTRAIT_STYLE, mixed race woman, ambiguous ethnicity, wavy brown hair, athletic body, tan skin, hazel eyes, unique beauty" "$NEGATIVE"
generate_image "mixed-2" "$BASE_QUALITY, $PORTRAIT_STYLE, mixed race woman, exotic features, long dark hair, curvy body, olive skin, captivating" "$NEGATIVE"
generate_image "mixed-3" "$BASE_QUALITY, $PORTRAIT_STYLE, mixed race woman, diverse heritage, short curly hair, slim body, warm skin tone, beautiful" "$NEGATIVE"

# Fantasy hair colors (for "fantasy" option)
generate_image "fantasy-1" "$BASE_QUALITY, $PORTRAIT_STYLE, woman with pastel pink hair, athletic body, ethereal beauty, fantasy, magical" "$NEGATIVE"
generate_image "fantasy-2" "$BASE_QUALITY, $PORTRAIT_STYLE, woman with blue hair, violet eyes, slim body, otherworldly, enchanting" "$NEGATIVE"
generate_image "fantasy-3" "$BASE_QUALITY, $PORTRAIT_STYLE, woman with silver white hair, curvy body, mystical, goddess-like, radiant" "$NEGATIVE"

echo ""
echo "=== Generation Complete ==="
echo "Images saved to: $OUTPUT_DIR"
ls -la "$OUTPUT_DIR"
