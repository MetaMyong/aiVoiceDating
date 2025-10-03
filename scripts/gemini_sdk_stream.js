// Google official example style using @google/genai SDK
// Usage: node scripts/gemini_sdk_stream.js "API_KEY" "MODEL_ID" "your prompt"

async function main() {
  const apiKey = process.argv[2] || process.env.GEMINI_API_KEY;
  const modelId = process.argv[3] || process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const prompt = process.argv[4] || '아침 루틴 팁 알려줘';
  
  if (!apiKey) {
    console.error('Missing API key');
    process.exit(1);
  }

  // Use official @google/genai SDK
  let GoogleGenAI;
  try {
    const pkg = await import('@google/genai');
    GoogleGenAI = pkg.GoogleGenAI;
  } catch (e) {
    console.error('Please install @google/genai: npm install @google/genai');
    process.exit(1);
  }

  const ai = new GoogleGenAI({ apiKey });

  const t0 = Date.now();
  console.log(`[SDK] Calling generateContentStream with model: ${modelId}`);

  const response = await ai.models.generateContentStream({
    model: modelId,
    contents: prompt,
    generationConfig: {
      // Disable thinking process
      responseModalities: ['TEXT'],
    },
  });

  let firstAt = null;
  let total = '';

  for await (const chunk of response) {
    const text = chunk.text || '';
    if (text && !firstAt) firstAt = Date.now();
    total += text;
    if (text) {
      console.log(`[SDK][chunk +${Date.now()-t0}ms]`, JSON.stringify(text));
    }
  }

  console.log('[SDK] firstChunkMs =', firstAt ? (firstAt - t0) : -1);
  console.log('[SDK] totalMs =', Date.now() - t0);
  console.log('[SDK] totalText =', total);
}

main().catch(e => { console.error(e); process.exit(1); });
