// Minimal IndexedDB helper for settings and fishModels
function open() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open('aidate-db', 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function dbGet(key: string) {
  const db = await open();
  return new Promise<any>((resolve, reject) => {
    const tx = db.transaction('kv', 'readonly');
    const store = tx.objectStore('kv');
    const r = store.get(key);
    r.onsuccess = () => resolve(r.result === undefined ? null : r.result);
    r.onerror = () => reject(r.error);
  });
}

export async function dbSet(key: string, value: any) {
  const db = await open();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction('kv', 'readwrite');
    const store = tx.objectStore('kv');
    const r = store.put(value, key);
    r.onsuccess = () => resolve();
    r.onerror = () => reject(r.error);
  });
}

export const getSettings = async () => (await dbGet('settingsCfg')) || null;
export const setSettings = async (v:any) => await dbSet('settingsCfg', v);
export const getFishModels = async () => (await dbGet('fishModels')) || [];
export const setFishModels = async (v:any) => await dbSet('fishModels', v);
// Conversations stored as arrays under key `conversations::<id>`
export const getConversation = async (id:string) => (await dbGet(`conversations::${id}`)) || [];
export const setConversation = async (id:string, v:any[]) => await dbSet(`conversations::${id}`, v || []);
export const getConversationHistory = async (id:string) => await getConversation(id);
export const saveConversationHistory = async (id:string, v:any[]) => await setConversation(id, v);
