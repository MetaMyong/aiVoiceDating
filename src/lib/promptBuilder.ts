import { dbGet } from './indexeddb';

// Build messages array from promptBlocks and conversation history file
// promptBlocks: [{name,type,prompt,role,count?}, ...]
// convId: optional conversation id (string) to load history from conversations/<id>.json on server side via API —
// in this frontend-only helper we'll accept a history array passed in by caller.

export type PromptBlock = { name:string, type: 'pure'|'conversation'|'longterm'|'system'|'lorebook'|'author_notes'|'global_override'|'final_insert', prompt:string, role: 'user'|'assistant'|'system', count?: number, startIndex?: number, endIndex?: number };

export type BuildOptions = {
  authorNotes?: string; // session-scoped author notes (현재 채팅 한정)
};

// 프롬프트에서 변수를 치환하는 함수
function replaceVariables(text: string, variables: Record<string, string>): string {
  let result = text;
  for (const [key, value] of Object.entries(variables)) {
    const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
    result = result.replace(regex, value);
  }
  return result;
}

export async function buildPromptMessages(blocks: PromptBlock[], conversationHistory: Array<any> = [], opts?: BuildOptions) {
  const messages: Array<{ role: string, content: string }> = [];
  
  // IndexedDB에서 설정 가져오기
  const settings = await dbGet('settingsCfg');
  const selectedPersonaIndex = settings?.selectedPersonaIndex ?? 0;
  const personas = settings?.personas || [];
  const selectedPersona = personas[selectedPersonaIndex];
  const characterCards = Array.isArray(settings?.characterCards) ? settings.characterCards : [];
  const selectedCharacterCardIndex = (typeof settings?.selectedCharacterCardIndex === 'number') ? settings.selectedCharacterCardIndex : null;
  const selectedCardEntry = (selectedCharacterCardIndex !== null) ? characterCards[selectedCharacterCardIndex] : null;
  const cardFromSelection = selectedCardEntry?.card || selectedCardEntry?.characterData || null;
  const effectiveCard = cardFromSelection || selectedPersona?.characterData || null;
  
  // 치환할 변수들
  const variables: Record<string, string> = {
    user: selectedPersona?.name || 'User',
    user_description: selectedPersona?.description || '',
    // char/char_description MUST reflect the character card only; do not fall back to persona/user values
    char: (effectiveCard?.data?.name) || (selectedCardEntry?.name) || '',
    char_description: (effectiveCard?.data?.description) || (selectedCardEntry?.description) || '',
  };
  
  // Custom Lorebook from Settings (설정의 커스텀 로어북)
  const customLorebook: Array<any> = Array.isArray(settings?.customLorebook) ? settings.customLorebook : [];

  // Helper: identify entries to hide (folders)
  const isFolderEntry = (entry: any): boolean => {
    const keys = entry?.keys;
    if (Array.isArray(keys)) return keys.some((k: any) => typeof k === 'string' && k.toLowerCase().includes('folder'));
    if (typeof keys === 'string') return keys.toLowerCase().includes('folder');
    return false;
  };

  for (const b of blocks) {
    // 프롬프트 내용에서 변수 치환
    const processedPrompt = replaceVariables(b.prompt || '', variables);
    
    if (b.type === 'system') {
      // System prompt type - always use system role
      messages.push({ role: 'system', content: processedPrompt });
    } else if (b.type === 'pure') {
      messages.push({ role: b.role, content: processedPrompt });
    } else if (b.type === 'lorebook' || b.type === 'author_notes' || b.type === 'global_override' || b.type === 'final_insert') {
      // CCv3 기반 자동 생성 블록
      const card = effectiveCard;

      // For lorebook/final_insert we may produce multiple messages by insertion order
      if (b.type === 'lorebook' || b.type === 'final_insert') {
        const entries: any[] = (card && card.spec === 'chara_card_v3' && card.data)
          ? (Array.isArray(card.data?.character_book?.entries) ? card.data.character_book.entries : [])
          : [];

        // Build a lowercase context text from prior conversation for activation-key matching
        const contextText = (conversationHistory || [])
          .map((m:any) => (m && m.text ? String(m.text) : ''))
          .join('\n')
          .toLowerCase();

        // Helpers for activation keys
        const isTruthy = (v:any): boolean => {
          if (v === true || v === 1) return true;
          if (typeof v === 'string') {
            const s = v.trim().toLowerCase();
            return s === 'true' || s === '1' || s === 'yes' || s === 'on' || s === 'always';
          }
          return false;
        };
        const getKeys = (obj:any): string[] => {
          // Primary field is `keys` (array or comma-separated string) per CharacterSidePanel
          // Accept some aliases for compatibility
          const src = (obj && (obj.keys ?? obj.activation_keys ?? obj.activationKeys ?? obj.keywords ?? obj.triggers));
          let arr: string[] = [];
          if (Array.isArray(src)) arr = src.filter((s:any)=>typeof s==='string').map((s:string)=>s);
          else if (typeof src === 'string') {
            // Split on common delimiters: comma/semicolon/newline/whitespace (2+ spaces)
            arr = src.split(/[,;\n]+|\s{2,}/g).map(s=>s.trim()).filter(Boolean);
          }
          return [...new Set(arr)];
        };
        const isAlways = (obj:any): boolean => {
          // UI uses `constant` for "언제나 활성화"; honor it first. Keep legacy aliases as fallback.
          return isTruthy(obj?.constant) ||
                 isTruthy(obj?.always) || isTruthy(obj?.alwaysActive) || isTruthy(obj?.alwaysCurrentChat) ||
                 isTruthy(obj?.always_on) || isTruthy(obj?.alwaysOn) ||
                 isTruthy(obj?.always_include) || isTruthy(obj?.alwaysInclude);
        };
        const isMulti = (obj:any): boolean => {
          // UI uses `selective` for "멀티키(모두 충족)"; treat as AND when truthy. Keep legacy aliases as fallback.
          return isTruthy(obj?.selective) ||
                 isTruthy(obj?.multi) || isTruthy(obj?.all) ||
                 isTruthy(obj?.require_all) || isTruthy(obj?.requireAll) ||
                 isTruthy(obj?.multiKeys) || isTruthy(obj?.require_all_keys) || isTruthy(obj?.requireAllKeys);
        };
        const matchesKeys = (keys:string[], ctx:string, requireAll:boolean): boolean => {
          if (!keys || keys.length === 0) return false;
          const list = keys.map(k => String(k || '').toLowerCase()).filter(Boolean);
          if (!list.length) return false;
          return requireAll ? list.every(k => ctx.includes(k)) : list.some(k => ctx.includes(k));
        };
        // Ignore any rege flags on lorebook; matching is plain substring

        // Filter out disabled/folder entries and non-string contents
        const cleaned = entries
          .filter((e:any) => e && e.enabled !== false && typeof e.content === 'string' && !isFolderEntry(e));

        // Split depth prompts (content starting with "@@depth 0")
  const isDepthPrompt = (txt: string) => /^\s*@@depth\s*0\b/i.test(txt || '');

        // Collect items list (order, content) while excluding/including based on type + activation keys
        const items: Array<{ order: number, content: string }> = [];
        for (const e of cleaned) {
          const contentStr = String(e.content || '');
          const depth = isDepthPrompt(contentStr);
          const fitsSlot = b.type === 'final_insert' ? depth : !depth;
          if (!fitsSlot) continue;

          const keys = getKeys(e);
          const include = isAlways(e) || matchesKeys(keys, contextText, isMulti(e));
          if (!include) continue;

          const order = Number(e.insertion_order ?? 0) || 0;
          items.push({ order, content: contentStr });
        }

        // Merge custom lorebook as well with same activation logic (depth prompts go to final_insert)
        const customAll: Array<{ content:string, order:number, _raw:any }> = Array.isArray(customLorebook)
          ? customLorebook
              .filter((x:any) => x && x.enabled !== false && typeof x.prompt === 'string')
              .map((x:any) => ({ content: String(x.prompt || ''), order: Number(x.order), _raw: x }))
          : [];

        for (const item of customAll) {
          const depth = isDepthPrompt(item.content);
          const fitsSlot = b.type === 'final_insert' ? depth : !depth;
          if (!fitsSlot) continue;

          const raw = item._raw || {};
          const keys = getKeys(raw);
          const include = isAlways(raw) || matchesKeys(keys, contextText, isMulti(raw));
          if (!include) continue;

          const order = Number.isFinite(item.order) ? (item.order as number) : Number.MAX_SAFE_INTEGER;
          items.push({ order, content: item.content });
        }

        // Sort by numeric order and push one message per item (배치 순서대로 항목 수만큼 메시지 생성)
        items.sort((a,b) => a.order - b.order);
        for (const it of items) {
          const finalText = replaceVariables(it.content, variables);
          if (finalText.trim().length > 0) messages.push({ role: b.role, content: finalText });
        }
      } else if (b.type === 'author_notes') {
        // 작가의 노트: 카드 creator_notes가 아니라, 현재 채팅 한정 사용자 입력을 사용
        const content = String(opts?.authorNotes || settings?.sessionAuthorNotes || '');
        const finalText = replaceVariables(content || '', variables);
        messages.push({ role: b.role, content: finalText });
      } else if (b.type === 'global_override') {
        let content = '';
        if (card && card.spec === 'chara_card_v3' && card.data) {
          content = card.data?.post_history_instructions || '';
        } else {
          // v2 등 구버전 호환
          content = selectedPersona?.characterData?.data?.post_history_instructions || '';
        }
        const finalText = replaceVariables(content || '', variables);
        messages.push({ role: b.role, content: finalText });
      }
    } else if (b.type === 'conversation') {
      // If startIndex/endIndex provided, use them with reverse indexing semantics:
      // - startIndex: 0 means the most recent (last) message, 1 means second most recent, etc.
      // - endIndex: if 0, special option to include up to the very end (latest message).
      //   Otherwise, same reverse indexing as startIndex.
      // Indices are inclusive. If either is missing, defaults apply (start from oldest or end at newest).
      if (typeof b.startIndex === 'number' || typeof b.endIndex === 'number'){
        const len = conversationHistory.length;
        if (len > 0) {
          // Map reverse offset (0=last) to absolute index (0..len-1)
          const fromTail = (offset: number) => Math.max(0, Math.min(len - 1, (len - 1 - offset)));

          // Compute absolute start/end with defaults
          const absStart = (typeof b.startIndex === 'number') ? fromTail(Math.max(0, b.startIndex)) : 0;
          let absEnd: number;
          if (typeof b.endIndex === 'number') {
            if (b.endIndex === 0) {
              // Special option: include all the way to the newest message
              absEnd = len - 1;
            } else {
              absEnd = fromTail(Math.max(0, b.endIndex));
            }
          } else {
            absEnd = len - 1;
          }

          // Normalize bounds
          const start = Math.max(0, Math.min(absStart, len - 1));
          const end = Math.max(start, Math.min(absEnd, len - 1));
          const slice = conversationHistory.slice(start, end + 1);
          for (let i = 0; i < slice.length; i++){
            const item = slice[i];
            const r = item.role === 'assistant' ? 'assistant' : 'user';
            messages.push({ role: r, content: item.text });
          }
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
