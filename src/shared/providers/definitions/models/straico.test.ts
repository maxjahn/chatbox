import type { ModelDependencies } from 'src/shared/types/adapters'
import type { ProviderModelInfo } from 'src/shared/types/settings'
import type { SentryScope } from 'src/shared/utils/sentry_adapter'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Straico from './straico'

function createMockResponse(json: unknown): Response {
  return {
    json: () => Promise.resolve(json),
    ok: true,
    status: 200,
  } as unknown as Response
}

function createMockBlobResponse(data: Uint8Array, mimeType: string): Response {
  const blob = new Blob([data], { type: mimeType })
  return {
    blob: () => Promise.resolve(blob),
    ok: true,
    status: 200,
  } as unknown as Response
}

describe('Straico Adapter', () => {
  let dependencies: ModelDependencies
  let apiRequestMock: ReturnType<typeof vi.fn>

  const defaultModel: ProviderModelInfo = {
    modelId: 'openai/gpt-4o',
    type: 'chat',
    capabilities: ['vision', 'tool_use'],
  }

  beforeEach(() => {
    vi.clearAllMocks()

    apiRequestMock = vi.fn()

    dependencies = {
      request: {
        apiRequest: apiRequestMock,
        fetchWithOptions: vi.fn(),
      },
      storage: {
        saveImage: vi.fn().mockResolvedValue('mock-storage-key'),
        getImage: vi.fn().mockResolvedValue('https://example.com/image.png'),
      },
      sentry: {
        withScope: vi.fn((callback: (scope: SentryScope) => void) => callback({ setTag: vi.fn(), setExtra: vi.fn() })),
        captureException: vi.fn(),
      },
      getRemoteConfig: vi.fn().mockReturnValue({ setting_chatboxai_first: false }),
    }
  })

  function createStraico(overrides: Partial<{ model: ProviderModelInfo; apiKey: string; useProxy: boolean }> = {}) {
    return new Straico(
      {
        apiKey: overrides.apiKey || 'test-straico-key',
        model: overrides.model || defaultModel,
        useProxy: overrides.useProxy,
      },
      dependencies
    )
  }

  describe('constructor', () => {
    it('should set apiHost to Straico v0 endpoint', () => {
      const straico = createStraico()
      expect(straico.options.apiHost).toBe('https://api.straico.com/v0')
    })

    it('should set name to Straico', () => {
      const straico = createStraico()
      expect(straico.name).toBe('Straico')
    })
  })

  describe('listModels', () => {
    it('should parse models from categorized response', async () => {
      apiRequestMock.mockResolvedValueOnce(
        createMockResponse({
          success: true,
          data: {
            chat: [
              {
                name: 'GPT-4o',
                model: 'openai/gpt-4o',
                max_input: 128000,
                max_output: 4096,
                image: true,
                tool_use: true,
                web_search: false,
              },
              {
                name: 'Claude Sonnet 4',
                model: 'anthropic/claude-sonnet-4',
                max_input: 200000,
                max_output: 8192,
                image: true,
                tool_use: true,
                web_search: true,
              },
            ],
            image: [
              {
                name: 'DALL-E 3',
                model: 'openai/dall-e-3',
              },
            ],
          },
        })
      )

      const straico = createStraico()
      const models = await straico.listModels()

      expect(models).toHaveLength(3)

      expect(models[0]).toEqual({
        modelId: 'openai/gpt-4o',
        type: 'chat',
        nickname: 'GPT-4o',
        contextWindow: 128000,
        maxOutput: 4096,
        capabilities: ['vision', 'tool_use'],
      })

      expect(models[1]).toEqual({
        modelId: 'anthropic/claude-sonnet-4',
        type: 'chat',
        nickname: 'Claude Sonnet 4',
        contextWindow: 200000,
        maxOutput: 8192,
        capabilities: ['vision', 'tool_use', 'web_search'],
      })

      expect(models[2]).toEqual({
        modelId: 'openai/dall-e-3',
        type: 'chat',
        nickname: 'DALL-E 3',
      })
    })

    it('should use name as modelId when model field is absent', async () => {
      apiRequestMock.mockResolvedValueOnce(
        createMockResponse({
          success: true,
          data: {
            chat: [{ name: 'some-model' }],
          },
        })
      )

      const straico = createStraico()
      const models = await straico.listModels()

      expect(models[0].modelId).toBe('some-model')
    })

    it('should skip non-array entries in data', async () => {
      apiRequestMock.mockResolvedValueOnce(
        createMockResponse({
          success: true,
          data: {
            chat: [{ name: 'Model A', model: 'a' }],
            metadata: 'not-an-array',
            count: 42,
          },
        })
      )

      const straico = createStraico()
      const models = await straico.listModels()

      expect(models).toHaveLength(1)
      expect(models[0].modelId).toBe('a')
    })

    it('should handle models with no capabilities', async () => {
      apiRequestMock.mockResolvedValueOnce(
        createMockResponse({
          success: true,
          data: {
            chat: [
              {
                name: 'Basic Model',
                model: 'vendor/basic',
                image: false,
                tool_use: false,
                web_search: false,
              },
            ],
          },
        })
      )

      const straico = createStraico()
      const models = await straico.listModels()

      expect(models[0].capabilities).toBeUndefined()
    })

    it('should send correct auth header', async () => {
      apiRequestMock.mockResolvedValueOnce(
        createMockResponse({ success: true, data: {} })
      )

      const straico = createStraico({ apiKey: 'my-secret-key' })
      await straico.listModels()

      expect(apiRequestMock).toHaveBeenCalledWith(
        expect.objectContaining({
          url: 'https://api.straico.com/v1/models',
          method: 'GET',
          headers: { Authorization: 'Bearer my-secret-key' },
        })
      )
    })

    it('should throw ApiError on failed response', async () => {
      apiRequestMock.mockResolvedValueOnce(
        createMockResponse({ success: false, error: 'Unauthorized' })
      )

      const straico = createStraico()
      await expect(straico.listModels()).rejects.toThrow('Failed to fetch Straico models')
    })

    it('should handle empty categories gracefully', async () => {
      apiRequestMock.mockResolvedValueOnce(
        createMockResponse({ success: true, data: { chat: [] } })
      )

      const straico = createStraico()
      const models = await straico.listModels()

      expect(models).toEqual([])
    })
  })

  describe('paint (image generation)', () => {
    it('should call image generation endpoint with correct parameters', async () => {
      apiRequestMock
        .mockResolvedValueOnce(
          createMockResponse({
            success: true,
            data: { images: [] },
          })
        )

      const straico = createStraico({
        model: { modelId: 'openai/dall-e-3', type: 'chat' },
      })
      await straico.paint({ prompt: 'A sunset over mountains', num: 2, aspectRatio: '16:9' })

      expect(apiRequestMock).toHaveBeenCalledWith(
        expect.objectContaining({
          url: 'https://api.straico.com/v0/image/generation',
          method: 'POST',
          headers: {
            Authorization: 'Bearer test-straico-key',
            'Content-Type': 'application/json',
          },
        })
      )

      const body = JSON.parse(apiRequestMock.mock.calls[0][0].body)
      expect(body).toEqual({
        model: 'openai/dall-e-3',
        description: 'A sunset over mountains',
        size: 'landscape',
        variations: 2,
      })
    })

    it('should map aspect ratios to Straico size values', async () => {
      const testCases = [
        { aspectRatio: '1:1', expected: 'square' },
        { aspectRatio: '9:16', expected: 'portrait' },
        { aspectRatio: '16:9', expected: 'landscape' },
        { aspectRatio: undefined, expected: 'square' },
        { aspectRatio: '4:3', expected: 'square' },
      ]

      for (const { aspectRatio, expected } of testCases) {
        apiRequestMock.mockResolvedValueOnce(
          createMockResponse({ success: true, data: { images: [] } })
        )

        const straico = createStraico()
        await straico.paint({ prompt: 'test', num: 1, aspectRatio })

        const body = JSON.parse(apiRequestMock.mock.calls[apiRequestMock.mock.calls.length - 1][0].body)
        expect(body.size).toBe(expected)
      }
    })

    it('should clamp variations to 1-4 range', async () => {
      for (const num of [0, 1, 4, 10]) {
        apiRequestMock.mockResolvedValueOnce(
          createMockResponse({ success: true, data: { images: [] } })
        )

        const straico = createStraico()
        await straico.paint({ prompt: 'test', num })

        const body = JSON.parse(apiRequestMock.mock.calls[apiRequestMock.mock.calls.length - 1][0].body)
        expect(body.variations).toBeGreaterThanOrEqual(1)
        expect(body.variations).toBeLessThanOrEqual(4)
      }
    })

    it('should fetch images and convert to data URLs', async () => {
      const imageBytes = new Uint8Array([137, 80, 78, 71]) // PNG magic bytes

      apiRequestMock
        .mockResolvedValueOnce(
          createMockResponse({
            success: true,
            data: {
              images: ['https://cdn.straico.com/img1.png', 'https://cdn.straico.com/img2.png'],
            },
          })
        )
        .mockResolvedValueOnce(createMockBlobResponse(imageBytes, 'image/png'))
        .mockResolvedValueOnce(createMockBlobResponse(imageBytes, 'image/png'))

      const callback = vi.fn()
      const straico = createStraico()
      const result = await straico.paint({ prompt: 'test', num: 2 }, undefined, callback)

      expect(result).toHaveLength(2)
      expect(result[0]).toMatch(/^data:image\/png;base64,/)
      expect(result[1]).toMatch(/^data:image\/png;base64,/)
      expect(callback).toHaveBeenCalledTimes(2)
      expect(callback).toHaveBeenCalledWith(result[0])
      expect(callback).toHaveBeenCalledWith(result[1])
    })

    it('should throw ApiError when generation fails', async () => {
      apiRequestMock.mockResolvedValueOnce(
        createMockResponse({ success: false, error: 'Insufficient coins' })
      )

      const straico = createStraico()
      await expect(
        straico.paint({ prompt: 'test', num: 1 })
      ).rejects.toThrow('Straico image generation failed')
    })

    it('should skip images that fail to fetch and return partial results', async () => {
      apiRequestMock
        .mockResolvedValueOnce(
          createMockResponse({
            success: true,
            data: {
              images: ['https://cdn.straico.com/ok.png', 'https://cdn.straico.com/broken.png'],
            },
          })
        )
        .mockResolvedValueOnce(createMockBlobResponse(new Uint8Array([1, 2, 3]), 'image/png'))
        .mockRejectedValueOnce(new Error('Network error'))

      const straico = createStraico()
      const result = await straico.paint({ prompt: 'test', num: 2 })

      expect(result).toHaveLength(1)
      expect(result[0]).toMatch(/^data:image\/png;base64,/)
    })

    it('should handle empty images array', async () => {
      apiRequestMock.mockResolvedValueOnce(
        createMockResponse({ success: true, data: { images: [] } })
      )

      const straico = createStraico()
      const result = await straico.paint({ prompt: 'test', num: 1 })

      expect(result).toEqual([])
    })

    it('should pass abort signal to requests', async () => {
      const controller = new AbortController()

      apiRequestMock.mockResolvedValueOnce(
        createMockResponse({ success: true, data: { images: [] } })
      )

      const straico = createStraico()
      await straico.paint({ prompt: 'test', num: 1 }, controller.signal)

      expect(apiRequestMock).toHaveBeenCalledWith(
        expect.objectContaining({ signal: controller.signal })
      )
    })
  })
})
