#!/bin/bash
# Generate companion portrait variations for breast size slider and art styles
# Uses ComfyUI API via SSH tunnel to jake@home
#
# Variations:
#   - 7 ethnicities × 4 body types × 5 hair colors = 140 base combinations
#   - 5 breast sizes (normalized 1-5)
#   - 5 art styles
#   - Total: 140 × 5 × 5 = 3,500 images
#
# Usage:
#   ./generate-companion-variations.sh              # Generate all
#   ./generate-companion-variations.sh --breast     # Only breast variations
#   ./generate-companion-variations.sh --style      # Only art style variations
#   ./generate-companion-variations.sh --resume     # Resume from progress file
#   ./generate-companion-variations.sh --dry-run    # Show what would be generated

set -e

# Configuration
REMOTE_HOST="jake@home"
COMFYUI_PORT=8188
LOCAL_PORT=8188
COMFYUI_URL="http://localhost:$LOCAL_PORT"
OUTPUT_DIR="/Users/jake/Projects/campfire/packages/web/public/images/companions"
PROGRESS_FILE="/Users/jake/Projects/campfire/scripts/.variation_progress.json"

# Parse arguments
GENERATE_BREAST=false
GENERATE_STYLE=false
DRY_RUN=false
RESUME=false

for arg in "$@"; do
  case $arg in
    --breast)
      GENERATE_BREAST=true
      ;;
    --style)
      GENERATE_STYLE=true
      ;;
    --dry-run)
      DRY_RUN=true
      ;;
    --resume)
      RESUME=true
      ;;
    --help)
      echo "Usage: $0 [options]"
      echo "Options:"
      echo "  --breast    Generate only breast size variations"
      echo "  --style     Generate only art style variations"
      echo "  --dry-run   Show what would be generated without doing it"
      echo "  --resume    Resume from progress file"
      echo "  --help      Show this help"
      exit 0
      ;;
  esac
done

# Default: generate both if neither specified
if [ "$GENERATE_BREAST" = false ] && [ "$GENERATE_STYLE" = false ]; then
  GENERATE_BREAST=true
  GENERATE_STYLE=true
fi

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

# Setup SSH tunnel to ComfyUI
setup_tunnel() {
  echo "Setting up SSH tunnel to $REMOTE_HOST..."

  # Check if tunnel already exists
  if lsof -i :$LOCAL_PORT > /dev/null 2>&1; then
    echo "  Port $LOCAL_PORT already in use, checking if it's our tunnel..."
    if curl -s "$COMFYUI_URL/system_stats" > /dev/null 2>&1; then
      echo "  ComfyUI already accessible, reusing existing connection"
      return 0
    else
      echo "  Port in use but not ComfyUI, please free port $LOCAL_PORT"
      exit 1
    fi
  fi

  # Create SSH tunnel in background
  ssh -f -N -L $LOCAL_PORT:localhost:$COMFYUI_PORT $REMOTE_HOST

  # Wait for tunnel to be ready
  for i in {1..10}; do
    if curl -s "$COMFYUI_URL/system_stats" > /dev/null 2>&1; then
      echo "  SSH tunnel established"
      return 0
    fi
    sleep 1
  done

  echo "  Failed to establish SSH tunnel"
  exit 1
}

# Generate a single image
generate_image() {
  local filename="$1"
  local prompt="$2"
  local negative="$3"
  local checkpoint="${4:-Juggernaut-X-RunDiffusion-NSFW.safetensors}"
  local seed="${5:-$RANDOM$RANDOM}"

  if [ "$DRY_RUN" = true ]; then
    echo "[DRY RUN] Would generate: $filename"
    echo "  Prompt: ${prompt:0:100}..."
    echo "  Checkpoint: $checkpoint"
    return 0
  fi

  # Skip if file exists
  if [ -f "$OUTPUT_DIR/$filename.png" ]; then
    echo "  Skipping $filename (exists)"
    return 0
  fi

  # Skip if already completed
  if is_completed "$filename"; then
    echo "  Skipping $filename (in progress file)"
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
            "filename_prefix": "var_'"$filename"'",
            "images": ["8", 0]
          }
        }
      }
    }')

  local prompt_id=$(echo "$response" | jq -r '.prompt_id // empty')

  if [ -z "$prompt_id" ]; then
    echo "  ✗ Failed to queue: $filename"
    mark_failed "$filename" "queue_failed"
    return 1
  fi

  # Wait for completion (max 150 seconds)
  for i in {1..30}; do
    sleep 5
    local history=$(curl -s "$COMFYUI_URL/history/$prompt_id")
    local output_file=$(echo "$history" | jq -r ".\"$prompt_id\".outputs.\"9\".images[0].filename // empty")
    if [ -n "$output_file" ]; then
      curl -s -o "$OUTPUT_DIR/$filename.png" "$COMFYUI_URL/view?filename=$output_file&type=output"
      echo "  ✓ $filename.png"
      mark_completed "$filename" "$seed"
      return 0
    fi

    # Check for errors
    local status=$(echo "$history" | jq -r ".\"$prompt_id\".status.status_str // empty")
    if [ "$status" = "error" ]; then
      echo "  ✗ Error generating: $filename"
      mark_failed "$filename" "generation_error"
      return 1
    fi
  done

  echo "  ✗ Timeout: $filename"
  mark_failed "$filename" "timeout"
  return 1
}

# ==================== CONFIGURATION ====================

# Base quality prompt
SEXY_BASE="masterpiece, best quality, professional photography, portrait of a gorgeous sexy woman, seductive expression, bedroom eyes, flirty smile, pouty lips, glamorous makeup, perfect skin, sensual, alluring pose, elegant, cleavage hint, low cut top, form fitting clothes, soft lighting, bokeh, 8k uhd"

# Standard negative prompt
NEGATIVE="ugly, deformed, blurry, low quality, bad anatomy, watermark, text, nude, naked, nsfw, nipples, genitals, disfigured, child, underage, bad hands, missing fingers"

# Ethnicity descriptors
declare -A ETHNICITY
ETHNICITY["east-asian"]="east asian woman, korean beauty, fair porcelain skin, almond eyes"
ETHNICITY["south-asian"]="south asian woman, indian beauty, golden brown skin, dark expressive eyes"
ETHNICITY["black"]="black woman, african american beauty, dark glowing skin, full lips"
ETHNICITY["caucasian"]="caucasian woman, european beauty, fair skin"
ETHNICITY["latina"]="latina woman, hispanic beauty, olive tan skin, passionate"
ETHNICITY["middle-eastern"]="middle eastern woman, persian beauty, olive skin, exotic features"
ETHNICITY["mixed"]="mixed race woman, exotic ambiguous ethnicity, unique stunning features"

# Body type descriptors (base, breast size will be added separately)
declare -A BODYTYPE
BODYTYPE["slim"]="slim petite body, slender figure, delicate"
BODYTYPE["athletic"]="athletic toned body, fit physique, strong sexy"
BODYTYPE["curvy"]="curvy voluptuous body, hourglass figure, wide hips"
BODYTYPE["plus-size"]="plus size body, thick curvy figure, big beautiful, confident"

# Hair color descriptors
declare -A HAIRCOLOR
HAIRCOLOR["black"]="long black hair, dark silky hair"
HAIRCOLOR["brown"]="brown wavy hair, brunette"
HAIRCOLOR["blonde"]="blonde hair, golden locks"
HAIRCOLOR["red"]="red hair, fiery auburn ginger"
HAIRCOLOR["fantasy"]="fantasy colored hair, pastel pink purple blue hair, colorful vibrant"

# Breast size descriptors (normalized 1-5)
declare -A BREASTSIZE
BREASTSIZE["1"]="small breasts, flat chest, petite bust, A cup"
BREASTSIZE["2"]="modest breasts, small bust, B cup, natural"
BREASTSIZE["3"]="medium breasts, average bust, C cup"
BREASTSIZE["4"]="large breasts, big bust, D cup, busty"
BREASTSIZE["5"]="very large breasts, huge bust, DD cup, extremely busty, massive breasts"

# Breast size labels for filenames
declare -A BREASTSIZE_LABEL
BREASTSIZE_LABEL["1"]="xs"
BREASTSIZE_LABEL["2"]="sm"
BREASTSIZE_LABEL["3"]="md"
BREASTSIZE_LABEL["4"]="lg"
BREASTSIZE_LABEL["5"]="xl"

# Art style configurations
# Format: "style_key|checkpoint|style_prompt|additional_negative"
declare -a ART_STYLES
ART_STYLES=(
  "realistic|Juggernaut-X-RunDiffusion-NSFW.safetensors|photorealistic, photograph, hyperrealistic|cartoon, anime, drawing, painting, illustration"
  "anime|anyloraCheckpoint_bakedvaeBlessedFp16.safetensors|anime style, anime art, manga style, japanese animation, cel shaded|photorealistic, photograph, 3d render"
  "artistic|dreamshaper_8.safetensors|digital painting, artistic, painted, oil painting style, artistic illustration|photograph, photorealistic"
  "comic|revAnimated_v2Rebirth.safetensors|comic book art, comic style, graphic novel, bold lines, vibrant colors|photograph, photorealistic, anime"
  "fantasy|epicrealism_naturalSinRC1VAE.safetensors|fantasy art, ethereal, magical lighting, dreamy, soft glow|harsh lighting, mundane"
)

# ==================== GENERATION FUNCTIONS ====================

generate_breast_variations() {
  echo ""
  echo "=========================================="
  echo "  GENERATING BREAST SIZE VARIATIONS"
  echo "  7 ethnicities × 4 body types × 5 hair × 5 sizes = 700 images"
  echo "=========================================="
  echo ""

  local count=0
  local total=700

  for eth in east-asian south-asian black caucasian latina middle-eastern mixed; do
    for body in slim athletic curvy plus-size; do
      for hair in black brown blonde red fantasy; do
        for size in 1 2 3 4 5; do
          local size_label="${BREASTSIZE_LABEL[$size]}"
          local filename="${eth}-${body}-${hair}-b${size_label}"
          local prompt="$SEXY_BASE, ${ETHNICITY[$eth]}, ${BODYTYPE[$body]}, ${BREASTSIZE[$size]}, ${HAIRCOLOR[$hair]}"

          count=$((count + 1))
          echo "[$count/$total] $filename"
          generate_image "$filename" "$prompt" "$NEGATIVE"
        done
      done
    done
  done
}

generate_style_variations() {
  echo ""
  echo "=========================================="
  echo "  GENERATING ART STYLE VARIATIONS"
  echo "  7 ethnicities × 4 body types × 5 hair × 5 styles = 700 images"
  echo "=========================================="
  echo ""

  local count=0
  local total=700

  for style_config in "${ART_STYLES[@]}"; do
    IFS='|' read -r style_key checkpoint style_prompt style_negative <<< "$style_config"

    echo ""
    echo "--- Style: $style_key (using $checkpoint) ---"
    echo ""

    for eth in east-asian south-asian black caucasian latina middle-eastern mixed; do
      for body in slim athletic curvy plus-size; do
        for hair in black brown blonde red fantasy; do
          local filename="${eth}-${body}-${hair}-${style_key}"
          local prompt="$SEXY_BASE, $style_prompt, ${ETHNICITY[$eth]}, ${BODYTYPE[$body]}, ${HAIRCOLOR[$hair]}"
          local full_negative="$NEGATIVE, $style_negative"

          count=$((count + 1))
          echo "[$count/$total] $filename"
          generate_image "$filename" "$prompt" "$full_negative" "$checkpoint"
        done
      done
    done
  done
}

generate_full_matrix() {
  # Full matrix: breast sizes × art styles
  echo ""
  echo "=========================================="
  echo "  GENERATING FULL VARIATION MATRIX"
  echo "  7 eth × 4 body × 5 hair × 5 sizes × 5 styles = 3,500 images"
  echo "=========================================="
  echo ""

  local count=0
  local total=3500

  for style_config in "${ART_STYLES[@]}"; do
    IFS='|' read -r style_key checkpoint style_prompt style_negative <<< "$style_config"

    echo ""
    echo "=== Style: $style_key ==="
    echo ""

    for eth in east-asian south-asian black caucasian latina middle-eastern mixed; do
      for body in slim athletic curvy plus-size; do
        for hair in black brown blonde red fantasy; do
          for size in 1 2 3 4 5; do
            local size_label="${BREASTSIZE_LABEL[$size]}"
            local filename="${eth}-${body}-${hair}-b${size_label}-${style_key}"
            local prompt="$SEXY_BASE, $style_prompt, ${ETHNICITY[$eth]}, ${BODYTYPE[$body]}, ${BREASTSIZE[$size]}, ${HAIRCOLOR[$hair]}"
            local full_negative="$NEGATIVE, $style_negative"

            count=$((count + 1))
            echo "[$count/$total] $filename"
            generate_image "$filename" "$prompt" "$full_negative" "$checkpoint"
          done
        done
      done
    done
  done
}

# ==================== MAIN ====================

echo "=========================================="
echo "  Campfire Companion Variation Generator"
echo "=========================================="
echo ""
echo "Options:"
echo "  Breast variations: $GENERATE_BREAST"
echo "  Style variations:  $GENERATE_STYLE"
echo "  Dry run:          $DRY_RUN"
echo "  Resume:           $RESUME"
echo ""

init_progress

if [ "$DRY_RUN" = false ]; then
  setup_tunnel
fi

if [ "$GENERATE_BREAST" = true ] && [ "$GENERATE_STYLE" = true ]; then
  # Generate full matrix
  generate_full_matrix
elif [ "$GENERATE_BREAST" = true ]; then
  generate_breast_variations
elif [ "$GENERATE_STYLE" = true ]; then
  generate_style_variations
fi

echo ""
echo "=========================================="
echo "  Generation Complete"
echo "=========================================="
echo ""
echo "Output directory: $OUTPUT_DIR"
echo "Progress file: $PROGRESS_FILE"
echo "Total images: $(ls $OUTPUT_DIR/*.png 2>/dev/null | wc -l)"

# Summary from progress file
if [ -f "$PROGRESS_FILE" ]; then
  echo ""
  echo "Session summary:"
  echo "  Completed: $(jq '.completed | length' "$PROGRESS_FILE")"
  echo "  Failed: $(jq '.failed | length' "$PROGRESS_FILE")"
fi
