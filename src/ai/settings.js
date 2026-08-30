/* AI settings persisted in localStorage. The API key never leaves the device
 * except in requests to api.anthropic.com.
 */
const KEY = 'sovereign-draft.ai-settings.v1';

export const DEFAULT_MODEL = 'claude-sonnet-4-5';
export const MODELS = ['claude-opus-4-5', 'claude-sonnet-4-5', 'claude-haiku-4-5', 'claude-opus-5', 'claude-sonnet-5'];

export function loadAISettings(){
  try {
    const o = JSON.parse(localStorage.getItem(KEY) || '{}');
    return {
      apiKey: typeof o.apiKey === 'string' ? o.apiKey : '',
      model: MODELS.includes(o.model) ? o.model : DEFAULT_MODEL
    };
  } catch (e){
    return { apiKey: '', model: DEFAULT_MODEL };
  }
}

export function saveAISettings(s){
  try {
    localStorage.setItem(KEY, JSON.stringify({ apiKey: s.apiKey || '', model: s.model || DEFAULT_MODEL }));
  } catch (e){ /* private mode — settings just won't persist */ }
}
