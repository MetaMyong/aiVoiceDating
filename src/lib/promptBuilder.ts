import { dbGet } from './indexeddb';

// Build messages array from promptBlocks and conversation history file
// promptBlocks: [{name,type,prompt,role,count?}, ...]
// convId: optional conversation id (string) to load history from conversations/<id>.json on server side via API —
// in this frontend-only helper we'll accept a history array passed in by caller.

export type PromptBlock = { name:string, type: 'pure'|'conversation'|'persona'|'character'|'longterm'|'system', prompt:string, role: 'user'|'assistant'|'system', count?: number, startIndex?: number, endIndex?: number };

export function buildPromptMessages(blocks: PromptBlock[], conversationHistory: Array<any> = []) {
  const messages: Array<{ role: string, content: string }> = [];
  for (const b of blocks) {
    if (b.type === 'system') {
      // System prompt type - always use system role
      messages.push({ role: 'system', content: b.prompt });
    } else if (b.type === 'pure') {
      messages.push({ role: b.role, content: b.prompt });
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
      // persona/character/longterm: treat as system-like prompt
      messages.push({ role: 'system', content: b.prompt });
    }
  }
  return messages;
}
