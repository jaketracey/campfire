import pytest
from unittest.mock import AsyncMock, MagicMock

from orchestrator.config import Settings
from orchestrator.providers.fal import FalProvider


@pytest.fixture
def provider() -> FalProvider:
    settings = Settings(
        fal_api_key="test-fal-key",
        fal_model="fal-ai/default-endpoint",
    )
    return FalProvider(settings)


@pytest.mark.asyncio
async def test_generate_uses_model_spec_fal_endpoint_when_present(provider: FalProvider):
    class Spec:
        fal_endpoint = "fal-ai/custom/endpoint"

    provider._get_model_spec = MagicMock(return_value=Spec())

    response = MagicMock()
    response.raise_for_status = MagicMock()
    response.json = MagicMock(return_value={"images": [{"url": "https://example.com/out.png"}]})

    client = MagicMock()
    client.post = AsyncMock(return_value=response)

    provider._get_client = AsyncMock(return_value=client)

    result = await provider.generate(
        prompt="test",
        size="512x512",
        model_id="fal/not-in-static-map",
    )

    assert result["image_url"] == "https://example.com/out.png"
    client.post.assert_awaited_once()

    called_url = client.post.call_args.args[0]
    assert called_url == "https://fal.run/fal-ai/custom/endpoint"


@pytest.mark.asyncio
async def test_generate_pulid_requires_reference_image(provider: FalProvider):
    provider._get_client = AsyncMock(return_value=MagicMock())
    provider._get_model_spec = MagicMock(return_value=None)

    with pytest.raises(ValueError, match="reference_image_url is required"):
        await provider.generate(
            prompt="test",
            model_id="fal/flux-pulid",
            reference_image_url=None,
        )


@pytest.mark.asyncio
async def test_generate_pulid_enforces_id_weight_floor(provider: FalProvider):
    provider._get_client = AsyncMock(return_value=MagicMock())
    provider._get_model_spec = MagicMock(return_value=None)
    provider.generate_pulid_variation = AsyncMock(
        return_value={
            "image_url": "https://example.com/pulid.png",
            "status": "succeeded",
            "latency_ms": 10,
            "width": 512,
            "height": 512,
        }
    )

    await provider.generate(
        prompt="test",
        size="512x512",
        model_id="fal/flux-pulid",
        reference_image_url="https://example.com/ref.png",
        reference_strength=0.7,  # legacy default should still keep strong identity
    )

    provider.generate_pulid_variation.assert_awaited_once()
    kwargs = provider.generate_pulid_variation.call_args.kwargs
    assert kwargs["reference_image_url"] == "https://example.com/ref.png"
    assert kwargs["id_weight"] == pytest.approx(0.85)
    assert kwargs["guidance_scale"] == pytest.approx(4.0)
    assert kwargs["num_inference_steps"] == 20


@pytest.mark.asyncio
async def test_generate_flux_lora_includes_loras_and_appends_trigger_word(provider: FalProvider):
    response = MagicMock()
    response.raise_for_status = MagicMock()
    response.json = MagicMock(return_value={"images": [{"url": "https://example.com/out.png"}]})

    client = MagicMock()
    client.post = AsyncMock(return_value=response)
    provider._get_client = AsyncMock(return_value=client)

    loras = [{"path": "https://example.com/lora.safetensors", "scale": 0.9}]

    await provider.generate(
        prompt="a portrait",
        size="512x512",
        model_id="fal/flux-lora",
        loras=loras,
        lora_trigger_word="MYTOKEN",
        negative_prompt="this should be ignored for flux-lora",
    )

    payload = client.post.call_args.kwargs["json"]
    assert payload["loras"] == loras
    assert "MYTOKEN" in payload["prompt"]
    assert "negative_prompt" not in payload


@pytest.mark.asyncio
async def test_generate_flux2_pro_does_not_send_guidance_or_steps(provider: FalProvider):
    response = MagicMock()
    response.raise_for_status = MagicMock()
    response.json = MagicMock(return_value={"images": [{"url": "https://example.com/out.png"}]})

    client = MagicMock()
    client.post = AsyncMock(return_value=response)
    provider._get_client = AsyncMock(return_value=client)

    await provider.generate(
        prompt="a portrait",
        size="512x512",
        model_id="fal/flux-2-pro",
    )

    payload = client.post.call_args.kwargs["json"]
    assert "guidance_scale" not in payload
    assert "num_inference_steps" not in payload
