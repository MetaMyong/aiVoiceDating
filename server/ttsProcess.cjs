// ttsProcess.cjs - Google TTS + Fish Audio REST 통합 (CommonJS)
const fs = require('fs-extra');
const os = require('os');
const path = require('path');
const axios = require('axios');

let CONFIG = {};
const GOOGLE_CREDENTIALS = process.env.GOOGLE_APPLICATION_CREDENTIALS || CONFIG.googleApplicationCredentials;
if (GOOGLE_CREDENTIALS) process.env.GOOGLE_APPLICATION_CREDENTIALS = GOOGLE_CREDENTIALS;

const COLOR_ORANGE = '\x1b[33m';
const COLOR_RESET = '\x1b[0m';

function nowDelta() { const delta = 0; return `${new Date().toISOString()} ${delta.toFixed ? '+'+delta.toFixed(3)+'ms ' : ''}`; }

const cp = require('child_process');

function pcmToWavBuffer(pcmBuffer, sampleRate = 24000, channels = 1) {
	const bytesPerSample = 2;
	const blockAlign = channels * bytesPerSample;
	const byteRate = sampleRate * blockAlign;
	const dataSize = pcmBuffer.length;
	const header = Buffer.alloc(44);
	header.write('RIFF', 0);
	header.writeUInt32LE(36 + dataSize, 4);
	header.write('WAVE', 8);
	header.write('fmt ', 12);
	header.writeUInt32LE(16, 16);
	header.writeUInt16LE(1, 20);
	header.writeUInt16LE(channels, 22);
	header.writeUInt32LE(sampleRate, 24);
	header.writeUInt32LE(byteRate, 28);
	header.writeUInt16LE(blockAlign, 32);
	header.writeUInt16LE(bytesPerSample * 8, 34);
	header.write('data', 36);
	header.writeUInt32LE(dataSize, 40);
	return Buffer.concat([header, pcmBuffer]);
}

function makeAudioResourceFromFile(fp) {
	const { createAudioResource, StreamType } = require('@discordjs/voice');
	const { createReadStream } = require('fs');
	const ext = (path.extname(fp) || '').toLowerCase().replace('.', '');
	const needsTranscode = ['wav', 'mp3', 'm4a', 'aac', 'flac', 'ogg'].includes(ext);
	if (needsTranscode) {
		try {
			try {
				const h = fs.readFileSync(fp, { encoding: null, start: 0, end: 31 });
				console.log(`${nowDelta()}[TTS][ffmpeg] file header=${h.slice(0,12).toString('ascii').replace(/[^ -~]/g, '.')}`);
			} catch (e) { /* ignore header read errors */ }
			try {
				const st = fs.statSync(fp);
				if (!st || typeof st.size !== 'number' || st.size < 44) {
					console.warn(`${nowDelta()}[TTS][ffmpeg] skipping ffmpeg for small/invalid file (${fp}) size=${st && st.size}`);
					return createAudioResource(createReadStream(fp));
				}
			} catch (e) {
				console.warn(`${nowDelta()}[TTS][ffmpeg] stat failed for ${fp}, falling back to file stream`, e && e.message ? e.message : e);
				return createAudioResource(createReadStream(fp));
			}
			let ffmpegCmd = process.env.FFMPEG_PATH || path.join(__dirname, 'ffmpeg.exe');
			if (!fs.existsSync(ffmpegCmd)) ffmpegCmd = process.env.FFMPEG_PATH || 'ffmpeg';
			const args = ['-i', fp, '-f', 's16le', '-ar', '48000', '-ac', '2', 'pipe:1'];
			console.log(`${nowDelta()}[TTS][ffmpeg] spawn: ${ffmpegCmd} ${args.join(' ')}`);
			const ff = cp.spawn(ffmpegCmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
			ff.on('error', (err) => { console.warn(`${nowDelta()}[TTS][ffmpeg] spawn failed:`, err && err.message ? err.message : err); });
			ff.stderr.on('data', (d) => { try { console.log(`${nowDelta()}[TTS][ffmpeg][stderr]`, d.toString().trim()); } catch(e){} });
			ff.on('exit', (code, sig) => { console.log(`${nowDelta()}[TTS][ffmpeg] exit code=${code} signal=${sig}`); });
			return createAudioResource(ff.stdout, { inputType: StreamType.Raw });
		} catch (e) {
			console.warn('Failed to spawn ffmpeg for', fp, e && e.message ? e.message : e);
		}
	}
	return createAudioResource(createReadStream(fp));
}

async function synthChunkSync(textChunk, index = 0) {
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
				chunk_length: 280,
				normalize: false,
				format: 'mp3',
				mp3_bitrate: 128,
				opus_bitrate: 32,
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
			console.log(`${nowDelta()}${COLOR_ORANGE}[FishAudio][Request][idx=${index}]${COLOR_RESET}`, requestBody);
			const resp = await axios.post(url, requestBody, axiosConfig);
			console.log(`${nowDelta()}[FishAudio][Response][idx=${index}] status=${resp.status} bytes=${resp.data ? resp.data.byteLength : 0}`);
			const tmp = path.join(os.tmpdir(), `ai_date_tts_${Date.now()}_${Math.floor(Math.random()*10000)}.mp3`);
			fs.writeFileSync(tmp, Buffer.from(resp.data));
			return tmp;
		} catch (e) {
			console.warn('Fish Audio synth failed, falling back to Gemini TTS', e.response ? { status: e.response.status, data: e.response.data } : e.message || e);
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
			console.log(`${nowDelta()}${COLOR_ORANGE}[GeminiTTS][Request][idx=${index}]${COLOR_RESET}`, { model, voiceName });
			const stream = await ai.models.generateContentStream({ model, config, contents });
			for await (const chunk of stream) {
				try {
					const inline = chunk?.candidates?.[0]?.content?.parts?.[0]?.inlineData;
					if (inline && inline.data) {
							const mime = inline.mimeType || '';
							let ext = 'wav';
							try { ext = require('mime').getExtension(mime) || ext; } catch (e) {}
							const tmp = path.join(os.tmpdir(), `ai_date_gemini_tts_${Date.now()}_${Math.floor(Math.random()*10000)}.${ext}`);
							let buffer;
							try {
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
							} catch (e) {
								console.warn(`${nowDelta()}[GeminiTTS][Response][idx=${index}] decode failed`, e && e.message ? e.message : e);
								buffer = Buffer.from('');
							}
							try {
								const mlow = (mime || '').toLowerCase();
								if (mlow.includes('l16') || mlow.includes('pcm') || mlow.includes('audio/l16')) {
									let rate = 24000; let channels = 1;
									const rmatch = mlow.match(/rate=(\d+)/);
									if (rmatch) rate = Number(rmatch[1]);
									const cmatch = mlow.match(/channels=(\d+)/);
									if (cmatch) channels = Number(cmatch[1]);
									const wavBuf = pcmToWavBuffer(buffer, rate, channels);
									fs.writeFileSync(tmp, wavBuf);
									console.log(`${nowDelta()}[GeminiTTS][Response][idx=${index}] wrapped PCM->WAV mime=${mime} file=${tmp} bytes=${wavBuf.length}`);
								} else {
									fs.writeFileSync(tmp, buffer);
								}
							} catch (e) {
								fs.writeFileSync(tmp, buffer);
							}
							return tmp;
					}
				} catch (e) { console.warn('Gemini TTS chunk parse failed', e && e.message ? e.message : e); }
			}
		} catch (e) {
			console.warn('Gemini TTS failed or @google/genai not available', e && e.message ? e.message : e);
		}
	}

	const GEMINI_KEY_FALLBACK = process.env.GEMINI_API_KEY || CONFIG.geminiApiKey;
	if (GEMINI_KEY_FALLBACK) {
		try {
			const { GoogleGenAI } = require('@google/genai');
			const ai = new GoogleGenAI({ apiKey: GEMINI_KEY_FALLBACK });
			const model = CONFIG.geminiTtsModel || 'gemini-2.5-flash-preview-tts';
			const voiceName = (process.env.GEMINI_TTS_VOICE || CONFIG.geminiTtsVoiceName || 'Zephyr');
			const config = {
				temperature: 0.7,
				responseModalities: ['audio'],
				speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } }
			};
			const contents = [{ role: 'user', parts: [{ text: textChunk }] }];
			console.log(`${nowDelta()}${COLOR_ORANGE}[GeminiTTS][FallbackRequest][idx=${index}]${COLOR_RESET}`, { model, voiceName });
			const stream = await ai.models.generateContentStream({ model, config, contents });
			for await (const chunk of stream) {
				try {
					const inline = chunk?.candidates?.[0]?.content?.parts?.[0]?.inlineData;
					if (inline && inline.data) {
							const mime = inline.mimeType || '';
							let ext = 'wav';
							try { ext = require('mime').getExtension(mime) || ext; } catch (e) {}
							const tmp = path.join(os.tmpdir(), `ai_date_gemini_tts_${Date.now()}_${Math.floor(Math.random()*10000)}.${ext}`);
							let buffer;
							try {
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
							} catch (e) {
								console.warn(`${nowDelta()}[GeminiTTS][FallbackResponse][idx=${index}] decode failed`, e && e.message ? e.message : e);
								buffer = Buffer.from('');
							}
							try {
								const mlow = (mime || '').toLowerCase();
								if (mlow.includes('l16') || mlow.includes('pcm') || mlow.includes('audio/l16')) {
									let rate = 24000; let channels = 1;
									const rmatch = mlow.match(/rate=(\d+)/);
									if (rmatch) rate = Number(rmatch[1]);
									const cmatch = mlow.match(/channels=(\d+)/);
									if (cmatch) channels = Number(cmatch[1]);
									const wavBuf = pcmToWavBuffer(buffer, rate, channels);
									fs.writeFileSync(tmp, wavBuf);
									console.log(`${nowDelta()}[GeminiTTS][FallbackResponse][idx=${index}] wrapped PCM->WAV mime=${mime} file=${tmp} bytes=${wavBuf.length}`);
								} else {
									fs.writeFileSync(tmp, buffer);
								}
							} catch (e) {
								fs.writeFileSync(tmp, buffer);
							}
							return tmp;
					}
				} catch (e) { console.warn('Gemini TTS fallback chunk parse failed', e && e.message ? e.message : e); }
			}
		} catch (e) {
			console.warn('Gemini TTS fallback failed or @google/genai not available', e && e.message ? e.message : e);
		}
	}

	try {
		const tmp = path.join(os.tmpdir(), `ai_date_tts_placeholder_${Date.now()}_${Math.floor(Math.random()*10000)}.txt`);
		fs.writeFileSync(tmp, `TTS_PLACEHOLDER:\n${textChunk}`);
		return tmp;
	} catch (e) {
		console.error('Failed to create placeholder TTS file', e && e.message ? e.message : e);
		return null;
	}
}

module.exports = { pcmToWavBuffer, makeAudioResourceFromFile, synthChunkSync };

