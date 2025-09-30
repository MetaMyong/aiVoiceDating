// sttProcess.js - Google Speech-to-Text 통합
const fs = require('fs');
const path = require('path');
const speech = require('@google-cloud/speech');

// No config.json usage. Prefer env vars for credentials.
let CONFIG = {};
const GOOGLE_CREDENTIALS = process.env.GOOGLE_APPLICATION_CREDENTIALS || CONFIG.googleApplicationCredentials;
if (GOOGLE_CREDENTIALS) process.env.GOOGLE_APPLICATION_CREDENTIALS = GOOGLE_CREDENTIALS;

let sclient = null;
try { sclient = new speech.SpeechClient(); console.log('Google Speech client initialized'); } catch (e) { sclient = null; console.warn('Google Speech init failed', e.message); }

async function audioToText(audioBuffer) {
  if (!sclient) {
    console.warn('Speech client not available');
    return '';
  }
  try {
    const audio = { content: audioBuffer.toString('base64') };
    const config = {
      encoding: 'LINEAR16',
      sampleRateHertz: 48000,
      languageCode: 'ko-KR',
      audioChannelCount: 2,
      enableAutomaticPunctuation: true,
      model: 'latest_short'
    };
    const [response] = await sclient.recognize({ audio, config });
    if (!response || !response.results || response.results.length === 0) return '';
    return response.results[0].alternatives[0].transcript || '';
  } catch (e) {
    console.error('Google STT error', e.message || e);
    return '';
  }
}

module.exports = { audioToText };
