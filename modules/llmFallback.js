// modules/llmFallback.js

function createOpenAICompatibleAnthropicAdapter({ baseUrl, apiKey, model, httpPost }) {
    return {
        messages: {
            async create(params) {
                const openAiMessages = [];
                
                // Handle system prompt
                if (params.system) {
                    if (Array.isArray(params.system)) {
                        const systemText = params.system
                            .filter(block => block.type === 'text')
                            .map(block => block.text)
                            .join('\n\n');
                        if (systemText) {
                            openAiMessages.push({ role: 'system', content: systemText });
                        }
                    } else if (typeof params.system === 'string') {
                        openAiMessages.push({ role: 'system', content: params.system });
                    }
                }
                
                // Handle user and assistant messages
                for (const msg of (params.messages || [])) {
                    let content = msg.content;
                    if (Array.isArray(content)) {
                        content = content
                            .filter(block => block.type === 'text')
                            .map(block => block.text)
                            .join('\n');
                    }
                    
                    openAiMessages.push({
                        role: msg.role === 'assistant' ? 'assistant' : 'user',
                        content: content
                    });
                }
                
                const openAiParams = {
                    model: model || params.model,
                    messages: openAiMessages,
                    max_tokens: params.max_tokens,
                    temperature: params.temperature,
                };

                const url = baseUrl.endsWith('/') ? `${baseUrl}chat/completions` : `${baseUrl}/chat/completions`;
                
                try {
                    const response = await httpPost(url, openAiParams, {
                        headers: {
                            'Authorization': `Bearer ${apiKey}`,
                            'Content-Type': 'application/json'
                        }
                    });
                    
                    const data = response.data;
                    
                    return {
                        id: data.id,
                        type: 'message',
                        role: 'assistant',
                        content: [
                            {
                                type: 'text',
                                text: data.choices?.[0]?.message?.content || ''
                            }
                        ],
                        model: data.model,
                        stop_reason: data.choices?.[0]?.finish_reason === 'stop' ? 'end_turn' : data.choices?.[0]?.finish_reason,
                        usage: {
                            input_tokens: data.usage?.prompt_tokens || 0,
                            output_tokens: data.usage?.completion_tokens || 0,
                        }
                    };
                } catch (error) {
                    throw error;
                }
            }
        }
    };
}

function createLLMClientWithFallback({ primary, fallback, onFallback }) {
    return {
        messages: {
            async create(params) {
                try {
                    return await primary.messages.create(params);
                } catch (error) {
                    if (fallback) {
                        if (onFallback) {
                            try {
                                onFallback(error);
                            } catch (e) {
                                console.error('[LLM Fallback] Error in onFallback hook:', e);
                            }
                        }
                        return await fallback.messages.create(params);
                    }
                    throw error;
                }
            }
        }
    };
}

module.exports = {
    createOpenAICompatibleAnthropicAdapter,
    createLLMClientWithFallback,
};
