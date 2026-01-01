#!/bin/bash
# Generate ALL selector permutations for companion customization
# 7 ethnicities × 4 body types × 5 hair colors = 140 images

COMFYUI_URL="http://localhost:8188"
OUTPUT_DIR="/Users/jake/Projects/campfire/packages/web/public/images/companions"

mkdir -p "$OUTPUT_DIR"

generate_image() {
  local filename="$1"
  local prompt="$2"

  # Skip if already exists
  if [ -f "$OUTPUT_DIR/$filename.png" ]; then
    echo "Skipping $filename (exists)"
    return 0
  fi

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
            "text": "ugly, deformed, blurry, low quality, bad anatomy, watermark, text, nude, naked, nsfw, nipples, genitals, disfigured, child, underage",
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
            "filename_prefix": "perm_'"$filename"'",
            "images": ["8", 0]
          }
        }
      }
    }')

  local prompt_id=$(echo "$response" | jq -r '.prompt_id')

  for i in {1..30}; do
    sleep 5
    local history=$(curl -s "$COMFYUI_URL/history/$prompt_id")
    local output_file=$(echo "$history" | jq -r ".\"$prompt_id\".outputs.\"9\".images[0].filename // empty")
    if [ -n "$output_file" ]; then
      curl -s -o "$OUTPUT_DIR/$filename.png" "$COMFYUI_URL/view?filename=$output_file&type=output"
      echo "  ✓ $filename.png"
      return 0
    fi
  done
  echo "  ✗ Timeout: $filename"
  return 1
}

# Sexy base prompt - alluring but SFW
SEXY_BASE="masterpiece, best quality, professional photography, portrait of a gorgeous sexy woman, seductive expression, bedroom eyes, flirty smile, pouty lips, glamorous makeup, perfect skin, sensual, alluring pose, elegant, cleavage hint, low cut top, form fitting clothes, soft lighting, bokeh, 8k uhd"

# Ethnicity descriptors
declare -A ETHNICITY
ETHNICITY["east-asian"]="east asian woman, korean beauty, fair porcelain skin, almond eyes"
ETHNICITY["south-asian"]="south asian woman, indian beauty, golden brown skin, dark expressive eyes"
ETHNICITY["black"]="black woman, african american beauty, dark glowing skin, full lips"
ETHNICITY["caucasian"]="caucasian woman, european beauty, fair skin"
ETHNICITY["latina"]="latina woman, hispanic beauty, olive tan skin, passionate"
ETHNICITY["middle-eastern"]="middle eastern woman, persian beauty, olive skin, exotic features"
ETHNICITY["mixed"]="mixed race woman, exotic ambiguous ethnicity, unique stunning features"

# Body type descriptors
declare -A BODYTYPE
BODYTYPE["slim"]="slim petite body, slender figure, delicate"
BODYTYPE["athletic"]="athletic toned body, fit physique, strong sexy"
BODYTYPE["curvy"]="curvy voluptuous body, hourglass figure, big breasts, wide hips"
BODYTYPE["plus-size"]="plus size body, thick curvy figure, big beautiful, confident"

# Hair color descriptors
declare -A HAIRCOLOR
HAIRCOLOR["black"]="long black hair, dark silky hair"
HAIRCOLOR["brown"]="brown wavy hair, brunette"
HAIRCOLOR["blonde"]="blonde hair, golden locks"
HAIRCOLOR["red"]="red hair, fiery auburn ginger"
HAIRCOLOR["fantasy"]="fantasy colored hair, pastel pink purple blue hair, colorful vibrant"

echo "=== Generating ALL Selector Permutations (140 images) ==="
echo "Estimated time: ~35-45 minutes"
echo ""

COUNT=0
TOTAL=140

for eth in east-asian south-asian black caucasian latina middle-eastern mixed; do
  for body in slim athletic curvy plus-size; do
    for hair in black brown blonde red fantasy; do
      filename="${eth}-${body}-${hair}"
      prompt="$SEXY_BASE, ${ETHNICITY[$eth]}, ${BODYTYPE[$body]}, ${HAIRCOLOR[$hair]}"

      COUNT=$((COUNT + 1))
      echo "[$COUNT/$TOTAL] $filename"
      generate_image "$filename" "$prompt"
    done
  done
done

echo ""
echo "=== Generation Complete ==="
echo "Total images: $(ls $OUTPUT_DIR/*.png | wc -l)"
