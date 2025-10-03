import { dbGet } from './indexeddb';

// Build messages array from promptBlocks and conversation history file
// promptBlocks: [{name,type,prompt,role,count?}, ...]
// convId: optional conversation id (string) to load history from conversations/<id>.json on server side via API —
// in this frontend-only helper we'll accept a history array passed in by caller.

export type PromptBlock = { name:string, type: 'pure'|'conversation'|'longterm'|'system', prompt:string, role: 'user'|'assistant'|'system', count?: number, startIndex?: number, endIndex?: number };

// 프롬프트에서 변수를 치환하는 함수
function replaceVariables(text: string, variables: Record<string, string>): string {
  let result = text;
  for (const [key, value] of Object.entries(variables)) {
    const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
    result = result.replace(regex, value);
  }
  return result;
}

export async function buildPromptMessages(blocks: PromptBlock[], conversationHistory: Array<any> = []) {
  const messages: Array<{ role: string, content: string }> = [];
  
  // IndexedDB에서 설정 가져오기
  const settings = await dbGet('settingsCfg');
  const selectedPersonaIndex = settings?.selectedPersonaIndex ?? 0;
  const personas = settings?.personas || [];
  const selectedPersona = personas[selectedPersonaIndex];
  
  // 치환할 변수들
  const variables: Record<string, string> = {
    user: selectedPersona?.name || 'User',
    user_description: selectedPersona?.description || '',
  };
  
  for (const b of blocks) {
    // 프롬프트 내용에서 변수 치환
    const processedPrompt = replaceVariables(b.prompt, variables);
    
    if (b.type === 'system') {
      // System prompt type - always use system role
      messages.push({ role: 'system', content: processedPrompt });
    } else if (b.type === 'pure') {
      messages.push({ role: b.role, content: processedPrompt });
    } else if (b.type === 'conversation') {
      // If startIndex/endIndex provided, use them as slice bounds (inclusive start, inclusive end)
      if (typeof b.startIndex === 'number' || typeof b.endIndex === 'number'){
        const start = Math.max(0, (typeof b.startIndex === 'number') ? b.startIndex : 0);
        const end = (typeof b.endIndex === 'number') ? b.endIndex : (conversationHistory.length - 1);
        // slice end is exclusive, so use end+1
        const slice = conversationHistory.slice(start, Math.min(conversationHistory.length, end + 1));
        for (let i = 0; i < slice.length; i++){
          const item = slice[i];
          const r = item.role === 'assistant' ? 'assistant' : 'user';
          messages.push({ role: r, content: item.text });
        }
      } else {
        const count = (typeof b.count === 'number' && b.count > 0) ? b.count : 10;
        const slice = conversationHistory.slice(-count);
        for (let i = 0; i < slice.length; i++){
          const item = slice[i];
          const r = item.role === 'assistant' ? 'assistant' : 'user';
          messages.push({ role: r, content: item.text });
        }
      }
    } else {
      // longterm: treat as system-like prompt
      messages.push({ role: 'system', content: processedPrompt });
    }
  }
  return messages;
}
