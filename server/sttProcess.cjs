// sttProcess.cjs - Google Speech-to-Text 통합 (CommonJS)
const speech = require('@google-cloud/speech');

// Speech-to-Text
// audioBuffer: Buffer (audio/webm; codecs=opus)
// googleServiceKeyJson: string | undefined (Service Account JSON 문자열)
async function audioToText(audioBuffer, googleServiceKeyJson) {
	try {
		// 각 요청마다 클라이언트를 생성하여 자격 증명을 주입
		let client;
		if (googleServiceKeyJson) {
			try {
				const creds = JSON.parse(googleServiceKeyJson);
				client = new speech.SpeechClient({ credentials: creds });
			} catch (e) {
				console.warn('Invalid googleServiceKey JSON provided:', e.message || e);
				// JSON 파싱 실패 시 환경 변수/기본 인증 시도
				client = new speech.SpeechClient();
			}
		} else {
			client = new speech.SpeechClient();
		}

		const audio = { content: audioBuffer.toString('base64') };
		// MediaRecorder(audio/webm) -> OPUS. Google이 WEBM_OPUS를 지원하므로 해당 인코딩 사용
		const config = {
			encoding: 'WEBM_OPUS',
			sampleRateHertz: 48000,
			languageCode: 'ko-KR',
			enableAutomaticPunctuation: true,
			model: 'latest_short',
		};

		const [response] = await client.recognize({ audio, config });
		if (!response || !response.results || response.results.length === 0) return '';
		return response.results[0].alternatives?.[0]?.transcript || '';
	} catch (e) {
		console.error('Google STT error', e.message || e);
		return '';
	}
}

module.exports = { audioToText };
