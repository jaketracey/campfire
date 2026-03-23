import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { streamAnchorImages, type AnchorImage } from '../imagegen';

vi.mock('@/stores/auth-store', () => ({
  getAccessToken: vi.fn(() => 'token'),
}));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('streamAnchorImages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const createStreamResponse = (body: string): Response => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(body));
        controller.close();
      },
    });

    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers({
        'content-type': 'text/event-stream',
      }),
      body: stream,
      text: async () => body,
    } as unknown as Response;
  };

  it('deduplicates duplicate anchors in SSE stream', async () => {
    const fetchMock = vi.fn();
    const anchor: AnchorImage = {
      id: 'anchor-1',
      url: 'https://cdn.example.com/anchor-1.png',
      emotionalState: 'happy',
      isIdentityAnchor: true,
    };
    const completePayload = {
      companionId: 'companion-1',
      anchors: [anchor],
      primaryAnchorId: 'anchor-1',
    };
    const body = [
      'event: anchor\n',
      `data: ${JSON.stringify(anchor)}\n`,
      '\n',
      'event: anchor\n',
      `data: ${JSON.stringify(anchor)}\n`,
      '\n',
      'event: complete\n',
      `data: ${JSON.stringify(completePayload)}\n`,
      '\n',
    ].join('');

    fetchMock.mockResolvedValue(createStreamResponse(body));
    vi.stubGlobal('fetch', fetchMock);

    const onAnchor = vi.fn();
    const onComplete = vi.fn();
    const onError = vi.fn();

    streamAnchorImages(
      {
        companionId: 'companion-1',
        appearance: {
          gender: 'female',
          ethnicity: 'mixed',
          bodyType: 'athletic',
          hairColor: 'brown',
          breastSize: 'M',
        },
      },
      {
        onAnchor,
        onComplete,
        onError,
      }
    );

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onAnchor).toHaveBeenCalledTimes(1);
    expect(onAnchor).toHaveBeenCalledWith(anchor);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries on transient connection failures', async () => {
    const fetchMock = vi.fn();
    const anchor: AnchorImage = {
      id: 'anchor-2',
      url: 'https://cdn.example.com/anchor-2.png',
      emotionalState: 'happy',
      isIdentityAnchor: true,
    };
    const completePayload = {
      companionId: 'companion-1',
      anchors: [anchor],
      primaryAnchorId: 'anchor-2',
    };
    const body = [
      'event: anchor\n',
      `data: ${JSON.stringify(anchor)}\n`,
      '\n',
      'event: complete\n',
      `data: ${JSON.stringify(completePayload)}\n`,
      '\n',
    ].join('');

    fetchMock
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(createStreamResponse(body));

    vi.stubGlobal('fetch', fetchMock);

    const onAnchor = vi.fn();
    const onError = vi.fn();
    const onComplete = vi.fn();

    streamAnchorImages(
      {
        companionId: 'companion-1',
        appearance: {
          gender: 'male',
          ethnicity: 'caucasian',
          bodyType: 'athletic',
          hairColor: 'black',
          build: 'M',
        },
      },
      {
        onAnchor,
        onError,
        onComplete,
      }
    );

    await new Promise((resolve) => setTimeout(resolve, 1200));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onAnchor).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });
});
