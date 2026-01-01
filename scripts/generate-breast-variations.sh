#!/bin/bash
# Generate breast size variations for companion portraits
# Uses ComfyUI API (expects localhost:8188 - tunnel should already be set up)
#
# Generates 5 breast size variations for each base combination:
#   - 7 ethnicities × 4 body types × 5 hair colors × 5 breast sizes = 700 images
#
# Breast sizes (normalized from 0-100 slider):
#   xs (0-20)  - Small/flat
#   sm (21-40) - Modest
#   md (41-60) - Medium (default)
#   lg (61-80) - Large
#   xl (81-100) - Very large
#
# Usage:
#   ./generate-breast-variations.sh              # Generate all
#   ./generate-breast-variations.sh --resume     # Resume from progress file
#   ./generate-breast-variations.sh --dry-run    # Show what would be generated
#   ./generate-breast-variations.sh --count      # Count pending generations

set -e

# Configuration
COMFYUI_URL="http://localhost:8188"
OUTPUT_DIR="/Users/jake/Projects/campfire/packages/web/public/images/companions"
PROGRESS_FILE="/Users/jake/Projects/campfire/scripts/.breast_variation_progress.json"

# Parse arguments
DRY_RUN=false
RESUME=false
COUNT_ONLY=false

for arg in "$@"; do
  case $arg in
    --dry-run)
      DRY_RUN=true
      ;;
    --resume)
      RESUME=true
      ;;
    --count)
      COUNT_ONLY=true
      ;;
    --help)
      echo "Usage: $0 [options]"
      echo "Options:"
      echo "  --dry-run   Show what would be generated without doing it"
      echo "  --resume    Resume from progress file"
      echo "  --count     Count pending generations and exit"
      echo "  --help      Show this help"
      exit 0
      ;;
  esac
done

mkdir -p "$OUTPUT_DIR"

# Initialize progress file if needed
init_progress() {
  if [ ! -f "$PROGRESS_FILE" ] || [ "$RESUME" = false ]; then
    echo '{"started_at": "'$(date '+%Y-%m-%d %H:%M:%S')'", "completed": {}, "failed": {}}' > "$PROGRESS_FILE"
  fi
}

# Check if variation is already completed
is_completed() {
  local key="$1"
  jq -e ".completed.\"$key\" // false" "$PROGRESS_FILE" > /dev/null 2>&1
}

# Mark variation as completed
mark_completed() {
  local key="$1"
  local seed="$2"
  local tmp=$(mktemp)
  jq ".completed.\"$key\" = {\"seed\": $seed, \"timestamp\": \"$(date '+%Y-%m-%d %H:%M:%S')\"} | .last_updated = \"$(date '+%Y-%m-%d %H:%M:%S')\"" "$PROGRESS_FILE" > "$tmp"
  mv "$tmp" "$PROGRESS_FILE"
}

# Mark variation as failed
mark_failed() {
  local key="$1"
  local reason="$2"
  local tmp=$(mktemp)
  jq ".failed.\"$key\" = {\"reason\": \"$reason\", \"timestamp\": \"$(date '+%Y-%m-%d %H:%M:%S')\"}" "$PROGRESS_FILE" > "$tmp"
  mv "$tmp" "$PROGRESS_FILE"
}

# Get ethnicity descriptor
get_ethnicity_desc() {
  case "$1" in
    east-asian) echo "east asian woman, korean beauty, fair porcelain skin, almond eyes" ;;
    south-asian) echo "south asian woman, indian beauty, golden brown skin, dark expressive eyes" ;;
    black) echo "black woman, african american beauty, dark glowing skin, full lips" ;;
    caucasian) echo "caucasian woman, european beauty, fair skin" ;;
    latina) echo "latina woman, hispanic beauty, olive tan skin, passionate" ;;
    middle-eastern) echo "middle eastern woman, persian beauty, olive skin, exotic features" ;;
    mixed) echo "mixed race woman, exotic ambiguous ethnicity, unique stunning features" ;;
  esac
}

# Get body type descriptor
get_bodytype_desc() {
  case "$1" in
    slim) echo "slim petite body, slender figure, delicate" ;;
    athletic) echo "athletic toned body, fit physique, strong sexy" ;;
    curvy) echo "curvy voluptuous body, hourglass figure, wide hips" ;;
    plus-size) echo "plus size body, thick curvy figure, big beautiful, confident" ;;
  esac
}

# Get hair color descriptor
get_haircolor_desc() {
  case "$1" in
    black) echo "long black hair, dark silky hair" ;;
    brown) echo "brown wavy hair, brunette" ;;
    blonde) echo "blonde hair, golden locks" ;;
    red) echo "red hair, fiery auburn ginger" ;;
    fantasy) echo "fantasy colored hair, pastel pink purple blue hair, colorful vibrant" ;;
  esac
}

# Get breast size descriptor
get_breastsize_desc() {
  case "$1" in
    xs) echo "small breasts, flat chest, petite bust, A cup" ;;
    sm) echo "modest breasts, small bust, B cup, natural small" ;;
    md) echo "medium breasts, average bust, C cup" ;;
    lg) echo "large breasts, big bust, D cup, busty" ;;
    xl) echo "very large breasts, huge bust, DD cup, extremely busty, massive breasts" ;;
  esac
}

# Count pending generations
count_pending() {
  local pending=0
  local exists=0

  for eth in east-asian south-asian black caucasian latina middle-eastern mixed; do
    for body in slim athletic curvy plus-size; do
      for hair in black brown blonde red fantasy; do
        for size in xs sm md lg xl; do
          local filename="${eth}-${body}-${hair}-b${size}"
          if [ -f "$OUTPUT_DIR/$filename.png" ]; then
            exists=$((exists + 1))
          elif is_completed "$filename" 2>/dev/null; then
            exists=$((exists + 1))
          else
            pending=$((pending + 1))
          fi
        done
      done
    done
  done

  echo "Breast Size Variations Status:"
  echo "  Already exists: $exists"
  echo "  Pending: $pending"
  echo "  Total: 700"
}

# Check ComfyUI connectivity
check_comfyui() {
  echo "Checking ComfyUI connectivity..."
  if curl -s "$COMFYUI_URL/system_stats" > /dev/null 2>&1; then
    echo "  ComfyUI is accessible at $COMFYUI_URL"
    return 0
  else
    echo "  ERROR: ComfyUI not accessible at $COMFYUI_URL"
    echo "  Make sure the SSH tunnel is running: ssh -L 8188:localhost:8188 jake@home"
    exit 1
  fi
}

# Generate a single image
generate_image() {
  local filename="$1"
  local prompt="$2"
  local negative="$3"
  local seed="${4:-$RANDOM$RANDOM}"

  if [ "$DRY_RUN" = true ]; then
    echo "[DRY RUN] Would generate: $filename"
    return 0
  fi

  # Skip if file exists
  if [ -f "$OUTPUT_DIR/$filename.png" ]; then
    echo "  Skip (exists): $filename"
    return 0
  fi

  # Skip if already completed
  if is_completed "$filename"; then
    echo "  Skip (done): $filename"
    return 0
  fi

  echo "  Generating: $filename"

  local response=$(curl -s -X POST "$COMFYUI_URL/prompt" \
    -H "Content-Type: application/json" \
    -d '{
      "prompt": {
        "3": {
          "class_type": "KSampler",
          "inputs": {
            "seed": '$seed',
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
            "filename_prefix": "breast_'"$filename"'",
            "images": ["8", 0]
          }
        }
      }
    }')

  local prompt_id=$(echo "$response" | jq -r '.prompt_id // empty')

  if [ -z "$prompt_id" ]; then
    echo "    ✗ Failed to queue"
    mark_failed "$filename" "queue_failed"
    return 1
  fi

  # Wait for completion (max 150 seconds)
  for i in $(seq 1 30); do
    sleep 5
    local history=$(curl -s "$COMFYUI_URL/history/$prompt_id")
    local output_file=$(echo "$history" | jq -r ".\"$prompt_id\".outputs.\"9\".images[0].filename // empty")
    if [ -n "$output_file" ]; then
      curl -s -o "$OUTPUT_DIR/$filename.png" "$COMFYUI_URL/view?filename=$output_file&type=output"
      echo "    ✓ Done"
      mark_completed "$filename" "$seed"
      return 0
    fi

    # Check for errors
    local status=$(echo "$history" | jq -r ".\"$prompt_id\".status.status_str // empty")
    if [ "$status" = "error" ]; then
      echo "    ✗ Error"
      mark_failed "$filename" "generation_error"
      return 1
    fi
  done

  echo "    ✗ Timeout"
  mark_failed "$filename" "timeout"
  return 1
}

# ==================== CONFIGURATION ====================

# Base quality prompt
SEXY_BASE="masterpiece, best quality, professional photography, portrait of a gorgeous sexy woman, seductive expression, bedroom eyes, flirty smile, pouty lips, glamorous makeup, perfect skin, sensual, alluring pose, elegant, cleavage hint, low cut top, form fitting clothes, soft lighting, bokeh, 8k uhd"

# Standard negative prompt
NEGATIVE="ugly, deformed, blurry, low quality, bad anatomy, watermark, text, nude, naked, nsfw, nipples, genitals, disfigured, child, underage, bad hands, missing fingers"

# ==================== MAIN ====================

echo "=========================================="
echo "  Campfire Breast Size Variation Generator"
echo "=========================================="
echo ""
echo "7 ethnicities × 4 body types × 5 hair colors × 5 breast sizes = 700 images"
echo ""

# Just count if requested
if [ "$COUNT_ONLY" = true ]; then
  init_progress
  count_pending
  exit 0
fi

init_progress

if [ "$DRY_RUN" = false ]; then
  check_comfyui
fi

count=0
total=700

for eth in east-asian south-asian black caucasian latina middle-eastern mixed; do
  echo ""
  echo "=== Ethnicity: $eth ==="

  eth_desc=$(get_ethnicity_desc "$eth")

  for body in slim athletic curvy plus-size; do
    body_desc=$(get_bodytype_desc "$body")

    for hair in black brown blonde red fantasy; do
      hair_desc=$(get_haircolor_desc "$hair")

      for size in xs sm md lg xl; do
        count=$((count + 1))
        size_desc=$(get_breastsize_desc "$size")

        filename="${eth}-${body}-${hair}-b${size}"
        prompt="$SEXY_BASE, $eth_desc, $body_desc, $size_desc, $hair_desc"

        echo "[$count/$total] $filename"
        generate_image "$filename" "$prompt" "$NEGATIVE"
      done
    done
  done
done

echo ""
echo "=========================================="
echo "  Generation Complete"
echo "=========================================="
echo ""
echo "Output directory: $OUTPUT_DIR"
echo "Progress file: $PROGRESS_FILE"
echo ""
count_pending
