import OpenAICompatible, { type OpenAICompatibleSettings } from '../../../models/openai-compatible'
import { ApiError } from '../../../models/errors'
import type { ProviderModelInfo } from '../../../types'
import type { ModelDependencies } from '../../../types/adapters'

interface Options extends OpenAICompatibleSettings {}

export default class Straico extends OpenAICompatible {
  public name = 'Straico'
  public options: Options

  constructor(options: Omit<Options, 'apiHost'>, dependencies: ModelDependencies) {
    const apiHost = 'https://api.straico.com/v2'
    super(
      {
        apiKey: options.apiKey,
        apiHost,
        model: options.model,
        temperature: options.temperature,
        topP: options.topP,
        maxOutputTokens: options.maxOutputTokens,
        useProxy: options.useProxy,
        stream: options.stream,
      },
      dependencies
    )
    this.options = {
      ...options,
      apiHost,
    }
  }

  public async paint(
    params: {
      prompt: string
      images?: { imageUrl: string }[]
      num: number
      aspectRatio?: string
    },
    signal?: AbortSignal,
    callback?: (picBase64: string) => void
  ): Promise<string[]> {
    const sizeMap: Record<string, string> = {
      '1:1': 'square',
      '9:16': 'portrait',
      '16:9': 'landscape',
    }
    const size = sizeMap[params.aspectRatio || '1:1'] || 'square'
    const variations = Math.max(1, Math.min(params.num, 4))

    const response = await this.dependencies.request.apiRequest({
      url: 'https://api.straico.com/v0/image/generation',
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.options.model.modelId,
        description: params.prompt,
        size,
        variations,
      }),
      useProxy: this.options.useProxy,
      signal,
    })

    const json = await response.json()
    if (!json.success) {
      throw new ApiError(`Straico image generation failed: ${JSON.stringify(json)}`)
    }

    const imageUrls: string[] = json.data?.images || []
    const dataUrls: string[] = []

    for (const imageUrl of imageUrls) {
      try {
        const imgResponse = await this.dependencies.request.apiRequest({
          url: imageUrl,
          method: 'GET',
          useProxy: this.options.useProxy,
          signal,
        })
        const blob = await imgResponse.blob()
        const arrayBuffer = await blob.arrayBuffer()
        const base64 = btoa(
          new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
        )
        const mimeType = blob.type || 'image/png'
        const dataUrl = `data:${mimeType};base64,${base64}`
        dataUrls.push(dataUrl)
        callback?.(dataUrl)
      } catch (err) {
        console.error('Failed to fetch Straico generated image:', err)
      }
    }

    return dataUrls
  }

  public async listModels(): Promise<ProviderModelInfo[]> {
    const response = await this.dependencies.request.apiRequest({
      url: 'https://api.straico.com/v2/models',
      method: 'GET',
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
      },
      useProxy: this.options.useProxy,
    })

    const json = await response.json()
    if (!json.success || !json.data) {
      throw new ApiError(`Failed to fetch Straico models: ${JSON.stringify(json)}`)
    }

    const models: ProviderModelInfo[] = []
    const data = json.data

    // v2 returns categorized format: { chat: [...], image: [...] }
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      const chatModels: any[] = data.chat || []
      for (const model of chatModels) {
        const info: ProviderModelInfo = {
          modelId: model.model,
          type: 'chat',
          nickname: model.name,
        }
        if (model.max_input) {
          info.contextWindow = model.max_input
        }
        if (model.max_output) {
          info.maxOutput = model.max_output
        }
        const capabilities: ProviderModelInfo['capabilities'] = []
        if (model.image) {
          capabilities.push('vision')
        }
        if (model.tool_use) {
          capabilities.push('tool_use')
        }
        if (model.web_search) {
          capabilities.push('web_search')
        }
        if (capabilities.length > 0) {
          info.capabilities = capabilities
        }
        models.push(info)
      }

      const imageModels: any[] = data.image || []
      for (const model of imageModels) {
        models.push({
          modelId: model.model,
          type: 'chat',
          nickname: model.name,
        })
      }
    } else if (Array.isArray(data)) {
      // Fallback for flat array format
      for (const model of data) {
        if (model.model_type === 'chat') {
          const info: ProviderModelInfo = {
            modelId: model.id || model.model,
            type: 'chat',
            nickname: model.name,
          }
          if (model.max_input || model.word_limit) {
            info.contextWindow = model.max_input || model.word_limit
          }
          if (model.max_output) {
            info.maxOutput = model.max_output
          }
          models.push(info)
        } else if (model.model_type === 'image') {
          models.push({
            modelId: model.id || model.model,
            type: 'image',
            nickname: model.name,
          })
        }
      }
    } else {
      throw new ApiError(`Unexpected Straico v2 response format`)
    }

    return models
  }
}
