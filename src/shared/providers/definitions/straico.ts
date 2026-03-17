import { ModelProviderEnum, ModelProviderType } from '../../types'
import { defineProvider } from '../registry'
import Straico from './models/straico'

export const straicoProvider = defineProvider({
  id: ModelProviderEnum.Straico,
  name: 'Straico',
  type: ModelProviderType.OpenAI,
  urls: {
    website: 'https://straico.com/',
    apiKey: 'https://platform.straico.com/settings-api',
  },
  defaultSettings: {
    apiHost: 'https://api.straico.com/v0',
    models: [
      {
        modelId: 'openai/gpt-4o',
        nickname: 'OpenAI: GPT-4o',
        capabilities: ['vision', 'tool_use'],
        contextWindow: 128_000,
      },
      {
        modelId: 'openai/gpt-4.1',
        nickname: 'OpenAI: GPT-4.1',
        capabilities: ['vision', 'tool_use'],
        contextWindow: 1_047_576,
      },
      {
        modelId: 'anthropic/claude-sonnet-4-20250514',
        nickname: 'Anthropic: Claude Sonnet 4',
        capabilities: ['vision', 'tool_use'],
        contextWindow: 200_000,
      },
      {
        modelId: 'google/gemini-2.5-pro-preview-05-06',
        nickname: 'Google: Gemini 2.5 Pro',
        capabilities: ['vision', 'tool_use'],
        contextWindow: 1_048_576,
      },
      {
        modelId: 'x-ai/grok-3',
        nickname: 'xAI: Grok 3',
        capabilities: ['tool_use'],
        contextWindow: 131_072,
      },
      {
        modelId: 'deepseek/deepseek-chat',
        nickname: 'DeepSeek: V3',
        capabilities: ['tool_use'],
        contextWindow: 64_000,
      },
      {
        modelId: 'deepseek/deepseek-reasoner',
        nickname: 'DeepSeek: R1',
        capabilities: ['reasoning'],
        contextWindow: 64_000,
      },
    ],
  },
  createModel: (config) => {
    return new Straico(
      {
        apiKey: config.providerSetting.apiKey || '',
        model: config.model,
        temperature: config.settings.temperature,
        topP: config.settings.topP,
        maxOutputTokens: config.settings.maxTokens,
        useProxy: config.providerSetting.useProxy,
        stream: config.settings.stream,
      },
      config.dependencies
    )
  },
  getDisplayName: (modelId, providerSettings) => {
    return `Straico (${providerSettings?.models?.find((m) => m.modelId === modelId)?.nickname || modelId})`
  },
})
