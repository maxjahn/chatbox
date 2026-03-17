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

  describe('listModels', () => {
    it('should parse models with capabilities from categorized response', async () => {
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
      expect(models[1].capabilities).toEqual(['vision', 'tool_use', 'web_search'])
      expect(models[2]).toEqual({
        modelId: 'openai/dall-e-3',
        type: 'chat',
        nickname: 'DALL-E 3',
      })
    })

    it('should throw ApiError on failed response', async () => {
      apiRequestMock.mockResolvedValueOnce(
        createMockResponse({ success: false, error: 'Unauthorized' })
      )

      const straico = createStraico()
      await expect(straico.listModels()).rejects.toThrow('Failed to fetch Straico models')
    })
  })

  describe('paint (image generation)', () => {
    it('should call image generation endpoint with correct parameters', async () => {
      apiRequestMock.mockResolvedValueOnce(
        createMockResponse({ success: true, data: { images: [] } })
      )

      const straico = createStraico({
        model: { modelId: 'openai/dall-e-3', type: 'chat' },
      })
      await straico.paint({ prompt: 'A sunset over mountains', num: 2, aspectRatio: '16:9' })

      const body = JSON.parse(apiRequestMock.mock.calls[0][0].body)
      expect(body).toEqual({
        model: 'openai/dall-e-3',
        description: 'A sunset over mountains',
        size: 'landscape',
        variations: 2,
      })
    })

    it('should fetch images and convert to data URLs', async () => {
      const imageBytes = new Uint8Array([137, 80, 78, 71])

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
      expect(callback).toHaveBeenCalledTimes(2)
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
  })
})
