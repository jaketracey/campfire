#!/bin/bash
# List available ComfyUI checkpoints on jake@home
# Helps verify which art style checkpoints are available

REMOTE_HOST="jake@home"

echo "Listing ComfyUI checkpoints on $REMOTE_HOST..."
echo ""

ssh $REMOTE_HOST "ls -la ~/ComfyUI/models/checkpoints/*.safetensors 2>/dev/null" || {
  echo "Failed to list checkpoints. Trying alternative paths..."
  ssh $REMOTE_HOST "find ~/ComfyUI -name '*.safetensors' -type f 2>/dev/null | head -50"
}

echo ""
echo "Available LoRAs:"
ssh $REMOTE_HOST "ls ~/ComfyUI/models/loras/*.safetensors 2>/dev/null | head -20" || echo "No LoRAs found or path different"
