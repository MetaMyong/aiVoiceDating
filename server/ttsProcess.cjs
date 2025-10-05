// ttsProcess.cjs - Google TTS + Fish Audio REST 통합 (CommonJS)
const axios = require('axios');

let CONFIG = {};
const GOOGLE_CREDENTIALS = process.env.GOOGLE_APPLICATION_CREDENTIALS || CONFIG.googleApplicationCredentials;
if (GOOGLE_CREDENTIALS) process.env.GOOGLE_APPLICATION_CREDENTIALS = GOOGLE_CREDENTIALS;

const COLOR_ORANGE = '\x1b[33m';
const COLOR_RESET = '\x1b[0m';

function nowDelta() { const delta = 0; return `${new Date().toISOString()} ${delta.toFixed ? '+'+delta.toFixed(3)+'ms ' : ''}`; }

// ffmpeg 종속성 제거: child_process/ffmpeg 사용 제거

// Discord 관련 ffmpeg 변환 스트림은 제거되었습니다.

// WAV(RIFF)에서 순수 PCM 데이터를 추출 (16-bit PCM 가정)
function extractPcmFromWav(wavBuf) {
	try {
		if (!wavBuf || wavBuf.length < 44) return null;
		if (wavBuf.toString('ascii', 0, 4) !== 'RIFF') return null;
		if (wavBuf.toString('ascii', 8, 12) !== 'WAVE') return null;
		let offset = 12;
		let fmtChunk = null;
		let dataChunk = null;
		while (offset + 8 <= wavBuf.length) {
			const id = wavBuf.toString('ascii', offset, offset + 4);
			const size = wavBuf.readUInt32LE(offset + 4);
			const next = offset + 8 + size;
			if (id === 'fmt ') {
				fmtChunk = { offset: offset + 8, size };
			} else if (id === 'data') {
				dataChunk = { offset: offset + 8, size };
			}
			offset = next;
		}
		if (!fmtChunk || !dataChunk) return null;
		const audioFormat = wavBuf.readUInt16LE(fmtChunk.offset + 0);
		const numChannels = wavBuf.readUInt16LE(fmtChunk.offset + 2);
		const sampleRate = wavBuf.readUInt32LE(fmtChunk.offset + 4);
		const bitsPerSample = wavBuf.readUInt16LE(fmtChunk.offset + 14);
		if (audioFormat !== 1) return null; // PCM only
		if (bitsPerSample !== 16) return null; // 16-bit only for now
		const pcm = wavBuf.subarray(dataChunk.offset, dataChunk.offset + dataChunk.size);
		return { pcm, sampleRate, channels: numChannels };
	} catch (e) {
		return null;
	}
}

// TTS 텍스트를 PCM(Buffer)으로 동기 생성 (임시파일 없이 반환)
async function synthChunkPCM(textChunk, index = 0) {
	const preferred = (process.env.TTS_PROVIDER || CONFIG.ttsProvider || '').toString().toLowerCase();
	const fishKey = process.env.FISH_AUDIO_API_KEY || CONFIG.fishAudioApiKey;
	const fishModelId = process.env.FISH_AUDIO_MODEL_ID || CONFIG.fishAudioModelId;
	const preferFish = preferred === 'fishaudio' || preferred === 'fish';
	if (preferFish && fishKey && fishModelId) {
		try {
			const url = `https://api.fish.audio/v1/tts`;
			const requestBody = {
				temperature: 0.7,
				top_p: 0.7,
				prosody: {},
				chunk_length: 120,
				normalize: false,
				// FishAudio: PCM 원시 데이터 요청 (16-bit mono, 44.1kHz 기본)
				format: 'pcm',
				sample_rate: 44100,
				latency: 'balanced',
				text: textChunk,
				references: [],
				reference_id: fishModelId
			};
			const axiosConfig = {
				headers: {
					Authorization: `Bearer ${fishKey}`,
					'Content-Type': 'application/json',
					model: CONFIG.fishAudioModelHeader || 's1'
				},
				responseType: 'arraybuffer'
			};
			console.log(`${nowDelta()}${COLOR_ORANGE}[FishAudio][PCM Request][idx=${index}]${COLOR_RESET}`, { format: 'pcm', sample_rate: 44100 });
			const resp = await axios.post(url, requestBody, axiosConfig);
			const buf = Buffer.from(resp.data);
			// 일부 환경이 WAV로 응답할 수 있어 감지 후 PCM 추출
			if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF') {
				const parsed = extractPcmFromWav(buf);
				if (parsed) {
					console.log(`${nowDelta()}[FishAudio][PCM Response] WAV->PCM extracted bytes=${parsed.pcm.length} rate=${parsed.sampleRate} ch=${parsed.channels}`);
					return { buffer: parsed.pcm, sampleRate: parsed.sampleRate, channels: parsed.channels };
				}
			}
			console.log(`${nowDelta()}[FishAudio][PCM Response] bytes=${buf.length} rate=44100 ch=1 (assumed)`);
			return { buffer: buf, sampleRate: 44100, channels: 1 };
		} catch (e) {
			console.warn('Fish Audio PCM synth failed, falling back to Gemini TTS', e.response ? { status: e.response.status, data: e.response.data } : e.message || e);
		}
	}

	const preferGemini = preferred === 'gemini' || preferred === 'gemini-tts';
	const GEMINI_KEY = process.env.GEMINI_API_KEY || CONFIG.geminiApiKey;
	if ((preferGemini || !preferFish) && GEMINI_KEY) {
		try {
			const { GoogleGenAI } = require('@google/genai');
			const ai = new GoogleGenAI({ apiKey: GEMINI_KEY });
			const model = CONFIG.geminiTtsModel || 'gemini-2.5-flash-preview-tts';
			const voiceName = (process.env.GEMINI_TTS_VOICE || CONFIG.geminiTtsVoiceName || 'Zephyr');
			const config = {
				temperature: 0.7,
				responseModalities: ['audio'],
				speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } }
			};
			const contents = [{ role: 'user', parts: [{ text: textChunk }] }];
			console.log(`${nowDelta()}${COLOR_ORANGE}[GeminiTTS][PCM Request][idx=${index}]${COLOR_RESET}`, { model, voiceName });
			const stream = await ai.models.generateContentStream({ model, config, contents });
			let chunks = [];
			let mimeSeen = '';
			for await (const chunk of stream) {
				try {
					const inline = chunk?.candidates?.[0]?.content?.parts?.[0]?.inlineData;
					if (inline && inline.data) {
						mimeSeen = inline.mimeType || mimeSeen;
						let buffer;
						if (typeof inline.data === 'string') {
							let s = inline.data;
							const m = s.match(/^data:.*;base64,(.*)$/);
							if (m) s = m[1];
							buffer = Buffer.from(s, 'base64');
						} else if (inline.data && (inline.data instanceof Uint8Array || inline.data.buffer instanceof ArrayBuffer)) {
							buffer = Buffer.from(inline.data);
						} else if (Array.isArray(inline.data)) {
							buffer = Buffer.from(inline.data);
						} else {
							buffer = Buffer.from(String(inline.data || ''), 'base64');
						}
						chunks.push(buffer);
					}
				} catch (e) {
					console.warn('Gemini TTS chunk parse failed', e && e.message ? e.message : e);
				}
			}
			const all = Buffer.concat(chunks);
			const mlow = (mimeSeen || '').toLowerCase();
			if (mlow.includes('l16') || mlow.includes('pcm') || mlow.includes('audio/l16')) {
				// 추정 샘플레이트 파싱
				let rate = 24000; let channels = 1;
				const rmatch = mlow.match(/rate=(\d+)/);
				if (rmatch) rate = Number(rmatch[1]);
				const cmatch = mlow.match(/channels=(\d+)/);
				if (cmatch) channels = Number(cmatch[1]);
				console.log(`${nowDelta()}[GeminiTTS][PCM Response] bytes=${all.length} rate=${rate} ch=${channels}`);
				return { buffer: all, sampleRate: rate, channels };
			} else if (all.length >= 12 && all.toString('ascii', 0, 4) === 'RIFF') {
				const parsed = extractPcmFromWav(all);
				if (parsed) {
					console.log(`${nowDelta()}[GeminiTTS][WAV->PCM] bytes=${parsed.pcm.length} rate=${parsed.sampleRate} ch=${parsed.channels}`);
					return { buffer: parsed.pcm, sampleRate: parsed.sampleRate, channels: parsed.channels };
				}
			}
			// 알 수 없는 포맷: 최후 수단으로 RAW로 간주
			console.log(`${nowDelta()}[GeminiTTS][UnknownAudio] returning RAW as PCM bytes=${all.length}`);
			return { buffer: all, sampleRate: 24000, channels: 1 };
		} catch (e) {
			console.warn('Gemini TTS failed or @google/genai not available', e && e.message ? e.message : e);
		}
	}

	// 최후 수단: 빈 PCM
	return { buffer: Buffer.alloc(0), sampleRate: 44100, channels: 1 };
}

module.exports = { synthChunkPCM, extractPcmFromWav };

