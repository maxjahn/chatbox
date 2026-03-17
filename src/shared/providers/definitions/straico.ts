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
        modelId: 'deepseek/deepseek-chat',
        nickname: 'DeepSeek: V3',
        capabilities: ['tool_use'],
        contextWindow: 64_000,
      },
      {
        modelId: 'openai/gpt-5',
        nickname: 'OpenAI: GPT-5',
        capabilities: ['vision', 'tool_use'],
        contextWindow: 1_047_576,
      },
      {
        modelId: 'perplexity/sonar',
        nickname: 'Perplexity: Sonar',
        capabilities: ['web_search'],
        contextWindow: 128_000,
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
